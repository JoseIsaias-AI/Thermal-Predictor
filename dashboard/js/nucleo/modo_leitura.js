/* Alternância entre leitura técnica e executiva, em `body[data-modo]`.
 *
 * A escolha vale para todas as telas (localStorage) e pode vir no link com #executivo
 * ou #tecnico.
 */

var MODO_LEITURA = (function () {
  "use strict";

  var CHAVE = "thermal-predictor.modo-leitura";
  var MODOS = ["tecnico", "executivo"];

  function lerGuardado() {
    try {
      var v = window.localStorage.getItem(CHAVE);
      return MODOS.indexOf(v) >= 0 ? v : null;
    } catch (e) { return null; }
  }

  function guardar(modo) {
    try { window.localStorage.setItem(CHAVE, modo); } catch (e) { /* sem armazenamento, vale só a sessão */ }
  }

  function doLink() {
    var h = (window.location.hash || "").replace(/^#/, "");
    return MODOS.indexOf(h) >= 0 ? h : null;
  }

  function atual() {
    return document.body.dataset.modo || "tecnico";
  }

  function aplicar(modo, grupo) {
    document.body.dataset.modo = modo;
    if (grupo) {
      Array.prototype.forEach.call(grupo.querySelectorAll("button[data-modo]"), function (b) {
        b.setAttribute("aria-pressed", b.dataset.modo === modo ? "true" : "false");
      });
    }
  }

  /* Liga o controle `#modo-leitura`, se a tela tiver um. Sem controle, a tela
     tem modo fixo, declarado no próprio body. */
  function iniciar() {
    var grupo = document.getElementById("modo-leitura");
    if (!grupo) return;

    aplicar(doLink() || lerGuardado() || "tecnico", grupo);

    grupo.addEventListener("click", function (evento) {
      var botao = evento.target.closest("button[data-modo]");
      if (!botao || botao.dataset.modo === atual()) return;
      aplicar(botao.dataset.modo, grupo);
      guardar(botao.dataset.modo);
      // Tira o #modo do link, senão ele venceria a escolha ao recarregar.
      if (doLink()) window.history.replaceState(null, "", window.location.pathname + window.location.search);
      // O modo novo começa do topo, onde está o que ele tem de primeiro.
      window.scrollTo(0, 0);
    });
  }

  return { iniciar: iniciar, atual: atual, MODOS: MODOS };
})();
