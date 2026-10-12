/* Testes do catálogo do modelo na sessão.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/catalogo_modelo.test.js
 *
 * O catálogo vem de `GET /catalogo` e as telas o leem de forma síncrona. Aqui se prende que só
 * um catálogo completo vira `CATALOGO_MODELO`, que a tela sem ele busca e recarrega uma vez, e
 * que nada recarrega sem o catálogo gravado (sem ciclo).
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var vm = require("node:vm");

var D = require("./apoio/dom_duble.js");
var caminho = require("./apoio/fonte_painel.js").caminho;
var CM = require("../js/nucleo/catalogo_modelo.js");

function catalogo() {
  var c = vm.createContext({});
  vm.runInContext(fs.readFileSync(caminho("dados_comparacao.js"), "utf8") + ";this.C = DADOS_COMPARACAO;", c);
  return JSON.parse(JSON.stringify(c.C));
}

function montar(opcoes) {
  var doc = D.criarDocumento();
  if (opcoes.semRecarga) doc.body.dataset.catalogo = "sem-recarga";
  var janela = D.criarJanela(doc, "");
  var recargas = { n: 0 };
  janela.location.reload = function () { recargas.n += 1; };
  if (opcoes.guardado) janela.sessionStorage.setItem(CM.CHAVE, JSON.stringify(opcoes.guardado));
  janela.API_PREDICAO = {
    catalogo: function () { return Promise.resolve(opcoes.resposta || { ok: false, erro: { tipo: "rede" } }); }
  };
  var ctx = vm.createContext(janela);
  vm.runInContext("var document = window.document;", ctx);
  vm.runInContext(fs.readFileSync(caminho("catalogo_modelo.js"), "utf8"), ctx);
  return { janela: janela, recargas: recargas };
}

function depois() { return new Promise(function (r) { setTimeout(r, 0); }); }

test("catálogo guardado e completo vira o global na carga", function () {
  var guardado = catalogo();
  var t = montar({ guardado: guardado });
  assert.equal(t.janela.CATALOGO_MODELO.configuracoes.length, guardado.configuracoes.length);
  assert.equal(t.recargas.n, 0);
});

test("sem catálogo, a tela busca, guarda e recarrega uma vez", async function () {
  var t = montar({ resposta: { ok: true, dados: catalogo() } });
  assert.equal(t.janela.CATALOGO_MODELO, undefined);
  await depois();
  assert.ok(CM.lerGuardado(t.janela.sessionStorage));
  assert.equal(t.recargas.n, 1);
});

test("sem a API, nada é guardado nem recarregado", async function () {
  var t = montar({});
  await depois();
  assert.equal(t.janela.sessionStorage.getItem(CM.CHAVE), null);
  assert.equal(t.recargas.n, 0);
  assert.equal(t.janela.CATALOGO_MODELO, undefined);
});

test("na consulta, a busca só adianta o catálogo: não recarrega", async function () {
  var t = montar({ semRecarga: true, resposta: { ok: true, dados: catalogo() } });
  await depois();
  assert.ok(CM.lerGuardado(t.janela.sessionStorage));
  assert.equal(t.recargas.n, 0);
});

test("catálogo truncado não vira global", function () {
  var c = catalogo();
  c.configuracoes[0].t.pop();
  assert.equal(CM.completo(c), false);
  assert.equal(montar({ guardado: c }).janela.CATALOGO_MODELO, undefined);
});
