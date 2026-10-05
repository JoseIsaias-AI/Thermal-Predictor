/* Testes do tema escuro: contraste dos tokens e rampas de cor.
 *
 * Rodar da raiz do repositório:  node --test dashboard/testes/tema.test.js
 *
 * Os tokens são lidos do próprio tokens.css, resolvendo var() como o
 * navegador: o bloco escuro sobrescreve o claro e o resto herda. Assim o
 * teste falha se alguém mexer numa cor e derrubar o contraste abaixo do AA.
 */

"use strict";

var test = require("node:test");
var caminho = require("./apoio/fonte_painel.js").caminho;
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var CSS = fs.readFileSync(path.join(__dirname, "..", "css", "base", "tokens.css"), "utf8");

function bloco(seletor) {
  var i = CSS.indexOf(seletor + " {");
  assert.ok(i >= 0, "bloco não encontrado: " + seletor);
  var corpo = CSS.slice(CSS.indexOf("{", i) + 1, CSS.indexOf("\n}", i));
  var mapa = {};
  corpo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(--[\w-]+)\s*:\s*([^;]+);/g, function (_, nome, valor) {
    mapa[nome] = valor.trim();
  });
  return mapa;
}

var CLARO = bloco(":root");
var ESCURO = Object.assign({}, CLARO, bloco(':root[data-tema="escuro"]'));

function resolver(tokens, nome) {
  var v = tokens[nome];
  assert.ok(v, "token ausente: " + nome);
  var m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? resolver(tokens, m[1]) : v;
}

function luminancia(hex) {
  var h = hex.replace("#", "");
  return [0, 2, 4].map(function (k) {
    var c = parseInt(h.substr(k, 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }).reduce(function (s, c, k) { return s + c * [0.2126, 0.7152, 0.0722][k]; }, 0);
}

function contraste(a, b) {
  var la = luminancia(a), lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

var FUNDOS = ["--color-canvas", "--color-surface", "--color-surface-sunken", "--color-surface-raised", "--color-stage-3d"];
var TEXTOS = ["--color-text", "--color-text-muted", "--color-text-subtle", "--color-text-strong", "--color-accent", "--status-critical"];

// [frente, fundo, mínimo]: texto pede 4,5:1 e marca gráfica 3:1 (WCAG 1.4.3 e 1.4.11).
var PARES = [];
TEXTOS.forEach(function (t) { FUNDOS.forEach(function (f) { PARES.push([t, f, 4.5]); }); });
PARES.push(
  ["--color-accent", "--color-surface-accent", 4.5],
  ["--color-on-accent", "--color-accent", 4.5],
  ["--status-critical", "--status-critical-bg", 4.5],
  ["--status-attention", "--status-attention-bg", 4.5],
  ["--color-text-inverse", "--color-tooltip", 4.5],
  ["--color-text-inverse-muted", "--color-tooltip", 4.5],
  ["--color-focus-ring", "--color-surface", 3],
  ["--color-data", "--color-surface", 3],
  ["--status-neutral-bar", "--color-surface", 3],
  ["--status-attention-bar", "--color-surface", 3],
  ["--color-glyph-line", "--color-surface", 3]
);

[["claro", CLARO], ["escuro", ESCURO]].forEach(function (par) {
  test("contraste AA dos tokens no tema " + par[0], function () {
    var falhas = PARES.filter(function (p) {
      return contraste(resolver(par[1], p[0]), resolver(par[1], p[1])) < p[2];
    }).map(function (p) {
      return p[0] + " sobre " + p[1] + ": " + contraste(resolver(par[1], p[0]), resolver(par[1], p[1])).toFixed(2);
    });
    assert.deepEqual(falhas, []);
  });
});

test("hierarquia do texto se mantém no escuro: texto > secundário > nota", function () {
  var fundo = resolver(ESCURO, "--color-surface");
  var c = ["--color-text", "--color-text-muted", "--color-text-subtle"].map(function (t) {
    return contraste(resolver(ESCURO, t), fundo);
  });
  assert.ok(c[0] > c[1] && c[1] > c[2], c.join(" > "));
});

/* ----- Rampas ----- */

function carregarFogao(tema) {
  var ctx = { window: {} };
  if (tema) {
    var ouvintes = [];
    ctx.TEMA = { atual: function () { return tema; }, aoMudar: function (fn) { ouvintes.push(fn); } };
    ctx.trocar = function (t) { ouvintes.forEach(function (fn) { fn(t); }); };
  }
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(caminho("fogao.js"), "utf8"), ctx, { filename: "fogao.js" });
  return ctx;
}

var CLARAS = carregarFogao(null).FOGAO;

test("sem TEMA (Node, PDF) as rampas são as do claro", function () {
  assert.equal(CLARAS.RAMPA_CAMPO[0], "#3f1a6b");
  assert.equal(CLARAS.RAMPA_DIFF[4], "#f7f7f7");
});

test("a troca de tema reescreve as rampas no mesmo array, e volta inteira", function () {
  var ctx = carregarFogao("claro"), F = ctx.FOGAO;
  var campo = F.RAMPA_CAMPO, diff = F.RAMPA_DIFF, a = Array.from(F.RAMPA_A), b = Array.from(F.RAMPA_B);
  ctx.trocar("escuro");
  assert.equal(F.RAMPA_CAMPO, campo, "referência do campo trocada");
  assert.equal(F.RAMPA_DIFF, diff, "referência da diferença trocada");
  assert.deepEqual(Array.from(F.RAMPA_CAMPO), Array.from(F.RAMPAS_ESCURO.RAMPA_CAMPO));
  assert.deepEqual(Array.from(F.RAMPA_DIFF), Array.from(F.RAMPAS_ESCURO.RAMPA_DIFF));
  // A folga é lida sobre o modelo 3D, que tem a mesma luz nos dois temas.
  assert.deepEqual(Array.from(F.RAMPA_A), a);
  assert.deepEqual(Array.from(F.RAMPA_B), b);
  ctx.trocar("claro");
  assert.deepEqual(Array.from(F.RAMPA_CAMPO), Array.from(CLARAS.RAMPA_CAMPO));
  assert.deepEqual(Array.from(F.RAMPA_DIFF), Array.from(CLARAS.RAMPA_DIFF));
});

test("sessão aberta no escuro já nasce com as rampas escuras", function () {
  var F = carregarFogao("escuro").FOGAO;
  assert.deepEqual(Array.from(F.RAMPA_CAMPO), Array.from(F.RAMPAS_ESCURO.RAMPA_CAMPO));
});

var PALCO = resolver(ESCURO, "--color-stage-3d");
var ESC = CLARAS.RAMPAS_ESCURO;

test("campo escuro: mesma quantidade de paradas e nenhuma abaixo de 3:1 no palco", function () {
  assert.equal(ESC.RAMPA_CAMPO.length, CLARAS.RAMPA_CAMPO.length);
  ESC.RAMPA_CAMPO.forEach(function (c) {
    assert.ok(contraste(c, PALCO) >= 3, c + " dá " + contraste(c, PALCO).toFixed(2) + ":1 no palco " + PALCO);
  });
});

test("diferença escura: meio neutro, azul no frio, vermelho no quente", function () {
  var R = ESC.RAMPA_DIFF;
  var meio = CLARAS.corDaRampa(R, 0.5);
  assert.ok(Math.max.apply(null, meio) - Math.min.apply(null, meio) < 8, "meio não é neutro: " + meio);
  var frio = CLARAS.corDaRampa(R, 0), quente = CLARAS.corDaRampa(R, 0.9999);
  assert.ok(frio[2] > frio[0], "frio não é azul");
  assert.ok(quente[0] > quente[2], "quente não é vermelho");
});

test("diferença escura: destaque cresce do meio para os extremos, como no claro", function () {
  function crescente(R, fundo) {
    var meio = (R.length - 1) / 2;
    for (var k = 1; k <= meio; k++) {
      [meio - k, meio + k].forEach(function (i) {
        var dentro = i < meio ? i + 1 : i - 1;
        assert.ok(contraste(R[i], fundo) > contraste(R[dentro], fundo),
          R[i] + " não se afasta mais do fundo que " + R[dentro]);
      });
    }
  }
  crescente(CLARAS.RAMPA_DIFF, resolver(CLARO, "--color-stage-3d"));
  crescente(ESC.RAMPA_DIFF, PALCO);
});
