/* Testes do stub de confiança da previsão.
 *
 * Rodar da raiz do repositório:  node --test dashboard/testes/confianca.test.js
 *
 * Sem DOM: confianca.js não desenha. O que se verifica é o contrato que o
 * cartão e o halo consomem, e que o stub não encosta no estado de risco.
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
  ["dados_triagem.js", "confianca.js"].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
  });
  return { DADOS: vm.runInContext("DADOS_TRIAGEM", ctx), CONFIANCA: vm.runInContext("CONFIANCA", ctx) };
}

var M = carregar();
var TODOS = M.DADOS.pontos.concat(M.DADOS.monitoramento);

test("todo ponto recebe o contrato completo, congelado e marcado como stub", function () {
  assert.equal(TODOS.length, 78);
  TODOS.forEach(function (p) {
    var c = M.CONFIANCA.doPonto(p);
    assert.deepEqual(Object.keys(c).sort(), ["ilustrativo", "incerteza", "nivel", "origem", "rotulo", "valor"]);
    assert.ok(M.CONFIANCA.ORDEM.indexOf(c.nivel) >= 0, p.measurement_id);
    assert.equal(c.rotulo, M.CONFIANCA.NIVEIS[c.nivel].rotulo);
    assert.ok(c.valor >= 0 && c.valor <= 1);
    assert.ok(Math.abs(c.incerteza - (1 - c.valor)) < 1e-12);
    assert.equal(c.origem, "stub");
    assert.equal(c.ilustrativo, true, "stub nunca pode sair sem o aviso de ilustrativo");
    assert.ok(Object.isFrozen(c));
  });
});

test("o nível é estável: mesmo ponto, mesmo valor, entre cargas do script", function () {
  var outra = carregar();
  TODOS.forEach(function (p) {
    // JSON: cada contexto vm tem o próprio Object.prototype, e deepEqual estrito compara protótipos.
    assert.equal(JSON.stringify(M.CONFIANCA.doPonto(p)), JSON.stringify(outra.CONFIANCA.doPonto(p)));
  });
});

test("os três níveis aparecem no conjunto, com valores distintos", function () {
  var vistos = {};
  TODOS.forEach(function (p) { vistos[M.CONFIANCA.doPonto(p).nivel] = true; });
  assert.deepEqual(Object.keys(vistos).sort(), ["alta", "baixa", "media"]);
  var valores = M.CONFIANCA.ORDEM.map(function (n) { return M.CONFIANCA.NIVEIS[n].valor; });
  assert.ok(valores[0] > valores[1] && valores[1] > valores[2], "alta > média > baixa");
});

test("o stub lê só o id: estado, temperatura e folga não mudam o nível", function () {
  TODOS.forEach(function (p) {
    var disfarce = { measurement_id: p.measurement_id, estado: "acima_do_limite", temperatura_prevista_c: 999, margem_c: -999, margem_percentual: -9, limit_c: 1 };
    assert.deepEqual(M.CONFIANCA.doPonto(disfarce), M.CONFIANCA.doPonto(p), p.measurement_id);
  });
});

test("consultar a confiança não altera o dado nem o estado de risco", function () {
  var antes = JSON.stringify(M.DADOS);
  // Congela cada ponto: em modo estrito, qualquer escrita do stub lançaria.
  TODOS.forEach(function (p) { Object.freeze(p); });
  TODOS.forEach(function (p) { M.CONFIANCA.doPonto(p); });
  assert.equal(JSON.stringify(M.DADOS), antes);
});

test("raio do halo cresce com a incerteza e parte de fora do anel de seleção", function () {
  var raios = M.CONFIANCA.ORDEM.map(function (n) {
    return M.CONFIANCA.raioHalo({ incerteza: 1 - M.CONFIANCA.NIVEIS[n].valor });
  });
  assert.ok(raios[0] < raios[1] && raios[1] < raios[2], "alta < média < baixa: " + raios);
  // Anel de seleção do 3D vai até 1,95 unidades de marcador.
  assert.ok(M.CONFIANCA.raioHalo({ incerteza: 0 }) > 1.95);
  // Proporcional: incremento de raio igual a incremento de incerteza vezes a mesma constante.
  var a = M.CONFIANCA.raioHalo({ incerteza: 0.2 }), b = M.CONFIANCA.raioHalo({ incerteza: 0.4 }), c = M.CONFIANCA.raioHalo({ incerteza: 0.6 });
  assert.ok(Math.abs((b - a) - (c - b)) < 1e-12);
  // Fora de [0, 1] não explode o desenho.
  assert.equal(M.CONFIANCA.raioHalo({ incerteza: 5 }), M.CONFIANCA.raioHalo({ incerteza: 1 }));
  assert.equal(M.CONFIANCA.raioHalo({ incerteza: -1 }), M.CONFIANCA.raioHalo({ incerteza: 0 }));
});
