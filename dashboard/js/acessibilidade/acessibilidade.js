/* Recursos assistivos: aba na lateral direita das sete telas.
 *
 * Cada recurso mora num atributo `html[data-a11y-<id>]` com o nível escolhido
 * (1, 2, 3…), e o css/base/acessibilidade.css faz o resto: nenhuma tela conhece os
 * recursos, como nenhuma conhece o tema. Carregado no <head>, logo depois do
 * tema.js, para a página já abrir com a fonte e as cores escolhidas.
 *
 * A escolha vale para todas as telas e sobrevive ao fechar o navegador
 * (localStorage): quem precisa de fonte maior precisa dela sempre.
 *
 * O painel monta a si mesmo, como o do Robertão: cada tela só inclui este
 * arquivo e o css/base/acessibilidade.css.
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
    var antes = nivel(id);
    if (n > 0 && n <= r.niveis.length) estado[id] = n;
    else delete estado[id];
    guardar();
    aplicarAtributo(r);
    if (r.aoAplicar) r.aoAplicar(nivel(id));
    sincronizarCartao(r);
    avisar(id);
    if (r.recarregar && r.recarregar(antes, nivel(id))) recarregar(id);
  }

  /* O que é pintado com as rampas (mapa, legenda, 3D, comparação) lê a paleta
     uma vez, ao montar. Recarregar repinta tudo pelo mesmo caminho da
     primeira carga; a configuração está na URL e o painel reabre no mesmo
     cartão, com o foco nele. */
  var CHAVE_REABRIR = "thermal-predictor.acessibilidade-reabrir";

  function recarregar(id) {
    try { window.sessionStorage.setItem(CHAVE_REABRIR, id); } catch (e) { /* reabre fechado */ }
    window.location.reload();
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

  var ICONE_LIBRAS =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M7 12.5V5.8a1.3 1.3 0 0 1 2.6 0V10M9.6 9.6V4.3a1.3 1.3 0 0 1 2.6 0v5.3M12.2 9.6V5.5a1.3 1.3 0 0 1 2.6 0v6.3"></path>' +
    '<path d="M14.8 11.8l1.4-1.6a1.3 1.3 0 0 1 2 1.6l-2.6 4.4a6 6 0 0 1-5.2 3H9.6A5.4 5.4 0 0 1 4.2 14v-2.2a1.4 1.4 0 0 1 2.8 0"></path>' +
    '<path d="M19.5 15.5c.8.6 1.3 1.5 1.3 2.5M3 7.5c-.6.6-1 1.4-1 2.3"></path></svg>';

  /* Duas abas empilhadas no meio da borda direita, como nos sites que usam
     tradutor de Libras: a de cima abre o painel, a de baixo o tradutor. */
  function montarLancador() {
    var abas = document.createElement("div");
    abas.className = "a11y-abas";

    lancador = document.createElement("button");
    lancador.type = "button";
    lancador.className = "a11y-lancador";
    lancador.setAttribute("aria-expanded", "false");
    lancador.setAttribute("aria-controls", "a11y-painel");
    lancador.innerHTML = '<span class="a11y-lancador__rotulo">Recursos assistivos</span>' + ICONE_LANCADOR;
    lancador.addEventListener("click", function () { alternar(); });
    abas.appendChild(lancador);

    var libras = document.createElement("button");
    libras.type = "button";
    libras.className = "a11y-lancador a11y-lancador--libras";
    libras.setAttribute("aria-label", "Acessível em Libras: abrir o tradutor (requer internet)");
    libras.innerHTML = '<span class="a11y-lancador__rotulo">Acessível em Libras</span>' + ICONE_LIBRAS;
    libras.addEventListener("click", function () {
      alternar(true);
      carregarLibras(false);
    });
    abas.appendChild(libras);

    document.body.appendChild(abas);
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
      '<span class="a11y-cartao__nivel" aria-hidden="true">' + (r.dica || "") + "</span>";

    cartao.addEventListener("click", function () {
      if (r.niveis) ciclar(r.id);
      else if (r.acao) r.acao(cartao);
    });
    if (!r.niveis) cartao.setAttribute("aria-label", r.rotulo + (r.dica ? " (" + r.dica.toLowerCase() + ")" : ""));
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
    if (fechar === true && painel.hidden) return;
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

  /* No celular a fonte para em 115% (css/base/acessibilidade.css): 150% numa tela
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

  /* Modo daltônico em duas camadas.
     1. A página inteira passa por um filtro de correção do tipo escolhido
        (daltonização: a diferença de cor que aquele olho perde é deslocada
        para os canais que ele enxerga). Vale para texto, gráfico e 3D.
     2. As rampas dos mapas térmicos trocam por paletas seguras para os três
        tipos (js/visual/fogao.js), que é o que garante a leitura da temperatura.
     As matrizes de simulação são as de Machado, Oliveira e Fernandes (2009),
     severidade total; a correção é I + E·(I − S), com E deslocando o erro
     vermelho-verde para o azul (deuteranopia e protanopia) e o erro azul
     para o vermelho e o verde (tritanopia). */
  var FILTROS = {
    deuteranopia: "1 0 0 0 0  0.163 0.725 0.112 0 0  0.455 -0.645 1.191 0 0  0 0 0 1 0",
    protanopia:   "1 0 0 0 0  0.479 0.477 0.044 0 0  0.597 -0.689 1.091 0 0  0 0 0 1 0",
    tritanopia:   "0.741 -0.407 0.666 0 0  0.075 0.585 0.340 0 0  0 0 1 0 0  0 0 0 1 0"
  };

  function montarFiltros() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", "a11y-filtros");
    svg.innerHTML = Object.keys(FILTROS).map(function (tipo) {
      return '<filter id="a11y-' + tipo + '" color-interpolation-filters="linearRGB">' +
        '<feColorMatrix type="matrix" values="' + FILTROS[tipo] + '"></feColorMatrix></filter>';
    }).join("");
    document.body.insertBefore(svg, document.body.firstChild);
    // Só agora o CSS liga o filtro: apontar para um filtro que ainda não existe apagaria a página.
    raiz.setAttribute("data-a11y-filtros", "");
  }

  /* O <body> ainda não existe quando este script roda no <head>; o filtro entra
     assim que ele nasce, antes do resto da página pintar sem correção. */
  if (document.body) montarFiltros();
  else if (typeof MutationObserver === "function") {
    new MutationObserver(function (_, observador) {
      if (!document.body) return;
      observador.disconnect();
      montarFiltros();
    }).observe(raiz, { childList: true });
  } else document.addEventListener("DOMContentLoaded", montarFiltros);

  registrar({
    id: "daltonico", grupo: "cor", rotulo: "Modo daltônico",
    icone: SVG + '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"></path><circle cx="12" cy="12" r="3"></circle><path d="M12 9v6" stroke-width="1.6"></path></svg>',
    niveis: ["Deuteranopia (verde)", "Protanopia (vermelho)", "Tritanopia (azul)"],
    // As rampas seguras servem aos três tipos: só ligar ou desligar repinta.
    recarregar: function (antes, depois) { return (antes > 0) !== (depois > 0); }
  });

  /* ----- Guia e máscara de leitura -----
     Camadas fixas que seguem a linha do ponteiro (ou do foco, para quem
     navega pelo teclado). Não capturam clique: tudo embaixo continua
     clicável. Ficam abaixo do painel, para ele não ser escurecido. */
  var camadas = null;
  var linhaY = window.innerHeight / 2;
  var quadro = 0;

  function montarCamadas() {
    if (camadas || !document.body) return;
    camadas = {
      guia: document.createElement("div"),
      acima: document.createElement("div"),
      abaixo: document.createElement("div")
    };
    camadas.guia.className = "a11y-guia";
    camadas.acima.className = "a11y-mascara a11y-mascara--acima";
    camadas.abaixo.className = "a11y-mascara a11y-mascara--abaixo";
    Object.keys(camadas).forEach(function (k) {
      camadas[k].setAttribute("aria-hidden", "true");
      document.body.appendChild(camadas[k]);
    });
  }

  function posicionarCamadas() {
    quadro = 0;
    if (!camadas) return;
    var guia = nivel("guia"), mascara = nivel("mascara");
    camadas.guia.hidden = !guia;
    camadas.acima.hidden = camadas.abaixo.hidden = !mascara;
    if (guia) camadas.guia.style.transform = "translateY(" + Math.round(linhaY) + "px)";
    if (mascara) {
      // Meia altura da janela em rem, para acompanhar a fonte escolhida.
      var rem = parseFloat(window.getComputedStyle(raiz).fontSize) || 16;
      var meia = [0, 2.25, 3.5, 5][mascara] * rem;
      camadas.acima.style.height = Math.max(0, Math.round(linhaY - meia)) + "px";
      camadas.abaixo.style.top = Math.round(linhaY + meia) + "px";
    }
  }

  function pedirCamadas() {
    if (!quadro) quadro = window.requestAnimationFrame(posicionarCamadas);
  }

  function aplicarCamadas() {
    if (nivel("guia") || nivel("mascara")) montarCamadas();
    if (camadas) posicionarCamadas();
  }

  document.addEventListener("pointermove", function (e) {
    if (!camadas || (!nivel("guia") && !nivel("mascara"))) return;
    linhaY = e.clientY;
    pedirCamadas();
  }, { passive: true });

  document.addEventListener("focusin", function (e) {
    if (!camadas || (!nivel("guia") && !nivel("mascara")) || !e.target.getBoundingClientRect) return;
    if (e.target.closest && e.target.closest(".a11y-painel")) return;
    var r = e.target.getBoundingClientRect();
    linhaY = r.top + r.height / 2;
    pedirCamadas();
  });

  registrar({
    id: "guia", grupo: "leitura", rotulo: "Guia de leitura",
    icone: SVG + '<path d="M4 7h16M4 17h16"></path><path d="M2.5 12h19" stroke-width="3"></path></svg>',
    niveis: ["Linha", "Faixa"],
    aoAplicar: aplicarCamadas
  });

  registrar({
    id: "mascara", grupo: "leitura", rotulo: "Máscara de leitura",
    icone: SVG + '<rect x="3" y="3" width="18" height="18" rx="2.5"></rect><path d="M3 9.5h18M3 14.5h18"></path><path d="M3.5 4h17v5h-17zM3.5 15h17v5h-17z" fill="currentColor" stroke="none" opacity=".35"></path></svg>',
    niveis: ["Estreita", "Média", "Larga"],
    aoAplicar: aplicarCamadas
  });

  /* ----- Tradutor de Libras -----
     VLibras, o tradutor gratuito do governo federal (vlibras.gov.br). É o
     único recurso que usa a rede, e por isso só carrega quando alguém pede:
     o painel continua abrindo sem internet (exceção registrada no RNF-02).
     O botão próprio do VLibras fica escondido, porque disputaria a borda
     direita com a aba dos recursos; o cartão daqui o substitui. */
  var VLIBRAS = "https://vlibras.gov.br/app/vlibras-plugin.js";
  var librasEstado = "parado"; // parado → carregando → pronto | erro

  function abrirLibras() {
    if (window.VLibrasWidget && window.VLibrasWidget.open) {
      window.VLibrasWidget.open();
      return;
    }
    // O carregador monta o widget 50 ms depois de rodar; espera o open existir.
    var tentativas = 0;
    (function esperar() {
      if (window.VLibrasWidget && window.VLibrasWidget.open) window.VLibrasWidget.open();
      else if (++tentativas < 60) window.setTimeout(esperar, 100);
    })();
  }

  function falhaLibras() {
    librasEstado = "erro";
    anunciar("O tradutor de Libras precisa de internet e não conseguiu carregar.");
    var c = cartoes.libras;
    if (c) c.querySelector(".a11y-cartao__nivel").textContent = "Sem conexão · tente de novo";
  }

  function carregarLibras(silencioso) {
    if (librasEstado === "pronto") { abrirLibras(); return; }
    if (librasEstado === "carregando") return;
    if (navigator.onLine === false) { falhaLibras(); return; }
    librasEstado = "carregando";
    if (!silencioso) anunciar("Carregando o tradutor de Libras");
    var c = cartoes.libras;
    if (c) c.querySelector(".a11y-cartao__nivel").textContent = "Carregando…";
    var script = document.createElement("script");
    script.src = VLIBRAS;
    script.async = true;
    script.onload = function () {
      librasEstado = "pronto";
      if (c) c.querySelector(".a11y-cartao__nivel").textContent = "Requer internet";
      abrirLibras();
    };
    script.onerror = function () { script.remove(); falhaLibras(); };
    document.head.appendChild(script);
  }

  registrar({
    id: "libras", grupo: "libras", rotulo: "Tradutor de Libras",
    dica: "Requer internet",
    icone: SVG + '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L3.6 15a1.5 1.5 0 0 1 2.3-1.9L8 15"></path></svg>',
    acao: function () {
      alternar(true);
      carregarLibras(false);
    }
  });

  /* Quem deixou o tradutor aberto numa tela o encontra aberto na próxima, como
     no próprio VLibras (que guarda isso em @vlibras-widget). */
  function librasEstavaAberto() {
    try { return (window.localStorage.getItem("@vlibras-widget") || "").indexOf('"isOpen":true') >= 0; }
    catch (e) { return false; }
  }

  /* ----- Leitor de voz -----
     Síntese de fala do próprio navegador (Web Speech API): voz pt-BR, sem
     rede e sem serviço externo (RNF-02 e RNF-04). Ligado, clicar em qualquer
     texto da tela lê esse texto e marca o bloco lido; Esc interrompe. */
  var FALA = window.speechSynthesis || null;
  var VELOCIDADES = [1, 1, 0.8, 1.3];
  var lendoAgora = null;
  var vozPt = null;

  function escolherVoz() {
    if (!FALA) return;
    var vozes = FALA.getVoices();
    vozPt = vozes.filter(function (v) { return /^pt[-_]BR/i.test(v.lang); })[0] ||
      vozes.filter(function (v) { return /^pt/i.test(v.lang); })[0] || null;
  }
  if (FALA) {
    escolherVoz();
    if (FALA.addEventListener) FALA.addEventListener("voiceschanged", escolherVoz);
  }

  function limparTexto(t) { return (t || "").replace(/\s+/g, " ").trim().slice(0, 1800); }

  function marcar(el) {
    if (lendoAgora) lendoAgora.classList.remove("a11y-lendo");
    lendoAgora = el || null;
    if (lendoAgora) lendoAgora.classList.add("a11y-lendo");
  }

  function pararFala() {
    if (FALA) FALA.cancel();
    marcar(null);
    sincronizarResumo(false);
  }

  function falar(texto, el, aoTerminar) {
    if (!FALA) { anunciar("Este navegador não tem leitura em voz alta"); return; }
    texto = limparTexto(texto);
    if (!texto) return;
    FALA.cancel();
    var u = new window.SpeechSynthesisUtterance(texto);
    u.lang = "pt-BR";
    if (vozPt) u.voice = vozPt;
    u.rate = VELOCIDADES[nivel("voz")] || 1;
    u.onend = u.onerror = function () {
      if (lendoAgora === el) marcar(null);
      if (aoTerminar) aoTerminar();
    };
    marcar(el);
    FALA.speak(u);
  }

  // O bloco de texto mais próximo do clique: lê a frase inteira, e não só a palavra.
  var BLOCOS = "h1, h2, h3, h4, p, li, dt, dd, td, th, summary, label, legend, figcaption, button, a, .kpi, .state";

  document.addEventListener("click", function (e) {
    if (!nivel("voz")) return;
    var bloco = blocoParaLer(e.target);
    if (!bloco) return;
    falar(bloco.getAttribute("aria-label") || bloco.innerText || bloco.textContent, bloco);
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && FALA && (FALA.speaking || FALA.pending)) pararFala();
  });

  /* Ao passar o mouse, o bloco que seria lido fica sublinhado: quem vai
     clicar vê antes o que vai ouvir. */
  var alvoVoz = null;

  function blocoParaLer(el) {
    if (!el || !el.closest) return null;
    if (el.closest(".a11y-painel, .a11y-lancador, .chat-panel, .chat-launcher, canvas")) return null;
    var bloco = el.closest(BLOCOS);
    return bloco && bloco.closest("main, header, .masthead") ? bloco : null;
  }

  function sublinhar(bloco) {
    if (alvoVoz === bloco) return;
    if (alvoVoz) alvoVoz.classList.remove("a11y-alvo-voz");
    alvoVoz = bloco;
    if (alvoVoz) alvoVoz.classList.add("a11y-alvo-voz");
  }

  document.addEventListener("mouseover", function (e) {
    sublinhar(nivel("voz") ? blocoParaLer(e.target) : null);
  });
  document.addEventListener("mouseleave", function () { sublinhar(null); });

  registrar({
    id: "voz", grupo: "libras", rotulo: "Leitor de voz",
    icone: SVG + '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"></path><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"></path></svg>',
    niveis: ["Clique para ouvir", "Clique · fala lenta", "Clique · fala rápida"],
    aoAplicar: function (n) {
      if (!n) { pararFala(); sublinhar(null); }
      else if (!FALA) anunciar("Este navegador não tem leitura em voz alta");
    }
  });

  /* Ouvir resumo: a leitura executiva da tela (título, próximo passo e texto
     por extenso) quando a tela tem uma; senão, o título e a frase de
     abertura. Funciona com ou sem o leitor de clique ligado. */
  function textoDoResumo() {
    var r = document.getElementById("resumo-exec");
    var partes = [];
    if (r && r.querySelector(".resumo-exec__titulo")) {
      [".resumo-exec__titulo", ".resumo-exec__passo p", ".resumo-exec__texto"].forEach(function (sel) {
        var el = r.querySelector(sel);
        if (el) partes.push(el.textContent);
      });
      return { texto: partes.join(". "), el: r };
    }
    // Sobretítulo, título e subtítulo como frases separadas: a voz pausa entre eles.
    var cabeca = document.querySelector(".page-head__text");
    if (cabeca) {
      Array.prototype.forEach.call(cabeca.querySelectorAll(".page-head__kicker, .page-head__title, .page-head__sub"), function (el) {
        partes.push(el.textContent);
      });
      return { texto: partes.join(". "), el: cabeca };
    }
    var titulo = document.querySelector("main .panel__title");
    var dica = document.querySelector("main .form-actions__hint");
    partes.push(document.title);
    if (titulo) partes.push(titulo.textContent);
    if (dica) partes.push(dica.textContent);
    return { texto: partes.join(". "), el: titulo ? titulo.closest(".panel") : null };
  }

  function sincronizarResumo(falando) {
    var c = cartoes.resumo;
    if (!c) return;
    c.setAttribute("aria-pressed", falando ? "true" : "false");
    c.querySelector(".a11y-cartao__rotulo").textContent = falando ? "Parar leitura" : "Ouvir resumo";
    c.setAttribute("aria-label", falando ? "Parar a leitura do resumo" : "Ouvir o resumo desta tela");
  }

  registrar({
    id: "resumo", grupo: "libras", rotulo: "Ouvir resumo",
    icone: SVG + '<path d="M4 6h10M4 10h10M4 14h6"></path><path d="M15.5 13.5v5l4.5-2.5z" fill="currentColor"></path></svg>',
    acao: function () {
      if (FALA && (FALA.speaking || FALA.pending) && cartoes.resumo.getAttribute("aria-pressed") === "true") {
        pararFala();
        return;
      }
      var r = textoDoResumo();
      sincronizarResumo(true);
      falar(r.texto, r.el, function () { sincronizarResumo(false); });
    }
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

    if (librasEstavaAberto()) carregarLibras(true);

    var reabrir = null;
    try {
      reabrir = window.sessionStorage.getItem(CHAVE_REABRIR);
      window.sessionStorage.removeItem(CHAVE_REABRIR);
    } catch (e) { /* sem armazenamento */ }
    if (reabrir && cartoes[reabrir]) {
      alternar();
      cartoes[reabrir].focus();
      var r = buscar(reabrir);
      anunciar(r.rotulo + (nivel(reabrir) ? ": " + r.niveis[nivel(reabrir) - 1] : ": desligado"));
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();

  return {
    atual: atual,
    nivel: nivel,
    definir: definir,
    ciclar: ciclar,
    restaurar: restaurar,
    aoMudar: aoMudar,
    registrar: registrar,
    movimentoReduzido: movimentoReduzido,
    CHAVE: CHAVE
  };
})();
