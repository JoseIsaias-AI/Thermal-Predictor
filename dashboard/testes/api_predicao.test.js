/* Testes do cliente do endpoint POST /predicao.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/api_predicao.test.js
 *
 * Três frentes. A montagem do corpo, conferida contra o exemplo que a própria
 * API publica em `dominio/esquema_features.json`, para o painel e o backend não
 * divergirem em silêncio. A resolução da base, que precisa recusar host de
 * fora. E o tratamento de resposta, com um `fetch` falso: cada código de erro
 * da rota vira um tipo, e nenhuma falha escapa como exceção — o painel abre por
 * `file://` com a API fora do ar.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var RAIZ = path.join(__dirname, "..", "..");
var API = require(path.join(__dirname, "..", "js", "api_predicao.js"));

var EXEMPLO = JSON.parse(
  fs.readFileSync(path.join(RAIZ, "dashboard", "api", "dominio", "esquema_features.json"), "utf8")
).exemplo_de_entrada;

/* `fetch` falso: devolve o que o teste mandar e registra como foi chamado. */
function fetchFalso(resposta, registro) {
  return function (url, opcoes) {
    if (registro) {
      registro.url = url;
      registro.opcoes = opcoes;
    }

    if (resposta instanceof Error) return Promise.reject(resposta);

    return Promise.resolve(resposta);
  };
}

function respostaJson(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: function () { return Promise.resolve(corpo); }
  };
}

// ------------------------------------------------------------------ montagem

test("montarCorpo reproduz o exemplo publicado pela API", function () {
  assert.deepEqual(API.montarCorpo(EXEMPLO), EXEMPLO);
});

test("montarCorpo descarta subcampos vazios de losses", function () {
  var corpo = API.montarCorpo({
    blower_direction: "To Front",
    housing: "Closed",
    board_position: "Center",
    run_case: "Pyro",
    deflector_hole: "Closed",
    material_coil_support: "Aluminium",
    losses: { present: "none", config: null, order: "" }
  });

  assert.deepEqual(corpo.losses, { present: "none" });
  assert.equal("config" in corpo.losses, false);
  assert.equal("order" in corpo.losses, false);
});

test("montarCorpo devolve null com campo obrigatório ausente", function () {
  API.CAMPOS_OBRIGATORIOS.forEach(function (campo) {
    var entrada = JSON.parse(JSON.stringify(EXEMPLO));
    entrada[campo] = null;
    assert.equal(API.montarCorpo(entrada), null, campo + " deveria bloquear o envio");
  });
});

test("montarCorpo devolve null sem o bloco losses", function () {
  var entrada = JSON.parse(JSON.stringify(EXEMPLO));
  delete entrada.losses;
  assert.equal(API.montarCorpo(entrada), null);
});

test("montarCorpo não acrescenta campo fora do contrato", function () {
  var entrada = JSON.parse(JSON.stringify(EXEMPLO));
  entrada.measurement_point = "IPC P11 | IPC Comp";

  var corpo = API.montarCorpo(entrada);

  assert.equal("measurement_point" in corpo, false);
  assert.deepEqual(Object.keys(corpo).sort(), Object.keys(EXEMPLO).sort());
});

// ----------------------------------------------------------------- base da API

test("baseDaApi usa a porta 8000 por padrão", function () {
  assert.equal(API.baseDaApi({ location: { search: "" } }), "http://127.0.0.1:8000");
});

test("baseDaApi aceita ?api= para trocar só a porta", function () {
  assert.equal(API.baseDaApi({ location: { search: "?api=8010" } }), "http://127.0.0.1:8010");
});

test("baseDaApi ignora host na query e nunca sai de 127.0.0.1", function () {
  var base = API.baseDaApi({ location: { search: "?api=evil.com&api=99" } });
  assert.equal(base.indexOf("http://127.0.0.1:"), 0);
  assert.equal(base.indexOf("evil.com"), -1);
});

// ------------------------------------------------------------------- previsão

test("prever envia POST com o corpo montado e devolve os dados", async function () {
  var registro = {};
  var payload = { versao_modelo: "final-1.0", preditor_e_stub: false, pontos: [], monitoramento: [] };
  var r = await API.prever(EXEMPLO, {
    fetch: fetchFalso(respostaJson(200, payload), registro),
    base: "http://127.0.0.1:8000"
  });

  assert.equal(r.ok, true);
  assert.deepEqual(r.dados, payload);
  assert.equal(registro.url, "http://127.0.0.1:8000/predicao");
  assert.equal(registro.opcoes.method, "POST");
  assert.equal(registro.opcoes.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(registro.opcoes.body), EXEMPLO);
});

test("prever devolve o que foi enviado, para a tela conferir o que pediu", async function () {
  var r = await API.prever(EXEMPLO, { fetch: fetchFalso(respostaJson(200, {})) });
  assert.deepEqual(r.enviado, EXEMPLO);
});

test("prever classifica 422 como erro de validação", async function () {
  var r = await API.prever(EXEMPLO, {
    fetch: fetchFalso(respostaJson(422, { detail: { erro: "configuracao_invalida", mensagem: "Nível fora do vocabulário." } }))
  });

  assert.equal(r.ok, false);
  assert.equal(r.erro.tipo, "validacao");
  assert.equal(r.erro.status, 422);
  assert.equal(r.erro.mensagem, "Nível fora do vocabulário.");
});

test("prever classifica 503 como modelo indisponível", async function () {
  var r = await API.prever(EXEMPLO, { fetch: fetchFalso(respostaJson(503, {})) });

  assert.equal(r.erro.tipo, "indisponivel");
  assert.equal(r.erro.mensagem, API.MENSAGENS.indisponivel);
});

test("prever classifica 500 como falha", async function () {
  var r = await API.prever(EXEMPLO, { fetch: fetchFalso(respostaJson(500, {})) });
  assert.equal(r.erro.tipo, "falha");
});

test("prever trata corpo de erro ilegível sem quebrar", async function () {
  var r = await API.prever(EXEMPLO, {
    fetch: fetchFalso({
      ok: false,
      status: 503,
      json: function () { return Promise.reject(new Error("não é json")); }
    })
  });

  assert.equal(r.erro.tipo, "indisponivel");
  assert.equal(r.erro.mensagem, API.MENSAGENS.indisponivel);
});

test("prever devolve erro de rede quando a API está fora do ar", async function () {
  var r = await API.prever(EXEMPLO, { fetch: fetchFalso(new Error("ECONNREFUSED")) });

  assert.equal(r.ok, false);
  assert.equal(r.erro.tipo, "rede");
});

test("prever bloqueia o envio quando falta campo, sem ir à rede", async function () {
  var chamou = false;
  var entrada = JSON.parse(JSON.stringify(EXEMPLO));
  entrada.housing = null;

  var r = await API.prever(entrada, {
    fetch: function () { chamou = true; return Promise.resolve(respostaJson(200, {})); }
  });

  assert.equal(chamou, false, "não deveria chamar a API com campo faltando");
  assert.equal(r.erro.tipo, "validacao");
});

test("prever nunca rejeita a promessa", async function () {
  var casos = [
    { fetch: fetchFalso(new Error("rede")) },
    { fetch: fetchFalso(respostaJson(500, {})) },
    { fetch: null }
  ];

  for (var i = 0; i < casos.length; i += 1) {
    var r = await API.prever(EXEMPLO, casos[i]);
    assert.equal(r.ok, false, "caso " + i);
    assert.ok(r.erro.mensagem, "caso " + i + " deveria ter mensagem");
  }
});
