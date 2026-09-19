/* Testes da camada de tradução das áreas por público.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/leitura_publicos.test.js
 *
 * Sem DOM: leitura_publicos.js não desenha. O que se verifica é que o recorte
 * e a tradução preservam RN-01, RN-02, RN-03 e RN-07, e que nenhuma tela
 * precisará recalcular estado para montar a sua leitura.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var JS = path.join(__dirname, "..", "js");

function carregar() {
  var ctx = vm.createContext({ window: {} });
  ["dados_triagem.js", "dados_comparacao.js", "leitura_publicos.js"].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
  });
  return {
    DADOS: vm.runInContext("DADOS_TRIAGEM", ctx),
    CATALOGO: vm.runInContext("DADOS_COMPARACAO", ctx),
    LP: vm.runInContext("LEITURA_PUBLICOS", ctx)
  };
}

var M = carregar();
var LP = M.LP;
var TODOS = LP.todosOsPontos(M.DADOS);

test("a fonte entrega os 78 pontos da triagem, sem perder nem duplicar", function () {
  // Ponto único de substituição: hoje é o global de dados_triagem.js.
  assert.equal(LP.fonte(), M.DADOS);
  assert.equal(TODOS.length, M.DADOS.total_pontos);
  assert.equal(M.DADOS.pontos.length, M.DADOS.total_classificados);
  assert.equal(M.DADOS.monitoramento.length, M.DADOS.total_monitoramento);
});

test("reprovados traz só o que trava decisão, da folga mais apertada para a menos", function () {
  var lista = LP.reprovados(TODOS);
  var esperado = TODOS.filter(function (p) {
    return p.estado === "acima_do_limite" || p.estado === "banda_de_incerteza";
  }).length;

  assert.equal(lista.length, esperado);
  assert.ok(lista.length > 0, "a base sintética precisa ter ponto crítico para o teste valer");

  lista.forEach(function (p) {
    assert.notEqual(p.estado, "dentro_do_limite");
    assert.notEqual(p.estado, "monitoramento");
  });

  // Acima do limite vem antes da banda, e dentro de cada bloco a folga cresce.
  var indice = lista.map(function (p) { return LP.ORDEM_ESTADOS.indexOf(p.estado); });
  for (var i = 1; i < lista.length; i++) {
    assert.ok(indice[i] >= indice[i - 1], "a ordem por gravidade quebrou em " + i);
    if (indice[i] === indice[i - 1]) {
      assert.ok(lista[i].margem_c >= lista[i - 1].margem_c, "a ordem por folga quebrou em " + i);
    }
  }
});

test("RN-02: o subsistema herda o pior estado, nunca a média nem a contagem", function () {
  var um = { Key_Area: "X", estado: "acima_do_limite", margem_c: -40 };
  var muitos = [];
  for (var i = 0; i < 20; i++) muitos.push({ Key_Area: "X", estado: "dentro_do_limite", margem_c: 50 });

  assert.equal(LP.severidade(muitos.concat([um])), "acima_do_limite");
  assert.equal(LP.severidade(muitos), "dentro_do_limite");

  // Grupo só de monitorados não inventa estado de risco (RN-03).
  assert.equal(LP.severidade([{ Key_Area: "X", estado: "monitoramento", margem_c: null }]), "monitoramento");
  assert.equal(LP.severidade([]), null);
});

test("porSubsistema cobre os sete subsistemas sem perder ponto", function () {
  var resumo = LP.porSubsistema(TODOS);
  var soma = 0;

  assert.equal(resumo.length, 7);
  resumo.forEach(function (r) {
    soma += r.total;

    var contados = LP.ORDEM_ESTADOS.reduce(function (acc, e) { return acc + r.contagem[e]; }, 0);
    assert.equal(contados, r.total, r.area);
    assert.equal(r.total_avaliados, r.total - r.contagem.monitoramento, r.area);

    // O componente que sustenta a severidade acompanha o resumo.
    if (r.total_avaliados > 0) {
      assert.equal(r.pior_ponto.estado, r.estado, r.area);
      assert.equal(r.pior_margem_c, r.pior_ponto.margem_c, r.area);
    } else {
      assert.equal(r.pior_ponto, null, r.area);
    }
  });

  assert.equal(soma, TODOS.length);

  // Do mais grave para o menos, como a tabela da triagem.
  for (var i = 1; i < resumo.length; i++) {
    var anterior = LP.ORDEM_ESTADOS.indexOf(resumo[i - 1].estado);
    assert.ok(LP.ORDEM_ESTADOS.indexOf(resumo[i].estado) >= anterior, "ordem quebrou em " + resumo[i].area);
  }
});

test("RN-03: ponto sem limite declarado não recebe estado de risco em recorte nenhum", function () {
  var monitorados = TODOS.filter(function (p) { return p.estado === "monitoramento"; });

  assert.equal(monitorados.length, M.DADOS.total_monitoramento);
  monitorados.forEach(function (p) {
    assert.equal(p.limit_c, null, p.measurement_id);
    assert.equal(p.margem_c, null, p.measurement_id);
  });

  LP.reprovados(TODOS).forEach(function (p) { assert.notEqual(p.estado, "monitoramento"); });
});

test("pecasDeContato fica nos subsistemas que a pessoa toca", function () {
  var pecas = LP.pecasDeContato(TODOS);
  var esperado = TODOS.filter(function (p) {
    return LP.AREAS_DE_CONTATO.indexOf(p.Key_Area) >= 0;
  }).length;

  assert.equal(pecas.length, esperado);
  assert.ok(pecas.length > 0, "manípulos e console precisam existir na base");
  pecas.forEach(function (p) {
    assert.ok(LP.AREAS_DE_CONTATO.indexOf(p.Key_Area) >= 0, p.measurement_id);
  });
});

test("RNF-07: os três públicos têm rótulo próprio para os quatro estados", function () {
  LP.PUBLICOS.forEach(function (publico) {
    LP.ORDEM_ESTADOS.forEach(function (estado) {
      var rotulo = LP.traduzirEstado(estado, publico);

      assert.ok(rotulo && rotulo !== "—", publico + " / " + estado);
      assert.notEqual(rotulo, LP.ROTULO_CANONICO[estado],
        publico + " caiu no rótulo canônico em " + estado + ": falta mapeamento");
    });
  });

  // Público desconhecido não quebra a tela: cai no rótulo da triagem.
  assert.equal(LP.traduzirEstado("acima_do_limite", "inexistente"), LP.ROTULO_CANONICO.acima_do_limite);
  assert.equal(LP.traduzirEstado("inventado", "design"), "—");
});

test("RN-07: nenhum estado é apresentado como aprovação", function () {
  LP.PUBLICOS.forEach(function (publico) {
    LP.ORDEM_ESTADOS.forEach(function (estado) {
      var rotulo = LP.traduzirEstado(estado, publico).toLowerCase();
      assert.ok(rotulo.indexOf("aprovad") < 0, publico + " / " + estado + ": " + rotulo);
      assert.ok(rotulo.indexOf("conforme") < 0, publico + " / " + estado + ": " + rotulo);
    });
  });
});

test("RN-05: a consulta é localizada no histórico pelos seis fatores categóricos", function () {
  var mat = LP.maturidade(M.DADOS, M.CATALOGO);
  var chaves = ["blower_direction", "housing", "board_position", "run_case", "deflector_hole", "material_coil_support"];

  var compativeis = M.CATALOGO.configuracoes.filter(function (c) {
    return chaves.every(function (k) { return c.fatores[k] === M.DADOS.configuracao[k]; });
  }).map(function (c) { return c.id; });

  assert.equal(mat.no_historico, true);
  assert.ok(compativeis.indexOf(mat.configuracao_id) >= 0, mat.configuracao_id);
  assert.ok(compativeis.indexOf(M.CATALOGO.config_referencia_triagem) >= 0,
    "a configuração exibida na triagem tem de estar entre as compatíveis");
  assert.ok(mat.rodadas > 0);

  // Data-base do treino não existe até haver modelo: a tela mostra o traço.
  assert.equal(mat.data_base_treino, null);
  assert.equal(mat.ilustrativo, true);
  assert.equal(mat.versao_modelo, "stub");
});

test("configuração fora do vocabulário da base é sinalizada como nova", function () {
  var inventada = { configuracao: { blower_direction: "To Front", housing: "Closed", board_position: "Center", run_case: "Broil C1", deflector_hole: "Open", material_coil_support: "Plastic" } };
  var mat = LP.maturidade(inventada, { configuracoes: [] });

  assert.equal(mat.no_historico, false);
  assert.equal(mat.configuracao_id, null);
  assert.equal(mat.rodadas, 0);
});

test("RF-22: o CSV sai rotulado como registro de trabalho e nega ser evidência", function () {
  var colunas = [
    { titulo: "Componente", valor: function (p) { return p.TC_Name; } },
    { titulo: "Folga (°C)", valor: function (p) { return LP.numero(p.margem_c); } }
  ];
  var mat = LP.maturidade(M.DADOS, M.CATALOGO);
  var csv = LP.paraCsv(LP.reprovados(TODOS), colunas, LP.preambuloDeRegistro(mat));
  var linhas = csv.split("\r\n");
  var preambulo = linhas.filter(function (l) { return l.indexOf("# ") === 0; });

  assert.ok(preambulo.length >= 3);
  assert.ok(csv.indexOf("registro de trabalho") > 0);
  assert.ok(csv.indexOf("RF-16") > 0, "o aviso de que não é evidência formal tem de viajar com o arquivo");
  assert.ok(csv.indexOf("RF-15") > 0, "o aviso de triagem tem de viajar com o arquivo");

  // Cabeçalho logo após o preâmbulo, depois uma linha por ponto exportado.
  assert.equal(linhas[preambulo.length], "Componente;Folga (°C)");
  assert.equal(linhas.length, preambulo.length + 1 + LP.reprovados(TODOS).length + 1);
});

test("o CSV escapa separador, aspas e quebra de linha", function () {
  var colunas = [{ titulo: "t", valor: function (l) { return l.v; } }];
  var csv = LP.paraCsv([{ v: 'IPC; "A"' }, { v: "linha\nquebrada" }], colunas, []);

  assert.ok(csv.indexOf('"IPC; ""A"""') > 0, csv);
  assert.ok(csv.indexOf('"linha\nquebrada"') > 0, csv);
  assert.equal(LP.numero(-89.671), "-89,67");
  assert.equal(LP.numero(null), "");
});

test("ler para um público não altera o dado nem o estado de risco", function () {
  var antes = JSON.stringify(M.DADOS);

  TODOS.forEach(function (p) { Object.freeze(p); });
  LP.reprovados(TODOS);
  LP.porSubsistema(TODOS);
  LP.pecasDeContato(TODOS);
  LP.ordenarPorRisco(TODOS);

  assert.equal(JSON.stringify(M.DADOS), antes);
});
