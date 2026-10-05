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

  /* Porta 8001, que é a da API de predição no README. Não é a 8000 de
     `js/chat.js`: essa é a do Robertão, e o próprio README separa as duas para os
     dois serviços rodarem juntos. Apontar para 8000 levaria a predição ao serviço
     do chat, que não tem `POST /predicao`.

     Por isso a chave da query também é outra, `?predicao=8010`: `?api=` move o
     chat, e uma chave só moveria os dois para a mesma porta — o que não pode estar
     certo para os dois ao mesmo tempo. O host é sempre 127.0.0.1, para um link
     recebido de fora não conseguir apontar o painel a outro servidor. */
  var PORTA_PADRAO = "8001";

  function baseDaApi(janela) {
    var w = janela || (typeof window !== "undefined" ? window : {});

    if (w.PREDICAO_API_BASE) return w.PREDICAO_API_BASE;

    var busca = (w.location && w.location.search) || "";
    var porta = /[?&]predicao=(\d{2,5})(?:&|$)/.exec(busca);

    return "http://127.0.0.1:" + (porta ? porta[1] : PORTA_PADRAO);
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
      "Inicie a API de predição e tente de novo.",
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
          /* O corpo de erro da API tem a forma {"detail": {"erro", "mensagem"}}
             (dashboard/api/controladores/predicao.py). A mensagem de lá explica o
             caso ao usuário — por exemplo, que "sem perda declarada" só existe em
             rodadas Pyro — e é melhor que o texto genérico daqui. Se vier vazia ou
             ilegível, a mensagem padrão do tipo cobre. */
          return resposta
            .json()
            .catch(function () { return {}; })
            .then(function (dados) {
              var detalhe = dados && dados.detail;
              return erro(tipoDoStatus(resposta.status), resposta.status,
                          detalhe && detalhe.mensagem);
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

  /* Versão do modelo que o serviço carregou, lida de `GET /saude`: a de todos os
     subsistemas carregados, que saem do mesmo artefato. `null` quando nenhum
     carregou ou quando discordam — o chip não escolhe uma por conta própria. */
  function versaoDaSaude(saude) {
    var lista = (saude && saude.subsistemas) || [];
    var versoes = {};

    lista.forEach(function (s) {
      if (s && s.estado === "carregado" && s.versao) versoes[s.versao] = true;
    });

    var nomes = Object.keys(versoes);

    return nomes.length === 1 ? nomes[0] : null;
  }

  /* `GET /saude`, com o mesmo contrato de `prever`: a promessa sempre resolve,
     com `{ok: true, dados}` ou `{ok: false, erro}`. Serviço no ar sem modelo
     carregado conta como indisponível: ele não tem como prever. */
  function saude(opcoes) {
    opcoes = opcoes || {};

    var buscar = opcoes.fetch || (typeof fetch !== "undefined" ? fetch : null);
    var base = opcoes.base || baseDaApi(opcoes.janela);

    if (!buscar) return Promise.resolve(erro("rede", null, "Este navegador não suporta requisições."));

    return buscar(base + "/saude")
      .then(function (resposta) {
        if (!resposta.ok) return erro(tipoDoStatus(resposta.status), resposta.status);

        return resposta.json().then(function (dados) {
          if (!dados || dados.status === "sem_modelo" || !versaoDaSaude(dados)) {
            return erro("indisponivel", null);
          }
          return { ok: true, dados: dados, versao: versaoDaSaude(dados) };
        });
      })
      .catch(function () { return erro("rede"); });
  }

  /* Leitura de um endpoint `GET`, com o mesmo contrato de `prever`: a promessa
     sempre resolve, com `{ok: true, dados}` ou `{ok: false, erro}`. */
  function obter(caminho, opcoes) {
    opcoes = opcoes || {};

    var buscar = opcoes.fetch || (typeof fetch !== "undefined" ? fetch : null);
    var base = opcoes.base || baseDaApi(opcoes.janela);

    if (!buscar) return Promise.resolve(erro("rede", null, "Este navegador não suporta requisições."));

    return buscar(base + caminho)
      .then(function (resposta) {
        if (!resposta.ok) return erro(tipoDoStatus(resposta.status), resposta.status);
        return resposta.json().then(function (dados) { return { ok: true, dados: dados }; });
      })
      .catch(function () { return erro("rede"); });
  }

  /* `GET /modelos`: os metadados e as métricas de teste de cada subsistema, de
     onde sai a confiança da previsão (`js/confianca.js`). */
  function modelos(opcoes) { return obter("/modelos", opcoes); }

  /* `GET /desempenho`: as métricas agregadas do modelo final, que a tela de
     engenharia exibe (`js/desempenho_modelo.js`). */
  function desempenho(opcoes) { return obter("/desempenho", opcoes); }

  return {
    baseDaApi: baseDaApi,
    saude: saude,
    modelos: modelos,
    desempenho: desempenho,
    versaoDaSaude: versaoDaSaude,
    montarCorpo: montarCorpo,
    prever: prever,
    CAMPOS_OBRIGATORIOS: CAMPOS_OBRIGATORIOS,
    MENSAGENS: MENSAGENS
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = API_PREDICAO;
