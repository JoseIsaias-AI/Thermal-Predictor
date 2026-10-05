/* Onde os testes acham os scripts que carregam: os do painel em `dashboard/js/<papel>/`
 * e as fixtures em `dashboard/testes/fixtures`.
 *
 * Os testes pedem o script pelo nome do arquivo, sem a pasta: assim mover um script de
 * papel não exige mexer em cada teste. As fixtures (`dados_triagem.js`,
 * `dados_comparacao.js`) são dados sintéticos no formato das respostas da API; nenhuma
 * tela as carrega.
 */

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var JS = path.join(__dirname, "..", "..", "js");
var FIXTURES = path.join(__dirname, "..", "fixtures");

var POR_NOME = {};
fs.readdirSync(JS).forEach(function (pasta) {
  var dentro = path.join(JS, pasta);
  if (!fs.statSync(dentro).isDirectory()) return;
  fs.readdirSync(dentro).forEach(function (arquivo) {
    if (/\.js$/.test(arquivo)) POR_NOME[arquivo] = path.join(dentro, arquivo);
  });
});

function caminho(nome) {
  if (/^dados_/.test(nome)) return path.join(FIXTURES, nome);
  if (!POR_NOME[nome]) throw new Error("Script do painel não encontrado: " + nome);
  return POR_NOME[nome];
}

// Todos os scripts do painel, com o caminho de cada um.
function todos() {
  return Object.keys(POR_NOME).sort().map(function (nome) { return { nome: nome, caminho: POR_NOME[nome] }; });
}

module.exports = { JS: JS, FIXTURES: FIXTURES, caminho: caminho, todos: todos };
