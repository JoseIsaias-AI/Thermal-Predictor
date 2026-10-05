/* A configuração consultada segue o usuário de tela em tela.
 *
 * Rodar os testes:
 *   node --test dashboard/testes/navegacao.test.js
 *
 * Toda tela lê a configuração da query string, e é ela que diz para qual
 * configuração a previsão guardada vale (`js/nucleo/previsao_sessao.js`). Um link do
 * menu sem a query leva a tela seguinte a perder a configuração, e por isso a
 * regra mora aqui, num módulo só, carregado por todas as telas: antes ela
 * ficava em `js/nucleo/modo_leitura.js`, que só três telas carregam.
 *
 * Só viajam os fatores da configuração e a porta da API (`?predicao=`). O
 * resto da query é de cada tela — a seleção da comparação (`?cfg=`), por
 * exemplo — e não vale para as vizinhas.
 *
 * Recebem a configuração os links do menu (`.nav__link`) e os marcados com
 * `data-leva-configuracao`, como o "Alterar configuração", que volta à consulta
 * com o formulário preenchido.
 */

var NAVEGACAO = (function () {
  "use strict";

  /* Os sete fatores, `losses` aberto nos seus subcampos, no formato que
     `paraQueryString` escreve em `js/telas/consulta.js`. */
  var CHAVES_DA_CONFIGURACAO = [
    "blower_direction",
    "housing",
    "board_position",
    "run_case",
    "deflector_hole",
    "material_coil_support",
    "losses.present",
    "losses.config",
    "losses.order"
  ];

  // A porta da API de predição acompanha a configuração (`js/nucleo/api_predicao.js`).
  var CHAVES_QUE_VIAJAM = CHAVES_DA_CONFIGURACAO.concat(["predicao"]);

  var SELETOR = ".nav__link, [data-leva-configuracao]";

  /* Os pares `chave=valor` da busca que valem para as outras telas, na ordem
     em que vieram e ainda codificados, como a consulta os escreveu. */
  function buscaQueViaja(busca) {
    var texto = (busca || "").replace(/^\?/, "");

    if (!texto) return "";

    return texto.split("&").filter(function (par) {
      if (!par) return false;

      var corte = par.indexOf("=");
      var chave = decodeURIComponent(par.slice(0, corte < 0 ? par.length : corte));

      return CHAVES_QUE_VIAJAM.indexOf(chave) >= 0;
    }).join("&");
  }

  // Se a busca traz algum fator: só a porta da API não é configuração.
  function temConfiguracao(busca) {
    return buscaQueViaja(busca).split("&").some(function (par) {
      var chave = decodeURIComponent(par.split("=")[0]);
      return CHAVES_DA_CONFIGURACAO.indexOf(chave) >= 0;
    });
  }

  /* O destino com a configuração no lugar da query que ele tinha. Âncora e
     endereços de fora do painel ficam como estão. */
  function comConfiguracao(destino, busca) {
    if (!destino || /^(?:[a-z]+:|\/\/|#)/i.test(destino)) return destino;

    var corteAncora = destino.indexOf("#");
    var ancora = corteAncora < 0 ? "" : destino.slice(corteAncora);
    var semAncora = corteAncora < 0 ? destino : destino.slice(0, corteAncora);
    var pagina = semAncora.split("?")[0];
    var viaja = buscaQueViaja(busca);

    return pagina + (viaja ? "?" + viaja : "") + ancora;
  }

  /* Reescreve os links da página. Chamado na carga e de novo por quem muda a
     URL depois dela, como a previsão guardada que entra no lugar de uma URL
     sem configuração. */
  function propagar(documento, busca) {
    var doc = documento || (typeof document !== "undefined" ? document : null);

    if (!doc) return 0;

    var b = busca === undefined ? ((typeof window !== "undefined" && window.location.search) || "") : busca;
    var links = doc.querySelectorAll(SELETOR);

    Array.prototype.forEach.call(links, function (a) {
      // O destino original fica guardado: propagar duas vezes não acumula query.
      if (!a.dataset.destinoOriginal) a.dataset.destinoOriginal = a.getAttribute("href") || "";
      a.setAttribute("href", comConfiguracao(a.dataset.destinoOriginal, b));
    });

    return links.length;
  }

  if (typeof window !== "undefined" && window.document) propagar(window.document);

  return {
    CHAVES_DA_CONFIGURACAO: CHAVES_DA_CONFIGURACAO,
    buscaQueViaja: buscaQueViaja,
    temConfiguracao: temConfiguracao,
    comConfiguracao: comConfiguracao,
    propagar: propagar
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = NAVEGACAO;
