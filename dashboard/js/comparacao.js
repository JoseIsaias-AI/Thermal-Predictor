/* Comparação lado a lado de configurações candidatas (RF-11).
 *
 * A tela não calcula estado de risco: `estado`, folga e severidade já vêm
 * prontos em js/dados_comparacao.js, no mesmo arranjo em que js/triagem.js
 * recebe os seus de js/dados_triagem.js. RN-01 e RN-02 moram no dado, e é
 * por isso que as duas telas não podem divergir — não há duas implementações
 * da regra para sair de sincronia.
 *
 * O que existe aqui é leitura: escolher configurações, justapor colunas,
 * medir a distância entre elas e ordenar por essa distância.
 */

(function () {
  "use strict";

  var erroSecao = document.getElementById("error");

  function mostrarErro(mensagem) {
    document.getElementById("error-message").textContent = mensagem;
    erroSecao.hidden = false;
  }

  if (typeof DADOS_COMPARACAO === "undefined") {
    mostrarErro(
      "js/dados_comparacao.js não foi carregado. Confira se o arquivo existe " +
      "em dashboard/js/ e se a tag <script> que o carrega vem antes desta."
    );
    return;
  }

  var D = DADOS_COMPARACAO;
  var PONTOS = D.pontos;
  var CFGS = D.configuracoes;

  var POR_ID = {};
  CFGS.forEach(function (c) { POR_ID[c.id] = c; });

  // RN-03 separa os dois universos já na carga: o resto da tela nunca precisa
  // reencontrar quem tem limite declarado.
  var COM_LIMITE = [];
  var MONITORADOS = [];
  PONTOS.forEach(function (p, i) { (p.mono ? MONITORADOS : COM_LIMITE).push(i); });

  /* Subsistemas na ordem em que se empilham no produto, do cooktop ao
     alojamento traseiro. É a ordem da malha, e serve igualmente à tabela: um
     agrupamento por subsistema que segue a máquina lê melhor que um que segue
     a ordem de carga do arquivo. */
  var AREAS = ["Coil Temps", "CT Knobs", "IPC Comp", "IPC Cooling",
               "Main Vent Sys", "Mainback", "Oven HMI"].filter(function (a) {
    return PONTOS.some(function (p) { return p.area === a; });
  });

  var LETRAS = ["A", "B", "C", "D"];
  var TONS = ["var(--slot-a)", "var(--slot-b)", "var(--slot-c)", "var(--slot-d)"];
  var MAX_COLUNAS = 4;

  var estado = {
    sel: [],
    ref: null,
    busca: "",
    facetas: {},          // { chave: { valor: true } }
    ordem: "divergencia",
    vista: "tabela",
    escala: "a",
    soFlip: false,
    areas: {}
  };


  /* ----- Formatação ----- */

  function grausC(v) { return v.toFixed(2); }
  function percentual(f) { return (f * 100).toFixed(1) + "%"; }
  function assinado(v) { return (v > 0 ? "+" : "") + v.toFixed(2); }

  function rampa() { return estado.escala === "b" ? FOGAO.RAMPA_B : FOGAO.RAMPA_A; }

  // A folga relativa é divisão, não regra: a classificação já veio no dado.
  function folgaRelativa(cfg, i) {
    var lim = PONTOS[i].limite;
    return lim ? cfg.m[i] / lim : null;
  }

  function faixaDe(cfg, i) { return FOGAO.faixaDaRampa(folgaRelativa(cfg, i)); }
  function rotuloEstado(cfg, i) { return D.estados[cfg.e[i]][1]; }
  function codigoEstado(cfg, i) { return D.estados[cfg.e[i]][0]; }

  // As primitivas de desenho moram em js/grafico.js, comuns às duas telas.
  var svgEl = GRAFICO.el;
  var textoSvg = GRAFICO.texto;
  var corta = GRAFICO.corta;

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }


  /* ----- Vocabulário dos fatores -----
     Lido de js/schema.js, com o fator composto de perdas aberto nos seus três
     subcampos: é a mesma granularidade que a triagem usa para ecoar a
     configuração avaliada. */

  var FATORES = [];
  SCHEMA.factors.forEach(function (f) {
    if (f.subfields && f.subfields.length > 0) {
      f.subfields.forEach(function (s) {
        FATORES.push({ chave: f.key + "." + s.key, label: s.label, niveis: s.levels });
      });
      return;
    }
    FATORES.push({ chave: f.key, label: f.label, niveis: f.levels });
  });

  function valorDoFator(cfg, chave) {
    var corte = chave.indexOf(".");
    if (corte < 0) return cfg.fatores[chave] || "";
    return cfg.fatores[chave.slice(0, corte)][chave.slice(corte + 1)] || "";
  }

  // Valor fora do vocabulário aparece cru e marcado, como em RN-04.
  function rotuloDoNivel(fator, valor) {
    if (valor === "") return "não se aplica";
    var achado = null;
    (fator.niveis || []).forEach(function (n) { if (n.value === valor) achado = n.label; });
    return achado || valor + " (fora do vocabulário)";
  }

  /* Impressão digital do cartão: os níveis crus, curtos, na ordem em que o
     engenheiro os lê. As perdas colapsam num só token — três tokens para um
     fator composto desequilibrariam a leitura dos outros seis. */
  function perdasCurtas(cfg) {
    var l = cfg.fatores.losses;
    if (l.present === "none") return "Sem perda";
    if (l.present === "missing") return "Perda não declarada";
    var partes = [l.config, l.order].filter(Boolean);
    return partes.length ? partes.join(" · ") : "Perda declarada";
  }

  function impressaoDigital(cfg) {
    var f = cfg.fatores;
    return [
      ["run_case", f.run_case],
      ["housing", f.housing],
      ["board_position", f.board_position],
      ["blower_direction", f.blower_direction],
      ["deflector_hole", f.deflector_hole],
      ["material_coil_support", f.material_coil_support],
      ["losses", perdasCurtas(cfg)]
    ];
  }


  /* A query string que a tela de triagem lê: mesma granularidade de FATORES,
     com o fator composto de perdas aberto em `losses.<sub>`. */
  function parametrosDaConfig(cfg) {
    return FATORES.map(function (f) {
      return encodeURIComponent(f.chave) + "=" +
        encodeURIComponent(valorDoFator(cfg, f.chave));
    }).join("&");
  }


  /* ----- Perfil de folga -----
     Os pontos com limite declarado, do mais crítico ao mais folgado, como
     um degradê de paradas duras. Um elemento por cartão em vez de um por ponto: a
     informação é a forma da distribuição, não cada célula. */

  function perfil(cfg) {
    var bandas = COM_LIMITE.map(function (i) { return faixaDe(cfg, i); });
    bandas.sort(function (a, b) { return b - a; });

    var r = rampa(), n = bandas.length, paradas = [], ini = 0;
    for (var k = 1; k <= n; k++) {
      if (k === n || bandas[k] !== bandas[ini]) {
        paradas.push(r[bandas[ini]] + " " + (ini / n * 100).toFixed(2) + "%");
        paradas.push(r[bandas[ini]] + " " + (k / n * 100).toFixed(2) + "%");
        ini = k;
      }
    }
    return "linear-gradient(to right," + paradas.join(",") + ")";
  }


  /* ----- Seleção ----- */

  function posicao(id) { return estado.sel.indexOf(id); }

  function alternar(id) {
    var i = posicao(id);
    if (i >= 0) {
      estado.sel.splice(i, 1);
      if (estado.ref === id) estado.ref = estado.sel[0] || null;
    } else {
      if (estado.sel.length >= MAX_COLUNAS) return;
      estado.sel.push(id);
      if (!estado.ref) estado.ref = id;
    }
    sincronizar();
  }

  function limparSelecao() {
    estado.sel = [];
    estado.ref = null;
    sincronizar();
  }

  /* Endereço da comparação em curso. A tela roda por file://, onde alguns
     navegadores recusam replaceState — a comparação não depende dele. */
  function gravarUrl() {
    try {
      var busca = estado.sel.length ? "?cfg=" + estado.sel.join(",") : "";
      window.history.replaceState(null, "", window.location.pathname + busca);
    } catch (e) { /* sem histórico: a seleção continua valendo em memória */ }
  }

  function lerUrl() {
    var busca = window.location.search.replace(/^\?/, "");
    var achado = null;
    busca.split("&").forEach(function (par) {
      var corte = par.indexOf("=");
      if (corte < 0) return;
      if (decodeURIComponent(par.slice(0, corte)) === "cfg") {
        achado = decodeURIComponent(par.slice(corte + 1).replace(/\+/g, " "));
      }
    });
    if (!achado) return [];
    var vistos = {};
    return achado.split(",").filter(function (id) {
      if (!POR_ID[id] || vistos[id]) return false;
      vistos[id] = true;
      return true;
    }).slice(0, MAX_COLUNAS);
  }


  /* ----- Cartões do catálogo ----- */

  var FACETAS = [
    { chave: "run_case", label: "Regime" },
    { chave: "housing", label: "Alojamento" },
    { chave: "material_coil_support", label: "Suporte da bobina" }
  ];

  function montarFacetas() {
    var caixa = document.getElementById("cfg-facets");
    caixa.innerHTML = "";

    FACETAS.forEach(function (f) {
      var valores = [];
      CFGS.forEach(function (c) {
        var v = c.fatores[f.chave];
        if (valores.indexOf(v) < 0) valores.push(v);
      });

      var bloco = el("div", "cmp-facet");
      bloco.appendChild(el("span", "cmp-facet__label", f.label));

      var chips = el("div", "chips");
      valores.forEach(function (v) {
        var b = el("button", null, v);
        b.type = "button";
        b.setAttribute("aria-pressed", String(!!(estado.facetas[f.chave] || {})[v]));
        b.addEventListener("click", function () {
          var ativos = estado.facetas[f.chave] || (estado.facetas[f.chave] = {});
          if (ativos[v]) delete ativos[v]; else ativos[v] = true;
          montarFacetas();
          montarCatalogo();
        });
        chips.appendChild(b);
      });

      bloco.appendChild(chips);
      caixa.appendChild(bloco);
    });
  }

  function passaNaFaceta(cfg) {
    var ok = true;
    Object.keys(estado.facetas).forEach(function (chave) {
      var ativos = Object.keys(estado.facetas[chave]);
      if (ativos.length && ativos.indexOf(cfg.fatores[chave]) < 0) ok = false;
    });
    return ok;
  }

  function textoBuscavel(cfg) {
    return (cfg.id + " " + impressaoDigital(cfg).map(function (t) { return t[1]; }).join(" ")).toLowerCase();
  }

  function passaNaBusca(cfg) {
    return !estado.busca || textoBuscavel(cfg).indexOf(estado.busca) >= 0;
  }

  // A mesma leitura no cartão e no cabeçalho da coluna: quantos pontos em
  // cada estado. É o que distingue uma configuração da outra.
  function contagensPorEstado(cfg) {
    var caixa = el("span", "cfg-card__counts");
    [["acima", cfg.resumo[0], "is-over"], ["banda", cfg.resumo[1], null],
     ["dentro", cfg.resumo[2], null]].forEach(function (par) {
      var n = el("span", par[2]);
      n.appendChild(el("b", null, String(par[1])));
      n.appendChild(document.createTextNode(" " + par[0]));
      caixa.appendChild(n);
    });
    return caixa;
  }

  function montarCartao(cfg) {
    var i = posicao(cfg.id);
    var b = el("button", "cfg-card");
    b.type = "button";
    b.dataset.id = cfg.id;
    b.setAttribute("aria-pressed", String(i >= 0));
    if (i >= 0) b.style.setProperty("--slot", TONS[i]);
    if (i < 0 && estado.sel.length >= MAX_COLUNAS) b.disabled = true;

    var topo = el("span", "cfg-card__top");
    topo.appendChild(el("b", "cfg-card__id", cfg.id));
    if (i >= 0) topo.appendChild(el("span", "slot", LETRAS[i]));
    topo.appendChild(el("span", "cfg-card__runs",
      cfg.rodadas + (cfg.rodadas === 1 ? " rodada" : " rodadas")));
    b.appendChild(topo);

    b.appendChild(contagensPorEstado(cfg));

    var faixa = el("span", "profile");
    faixa.style.background = perfil(cfg);
    b.appendChild(faixa);

    /* Comparado com a referência, o que este cartão muda. É a pergunta de
       quem varre o catálogo: não "quais são os sete níveis", e sim "o que
       muda se eu trocar por este". Sem referência escolhida, nada se destaca. */
    var digital = impressaoDigital(cfg);
    var daRef = estado.ref && estado.ref !== cfg.id ? impressaoDigital(POR_ID[estado.ref]) : null;

    var fp = el("span", "fp");
    digital.forEach(function (t, k) {
      var difere = daRef && daRef[k][1] !== t[1];
      fp.appendChild(el("span", "fp__token" + (difere ? " fp__token--diff" : ""), t[1]));
    });
    b.appendChild(fp);

    b.addEventListener("click", function () { alternar(cfg.id); });
    return b;
  }

  function montarCatalogo() {
    var grade = document.getElementById("cfg-grid");
    grade.innerHTML = "";

    var visiveis = CFGS.filter(function (c) { return passaNaBusca(c) && passaNaFaceta(c); });
    visiveis.forEach(function (c) { grade.appendChild(montarCartao(c)); });

    var filtrando = estado.busca || Object.keys(estado.facetas).some(function (k) {
      return Object.keys(estado.facetas[k]).length > 0;
    });

    document.getElementById("cfg-count").textContent = filtrando
      ? visiveis.length + " de " + CFGS.length + " configurações atendem ao filtro."
      : "As " + CFGS.length + " configurações do histórico.";

    if (visiveis.length === 0) {
      grade.appendChild(el("p", "detail__empty",
        "Nenhuma configuração atende a esse filtro. As selecionadas continuam na comparação."));
    }
  }

  function montarBandeja() {
    var bandeja = document.getElementById("cfg-tray");
    var caixa = document.getElementById("cfg-tray-slots");
    caixa.innerHTML = "";
    bandeja.hidden = estado.sel.length === 0;

    estado.sel.forEach(function (id, i) {
      var b = el("button", "cmp-tray__slot");
      b.type = "button";
      b.setAttribute("aria-label", "Remover " + id + " da comparação");
      b.style.setProperty("--slot", TONS[i]);
      b.appendChild(el("span", "slot", LETRAS[i]));
      b.appendChild(el("b", null, id));
      var x = el("span", null, "×");
      x.setAttribute("aria-hidden", "true");
      b.appendChild(x);
      b.addEventListener("click", function () { alternar(id); });
      caixa.appendChild(b);
    });
  }


  /* ----- Resumo por configuração ----- */

  function piorPonto(cfg) {
    var alvo = null;
    COM_LIMITE.forEach(function (i) {
      if (alvo === null || cfg.m[i] < cfg.m[alvo]) alvo = i;
    });
    return alvo;
  }

  /* Cinco linhas curtas. A contagem por estado é a informação que separa uma
     configuração da outra, então ela vem antes da severidade, que é a mesma
     nas 32. */
  function montarCabecalhos() {
    var caixa = document.getElementById("cmp-heads");
    caixa.innerHTML = "";

    estado.sel.forEach(function (id, i) {
      var cfg = POR_ID[id];
      var bloco = el("div", "cmp-head" + (id === estado.ref ? " cmp-head--ref" : ""));
      bloco.style.setProperty("--slot", TONS[i]);

      var topo = el("div", "cmp-head__top");
      topo.appendChild(el("span", "slot", LETRAS[i]));
      topo.appendChild(el("b", "cmp-head__id", id));
      topo.appendChild(el("span", "cmp-head__runs",
        cfg.rodadas + (cfg.rodadas === 1 ? " rodada" : " rodadas")));

      var ref = el("button", "cmp-head__ref",
        id === estado.ref ? "referência" : "usar como ref.");
      ref.type = "button";
      ref.setAttribute("aria-pressed", String(id === estado.ref));
      ref.addEventListener("click", function () {
        if (estado.ref === id) return;
        estado.ref = id;
        sincronizar();
      });
      topo.appendChild(ref);
      bloco.appendChild(topo);

      var faixa = el("span", "profile");
      faixa.style.background = perfil(cfg);
      bloco.appendChild(faixa);

      bloco.appendChild(contagensPorEstado(cfg));

      var sev = el("p", "cmp-head__line");
      sev.appendChild(el("span", null, "Severidade"));
      sev.appendChild(el("span", "state state--" + cfg.severidade, rotuloSeveridade(cfg)));
      bloco.appendChild(sev);

      var pior = piorPonto(cfg);
      var linha = el("p", "cmp-head__line");
      linha.appendChild(el("span", null, "Pior"));
      linha.appendChild(el("b", null, PONTOS[pior].nome));
      linha.appendChild(el("span", "num", grausC(cfg.m[pior]) + " °C"));
      bloco.appendChild(linha);

      caixa.appendChild(bloco);
    });
  }

  function rotuloSeveridade(cfg) {
    var achado = cfg.severidade;
    D.estados.forEach(function (e) { if (e[0] === cfg.severidade) achado = e[1]; });
    return achado;
  }


  /* ----- Fatores que diferem -----
     É a leitura que orienta a escolha: com sete fatores, o que interessa não
     é a lista inteira e sim o subconjunto em que as candidatas discordam. */

  function montarFatores() {
    var caixa = document.getElementById("cmp-factors");
    caixa.innerHTML = "";

    var diferem = [], iguais = [];
    FATORES.forEach(function (f) {
      var valores = estado.sel.map(function (id) { return valorDoFator(POR_ID[id], f.chave); });
      var todosIguais = valores.every(function (v) { return v === valores[0]; });
      (todosIguais ? iguais : diferem).push({ fator: f, valores: valores });
    });

    diferem.forEach(function (linha) {
      var div = el("div", "cmp-factor");
      div.appendChild(el("span", "cmp-factor__name", linha.fator.label));

      var vals = el("span", "cmp-factor__vals");
      linha.valores.forEach(function (v, i) {
        var chip = el("span", "cmp-factor__val");
        chip.style.setProperty("--slot", TONS[i]);
        chip.appendChild(el("span", "slot", LETRAS[i]));
        chip.appendChild(el("span", null, rotuloDoNivel(linha.fator, v)));
        vals.appendChild(chip);
      });
      div.appendChild(vals);
      caixa.appendChild(div);
    });

    if (diferem.length === 0) {
      caixa.appendChild(el("p", "detail__empty",
        "As configurações selecionadas têm os sete fatores idênticos."));
    }

    /* Os idênticos não somem, colapsam: repetir "igual em todas" em cinco
       linhas custava mais atenção do que o fato que carregavam. */
    if (iguais.length > 0) {
      var det = el("details", "cmp-same");
      det.appendChild(el("summary", null, iguais.length + " fatores iguais em " +
        (estado.sel.length === 2 ? "ambas" : "todas")));

      var dl = el("dl", "cmp-same__list");
      iguais.forEach(function (linha) {
        dl.appendChild(el("dt", null, linha.fator.label));
        dl.appendChild(el("dd", null, rotuloDoNivel(linha.fator, linha.valores[0])));
      });
      det.appendChild(dl);
      caixa.appendChild(det);
    }
  }


  /* ----- Divergência -----
     Com duas colunas é a diferença assinada contra a referência; com três ou
     mais, a amplitude entre a maior e a menor. O sinal só existe no primeiro
     caso, e é por isso que a barra troca de forma junto com ele. */

  function ehAssinada() { return estado.sel.length === 2; }

  function divergencia(vetor, i) {
    var vals = estado.sel.map(function (id) { return POR_ID[id][vetor][i]; });
    if (vals.some(function (v) { return v === null; })) return null;

    if (ehAssinada()) {
      var iRef = posicao(estado.ref);
      return vals[1 - iRef] - vals[iRef];
    }
    return Math.max.apply(null, vals) - Math.min.apply(null, vals);
  }

  function mudaDeEstado(i) {
    var base = POR_ID[estado.sel[0]].e[i];
    return estado.sel.some(function (id) { return POR_ID[id].e[i] !== base; });
  }

  /* Intensidade em três degraus sobre a rampa da triagem. Positivo com folga
     puxa para o lado frio; negativo, para o quente. Amplitude não tem lado,
     e por isso usa só o quente: ela mede o quanto vale olhar. */
  function corDaDivergencia(d, maximo, melhorQuandoPositivo) {
    var r = rampa();
    if (!maximo || d === 0) return "var(--color-border-strong)";

    var grau = Math.abs(d) / maximo;
    var passo = grau > 0.66 ? 3 : grau > 0.33 ? 2 : 1;

    if (!ehAssinada()) return r[3 + passo];
    var bom = melhorQuandoPositivo ? d > 0 : d < 0;
    return bom ? r[3 - passo] : r[3 + passo];
  }

  function celulaDivergencia(d, maximo, melhorQuandoPositivo) {
    var td = el("td", "num");
    if (d === null) { td.textContent = "—"; return td; }

    var caixa = el("span", "diverge" + (ehAssinada() ? "" : " diverge--amp"));

    var trilho = el("span", "diverge__track");
    trilho.appendChild(el("span", "diverge__axis"));

    var largura = maximo ? Math.abs(d) / maximo : 0;
    var barra = el("span", "diverge__fill");
    barra.style.background = corDaDivergencia(d, maximo, melhorQuandoPositivo);
    if (ehAssinada()) {
      var meia = largura * 50;
      barra.style.width = meia.toFixed(2) + "%";
      barra.style.left = (d >= 0 ? 50 : 50 - meia).toFixed(2) + "%";
    } else {
      barra.style.width = (largura * 100).toFixed(2) + "%";
      barra.style.left = "0";
    }
    trilho.appendChild(barra);
    caixa.appendChild(trilho);

    var num = el("b", "diverge__num");
    if (!ehAssinada()) {
      num.appendChild(document.createTextNode(d.toFixed(2)));
    } else if (d === 0) {
      num.appendChild(el("span", "is-nil", "0.00"));
    } else {
      num.appendChild(el("span", "diverge__arrow", (d > 0 ? "▲ " : "▼ ")));
      num.appendChild(document.createTextNode(assinado(d)));
    }
    caixa.appendChild(num);

    td.appendChild(caixa);
    return td;
  }


  /* ----- Tabela lado a lado ----- */

  function montarAreas() {
    var caixa = document.getElementById("cmp-areas");
    caixa.innerHTML = "";
    AREAS.forEach(function (a) {
      var b = el("button", null, a);
      b.type = "button";
      b.setAttribute("aria-pressed", String(!!estado.areas[a]));
      b.addEventListener("click", function () {
        if (estado.areas[a]) delete estado.areas[a]; else estado.areas[a] = true;
        montarAreas();
        montarVista();
      });
      caixa.appendChild(b);
    });
  }

  function passaNoFiltroDePonto(i) {
    var areas = Object.keys(estado.areas);
    if (areas.length && areas.indexOf(PONTOS[i].area) < 0) return false;
    if (estado.soFlip && !mudaDeEstado(i)) return false;
    return true;
  }

  function celula(texto, classe) {
    var td = el("td", classe);
    td.textContent = texto;
    return td;
  }

  // Mesma célula de ponto da triagem: subsistema como segunda linha.
  function celulaPonto(i, marcas) {
    var td = el("td", "cmp-sticky");

    var nome = el("span", "point__name", PONTOS[i].nome);
    if (marcas.rank) nome.appendChild(el("span", "rank", "#" + marcas.rank));
    td.appendChild(nome);

    td.appendChild(el("span", "point__area", PONTOS[i].area));
    if (marcas.flip) td.appendChild(el("span", "flip", "muda de estado"));
    return td;
  }

  function celulaEstado(cfg, i) {
    var td = el("td");
    td.appendChild(el("span", "state state--" + codigoEstado(cfg, i), rotuloEstado(cfg, i)));
    return td;
  }

  function montarCabecalhoDaTabela() {
    var grupos = document.getElementById("cmp-thead-groups");
    var colunas = document.getElementById("cmp-thead-cols");
    grupos.innerHTML = "";
    colunas.innerHTML = "";

    function th(texto, classe, attrs) {
      var n = el("th", classe, texto);
      n.setAttribute("scope", "col");
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    }

    grupos.appendChild(th("Ponto de medição", "cmp-sticky", { rowspan: 2 }));
    grupos.appendChild(th("Limite (°C)", "num", { rowspan: 2 }));

    estado.sel.forEach(function (id, i) {
      var n = el("th", "cmp-group cmp-edge");
      n.setAttribute("scope", "colgroup");
      n.setAttribute("colspan", "4");
      n.style.setProperty("--slot", TONS[i]);

      var dentro = el("span", "cmp-group__inner");
      dentro.appendChild(el("span", "slot", LETRAS[i]));
      dentro.appendChild(el("b", "cmp-head__id", id));
      if (id === estado.ref) dentro.appendChild(el("span", "rank", "ref"));
      n.appendChild(dentro);
      grupos.appendChild(n);

      ["Temp. prevista (°C)", "Folga (°C)", "Folga (%)"].forEach(function (t, k) {
        colunas.appendChild(th(t, "num" + (k === 0 ? " cmp-edge" : "")));
      });
      colunas.appendChild(th("Estado"));
    });

    /* O que a coluna quer dizer, dito na própria coluna. Antes isso eram dois
       parágrafos abaixo da tabela, longe de onde a dúvida aparece. */
    var div = th(ehAssinada() ? "Divergência (°C)" : "Amplitude (°C)",
      "num cmp-edge", { rowspan: 2 });
    div.appendChild(el("span", "cmp-hint", ehAssinada()
      ? "▼ menos folga · ▲ mais folga"
      : "entre a maior e a menor"));
    grupos.appendChild(div);
  }

  /* A mesma lista alimenta a tabela e o deslocamento: filtro e ordem são da
     tela, não da vista, e trocar de vista não pode trocar o recorte. */
  function linhasVisiveis() {
    var linhas = COM_LIMITE.filter(passaNoFiltroDePonto).map(function (i) {
      return { i: i, d: divergencia("m", i), flip: mudaDeEstado(i) };
    });

    var ref = POR_ID[estado.ref];
    if (estado.ordem === "divergencia") {
      linhas.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    } else if (estado.ordem === "severidade") {
      // Mesmo critério da triagem: estado mais crítico primeiro, folga
      // crescente dentro do estado. Lido da coluna de referência.
      linhas.sort(function (a, b) {
        return ref.e[a.i] - ref.e[b.i] || ref.m[a.i] - ref.m[b.i];
      });
    } else {
      linhas.sort(function (a, b) {
        return AREAS.indexOf(PONTOS[a.i].area) - AREAS.indexOf(PONTOS[b.i].area) ||
          (PONTOS[a.i].nome < PONTOS[b.i].nome ? -1 : 1);
      });
    }
    return linhas;
  }

  function montarTabela(linhas) {
    var corpo = document.getElementById("cmp-body");
    corpo.innerHTML = "";

    montarCabecalhoDaTabela();

    var maximo = 0;
    linhas.forEach(function (l) { maximo = Math.max(maximo, Math.abs(l.d)); });

    // O destaque acompanha a ordenação por divergência: fora dela, numerar as
    // cinco primeiras linhas apontaria para a ordem errada.
    var destacando = estado.ordem === "divergencia";

    linhas.forEach(function (l, ordem) {
      var rank = destacando && ordem < 5 && Math.abs(l.d) > 0 ? ordem + 1 : 0;
      var tr = el("tr");
      if (rank) tr.className = "row--diverge";

      tr.appendChild(celulaPonto(l.i, { rank: rank, flip: l.flip }));
      tr.appendChild(celula(grausC(PONTOS[l.i].limite), "num"));

      estado.sel.forEach(function (id) {
        var cfg = POR_ID[id];
        tr.appendChild(celula(grausC(cfg.t[l.i]), "num cmp-edge"));
        tr.appendChild(celula(grausC(cfg.m[l.i]), "num"));
        tr.appendChild(celula(percentual(folgaRelativa(cfg, l.i)), "num"));
        tr.appendChild(celulaEstado(cfg, l.i));
      });

      var td = celulaDivergencia(l.d, maximo, true);
      td.className += " cmp-edge";
      tr.appendChild(td);

      corpo.appendChild(tr);
    });

    if (linhas.length === 0) {
      var vazio = el("tr");
      var td = el("td", "detail__empty",
        "Nenhum ponto atende aos filtros ativos. Desmarque um subsistema ou " +
        "a caixa de troca de estado.");
      td.colSpan = 3 + estado.sel.length * 4;
      vazio.appendChild(td);
      corpo.appendChild(vazio);
    }
  }




  /* ----- Coordenadas paralelas -----

     O gráfico que o patrocinador descreveu no workshop de alinhamento: os
     fatores de projeto e as respostas em eixos paralelos, com um filtro por
     eixo que apaga o que fica fora da restrição e deixa só o que sobrevive.

     Ele veio com a ressalva junto: "se você tem muitos dados, ele se torna um
     gráfico extremamente poluído". A poluição tem sempre a mesma causa, que é
     linha demais, e aqui ela é resolvida na raiz — cada linha é uma
     configuração, não um ponto de medição. São 32 linhas, e não 32 × 68, que
     seriam duas mil e virariam um borrão. Os eixos de resposta são agregados
     da configuração inteira pelo mesmo motivo.

     As outras duas correções são de ênfase: quem não está selecionado vira
     contexto em cinza, e o filtro por eixo é aplicado antes de qualquer
     leitura, não depois.

     Os sete fatores são categóricos, e não contínuos. Cada nível ocupa uma
     parada fixa do eixo, na ordem do vocabulário de js/schema.js. */

  var svgPc = document.getElementById("pc-svg");
  var dicaPc = null;
  var escovas = {};

  var EIXOS = [
    { chave: "run_case", curto: "Regime" },
    { chave: "housing", curto: "Alojamento" },
    { chave: "board_position", curto: "Placa" },
    { chave: "blower_direction", curto: "Soprador" },
    { chave: "deflector_hole", curto: "Defletor" },
    { chave: "material_coil_support", curto: "Suporte" },
    { chave: "losses.present", curto: "Perdas" },
    { resposta: "acima", curto: "Acima do limite", unidade: "pontos" },
    { resposta: "pior", curto: "Pior folga", unidade: "%" },
    { resposta: "tmax", curto: "Temp. máx.", unidade: "°C" }
  ];

  // Respostas agregadas da configuração inteira: é o que faz o eixo caber numa
  // linha só por configuração.
  function respostasDa(cfg) {
    var pior = Infinity, tmax = -Infinity;
    PONTOS.forEach(function (p, i) {
      if (cfg.t[i] > tmax) tmax = cfg.t[i];
      if (!p.mono) {
        var f = cfg.m[i] / p.limite;
        if (f < pior) pior = f;
      }
    });
    return { acima: cfg.resumo[0], pior: pior, tmax: tmax };
  }

  var RESPOSTAS = {};
  CFGS.forEach(function (c) { RESPOSTAS[c.id] = respostasDa(c); });

  // Domínio de cada eixo, calculado uma vez.
  var DOMINIOS = EIXOS.map(function (eixo) {
    if (eixo.resposta) {
      var lo = Infinity, hi = -Infinity;
      CFGS.forEach(function (c) {
        var v = RESPOSTAS[c.id][eixo.resposta];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      });
      return { tipo: "numero", lo: lo, hi: hi === lo ? lo + 1 : hi };
    }

    // Ordem do vocabulário, e não ordem de aparição: o eixo tem de significar
    // a mesma coisa em qualquer recorte.
    var fator = null;
    FATORES.forEach(function (f) { if (f.chave === eixo.chave) fator = f; });
    var niveis = (fator.niveis || []).map(function (n) { return n.value; })
      .filter(function (v) {
        return CFGS.some(function (c) { return valorDoFator(c, eixo.chave) === v; });
      });
    return { tipo: "categoria", niveis: niveis, fator: fator };
  });

  function valorNoEixo(cfg, k) {
    var eixo = EIXOS[k];
    return eixo.resposta ? RESPOSTAS[cfg.id][eixo.resposta] : valorDoFator(cfg, eixo.chave);
  }

  /* Um eixo de resposta cresce para cima quando mais é melhor, e para baixo
     quando mais é pior. Assim o topo do desenho é sempre o lado bom, e uma
     linha alta se lê como boa em qualquer eixo. */
  function melhorParaCima(eixo) {
    return eixo.resposta === "pior";
  }

  function desenharParalelas() {
    GRAFICO.limpar(svgPc);

    var ML = 58, MR = 58, MT = 56, MB = 30;
    var LARG = 1040, ALTU = 420;
    var PH = ALTU - MT - MB;
    // Os níveis não encostam nas pontas do eixo: o rótulo do primeiro batia
    // no cabeçalho, e o do último saía do quadro.
    var RESPIRO = 14;
    var passo = (LARG - ML - MR) / (EIXOS.length - 1);

    svgPc.setAttribute("viewBox", "0 0 " + LARG + " " + ALTU);
    svgPc.setAttribute("height", ALTU);

    function eixoX(k) { return ML + k * passo; }

    function Y(k, valor) {
      var d = DOMINIOS[k];
      if (d.tipo === "numero") {
        var t = (valor - d.lo) / (d.hi - d.lo);
        if (!melhorParaCima(EIXOS[k])) t = 1 - t;
        return MT + PH - RESPIRO - t * (PH - 2 * RESPIRO);
      }
      var i = d.niveis.indexOf(valor);
      if (i < 0) return MT + PH;
      return d.niveis.length === 1 ? MT + PH / 2
        : MT + RESPIRO + (i / (d.niveis.length - 1)) * (PH - 2 * RESPIRO);
    }

    function dentroDasEscovas(cfg) {
      return Object.keys(escovas).every(function (k) {
        var y = Y(+k, valorNoEixo(cfg, +k));
        return y >= escovas[k][0] && y <= escovas[k][1];
      });
    }

    // Eixos e níveis primeiro: as linhas correm por cima deles.
    EIXOS.forEach(function (eixo, k) {
      var x = eixoX(k);
      svgPc.appendChild(GRAFICO.el("line",
        { x1: x, y1: MT, x2: x, y2: MT + PH, "class": "pc-eixo" }));

      var cab = GRAFICO.texto(x, MT - 22, eixo.curto,
        "pc-cabeca" + (eixo.resposta ? " pc-cabeca--resposta" : ""), "middle");
      svgPc.appendChild(cab);
      if (eixo.unidade) {
        svgPc.appendChild(GRAFICO.texto(x, MT - 11, eixo.unidade, "pc-nivel", "middle"));
      }

      var d = DOMINIOS[k];
      if (d.tipo === "categoria") {
        d.niveis.forEach(function (nivel, i) {
          var y = d.niveis.length === 1 ? MT + PH / 2
            : MT + RESPIRO + (i / (d.niveis.length - 1)) * (PH - 2 * RESPIRO);
          svgPc.appendChild(GRAFICO.el("line",
            { x1: x - 4, y1: y, x2: x + 4, y2: y, "class": "pc-eixo" }));
          svgPc.appendChild(GRAFICO.texto(x, y - 5,
            GRAFICO.corta(rotuloCurtoDoNivel(d.fator, nivel), 16), "pc-nivel", "middle"));
        });
      } else {
        [0, 0.5, 1].forEach(function (t) {
          var valor = d.lo + (d.hi - d.lo) * t;
          var y = Y(k, valor);
          svgPc.appendChild(GRAFICO.el("line",
            { x1: x - 4, y1: y, x2: x + 4, y2: y, "class": "pc-eixo" }));
          svgPc.appendChild(GRAFICO.texto(x, y - 5,
            eixo.resposta === "pior" ? (valor * 100).toFixed(0) + "%" : valor.toFixed(0),
            "pc-nivel", "middle"));
        });
      }

      if (escovas[k]) {
        svgPc.appendChild(GRAFICO.el("rect", {
          x: x - 10, y: escovas[k][0], width: 20,
          height: escovas[k][1] - escovas[k][0], "class": "pc-faixa"
        }));
      }
    });

    // Linhas: contexto primeiro, selecionadas por último, para ficarem por cima.
    var sobreviventes = 0;
    var ordenadas = CFGS.slice().sort(function (a, b) {
      return (posicao(a.id) >= 0 ? 1 : 0) - (posicao(b.id) >= 0 ? 1 : 0);
    });

    ordenadas.forEach(function (cfg) {
      var dentro = dentroDasEscovas(cfg);
      if (dentro) sobreviventes += 1;

      var d = EIXOS.map(function (e, k) {
        return (k ? "L" : "M") + eixoX(k).toFixed(1) + " " + Y(k, valorNoEixo(cfg, k)).toFixed(1);
      }).join(" ");

      var i = posicao(cfg.id);
      var linha = GRAFICO.el("path", {
        d: d,
        "class": "pc-linha" + (i >= 0 ? " pc-linha--sel" : " pc-linha--contexto") +
          (dentro ? "" : " pc-linha--fora"),
        "data-cfg": cfg.id
      });
      if (i >= 0) linha.style.stroke = TONS[i];
      svgPc.appendChild(linha);

      // Alvo largo e invisível: a linha tem 1 px e ninguém acerta 1 px.
      var alvo = GRAFICO.el("path", { d: d, "class": "pc-linha pc-linha--alvo" });
      alvo.addEventListener("pointerenter", function () {
        dicaPc.mostrar(alvo, resumoDaConfig(cfg));
      });
      alvo.addEventListener("pointerleave", function () { dicaPc.esconder(); });
      alvo.addEventListener("click", function () { alternar(cfg.id); });
      svgPc.appendChild(alvo);
    });

    montarEscovas(eixoX, MT, PH);

    document.getElementById("pc-conta").textContent = Object.keys(escovas).length
      ? sobreviventes + " de " + CFGS.length + " configurações sobrevivem às restrições"
      : "As " + CFGS.length + " configurações. Arraste sobre um eixo para restringi-lo.";
    document.getElementById("pc-limpar").hidden = !Object.keys(escovas).length;
  }

  function rotuloCurtoDoNivel(fator, valor) {
    if (valor === "") return "não se aplica";
    // O rótulo do vocabulário traz a tradução entre parênteses, que num eixo
    // estreito só ocupa espaço.
    var achado = valor;
    (fator.niveis || []).forEach(function (n) {
      if (n.value === valor) achado = n.label.replace(/\s*\(.*\)\s*$/, "");
    });
    return achado;
  }

  function resumoDaConfig(cfg) {
    var r = RESPOSTAS[cfg.id];
    return "<b class=\"tip__name\">" + cfg.id + "</b>" +
      "<span class=\"tip__state\">" + cfg.rodadas +
      (cfg.rodadas === 1 ? " rodada" : " rodadas") + " · " +
      cfg.fatores.run_case + "</span><br>" +
      "<span class=\"tip__num\">" + r.acima + "</span> acima do limite · " +
      "pior folga <span class=\"tip__num\">" + (r.pior * 100).toFixed(1) + "%</span> · " +
      "máx <span class=\"tip__num\">" + r.tmax.toFixed(0) + " °C</span>" +
      "<span class=\"tip__state\"><br>clique para " +
      (posicao(cfg.id) >= 0 ? "tirar da" : "pôr na") + " comparação</span>";
  }

  /* Arrastar sobre um eixo define a faixa que sobrevive; um clique sem
     arrasto desfaz a faixa daquele eixo. */
  function montarEscovas(eixoX, topo, altura) {
    EIXOS.forEach(function (eixo, k) {
      var pega = GRAFICO.el("rect", {
        x: eixoX(k) - 11, y: topo, width: 22, height: altura, "class": "pc-pega"
      });

      var y0 = null;
      pega.addEventListener("pointerdown", function (ev) {
        y0 = ev.offsetY;
        pega.setPointerCapture(ev.pointerId);
      });
      pega.addEventListener("pointermove", function (ev) {
        if (y0 === null) return;
        escovas[k] = [Math.min(y0, ev.offsetY), Math.max(y0, ev.offsetY)];
        desenharParalelas();
      });
      pega.addEventListener("pointerup", function (ev) {
        if (y0 !== null && Math.abs(ev.offsetY - y0) < 4) delete escovas[k];
        y0 = null;
        desenharParalelas();
      });

      svgPc.appendChild(pega);
    });
  }

  /* ----- Vistas gráficas -----

     Desenhadas à mão em SVG, no mesmo espírito de js/fogao.js: o painel roda
     sem rede e sem dependência, e uma biblioteca de gráficos custaria mais em
     peso e em ferramenta do que estes dois desenhos valem.

     As duas respondem o que a tabela não responde. O deslocamento mostra o
     sentido: se as linhas correm todas para o mesmo lado, uma configuração é
     melhor em toda parte; se cruzam, há troca. A malha mostra o lugar: onde,
     no produto, a mudança se concentra. */

  var svgVista = document.getElementById("cmp-svg");
  var quadroVista = document.querySelector(".chart__frame");
  var balao = document.getElementById("chart-tip");

  function limparVista() {
    GRAFICO.limpar(svgVista);
    dica.esconder();
  }

  var dica = GRAFICO.balao(quadroVista, balao);

  function resumoDoPonto(i) {
    var p = PONTOS[i];
    var html = "<b class=\"tip__name\">" + p.nome + "</b><span class=\"tip__state\">" + p.area + "</span>";
    estado.sel.forEach(function (id, k) {
      var cfg = POR_ID[id];
      html += "<br><span class=\"tip__state\">" + LETRAS[k] + "</span> " +
        "<span class=\"tip__num\">" + grausC(cfg.t[i]) + " °C</span>";
      if (!p.mono) {
        html += " · <span class=\"tip__num\">folga " + grausC(cfg.m[i]) + " °C</span>" +
          "<span class=\"tip__state\"> · " + rotuloEstado(cfg, i) + "</span>";
      }
    });
    return html;
  }

  function areaSensivel(x, y, w, h, i) {
    var r = svgEl("rect", { x: x, y: y, width: w, height: h, class: "ax-hit" });
    r.addEventListener("pointerenter", function () { dica.mostrar(r, resumoDoPonto(i)); });
    return r;
  }


  /* ----- Deslocamento da folga ----- */

  function desenharDeslocamento(linhas) {
    var ML = 194, MR = 78, MT = 46, MB = 10, ALT = 15;
    var LARG = 940, PW = LARG - ML - MR;
    var H = MT + Math.max(1, linhas.length) * ALT + MB;

    svgVista.setAttribute("viewBox", "0 0 " + LARG + " " + H);
    svgVista.setAttribute("height", H);
    svgVista.removeAttribute("width");
    svgVista.style.width = "100%";
    svgVista.style.minWidth = "44rem";

    if (linhas.length === 0) {
      svgVista.appendChild(textoSvg(ML, MT + 20,
        "Nenhum ponto atende aos filtros ativos.", "ax-text"));
      return;
    }

    var lo = Infinity, hi = -Infinity;
    linhas.forEach(function (l) {
      estado.sel.forEach(function (id) {
        var v = folgaRelativa(POR_ID[id], l.i);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      });
    });
    var respiro = (hi - lo) * 0.06 || 0.05;
    lo -= respiro; hi += respiro;

    // Mesmo eixo da tela de triagem, servido por js/grafico.js.
    var X = GRAFICO.eixoDeFolga(svgVista, {
      lo: lo, hi: hi, x0: ML, largura: PW,
      topo: MT - 12, base: H - MB, yRotulo: MT - 18,
      tolerancia: D.tolerancia_fracao
    });

    svgVista.appendChild(textoSvg(ML, 14, "FOLGA RELATIVA AO LIMITE", "ax-rotulo"));
    svgVista.appendChild(textoSvg(ML + PW + 8, 14,
      ehAssinada() ? "DIVERG." : "AMPLIT.", "ax-rotulo"));

    var r = rampa();
    var iRef = posicao(estado.ref);

    linhas.forEach(function (l, k) {
      var y = MT + k * ALT + ALT / 2;
      var g = svgEl("g", { class: "desl-faixa" });
      g.appendChild(areaSensivel(0, y - ALT / 2, LARG, ALT, l.i));

      var vals = estado.sel.map(function (id) { return folgaRelativa(POR_ID[id], l.i); });
      var vmin = Math.min.apply(null, vals), vmax = Math.max.apply(null, vals);

      /* Com duas colunas o segmento tem sentido, e a cor diz qual: para o lado
         frio quando a folga cresce, para o quente quando encolhe. Com três ou
         mais é amplitude, que não tem sentido — então fica neutro. */
      var cor = "var(--color-border-strong)";
      if (ehAssinada()) cor = vals[1 - iRef] > vals[iRef] ? r[1] : r[6];

      var linha = svgEl("line", { x1: X(vmin), y1: y, x2: X(vmax), y2: y, class: "desl-linha" });
      linha.style.stroke = cor;
      g.appendChild(linha);

      estado.sel.forEach(function (id, c) {
        var marca = svgEl("circle", { cx: X(vals[c]), cy: y, r: 3.4, "stroke-width": 1.4 });
        /* A referência fica vazada: identidade por preenchimento, e não só por
           tom, para o desenho sobreviver em tons de cinza. */
        marca.style.fill = id === estado.ref ? "var(--color-surface)" : TONS[c];
        marca.style.stroke = TONS[c];
        g.appendChild(marca);
      });

      g.appendChild(textoSvg(ML - 10, y + 3.5, corta(PONTOS[l.i].nome, 30),
        l.flip ? "ax-text ax-text--forte" : "ax-text", "end"));

      g.appendChild(textoSvg(ML + PW + 8, y + 3.5,
        ehAssinada() ? assinado(l.d) : l.d.toFixed(2), "ax-text", "start"));

      svgVista.appendChild(g);
    });

    document.getElementById("chart-alt").textContent =
      "Cada linha é um ponto de medição, do menor ao maior valor de folga entre as " +
      "configurações. O círculo vazado é a referência " + estado.ref + "; o cheio, a " +
      "outra configuração. A faixa sombreada é a banda de incerteza, e o traço escuro " +
      "é o limite. Nome em negrito marca ponto que muda de estado.";
  }


  /* ----- Malha por subsistema ----- */

  /* Geometria calculada uma vez e desenhada uma vez por configuração: é o que
     faz a comparação célula a célula funcionar — a mesma posição significa o
     mesmo ponto em todas as malhas. */
  function malhaLayout() {
    var COLS = 8, PASSO = 28, blocos = [], y = 0;

    AREAS.forEach(function (area) {
      var idx = [];
      PONTOS.forEach(function (p, i) { if (p.area === area) idx.push(i); });
      var linhas = Math.ceil(idx.length / COLS);
      blocos.push({ area: area, idx: idx, y: y, linhas: linhas });
      y += 15 + linhas * PASSO + 8;
    });

    return { blocos: blocos, cols: COLS, passo: PASSO, altura: y, largura: COLS * PASSO };
  }

  function desenharMalha() {
    var L = malhaLayout();
    var GUT = 118, GAP = 26, TOPO = 58;
    var LARG = GUT + estado.sel.length * L.largura + (estado.sel.length - 1) * GAP;
    var H = TOPO + L.altura;

    svgVista.setAttribute("viewBox", "0 0 " + LARG + " " + H);
    svgVista.setAttribute("height", H);
    svgVista.setAttribute("width", LARG);
    svgVista.style.width = LARG + "px";
    svgVista.style.minWidth = "0";

    var r = rampa();

    // Legenda das formas: o mesmo vocabulário da tela de triagem.
    var lx = GUT;
    [["acima_do_limite", false, "acima"], ["banda_de_incerteza", false, "banda"],
     ["dentro_do_limite", false, "dentro"], [null, true, "sem limite"]].forEach(function (f) {
      var marca = svgEl("path", { d: FOGAO.formaDoPonto(lx + 6, 16, f[0], f[1]) });
      marca.style.fill = f[1] ? "var(--color-surface)" : "var(--color-surface-sunken)";
      marca.style.stroke = "var(--wp-gray-dark)";
      marca.style.strokeWidth = "1";
      if (f[1]) marca.style.strokeDasharray = "2.5 2";
      svgVista.appendChild(marca);
      svgVista.appendChild(textoSvg(lx + 15, 19, f[2], "ax-text ax-text--eixo"));
      lx += 24 + f[2].length * 5.4;
    });

    estado.sel.forEach(function (id, c) {
      var cfg = POR_ID[id];
      var x0 = GUT + c * (L.largura + GAP);

      var chip = svgEl("rect", { x: x0, y: TOPO - 26, width: 15, height: 15, rx: 2 });
      chip.style.fill = TONS[c];
      svgVista.appendChild(chip);

      var letra = textoSvg(x0 + 7.5, TOPO - 14.5, LETRAS[c], "ax-rotulo", "middle");
      letra.style.fill = "var(--color-text-inverse)";
      svgVista.appendChild(letra);
      svgVista.appendChild(textoSvg(x0 + 21, TOPO - 14, id, "ax-text ax-text--forte"));

      L.blocos.forEach(function (b) {
        b.idx.forEach(function (i, k) {
          var cx = x0 + (k % L.cols) * L.passo + L.passo / 2;
          var cy = TOPO + b.y + 15 + Math.floor(k / L.cols) * L.passo + L.passo / 2;
          var p = PONTOS[i];

          var marca = svgEl("path", {
            d: FOGAO.formaDoPonto(cx, cy, p.mono ? null : codigoEstado(cfg, i), p.mono),
            class: "malha-celula"
          });
          marca.style.fill = p.mono ? "var(--color-surface)" : r[faixaDe(cfg, i)];
          marca.style.stroke = p.mono ? "var(--wp-gray-dark)" : "var(--wp-near-black)";
          marca.style.strokeWidth = p.mono ? "1.1" : "0.7";
          if (p.mono) marca.style.strokeDasharray = "2.5 2";
          svgVista.appendChild(marca);

          /* Ponto que atravessa o limite entre as configurações: sublinhado em
             todas as malhas, para a comparação achar a mesma célula. */
          if (!p.mono && mudaDeEstado(i)) {
            var sub = svgEl("rect", { x: cx - 7, y: cy + 8, width: 14, height: 2 });
            sub.style.fill = "var(--color-accent)";
            svgVista.appendChild(sub);
          }

          svgVista.appendChild(areaSensivel(cx - L.passo / 2, cy - L.passo / 2,
            L.passo, L.passo, i));
        });
      });
    });

    L.blocos.forEach(function (b) {
      svgVista.appendChild(textoSvg(GUT - 10, TOPO + b.y + 26, b.area, "ax-text", "end"));
      svgVista.appendChild(textoSvg(GUT - 10, TOPO + b.y + 38,
        b.idx.length + " pontos", "ax-text ax-text--eixo", "end"));
    });

    var flips = COM_LIMITE.filter(mudaDeEstado).length;
    document.getElementById("chart-alt").textContent =
      "Uma célula por ponto de medição, agrupada por subsistema, do cooktop no topo " +
      "ao alojamento traseiro embaixo. A mesma posição é o mesmo ponto em todas as " +
      "malhas. A forma repete o estado, de modo que a leitura não depende da cor. " +
      "O sublinhado marca os " + flips + " pontos que mudam de estado.";
  }


  /* ----- Alternância entre as vistas ----- */

  function montarVista() {
    var linhas = linhasVisiveis();

    var flips = COM_LIMITE.filter(mudaDeEstado).length;
    document.getElementById("cmp-count").textContent =
      linhas.length + " de " + COM_LIMITE.length + " pontos · " + flips +
      (flips === 1 ? " muda" : " mudam") + " de estado";

    document.getElementById("cmp-caption").textContent = estado.vista === "malha"
      ? "Agrupado por subsistema, na ordem em que se empilham no produto. O filtro por subsistema continua valendo para as outras vistas."
      : ({
        divergencia: "As cinco maiores divergências primeiro — é por onde começa a leitura.",
        severidade: "Mesma ordem da tela de triagem, lida na coluna " + estado.ref + ".",
        subsistema: "Agrupado por subsistema."
      })[estado.ordem];

    // Na malha a ordem das linhas não existe: a posição é a do produto.
    Array.prototype.forEach.call(
      document.querySelectorAll("#cmp-sort button"),
      function (b) { b.disabled = estado.vista === "malha"; });

    var tabela = estado.vista === "tabela";
    document.getElementById("cmp-tabela").hidden = !tabela;
    document.getElementById("cmp-chart").hidden = tabela;

    if (tabela) { montarTabela(linhas); return; }

    limparVista();
    if (estado.vista === "malha") desenharMalha(); else desenharDeslocamento(linhas);
  }


  /* ----- Monitorados (RN-03) -----
     Sem limite, sem folga e sem estado. A divergência aqui é de temperatura,
     e um valor mais alto é pior — o oposto do que vale para folga. */

  function montarMonitorados() {
    var cabecalho = document.getElementById("mono-thead");
    var corpo = document.getElementById("mono-body");
    cabecalho.innerHTML = "";
    corpo.innerHTML = "";

    function th(texto, classe) {
      var n = el("th", classe, texto);
      n.setAttribute("scope", "col");
      return n;
    }

    cabecalho.appendChild(th("Ponto de medição", "cmp-sticky"));
    estado.sel.forEach(function (id, i) {
      var n = th(id + " · temp. prevista (°C)", "num cmp-edge");
      n.style.setProperty("--slot", TONS[i]);
      cabecalho.appendChild(n);
    });
    cabecalho.appendChild(th(ehAssinada() ? "Divergência (°C)" : "Amplitude (°C)", "num cmp-edge"));

    var linhas = MONITORADOS.map(function (i) {
      return { i: i, d: divergencia("t", i) };
    });

    var maximo = 0;
    linhas.forEach(function (l) { maximo = Math.max(maximo, Math.abs(l.d)); });
    linhas.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });

    linhas.forEach(function (l) {
      var tr = el("tr");
      tr.appendChild(celulaPonto(l.i, {}));
      estado.sel.forEach(function (id) {
        tr.appendChild(celula(grausC(POR_ID[id].t[l.i]), "num cmp-edge"));
      });
      var td = celulaDivergencia(l.d, maximo, false);
      td.className += " cmp-edge";
      tr.appendChild(td);
      corpo.appendChild(tr);
    });

    document.getElementById("mono-count").textContent = MONITORADOS.length;
  }


  /* ----- Configuração mais próxima dentro do limite -----
     A busca mora em js/segura_proxima.js; aqui fica o formulário e a leitura
     do resultado. O lado a lado não é refeito: a sugestão entra na comparação
     acima, com as mesmas colunas e o mesmo destaque de fatores divergentes. */

  var SP = typeof SEGURA_PROXIMA !== "undefined" ? SEGURA_PROXIMA : null;
  var wf = { fatores: null };

  function fatorPorChave(chave) {
    for (var k = 0; k < FATORES.length; k++) if (FATORES[k].chave === chave) return FATORES[k];
    return null;
  }

  function copiarFatores(f) {
    var c = {};
    Object.keys(f).forEach(function (k) {
      c[k] = typeof f[k] === "object" && f[k] !== null ? copiarFatores(f[k]) : f[k];
    });
    return c;
  }

  function gravarFator(chave, valor) {
    var corte = chave.indexOf(".");
    if (corte < 0) { wf.fatores[chave] = valor; return; }
    var sub = wf.fatores[chave.slice(0, corte)] || (wf.fatores[chave.slice(0, corte)] = {});
    if (valor) sub[chave.slice(corte + 1)] = valor;
    else delete sub[chave.slice(corte + 1)];
  }

  function perdaDeclarada() { return valorDoFator(wf, "losses.present") === "declared"; }

  // Arranjo e ordem só se aplicam com perda declarada; fora disso, somem do dado.
  function limparPerdasSemEfeito() {
    if (perdaDeclarada()) {
      if (!wf.fatores.losses.config) wf.fatores.losses.config = "Config S";
      return;
    }
    delete wf.fatores.losses.config;
    delete wf.fatores.losses.order;
  }

  function montarFormularioWhatIf() {
    var caixa = document.getElementById("wf-form");
    caixa.innerHTML = "";

    FATORES.forEach(function (f) {
      var ehPerdaDependente = f.chave === "losses.config" || f.chave === "losses.order";
      var inativo = ehPerdaDependente && !perdaDeclarada();

      var campo = el("label", "field" + (inativo ? " field--inactive" : ""));
      campo.appendChild(el("span", "field__label", f.label));

      var sel = el("select");
      sel.dataset.chave = f.chave;
      sel.disabled = inativo;
      if (f.chave === "losses.order" || inativo) {
        var vazio = el("option", null, inativo ? "não se aplica" : "não declarada");
        vazio.value = "";
        sel.appendChild(vazio);
      }
      (f.niveis || []).forEach(function (n) {
        var op = el("option", null, n.label);
        op.value = n.value;
        sel.appendChild(op);
      });
      sel.value = valorDoFator(wf, f.chave);

      sel.addEventListener("change", function () {
        gravarFator(f.chave, this.value);
        limparPerdasSemEfeito();
        document.getElementById("wf-start").value = "";
        montarFormularioWhatIf();
        avaliarWhatIf();
      });

      campo.appendChild(sel);
      caixa.appendChild(campo);
    });
  }

  function partirDe(id) {
    wf.fatores = copiarFatores(POR_ID[id].fatores);
    document.getElementById("wf-start").value = id;
    montarFormularioWhatIf();
    avaliarWhatIf();
  }

  function distanciaTexto(d) { return d.toFixed(2); }

  // Ordem vazia com perda declarada é dado ausente, não campo sem efeito.
  function rotuloNoWhatIf(f, valor, fatores) {
    if (valor === "" && f.chave === "losses.order" && fatores.losses.present === "declared") {
      return "não declarada";
    }
    return rotuloDoNivel(f, valor);
  }

  function contagemFora(cfg) {
    return cfg.resumo[0] + " acima do limite, " + cfg.resumo[1] + " na banda";
  }

  function avaliarWhatIf() {
    var linhaRef = document.getElementById("wf-ref");
    var saida = document.getElementById("wf-result");
    linhaRef.innerHTML = "";
    saida.innerHTML = "";

    var ref = SP.localizar(wf.fatores, CFGS);

    if (ref) {
      var fora = SP.pontosFora(ref, D);
      linhaRef.appendChild(document.createTextNode("Referência: "));
      linhaRef.appendChild(el("b", null, ref.id));
      linhaRef.appendChild(document.createTextNode(fora === 0
        ? " · todos os pontos com limite dentro do limite."
        : " · " + fora + " pontos fora de “dentro do limite” (" + contagemFora(ref) + ")."));
    } else {
      linhaRef.appendChild(el("b", null, "Combinação fora das configurações conhecidas."));
      linhaRef.appendChild(document.createTextNode(
        " Não há predição para ela nesta tela; a busca abaixo usa só os fatores, e o lado a lado " +
        "fica disponível quando a referência é uma configuração da base."));
    }

    if (ref && SP.ehSegura(ref, D)) {
      saida.appendChild(el("p", "wf-msg wf-msg--ok",
        ref.id + " já está dentro do limite em todos os pontos: não há o que corrigir a partir dela."));
      return;
    }

    var res = SP.buscar(wf.fatores, D, ref ? ref.id : null);

    if (!res.sugestao) {
      montarSemSegura(saida, res);
    } else {
      montarSugestao(saida, res, ref);
    }
    saida.appendChild(montarRanking(res));
  }

  /* Nenhuma configuração inteira dentro do limite na base: dito com todas as
     letras, em vez de uma sugestão vazia. A que menos estoura é contexto, não
     sugestão. */
  function montarSemSegura(saida, res) {
    var caixa = el("div", "wf-msg wf-msg--none");
    caixa.setAttribute("role", "alert");
    caixa.appendChild(el("b", null, "Nenhuma configuração conhecida está dentro do limite em todos os pontos."));
    caixa.appendChild(el("p", null,
      "As " + CFGS.length + " configurações têm ao menos um ponto com limite fora de " +
      "“dentro do limite”. Não há sugestão a fazer sem sair da base: a próxima " +
      "etapa é simular combinações novas, fora do escopo desta busca."));

    var menos = res.todas.slice().sort(function (a, b) {
      return a.fora - b.fora || a.distancia - b.distancia;
    })[0];
    caixa.appendChild(el("p", "legend-note",
      "Para referência, a que menos estoura é " + menos.id + " (" + menos.fora +
      " pontos fora, distância " + distanciaTexto(menos.distancia) + ") — também fora do limite."));
    saida.appendChild(caixa);
  }

  function montarSugestao(saida, res, ref) {
    var sug = res.sugestao;
    var cartao = el("div", "wf-sug");

    var topo = el("div", "wf-sug__top");
    topo.appendChild(el("span", "lead-card__kicker", "Mais próxima dentro do limite"));
    topo.appendChild(el("b", "lead-card__cfg", sug.id));
    topo.appendChild(el("span", "wf-sug__meta",
      "distância " + distanciaTexto(sug.distancia) + " · " + res.seguras.length + " de " +
      CFGS.length + " configurações estão dentro do limite em todos os pontos"));
    cartao.appendChild(topo);

    var difs = SP.camposDivergentes(wf.fatores, sug.cfg.fatores, res.padronizacao);
    var total = 0;
    difs.forEach(function (d) { total += d.peso; });

    cartao.appendChild(el("p", "wf-sug__lead", difs.length === 0
      ? "Mesmos fatores da referência."
      : "O que muda no projeto, do que mais pesa na distância ao que menos pesa:"));

    var lista = el("div", "cmp-factors wf-diffs");
    difs.forEach(function (d) {
      var f = fatorPorChave(d.campo);
      var linha = el("div", "cmp-factor");
      linha.appendChild(el("span", "cmp-factor__name", f ? f.label : d.campo));

      var vals = el("span", "cmp-factor__vals");
      vals.appendChild(el("span", "cmp-factor__val wf-de", rotuloNoWhatIf(f, d.de, wf.fatores)));
      vals.appendChild(el("span", "wf-seta", "→"));
      vals.appendChild(el("span", "cmp-factor__val wf-para", rotuloNoWhatIf(f, d.para, sug.cfg.fatores)));
      if (total > 0) {
        vals.appendChild(el("span", "wf-peso", Math.round(d.peso / total * 100) + "% da distância"));
      }
      linha.appendChild(vals);
      lista.appendChild(linha);
    });
    cartao.appendChild(lista);

    var acoes = el("div", "wf-sug__acts");
    var botao = el("button", "button", "Comparar lado a lado");
    botao.type = "button";
    if (!ref) {
      botao.disabled = true;
      acoes.appendChild(botao);
      acoes.appendChild(el("span", "legend-note",
        "Sem predição para a combinação simulada, não há coluna de referência para justapor."));
    } else {
      botao.addEventListener("click", function () {
        estado.sel = [ref.id, sug.id];
        estado.ref = ref.id;
        sincronizar();
        var alvo = document.getElementById("comparison");
        if (alvo.scrollIntoView) alvo.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      acoes.appendChild(botao);
    }
    var link = el("a", "vbtn", "Abrir " + sug.id + " na triagem");
    link.href = "triagem.html?" + parametrosDaConfig(sug.cfg);
    acoes.appendChild(link);
    cartao.appendChild(acoes);

    saida.appendChild(cartao);
  }

  // As distâncias para todas, com a classificação ao lado: é a conta inteira.
  function montarRanking(res) {
    var det = el("details", "more wf-rank");
    det.appendChild(el("summary", null, "Distância às " + res.todas.length + " configurações conhecidas"));

    var rolo = el("div", "table-scroll");
    var tab = el("table", "data-table");
    var cab = el("tr");
    ["Configuração", "Distância", "Pontos fora", "Classificação"].forEach(function (t, k) {
      var th = el("th", k === 1 || k === 2 ? "num" : null, t);
      th.setAttribute("scope", "col");
      cab.appendChild(th);
    });
    var thead = el("thead");
    thead.appendChild(cab);
    tab.appendChild(thead);

    var corpo = el("tbody");
    res.todas.forEach(function (x) {
      var tr = el("tr", res.sugestao && x.id === res.sugestao.id ? "wf-rank__sug" : null);
      tr.appendChild(celula(x.id));
      tr.appendChild(celula(distanciaTexto(x.distancia), "num"));
      tr.appendChild(celula(String(x.fora), "num"));
      tr.appendChild(celula(x.segura ? "dentro do limite" : "fora do limite"));
      corpo.appendChild(tr);
    });
    tab.appendChild(corpo);
    rolo.appendChild(tab);
    det.appendChild(rolo);
    return det;
  }

  function iniciarWhatIf() {
    var painel = document.getElementById("wf-panel");
    if (!SP) { painel.hidden = true; return; }

    document.getElementById("wf-total").textContent = CFGS.length;
    document.getElementById("wf-tol").textContent = (D.tolerancia_fracao * 100).toFixed(0) + "%";

    var inicio = document.getElementById("wf-start");
    var livre = el("option", null, "— combinação editada —");
    livre.value = "";
    livre.disabled = true;
    inicio.appendChild(livre);
    CFGS.forEach(function (c) {
      var op = el("option", null, c.id + " · " +
        impressaoDigital(c).map(function (t) { return t[1]; }).join(" · "));
      op.value = c.id;
      inicio.appendChild(op);
    });
    inicio.addEventListener("change", function () { if (this.value) partirDe(this.value); });

    partirDe(estado.ref || CFGS[0].id);
  }


  /* ----- Sincronização ----- */

  function sincronizar() {
    if (estado.sel.indexOf(estado.ref) < 0) estado.ref = estado.sel[0] || null;

    /* Amostra da rampa no eixo que legenda o perfil dos cartões. Invertida
       porque o eixo lê da esquerda para a direita, do crítico ao folgado. */
    document.getElementById("axis-sample").style.background =
      "linear-gradient(to right," + rampa().slice().reverse().join(",") + ")";

    montarCatalogo();
    montarBandeja();
    desenharParalelas();
    gravarUrl();

    var pronto = estado.sel.length >= 2;
    document.getElementById("comparison").hidden = !pronto;
    document.getElementById("empty-hint").hidden = pronto;

    if (!pronto) return;

    montarCabecalhos();
    montarFatores();
    montarAreas();
    montarVista();
    montarMonitorados();

    // RNF-06: toda previsão exibida acompanhada do identificador de versão.
    document.getElementById("trace-note").textContent =
      estado.sel.join(" · ") + " · referência " + estado.ref +
      " · modelo " + D.versao_modelo + ". " + D.config_referencia_triagem +
      " é a mesma configuração da tela de triagem, e reproduz aquele resultado ponto a ponto.";
  }


  /* ----- Ligações ----- */

  function ligarAlternancia(id, chave, valores, aoMudar) {
    document.getElementById(id).addEventListener("click", function (evento) {
      var botao = evento.target.closest("button");
      if (!botao) return;
      estado[chave] = valores(botao);
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", String(b === botao));
      });
      aoMudar();
    });
  }

  document.getElementById("cfg-search").addEventListener("input", function () {
    estado.busca = this.value.trim().toLowerCase();
    montarCatalogo();
  });

  document.getElementById("cfg-clear").addEventListener("click", limparSelecao);

  dicaPc = GRAFICO.balao(
    document.querySelector("#pc-svg").closest(".chart__frame"),
    document.getElementById("pc-tip"));

  document.getElementById("pc-limpar").addEventListener("click", function () {
    escovas = {};
    desenharParalelas();
  });

  document.getElementById("cmp-only-flip").addEventListener("change", function () {
    estado.soFlip = this.checked;
    montarVista();
  });

  ligarAlternancia("cmp-view", "vista", function (b) { return b.dataset.view; }, montarVista);
  ligarAlternancia("cmp-sort", "ordem", function (b) { return b.dataset.sort; }, montarVista);
  ligarAlternancia("cmp-scale", "escala", function (b) { return b.dataset.scale; }, sincronizar);


  /* ----- Carga ----- */

  document.getElementById("tolerance-fraction").textContent =
    (D.tolerancia_fracao * 100).toFixed(0) + "%";
  document.getElementById("cfg-total").textContent = D.total_configuracoes;
  document.getElementById("run-total").textContent = D.total_rodadas;

  document.getElementById("model-version").textContent = D.versao_modelo;
  document.getElementById("stub-banner").hidden = !D.preditor_e_stub;

  montarFacetas();

  /* Abre comparando, e não em branco: a referência da triagem contra a
     configuração de menor contagem acima do limite. É o par que a tela existe
     para mostrar, e qualquer um dos dois lados se troca no catálogo. */
  var promissora = CFGS.slice().sort(function (a, b) {
    return a.resumo[0] - b.resumo[0];
  })[0];

  // A mesma configuração que a tela já escolhia para abrir a comparação, dita
  // por extenso no topo: quem chega aqui quer saber qual estoura menos.
  document.getElementById("lead-id").textContent = promissora.id;
  document.getElementById("lead-fp").textContent =
    impressaoDigital(promissora).map(function (t) { return t[1]; }).join(" · ");
  document.getElementById("lead-over").textContent = promissora.resumo[0];
  document.getElementById("lead-band").textContent = promissora.resumo[1];
  document.getElementById("lead-in").textContent = promissora.resumo[2];
  document.getElementById("lead-link").href =
    "triagem.html?" + parametrosDaConfig(promissora);
  document.getElementById("lead-card").hidden = false;

  var inicial = lerUrl();
  if (inicial.length < 2) {
    inicial = [D.config_referencia_triagem, promissora.id];
    if (inicial[0] === inicial[1]) inicial[1] = CFGS[0].id;
  }
  estado.sel = inicial;
  estado.ref = inicial[0];

  sincronizar();
  iniciarWhatIf();
})();
