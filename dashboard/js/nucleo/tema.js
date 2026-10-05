/* Tema claro ou escuro, em `html[data-tema]`; css/base/tokens.css remapeia as cores.
 *
 * Carrega no <head> para a página não piscar. A escolha vale para a sessão, e o que é
 * pintado por script (3D, rampas) escuta `tema:mudou`.
 */

var TEMA = (function () {
  "use strict";

  var CHAVE = "thermal-predictor.tema";
  var TEMAS = ["claro", "escuro"];
  var LOGO = { claro: "../assets/dashboard/logo-whirlpool.png", escuro: "../assets/dashboard/logo-whirlpool-negativo.png" };
  var raiz = document.documentElement;

  function lerGuardado() {
    try {
      var v = window.sessionStorage.getItem(CHAVE);
      return TEMAS.indexOf(v) >= 0 ? v : null;
    } catch (e) { return null; }
  }

  function guardar(tema) {
    try { window.sessionStorage.setItem(CHAVE, tema); } catch (e) { /* sem armazenamento, vale só a página */ }
  }

  function atual() {
    return raiz.dataset.tema === "escuro" ? "escuro" : "claro";
  }

  // Valor de um token de cor, já resolvido para o tema em vigor.
  function token(nome) {
    return window.getComputedStyle(raiz).getPropertyValue(nome).trim();
  }

  /* O logotipo tem versão negativa: o texto preto vira branco e o anel
     amarelo fica como está, como pede o guia da marca sobre fundo escuro. */
  function sincronizarPagina() {
    var tema = atual();
    Array.prototype.forEach.call(document.querySelectorAll("img.masthead__logo"), function (img) {
      if (img.getAttribute("src") !== LOGO[tema]) img.setAttribute("src", LOGO[tema]);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-tema-alternar]"), function (b) {
      var escuro = tema === "escuro";
      b.setAttribute("aria-pressed", escuro ? "true" : "false");
      b.title = escuro ? "Voltar ao tema claro" : "Usar tema escuro";
    });
  }

  function aplicar(tema) {
    if (tema === atual()) return;
    /* Troca de uma vez: sem isto, cada elemento com transição de cor
       atravessaria o tema antigo no seu próprio ritmo. */
    raiz.classList.add("tema-trocando");
    raiz.dataset.tema = tema;
    sincronizarPagina();
    document.dispatchEvent(new CustomEvent("tema:mudou", { detail: { tema: tema } }));
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { raiz.classList.remove("tema-trocando"); });
    });
  }

  function alternar() {
    var novo = atual() === "escuro" ? "claro" : "escuro";
    aplicar(novo);
    guardar(novo);
  }

  // `fn(tema)` a cada troca; quem pinta por script redesenha aqui.
  function aoMudar(fn) {
    document.addEventListener("tema:mudou", function (e) { fn(e.detail.tema); });
  }

  raiz.dataset.tema = lerGuardado() || "claro";

  document.addEventListener("DOMContentLoaded", sincronizarPagina);
  /* Ligado já no <head>: o DOMContentLoaded espera o three.js, e o botão
     aparece antes disso. */
  document.addEventListener("click", function (evento) {
    if (evento.target.closest && evento.target.closest("[data-tema-alternar]")) alternar();
  });

  return { atual: atual, aoMudar: aoMudar, token: token, TEMAS: TEMAS };
})();
