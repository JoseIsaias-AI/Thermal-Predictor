/* Testes do gerador de planilha .xlsx.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/planilha.test.js
 *
 * Um .xlsx é um pacote ZIP. Como o painel não usa biblioteca, o teste abre o
 * pacote lendo o diretório central na mão e confere o que o Excel confere ao
 * abrir: assinaturas, CRC de cada entrada, as partes obrigatórias e o XML da
 * aba. Sem isso, um arquivo corrompido só apareceria na mão de quem exporta.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");
var zlib = require("node:zlib");

var caminho = require("./apoio/fonte_painel.js").caminho;

function carregar() {
  var ctx = vm.createContext({ window: {}, TextEncoder: TextEncoder });
  ["dados_triagem.js", "dados_comparacao.js", "planilha.js", "leitura_publicos.js"].forEach(function (f) {
    vm.runInContext(fs.readFileSync(caminho(f), "utf8"), ctx, { filename: f });
  });
  return {
    DADOS: vm.runInContext("DADOS_TRIAGEM", ctx),
    P: vm.runInContext("PLANILHA", ctx),
    LP: vm.runInContext("LEITURA_PUBLICOS", ctx)
  };
}

var M = carregar();
var P = M.P;
var LP = M.LP;

/* Lê o diretório central do ZIP e devolve {nome: conteúdo}. Percorre de trás
   para a frente, como qualquer leitor de ZIP faz. */
function abrirPacote(bytes) {
  var buf = Buffer.from(bytes);
  var fim = buf.length - 22;

  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim--;
  assert.ok(fim >= 0, "fim do diretório central não encontrado");

  var total = buf.readUInt16LE(fim + 10);
  var inicio = buf.readUInt32LE(fim + 16);
  var arquivos = {};
  var p = inicio;

  for (var i = 0; i < total; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, "assinatura do diretório na entrada " + i);

    var metodo = buf.readUInt16LE(p + 10);
    var crc = buf.readUInt32LE(p + 16);
    var tamanho = buf.readUInt32LE(p + 24);
    var nomeLen = buf.readUInt16LE(p + 28);
    var extraLen = buf.readUInt16LE(p + 30);
    var comentarioLen = buf.readUInt16LE(p + 32);
    var deslocamento = buf.readUInt32LE(p + 42);
    var nome = buf.slice(p + 46, p + 46 + nomeLen).toString("utf8");

    assert.equal(buf.readUInt32LE(deslocamento), 0x04034b50, "assinatura local de " + nome);
    var nomeLocal = buf.readUInt16LE(deslocamento + 26);
    var extraLocal = buf.readUInt16LE(deslocamento + 28);
    var dados = buf.slice(deslocamento + 30 + nomeLocal + extraLocal,
      deslocamento + 30 + nomeLocal + extraLocal + tamanho);

    assert.equal(metodo, 0, nome + " precisa estar sem compressão");
    assert.equal(zlib.crc32 ? zlib.crc32(dados) : crc, crc, "CRC de " + nome);

    arquivos[nome] = dados.toString("utf8");
    p += 46 + nomeLen + extraLen + comentarioLen;
  }

  return arquivos;
}

var COLUNAS = [
  { titulo: "Componente", tipo: "texto", valor: function (p) { return p.TC_Name; } },
  { titulo: "Prevista (°C)", tipo: "numero", valor: function (p) { return p.temperatura_prevista_c; } },
  { titulo: "Folga (%)", tipo: "numero1", valor: function (p) { return p.margem_percentual * 100; } }
];

var LINHAS = LP.reprovados(LP.todosOsPontos(M.DADOS));

function gerar(colunas, linhas) {
  return abrirPacote(P.gerarBytes({ aba: "Conformidade", colunas: colunas || COLUNAS, linhas: linhas || LINHAS }));
}

test("o pacote traz as seis partes que o Excel exige", function () {
  var partes = Object.keys(gerar()).sort();

  assert.deepEqual(partes, [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/workbook.xml",
    "xl/worksheets/sheet1.xml"
  ]);
});

test("cada parte declarada no content types existe no pacote", function () {
  var arquivos = gerar();
  var tipos = arquivos["[Content_Types].xml"];
  var declaradas = (tipos.match(/PartName="\/([^"]+)"/g) || []).map(function (m) {
    return m.replace('PartName="/', "").replace('"', "");
  });

  assert.ok(declaradas.length >= 3);
  declaradas.forEach(function (parte) {
    assert.ok(arquivos[parte] !== undefined, "parte declarada e ausente: " + parte);
  });
});

test("as relações apontam para arquivos que existem", function () {
  var arquivos = gerar();

  assert.ok(arquivos["_rels/.rels"].indexOf('Target="xl/workbook.xml"') > 0);
  assert.ok(arquivos["xl/_rels/workbook.xml.rels"].indexOf('Target="worksheets/sheet1.xml"') > 0);
  assert.ok(arquivos["xl/_rels/workbook.xml.rels"].indexOf('Target="styles.xml"') > 0);
  assert.ok(arquivos["xl/workbook.xml"].indexOf('name="Conformidade"') > 0);
});

test("a aba tem uma linha de cabeçalho e uma linha por registro", function () {
  var aba = gerar()["xl/worksheets/sheet1.xml"];
  var linhas = aba.match(/<row r="\d+"/g) || [];

  assert.equal(linhas.length, LINHAS.length + 1);
  assert.equal(aba.indexOf('<dimension ref="A1:C' + (LINHAS.length + 1) + '"/>') > 0, true);
  assert.ok(aba.indexOf('<autoFilter ref="A1:C' + (LINHAS.length + 1) + '"/>') > 0);

  // Título congelado e filtro por coluna: é o que faz a planilha ser tabela.
  assert.ok(aba.indexOf('ySplit="1"') > 0);
  assert.ok(aba.indexOf('state="frozen"') > 0);
});

test("número sai como número e texto sai como texto", function () {
  var aba = gerar()["xl/worksheets/sheet1.xml"];
  var pior = LINHAS[0];

  // Texto: célula com inlineStr. Número: célula com <v>, sem tipo.
  assert.ok(aba.indexOf('<c r="A2" s="0" t="inlineStr"><is><t xml:space="preserve">' + pior.TC_Name) > 0, "componente");
  assert.ok(aba.indexOf('<c r="B2" s="2"><v>' + pior.temperatura_prevista_c + "</v></c>") > 0, "prevista");
  assert.ok(aba.indexOf('t="inlineStr"><is><t xml:space="preserve">' + pior.temperatura_prevista_c) < 0,
    "temperatura não pode virar texto: quebraria a ordenação por folga");
});

test("a largura de cada coluna acompanha o conteúdo mais longo", function () {
  var aba = gerar()["xl/worksheets/sheet1.xml"];
  var larguras = (aba.match(/width="(\d+)"/g) || []).map(function (m) {
    return Number(m.replace('width="', "").replace('"', ""));
  });
  var maiorNome = LINHAS.reduce(function (acc, p) { return Math.max(acc, p.TC_Name.length); }, 0);

  assert.equal(larguras.length, COLUNAS.length);
  larguras.forEach(function (w) {
    assert.ok(w >= 10 && w <= 46, "largura fora dos limites: " + w);
  });
  assert.ok(larguras[0] >= Math.min(46, maiorNome), "a coluna de componente ficou menor que o nome mais longo");
});

test("caractere reservado de XML é escapado, e não quebra o arquivo", function () {
  var colunas = [{ titulo: "A & B", tipo: "texto", valor: function (l) { return l.v; } }];
  var aba = gerar(colunas, [{ v: '<script>"x" & y</script>' }])["xl/worksheets/sheet1.xml"];

  assert.ok(aba.indexOf("&lt;script&gt;") > 0, aba.slice(0, 400));
  assert.ok(aba.indexOf("&amp;") > 0);
  assert.equal(/<script>/.test(aba), false);
  assert.ok(aba.indexOf("A &amp; B") > 0);
});

test("célula vazia não vira o texto vazio nem quebra o tipo da coluna", function () {
  var colunas = [{ titulo: "Folga", tipo: "numero", valor: function (l) { return l.v; } }];
  var aba = gerar(colunas, [{ v: null }, { v: 0 }])["xl/worksheets/sheet1.xml"];

  assert.ok(aba.indexOf('<c r="A2" s="2"/>') > 0, "nulo sai como célula vazia");
  // Zero é folga zero, não ausência de leitura: tem de chegar como número.
  assert.ok(aba.indexOf('<c r="A3" s="2"><v>0</v></c>') > 0, aba);
});

test("a referência de célula passa de Z para AA", function () {
  assert.equal(P.referencia(0, 1), "A1");
  assert.equal(P.referencia(25, 3), "Z3");
  assert.equal(P.referencia(26, 1), "AA1");
  assert.equal(P.referencia(51, 1), "AZ1");
  assert.equal(P.referencia(52, 1), "BA1");
});

test("a procedência entra como coluna fixa, repetida em toda linha", function () {
  var mat = LP.maturidade(M.DADOS);
  var extras = LP.colunasDeProcedencia(mat);
  var aba = gerar(COLUNAS.concat(extras))["xl/worksheets/sheet1.xml"];

  assert.equal(extras.length, 8);
  extras.forEach(function (coluna) {
    assert.ok(aba.indexOf(P.escapar(coluna.titulo)) > 0, "coluna ausente: " + coluna.titulo);

    // Valor constante: a linha continua legível se alguém filtrar ou recortar.
    var valor = coluna.valor(LINHAS[0]);
    assert.equal(coluna.valor(LINHAS[LINHAS.length - 1]), valor, coluna.titulo);
    assert.ok(String(valor).length <= 46, "valor maior que a largura da coluna: " + valor);
  });
});

test("nenhum código de requisito vaza para a planilha", function () {
  var aba = gerar(COLUNAS.concat(LP.colunasDeProcedencia(LP.maturidade(M.DADOS))))["xl/worksheets/sheet1.xml"];
  assert.equal(/\b(RF|RN|RNF)-\d+/.test(aba), false);
});
