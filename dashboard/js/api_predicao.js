/* Cliente do endpoint POST /predicao do backend de inferência.
 *
 * Rodar os testes:
 *   node --test dashboard/testes/api_predicao.test.js
 *
 * Sem DOM: `app.js` chama, os testes também. O módulo não decide o que mostrar
 * ao usuário — devolve um resultado e quem chama escolhe a tela. Essa divisão
 * existe porque o painel precisa continuar abrindo por `file://` com a API
 * fora do ar: uma falha de rede aqui vira um resultado comum, nunca uma
 * exceção que derrube a página.
 *
 * O corpo da requisição é o mesmo objeto que `collectInput()` monta no
 * formulário, porque `js/schema.js` e `dashboard/api/dominio/esquema_features.json`
 * saem do mesmo vocabulário (Seção 4.2.2 da documentação). A única diferença é
 * que os subcampos vazios de `losses` não viajam: a API recusa campo
 * desconhecido (`extra="forbid"`) e trata ausente como nulo.
 */

var API_PREDICAO = (function () {
  "use strict";

  var CAMPOS_OBRIGATORIOS = [
    "blower_direction",
    "housing",
    "board_position",
    "run_case",
    "deflector_hole",
    "material_coil_support"
  ];

  var TEMPO_LIMITE_MS = 15000;

  /* Mesma regra de `js/chat.js`: a porta 8000 é a do README, `?api=8010` troca
     sem editar arquivo, e o host é sempre 127.0.0.1 — assim um link recebido de
     fora não consegue apontar o painel para outro servidor. */
  function baseDaApi(janela) {
    var w = janela || (typeof window !== "undefined" ? window : {});

    if (w.PREDICAO_API_BASE) return w.PREDICAO_API_BASE;

    var busca = (w.location && w.location.search) || "";
    var porta = /[?&]api=(\d{2,5})(?:&|$)/.exec(busca);

    return "http://127.0.0.1:" + (porta ? porta[1] : "8000");
  }

  /* Normaliza o que o formulário coletou para o contrato de `RequisicaoPredicao`.
     Devolve `null` quando falta campo obrigatório, para o chamador tratar isso
     como erro de preenchimento e não gastar uma ida à rede. */
  function montarCorpo(entrada) {
    if (!entrada) return null;

    var corpo = {};
    var faltando = false;

    CAMPOS_OBRIGATORIOS.forEach(function (campo) {
      var valor = entrada[campo];

      if (valor === null || valor === undefined || valor === "") {
        faltando = true;
        return;
      }

      corpo[campo] = valor;
    });

    if (faltando) return null;

    var perdas = entrada.losses || {};

    if (!perdas.present) return null;

    corpo.losses = { present: perdas.present };

    // `config` e `order` só existem com perdas declaradas, e a API recusa nulo
    // explícito em campo que ela trata como ausente.
    ["config", "order"].forEach(function (sub) {
      if (perdas[sub] !== null && perdas[sub] !== undefined && perdas[sub] !== "") {
        corpo.losses[sub] = perdas[sub];
      }
    });

    return corpo;
  }

  var MENSAGENS = {
    validacao:
      "A configuração informada está fora do vocabulário aceito pelo modelo. " +
      "Revise os campos e tente de novo.",
    indisponivel:
      "O modelo preditivo não está disponível nesta execução. " +
      "Os números exibidos seguem sendo de demonstração.",
    falha: "O servidor de previsão falhou ao processar a configuração.",
    rede:
      "Não foi possível falar com o servidor de previsão. " +
      "Confira se a API está no ar e tente de novo.",
    tempo: "O servidor de previsão demorou demais para responder."
  };

  function erro(tipo, status, detalhe) {
    return {
      ok: false,
      erro: {
        tipo: tipo,
        status: status || null,
        mensagem: detalhe || MENSAGENS[tipo] || MENSAGENS.falha
      }
    };
  }

  function tipoDoStatus(status) {
    if (status === 422) return "validacao";
    if (status === 503) return "indisponivel";
    return "falha";
  }

  /* Envia a configuração e devolve uma promessa que **sempre** resolve: com
     `{ok: true, dados}` ou com `{ok: false, erro}`. Nunca rejeita, para que o
     chamador não precise de try/catch em volta de cada uso. */
  function prever(entrada, opcoes) {
    opcoes = opcoes || {};

    var buscar = opcoes.fetch || (typeof fetch !== "undefined" ? fetch : null);
    var base = opcoes.base || baseDaApi(opcoes.janela);
    var limite = opcoes.tempoLimiteMs || TEMPO_LIMITE_MS;
    var corpo = montarCorpo(entrada);

    if (!corpo) {
      return Promise.resolve(
        erro("validacao", null, "Preencha todos os campos obrigatórios antes de prever.")
      );
    }

    if (!buscar) {
      return Promise.resolve(erro("rede", null, "Este navegador não suporta requisições."));
    }

    var controle = typeof AbortController !== "undefined" ? new AbortController() : null;
    var relogio = null;
    var expirou = false;

    if (controle && typeof setTimeout !== "undefined") {
      relogio = setTimeout(function () {
        expirou = true;
        controle.abort();
      }, limite);
    }

    function encerrar() {
      if (relogio !== null && typeof clearTimeout !== "undefined") clearTimeout(relogio);
    }

    var requisicao = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo)
    };

    if (controle) requisicao.signal = controle.signal;

    return buscar(base + "/predicao", requisicao)
      .then(function (resposta) {
        encerrar();

        if (!resposta.ok) {
          // O corpo de erro traz `detalhe`; se vier vazio ou ilegível, a
          // mensagem padrão do tipo cobre.
          return resposta
            .json()
            .catch(function () { return {}; })
            .then(function (dados) {
              return erro(tipoDoStatus(resposta.status), resposta.status, dados && dados.detalhe);
            });
        }

        return resposta.json().then(function (dados) {
          return { ok: true, dados: dados, enviado: corpo };
        });
      })
      .catch(function (causa) {
        encerrar();

        if (expirou) return erro("tempo");

        return erro("rede", null, causa && causa.mensagem);
      });
  }

  return {
    baseDaApi: baseDaApi,
    montarCorpo: montarCorpo,
    prever: prever,
    CAMPOS_OBRIGATORIOS: CAMPOS_OBRIGATORIOS,
    MENSAGENS: MENSAGENS
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = API_PREDICAO;
