/* Testes da previsão do modelo que todas as telas exibem.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/previsao_sessao.test.js
 *
 * O que estes testes prendem é sobretudo o que NÃO deve acontecer: previsão de
 * outra configuração chegando à tela, resposta truncada virando tela meio
 * preenchida, número aparecendo sem a API no ar e armazenamento indisponível
 * derrubando o painel. Não existe valor de reserva: sem previsão válida, a tela
 * pede a previsão à API ou fica no estado de serviço. O caminho feliz é
 * conferido valor a valor contra o objeto guardado, porque o critério do card é
 * que o exibido seja o que o backend devolveu, sem alteração.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var D = require("./dom_duble.js");

var JS = path.join(__dirname, "..", "js");
var caminho = require("./fonte_painel.js").caminho;
var PS = require(path.join(JS, "previsao_sessao.js"));

/* A fixture no formato da resposta, para conferir que a API tem os campos que
   as telas leem. */
var ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(caminho("dados_triagem.js"), "utf8"), ctx, {
  filename: "dados_triagem.js"
});
var FIXTURE = ctx.DADOS_TRIAGEM;

var CONFIG = {
  blower_direction: "To Front",
  housing: "Closed",
  board_position: "Center",
  run_case: "Broil C2",
  deflector_hole: "Closed",
  material_coil_support: "Aluminium",
  losses: { present: "declared", config: "Config S", order: "Front Order" }
};

var BUSCA =
  "?blower_direction=To%20Front&housing=Closed&board_position=Center&run_case=Broil%20C2" +
  "&deflector_hole=Closed&material_coil_support=Aluminium" +
  "&losses.present=declared&losses.config=Config%20S&losses.order=Front%20Order";

function ponto(nome, temperatura, limite, subsistema, area) {
  return {
    measurement_id: nome.toLowerCase().replace(/\s/g, "_"),
    TC_Name: nome,
    Key_Area: area || "Mainback",
    subsistema_modelo: subsistema || "Mainback",
    temperatura_prevista_c: temperatura,
    limit_c: limite,
    is_monitor_only: limite === null,
    margem_c: limite === null ? null : limite - temperatura,
    margem_percentual: limite === null ? null : (limite - temperatura) / limite,
    estado: limite === null ? "monitoramento" : "dentro_do_limite",
    estado_rotulo: limite === null ? "Monitoramento" : "Dentro do limite"
  };
}

function resposta(extra) {
  return Object.assign(
    {
      versao_modelo: "final-1.0",
      preditor_e_stub: false,
      configuracao: CONFIG,
      tolerancia_fracao: 0.1,
      total_pontos: 2,
      total_classificados: 1,
      total_monitoramento: 1,
      pontos: [ponto("Mainback P09", 211.39, 220)],
      /* O caso real: este ponto fica na área `Main Vent Sys`, mas quem o prevê é o
         modelo de `AC Blower Inlet`, o único sem validação. Casar por área o daria
         como aferido. */
      monitoramento: [
        ponto("Entrada do soprador P01", 48.2, null, "AC Blower Inlet", "Main Vent Sys")
      ],
      modelos: [
        { subsistema: "Mainback", algoritmo: "Média RF e GB adotada", validado: true, termopares: 11 },
        { subsistema: "Main Vent Sys", algoritmo: "Média RF e GB adotada", validado: true, termopares: 5 },
        { subsistema: "AC Blower Inlet", algoritmo: "Média RF e GB adotada", validado: false, termopares: 2 }
      ]
    },
    extra || {}
  );
}

/* sessionStorage falso. `quebrado` simula o navegador que recusa o acesso. */
function armazenamento(conteudo, quebrado) {
  return {
    getItem: function (chave) {
      if (quebrado) throw new Error("armazenamento bloqueado");
      return Object.prototype.hasOwnProperty.call(conteudo, chave) ? conteudo[chave] : null;
    }
  };
}

function guardar(conf, resp) {
  var caixa = {};
  caixa[PS.CHAVE] = JSON.stringify({ configuracao: conf, resposta: resp });
  return armazenamento(caixa);
}

// -------------------------------------------------------------- caminho feliz

test("usa a previsão quando a configuração guardada é a da URL", function () {
  var r = resposta();
  var escolha = PS.resolver({ armazenamento: guardar(CONFIG, r), busca: BUSCA });

  assert.equal(escolha.origem, "modelo");
  assert.equal(escolha.dados.versao_modelo, "final-1.0");
  assert.equal(escolha.dados.preditor_e_stub, false);
});

test("exibe exatamente o que o backend devolveu, sem alterar valor", function () {
  var r = resposta();
  var escolha = PS.resolver({ armazenamento: guardar(CONFIG, r), busca: BUSCA });

  assert.deepEqual(escolha.dados, r);
  assert.equal(escolha.dados.pontos[0].temperatura_prevista_c, 211.39);
  assert.equal(escolha.dados.pontos[0].estado, "dentro_do_limite");
});

test("a fixture dos testes tem a mesma forma da resposta da API", function () {
  var r = resposta();
  var daFixture = Object.keys(FIXTURE).sort();
  var daApi = Object.keys(r).sort();

  daFixture.forEach(function (campo) {
    assert.ok(daApi.indexOf(campo) >= 0, "falta " + campo + " na resposta da API");
  });
  assert.equal(PS.respostaCompleta(FIXTURE), true);

  Object.keys(FIXTURE.pontos[0]).forEach(function (campo) {
    assert.ok(campo in r.pontos[0], "falta " + campo + " no ponto previsto");
  });
});

// ------------------------------------------------------------------- guardas

test("não usa previsão de outra configuração", function () {
  var outra = Object.assign({}, CONFIG, { housing: "Open" });
  var escolha = PS.resolver({ armazenamento: guardar(outra, resposta()), busca: BUSCA });

  assert.equal(escolha.origem, "a_prever");
  assert.equal(escolha.motivo, "outra_configuracao");
  assert.equal(escolha.dados, null);
  assert.deepEqual(escolha.configuracao, CONFIG);
});

test("não usa previsão que difere só num subcampo de losses", function () {
  var outra = JSON.parse(JSON.stringify(CONFIG));
  outra.losses.order = "Back Order";

  var escolha = PS.resolver({ armazenamento: guardar(outra, resposta()), busca: BUSCA });

  assert.equal(escolha.origem, "a_prever");
  assert.equal(escolha.motivo, "outra_configuracao");
});

test("recusa resposta sem campo do contrato", function () {
  ["pontos", "total_pontos", "configuracao", "preditor_e_stub"].forEach(function (campo) {
    var r = resposta();
    delete r[campo];

    var escolha = PS.resolver({ armazenamento: guardar(CONFIG, r), busca: BUSCA });

    assert.equal(escolha.motivo, "incompleta", "deveria recusar sem " + campo);
    assert.equal(escolha.dados, null);
  });
});

test("recusa ponto sem campo que a tela lê", function () {
  var r = resposta();
  delete r.pontos[0].margem_percentual;

  var escolha = PS.resolver({ armazenamento: guardar(CONFIG, r), busca: BUSCA });

  assert.equal(escolha.motivo, "incompleta");
});

test("recusa previsão sem nenhum ponto classificado", function () {
  var escolha = PS.resolver({
    armazenamento: guardar(CONFIG, resposta({ pontos: [] })),
    busca: BUSCA
  });

  assert.equal(escolha.motivo, "incompleta");
});

test("sem armazenamento a tela pede a previsão, sem lançar e sem valor de reserva", function () {
  var sem = PS.resolver({ armazenamento: null, busca: BUSCA });
  var bloqueado = PS.resolver({ armazenamento: armazenamento({}, true), busca: BUSCA });

  assert.equal(sem.origem, "a_prever");
  assert.equal(sem.motivo, "sem_armazenamento");
  assert.equal(sem.dados, null);
  assert.equal(bloqueado.origem, "a_prever");
  assert.equal(bloqueado.dados, null);
});

test("json corrompido no armazenamento conta como nada guardado", function () {
  var caixa = {};
  caixa[PS.CHAVE] = "{isto não é json";

  var escolha = PS.resolver({ armazenamento: armazenamento(caixa), busca: BUSCA });

  assert.equal(escolha.origem, "a_prever");
  assert.equal(escolha.motivo, "nada_guardado");
  assert.equal(escolha.dados, null);
});

test("sem configuração na URL vale a da última previsão da sessão", function () {
  var r = resposta();
  var escolha = PS.resolver({ armazenamento: guardar(CONFIG, r), busca: "" });

  assert.equal(escolha.origem, "guardada");
  assert.deepEqual(escolha.configuracao, CONFIG);
  assert.deepEqual(escolha.dados, r);
});

test("sem configuração na URL nem na sessão não há o que mostrar", function () {
  var escolha = PS.resolver({ armazenamento: armazenamento({}), busca: "" });

  assert.equal(escolha.origem, "sem_configuracao");
  assert.equal(escolha.dados, null);
});

// ------------------------------------------------------- leitura da query

test("configuracaoDaBusca reconstrói o objeto que o formulário enviou", function () {
  assert.deepEqual(PS.configuracaoDaBusca(BUSCA), CONFIG);
});

test("configuracaoDaBusca ignora o que não é fator: porta da API e seleção da comparação", function () {
  assert.deepEqual(PS.configuracaoDaBusca(BUSCA + "&predicao=8010&cfg=CFG-01,CFG-02"), CONFIG);
  assert.equal(PS.configuracaoDaBusca("?cfg=CFG-01&predicao=8010"), null);
  assert.equal(PS.configuracaoDaBusca(""), null);
});

test("buscaDaConfiguracao é o caminho inverso de configuracaoDaBusca", function () {
  assert.deepEqual(PS.configuracaoDaBusca("?" + PS.buscaDaConfiguracao(CONFIG)), CONFIG);
  assert.equal(PS.buscaDaConfiguracao({ run_case: "Pyro", losses: { present: "none", config: null } }),
    "run_case=Pyro&losses.present=none");
});

test("mesmaConfiguracao trata ausente e vazio como equivalentes", function () {
  var com = { a: "1", losses: { present: "none", config: null } };
  var sem = { a: "1", losses: { present: "none" } };

  assert.equal(PS.mesmaConfiguracao(com, sem), true);
  assert.equal(PS.mesmaConfiguracao(sem, com), true);
});

test("mesmaConfiguracao separa valores de verdade diferentes", function () {
  assert.equal(PS.mesmaConfiguracao({ a: "1" }, { a: "2" }), false);
  assert.equal(PS.mesmaConfiguracao({ a: "1" }, { a: "1", b: "2" }), false);
});

// ------------------------------------------------------------------- aplicar

/* Carrega a tela como o navegador carrega — navegação, cliente da API, estado
   do serviço e esta sessão, nessa ordem — sobre o DOM dublê. A API é falsa:
   `apiNoAr` decide `GET /saude` e `GET /modelos`, e `previsao` é o que
   `POST /predicao` devolve. `previsao_sessao.js` se aplica sozinho na carga. */
function montarTela(opcoes) {
  opcoes = opcoes || {};

  var doc = D.criarDocumento();
  var principal = doc.getElementById("conteudo");
  doc.body.appendChild(principal);
  doc.getElementById("model-chip").hidden = true;
  if (opcoes.opcional) doc.body.dataset.previsao = "opcional";

  var janela = D.criarJanela(doc, opcoes.busca === undefined ? BUSCA : opcoes.busca);
  var chamadas = { prever: [], recarregou: 0, url: [] };

  janela.location.reload = function () { chamadas.recarregou += 1; };
  janela.history = { replaceState: function (_e, _t, url) { chamadas.url.push(url); } };

  (opcoes.armazenado || []).forEach(function (par) {
    janela.sessionStorage.setItem(par[0], par[1]);
  });

  var c = vm.createContext(janela);
  vm.runInContext("var document = window.document;", c);

  ["navegacao.js", "api_predicao.js", "estado_servico.js"].forEach(function (f) {
    vm.runInContext(fs.readFileSync(caminho(f), "utf8"), c, { filename: f });
  });

  var noAr = opcoes.apiNoAr !== false;
  c.API_PREDICAO.saude = function () {
    return Promise.resolve(noAr ? { ok: true, versao: "final-1.0" } : { ok: false, erro: { tipo: "rede" } });
  };
  c.API_PREDICAO.modelos = function () {
    return Promise.resolve(noAr ? { ok: true, dados: { modelos: [] } } : { ok: false, erro: { tipo: "rede" } });
  };
  c.API_PREDICAO.prever = function (entrada) {
    chamadas.prever.push(entrada);
    return Promise.resolve(opcoes.previsao || (noAr
      ? { ok: true, dados: resposta(), enviado: CONFIG }
      : { ok: false, erro: { tipo: "rede" } }));
  };

  vm.runInContext(fs.readFileSync(caminho("previsao_sessao.js"), "utf8"), c, { filename: "previsao_sessao.js" });

  return { doc: doc, janela: janela, ctx: c, chamadas: chamadas, principal: principal };
}

function guardadoDe(conf, resp) {
  return [[PS.CHAVE, JSON.stringify({ configuracao: conf, resposta: resp })]];
}

// Deixa as promessas da carga resolverem.
function depois() { return new Promise(function (r) { setTimeout(r, 0); }); }

test("aplicar define o global e mostra a tela depois que a API confirma", async function () {
  var r = resposta();
  var t = montarTela({ armazenado: guardadoDe(CONFIG, r) });

  assert.equal(t.janela.PREVISAO_ORIGEM, "modelo");
  // Cópia, e não o mesmo objeto: o dado volta de JSON.parse do armazenamento.
  assert.deepEqual(JSON.parse(JSON.stringify(t.janela.DADOS_TRIAGEM)), r);
  // Antes da resposta da API, o conteúdo fica invisível.
  assert.equal(t.doc.body.dataset.servico, "verificando");

  await depois();

  assert.equal(t.doc.body.dataset.servico, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(t.janela.MODELOS_API)), { modelos: [] });
  assert.equal(t.doc.getElementById("model-chip").hidden, false);
  assert.equal(t.doc.getElementById("model-version").textContent, "final-1.0");
});

test("com previsão guardada e a API fora do ar, a tela fica indisponível", async function () {
  var t = montarTela({ armazenado: guardadoDe(CONFIG, resposta()), apiNoAr: false });

  await depois();

  assert.equal(t.doc.body.dataset.servico, "indisponivel");
  assert.equal(t.principal.children[0].className, "servico servico--indisponivel");
});

test("sem previsão para a configuração, a tela pede à API, guarda e recarrega", async function () {
  var t = montarTela();

  assert.equal(t.janela.DADOS_TRIAGEM, undefined, "nenhum valor de reserva entra no lugar");
  assert.equal(t.doc.body.dataset.servico, "carregando");
  assert.deepEqual(JSON.parse(JSON.stringify(t.chamadas.prever)), [CONFIG]);

  await depois();

  var guardado = JSON.parse(t.janela.sessionStorage.getItem(PS.CHAVE));
  assert.deepEqual(guardado.configuracao, CONFIG);
  assert.equal(guardado.resposta.versao_modelo, "final-1.0");
  assert.equal(t.chamadas.recarregou, 1);
});

test("sem previsão e com a API fora do ar, a tela fica indisponível e sem número", async function () {
  var t = montarTela({ apiNoAr: false });

  await depois();

  assert.equal(t.janela.DADOS_TRIAGEM, undefined);
  assert.equal(t.doc.body.dataset.servico, "indisponivel");
  assert.equal(t.chamadas.recarregou, 0);
});

test("configuração recusada pela API leva ao estado de configuração inválida", async function () {
  var t = montarTela({ previsao: { ok: false, erro: { tipo: "validacao", status: 422 } } });

  await depois();

  assert.equal(t.doc.body.dataset.servico, "configuracao_invalida");
  assert.equal(t.chamadas.recarregou, 0);
});

test("a previsão recém-guardada que não casa não vira ciclo de recarga", async function () {
  var t = montarTela({ armazenado: [[PS.CHAVE_TENTATIVA, BUSCA]] });

  await depois();

  assert.equal(t.chamadas.prever.length, 0, "não pede de novo a mesma configuração");
  assert.equal(t.doc.body.dataset.servico, "indisponivel");
});

test("sem configuração na URL, a tela adota a da sessão e reescreve a URL", function () {
  var t = montarTela({ busca: "", armazenado: guardadoDe(CONFIG, resposta()) });

  assert.equal(t.janela.PREVISAO_ORIGEM, "modelo");
  assert.equal(t.chamadas.url.length, 1);
  assert.deepEqual(PS.configuracaoDaBusca(t.chamadas.url[0].split("?")[1]), CONFIG);
});

test("sem configuração nenhuma, a tela pede uma; a opcional segue sem previsão", async function () {
  var obrigatoria = montarTela({ busca: "" });
  var opcional = montarTela({ busca: "", opcional: true });

  await depois();

  assert.equal(obrigatoria.doc.body.dataset.servico, "sem_configuracao");
  assert.equal(opcional.doc.body.dataset.servico, undefined);
  assert.equal(opcional.janela.DADOS_TRIAGEM, undefined);
});

test("aplicar não lança quando o navegador bloqueia sessionStorage", function () {
  var janela = {
    location: { search: BUSCA },
    get sessionStorage() { throw new Error("bloqueado"); }
  };

  assert.doesNotThrow(function () { PS.aplicar(janela); });
  assert.equal(janela.DADOS_TRIAGEM, undefined);
});

// ------------------------------------------------- o chip reflete a versão

/* DOM mínimo: só os dois elementos do chip. */
function barraFalsa() {
  var chip = { hidden: true };
  var versao = { textContent: "—" };

  return {
    chip: chip,
    versao: versao,
    documento: {
      getElementById: function (id) {
        if (id === "model-chip") return chip;
        if (id === "model-version") return versao;
        return null;
      }
    }
  };
}

test("com previsão do modelo o chip mostra a versão", function () {
  var b = barraFalsa();

  PS.refletirNaBarra(b.documento, resposta());

  assert.equal(b.chip.hidden, false);
  assert.equal(b.versao.textContent, "final-1.0");
});

test("sem previsão do modelo o chip fica oculto", function () {
  [null, resposta({ preditor_e_stub: true }), resposta({ versao_modelo: "" })].forEach(function (dados) {
    var b = barraFalsa();

    PS.refletirNaBarra(b.documento, dados);

    assert.equal(b.chip.hidden, true);
    assert.equal(b.versao.textContent, "—");
  });
});

test("refletirNaBarra avisa quando a barra ainda não existe", function () {
  var vazio = { getElementById: function () { return null; } };

  assert.equal(PS.refletirNaBarra(vazio, resposta()), false);
  assert.equal(PS.refletirNaBarra(null, resposta()), false);
});


// ------------------------------------------- mescla de modelos por subsistema

/* O modelo final não é um modelo só: há um algoritmo escolhido por área e, em
   cinco delas, a média de dois. O que estes testes fixam é o casamento entre
   ponto e modelo, que não pode passar por `Key_Area`: a área `Main Vent Sys`
   reúne pontos do modelo dela, validado, e do de `AC Blower Inlet`, que não é.
   Casar por área marcaria como aferidos justamente os dois pontos que ninguém
   validou. */

test("modeloDoPonto casa pelo subsistema que previu, não pela área", function () {
  var r = resposta();
  var doMonitoramento = r.monitoramento[0];

  assert.equal(doMonitoramento.Key_Area, "Main Vent Sys");
  assert.equal(doMonitoramento.subsistema_modelo, "AC Blower Inlet");

  var modelo = PS.modeloDoPonto(r, doMonitoramento);

  assert.equal(modelo.subsistema, "AC Blower Inlet");
  assert.equal(modelo.validado, false);
});

test("pontoAferido é falso no ponto do modelo sem validação", function () {
  var r = resposta();

  assert.equal(PS.pontoAferido(r, r.monitoramento[0]), false);
  assert.equal(PS.pontoAferido(r, r.pontos[0]), true);
});

test("pontoAferido não se deixa enganar pela área do ponto", function () {
  var r = resposta();

  // Mesma área do ponto não aferido, mas previsto pelo modelo validado dela.
  var daArea = ponto("Duto P01", 92.5, 150, "Main Vent Sys", "Main Vent Sys");

  assert.equal(PS.pontoAferido(r, daArea), true);
  assert.equal(PS.modeloDoPonto(r, daArea).subsistema, "Main Vent Sys");
});

test("sem bloco modelos nada é dado como não aferido", function () {
  // Ausência de informação não vira marca.
  var p = ponto("Mainback P09", 211.39, 220);

  assert.equal(PS.modeloDoPonto({ pontos: [p] }, p), null);
  assert.equal(PS.pontoAferido({ pontos: [p] }, p), true);
  assert.equal(PS.pontoAferido(null, p), true);
  assert.equal(PS.pontoAferido(resposta(), null), true);
});

test("subsistema fora da lista de modelos não vira marca", function () {
  var r = resposta();
  var orfao = ponto("Ponto Novo", 100, 150, "Subsistema Que Não Existe");

  assert.equal(PS.modeloDoPonto(r, orfao), null);
  assert.equal(PS.pontoAferido(r, orfao), true);
});

test("validado ausente não vira marca, só validado falso", function () {
  var r = resposta({
    modelos: [{ subsistema: "Mainback", algoritmo: "Média RF e GB adotada", termopares: 11 }]
  });

  assert.equal(PS.pontoAferido(r, r.pontos[0]), true);
});

test("resposta sem o bloco modelos é recusada e a tela pede a previsão de novo", function () {
  // O painel passou a depender de `modelos`; faltar é formato incompleto.
  var r = resposta();
  delete r.modelos;

  assert.equal(PS.respostaCompleta(r), false);

  var escolha = PS.resolver({ armazenamento: guardar(CONFIG, r), busca: BUSCA });
  assert.equal(escolha.origem, "a_prever");
  assert.equal(escolha.motivo, "incompleta");
});

test("ponto sem subsistema_modelo é recusado", function () {
  var r = resposta();
  delete r.pontos[0].subsistema_modelo;

  assert.equal(PS.respostaCompleta(r), false);
});
