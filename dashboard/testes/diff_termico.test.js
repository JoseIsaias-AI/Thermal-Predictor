/* Testes do diff térmico entre duas configurações.
 *
 * Rodar da raiz do repositório:  node --test dashboard/testes/diff_termico.test.js
 *
 * Duas combinações escolhidas na própria base: o par de menor diferença
 * relevante e o de maior diferença. Nos dois a escala tem de responder na
 * proporção dos graus e o painel de peça tem de trazer A, B e a diferença
 * iguais aos do dado.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var caminho = require("./apoio/fonte_painel.js").caminho;
var ctx = vm.createContext({ window: {} });
["dados_triagem.js", "dados_comparacao.js", "fogao.js", "painel_peca.js", "diff_termico.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(caminho(f), "utf8"), ctx, { filename: f });
});
var TRIAGEM = vm.runInContext("DADOS_TRIAGEM", ctx);
var D = vm.runInContext("DADOS_COMPARACAO", ctx);
var FOGAO = vm.runInContext("FOGAO", ctx);
var PAINEL = vm.runInContext("PAINEL_PECA", ctx);
var DIFF = vm.runInContext("DIFF_TERMICO", ctx);

var POR_ID = {};
D.configuracoes.forEach(function (c) { POR_ID[c.id] = c; });
var IDX = {};
D.pontos.forEach(function (p, i) { IDX[p.id] = i; });

function maiorModulo(a, b) {
  return DIFF.diferenca(D, a, b).reduce(function (m, l) { return Math.max(m, Math.abs(l.diferenca_c)); }, 0);
}

// Todos os pares da base, com a maior diferença de cada um.
var PARES = [];
D.configuracoes.forEach(function (a, i) {
  D.configuracoes.slice(i + 1).forEach(function (b) { PARES.push({ a: a, b: b, max: maiorModulo(a, b) }); });
});
PARES.sort(function (x, y) { return x.max - y.max; });
var PEQUENO = PARES.filter(function (p) { return p.max > DIFF.LIMIAR_C; })[0];
var GRANDE = PARES[PARES.length - 1];

test("CFG-19 lido pela camada do diff reproduz a triagem ponto a ponto", function () {
  var dados = DIFF.dadosDaConfig(D, POR_ID[D.config_referencia_triagem]);
  assert.equal(dados.pontos.length, TRIAGEM.pontos.length);
  dados.pontos.forEach(function (p, k) {
    var t = TRIAGEM.pontos[k];
    assert.equal(p.measurement_id, t.measurement_id, "ordem diverge na posição " + k);
    assert.equal(p.temperatura_prevista_c, t.temperatura_prevista_c);
    assert.equal(p.estado, t.estado);
    assert.ok(Math.abs(p.margem_c - t.margem_c) < 1e-9);
  });
  assert.equal(dados.monitoramento.length, TRIAGEM.monitoramento.length);
});

test("a diferença é B − A sobre as temperaturas do dado, nos 78 pontos", function () {
  [PEQUENO, GRANDE].forEach(function (par) {
    var linhas = DIFF.diferenca(D, par.a, par.b);
    assert.equal(linhas.length, 78);
    linhas.forEach(function (l) {
      var i = IDX[l.measurement_id];
      assert.equal(l.a, par.a.t[i]);
      assert.equal(l.b, par.b.t[i]);
      assert.equal(l.diferenca_c, par.b.t[i] - par.a.t[i]);
    });
  });
});

test("inverter o par inverte o sinal; a configuração contra si mesma é zero", function () {
  var ida = DIFF.diferenca(D, GRANDE.a, GRANDE.b), volta = DIFF.diferenca(D, GRANDE.b, GRANDE.a);
  var porId = {};
  volta.forEach(function (l) { porId[l.measurement_id] = l.diferenca_c; });
  ida.forEach(function (l) { assert.ok(Math.abs(l.diferenca_c + porId[l.measurement_id]) < 1e-9); });
  DIFF.diferenca(D, GRANDE.a, GRANDE.a).forEach(function (l) { assert.equal(l.diferenca_c, 0); });
});

test("as duas combinações testadas: uma de diferença pequena, outra grande", function () {
  assert.ok(PEQUENO.max < 10, "par pequeno com " + PEQUENO.max + " °C");
  assert.ok(GRANDE.max > 30, "par grande com " + GRANDE.max + " °C");
  // Pequeno fica no piso; grande abre a escala até cobrir a maior diferença.
  var ep = DIFF.escala(DIFF.diferenca(D, PEQUENO.a, PEQUENO.b));
  var eg = DIFF.escala(DIFF.diferenca(D, GRANDE.a, GRANDE.b));
  assert.equal(ep.extremo, DIFF.PISO_C);
  assert.ok(eg.extremo >= GRANDE.max && eg.extremo <= GRANDE.max * 1.35, "extremo " + eg.extremo);
});

test("escala divergente centrada em zero, simétrica e proporcional", function () {
  [PEQUENO, GRANDE].forEach(function (par) {
    var esc = DIFF.escala(DIFF.diferenca(D, par.a, par.b));
    var n = FOGAO.normalizadorDivergente(esc.extremo, esc.limiar);
    assert.equal(n.normalizar(0), 0.5);
    assert.equal(n.normalizar(esc.limiar), 0.5);
    assert.equal(n.normalizar(esc.extremo), 1);
    assert.equal(n.normalizar(-esc.extremo), 0);
    // Proporcional: o dobro da diferença, o dobro do afastamento do meio.
    var d = esc.extremo / 4;
    assert.ok(Math.abs((n.normalizar(2 * d) - 0.5) - 2 * (n.normalizar(d) - 0.5)) < 1e-12);
    assert.ok(Math.abs((n.normalizar(d) - 0.5) + (n.normalizar(-d) - 0.5)) < 1e-12);
    // Cada ponto do par cai na rampa na ordem da sua diferença.
    var linhas = DIFF.diferenca(D, par.a, par.b).slice().sort(function (x, y) { return x.diferenca_c - y.diferenca_c; });
    for (var k = 1; k < linhas.length; k++) {
      assert.ok(n.normalizar(linhas[k].diferenca_c) >= n.normalizar(linhas[k - 1].diferenca_c));
    }
  });
});

test("rampa da diferença: meio neutro, azul no frio, vermelho no quente, distinta das outras", function () {
  var R = FOGAO.RAMPA_DIFF;
  var meio = FOGAO.corDaRampa(R, 0.5);
  assert.ok(Math.max.apply(null, meio) - Math.min.apply(null, meio) < 8, "meio não é neutro: " + meio);
  var frio = FOGAO.corDaRampa(R, 0), quente = FOGAO.corDaRampa(R, 0.9999);
  assert.ok(frio[2] > frio[0], "frio não é azul");
  assert.ok(quente[0] > quente[2], "quente não é vermelho");
  assert.notDeepEqual(Array.from(R), Array.from(FOGAO.RAMPA_CAMPO));
  assert.notDeepEqual(Array.from(R), Array.from(FOGAO.RAMPA_A));
});

test("painel de peça no modo diff: A, B e diferença corretos em cada peça, nos dois pares", function () {
  [PEQUENO, GRANDE].forEach(function (par) {
    var linhas = DIFF.diferenca(D, par.a, par.b);
    FOGAO.ZONAS.forEach(function (z) {
      var r = PAINEL.resumirDiff(z, linhas, DIFF.LIMIAR_C);
      assert.ok(r.total > 0, z.id);
      var ref = r.referencia, i = IDX[ref.measurement_id];
      assert.equal(ref.a, par.a.t[i]);
      assert.equal(ref.b, par.b.t[i]);
      assert.equal(ref.diferenca_c, par.b.t[i] - par.a.t[i]);
      // A referência é a de maior variação na peça.
      r.linhas.forEach(function (l) { assert.ok(Math.abs(l.diferenca_c) <= Math.abs(ref.diferenca_c)); });
      var c = r.contagem;
      assert.equal(c.mais_quente + c.mais_frio + c.igual, r.total);
    });
  });
});

test("o diff não tem estado: as linhas não carregam limite, folga nem estado", function () {
  DIFF.diferenca(D, GRANDE.a, GRANDE.b).forEach(function (l) {
    assert.ok(!("estado" in l) && !("limit_c" in l) && !("margem_c" in l));
  });
});
