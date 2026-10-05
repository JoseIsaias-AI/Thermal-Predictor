/* Cliente da API de predição: POST /predicao e GET /saude, /modelos, /desempenho e
 * /catalogo.
 *
 * Toda chamada resolve com {ok, dados} ou {ok: false, erro} e nunca rejeita: quem chama
 * decide o que mostrar. Os subcampos vazios de `losses` não são enviados, porque a API
 * recusa campo nulo explícito.
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

  /* A API de predição responde na porta 8001; a 8000 é a do Robertão (assistente/chat.js).
     `?predicao=` muda só esta porta, e o host fica fixo em 127.0.0.1 para um link de fora
     não apontar o painel a outro servidor. */
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
          /* Erro da API vem como {"detail": {"erro", "mensagem"}}; a mensagem de lá explica o caso
             melhor que a genérica daqui, que só entra se ela vier vazia. */
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
     onde sai a confiança da previsão (`js/leitura/confianca.js`). */
  function modelos(opcoes) { return obter("/modelos", opcoes); }

  /* `GET /desempenho`: as métricas agregadas do modelo final, que a tela de
     engenharia exibe (`js/leitura/desempenho_modelo.js`). */
  function desempenho(opcoes) { return obter("/desempenho", opcoes); }

  /* `GET /catalogo`: as configurações históricas com a previsão do modelo para
     cada uma (`js/nucleo/catalogo_modelo.js`). */
  function catalogo(opcoes) { return obter("/catalogo", opcoes); }

  return {
    baseDaApi: baseDaApi,
    saude: saude,
    modelos: modelos,
    desempenho: desempenho,
    catalogo: catalogo,
    versaoDaSaude: versaoDaSaude,
    montarCorpo: montarCorpo,
    prever: prever,
    CAMPOS_OBRIGATORIOS: CAMPOS_OBRIGATORIOS,
    MENSAGENS: MENSAGENS
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = API_PREDICAO;
