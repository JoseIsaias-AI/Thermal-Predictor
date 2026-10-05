/* Testes da configuração que segue o usuário de tela em tela.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/navegacao.test.js
 *
 * O que se prende aqui é o defeito que motivou o módulo: a partir de
 * conformidade, design e comparação, os links do menu perdiam a configuração e
 * a tela seguinte abria sem ela. O teste lê os links de cada HTML como estão no
 * arquivo e confere que, a partir de qualquer tela, todos os destinos recebem
 * a configuração.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var D = require("./apoio/dom_duble.js");
var NAV = require("../js/nucleo/navegacao.js");

var PAINEL = path.join(__dirname, "..");
var TELAS = ["index.html", "triagem.html", "comparacao.html", "conformidade.html",
  "design.html", "marketing.html", "engenharia.html"];

var CONFIG =
  "blower_direction=To%20Front&housing=Closed&board_position=Center&run_case=Pyro" +
  "&deflector_hole=Closed&material_coil_support=Aluminium&losses.present=none";

function html(tela) { return fs.readFileSync(path.join(PAINEL, tela), "utf8"); }

/* Os links que o módulo reescreve, como estão no HTML: os do menu e os
   marcados com `data-leva-configuracao`. */
function linksDoHtml(tela) {
  var achados = [];
  var re = /<a\s([^>]*)>/g;
  var m;
  while ((m = re.exec(html(tela)))) {
    var attrs = m[1];
    var href = /href="([^"]*)"/.exec(attrs);
    if (!href) continue;
    var menu = /class="nav__link"/.test(attrs);
    var leva = /data-leva-configuracao/.test(attrs);
    if (menu || leva) achados.push({ href: href[1], menu: menu, leva: leva });
  }
  return achados;
}

function documentoCom(links) {
  var doc = D.criarDocumento();
  links.forEach(function (l) {
    var a = doc.createElement("a");
    if (l.menu) a.className = "nav__link";
    if (l.leva) a.setAttribute("data-leva-configuracao", "");
    a.setAttribute("href", l.href);
    doc.body.appendChild(a);
  });
  return doc;
}

test("todas as telas carregam o módulo antes dos scripts da tela", function () {
  TELAS.forEach(function (tela) {
    var fonte = html(tela);
    var nav = fonte.indexOf('src="js/nucleo/navegacao.js');
    assert.ok(nav > 0, tela + " não carrega js/nucleo/navegacao.js");
    var tela_js = fonte.indexOf('src="js/telas/' + (tela === "index.html" ? "consulta" : tela.replace(".html", "")) + ".js");
    assert.ok(tela_js > nav, tela + ": o módulo tem de vir antes do script da tela");
  });
});

test("a partir de qualquer tela, todo link do menu leva a configuração", function () {
  // A consulta não tem menu: dela se sai pelo envio do formulário.
  TELAS.slice(1).forEach(function (origem) {
    var links = linksDoHtml(origem).filter(function (l) { return l.menu; });
    assert.equal(links.length, 7, origem + ": o menu tem as sete telas");

    var doc = documentoCom(links);
    NAV.propagar(doc, "?" + CONFIG + "&cfg=CFG-01,CFG-02");

    doc.querySelectorAll(".nav__link").forEach(function (a) {
      var href = a.getAttribute("href");
      assert.equal(href.split("?")[1], CONFIG, origem + " → " + href);
    });
  });
});

test("\"Alterar configuração\" volta à consulta com a configuração", function () {
  ["triagem.html", "conformidade.html", "design.html", "marketing.html"].forEach(function (tela) {
    var alterar = linksDoHtml(tela).filter(function (l) { return l.leva && l.href === "index.html"; });
    assert.equal(alterar.length, 1, tela + ": falta data-leva-configuracao no Alterar configuração");
  });

  var doc = documentoCom([{ href: "index.html", leva: true }]);
  NAV.propagar(doc, "?" + CONFIG);
  assert.equal(doc.querySelector("[data-leva-configuracao]").getAttribute("href"), "index.html?" + CONFIG);
});

test("o botão da comparação para a triagem também leva a configuração", function () {
  var lead = linksDoHtml("comparacao.html").filter(function (l) { return l.leva && /^triagem/.test(l.href); });
  assert.equal(lead.length, 1);
});

test("só viajam os fatores e a porta da API; a seleção da comparação fica", function () {
  assert.equal(NAV.buscaQueViaja("?" + CONFIG + "&cfg=CFG-01&predicao=8010&x=1"), CONFIG + "&predicao=8010");
  assert.equal(NAV.buscaQueViaja(""), "");
});

test("propagar duas vezes não acumula query, e âncora e endereço externo ficam", function () {
  var doc = documentoCom([{ href: "triagem.html#executivo", menu: true }, { href: "https://exemplo.org", menu: true }]);
  NAV.propagar(doc, "?" + CONFIG);
  NAV.propagar(doc, "?run_case=Broil%20C1");
  var links = doc.querySelectorAll(".nav__link");
  assert.equal(links[0].getAttribute("href"), "triagem.html?run_case=Broil%20C1#executivo");
  assert.equal(links[1].getAttribute("href"), "https://exemplo.org");
});

test("sem configuração na URL os links ficam como no HTML", function () {
  var doc = documentoCom([{ href: "design.html", menu: true }]);
  NAV.propagar(doc, "");
  assert.equal(doc.querySelector(".nav__link").getAttribute("href"), "design.html");
});

test("a regra não mora mais em js/nucleo/modo_leitura.js", function () {
  var fonte = fs.readFileSync(path.join(PAINEL, "js", "nucleo", "modo_leitura.js"), "utf8");
  assert.doesNotMatch(fonte, /propagarConfiguracao|TELAS_COM_CONFIGURACAO/);
});
