/* Testes do explodido contínuo e do raio-X no modelo do fogão.
 *
 * Rodar da raiz do repositório:  node --test dashboard/testes/explosao_raio_x.test.js
 *
 * Sem DOM e sem three.js: verifica os vetores de FOGAO.pecas, que são o que o
 * viewport multiplica pelo valor do slider.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var JS = path.join(__dirname, "..", "js");
var ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(JS, "fogao.js"), "utf8"), ctx, { filename: "fogao.js" });
var FOGAO = vm.runInContext("FOGAO", ctx);

var CONFIGS = [{}, { placa: "right" }, { placa: "right", alojamento: "open" }];

function centro(pc, eixo) { return pc.b[eixo] + pc.b[eixo + 3] / 2; }

/* Valores de t em [0, 1] em que dois intervalos que andam em linha reta se
   sobrepõem com folga positiva: a0 + va·t < b1 + vb·t e b0 + vb·t < a1 + va·t.
   Cada desigualdade é linear em t, então a solução é um intervalo aberto. */
function intervaloDeSobreposicao(a0, a1, va, b0, b1, vb) {
  var lo = 0, hi = 1;
  function menor(c, k) {
    // c + k·t < 0
    if (k === 0) { if (c >= 0) hi = -1; return; }
    var raiz = -c / k;
    if (k > 0) hi = Math.min(hi, raiz); else lo = Math.max(lo, raiz);
  }
  menor(a0 - b1, va - vb);
  menor(b0 - a1, vb - va);
  return [lo, hi];
}

test("cada vetor do explodido é radial: aponta para fora do centro do modelo", function () {
  var C = [FOGAO.CENTRO.x, FOGAO.CENTRO.y, FOGAO.CENTRO.z];
  FOGAO.pecas({}).forEach(function (pc) {
    [0, 1, 2].forEach(function (e) {
      if (pc.ex[e] === 0) return;
      assert.ok(Math.sign(pc.ex[e]) === Math.sign(centro(pc, e) - C[e]),
        pc.id + ": eixo " + "xyz"[e] + " anda " + pc.ex[e] + " com o centro em " + centro(pc, e));
    });
  });
});

test("nenhum par de peças se sobrepõe em ponto algum do curso do slider", function () {
  CONFIGS.forEach(function (op) {
    var lista = FOGAO.pecas(op);
    for (var i = 0; i < lista.length; i++) for (var j = i + 1; j < lista.length; j++) {
      var a = lista[i], b = lista[j], lo = 0, hi = 1;
      for (var e = 0; e < 3; e++) {
        var r = intervaloDeSobreposicao(a.b[e], a.b[e] + a.b[e + 3], a.ex[e], b.b[e], b.b[e] + b.b[e + 3], b.ex[e]);
        lo = Math.max(lo, r[0]); hi = Math.min(hi, r[1]);
      }
      assert.ok(lo >= hi, a.id + " × " + b.id + " se sobrepõem para t em (" + lo.toFixed(3) + ", " + hi.toFixed(3) + ") com " + JSON.stringify(op));
    }
  });
});

test("o intervalo exato pega a travessia que a versão anterior tinha", function () {
  // Soprador indo 200 para a frente atravessava o rodapé no meio do curso.
  var r = [0, 1, 2].map(function (e) {
    var sop = [36, 132, 6, 104, 64, 26], rod = [8, 0, 0, 304, 6, 26];
    return intervaloDeSobreposicao(sop[e], sop[e] + sop[e + 3], [0, -200, 0][e], rod[e], rod[e] + rod[e + 3], 0);
  });
  var lo = Math.max(r[0][0], r[1][0], r[2][0]), hi = Math.min(r[0][1], r[1][1], r[2][1]);
  assert.ok(lo < hi && lo > 0 && hi < 1, "esperava sobreposição no meio do curso: " + lo + "–" + hi);
});

test("o raio-X só tira de cena peças sem termopar", function () {
  var externas = FOGAO.pecas({}).filter(function (pc) { return pc.externa; });
  assert.ok(externas.length > 0);
  externas.forEach(function (pc) {
    assert.equal(FOGAO.zonaEm(pc.id, 160, 120), null, pc.id + " tem zona e ficaria inalcançável no raio-X");
  });
  // Toda peça com zona segue opaca.
  FOGAO.ZONAS.forEach(function (z) {
    assert.ok(!FOGAO.acharPeca(FOGAO.pecas({}), z.peca).externa, z.peca);
  });
});
