/* Testes do mapeamento peça ↔ dado e do resumo da peça.
 *
 * Rodar da raiz do repositório:  node --test dashboard/testes/pecas_clicaveis.test.js
 *
 * Carrega os scripts do painel como o navegador carrega — globais num mesmo
 * contexto — sem DOM e sem three.js: fogao.js e painel_peca.js não desenham.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var JS = path.join(__dirname, "..", "js");
var ctx = vm.createContext({ window: {} });
["dados_triagem.js", "fogao.js", "painel_peca.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
});
var FOGAO = vm.runInContext("FOGAO", ctx);
var DADOS = vm.runInContext("DADOS_TRIAGEM", ctx);
var PAINEL = vm.runInContext("PAINEL_PECA", ctx);

var TODOS = DADOS.pontos.concat(DADOS.monitoramento);

function zona(id) { return FOGAO.ZONA_POR_ID[id]; }

test("os 78 pontos caem cada um em exatamente uma zona", function () {
  assert.equal(TODOS.length, 78);
  TODOS.forEach(function (p) {
    var donas = FOGAO.ZONAS.filter(function (z) { return FOGAO.pontosDaZona(z, [p]).length === 1; });
    assert.equal(donas.length, 1, p.measurement_id + " em " + donas.length + " zonas");
    assert.equal(FOGAO.zonaDoPonto(p), donas[0]);
  });
  var soma = FOGAO.ZONAS.reduce(function (s, z) { return s + FOGAO.pontosDaZona(z, TODOS).length; }, 0);
  assert.equal(soma, 78);
});

test("cada zona tem id único, aponta para uma peça existente e não é vazia", function () {
  var ids = {};
  var pecas = FOGAO.pecas({}).map(function (pc) { return pc.id; });
  FOGAO.ZONAS.forEach(function (z) {
    assert.ok(!ids[z.id], "id repetido " + z.id);
    ids[z.id] = true;
    assert.ok(pecas.indexOf(z.peca) >= 0, z.id + " aponta para peça inexistente " + z.peca);
    assert.ok(FOGAO.pontosDaZona(z, TODOS).length > 0, z.id + " sem pontos");
  });
});

test("peça com mais de uma zona separa as zonas por região, e o clique resolve uma só", function () {
  var porPeca = {};
  FOGAO.ZONAS.forEach(function (z) { (porPeca[z.peca] = porPeca[z.peca] || []).push(z); });
  Object.keys(porPeca).forEach(function (id) {
    var zs = porPeca[id];
    if (zs.length === 1) {
      assert.equal(FOGAO.zonaEm(id, 0, 0), zs[0]);
      return;
    }
    zs.forEach(function (z) {
      assert.ok(z.regiao, z.id + " divide a peça sem região");
      // O centro da região resolve para a própria zona.
      assert.equal(FOGAO.zonaEm(id, z.regiao.x, z.regiao.y), z);
    });
  });
  // Posições reais das bobinas: FL frente-esquerda, RR fundo-direita.
  assert.equal(FOGAO.zonaEm("coils", 60, 50).id, "coil-FL");
  assert.equal(FOGAO.zonaEm("coilSupport", 300, 230).id, "placa-RR");
});

test("peças sem termopar ficam fora do mapa", function () {
  ["rodape", "lateralE", "lateralD", "ovenCavity", "porta", "deflector", "ipcTray", "cooktop"].forEach(function (id) {
    assert.equal(FOGAO.zonaEm(id, 160, 120), null, id);
  });
});

test("o marcador de cada ponto mora na mesma peça que a zona dele", function () {
  [["center", "closed"], ["right", "open"]].forEach(function (cfg) {
    var lista = FOGAO.pecas({ placa: cfg[0], alojamento: cfg[1] });
    var colocados = FOGAO.posicionarPontos(TODOS, lista);
    assert.equal(colocados.length, 78);
    colocados.forEach(function (c) {
      assert.equal(c.peca, FOGAO.zonaDoPonto(c.ponto).peca, c.ponto.measurement_id + " (" + cfg + ")");
    });
  });
});

/* Seleção em peças distintas, incluindo uma só de monitorados. O resumo
   tem de devolver os mesmos objetos do dado — valor igual não basta, é o
   próprio registro, o que prova que nada foi recalculado. */

test("Bobina FL: ponto único acima do limite", function () {
  var r = PAINEL.resumir(zona("coil-FL"), DADOS);
  var fonte = DADOS.pontos.filter(function (p) { return p.TC_Name === "Bobina FL"; })[0];
  assert.equal(r.total, 1);
  assert.equal(r.referencia, fonte);
  assert.equal(r.referencia.estado, "acima_do_limite");
  assert.equal(r.soMonitoramento, "nenhum");
});

test("Painel de manípulos: seis pontos, todos dentro do limite", function () {
  var r = PAINEL.resumir(zona("knobBar"), DADOS);
  var fonte = DADOS.pontos.filter(function (p) { return p.Key_Area === "CT Knobs"; });
  assert.equal(r.total, 6);
  assert.equal(r.referencia, fonte[0], "referência é o primeiro na ordem da triagem");
  assert.deepEqual(r.classificados, fonte);
  assert.equal(r.contagem.dentro_do_limite, 6);
  assert.equal(r.soMonitoramento, "nenhum");
});

test("Duto de ar: só pontos is_monitor_only", function () {
  var r = PAINEL.resumir(zona("duct"), DADOS);
  assert.equal(r.total, 2);
  assert.equal(r.classificados.length, 0);
  assert.equal(r.soMonitoramento, "todos");
  assert.ok(r.referencia.is_monitor_only);
  assert.equal(r.referencia.limit_c, null);
  assert.ok(DADOS.monitoramento.indexOf(r.referencia) >= 0);
  // Referência de zona só monitorada é a mais quente.
  r.monitorados.forEach(function (p) { assert.ok(p.temperatura_prevista_c <= r.referencia.temperatura_prevista_c); });
});

test("Soprador: mistura de classificados e monitorados", function () {
  var r = PAINEL.resumir(zona("blower"), DADOS);
  assert.equal(r.total, 5);
  assert.equal(r.soMonitoramento, "parcial");
  assert.equal(r.monitorados.length, 2);
  assert.equal(r.referencia.is_monitor_only, false);
});

test("mediana da peça: par e ímpar, e fica entre mínimo e máximo", function () {
  function mediana(zonaId) {
    var r = PAINEL.resumir(zona(zonaId), DADOS);
    var t = r.classificados.concat(r.monitorados).map(function (p) { return p.temperatura_prevista_c; }).sort(function (a, b) { return a - b; });
    return { r: r, t: t };
  }
  // Manípulos: 6 pontos, média dos dois do meio.
  var k = mediana("knobBar");
  assert.equal(k.r.total, 6);
  assert.equal(k.r.temperatura.mediana, (k.t[2] + k.t[3]) / 2);
  // Soprador: 5 pontos, o do meio.
  var s = mediana("blower");
  assert.equal(s.r.total, 5);
  assert.equal(s.r.temperatura.mediana, s.t[2]);
  // Ponto único: mediana é o próprio ponto.
  var c = mediana("coil-FL");
  assert.equal(c.r.temperatura.mediana, c.t[0]);
  FOGAO.ZONAS.forEach(function (z) {
    var tt = PAINEL.resumir(z, DADOS).temperatura;
    assert.ok(tt.min <= tt.mediana && tt.mediana <= tt.max, z.id);
  });
});

test("mediana não muda a referência: a peça segue o ponto mais crítico", function () {
  FOGAO.ZONAS.forEach(function (z) {
    var r = PAINEL.resumir(z, DADOS);
    var primeiro = FOGAO.pontosDaZona(z, DADOS.pontos)[0];
    if (primeiro) assert.equal(r.referencia, primeiro, z.id);
  });
});

test("Placa de potência: referência é o ponto que a triagem pôs primeiro", function () {
  var r = PAINEL.resumir(zona("ipcBoard"), DADOS);
  var primeiro = DADOS.pontos.filter(function (p) { return p.Key_Area === "IPC Comp"; })[0];
  assert.equal(r.total, 37);
  assert.equal(r.referencia, primeiro);
  var soma = r.contagem.acima_do_limite + r.contagem.banda_de_incerteza + r.contagem.dentro_do_limite + r.contagem.monitoramento;
  assert.equal(soma, 37);
});
