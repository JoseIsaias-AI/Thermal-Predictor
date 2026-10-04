/* Troca os dados sintéticos pela previsão do modelo, quando houver uma.
 *
 * Rodar os testes:
 *   node --test dashboard/testes/previsao_sessao.test.js
 *
 * Carrega logo depois de `js/dados_triagem.js` e antes de qualquer tela, e
 * reatribui `DADOS_TRIAGEM`. A substituição acontece no lugar do dado, e não
 * em cada consumidor, porque as dez telas e módulos que leem esse objeto não
 * precisam saber de onde ele veio: a resposta de `POST /predicao` tem a mesma
 * forma do stub, campo por campo, e foi desenhada assim de propósito
 * (`dashboard/api/dominio/contratos.py`). Nenhum valor é convertido, arredondado
 * ou reordenado aqui — o que a API devolveu é o que a tela mostra.
 *
 * Três guardas antes de aceitar a previsão guardada:
 *
 *   1. A configuração dela tem de ser a da URL. Um link antigo, ou o botão
 *      voltar depois de outra consulta, traria a previsão errada para a
 *      configuração que a tela diz estar exibindo.
 *   2. O formato tem de estar completo. Resposta truncada no armazenamento
 *      vira stub, não vira tela meio preenchida.
 *   3. Qualquer falha de leitura cai no stub em silêncio. Por `file://` o
 *      navegador pode recusar `sessionStorage`, e nesse caso o painel segue
 *      funcionando como antes desta integração.
 *
 * Quem decide o aviso da barra é o próprio dado: com a previsão real,
 * `preditor_e_stub` é falso e o rótulo de valores sintéticos some sozinho.
 *
 * Um campo a resposta tem e o stub não: `modelos`, a lista de qual modelo previu
 * cada subsistema. O modelo final é uma mescla — um algoritmo escolhido por área,
 * e dentro de cinco delas a média de dois —, e as áreas não têm todas a mesma
 * qualidade: `AC Blower Inlet` não teve modelo validado. `modeloDoPonto` e
 * `pontoAferido` dão às telas esse recorte por ponto. Nos dados de demonstração o
 * bloco não existe, e a ausência é tratada como desconhecida, nunca como aprovada.
 */

var PREVISAO_SESSAO = (function () {
  "use strict";

  var CHAVE = "thermal_predictor.previsao";

  var CAMPOS_ESPERADOS = [
    "versao_modelo",
    "preditor_e_stub",
    "configuracao",
    "tolerancia_fracao",
    "total_pontos",
    "total_classificados",
    "total_monitoramento",
    "pontos",
    "monitoramento",
    "modelos"
  ];

  var CAMPOS_DO_PONTO = [
    "measurement_id",
    "TC_Name",
    "Key_Area",
    "subsistema_modelo",
    "temperatura_prevista_c",
    "limit_c",
    "is_monitor_only",
    "margem_c",
    "margem_percentual",
    "estado",
    "estado_rotulo"
  ];

  /* Mesmo formato que `paraQueryString` escreve em `js/app.js`: ponto separa o
     aninhamento de `losses`. Parser próprio, e não o de `js/leitura_publicos.js`,
     porque aquele módulo carrega depois de parte dos consumidores e este
     precisa rodar antes de todos. */
  function configuracaoDaBusca(busca) {
    var texto = (busca || "").replace(/^\?/, "");

    if (!texto) return null;

    var config = {};

    texto.split("&").forEach(function (par) {
      if (!par) return;

      var corte = par.indexOf("=");
      var chave = decodeURIComponent(par.slice(0, corte < 0 ? par.length : corte));
      var valor = corte < 0 ? "" : decodeURIComponent(par.slice(corte + 1).replace(/\+/g, " "));
      var partes = chave.split(".");

      if (partes.length === 1) {
        config[partes[0]] = valor;
        return;
      }

      if (!config[partes[0]]) config[partes[0]] = {};
      config[partes[0]][partes[1]] = valor;
    });

    return config;
  }

  /* Compara só o que a configuração declara, dos dois lados. A query string não
     carrega campo vazio, e a API não recebe subcampo nulo de `losses`, então
     ausente de um lado e ausente do outro é a mesma coisa. */
  function mesmaConfiguracao(a, b) {
    if (!a || !b) return false;

    var chaves = {};

    Object.keys(a).concat(Object.keys(b)).forEach(function (c) { chaves[c] = true; });

    return Object.keys(chaves).every(function (chave) {
      var va = a[chave];
      var vb = b[chave];

      if (va && typeof va === "object") return mesmaConfiguracao(va, vb);
      if (vb && typeof vb === "object") return false;

      // `null`, `undefined` e ausência são equivalentes nos dois lados.
      if (va === null || va === undefined || va === "") {
        return vb === null || vb === undefined || vb === "";
      }

      return String(va) === String(vb);
    });
  }

  function pontoCompleto(ponto) {
    return !!ponto && CAMPOS_DO_PONTO.every(function (campo) { return campo in ponto; });
  }

  function respostaCompleta(resposta) {
    if (!resposta || typeof resposta !== "object") return false;

    var temCampos = CAMPOS_ESPERADOS.every(function (campo) { return campo in resposta; });

    if (!temCampos) return false;
    if (!Array.isArray(resposta.pontos) || !Array.isArray(resposta.monitoramento)) return false;

    // Uma previsão sem nenhum ponto classificado não tem o que mostrar.
    if (resposta.pontos.length === 0) return false;

    return resposta.pontos.every(pontoCompleto) && resposta.monitoramento.every(pontoCompleto);
  }

  function lerGuardado(armazenamento) {
    try {
      var bruto = armazenamento.getItem(CHAVE);
      return bruto ? JSON.parse(bruto) : null;
    } catch (semLeitura) {
      return null;
    }
  }

  /* Resolve o que a tela deve exibir. Devolve sempre um objeto com `dados` e
     `origem`, para quem quiser registrar ou depurar a escolha:
       modelo            previsão real, conferida contra a configuração da URL
       stub              nada guardado, ou armazenamento indisponível
       outra_configuracao  havia previsão, mas de outra consulta
       incompleta        a previsão guardada não tem o formato esperado */
  function resolver(opcoes) {
    opcoes = opcoes || {};

    var stub = opcoes.stub;
    var armazenamento = opcoes.armazenamento;
    var busca = opcoes.busca;

    if (!armazenamento) return { dados: stub, origem: "stub" };

    var guardado = lerGuardado(armazenamento);

    if (!guardado || !guardado.resposta) return { dados: stub, origem: "stub" };

    if (!respostaCompleta(guardado.resposta)) return { dados: stub, origem: "incompleta" };

    var daUrl = configuracaoDaBusca(busca);

    // Sem configuração na URL não há o que conferir, e exibir a previsão de
    // outra consulta seria pior que exibir o stub declarado como tal.
    if (!daUrl) return { dados: stub, origem: "stub" };

    if (!mesmaConfiguracao(guardado.configuracao, daUrl)) {
      return { dados: stub, origem: "outra_configuracao" };
    }

    return { dados: guardado.resposta, origem: "modelo" };
  }

  /* Qual modelo previu este ponto. A busca é por `subsistema_modelo`, que a API
     grava em cada ponto, e nunca por `Key_Area`: as duas coisas não coincidem.
     A área `Main Vent Sys` é atendida por dois modelos — o dela e o de
     `AC Blower Inlet` —, e o modelo de `HMI / Knobs / Console` cobre as áreas
     `Oven HMI` e `CT Knobs`. Casar por área atribuiria os dois pontos do único
     modelo não validado a um modelo validado, sem erro nenhum à vista.

     Devolve `null` quando não há como saber: nos dados de demonstração, que não
     têm bloco `modelos`, e em qualquer ponto cujo subsistema não esteja na lista. */
  function modeloDoPonto(dados, ponto) {
    if (!dados || !ponto || !Array.isArray(dados.modelos)) return null;

    var achado = null;

    dados.modelos.forEach(function (modelo) {
      if (modelo && modelo.subsistema === ponto.subsistema_modelo) achado = modelo;
    });

    return achado;
  }

  /* Se o modelo que previu o ponto passou pela validação do grupo.

     Falso só com evidência: `validado === false` nos metadados do artefato. Sem
     bloco `modelos`, sem o ponto ou com `validado` ausente, devolve verdadeiro,
     porque a marca na tela é uma afirmação sobre o modelo e não deve aparecer
     por falta de informação. Hoje o único caso falso é `AC Blower Inlet`, que
     não teve modelo aprovado e cujos dois pontos a RN-03 já acompanha sem
     aprovar nem reprovar. */
  function pontoAferido(dados, ponto) {
    var modelo = modeloDoPonto(dados, ponto);
    return !modelo || modelo.validado !== false;
  }

  /* Classe da marca de procedência, definida em `css/triagem.css`. Fica aqui, e não
     repetida em cada tela, porque um erro de digitação nela não quebra nada: a marca
     aparece sem estilo nenhum, e ninguém nota. */
  var CLASSE_MARCA = "point__unvalidated";

  var TEXTO_MARCA = "modelo não validado";

  function marca(documento, titulo) {
    var span = documento.createElement("span");

    span.className = CLASSE_MARCA;
    span.textContent = TEXTO_MARCA;
    span.title = titulo;

    return span;
  }

  /* Marca de um ponto previsto por modelo que o grupo não validou, ou `null` quando
     não há o que marcar. Construída aqui porque triagem e conformidade mostram a
     mesma marca, e manter duas cópias do texto e da classe é como elas divergem. */
  function marcaDeModelo(documento, dados, ponto) {
    if (!documento || !ponto || pontoAferido(dados, ponto)) return null;

    return marca(
      documento,
      "Nenhum modelo foi validado para " + ponto.subsistema_modelo +
        ". A temperatura é uma estimativa não aferida e não sustenta aprovação."
    );
  }

  /* A mesma marca, no nível da área, para a tabela que resume por `Key_Area`: uma
     área pode reunir pontos de mais de um modelo, e o texto nomeia quais não são
     aferidos. `null` quando a lista vem vazia. */
  function marcaDeSubsistemas(documento, subsistemas) {
    if (!documento || !subsistemas || !subsistemas.length) return null;

    return marca(
      documento,
      "Nesta área há ponto previsto sem modelo validado (" + subsistemas.join(", ") +
        "). A área reúne pontos de mais de um modelo."
    );
  }

  /* A barra diz de onde vem o número, e quem decide é o próprio dado: com a
     previsão real o aviso de valores sintéticos some e o chip passa a mostrar a
     versão do modelo. A regra mora aqui, e não em cada tela, porque vale para as
     cinco e depende só de `preditor_e_stub`. Deixar isso a cargo das telas foi o
     que fez o aviso de demonstração aparecer sobre previsão de verdade. */
  function refletirNaBarra(documento, dados) {
    if (!documento || !dados) return false;

    var chip = documento.getElementById("model-version");
    var aviso = documento.getElementById("stub-banner");

    if (!chip && !aviso) return false;

    if (chip) chip.textContent = dados.versao_modelo || "—";
    if (aviso) aviso.hidden = !dados.preditor_e_stub;

    return true;
  }

  /* Reatribui o global, se houver previsão para esta configuração. Chamado uma
     vez, na carga; devolve a origem para os testes e para o console. */
  function aplicar(janela) {
    var w = janela || (typeof window !== "undefined" ? window : null);

    if (!w) return { dados: null, origem: "stub" };

    var armazenamento = null;

    // Acessar `sessionStorage` já pode lançar quando o navegador bloqueia
    // armazenamento de terceiros ou a página veio de `file://`.
    try {
      armazenamento = w.sessionStorage;
    } catch (semArmazenamento) {
      armazenamento = null;
    }

    var escolha = resolver({
      stub: w.DADOS_TRIAGEM,
      armazenamento: armazenamento,
      busca: (w.location && w.location.search) || ""
    });

    if (escolha.origem === "modelo") w.DADOS_TRIAGEM = escolha.dados;

    w.PREVISAO_ORIGEM = escolha.origem;

    /* Os scripts ficam no fim do `body` e a barra está no topo, então ela já
       existe. O ouvinte cobre a ordem que mudar depois, sem repetir a regra. */
    if (!refletirNaBarra(w.document, escolha.dados) && w.document &&
        w.document.addEventListener) {
      w.document.addEventListener("DOMContentLoaded", function () {
        refletirNaBarra(w.document, escolha.dados);
      });
    }

    return escolha;
  }

  if (typeof window !== "undefined" && window.document) aplicar(window);

  return {
    CHAVE: CHAVE,
    configuracaoDaBusca: configuracaoDaBusca,
    mesmaConfiguracao: mesmaConfiguracao,
    respostaCompleta: respostaCompleta,
    modeloDoPonto: modeloDoPonto,
    pontoAferido: pontoAferido,
    CLASSE_MARCA: CLASSE_MARCA,
    TEXTO_MARCA: TEXTO_MARCA,
    marcaDeModelo: marcaDeModelo,
    marcaDeSubsistemas: marcaDeSubsistemas,
    refletirNaBarra: refletirNaBarra,
    resolver: resolver,
    aplicar: aplicar
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PREVISAO_SESSAO;
