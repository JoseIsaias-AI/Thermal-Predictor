/* Testes da confiança da previsão, calculada pelo MAE de teste da área.
 *
 * Rodar da raiz do repositório:  node --test dashboard/testes/confianca.test.js
 *
 * Sem DOM: confianca.js não desenha. O que se verifica é a regra — faixa
 * provável = previsto ± MAE; nível alto com |folga| ≥ 2 MAE, médio com ≥ 1 MAE,
 * baixo abaixo disso —, o caso do subsistema sem modelo validado e que a
 * confiança não encosta no estado de risco.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var caminho = require("./apoio/fonte_painel.js").caminho;

/* `GET /modelos` falso, no formato da API: métricas de teste por subsistema, e
   `AC Blower Inlet` sem modelo validado e sem métrica, como no modelo final. */
var MODELOS = {
  modelos: [
    { subsistema: "Mainback", validado: true, metricas: { mae_c: 6, rmse_c: 12, r2: 0.9 } },
    { subsistema: "Coil Temps", validado: true, metricas: { mae_c: 7, rmse_c: 10, r2: 0.95 } },
    { subsistema: "IPC Comp", validado: true, metricas: { mae_c: 14, rmse_c: 18, r2: -0.4 } },
    { subsistema: "IPC Cooling", validado: true, metricas: { mae_c: 9.7, rmse_c: 17, r2: -0.1 } },
    { subsistema: "Main Vent Sys", validado: true, metricas: { mae_c: 6.2, rmse_c: 10.5, r2: 0.8 } },
    { subsistema: "HMI / Knobs / Console", validado: true, metricas: { mae_c: 4.4, rmse_c: 7.9, r2: 0.1 } },
    { subsistema: "AC Blower Inlet", validado: false, metricas: null }
  ]
};

function carregar(janela) {
  var ctx = vm.createContext({ window: janela || {} });
  ["dados_triagem.js", "confianca.js"].forEach(function (f) {
    vm.runInContext(fs.readFileSync(caminho(f), "utf8"), ctx, { filename: f });
  });
  return { DADOS: vm.runInContext("DADOS_TRIAGEM", ctx), CONFIANCA: vm.runInContext("CONFIANCA", ctx) };
}

var M = carregar();
var C = M.CONFIANCA;
var TODOS = M.DADOS.pontos.concat(M.DADOS.monitoramento);

function ponto(folga, extra) {
  return Object.assign({
    measurement_id: "Mainback P02 | Mainback",
    Key_Area: "Mainback",
    subsistema_modelo: "Mainback",
    temperatura_prevista_c: 100,
    limit_c: 100 + folga,
    margem_c: folga,
    is_monitor_only: false,
    estado: "dentro_do_limite"
  }, extra || {});
}

test("faixa provável é o previsto mais e menos o MAE da área", function () {
  var c = C.doPonto(ponto(30), MODELOS);
  assert.equal(c.mae_c, 6);
  assert.deepEqual(Array.from(c.faixa_c), [94, 106]);
});

test("nível pela folga em MAE: alto a partir de 2, médio a partir de 1, baixo abaixo", function () {
  [[12, "alta"], [20, "alta"], [11.99, "media"], [6, "media"], [5.99, "baixa"], [0, "baixa"]].forEach(function (caso) {
    assert.equal(C.doPonto(ponto(caso[0]), MODELOS).nivel, caso[1], "folga " + caso[0]);
  });
});

test("a folga conta em módulo: acima do limite também pode ter confiança alta", function () {
  var c = C.doPonto(ponto(-30, { estado: "acima_do_limite" }), MODELOS);
  assert.equal(c.nivel, "alta");
  assert.equal(c.folga_em_mae, 5);
});

test("o MAE é o do modelo que previu o ponto, não o da área", function () {
  // Mesma área, modelos diferentes: o de Main Vent Sys e o de AC Blower Inlet.
  var doDuto = ponto(10, { Key_Area: "Main Vent Sys", subsistema_modelo: "Main Vent Sys" });
  var doInlet = ponto(10, { Key_Area: "Main Vent Sys", subsistema_modelo: "AC Blower Inlet" });
  assert.equal(C.doPonto(doDuto, MODELOS).mae_c, 6.2);
  assert.equal(C.doPonto(doInlet, MODELOS).nivel, "sem_modelo");
});

test("AC Blower Inlet aparece como sem modelo validado, sem faixa nem nível", function () {
  var inlet = TODOS.filter(function (p) { return p.subsistema_modelo === "AC Blower Inlet"; });
  assert.equal(inlet.length, 2);
  inlet.forEach(function (p) {
    var c = C.doPonto(p, MODELOS);
    assert.equal(c.nivel, "sem_modelo");
    assert.equal(c.rotulo, "Sem modelo validado");
    assert.equal(c.faixa_c, null);
    assert.equal(c.folga_em_mae, null);
  });
});

test("ponto sem limite declarado tem faixa, mas não tem nível", function () {
  var mono = ponto(0, { limit_c: null, margem_c: null, is_monitor_only: true, estado: "monitoramento" });
  var c = C.doPonto(mono, MODELOS);
  assert.equal(c.nivel, "sem_limite");
  assert.deepEqual(Array.from(c.faixa_c), [94, 106]);
  assert.equal(C.raioHalo(c), 0, "sem nível, sem halo");
});

test("sem as métricas do modelo, nenhum nível é inventado", function () {
  var c = C.doPonto(ponto(30));
  assert.equal(c.nivel, "desconhecida");
  assert.equal(c.faixa_c, null);
  assert.equal(C.raioHalo(c), 0);
});

test("lê as métricas que a sessão guardou em MODELOS_API", function () {
  var comSessao = carregar({ MODELOS_API: MODELOS }).CONFIANCA;
  assert.equal(comSessao.doPonto(ponto(30)).nivel, "alta");
});

test("todo ponto da resposta recebe o contrato completo e congelado", function () {
  TODOS.forEach(function (p) {
    var c = C.doPonto(p, MODELOS);
    assert.deepEqual(Object.keys(c).sort(), ["faixa_c", "folga_em_mae", "incerteza", "mae_c", "nivel", "rotulo"]);
    assert.equal(c.rotulo, C.NIVEIS[c.nivel].rotulo);
    assert.ok(Object.isFrozen(c));
  });
});

test("consultar a confiança não altera o dado nem o estado de risco", function () {
  var antes = JSON.stringify(M.DADOS);
  // Congela cada ponto: em modo estrito, qualquer escrita lançaria.
  TODOS.forEach(function (p) { Object.freeze(p); });
  TODOS.forEach(function (p) { C.doPonto(p, MODELOS); });
  assert.equal(JSON.stringify(M.DADOS), antes);
});

test("raio do halo cresce com a incerteza e parte de fora do anel de seleção", function () {
  var raios = C.ORDEM.map(function (n) { return C.raioHalo({ incerteza: C.NIVEIS[n].incerteza }); });
  assert.ok(raios[0] < raios[1] && raios[1] < raios[2], "alta < média < baixa: " + raios);
  // Anel de seleção do 3D vai até 1,95 unidades de marcador.
  assert.ok(raios[0] > 1.95);
  assert.ok(C.raioHalo({ incerteza: C.NIVEIS.sem_modelo.incerteza }) > raios[2], "sem modelo, o maior halo");
  // Proporcional: incremento de raio igual a incremento de incerteza vezes a mesma constante.
  var a = C.raioHalo({ incerteza: 0.2 }), b = C.raioHalo({ incerteza: 0.4 }), c = C.raioHalo({ incerteza: 0.6 });
  assert.ok(Math.abs((b - a) - (c - b)) < 1e-12);
  // Fora de [0, 1] não explode o desenho.
  assert.equal(C.raioHalo({ incerteza: 5 }), C.raioHalo({ incerteza: 1 }));
  assert.equal(C.raioHalo({ incerteza: -1 }), 0);
});

test("o módulo não traz texto de valor ilustrativo", function () {
  var fonte = fs.readFileSync(caminho("confianca.js"), "utf8");
  assert.doesNotMatch(fonte, /stub|ilustrativ|preliminar|sorteio/i);
});
