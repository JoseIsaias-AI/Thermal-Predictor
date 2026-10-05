/* Testes do estado da tela sem previsão do modelo.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/estado_servico.test.js
 *
 * Sem a API, toda tela mostra só o aviso "Serviço de predição indisponível",
 * com instrução e botão de tentar de novo, e nenhum número. O aviso é montado
 * por js/estado_servico.js; quem esconde o resto da tela é o CSS, pela marca em
 * `body[data-servico]`, e por isso o teste confere as duas metades.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var D = require("./dom_duble.js");
var ES = require("../js/estado_servico.js");

var PAINEL = path.join(__dirname, "..");

function tela() {
  var doc = D.criarDocumento();
  var principal = doc.getElementById("conteudo");
  principal.appendChild(doc.createElement("div"));
  doc.body.appendChild(principal);
  return { doc: doc, principal: principal };
}

function textoDe(no) {
  if (!no) return "";
  return (no.children.length ? no.children.map(textoDe).join(" ") : no.textContent || "");
}

test("indisponível: aviso, instrução e botão de tentar de novo, à frente do conteúdo", function () {
  var t = tela();
  var caixa = ES.mostrar(t.doc, "indisponivel");

  assert.equal(t.doc.body.dataset.servico, "indisponivel");
  assert.equal(t.principal.children[0], caixa);
  assert.equal(caixa.getAttribute("role"), "alert");

  var texto = textoDe(caixa);
  assert.match(texto, /Serviço de predição indisponível/);
  assert.match(texto, /uvicorn api\.main:app --port 8001/);
  assert.match(texto, /Tentar de novo/);
  assert.doesNotMatch(texto, /°C|demonstra|sintétic|stub/i, "nenhum número nem valor de reserva no aviso");
});

test("o botão tenta de novo pelo caminho que a tela pediu", function () {
  var t = tela();
  var tentativas = 0;
  var caixa = ES.mostrar(t.doc, "indisponivel", { aoTentar: function () { tentativas += 1; } });

  var botao = caixa.querySelector(".servico__tentar");
  botao.dispatchEvent({ type: "click" });

  assert.equal(tentativas, 1);
});

test("trocar de estado não empilha avisos, e limpar devolve a tela", function () {
  var t = tela();
  ES.mostrar(t.doc, "carregando");
  ES.mostrar(t.doc, "indisponivel");

  assert.equal(t.principal.children.filter(function (n) { return /\bservico\b/.test(n.className); }).length, 1);

  ES.limpar(t.doc);
  assert.equal(t.doc.body.dataset.servico, undefined);
  assert.equal(t.principal.children.filter(function (n) { return /\bservico\b/.test(n.className); }).length, 0);
});

test("verificando não monta aviso: só segura o conteúdo invisível", function () {
  var t = tela();
  assert.equal(ES.mostrar(t.doc, "verificando"), null);
  assert.equal(t.doc.body.dataset.servico, "verificando");
});

test("configuração inválida e sem configuração levam à consulta", function () {
  ["configuracao_invalida", "sem_configuracao"].forEach(function (estado) {
    var caixa = ES.mostrar(tela().doc, estado);
    assert.equal(caixa.querySelector(".servico__consulta").getAttribute("href"), "index.html");
  });
});

test("o CSS esconde o conteúdo e o chip do modelo em qualquer estado sem previsão", function () {
  var css = fs.readFileSync(path.join(PAINEL, "css", "app.css"), "utf8");
  assert.match(css, /body\[data-servico\]:not\(\[data-servico="verificando"\]\) #conteudo > :not\(\.servico\)/);
  assert.match(css, /body\[data-servico\] \.model-chip \{ display: none !important; \}/);
  assert.match(css, /body\[data-servico="verificando"\] #conteudo \{ visibility: hidden; \}/);
});

test("todas as telas carregam o estado do serviço e têm o #conteudo onde ele entra", function () {
  ["index.html", "triagem.html", "comparacao.html", "conformidade.html", "design.html",
    "marketing.html", "engenharia.html"].forEach(function (arquivo) {
    var fonte = fs.readFileSync(path.join(PAINEL, arquivo), "utf8");
    assert.ok(fonte.indexOf('src="js/estado_servico.js') > 0, arquivo);
    assert.ok(fonte.indexOf('id="conteudo"') > 0, arquivo);
  });
});
