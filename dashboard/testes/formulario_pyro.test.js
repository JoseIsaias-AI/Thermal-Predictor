/* Testes do acoplamento entre o modo de ensaio e as perdas, no formulário.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/formulario_pyro.test.js
 *
 * `Pyro` e "sem perda declarada" são a mesma condição na base: as rodadas
 * Pyro são exatamente as rodadas sem perda, e a codificação descartou
 * `losses_present_none` por ser idêntica a `Run_Case_Pyro` (Seção 4.2.2d). A API
 * recusa a combinação nos dois sentidos; aqui se verifica que o formulário não
 * consegue montá-la, para o usuário não topar com um erro que a tela poderia ter
 * evitado.
 *
 * O teste vai até o envio de propósito. Desabilitar o `select` inteiro seria a
 * solução óbvia e estaria errada: `collectInput` deixa de fora todo campo
 * desabilitado, e um `losses.present` ausente bloquearia o envio em vez de
 * corrigi-lo. O que se desabilita é a *opção*, e é o corpo enviado que prova a
 * diferença — nenhuma asserção sobre atributos pegaria isso.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var D = require("./apoio/dom_duble.js");

var caminho = require("./apoio/fonte_painel.js").caminho;

// Os scripts da consulta, na ordem de `index.html`.
var MODULOS = [
  "tema.js", "schema.js", "navegacao.js", "fogao.js", "api_predicao.js",
  "estado_servico.js", "analise.js", "historico_sessao.js"
];

/* Carrega a tela de consulta sobre o DOM dublê e devolve o que o teste precisa
   para operá-la: os campos, o formulário e o que o envio mandou à API. */
function montarConsulta() {
  var doc = D.criarDocumento();
  var janela = D.criarJanela(doc, "");

  // O formulário tem de conter os campos, como no HTML.
  var form = doc.getElementById("prediction-form");
  form.appendChild(doc.getElementById("factor-fields"));

  /* O 3D depende de WebGL e a coreografia, de relógio: nenhum dos dois entra no
     que está em exame, que é o corpo montado a partir dos campos. */
  var nada = function () { return nada; };
  var qualquer = new Proxy({}, { get: function () { return nada; }, set: function () { return true; } });

  janela.FOGAO3D = { criar: function () { return qualquer; } };

  var ctx = vm.createContext(janela);

  vm.runInContext("var document = window.document;", ctx);

  MODULOS.forEach(function (arquivo) {
    vm.runInContext(
      fs.readFileSync(caminho(arquivo), "utf8"), ctx, { filename: arquivo }
    );
  });

  /* Intercepta antes de carregar `app.js`, que guarda as referências na carga.
     `ANALISE.executar` sai do caminho; o que interessa é o que `prever` recebeu. */
  vm.runInContext(
    "var ENVIADO = null;" +
    "API_PREDICAO.prever = function (entrada) {" +
    "  ENVIADO = entrada;" +
    "  return Promise.resolve({ ok: true, dados: {}, enviado: entrada });" +
    "};" +
    "ANALISE.executar = function () {};" +
    "API_PREDICAO.saude = function () { return Promise.resolve({ ok: true, versao: 'final-1.0' }); };",
    ctx
  );

  vm.runInContext(fs.readFileSync(caminho("consulta.js"), "utf8"), ctx, { filename: "consulta.js" });

  return {
    doc: doc,
    form: form,
    campo: function (nome) { return form.elements[nome]; },
    escolher: function (nome, valor) {
      var alvo = form.elements[nome];
      alvo.value = valor;
      alvo.dispatchEvent({ type: "change" });
    },
    enviar: function () {
      form.dispatchEvent({ type: "submit", preventDefault: function () {} });
      return vm.runInContext("ENVIADO", ctx);
    },
    montarCorpo: function (entrada) {
      return vm.runInContext("API_PREDICAO.montarCorpo", ctx)(entrada);
    },
    /* O que a tela diz quando recusa o envio: é a explicação que falta na
       asserção quando um campo obrigatório ficou de fora sem se saber qual. */
    erro: function () {
      return doc.getElementById("error-message").textContent;
    }
  };
}

function opcao(select, valor) {
  return select.options.filter(function (o) { return o.value === valor; })[0];
}

/* Os sete fatores preenchidos, menos as perdas, que o acoplamento governa. */
function preencherOsOutros(tela) {
  tela.escolher("blower_direction", "To Front");
  tela.escolher("housing", "Closed");
  tela.escolher("board_position", "Center");
  tela.escolher("deflector_hole", "Closed");
  tela.escolher("material_coil_support", "Aluminium");
}

// --------------------------------------------------------- o que a tela oferece

test('"Sem perda" não é oferecida fora de Pyro', function () {
  var tela = montarConsulta();
  var present = tela.campo("losses.present");

  assert.equal(opcao(present, "none").disabled, true);

  tela.escolher("run_case", "Broil C2");

  assert.equal(opcao(present, "none").disabled, true);
  assert.equal(opcao(present, "declared").disabled, false);
});

test("escolher Pyro fixa a perda em Sem perda e tranca as outras", function () {
  var tela = montarConsulta();
  var present = tela.campo("losses.present");

  tela.escolher("run_case", "Pyro");

  assert.equal(present.value, "none");
  assert.equal(opcao(present, "none").disabled, false);
  assert.equal(opcao(present, "declared").disabled, true);
  assert.equal(opcao(present, "missing").disabled, true);
});

test("sair de Pyro desfaz a fixação", function () {
  var tela = montarConsulta();
  var present = tela.campo("losses.present");

  tela.escolher("run_case", "Pyro");
  tela.escolher("run_case", "Broil Qualitative");

  assert.equal(present.value, "declared");
  assert.equal(opcao(present, "none").disabled, true);
  assert.equal(opcao(present, "declared").disabled, false);
});

test("o select das perdas nunca é desabilitado", function () {
  var tela = montarConsulta();
  var present = tela.campo("losses.present");

  ["Pyro", "Broil C2", "Broil C1", "Pyro"].forEach(function (modo) {
    tela.escolher("run_case", modo);
    assert.equal(
      present.disabled, false,
      "com o select desabilitado, collectInput deixaria losses.present de fora"
    );
  });
});

test("a escolha de perda que já valia é preservada", function () {
  var tela = montarConsulta();

  tela.escolher("losses.present", "missing");
  tela.escolher("run_case", "Broil C2");

  assert.equal(
    tela.campo("losses.present").value, "missing",
    "'metadado não declarado' existe fora de Pyro e não deveria ser trocado"
  );
});

// ------------------------------------------------------ o que o envio carrega

test("Pyro envia sem perda declarada, e o corpo fica completo", function () {
  var tela = montarConsulta();

  preencherOsOutros(tela);
  tela.escolher("run_case", "Pyro");

  var enviado = tela.enviar();

  assert.ok(enviado, "envio bloqueado: " + tela.erro());
  assert.equal(enviado.run_case, "Pyro");
  assert.equal(enviado.losses.present, "none");
  assert.ok(tela.montarCorpo(enviado), "a API recusaria o corpo antes de sair do painel");
});

test("Broil C2 envia perda declarada com a configuração das bobinas", function () {
  var tela = montarConsulta();

  preencherOsOutros(tela);
  tela.escolher("run_case", "Broil C2");

  // Fora de Pyro a perda não é fixada: as três opções existem na base, e a
  // escolha é de quem preenche. O envio sem ela é recusado, e com razão.
  assert.equal(tela.enviar(), null);
  assert.match(tela.erro(), /Perda declarada/);

  tela.escolher("losses.present", "declared");
  tela.escolher("losses.config", "Config S");

  var enviado = tela.enviar();

  assert.ok(enviado, "envio bloqueado: " + tela.erro());
  assert.equal(enviado.losses.present, "declared");
  assert.equal(enviado.losses.config, "Config S");
  assert.ok(tela.montarCorpo(enviado));
});

test("nenhuma sequência de escolhas monta a combinação que a base não tem", function () {
  var modos = ["Broil Qualitative", "Broil C2", "Broil C1", "Pyro"];
  var perdas = ["declared", "none", "missing"];

  modos.forEach(function (modo) {
    perdas.forEach(function (perda) {
      var tela = montarConsulta();

      preencherOsOutros(tela);

      // A ordem importa: escolher a perda antes e o modo depois é o caminho
      // em que o acoplamento precisa corrigir o que já estava escolhido.
      tela.escolher("losses.present", perda);
      tela.escolher("run_case", modo);
      tela.escolher("losses.config", "Config S");

      var enviado = tela.enviar();

      assert.ok(enviado, modo + " + " + perda + ": " + tela.erro());
      assert.equal(
        enviado.losses.present === "none", enviado.run_case === "Pyro",
        modo + " + " + perda + " montou a combinação que a base não tem"
      );
    });
  });
});
