/* Catálogo das configurações históricas com a previsão do modelo para cada uma.
 *
 * Rodar os testes:
 *   node --test dashboard/testes/catalogo_modelo.test.js
 *
 * Vem de `GET /catalogo` e fica na sessão, como a previsão: a consulta o busca ao abrir, e a tela
 * que abre sem ele busca e recarrega. Define `CATALOGO_MODELO` antes das telas, que o leem de
 * forma síncrona (comparação, alternativas de design, RN-05). Sem o catálogo, o global fica
 * indefinido e cada tela diz que ele está indisponível, sem outra fonte no lugar.
 */

var CATALOGO_MODELO_SESSAO = (function () {
  "use strict";

  var CHAVE = "thermal_predictor.catalogo";

  function completo(catalogo) {
    return !!catalogo && Array.isArray(catalogo.pontos) && Array.isArray(catalogo.configuracoes) &&
      Array.isArray(catalogo.estados) && catalogo.configuracoes.length > 0 &&
      catalogo.configuracoes.every(function (c) {
        return c.t && c.t.length === catalogo.pontos.length && c.e && c.e.length === catalogo.pontos.length;
      });
  }

  function lerArmazenamento(w) {
    try { return w.sessionStorage || null; } catch (e) { return null; }
  }

  function lerGuardado(armazenamento) {
    try {
      var bruto = armazenamento && armazenamento.getItem(CHAVE);
      var catalogo = bruto ? JSON.parse(bruto) : null;
      return completo(catalogo) ? catalogo : null;
    } catch (e) { return null; }
  }

  function guardar(armazenamento, catalogo) {
    try {
      armazenamento.setItem(CHAVE, JSON.stringify(catalogo));
      return true;
    } catch (e) { return false; }
  }

  /* Busca o catálogo e o guarda na sessão. Resolve `true` só se ele ficou guardado. */
  function buscar(w) {
    if (typeof API_PREDICAO === "undefined") return Promise.resolve(false);
    var armazenamento = lerArmazenamento(w);

    return API_PREDICAO.catalogo({ janela: w }).then(function (resultado) {
      if (!resultado.ok || !completo(resultado.dados) || !armazenamento) return false;
      return guardar(armazenamento, resultado.dados);
    });
  }

  /* Na carga da tela: o catálogo guardado vira o global. Sem ele, busca e recarrega, a menos
     que a tela já esteja esperando a previsão, que recarrega de qualquer jeito. Só recarrega
     com o catálogo gravado na sessão, e por isso não entra em ciclo. */
  function aplicar(janela) {
    var w = janela || (typeof window !== "undefined" ? window : null);
    if (!w) return null;

    var armazenamento = lerArmazenamento(w);
    var guardado = lerGuardado(armazenamento);

    if (guardado) {
      w.CATALOGO_MODELO = guardado;
      return guardado;
    }

    if (!armazenamento) return null;

    // A consulta só adianta a busca para as telas seguintes: ela não lê o catálogo.
    var semRecarga = !!(w.document && w.document.body && w.document.body.dataset &&
      w.document.body.dataset.catalogo === "sem-recarga");

    buscar(w).then(function (guardou) {
      var esperandoPrevisao = w.PREVISAO_ORIGEM === "a_prever";
      if (guardou && !semRecarga && !esperandoPrevisao && w.location && w.location.reload) w.location.reload();
    });

    return null;
  }

  if (typeof window !== "undefined" && window.document) aplicar(window);

  return {
    CHAVE: CHAVE,
    completo: completo,
    lerGuardado: lerGuardado,
    buscar: buscar,
    aplicar: aplicar
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CATALOGO_MODELO_SESSAO;
