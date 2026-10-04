/* Testes dos recursos assistivos: estado do painel, alto contraste, paletas
 * daltônicas e filtros de correção.
 *
 * Rodar da raiz do repositório:  node --test dashboard/testes/acessibilidade.test.js
 *
 * O acessibilidade.js roda num vm com um dublê mínimo de documento: a página
 * fica "carregando", então o painel não é montado e o que se testa é o estado
 * (níveis, armazenamento, atributos na raiz, avisos). As cores são lidas do
 * próprio CSS, como em tema.test.js: o teste falha se alguém mexer numa cor
 * e derrubar o contraste ou a leitura da rampa por quem é daltônico.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var RAIZ = path.join(__dirname, "..");
var FONTE_A11Y = fs.readFileSync(path.join(RAIZ, "js", "acessibilidade.js"), "utf8");
var TOKENS = fs.readFileSync(path.join(RAIZ, "css", "tokens.css"), "utf8");
var CSS_A11Y = fs.readFileSync(path.join(RAIZ, "css", "acessibilidade.css"), "utf8");

/* Objetos criados dentro do vm têm outro Object.prototype: compara-se o conteúdo. */
function simples(o) { return JSON.parse(JSON.stringify(o)); }

/* ----- Dublê de navegador ----- */

function armazenamento(inicial) {
  var dados = Object.assign({}, inicial);
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : null; },
    setItem: function (k, v) { dados[k] = String(v); },
    removeItem: function (k) { delete dados[k]; },
    dados: dados
  };
}

function carregar(opcoes) {
  opcoes = opcoes || {};
  var atributos = {};
  var raiz = {
    setAttribute: function (k, v) { atributos[k] = String(v); },
    removeAttribute: function (k) { delete atributos[k]; },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(atributos, k) ? atributos[k] : null; }
  };
  var eventos = [];
  var recargas = { n: 0 };
  var local = armazenamento(opcoes.local);
  var sessao = armazenamento();
  var janela = {
    localStorage: local,
    sessionStorage: sessao,
    location: { reload: function () { recargas.n += 1; } },
    innerHeight: 800,
    getComputedStyle: function () { return { fontSize: "16px" }; },
    requestAnimationFrame: function () { return 1; },
    setTimeout: function (fn) { fn(); return 1; }
  };
  var documento = {
    readyState: "loading",
    documentElement: raiz,
    body: null,
    styleSheets: opcoes.folhas || [],
    addEventListener: function () {},
    dispatchEvent: function (e) { eventos.push(e.detail); }
  };
  var ctx = {
    window: janela,
    document: documento,
    navigator: { onLine: true },
    CustomEvent: function (tipo, init) { this.type = tipo; this.detail = init && init.detail; },
    JSON: JSON,
    WeakMap: WeakMap
  };
  janela.document = documento;
  vm.createContext(ctx);
  vm.runInContext(FONTE_A11Y, ctx, { filename: "acessibilidade.js" });
  return { A: ctx.ACESSIBILIDADE, atributos: atributos, local: local, eventos: eventos, recargas: recargas };
}

/* ----- Estado do painel ----- */

test("definir aplica o atributo na raiz e guarda a escolha", function () {
  var p = carregar();
  p.A.definir("fonte", 2);
  assert.equal(p.atributos["data-a11y-fonte"], "2");
  assert.deepEqual(JSON.parse(p.local.getItem(p.A.CHAVE)), { fonte: 2 });
  assert.deepEqual(simples(p.A.atual()), { fonte: 2 });
});

test("ciclar percorre os níveis e desliga depois do último", function () {
  var p = carregar();
  var vistos = [];
  for (var i = 0; i < 4; i++) { p.A.ciclar("fonte"); vistos.push(p.A.nivel("fonte")); }
  assert.deepEqual(vistos, [1, 2, 3, 0]);
  assert.equal(p.atributos["data-a11y-fonte"], undefined);
});

test("nível fora da faixa desliga o recurso em vez de gravar lixo", function () {
  var p = carregar();
  p.A.definir("contraste", 9);
  assert.equal(p.A.nivel("contraste"), 0);
  assert.equal(p.atributos["data-a11y-contraste"], undefined);
});

test("a escolha guardada volta na próxima tela, e o que é inválido é ignorado", function () {
  var p = carregar({ local: { "thermal-predictor.acessibilidade": JSON.stringify({ fonte: 3, contraste: 1, voz: 9, inexistente: 2 }) } });
  assert.equal(p.atributos["data-a11y-fonte"], "3");
  assert.equal(p.atributos["data-a11y-contraste"], "1");
  assert.equal(p.atributos["data-a11y-voz"], undefined);
  assert.deepEqual(simples(p.A.atual()), { fonte: 3, contraste: 1 });
});

test("armazenamento corrompido não quebra a página", function () {
  var p = carregar({ local: { "thermal-predictor.acessibilidade": "{não é json" } });
  assert.deepEqual(simples(p.A.atual()), {});
});

test("restaurar desliga tudo, limpa a raiz e avisa cada recurso que estava ligado", function () {
  var p = carregar();
  p.A.definir("fonte", 1);
  p.A.definir("letras", 3);
  p.eventos.length = 0;
  p.A.restaurar();
  assert.deepEqual(simples(p.A.atual()), {});
  assert.equal(p.atributos["data-a11y-fonte"], undefined);
  assert.equal(p.atributos["data-a11y-letras"], undefined);
  assert.deepEqual(JSON.parse(p.local.getItem(p.A.CHAVE)), {});
  assert.deepEqual(p.eventos.map(function (e) { return e.id; }).sort(), ["fonte", "letras"]);
});

test("aoMudar recebe o recurso, o nível e o estado inteiro", function () {
  var p = carregar();
  var recebido = null;
  p.A.aoMudar(function (m) { recebido = m; });
  p.A.definir("linhas", 2);
  assert.equal(recebido.id, "linhas");
  assert.equal(recebido.nivel, 2);
  assert.deepEqual(simples(recebido.estado), { linhas: 2 });
});

test("pausar animações liga o movimento reduzido que o 3D e a análise consultam", function () {
  var p = carregar();
  assert.equal(p.A.movimentoReduzido.matches, false);
  p.A.definir("animacoes", 1);
  assert.equal(p.A.movimentoReduzido.matches, true);
});

test("modo daltônico recarrega só ao ligar ou desligar, não ao trocar de tipo", function () {
  var p = carregar();
  p.A.definir("daltonico", 1);
  assert.equal(p.recargas.n, 1, "ligar repinta as rampas");
  p.A.definir("daltonico", 3);
  assert.equal(p.recargas.n, 1, "trocar de tipo só troca o filtro");
  p.A.definir("daltonico", 0);
  assert.equal(p.recargas.n, 2, "desligar repinta de volta");
});

test("fonte maior escala os limites das media queries, e volta ao desligar", function () {
  function regra(texto) { return { media: { mediaText: texto }, cssRules: [] }; }
  var pagina = { href: "http://x/css/app.css", cssRules: [regra("(max-width: 60rem)"), regra("(min-width: 72.01rem) and (max-width: 900px)"), regra("(prefers-reduced-motion: reduce)")] };
  var propria = { href: "http://x/css/acessibilidade.css?v=1", cssRules: [regra("(max-width: 600px)")] };
  var p = carregar({ folhas: [pagina, propria] });

  p.A.definir("fonte", 3);
  assert.equal(pagina.cssRules[0].media.mediaText, "(max-width: 90rem)");
  assert.equal(pagina.cssRules[1].media.mediaText, "(min-width: 108.015rem) and (max-width: 1350px)");
  assert.equal(pagina.cssRules[2].media.mediaText, "(prefers-reduced-motion: reduce)");
  assert.equal(propria.cssRules[0].media.mediaText, "(max-width: 600px)", "os limites do próprio painel não escalam");

  p.A.definir("fonte", 0);
  assert.equal(pagina.cssRules[0].media.mediaText, "(max-width: 60rem)");
  assert.equal(pagina.cssRules[1].media.mediaText, "(min-width: 72.01rem) and (max-width: 900px)");
});

/* ----- Cores: leitura do CSS ----- */

function bloco(css, seletor) {
  var i = css.indexOf(seletor + " {");
  assert.ok(i >= 0, "bloco não encontrado: " + seletor);
  var corpo = css.slice(css.indexOf("{", i) + 1, css.indexOf("\n}", i));
  var mapa = {};
  corpo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(--[\w-]+)\s*:\s*([^;]+);/g, function (_, nome, valor) {
    mapa[nome] = valor.trim();
  });
  return mapa;
}

var CLARO = bloco(TOKENS, ":root");
var ESCURO = Object.assign({}, CLARO, bloco(TOKENS, ':root[data-tema="escuro"]'));

function resolver(tokens, nome) {
  var v = tokens[nome];
  assert.ok(v, "token ausente: " + nome);
  var m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? resolver(tokens, m[1]) : v;
}

function canal(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

function rgbLinear(hex) {
  var h = hex.replace("#", "");
  return [0, 2, 4].map(function (k) { return canal(parseInt(h.substr(k, 2), 16) / 255); });
}

function luminancia(lin) { return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]; }

function contraste(a, b) {
  var la = luminancia(rgbLinear(a)), lb = luminancia(rgbLinear(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ----- Alto contraste ----- */

var NIVEIS_CONTRASTE = [
  ["claro, reforçado", CLARO, ':root:not([data-tema="escuro"])[data-a11y-contraste="1"]'],
  ["escuro, reforçado", ESCURO, ':root[data-tema="escuro"][data-a11y-contraste="1"]'],
  ["claro, máximo", CLARO, ':root:not([data-tema="escuro"])[data-a11y-contraste="2"]'],
  ["escuro, máximo", ESCURO, ':root[data-tema="escuro"][data-a11y-contraste="2"]']
];

var FUNDOS = ["--color-canvas", "--color-surface", "--color-surface-sunken", "--color-surface-muted", "--color-surface-accent"];
var TEXTOS = ["--color-text", "--color-text-strong", "--color-text-muted", "--color-text-subtle", "--color-accent", "--status-critical"];

NIVEIS_CONTRASTE.forEach(function (n) {
  var tokens = Object.assign({}, n[1], bloco(CSS_A11Y, n[2]));

  test("alto contraste (" + n[0] + "): todo texto a pelo menos 7:1 (WCAG 1.4.6)", function () {
    var falhas = [];
    TEXTOS.forEach(function (t) {
      FUNDOS.forEach(function (f) {
        var c = contraste(resolver(tokens, t), resolver(tokens, f));
        if (c < 7) falhas.push(t + " sobre " + f + ": " + c.toFixed(2));
      });
    });
    assert.deepEqual(falhas, []);
  });

  test("alto contraste (" + n[0] + "): borda e foco a pelo menos 3:1 (WCAG 1.4.11)", function () {
    ["--color-border", "--color-border-strong", "--color-focus-ring"].forEach(function (t) {
      var c = contraste(resolver(tokens, t), resolver(tokens, "--color-surface"));
      assert.ok(c >= 3, t + " dá " + c.toFixed(2) + ":1");
    });
  });
});

test("modo daltônico: o estado crítico laranja mantém o contraste de texto", function () {
  var claro = Object.assign({}, CLARO, bloco(CSS_A11Y, ':root:not([data-tema="escuro"])[data-a11y-daltonico]'));
  var escuro = Object.assign({}, ESCURO, bloco(CSS_A11Y, ':root[data-tema="escuro"][data-a11y-daltonico]'));
  assert.ok(contraste(resolver(claro, "--status-critical"), resolver(claro, "--color-surface")) >= 7);
  assert.ok(contraste(resolver(claro, "--status-critical"), resolver(claro, "--status-critical-bg")) >= 4.5);
  assert.ok(contraste(resolver(escuro, "--status-critical"), resolver(escuro, "--color-surface")) >= 7);
});

/* ----- Paletas daltônicas -----
 * Simulação de Machado, Oliveira e Fernandes (2009), severidade total, em RGB
 * linear; distância em CIELAB. */

var SIMULACAO = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
};

function simular(lin, m) {
  if (!m) return lin;
  return m.map(function (linha) {
    return Math.max(0, Math.min(1, linha[0] * lin[0] + linha[1] * lin[1] + linha[2] * lin[2]));
  });
}

function lab(lin) {
  var x = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047;
  var y = luminancia(lin);
  var z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
  function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function distancia(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

var VISOES = [["visão típica", null]].concat(Object.keys(SIMULACAO).map(function (k) { return [k, SIMULACAO[k]]; }));

function carregarFogao(tema, daltonico) {
  var ctx = {
    window: {},
    TEMA: { atual: function () { return tema; }, aoMudar: function () {} },
    ACESSIBILIDADE: { nivel: function (id) { return id === "daltonico" ? daltonico : 0; } }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "js", "fogao.js"), "utf8"), ctx, { filename: "fogao.js" });
  return ctx.FOGAO;
}

var ORIGINAL = carregarFogao("claro", 0);
var D_CLARO = carregarFogao("claro", 2);
var D_ESCURO = carregarFogao("escuro", 1);

test("modo daltônico troca as rampas na carga, e sem ele ficam as originais", function () {
  assert.deepEqual(Array.from(D_CLARO.RAMPA_A), Array.from(ORIGINAL.RAMPAS_DALTONICO.RAMPA_A));
  assert.deepEqual(Array.from(D_CLARO.RAMPA_CAMPO), Array.from(ORIGINAL.RAMPAS_DALTONICO.CLARO.RAMPA_CAMPO));
  assert.deepEqual(Array.from(D_ESCURO.RAMPA_DIFF), Array.from(ORIGINAL.RAMPAS_DALTONICO.ESCURO.RAMPA_DIFF));
  assert.equal(ORIGINAL.RAMPA_CAMPO[0], "#3f1a6b");
  assert.equal(ORIGINAL.RAMPA_A[7], "#5e120b");
});

test("rampas daltônicas têm as mesmas paradas das originais, e a de folga mantém o meio neutro", function () {
  assert.equal(D_CLARO.RAMPA_A.length, ORIGINAL.RAMPA_A.length);
  assert.equal(D_CLARO.RAMPA_CAMPO.length, ORIGINAL.RAMPA_CAMPO.length);
  assert.equal(D_CLARO.RAMPA_DIFF.length, ORIGINAL.RAMPA_DIFF.length);
  // A banda de incerteza (0 a +10%) segue cinza: inconclusivo não puxa para lado nenhum.
  assert.equal(D_CLARO.RAMPA_A[3], ORIGINAL.RAMPA_A[3]);
});

[["claro", D_CLARO], ["escuro", D_ESCURO]].forEach(function (par) {
  var R = par[1];

  VISOES.forEach(function (v) {
    test("campo (" + par[0] + ", " + v[0] + "): a luminosidade só sobe, então a ordem das temperaturas sobrevive", function () {
      var L = Array.from(R.RAMPA_CAMPO).map(function (c) { return lab(simular(rgbLinear(c), v[1]))[0]; });
      for (var i = 1; i < L.length; i++) assert.ok(L[i] > L[i - 1], "parada " + i + ": " + L.map(Math.round).join(", "));
    });

    test("rampas (" + par[0] + ", " + v[0] + "): paradas vizinhas distinguíveis (ΔE ≥ 7)", function () {
      [["folga", R.RAMPA_A], ["campo", R.RAMPA_CAMPO], ["diferença", R.RAMPA_DIFF]].forEach(function (r) {
        var cores = Array.from(r[1]).map(function (c) { return lab(simular(rgbLinear(c), v[1])); });
        for (var i = 1; i < cores.length; i++) {
          var d = distancia(cores[i], cores[i - 1]);
          assert.ok(d >= 7, r[0] + ", paradas " + (i - 1) + "–" + i + ": ΔE " + d.toFixed(1));
        }
      });
    });
  });
});

test("campo escuro daltônico: nenhuma parada abaixo de 3:1 no palco escuro", function () {
  var palco = resolver(ESCURO, "--color-stage-3d");
  D_ESCURO.RAMPA_CAMPO.forEach(function (c) {
    assert.ok(contraste(c, palco) >= 3, c + " dá " + contraste(c, palco).toFixed(2) + ":1");
  });
});

/* ----- Filtros de correção ----- */

var FILTROS = {};
FONTE_A11Y.replace(/(deuteranopia|protanopia|tritanopia):\s*"([^"]+)"/g, function (_, tipo, valores) {
  FILTROS[tipo] = valores.trim().split(/\s+/).map(Number);
});

test("os três tipos de daltonismo têm filtro, e o CSS aponta cada nível para o seu", function () {
  assert.deepEqual(Object.keys(FILTROS).sort(), ["deuteranopia", "protanopia", "tritanopia"]);
  ["deuteranopia", "protanopia", "tritanopia"].forEach(function (tipo, i) {
    assert.ok(CSS_A11Y.indexOf('[data-a11y-daltonico="' + (i + 1) + '"] { filter: url(#a11y-' + tipo + ")") >= 0, tipo);
  });
});

test("filtros de correção deixam o cinza cinza: branco, preto e neutros não ganham cor", function () {
  Object.keys(FILTROS).forEach(function (tipo) {
    var v = FILTROS[tipo];
    assert.equal(v.length, 20, tipo + ": matriz 4×5");
    [0, 1, 2].forEach(function (linha) {
      var soma = v[linha * 5] + v[linha * 5 + 1] + v[linha * 5 + 2];
      assert.ok(Math.abs(soma - 1) < 0.02, tipo + ", linha " + linha + " soma " + soma.toFixed(3));
    });
  });
});
