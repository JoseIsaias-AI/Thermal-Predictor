/* Testes da coreografia da passagem da consulta para a triagem.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/analise.test.js
 *
 * Sem DOM: o que se verifica é o relógio da coreografia, que é onde um erro
 * passaria despercebido no navegador — etapa que nunca aparece, barra que
 * anda para trás, contador que passa de 78.
 */

"use strict";

var test = require("node:test");
var caminho = require("./apoio/fonte_painel.js").caminho;
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");


var ANALISE = (function () {
  var ctx = vm.createContext({
    window: { matchMedia: function () { return { matches: false }; } },
    document: { getElementById: function () { return null; } },
    performance: { now: function () { return 0; } }
  });
  vm.runInContext(fs.readFileSync(caminho("analise.js"), "utf8"), ctx, { filename: "analise.js" });
  return vm.runInContext("ANALISE", ctx);
})();

test("as etapas cobrem a passagem inteira, sem buraco nem retrocesso", function () {
  var anterior = 0;

  ANALISE.ETAPAS.forEach(function (etapa, i) {
    assert.ok(etapa.ate > anterior, "etapa " + i + " não avança: " + etapa.ate);
    assert.ok(etapa.ate <= 1, "etapa " + i + " passa do fim: " + etapa.ate);
    assert.ok(etapa.texto && etapa.texto.length > 0, "etapa " + i + " sem texto");
    assert.ok(etapa.explode >= 0 && etapa.explode <= 1, "etapa " + i + " com explosão fora da faixa");
    anterior = etapa.ate;
  });

  assert.equal(anterior, 1, "a última etapa tem de fechar em 1");
});

test("toda etapa aparece em algum instante da passagem", function () {
  var vistas = {};

  // Amostra densa o bastante para nenhuma etapa curta escapar.
  for (var i = 0; i <= 1000; i++) {
    vistas[ANALISE.etapaEm(i / 1000).indice] = true;
  }

  assert.equal(Object.keys(vistas).length, ANALISE.ETAPAS.length,
    "etapa que nunca aparece na tela: " + JSON.stringify(Object.keys(vistas)));
});

test("a etapa avança junto com o relógio e nunca volta", function () {
  var anterior = -1;

  for (var i = 0; i <= 500; i++) {
    var atual = ANALISE.etapaEm(i / 500).indice;
    assert.ok(atual >= anterior, "a etapa voltou em " + (i / 500));
    anterior = atual;
  }

  assert.equal(ANALISE.etapaEm(0).indice, 0);
  assert.equal(ANALISE.etapaEm(1).indice, ANALISE.ETAPAS.length - 1);

  // Fração acima de 1 não quebra: cai na última etapa.
  assert.equal(ANALISE.etapaEm(1.4).indice, ANALISE.ETAPAS.length - 1);
});

test("o progresso dentro da etapa vai de 0 a 1 em cada uma", function () {
  ANALISE.ETAPAS.forEach(function (etapa, i) {
    var inicio = i === 0 ? 0 : ANALISE.ETAPAS[i - 1].ate;

    assert.equal(ANALISE.progressoNaEtapa(inicio, i), 0, "etapa " + i);
    assert.equal(ANALISE.progressoNaEtapa(etapa.ate, i), 1, "etapa " + i);

    var meio = ANALISE.progressoNaEtapa((inicio + etapa.ate) / 2, i);
    assert.ok(Math.abs(meio - 0.5) < 1e-9, "etapa " + i + " no meio: " + meio);

    // Fora dos limites da etapa, fica preso em 0 ou 1.
    assert.equal(ANALISE.progressoNaEtapa(inicio - 0.5, i), 0, "etapa " + i);
    assert.equal(ANALISE.progressoNaEtapa(etapa.ate + 0.5, i), 1, "etapa " + i);
  });
});

test("a suavização preserva as pontas e é monótona", function () {
  assert.equal(ANALISE.suavizar(0), 0);
  assert.equal(ANALISE.suavizar(1), 1);
  assert.ok(Math.abs(ANALISE.suavizar(0.5) - 0.5) < 1e-9);

  var anterior = -1;
  for (var i = 0; i <= 200; i++) {
    var v = ANALISE.suavizar(i / 200);
    assert.ok(v >= anterior, "a explosão voltou em " + (i / 200));
    assert.ok(v >= 0 && v <= 1, "explosão fora da faixa: " + v);
    anterior = v;
  }
});

test("o contador de pontos não passa do total nem fica negativo", function () {
  for (var i = 0; i <= 100; i++) {
    var lidos = ANALISE.pontosPercorridos(i / 100, 77);
    assert.ok(lidos >= 0 && lidos <= 77, lidos);
  }

  assert.equal(ANALISE.pontosPercorridos(1, 77), 77,
    "o total é o da resposta do modelo, os 77 pontos previstos");
  assert.equal(ANALISE.pontosPercorridos(1.5, 77), 77);
  assert.equal(ANALISE.pontosPercorridos(-1, 77), 0);
});

test("sem a resposta do modelo o contador espera em zero, sem total fixo", function () {
  [null, undefined, 0, -3, "77"].forEach(function (total) {
    assert.equal(ANALISE.pontosPercorridos(0.5, total), 0, String(total));
  });
  assert.equal(ANALISE.TOTAL_DE_PONTOS, undefined, "o total não pode ser constante do painel");
});

test("a passagem cabe em poucos segundos", function () {
  // A promessa da ferramenta é resposta em segundos; a animação não pode ser
  // o que estoura esse prazo.
  assert.ok(ANALISE.DURACAO <= 5000, ANALISE.DURACAO + " ms é tempo demais para uma passagem");
  assert.ok(ANALISE.DURACAO >= 2500, ANALISE.DURACAO + " ms é curto demais para a leitura das etapas");
});

test("exatamente uma etapa varre os pontos, e não é a primeira nem a última", function () {
  var varrendo = [];
  ANALISE.ETAPAS.forEach(function (etapa, i) { if (etapa.varrendo) varrendo.push(i); });

  assert.equal(varrendo.length, 1, "a varredura precisa de uma etapa só: " + varrendo);
  assert.ok(varrendo[0] > 0, "varrer antes de montar não faz sentido");
  assert.ok(varrendo[0] < ANALISE.ETAPAS.length - 1, "a varredura não pode ser a última etapa");

  // E acontece com o produto aberto: varrer o fogão fechado não mostra ponto.
  assert.equal(ANALISE.ETAPAS[varrendo[0]].explode, 1);
});
