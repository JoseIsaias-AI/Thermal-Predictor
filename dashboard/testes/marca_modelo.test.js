/* Testes da marca "modelo não validado", do construtor até o DOM das telas.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/marca_modelo.test.js
 *
 * O modelo final é uma mescla: um algoritmo escolhido por área e, em cinco
 * delas, a média de dois. As áreas não têm a mesma qualidade — `AC Blower Inlet`
 * não teve modelo validado —, e a marca é o que impede os seus pontos de
 * aparecerem com o mesmo peso dos aferidos.
 *
 * Por que ir até o DOM, e não parar na lógica: `pontoAferido` decidir certo não
 * garante marca na tela. Entre a decisão e o usuário estão a classe do CSS, a
 * célula escolhida e a tabela escolhida, e errar qualquer uma delas falha em
 * silêncio — a marca não aparece, ou aparece sem estilo. Nada estoura, e nenhum
 * teste de lógica acusa.
 *
 * O caso que governa estes testes é `Duto P01`: está na área
 * `Main Vent Sys`, que tem modelo validado, mas foi previsto pelo modelo de
 * `AC Blower Inlet`, que não tem — e, por não ter limite declarado, cai na
 * tabela de monitoramento, que é outra. Quem casasse ponto e modelo por
 * `Key_Area`, ou só marcasse a tabela principal, passaria nos testes de lógica
 * e deixaria esse ponto sem marca na tela.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var D = require("./dom_duble.js");

var JS = path.join(__dirname, "..", "js");
var CSS = path.join(__dirname, "..", "css");

// ------------------------------------------------------------------- payloads

function ponto(nome, area, subsistemaModelo, estado, margem) {
  return {
    measurement_id: nome + " | " + area,
    TC_Name: nome,
    Key_Area: area,
    subsistema_modelo: subsistemaModelo,
    temperatura_prevista_c: 100.0,
    limit_c: 150.0,
    is_monitor_only: false,
    margem_c: margem,
    margem_percentual: margem === null ? null : margem / 150.0,
    estado: estado,
    estado_rotulo: estado
  };
}

function modelo(subsistema, validado, termopares) {
  return {
    subsistema: subsistema,
    familia: "modelo_final",
    algoritmo: "Média RF e GB adotada",
    versao: "final-1.0",
    validado: validado,
    termopares: termopares
  };
}

/* Resposta no formato de `POST /predicao`, com o recorte que importa aqui. */
function resposta() {
  return {
    versao_modelo: "final-1.0",
    preditor_e_stub: false,
    configuracao: {
      blower_direction: "To Front", housing: "Closed", board_position: "Center",
      run_case: "Broil C2", deflector_hole: "Closed", material_coil_support: "Aluminium",
      losses: { present: "declared", config: "Config S" }
    },
    tolerancia_fracao: 0.1,
    total_pontos: 3,
    total_classificados: 2,
    total_monitoramento: 1,
    pontos: [
      ponto("Mainback P09", "Mainback", "Mainback", "acima_do_limite", -12.5),
      ponto("Top Duct Outlet", "Main Vent Sys", "Main Vent Sys", "dentro_do_limite", 40.0)
    ],
    monitoramento: [
      Object.assign(
        ponto("Duto P01", "Main Vent Sys", "AC Blower Inlet", "monitoramento", null),
        { limit_c: null, is_monitor_only: true, margem_percentual: null }
      )
    ],
    modelos: [
      modelo("Mainback", true, 11),
      modelo("Main Vent Sys", true, 5),
      modelo("AC Blower Inlet", false, 2)
    ]
  };
}

/* O dado de demonstração não sai de modelo nenhum: sem bloco `modelos` e sem
   `subsistema_modelo` nos pontos. Nada pode ser marcado a partir dele. */
function stub() {
  var r = resposta();

  delete r.modelos;
  r.preditor_e_stub = true;
  r.versao_modelo = "stub";
  r.pontos.concat(r.monitoramento).forEach(function (p) { delete p.subsistema_modelo; });

  return r;
}

// --------------------------------------------------- 1. o construtor da marca

function carregarPrevisaoSessao() {
  var ctx = vm.createContext({ window: {}, module: { exports: {} } });

  vm.runInContext(
    fs.readFileSync(path.join(JS, "previsao_sessao.js"), "utf8"), ctx,
    { filename: "previsao_sessao.js" }
  );

  return vm.runInContext("PREVISAO_SESSAO", ctx);
}

var PS = carregarPrevisaoSessao();

test("marcaDeModelo devolve null no ponto de modelo validado", function () {
  var r = resposta();
  assert.equal(PS.marcaDeModelo(D.criarDocumento(), r, r.pontos[0]), null);
});

test("marcaDeModelo monta a marca no ponto de modelo não validado", function () {
  var r = resposta();
  var marca = PS.marcaDeModelo(D.criarDocumento(), r, r.monitoramento[0]);

  assert.ok(marca, "o ponto previsto pelo AC Blower Inlet deveria ser marcado");
  assert.equal(marca.tagName, "span");
  assert.equal(marca.className, PS.CLASSE_MARCA);
  assert.equal(marca.textContent, PS.TEXTO_MARCA);
});

test("o título da marca nomeia o modelo, não a área do ponto", function () {
  var r = resposta();
  var marca = PS.marcaDeModelo(D.criarDocumento(), r, r.monitoramento[0]);

  assert.match(marca.title, /AC Blower Inlet/);
  assert.doesNotMatch(marca.title, /Main Vent Sys/);
  assert.match(marca.title, /não sustenta aprovação/);
});

test("marcaDeModelo não marca nada a partir do dado de demonstração", function () {
  var s = stub();

  assert.equal(PS.marcaDeModelo(D.criarDocumento(), s, s.monitoramento[0]), null);
  assert.equal(PS.marcaDeModelo(D.criarDocumento(), s, s.pontos[0]), null);
});

test("marcaDeModelo tolera ponto e documento ausentes", function () {
  var r = resposta();

  assert.equal(PS.marcaDeModelo(D.criarDocumento(), r, null), null);
  assert.equal(PS.marcaDeModelo(null, r, r.monitoramento[0]), null);
});

test("marcaDeSubsistemas nomeia os modelos e some com lista vazia", function () {
  var doc = D.criarDocumento();

  assert.equal(PS.marcaDeSubsistemas(doc, []), null);
  assert.equal(PS.marcaDeSubsistemas(doc, undefined), null);

  var marca = PS.marcaDeSubsistemas(doc, ["AC Blower Inlet"]);

  assert.equal(marca.className, PS.CLASSE_MARCA);
  assert.match(marca.title, /AC Blower Inlet/);
  assert.match(marca.title, /mais de um modelo/);
});

// ------------------------------------------- 2. a classe existe de verdade

test("a classe da marca está definida em css/triagem.css", function () {
  var folha = fs.readFileSync(path.join(CSS, "triagem.css"), "utf8");

  assert.match(
    folha, new RegExp("\\." + PS.CLASSE_MARCA + "\\s*(,|\\{)"),
    "sem a regra no CSS a marca aparece sem estilo nenhum, e ninguém nota"
  );
});

test("as telas não repetem a classe por conta própria", function () {
  ["triagem.js", "conformidade.js"].forEach(function (arquivo) {
    var fonte = fs.readFileSync(path.join(JS, arquivo), "utf8");

    assert.doesNotMatch(
      fonte, new RegExp('"' + PS.CLASSE_MARCA + '"'),
      arquivo + " tem a classe escrita à mão; duas cópias é como elas divergem"
    );
  });
});

// ------------------------------------------ 3. a marca chega ao DOM das telas

/* Carrega uma tela inteira sobre o DOM dublê, na mesma ordem de scripts do
   HTML, e devolve o documento que ela montou. `LP.fonte()` devolve
   `DADOS_TRIAGEM`, que o teste troca pela resposta em exame. */
function renderizar(modulos, tela, dados, extras) {
  var doc = D.criarDocumento();
  var janela = D.criarJanela(doc, "");

  Object.keys(extras || {}).forEach(function (chave) { janela[chave] = extras[chave]; });

  var ctx = vm.createContext(janela);

  vm.runInContext("var document = window.document;", ctx);
  vm.runInContext("var DADOS_TRIAGEM = " + JSON.stringify(dados) + ";", ctx);

  modulos.concat([tela]).forEach(function (arquivo) {
    vm.runInContext(
      fs.readFileSync(path.join(JS, arquivo), "utf8"), ctx, { filename: arquivo }
    );
  });

  return doc;
}

var MODULOS_CONFORMIDADE = [
  "schema.js", "dados_comparacao.js", "planilha.js", "leitura_publicos.js",
  "previsao_sessao.js"
];

function renderizarConformidade(dados) {
  return renderizar(MODULOS_CONFORMIDADE, "conformidade.js", dados);
}

var MODULOS_TRIAGEM = [
  "tema.js", "schema.js", "previsao_sessao.js", "dados_comparacao.js", "fogao.js",
  "painel_peca.js", "tour.js", "confianca.js", "grafico.js", "leitura_publicos.js",
  "resumo_executivo.js", "modo_leitura.js", "planilha.js", "documento_pdf.js",
  "registro_pdf.js", "historico_sessao.js"
];

/* O 3D é a única parte da triagem que o dublê não alcança: depende de WebGL,
   por `vendor/three.min.js`. Um dublê que aceita qualquer chamada deixa a carga
   terminar sem mascarar nada das tabelas, que é o que está em exame. */
function fogao3dDuble() {
  var nada = function () { return nada; };

  var api = new Proxy({}, {
    get: function () { return nada; },
    set: function () { return true; }
  });

  return { criar: function () { return api; } };
}

function renderizarTriagem(dados) {
  return renderizar(MODULOS_TRIAGEM, "triagem.js", dados, { FOGAO3D: fogao3dDuble() });
}

function linhasMarcadas(doc, id) {
  return doc.getElementById(id).children.filter(function (tr) {
    return D.comClasse(tr, PS.CLASSE_MARCA).length > 0;
  });
}

test("triagem: o ponto de modelo não validado vem marcado na tabela de monitoramento",
  function () {
    var doc = renderizarTriagem(resposta());
    var marcadas = linhasMarcadas(doc, "monitoring-body");

    assert.equal(marcadas.length, 1, "o ponto previsto pelo AC Blower Inlet ficou sem marca");
    assert.match(marcadas[0].textContent, /Duto P01/);
    assert.match(marcadas[0].textContent, new RegExp(PS.TEXTO_MARCA));
  });

test("triagem: nenhum ponto de modelo validado é marcado na tabela principal", function () {
  var doc = renderizarTriagem(resposta());

  assert.equal(doc.getElementById("screening-body").children.length, 2);
  assert.equal(linhasMarcadas(doc, "screening-body").length, 0);
});

test("triagem: com o dado de demonstração nenhuma linha é marcada", function () {
  var doc = renderizarTriagem(stub());

  ["screening-body", "monitoring-body"].forEach(function (id) {
    assert.equal(
      linhasMarcadas(doc, id).length, 0,
      id + " marcou linha sem ter bloco de modelos para sustentar a marca"
    );
  });
});

test("conformidade: a área que reúne modelo não validado vem marcada", function () {
  var doc = renderizarConformidade(resposta());
  var marcadas = linhasMarcadas(doc, "subsistemas-body");

  assert.equal(marcadas.length, 1, "só Main Vent Sys reúne ponto de modelo não validado");
  assert.match(marcadas[0].textContent, /Main Vent Sys/);
  assert.match(marcadas[0].textContent, new RegExp(PS.TEXTO_MARCA));
  assert.match(D.comClasse(marcadas[0], PS.CLASSE_MARCA)[0].title, /AC Blower Inlet/);
});

test("conformidade: a marca de área não aparece onde todo modelo é validado", function () {
  var doc = renderizarConformidade(resposta());
  var linhas = doc.getElementById("subsistemas-body").children;

  var mainback = linhas.filter(function (tr) {
    return /Mainback/.test(tr.textContent);
  })[0];

  assert.ok(mainback, "a linha de Mainback deveria existir");
  assert.equal(D.comClasse(mainback, PS.CLASSE_MARCA).length, 0);
});

test("conformidade: com o dado de demonstração nenhuma marca é montada", function () {
  var doc = renderizarConformidade(stub());

  ["reprovados-body", "subsistemas-body"].forEach(function (id) {
    assert.equal(
      D.comClasse(doc.getElementById(id), PS.CLASSE_MARCA).length, 0,
      id + " marcou ponto sem ter bloco de modelos para sustentar a marca"
    );
  });
});

test("conformidade: a tela chega ao fim e habilita a exportação", function () {
  var doc = renderizarConformidade(resposta());

  // Último passo de `ligarExportacao`: se a montagem tivesse quebrado antes, o
  // botão continuaria desabilitado e as asserções acima seriam vácuas.
  assert.equal(doc.getElementById("export-csv").disabled, false);
});
