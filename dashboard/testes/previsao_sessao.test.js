/* Testes da troca do stub pela previsão do modelo.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/previsao_sessao.test.js
 *
 * O que estes testes prendem é sobretudo o que NÃO deve acontecer: previsão de
 * outra configuração chegando à tela, resposta truncada virando tela meio
 * preenchida, e armazenamento indisponível derrubando o painel. O caminho feliz
 * é conferido valor a valor contra o objeto guardado, porque o critério do card
 * é que o exibido seja o que o backend devolveu, sem alteração.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var JS = path.join(__dirname, "..", "js");
var PS = require(path.join(JS, "previsao_sessao.js"));

/* O stub real do painel, para o teste comparar contra o que as telas usam hoje. */
var ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(JS, "dados_triagem.js"), "utf8"), ctx, {
  filename: "dados_triagem.js"
});
var STUB = ctx.DADOS_TRIAGEM;

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

function ponto(nome, temperatura, limite) {
  return {
    measurement_id: nome.toLowerCase().replace(/\s/g, "_"),
    TC_Name: nome,
    Key_Area: "Mainback",
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
      monitoramento: [ponto("Entrada do soprador P01", 48.2, null)],
      modelos: [{ subsistema: "Mainback", algoritmo: "Média RF e GB adotada", termopares: 11 }]
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
  var escolha = PS.resolver({ stub: STUB, armazenamento: guardar(CONFIG, r), busca: BUSCA });

  assert.equal(escolha.origem, "modelo");
  assert.equal(escolha.dados.versao_modelo, "final-1.0");
  assert.equal(escolha.dados.preditor_e_stub, false);
});

test("exibe exatamente o que o backend devolveu, sem alterar valor", function () {
  var r = resposta();
  var escolha = PS.resolver({ stub: STUB, armazenamento: guardar(CONFIG, r), busca: BUSCA });

  assert.deepEqual(escolha.dados, r);
  assert.equal(escolha.dados.pontos[0].temperatura_prevista_c, 211.39);
  assert.equal(escolha.dados.pontos[0].estado, "dentro_do_limite");
});

test("a previsão real tem a mesma forma do stub que as telas já consomem", function () {
  var r = resposta();
  var doStub = Object.keys(STUB).sort();
  var daApi = Object.keys(r).sort();

  doStub.forEach(function (campo) {
    assert.ok(daApi.indexOf(campo) >= 0, "falta " + campo + " na resposta da API");
  });

  Object.keys(STUB.pontos[0]).forEach(function (campo) {
    assert.ok(campo in r.pontos[0], "falta " + campo + " no ponto previsto");
  });
});

// ------------------------------------------------------------------- guardas

test("não usa previsão de outra configuração", function () {
  var outra = Object.assign({}, CONFIG, { housing: "Open" });
  var escolha = PS.resolver({ stub: STUB, armazenamento: guardar(outra, resposta()), busca: BUSCA });

  assert.equal(escolha.origem, "outra_configuracao");
  assert.equal(escolha.dados, STUB);
});

test("não usa previsão que difere só num subcampo de losses", function () {
  var outra = JSON.parse(JSON.stringify(CONFIG));
  outra.losses.order = "Back Order";

  var escolha = PS.resolver({ stub: STUB, armazenamento: guardar(outra, resposta()), busca: BUSCA });

  assert.equal(escolha.origem, "outra_configuracao");
});

test("recusa resposta sem campo do contrato", function () {
  ["pontos", "total_pontos", "configuracao", "preditor_e_stub"].forEach(function (campo) {
    var r = resposta();
    delete r[campo];

    var escolha = PS.resolver({ stub: STUB, armazenamento: guardar(CONFIG, r), busca: BUSCA });

    assert.equal(escolha.origem, "incompleta", "deveria recusar sem " + campo);
    assert.equal(escolha.dados, STUB);
  });
});

test("recusa ponto sem campo que a tela lê", function () {
  var r = resposta();
  delete r.pontos[0].margem_percentual;

  var escolha = PS.resolver({ stub: STUB, armazenamento: guardar(CONFIG, r), busca: BUSCA });

  assert.equal(escolha.origem, "incompleta");
});

test("recusa previsão sem nenhum ponto classificado", function () {
  var escolha = PS.resolver({
    stub: STUB,
    armazenamento: guardar(CONFIG, resposta({ pontos: [] })),
    busca: BUSCA
  });

  assert.equal(escolha.origem, "incompleta");
});

test("cai no stub sem armazenamento, sem lançar", function () {
  assert.equal(PS.resolver({ stub: STUB, armazenamento: null, busca: BUSCA }).origem, "stub");
  assert.equal(
    PS.resolver({ stub: STUB, armazenamento: armazenamento({}, true), busca: BUSCA }).origem,
    "stub"
  );
});

test("cai no stub com json corrompido no armazenamento", function () {
  var caixa = {};
  caixa[PS.CHAVE] = "{isto não é json";

  var escolha = PS.resolver({ stub: STUB, armazenamento: armazenamento(caixa), busca: BUSCA });

  assert.equal(escolha.origem, "stub");
  assert.equal(escolha.dados, STUB);
});

test("cai no stub sem configuração na URL", function () {
  var escolha = PS.resolver({ stub: STUB, armazenamento: guardar(CONFIG, resposta()), busca: "" });

  assert.equal(escolha.origem, "stub");
});

// ------------------------------------------------------- leitura da query

test("configuracaoDaBusca reconstrói o objeto que o formulário enviou", function () {
  assert.deepEqual(PS.configuracaoDaBusca(BUSCA), CONFIG);
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

test("aplicar troca o global quando a previsão é da configuração da URL", function () {
  var r = resposta();
  var janela = {
    DADOS_TRIAGEM: STUB,
    location: { search: BUSCA },
    sessionStorage: guardar(CONFIG, r)
  };

  var escolha = PS.aplicar(janela);

  assert.equal(escolha.origem, "modelo");
  // Cópia, e não o mesmo objeto: o dado volta de JSON.parse do armazenamento.
  assert.deepEqual(janela.DADOS_TRIAGEM, r);
  assert.notEqual(janela.DADOS_TRIAGEM, STUB);
  assert.equal(janela.PREVISAO_ORIGEM, "modelo");
});

test("aplicar preserva o stub quando não há previsão válida", function () {
  var janela = {
    DADOS_TRIAGEM: STUB,
    location: { search: BUSCA },
    sessionStorage: armazenamento({})
  };

  PS.aplicar(janela);

  assert.equal(janela.DADOS_TRIAGEM, STUB);
  assert.equal(janela.DADOS_TRIAGEM.preditor_e_stub, true);
});

test("aplicar não lança quando o navegador bloqueia sessionStorage", function () {
  var janela = {
    DADOS_TRIAGEM: STUB,
    location: { search: BUSCA },
    get sessionStorage() { throw new Error("bloqueado"); }
  };

  assert.doesNotThrow(function () { PS.aplicar(janela); });
  assert.equal(janela.DADOS_TRIAGEM, STUB);
});

// ------------------------------------------------- a barra reflete a origem

/* DOM mínimo: só os dois elementos da barra que a regra toca. */
function barraFalsa() {
  var chip = { textContent: "—" };
  var aviso = { hidden: false };

  return {
    chip: chip,
    aviso: aviso,
    documento: {
      getElementById: function (id) {
        if (id === "model-version") return chip;
        if (id === "stub-banner") return aviso;
        return null;
      }
    }
  };
}

test("com previsão real o aviso de valores sintéticos some", function () {
  var b = barraFalsa();

  PS.refletirNaBarra(b.documento, resposta());

  assert.equal(b.aviso.hidden, true, "o aviso não pode ficar sobre previsão de verdade");
  assert.equal(b.chip.textContent, "final-1.0");
});

test("com o stub o aviso continua visível", function () {
  var b = barraFalsa();

  PS.refletirNaBarra(b.documento, STUB);

  assert.equal(b.aviso.hidden, false);
  assert.equal(b.chip.textContent, "stub");
});

test("refletirNaBarra avisa quando a barra ainda não existe", function () {
  var vazio = { getElementById: function () { return null; } };

  assert.equal(PS.refletirNaBarra(vazio, resposta()), false);
  assert.equal(PS.refletirNaBarra(null, resposta()), false);
});

test("aplicar esconde o aviso ao trocar o stub pela previsão", function () {
  var b = barraFalsa();
  var janela = {
    DADOS_TRIAGEM: STUB,
    location: { search: BUSCA },
    sessionStorage: guardar(CONFIG, resposta()),
    document: b.documento
  };

  PS.aplicar(janela);

  assert.equal(b.aviso.hidden, true);
  assert.equal(b.chip.textContent, "final-1.0");
});

test("aplicar mantém o aviso quando fica no stub", function () {
  var b = barraFalsa();
  var janela = {
    DADOS_TRIAGEM: STUB,
    location: { search: BUSCA },
    sessionStorage: armazenamento({}),
    document: b.documento
  };

  PS.aplicar(janela);

  assert.equal(b.aviso.hidden, false);
  assert.equal(b.chip.textContent, "stub");
});
