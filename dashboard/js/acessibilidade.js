/* Recursos assistivos: aba na lateral direita das sete telas.
 *
 * Cada recurso mora num atributo `html[data-a11y-<id>]` com o nível escolhido
 * (1, 2, 3…), e o css/acessibilidade.css faz o resto: nenhuma tela conhece os
 * recursos, como nenhuma conhece o tema. Carregado no <head>, logo depois do
 * tema.js, para a página já abrir com a fonte e as cores escolhidas.
 *
 * A escolha vale para todas as telas e sobrevive ao fechar o navegador
 * (localStorage): quem precisa de fonte maior precisa dela sempre.
 *
 * O painel monta a si mesmo, como o do Robertão: cada tela só inclui este
 * arquivo e o css/acessibilidade.css.
 */

var ACESSIBILIDADE = (function () {
  "use strict";

  var CHAVE = "thermal-predictor.acessibilidade";
  var raiz = document.documentElement;

  var GRUPOS = [
    { id: "texto", rotulo: "Texto" },
    { id: "leitura", rotulo: "Leitura e navegação" },
    { id: "cor", rotulo: "Cor" },
    { id: "libras", rotulo: "Libras e voz" }
  ];

  /* Cada recurso: { id, grupo, rotulo, icone, niveis: ["…"] } para os que
     alternam por níveis, ou { id, grupo, rotulo, icone, acao: fn } para os que
     só disparam algo (abrir o tradutor, ouvir o resumo). `aoAplicar(nivel)` é
     opcional, para o que o CSS sozinho não resolve. */
  var recursos = [];
  var estado = lerGuardado();
  var ouvintes = [];

  var lancador = null;
  var painel = null;
  var anuncio = null;
  var cartoes = {};

  function lerGuardado() {
    try {
      var v = JSON.parse(window.localStorage.getItem(CHAVE) || "{}");
      return v && typeof v === "object" ? v : {};
    } catch (e) { return {}; }
  }

  function guardar() {
    try { window.localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (e) { /* sem armazenamento, vale só a página */ }
  }

  function nivel(id) {
    var n = estado[id] | 0;
    var r = buscar(id);
    return r && r.niveis && n > 0 && n <= r.niveis.length ? n : 0;
  }

  function buscar(id) {
    for (var i = 0; i < recursos.length; i++) if (recursos[i].id === id) return recursos[i];
    return null;
  }

  // Cópia do estado em vigor: { fonte: 2, contraste: 1, … }, só os ligados.
  function atual() {
    var copia = {};
    recursos.forEach(function (r) { if (r.niveis && nivel(r.id)) copia[r.id] = nivel(r.id); });
    return copia;
  }

  function aplicarAtributo(r) {
    var n = nivel(r.id);
    if (n) raiz.setAttribute("data-a11y-" + r.id, String(n));
    else raiz.removeAttribute("data-a11y-" + r.id);
  }

  function avisar(id) {
    var detalhe = { id: id, nivel: nivel(id), estado: atual() };
    ouvintes.forEach(function (fn) { fn(detalhe); });
    document.dispatchEvent(new CustomEvent("acessibilidade:mudou", { detail: detalhe }));
  }

  function definir(id, n) {
    var r = buscar(id);
    if (!r || !r.niveis) return;
    if (n > 0 && n <= r.niveis.length) estado[id] = n;
    else delete estado[id];
    guardar();
    aplicarAtributo(r);
    if (r.aoAplicar) r.aoAplicar(nivel(id));
    sincronizarCartao(r);
    avisar(id);
  }

  // Um clique avança um nível; depois do último, desliga.
  function ciclar(id) {
    var r = buscar(id);
    if (!r || !r.niveis) return;
    var proximo = nivel(id) + 1;
    definir(id, proximo > r.niveis.length ? 0 : proximo);
    var n = nivel(id);
    anunciar(r.rotulo + (n ? ": " + r.niveis[n - 1] : ": desligado"));
  }

  function restaurar() {
    var ligados = Object.keys(atual());
    estado = {};
    guardar();
    recursos.forEach(function (r) {
      if (!r.niveis) return;
      aplicarAtributo(r);
      if (r.aoAplicar && ligados.indexOf(r.id) >= 0) r.aoAplicar(0);
      sincronizarCartao(r);
    });
    ligados.forEach(avisar);
    anunciar("Recursos restaurados");
  }

  // `fn({ id, nivel, estado })` a cada troca; quem pinta por script redesenha aqui.
  function aoMudar(fn) { ouvintes.push(fn); }

  function registrar(r) {
    if (buscar(r.id)) return;
    recursos.push(r);
    if (r.niveis) aplicarAtributo(r);
    if (painel) montarCartao(r);
    if (r.aoAplicar && nivel(r.id) && document.readyState !== "loading") r.aoAplicar(nivel(r.id));
  }

  /* ----- Painel ----- */

  var ICONE_LANCADOR =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="4.2" r="1.9" fill="currentColor" stroke="none"></circle>' +
    '<path d="M4.5 8.2c2.5.8 5 1.2 7.5 1.2s5-.4 7.5-1.2"></path>' +
    '<path d="M12 9.4v4.8M12 14.2l-3 6.6M12 14.2l3 6.6"></path></svg>';

  function anunciar(texto) {
    if (!anuncio) return;
    anuncio.textContent = "";
    window.setTimeout(function () { anuncio.textContent = texto; }, 30);
  }

  function montarLancador() {
    lancador = document.createElement("button");
    lancador.type = "button";
    lancador.className = "a11y-lancador";
    lancador.setAttribute("aria-expanded", "false");
    lancador.setAttribute("aria-controls", "a11y-painel");
    lancador.innerHTML = '<span class="a11y-lancador__rotulo">Recursos assistivos</span>' + ICONE_LANCADOR;
    lancador.addEventListener("click", function () { alternar(); });
    document.body.appendChild(lancador);
  }

  function montarPainel() {
    painel = document.createElement("section");
    painel.className = "a11y-painel";
    painel.id = "a11y-painel";
    painel.hidden = true;
    painel.setAttribute("role", "dialog");
    painel.setAttribute("aria-labelledby", "a11y-titulo");

    var cabecalho = document.createElement("header");
    cabecalho.className = "a11y-painel__cabecalho";
    cabecalho.innerHTML =
      '<h2 class="a11y-painel__titulo" id="a11y-titulo">Recursos assistivos</h2>' +
      '<button type="button" class="a11y-painel__fechar" aria-label="Fechar recursos assistivos">' +
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      '<path d="M3 3l8 8M11 3l-8 8"></path></svg></button>';
    cabecalho.querySelector("button").addEventListener("click", function () { alternar(true); });
    painel.appendChild(cabecalho);

    var corpo = document.createElement("div");
    corpo.className = "a11y-painel__corpo";
    GRUPOS.forEach(function (g) {
      var secao = document.createElement("section");
      secao.className = "a11y-grupo";
      secao.dataset.grupo = g.id;
      secao.hidden = true;
      secao.setAttribute("aria-labelledby", "a11y-grupo-" + g.id);
      secao.innerHTML = '<h3 class="a11y-grupo__titulo" id="a11y-grupo-' + g.id + '">' + g.rotulo + "</h3>";
      var grade = document.createElement("div");
      grade.className = "a11y-grupo__grade";
      secao.appendChild(grade);
      corpo.appendChild(secao);
    });
    painel.appendChild(corpo);

    var rodape = document.createElement("footer");
    rodape.className = "a11y-painel__rodape";
    var restaurarBotao = document.createElement("button");
    restaurarBotao.type = "button";
    restaurarBotao.className = "a11y-restaurar";
    restaurarBotao.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 1 0 1.7-4"></path>' +
      '<path d="M2.5 2.2v3h3"></path></svg>Restaurar recursos';
    restaurarBotao.addEventListener("click", restaurar);
    rodape.appendChild(restaurarBotao);

    var nota = document.createElement("p");
    nota.className = "a11y-painel__nota";
    nota.textContent = "As escolhas valem para todas as telas e ficam salvas neste navegador.";
    rodape.appendChild(nota);
    painel.appendChild(rodape);

    anuncio = document.createElement("p");
    anuncio.className = "sr-only";
    anuncio.setAttribute("role", "status");
    anuncio.setAttribute("aria-live", "polite");
    painel.appendChild(anuncio);

    painel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.stopPropagation(); alternar(true); }
    });

    document.body.appendChild(painel);
    recursos.forEach(montarCartao);
  }

  function montarCartao(r) {
    var secao = painel.querySelector('.a11y-grupo[data-grupo="' + r.grupo + '"]');
    if (!secao) return;
    var cartao = document.createElement("button");
    cartao.type = "button";
    cartao.className = "a11y-cartao";
    cartao.dataset.recurso = r.id;

    var pontos = "";
    if (r.niveis && r.niveis.length > 1) {
      pontos = '<span class="a11y-cartao__pontos" aria-hidden="true">' +
        r.niveis.map(function () { return "<i></i>"; }).join("") + "</span>";
    }
    cartao.innerHTML =
      '<span class="a11y-cartao__topo"><span class="a11y-cartao__icone" aria-hidden="true">' + r.icone + "</span>" + pontos + "</span>" +
      '<span class="a11y-cartao__rotulo">' + r.rotulo + "</span>" +
      '<span class="a11y-cartao__nivel" aria-hidden="true"></span>';

    cartao.addEventListener("click", function () {
      if (r.niveis) ciclar(r.id);
      else if (r.acao) r.acao(cartao);
    });
    secao.querySelector(".a11y-grupo__grade").appendChild(cartao);
    secao.hidden = false;
    cartoes[r.id] = cartao;
    sincronizarCartao(r);
  }

  function sincronizarCartao(r) {
    var cartao = cartoes[r.id];
    if (!cartao || !r.niveis) return;
    var n = nivel(r.id);
    var total = r.niveis.length;
    cartao.setAttribute("aria-pressed", n ? "true" : "false");
    cartao.querySelector(".a11y-cartao__nivel").textContent = n ? r.niveis[n - 1] : "";
    Array.prototype.forEach.call(cartao.querySelectorAll(".a11y-cartao__pontos i"), function (p, i) {
      p.classList.toggle("is-on", i < n);
    });
    var descricao = r.rotulo + (n
      ? ", ligado: " + r.niveis[n - 1] + (total > 1 ? ", opção " + n + " de " + total : "")
      : (total > 1 ? ", desligado, " + total + " opções" : ", desligado"));
    cartao.setAttribute("aria-label", descricao);
  }

  function alternar(fechar) {
    if (!painel) return;
    var abrir = fechar === true ? false : painel.hidden;
    painel.hidden = !abrir;
    lancador.setAttribute("aria-expanded", abrir ? "true" : "false");
    lancador.setAttribute("aria-label", abrir ? "Fechar recursos assistivos" : "Abrir recursos assistivos");
    if (abrir) {
      var primeiro = painel.querySelector(".a11y-cartao") || painel.querySelector(".a11y-painel__fechar");
      if (primeiro) primeiro.focus();
    } else if (fechar === true) {
      lancador.focus();
    }
  }

  /* ----- Recursos ----- */

  var SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

  /* Tudo no painel está em rem: a fonte da raiz escala texto, espaço e
     controle juntos, e a grade reflui em vez de cortar. */
  var ESCALAS = [1, 1.15, 1.3, 1.5];

  /* Media query em rem não enxerga a fonte da raiz: mede sempre pelos 16px do
     navegador. Com a fonte a 150% numa tela de 1366px, a página continuaria
     no arranjo de tela larga com tudo maior, e as colunas estourariam. Aqui
     cada limite de largura cresce na mesma proporção da fonte, como faz o
     zoom do navegador: a tela passa ao arranjo que já foi desenhado para a
     largura equivalente, em vez de um arranjo novo e não testado. */
  var LIMITE = /((?:min|max)-width\s*:\s*)([\d.]+)(rem|em|px)/g;
  var originais = typeof WeakMap === "function" ? new WeakMap() : null;

  function escalarLimites(escala) {
    if (!originais) return;
    Array.prototype.forEach.call(document.styleSheets, function (folha) {
      // Os limites desta folha já são pensados em px de tela, sem escala.
      if (folha.href && folha.href.indexOf("acessibilidade.css") >= 0) return;
      var regras;
      try { regras = folha.cssRules; } catch (e) { return; /* folha de outra origem */ }
      percorrer(regras, escala);
    });
  }

  function percorrer(regras, escala) {
    if (!regras) return;
    Array.prototype.forEach.call(regras, function (regra) {
      if (regra.media && regra.cssRules) {
        if (!originais.has(regra)) originais.set(regra, regra.media.mediaText);
        var original = originais.get(regra);
        if (LIMITE.test(original)) {
          LIMITE.lastIndex = 0;
          var novo = original.replace(LIMITE, function (_, prefixo, valor, unidade) {
            return prefixo + +(parseFloat(valor) * escala).toFixed(3) + unidade;
          });
          if (regra.media.mediaText !== novo) regra.media.mediaText = novo;
        }
        LIMITE.lastIndex = 0;
        percorrer(regra.cssRules, escala);
      }
    });
  }

  /* No celular a fonte para em 115% (css/acessibilidade.css): 150% numa tela
     de 390px equivale a uma de 260px, largura para a qual o painel não foi
     desenhado. A pinça do celular continua ampliando. */
  var CELULAR = window.matchMedia ? window.matchMedia("(max-width: 600px)") : null;

  function aplicarEscala() {
    var escala = ESCALAS[nivel("fonte")];
    if (CELULAR && CELULAR.matches) escala = Math.min(escala, ESCALAS[1]);
    escalarLimites(escala);
  }

  if (CELULAR && CELULAR.addEventListener) CELULAR.addEventListener("change", aplicarEscala);

  registrar({
    id: "fonte", grupo: "texto", rotulo: "Tamanho da fonte",
    icone: SVG + '<path d="M3 19L8.5 5 14 19M5.2 14h6.6M18.5 7v6M15.5 10h6"></path></svg>',
    niveis: ["115%", "130%", "150%"],
    aoAplicar: aplicarEscala
  });

  registrar({
    id: "legivel", grupo: "texto", rotulo: "Fonte legível",
    icone: SVG + '<rect x="3" y="3" width="18" height="18" rx="2.5"></rect><path d="M7.5 16.5L12 7l4.5 9.5M9.2 13h5.6"></path></svg>',
    niveis: ["Atkinson Hyperlegible"]
  });

  registrar({
    id: "linhas", grupo: "texto", rotulo: "Espaço entre linhas",
    icone: SVG + '<path d="M11 6h10M11 12h10M11 18h10M5 4v16M3 6.5L5 4l2 2.5M3 17.5L5 20l2-2.5"></path></svg>',
    niveis: ["Leve", "Médio", "Amplo"]
  });

  registrar({
    id: "letras", grupo: "texto", rotulo: "Espaço entre letras",
    icone: SVG + '<path d="M4 13L7.5 4 11 13M5.3 10h4.4M14 13V4h3a2.25 2.25 0 0 1 0 4.5h-3h3.5a2.25 2.25 0 0 1 0 4.5H14M3 18h18M5.5 15.5L3 18l2.5 2.5M18.5 15.5L21 18l-2.5 2.5"></path></svg>',
    niveis: ["Leve", "Médio", "Amplo"]
  });

  registrar({
    id: "links", grupo: "leitura", rotulo: "Destaque de links e foco",
    icone: SVG + '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path></svg>',
    niveis: ["Sublinhado", "Realçado"]
  });

  /* Menos movimento: vale o pedido do sistema ou o recurso ligado aqui. O 3D e
     a passagem para a triagem já consultavam `prefers-reduced-motion`; agora
     consultam este objeto, com a mesma forma de um MediaQueryList. */
  var MOVIMENTO_SISTEMA = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };
  var movimentoReduzido = {
    get matches() { return MOVIMENTO_SISTEMA.matches || nivel("animacoes") > 0; }
  };

  registrar({
    id: "animacoes", grupo: "leitura", rotulo: "Pausar animações",
    icone: SVG + '<circle cx="12" cy="12" r="9"></circle><path d="M10 9v6M14 9v6"></path></svg>',
    niveis: ["Pausadas"]
  });

  registrar({
    id: "contraste", grupo: "cor", rotulo: "Alto contraste",
    icone: SVG + '<circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"></path></svg>',
    niveis: ["Reforçado", "Máximo"]
  });

  /* As folhas antes deste script já estão prontas. As que carregarem depois
     (inclusive as recarregadas pelo Live Server) chegam com os limites
     originais e são escaladas quando terminam de carregar. */
  if (nivel("fonte")) aplicarEscala();
  document.addEventListener("load", function (e) {
    if (e.target && e.target.tagName === "LINK" && nivel("fonte")) aplicarEscala();
  }, true);

  function iniciar() {
    montarLancador();
    montarPainel();
    lancador.setAttribute("aria-label", "Abrir recursos assistivos");
    recursos.forEach(function (r) { if (r.aoAplicar && nivel(r.id)) r.aoAplicar(nivel(r.id)); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();

  return {
    atual: atual,
    nivel: nivel,
    definir: definir,
    restaurar: restaurar,
    aoMudar: aoMudar,
    registrar: registrar,
    movimentoReduzido: movimentoReduzido,
    CHAVE: CHAVE
  };
})();
