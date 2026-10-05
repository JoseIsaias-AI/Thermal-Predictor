/* Nenhuma tela do painel exibe valor sintético nem fala em demonstração.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/sem_dados_sinteticos.test.js
 *
 * Todo número do painel vem da API de predição. Os dados sintéticos moram só
 * em dashboard/testes/fixtures, e este teste confere as duas pontas: nenhuma
 * página os carrega, e nenhum texto que chega à tela (HTML sem comentários e
 * literais de texto dos scripts) usa os termos do antigo modo de demonstração.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var PAINEL = path.join(__dirname, "..");
var JS = path.join(PAINEL, "js");
var TELAS = ["index.html", "triagem.html", "comparacao.html", "conformidade.html",
  "design.html", "marketing.html", "engenharia.html"];

var PROIBIDOS = /sintétic|demonstraç|\bstub\b|ilustrativ|preliminar|valores sintéticos/i;

function semComentariosHtml(texto) {
  return texto.replace(/<!--[\s\S]*?-->/g, "");
}

/* Os literais de texto de um script, sem os comentários. O nome de campo da API
   `preditor_e_stub` não é texto de tela e sai antes. */
function literaisJs(texto) {
  var semComentarios = texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
  var literais = semComentarios.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g) || [];
  return literais.join("\n").replace(/preditor_e_stub/g, "");
}

test("nenhuma página carrega os dados sintéticos", function () {
  TELAS.forEach(function (tela) {
    var fonte = fs.readFileSync(path.join(PAINEL, tela), "utf8");
    assert.doesNotMatch(fonte, /dados_triagem\.js|dados_comparacao\.js/, tela);
  });
  assert.equal(fs.existsSync(path.join(JS, "dados_triagem.js")), false);
  assert.equal(fs.existsSync(path.join(JS, "dados_comparacao.js")), false);
});

test("o HTML das telas não fala em valores sintéticos nem em demonstração", function () {
  TELAS.forEach(function (tela) {
    var fonte = semComentariosHtml(fs.readFileSync(path.join(PAINEL, tela), "utf8"));
    var achado = PROIBIDOS.exec(fonte);
    assert.equal(achado, null, tela + ": " + (achado && fonte.substr(Math.max(0, achado.index - 60), 140)));
    assert.doesNotMatch(fonte, /id="stub-banner"/, tela);
  });
});

test("nenhum texto dos scripts do painel fala em valores sintéticos", function () {
  fs.readdirSync(JS).filter(function (f) { return /\.js$/.test(f); }).forEach(function (arquivo) {
    var literais = literaisJs(fs.readFileSync(path.join(JS, arquivo), "utf8"));
    var achado = PROIBIDOS.exec(literais);
    assert.equal(achado, null, arquivo + ": " + (achado && literais.substr(Math.max(0, achado.index - 60), 140)));
  });
});

test("o chip das sete telas só tem a versão do modelo", function () {
  TELAS.forEach(function (tela) {
    var fonte = fs.readFileSync(path.join(PAINEL, tela), "utf8");
    var chip = /<p class="model-chip[^"]*"[^>]*id="model-chip"[^>]*>([\s\S]*?)<\/p>/.exec(fonte);
    assert.ok(chip, tela + " sem o chip do modelo");
    assert.match(chip[0], /\bhidden\b/, tela + ": o chip abre oculto até a versão chegar");
    assert.equal(chip[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(), "Modelo —", tela);
  });
});
