/* Testes do tour pelos pontos críticos: lista de paradas e controle.
 *
 * Rodar da raiz do repositório:  node --test dashboard/testes/tour.test.js
 *
 * Duas configurações: a da triagem (muitas paradas) e uma de poucos pontos
 * críticos, montada à mão com o estado já rotulado, como o dado chega.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var caminho = require("./apoio/fonte_painel.js").caminho;
var ctx = vm.createContext({ window: {}, setTimeout: setTimeout, clearTimeout: clearTimeout });
["dados_triagem.js", "tour.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(caminho(f), "utf8"), ctx, { filename: f });
});
var DADOS = vm.runInContext("DADOS_TRIAGEM", ctx);
var TOUR = vm.runInContext("TOUR", ctx);

var ROTULO = { acima_do_limite: "Acima do limite", banda_de_incerteza: "Banda de incerteza", dentro_do_limite: "Dentro do limite" };

function ponto(nome, estado, pct, margem) {
  return { measurement_id: nome + " | X", TC_Name: nome, Key_Area: "X", temperatura_prevista_c: 100,
    limit_c: 100, is_monitor_only: false, margem_c: margem, margem_percentual: pct,
    estado: estado, estado_rotulo: ROTULO[estado] };
}

// Poucos críticos: um acima, um na banda, o resto dentro. Fora de ordem de propósito.
var POUCOS = {
  pontos: [
    ponto("Dentro A", "dentro_do_limite", 0.35, 30),
    ponto("Banda B", "banda_de_incerteza", 0.06, 5),
    ponto("Dentro C", "dentro_do_limite", 0.2, 18),
    ponto("Acima D", "acima_do_limite", -0.04, -3)
  ],
  monitoramento: []
};

var NENHUM = {
  pontos: [ponto("Dentro A", "dentro_do_limite", 0.35, 30), ponto("Dentro C", "dentro_do_limite", 0.2, 18)],
  monitoramento: []
};

// Array.from: o array vem do contexto do vm, e deepEqual compara protótipos.
function nomes(lista) { return Array.from(lista, function (p) { return p.TC_Name; }); }

// Relógio manual: avançar é disparar o que estiver agendado.
function relogioManual() {
  var fila = [];
  return {
    depois: function (f) { fila.push(f); return f; },
    cancelar: function (f) { var i = fila.indexOf(f); if (i >= 0) fila.splice(i, 1); },
    tique: function () { var f = fila.shift(); if (f) f(); },
    pendentes: function () { return fila.length; }
  };
}

function checarOrdem(lista) {
  var visto = false;
  lista.forEach(function (p, k) {
    assert.ok(p.estado === "acima_do_limite" || p.estado === "banda_de_incerteza", p.TC_Name + " não é crítico");
    if (p.estado === "banda_de_incerteza") visto = true;
    else assert.ok(!visto, "acima do limite depois de banda: " + p.TC_Name);
    var ant = lista[k - 1];
    if (ant && ant.estado === p.estado) {
      assert.ok(ant.margem_percentual <= p.margem_percentual,
        ant.TC_Name + " (" + ant.margem_percentual + ") antes de " + p.TC_Name + " (" + p.margem_percentual + ")");
    }
  });
}

test("configuração da triagem: todas as paradas e só elas, na ordem de severidade", function () {
  var lista = TOUR.paradas(DADOS);
  var criticos = DADOS.pontos.filter(function (p) { return p.estado !== "dentro_do_limite"; });
  assert.ok(lista.length >= 10, "esperava muitas paradas, veio " + lista.length);
  assert.equal(lista.length, criticos.length);
  checarOrdem(lista);
  // Monitorados não têm estado de risco (RN-03) e nunca viram parada.
  DADOS.monitoramento.forEach(function (m) { assert.ok(lista.indexOf(m) < 0); });
});

test("ordena pelo % sobre o limite, não pela folga em °C nem pela ordem de chegada", function () {
  var lista = TOUR.paradas(DADOS);
  // Na tabela IPC P03 (−28%) vem depois de Suporte FL (−24%), que tem folga em °C pior.
  var i = nomes(lista);
  assert.ok(i.indexOf("IPC P03") < i.indexOf("Suporte FL"));
  assert.equal(lista[0].TC_Name, "Mainback P09");
});

test("configuração com poucos críticos: acima antes de banda, dentro fica de fora", function () {
  assert.deepEqual(nomes(TOUR.paradas(POUCOS)), ["Acima D", "Banda B"]);
});

test("não altera o dado nem recalcula estado", function () {
  var antes = JSON.stringify(DADOS);
  var lista = TOUR.paradas(DADOS);
  assert.equal(JSON.stringify(DADOS), antes);
  lista.forEach(function (p) { assert.ok(DADOS.pontos.indexOf(p) >= 0, "parada não é o objeto do dado"); });
});

test("sem ponto crítico o tour não começa", function () {
  var lista = TOUR.paradas(NENHUM);
  assert.equal(lista.length, 0);
  var paradas = 0;
  var t = TOUR.criar(lista, { aoParar: function () { paradas += 1; }, relogio: relogioManual() });
  assert.equal(t.iniciar(), false);
  assert.equal(t.estado().ativo, false);
  assert.equal(paradas, 0);
});

[["triagem", DADOS], ["poucos", POUCOS]].forEach(function (caso) {
  test("controles percorrem todas as paradas (" + caso[0] + ")", function () {
    var lista = TOUR.paradas(caso[1]);
    var r = relogioManual(), visitas = [], encerrou = 0;
    var t = TOUR.criar(lista, {
      relogio: r,
      aoParar: function (p, i, n) { visitas.push(i); assert.equal(n, lista.length); },
      aoEncerrar: function () { encerrou += 1; }
    });

    assert.equal(t.iniciar(), true);
    assert.equal(t.estado().i, 0);
    assert.equal(t.estado().tocando, true);

    // Avanço automático até a última parada, onde para sem dar a volta.
    for (var k = 1; k < lista.length; k++) r.tique();
    assert.deepEqual(visitas, Array.from(lista, function (_, i) { return i; }));
    assert.equal(t.estado().fim, true);
    assert.equal(t.estado().tocando, false);
    assert.equal(r.pendentes(), 0);

    // Navegação manual nos dois sentidos, presa às pontas.
    t.anterior();
    assert.equal(t.estado().i, Math.max(0, lista.length - 2));
    t.proximo(); t.proximo();
    assert.equal(t.estado().i, lista.length - 1);

    // Recomeçar na última volta ao início.
    t.retomar();
    assert.equal(t.estado().i, 0);

    t.encerrar();
    assert.equal(t.estado().ativo, false);
    assert.equal(encerrou, 1);
    assert.equal(r.pendentes(), 0);
  });
});

test("pausar congela o avanço; próximo e anterior seguem valendo", function () {
  var lista = TOUR.paradas(DADOS);
  var r = relogioManual();
  var t = TOUR.criar(lista, { relogio: r });
  t.iniciar();
  t.pausar();
  assert.equal(r.pendentes(), 0);
  r.tique();
  assert.equal(t.estado().i, 0);
  t.proximo();
  assert.equal(t.estado().i, 1);
  assert.equal(t.estado().tocando, false);
  t.anterior();
  assert.equal(t.estado().i, 0);
  t.retomar();
  assert.equal(r.pendentes(), 1);
  r.tique();
  assert.equal(t.estado().i, 1);
});

test("encerrar a qualquer momento cancela o avanço agendado", function () {
  var r = relogioManual(), paradas = 0;
  var t = TOUR.criar(TOUR.paradas(DADOS), { relogio: r, aoParar: function () { paradas += 1; } });
  t.iniciar();
  t.encerrar();
  r.tique();
  assert.equal(paradas, 1);
  t.proximo();
  assert.equal(paradas, 1);
});
