/* Tela de triagem térmica. Estado, folga e ordem das linhas já vêm prontos
 * no dado (LEITURA_PUBLICOS.fonte); aqui só há formatação e montagem de DOM.
 */

(function () {
  "use strict";

  // Payload da configuração avaliada, resolvido uma vez na montagem.
  var DADOS = null;

  var loading = document.getElementById("loading");
  var errorSection = document.getElementById("error");
  var screeningPanel = document.getElementById("screening-panel");
  var monitoringPanel = document.getElementById("monitoring-panel");
  var screeningBody = document.getElementById("screening-body");
  var monitoringBody = document.getElementById("monitoring-body");
  var tally = document.getElementById("tally");

  // Mesma severidade que ordena a tabela.
  var ORDEM_ESTADOS = ["acima_do_limite", "banda_de_incerteza", "dentro_do_limite"];

  // Só para o resumo; cada linha usa o `estado_rotulo` que vem no dado.
  var ROTULO_ESTADO = {
    acima_do_limite: "Acima do limite",
    banda_de_incerteza: "Banda de incerteza",
    dentro_do_limite: "Dentro do limite"
  };

  // Na tela, pt-BR: vírgula decimal e sinal de menos tipográfico, com a mesma
  // casa decimal para a mesma grandeza. A planilha exportada guarda o número cru.
  function fmt(valor, casas) {
    var t = valor.toFixed(casas);
    if (Number(t) === 0) t = t.replace("-", "");
    return t.replace(".", ",").replace("-", "−");
  }

  function grausC(valor) {
    return fmt(valor, 1);
  }

  function percentual(fracao) {
    return fmt(fracao * 100, 1) + "%";
  }

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function celula(texto, classe) {
    var td = document.createElement("td");
    td.textContent = texto;
    if (classe) td.className = classe;
    return td;
  }

  /* Marca o ponto previsto por modelo que o grupo não validou.

     O modelo final é uma mescla por área, e as áreas não têm a mesma qualidade:
     `AC Blower Inlet` não teve modelo aprovado, e os seus dois pontos cairiam na
     tabela com o mesmo peso visual dos validados. Quem casa ponto e modelo é
     `PREVISAO_SESSAO`, por `subsistema_modelo` e nunca por `Key_Area` — a área
     `Main Vent Sys` sai de dois modelos. Nos dados de demonstração, que não
     trazem o bloco `modelos`, nada é marcado. */
  function marcaDeModelo(ponto) {
    if (typeof PREVISAO_SESSAO === "undefined") return null;

    return PREVISAO_SESSAO.marcaDeModelo(document, DADOS, ponto);
  }

  // Subsistema como segunda linha da célula, para a tabela ficar nas seis
  // colunas definidas sem perder a área do ponto.
  function celulaPonto(ponto) {
    var td = document.createElement("td");

    var nome = document.createElement("span");
    nome.className = "point__name";
    nome.textContent = ponto.TC_Name;
    td.appendChild(nome);

    var area = document.createElement("span");
    area.className = "point__area";
    area.textContent = ponto.Key_Area;
    td.appendChild(area);

    var marca = marcaDeModelo(ponto);
    if (marca) td.appendChild(marca);

    return td;
  }

  // O rótulo textual é sempre exibido: a régua colorida é redundante com
  // ele, nunca substituta.
  function celulaEstado(ponto) {
    var td = document.createElement("td");

    var marca = document.createElement("span");
    marca.className = "state state--" + ponto.estado;
    marca.textContent = ponto.estado_rotulo;
    td.appendChild(marca);

    return td;
  }

  function linhaClassificada(ponto) {
    var tr = document.createElement("tr");
    tr.className = "row--" + ponto.estado;

    // Folga é a coluna que decide, e a única que sai do neutro quando é
    // negativa: as outras colunas ficam legíveis por contraste com ela.
    var sinal = ponto.margem_c < 0 ? " margin--negative" : " margin--positive";

    tr.appendChild(celulaPonto(ponto));
    tr.appendChild(celula(grausC(ponto.temperatura_prevista_c), "num"));
    tr.appendChild(celula(grausC(ponto.limit_c), "num"));
    tr.appendChild(celula(grausC(ponto.margem_c), "num" + sinal));
    tr.appendChild(celula(percentual(ponto.margem_percentual), "num" + sinal));
    tr.appendChild(celulaEstado(ponto));

    return tr;
  }

  // RN-03: três colunas só. As outras não existem para estes pontos, e
  // exibi-las vazias sugeriria dado ausente em vez de regra.
  function linhaMonitorada(ponto) {
    var tr = document.createElement("tr");

    tr.appendChild(celulaPonto(ponto));
    tr.appendChild(celula(grausC(ponto.temperatura_prevista_c), "num"));
    tr.appendChild(celula("Monitoramento", "cell-muted"));

    return tr;
  }

  function montarResumo(pontos) {
    var contagem = {};
    ORDEM_ESTADOS.forEach(function (estado) { contagem[estado] = 0; });
    pontos.forEach(function (ponto) { contagem[ponto.estado] += 1; });

    ORDEM_ESTADOS.forEach(function (estado) {
      var li = document.createElement("li");

      var termo = document.createElement("span");
      termo.className = "tally__term";
      termo.textContent = ROTULO_ESTADO[estado];
      li.appendChild(termo);

      var valor = document.createElement("span");
      valor.className = "tally__count";
      valor.textContent = contagem[estado];
      li.appendChild(valor);

      tally.appendChild(li);
    });
  }

  /* O título da tela é a conclusão, e não o nome dela: quantos dos pontos com
     limite passam dele. Conta o que a tabela lista, sem regra nova. */
  function tituloConclusao(pontos) {
    var total = pontos.length;
    var acima = pontos.filter(function (p) { return p.estado === "acima_do_limite"; }).length;
    var banda = pontos.filter(function (p) { return p.estado === "banda_de_incerteza"; }).length;
    if (acima) return acima + " de " + total + (acima === 1 ? " ponto acima do limite" : " pontos acima do limite");
    if (banda) return "Nenhum ponto acima do limite; " + banda + " na banda de incerteza";
    return "Nenhum dos " + total + " pontos acima do limite";
  }

  function render(dados) {
    document.getElementById("tolerance-fraction").textContent =
      (dados.tolerancia_fracao * 100).toFixed(0) + "%";

    document.getElementById("page-title").textContent = tituloConclusao(dados.pontos);

    // Chip e aviso de demonstração ficam com js/previsao_sessao.js, que vale para
    // as cinco telas e já sabe se o dado veio do modelo ou do stub.

    // Ordem já vem pronta no dado; reordenar aqui duplicaria a regra.
    dados.pontos.forEach(function (ponto) {
      var tr = linhaClassificada(ponto);
      // Uma seleção, dois lugares: a linha e o ponto no modelo.
      tr.addEventListener("click", function () { selecionar(ponto); });
      tr.style.cursor = "pointer";
      linhaPorId[ponto.measurement_id] = tr;
      screeningBody.appendChild(tr);
    });
    montarResumo(dados.pontos);
    screeningPanel.hidden = false;

    /* O total sai do dado, e não do HTML: o catálogo tem 78 pontos, mas o modelo
       prevê 77 — `IPC Cooling P05` nunca foi medido e não tem modelo —,
       e o de demonstração traz os 78. Número fixo aqui mentiria em um dos casos. */
    document.getElementById("monitoring-count").textContent = dados.total_monitoramento;
    document.getElementById("monitoring-total").textContent = dados.total_pontos;
    dados.monitoramento.forEach(function (ponto) {
      var tr = linhaMonitorada(ponto);
      tr.addEventListener("click", function () { selecionar(ponto); });
      tr.style.cursor = "pointer";
      linhaPorId[ponto.measurement_id] = tr;
      monitoringBody.appendChild(tr);
    });
    monitoringPanel.hidden = false;

    montarMapa();
  }




  /* ----- Leitura visual da triagem -----

     Quatro figuras abaixo da tabela, que respondem, nesta ordem, as perguntas
     que a tabela não responde:

       cartões        o veredito em dois segundos
       ranking        onde estou apertado, do pior para o menos pior
       previsto×limite  o conjunto passa no critério
       por subsistema onde o risco se concentra

     Todas leem o mesmo recorte da tabela e apontam para a mesma seleção: o
     ponto sob o ponteiro acende nas quatro ao mesmo tempo, e o clique abre o
     mesmo painel de detalhe que a linha e o modelo abrem. São quatro vistas
     de um instrumento, e não quatro figuras soltas.

     Duas ausências são deliberadas. Não há barra de erro do modelo: ela
     depende de um erro por ponto que só existe depois do treino, e desenhar
     uma faixa sem esse número seria inventar precisão. E não há pizza,
     rosca nem velocímetro: onde a informação é um número, o número comunica
     melhor do que o desenho dele. */

  var svgRanking = document.getElementById("viz-ranking");
  var svgCritério = document.getElementById("viz-criterio");
  var svgSubsistema = document.getElementById("viz-subsistema");
  var dicaViz = null;
  var rankingTodos = false;

  var RANKING_TOPO = 14;

  function classificadosVisiveis() {
    return DADOS.pontos.filter(passaNoFiltro);
  }

  function rampaAtual() {
    return mapa.escala === "b" ? FOGAO.RAMPA_B : FOGAO.RAMPA_A;
  }

  function dicaDoPonto(p) {
    return "<b class=\"tip__name\">" + p.TC_Name + "</b>" +
      "<span class=\"tip__state\">" + p.Key_Area + "</span><br>" +
      "<span class=\"tip__num\">" + grausC(p.temperatura_prevista_c) + " °C</span>" +
      " de <span class=\"tip__num\">" + grausC(p.limit_c) + " °C</span>" +
      " · <span class=\"tip__num\">folga " + grausC(p.margem_c) + " °C</span>" +
      " (" + percentual(p.margem_percentual) + ")" +
      "<span class=\"tip__state\"> · " + p.estado_rotulo + "</span>";
  }

  /* Uma marca de ponto de medição, com tudo que ela precisa saber fazer:
     acender junto com suas irmãs, abrir o balão e abrir o detalhe. */
  function marcaDoPonto(p, cx, cy, escala) {
    var m = GRAFICO.el("path", {
      d: FOGAO.formaDoPonto(cx, cy, p.estado, false),
      "class": "ax-marca",
      "data-ponto": p.measurement_id
    });
    if (escala && escala !== 1) {
      m.setAttribute("transform",
        "translate(" + cx + " " + cy + ") scale(" + escala + ") translate(" + (-cx) + " " + (-cy) + ")");
    }
    m.style.fill = rampaAtual()[FOGAO.faixaDaRampa(p.margem_percentual)];
    m.style.stroke = p.measurement_id === mapa.sel ? "var(--color-selecao)" : "var(--color-glyph-line)";
    m.style.strokeWidth = p.measurement_id === mapa.sel ? "2.4" : "0.7";

    m.addEventListener("pointerenter", function () {
      realcar(p.measurement_id);
      dicaViz.mostrar(m, dicaDoPonto(p));
    });
    m.addEventListener("pointerleave", function () { realcar(null); });
    m.addEventListener("click", function () { selecionar(p); });
    return m;
  }

  /* O mesmo ponto acende nas quatro figuras. Percorrer o DOM é mais barato
     que redesenhar tudo a cada movimento do ponteiro, e é instantâneo. */
  function realcar(id) {
    var caixa = document.getElementById("visuais");
    caixa.classList.toggle("viz-apagando", !!id);
    Array.prototype.forEach.call(caixa.querySelectorAll(".ax-marca"), function (m) {
      m.classList.toggle("is-realce", !!id && m.dataset.ponto === id);
    });
    if (!id) dicaViz.esconder();
  }


  /* ----- Cartões ----- */

  function montarKpis() {
    var pts = classificadosVisiveis();
    var caixa = document.getElementById("kpis");
    caixa.innerHTML = "";

    var acima = pts.filter(function (p) { return p.estado === "acima_do_limite"; });
    var banda = pts.filter(function (p) { return p.estado === "banda_de_incerteza"; });

    var pior = null;
    pts.forEach(function (p) { if (!pior || p.margem_c < pior.margem_c) pior = p; });

    // Mesma regra que o resumo executivo usa para nomear o subsistema.
    var critico = LEITURA_PUBLICOS.subsistemaMaisCritico(pts);

    function cartao(rotulo, valor, unidade, nota, classe) {
      var c = el("div", "kpi" + (classe ? " " + classe : ""));
      c.appendChild(el("span", "kpi__rotulo", rotulo));
      var v = el("span", "kpi__valor", valor);
      if (unidade) v.appendChild(el("small", null, unidade));
      c.appendChild(v);
      c.appendChild(el("span", "kpi__nota", nota));
      return c;
    }

    caixa.appendChild(cartao("Acima do limite", String(acima.length),
      "de " + pts.length,
      LEITURA_PUBLICOS.percentual(acima.length, pts.length) + " · previsão acima do próprio limite",
      acima.length ? "kpi--alerta" : null));

    caixa.appendChild(cartao("Inconclusivos", String(banda.length),
      "na banda",
      LEITURA_PUBLICOS.percentual(banda.length, pts.length) + " · folga menor que a tolerância",
      banda.length ? "kpi--atencao" : null));

    caixa.appendChild(cartao("Pior folga",
      pior ? grausC(pior.margem_c) : "—", "°C",
      pior ? pior.TC_Name : "sem pontos no recorte",
      pior && pior.margem_c < 0 ? "kpi--alerta" : null));

    caixa.appendChild(cartao("Subsistema mais crítico",
      critico ? (critico.proporcao_acima * 100).toFixed(0) : "—", "%",
      critico ? critico.area + " · " + critico.acima + " de " + critico.n + " acima" : "—",
      critico && critico.acima > 0 ? "kpi--alerta" : null));
  }


  /* ----- Ranking de folga -----
     Folga, e não temperatura absoluta: saber que a bobina fica muito quente não diz
     nada sozinho; saber que ela fica acima do próprio limite, e por quanto, diz
     tudo. A folga já traz o limite embutido, e é o que permite pôr numa
     escala só pontos cujos limites são muito diferentes entre si. */

  function desenharRanking() {
    GRAFICO.limpar(svgRanking);

    var pts = classificadosVisiveis().slice();
    var ORDEM = { acima_do_limite: 0, banda_de_incerteza: 1, dentro_do_limite: 2 };
    pts.sort(function (a, b) {
      return ORDEM[a.estado] - ORDEM[b.estado] || a.margem_percentual - b.margem_percentual;
    });

    var total = pts.length;
    var mostrados = rankingTodos ? pts : pts.slice(0, RANKING_TOPO);

    var ML = 186, MR = 62, MT = 40, MB = 12, ALT = 20;
    var LARG = 880, PW = LARG - ML - MR;
    var H = MT + Math.max(1, mostrados.length) * ALT + MB;

    svgRanking.setAttribute("viewBox", "0 0 " + LARG + " " + H);
    svgRanking.setAttribute("height", H);

    var botao = document.getElementById("viz-ranking-todos");
    botao.hidden = total <= RANKING_TOPO;
    botao.textContent = rankingTodos
      ? "Ver só os " + RANKING_TOPO + " piores"
      : "Ver todos os " + total;

    if (!mostrados.length) {
      svgRanking.appendChild(GRAFICO.texto(ML, MT + 16,
        "Nenhum ponto atende aos filtros ativos.", "ax-text"));
      return;
    }

    // Escala fixa nos 68, e não no recorte: assim a mesma folga ocupa sempre
    // o mesmo lugar, e dois recortes se comparam.
    var lo = 0, hi = 0;
    DADOS.pontos.forEach(function (p) {
      lo = Math.min(lo, p.margem_percentual);
      hi = Math.max(hi, p.margem_percentual);
    });
    lo -= 0.04; hi += 0.04;

    var X = GRAFICO.eixoDeFolga(svgRanking, {
      lo: lo, hi: hi, x0: ML, largura: PW,
      topo: MT - 12, base: H - MB, yRotulo: MT - 18,
      tolerancia: DADOS.tolerancia_fracao
    });
    svgRanking.appendChild(GRAFICO.texto(ML, 12, "Folga relativa ao limite", "ax-rotulo"));

    var zero = X(0);
    mostrados.forEach(function (p, k) {
      var y = MT + k * ALT + ALT / 2;
      var cx = X(p.margem_percentual);

      svgRanking.appendChild(GRAFICO.el("rect", {
        x: 0, y: y - ALT / 2, width: LARG, height: ALT,
        "class": k % 2 === 1 ? "ax-faixa-alt" : "ax-hit"
      }));

      // A haste sai do limite e vai até a folga: o comprimento é a distância
      // do ponto à fronteira que decide.
      var haste = GRAFICO.el("line", {
        x1: zero, y1: y, x2: cx, y2: y, "class": "desl-linha"
      });
      haste.style.stroke = rampaAtual()[FOGAO.faixaDaRampa(p.margem_percentual)];
      haste.style.opacity = "0.55";
      svgRanking.appendChild(haste);

      svgRanking.appendChild(marcaDoPonto(p, cx, y));

      svgRanking.appendChild(GRAFICO.texto(ML - 12, y + 3.5,
        GRAFICO.corta(p.TC_Name, 28),
        p.measurement_id === mapa.sel ? "ax-text ax-text--forte" : "ax-text", "end"));
      svgRanking.appendChild(GRAFICO.texto(ML + PW + 8, y + 3.5,
        grausC(p.margem_c), "ax-text", "start"));
    });
  }


  /* ----- Previsto contra limite -----
     Mesma figura da Seção 4.2.1 da documentação, que o parceiro já leu com
     dados medidos: a reta onde a previsão iguala o limite, e todo ponto
     acima dela ultrapassa o próprio limite. Aqui ela volta com a previsão no
     lugar da medição, o que mantém a mesma linguagem visual entre a
     exploração e o painel. */

  function desenharCriterio() {
    GRAFICO.limpar(svgCritério);

    var pts = classificadosVisiveis();
    var ML = 58, MR = 20, MT = 34, MB = 46;
    var LARG = 660, ALT = 500;
    var PW = LARG - ML - MR, PH = ALT - MT - MB;

    svgCritério.setAttribute("viewBox", "0 0 " + LARG + " " + ALT);
    svgCritério.setAttribute("height", ALT);

    var maxLim = 0, maxTemp = 0;
    DADOS.pontos.forEach(function (p) {
      maxLim = Math.max(maxLim, p.limit_c);
      maxTemp = Math.max(maxTemp, p.temperatura_prevista_c);
    });
    var topo = Math.ceil(Math.max(maxLim, maxTemp) / 50) * 50;

    function X(v) { return ML + v / topo * PW; }
    function Y(v) { return MT + PH - v / topo * PH; }

    for (var t = 0; t <= topo; t += 50) {
      svgCritério.appendChild(GRAFICO.el("line",
        { x1: X(t), y1: MT, x2: X(t), y2: MT + PH, "class": "ax-line" }));
      svgCritério.appendChild(GRAFICO.el("line",
        { x1: ML, y1: Y(t), x2: ML + PW, y2: Y(t), "class": "ax-line" }));
      svgCritério.appendChild(GRAFICO.texto(X(t), MT + PH + 14, String(t), "ax-text", "middle"));
      svgCritério.appendChild(GRAFICO.texto(ML - 6, Y(t) + 3.5, String(t), "ax-text", "end"));
    }

    /* A banda entre a reta do limite e 90% dela é a banda de incerteza vista
       neste par de eixos: abaixo dela o ponto está dentro, dentro dela a
       folga não supera a tolerância, acima dela ultrapassa o limite. */
    var tol = DADOS.tolerancia_fracao;
    svgCritério.appendChild(GRAFICO.el("path", {
      d: "M" + X(0) + " " + Y(0) + " L" + X(topo) + " " + Y(topo) +
         " L" + X(topo) + " " + Y(topo * (1 - tol)) + " Z",
      "class": "ax-band"
    }));

    svgCritério.appendChild(GRAFICO.el("line", {
      x1: X(0), y1: Y(0), x2: X(topo), y2: Y(topo), "class": "ax-zero"
    }));

    svgCritério.appendChild(GRAFICO.texto(X(topo) - 6, Y(topo) + 16,
      "previsão = limite", "ax-text ax-text--forte", "end"));
    svgCritério.appendChild(GRAFICO.texto(ML, MT - 10,
      "Temperatura prevista (°C)", "ax-rotulo"));
    svgCritério.appendChild(GRAFICO.texto(ML + PW, ALT - 8,
      "Limite declarado (°C)", "ax-rotulo", "end"));
    svgCritério.appendChild(GRAFICO.texto(ML, ALT - 8,
      "acima da reta = ultrapassa o limite", "ax-text ax-text--eixo"));

    pts.forEach(function (p) {
      svgCritério.appendChild(marcaDoPonto(p,
        X(p.limit_c), Y(p.temperatura_prevista_c), 0.85));
    });
  }


  /* ----- Dispersão por subsistema -----
     Onde o risco se concentra. A caixa de quartis dá a leitura de grupo que
     um diagrama de caixa daria; os pontos por cima ficam porque com 68
     observações esconder cada uma atrás de um resumo custa mais do que
     ganha. */

  function desenharSubsistema() {
    GRAFICO.limpar(svgSubsistema);

    var visiveis = classificadosVisiveis();
    var ML = 148, MR = 26, MT = 40, MB = 12;
    var LARG = 880, PW = LARG - ML - MR;

    if (!visiveis.length) {
      svgSubsistema.setAttribute("viewBox", "0 0 " + LARG + " 70");
      svgSubsistema.setAttribute("height", 70);
      svgSubsistema.appendChild(GRAFICO.texto(ML, 40,
        "Nenhum ponto atende aos filtros ativos.", "ax-text"));
      return;
    }

    var lo = 0, hi = 0;
    DADOS.pontos.forEach(function (p) {
      lo = Math.min(lo, p.margem_percentual);
      hi = Math.max(hi, p.margem_percentual);
    });
    lo -= 0.04; hi += 0.04;

    var porArea = {};
    visiveis.forEach(function (p) { (porArea[p.Key_Area] = porArea[p.Key_Area] || []).push(p); });
    var areas = Object.keys(porArea).sort(function (a, b) {
      return porArea[b].length - porArea[a].length;
    });

    var PASSO = 11, RAIO = 13;
    var faixas = areas.map(function (area) {
      var xs = porArea[area].map(function (p) { return p.margem_percentual; });
      var desvios = GRAFICO.enxame(xs, RAIO / PW * (hi - lo), PASSO);
      var extremo = desvios.reduce(function (m, d) { return Math.max(m, Math.abs(d)); }, 0);
      return { area: area, pontos: porArea[area], desvios: desvios, altura: Math.max(38, extremo * 2 + 26) };
    });

    var H = MT + faixas.reduce(function (t, f) { return t + f.altura; }, 0) + MB;
    svgSubsistema.setAttribute("viewBox", "0 0 " + LARG + " " + H);
    svgSubsistema.setAttribute("height", H);

    var X = GRAFICO.eixoDeFolga(svgSubsistema, {
      lo: lo, hi: hi, x0: ML, largura: PW,
      topo: MT - 12, base: H - MB, yRotulo: MT - 18,
      tolerancia: DADOS.tolerancia_fracao
    });
    svgSubsistema.appendChild(GRAFICO.texto(ML, 12, "Folga relativa ao limite", "ax-rotulo"));

    function quantil(ordenados, q) {
      var i = (ordenados.length - 1) * q, b = Math.floor(i), r = i - b;
      return ordenados[b + 1] !== undefined
        ? ordenados[b] + (ordenados[b + 1] - ordenados[b]) * r
        : ordenados[b];
    }

    var y = MT;
    faixas.forEach(function (f, k) {
      var meio = y + f.altura / 2;
      var isolado = mapa.isolar === "todos" || mapa.isolar === f.area;

      if (k % 2 === 1) {
        svgSubsistema.appendChild(GRAFICO.el("rect",
          { x: 0, y: y, width: LARG, height: f.altura, "class": "ax-faixa-alt" }));
      }

      var g = GRAFICO.el("g", isolado ? {} : { "class": "ax-recuado" });

      var xs = f.pontos.map(function (p) { return p.margem_percentual; })
        .sort(function (a, b) { return a - b; });
      if (xs.length >= 4) {
        var q1 = X(quantil(xs, 0.25)), q3 = X(quantil(xs, 0.75)), med = X(quantil(xs, 0.5));
        var caixa = GRAFICO.el("rect", {
          x: q1, y: meio - 9, width: Math.max(1, q3 - q1), height: 18, rx: 1
        });
        caixa.style.fill = "none";
        caixa.style.stroke = "var(--color-data-muted)";
        caixa.style.strokeWidth = "1";
        g.appendChild(caixa);
        var mediana = GRAFICO.el("line", { x1: med, y1: meio - 9, x2: med, y2: meio + 9 });
        mediana.style.stroke = "var(--color-text-muted)";
        mediana.style.strokeWidth = "1.6";
        g.appendChild(mediana);
      }

      var acima = f.pontos.filter(function (p) { return p.estado === "acima_do_limite"; }).length;
      g.appendChild(GRAFICO.texto(ML - 12, meio - 2, f.area,
        isolado && mapa.isolar !== "todos" ? "ax-text ax-text--forte" : "ax-text", "end"));
      g.appendChild(GRAFICO.texto(ML - 12, meio + 12,
        acima + " acima de " + f.pontos.length, "ax-text ax-text--eixo", "end"));

      f.pontos.forEach(function (p, i) {
        g.appendChild(marcaDoPonto(p, X(p.margem_percentual), meio + f.desvios[i]));
      });

      svgSubsistema.appendChild(g);
      y += f.altura;
    });
  }


  function desenharVisuais() {
    montarKpis();
    desenharRanking();
    desenharCriterio();
    desenharSubsistema();
  }

  /* ----- Mapa de calor ----- */

  var palcoCalor = document.getElementById("heat-3d");
  /* `zona` é a peça selecionada (id em FOGAO.ZONAS) e `semDado` a última peça
     clicada que não tem termopar, só para o painel dizer por quê. */
  // `explode` vai de 0 (montado) a 1; `raioX` combina com qualquer valor dele.
  var mapa = { explode: 1, raioX: false, escala: "a", isolar: "todos", faixas: {}, sel: null,
               zona: null, semDado: null,
               vista: "pontos", nome: "", estados: {}, mono: true,
               camadas: { volume: true, fluxo: true, iso: true, focos: true } };
  var linhaPorId = {};
  var modelo = null;


  function todosOsPontos() {
    return DADOS.pontos.concat(DADOS.monitoramento);
  }

  function svgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function marcadorDoEstado(estado, mono, cor) {
    var svg = svgEl("svg", { width: 12, height: 12, "aria-hidden": "true" });
    svg.appendChild(svgEl("path", {
      d: FOGAO.formaDoPonto(6, 6, estado, mono),
      fill: mono ? "var(--color-surface)" : cor,
      stroke: mono ? "var(--color-glyph-line-mono)" : "var(--color-glyph-line)",
      "stroke-width": 0.8,
      "stroke-dasharray": mono ? "2.5 2" : ""
    }));
    return svg;
  }

  // Estado que cada faixa da rampa representa, para escolher o marcador.
  function estadoDaFaixa(i) {
    if (i <= 2) return "dentro_do_limite";
    if (i === 3) return "banda_de_incerteza";
    return "acima_do_limite";
  }

  function montarRampa() {
    var caixa = document.getElementById("ramp");
    var rampa = mapa.escala === "b" ? FOGAO.RAMPA_B : FOGAO.RAMPA_A;
    var contagem = [0, 0, 0, 0, 0, 0, 0, 0];
    DADOS.pontos.forEach(function (p) { contagem[FOGAO.faixaDaRampa(p.margem_percentual)] += 1; });

    caixa.innerHTML = "";
    FOGAO.FAIXAS.forEach(function (rotulo, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ramp__row" + (i === 3 ? " ramp__row--boundary" : "");
      b.setAttribute("aria-pressed", String(!!mapa.faixas[i]));

      var chip = document.createElement("span");
      chip.className = "ramp__chip";
      chip.style.background = rampa[i];
      b.appendChild(chip);

      var faixa = document.createElement("span");
      faixa.className = "ramp__range";
      faixa.textContent = rotulo;
      b.appendChild(faixa);

      b.appendChild(marcadorDoEstado(estadoDaFaixa(i), false, rampa[i]));

      var n = document.createElement("span");
      n.className = "ramp__count";
      n.textContent = contagem[i];
      b.appendChild(n);

      b.addEventListener("click", function () {
        // Faixas somam: marcar as duas vizinhas de zero remonta a banda de
        // incerteza de RN-01 sem inventar limiar fora dos cortes de 0 e 10%.
        if (mapa.faixas[i]) delete mapa.faixas[i]; else mapa.faixas[i] = true;
        montarRampa();
        aplicarFiltros();
      });
      caixa.appendChild(b);
    });

    document.getElementById("mono-count").textContent = DADOS.total_monitoramento;
  }

  function montarSubsistemas() {
    var caixa = document.getElementById("subsys");
    var total = {}, acima = {};
    todosOsPontos().forEach(function (p) {
      total[p.Key_Area] = (total[p.Key_Area] || 0) + 1;
      if (p.estado === "acima_do_limite") acima[p.Key_Area] = (acima[p.Key_Area] || 0) + 1;
    });

    var areas = Object.keys(total).sort(function (a, b) { return total[b] - total[a]; });
    caixa.innerHTML = "";

    var linhas = [["todos", "Todos", DADOS.total_pontos, null]];
    areas.forEach(function (a) { linhas.push([a, a, total[a], acima[a] || 0]); });

    linhas.forEach(function (linha) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", String(mapa.isolar === linha[0]));

      var nome = document.createElement("span");
      nome.className = "subsys__name";
      nome.textContent = linha[1];
      b.appendChild(nome);

      if (linha[3] !== null) {
        var over = document.createElement("span");
        over.className = "subsys__over";
        over.style.color = linha[3] > 0 ? "var(--color-critical)" : "var(--color-text-subtle)";
        over.textContent = linha[3];
        b.appendChild(over);
      }

      var tot = document.createElement("span");
      tot.className = "subsys__total";
      tot.textContent = linha[2];
      b.appendChild(tot);

      b.addEventListener("click", function () {
        mapa.isolar = linha[0];
        montarSubsistemas();
        redesenharCalor();
        desenharVisuais();
      });
      caixa.appendChild(b);
    });
  }

  /* Traduz a configuração consultada nos parâmetros que mexem na geometria.
     Dois dos sete fatores movem termopares de lugar: `Board_Position` desloca
     a PCB, e com ela os 37 pontos do IPC Comp; `Housing` levanta a tampa, e
     com ela os 5 do IPC Cooling. Ignorar isso fazia o mapa desenhar sempre a
     mesma máquina, qualquer que fosse a configuração avaliada. */
  function geometriaDaConfig(config) {
    config = config || {};
    return {
      placa: config.board_position === "Right" ? "right" : "center",
      alojamento: config.housing && config.housing !== "Closed" ? "open" : "closed",
      material: config.material_coil_support === "Plastic" ? "plastic"
        : config.material_coil_support === "Aluminium Plate" ? "plate" : "aluminium",
      soprador: config.blower_direction === "To Back" ? "back" : "front",
      // Não muda geometria: é o que o display do forno mostra.
      caso: config.run_case
    };
  }

  var geometria = geometriaDaConfig(null);

  function corDoPonto(p) {
    return PAINEL_PECA.corDoPonto(p, rampaAtual());
  }

  function linhaDetalhe(rotulo, valor, vazio) {
    return "<dt>" + rotulo + "</dt><dd" + (vazio ? " class=\"is-empty\"" : "") + ">" + valor + "</dd>";
  }

  /* Cartão de confiança: temperatura prevista ao lado do nível e do glifo com
     halo, na mesma escala do 3D. Lê só o contrato de CONFIANCA — o aviso de
     ilustrativo depende de `conf.ilustrativo`, então some sozinho quando a
     métrica real entrar. Não toca no estado de risco, que segue logo acima. */
  function cartaoConfianca(p, cor) {
    var conf = CONFIANCA.doPonto(p);
    // Marcador de 4,4 px como nos gráficos; caixa de 60 px cabe até o halo de incerteza total.
    var PX_MARCA = 4.4, C = 30;
    var raio = CONFIANCA.raioHalo(conf) * PX_MARCA;
    var marca = FOGAO.formaDoPonto(C, C, p.estado, p.is_monitor_only);
    // Três passos: alta acende três, baixa acende um.
    var acesos = CONFIANCA.ORDEM.length - CONFIANCA.ORDEM.indexOf(conf.nivel);
    var passos = CONFIANCA.ORDEM.map(function (n, i) {
      return "<span class=\"conf__passo" + (i < acesos ? " is-on" : "") + "\"></span>";
    }).join("");

    return "<section class=\"conf conf--" + conf.nivel + (conf.ilustrativo ? " conf--ilustrativo" : "") + "\" aria-label=\"Confiança da previsão\">" +
      "<div class=\"conf__head\">" +
        "<h4 class=\"conf__title\">Confiança da previsão</h4>" +
        (conf.ilustrativo ? "<span class=\"conf__tag\">Ilustrativo · preliminar</span>" : "") +
      "</div>" +
      "<div class=\"conf__body\">" +
        "<svg class=\"conf__glifo\" width=\"" + 2 * C + "\" height=\"" + 2 * C + "\" viewBox=\"0 0 " + 2 * C + " " + 2 * C + "\" aria-hidden=\"true\">" +
          "<circle class=\"conf__halo\" cx=\"" + C + "\" cy=\"" + C + "\" r=\"" + raio.toFixed(1) + "\"></circle>" +
          "<path d=\"" + marca + "\" fill=\"" + (p.is_monitor_only ? "var(--color-surface)" : cor) + "\" stroke=\"" + (p.is_monitor_only ? "var(--color-glyph-line-mono)" : "var(--color-glyph-line)") + "\" stroke-width=\"0.8\"" +
            (p.is_monitor_only ? " stroke-dasharray=\"2.5 2\"" : "") + "></path>" +
        "</svg>" +
        "<dl class=\"conf__dados\">" +
          "<div><dt>Temperatura prevista</dt><dd class=\"conf__temp\">" + grausC(p.temperatura_prevista_c) + " °C</dd></div>" +
          "<div><dt>Confiança</dt><dd class=\"conf__nivel\"><span class=\"conf__passos\" aria-hidden=\"true\">" + passos + "</span>" + conf.rotulo + "</dd></div>" +
        "</dl>" +
      "</div>" +
      "<p class=\"conf__nota\">" +
        (conf.ilustrativo ? "Atribuído sem cálculo: não é métrica do modelo e não altera o estado de risco. " : "") +
        "Halo maior, menor confiança." +
      "</p>" +
    "</section>";
  }

  function mostrarDetalhe(p) {
    var caixa = document.getElementById("detail");
    if (!p) {
      caixa.innerHTML = "<p class=\"detail__empty\">Clique num ponto do modelo ou numa linha da tabela.</p>";
      return;
    }

    var cor = corDoPonto(p);
    var html = "<p class=\"detail__name\">" + p.TC_Name + "</p>" +
      "<span class=\"detail__area\">" + p.Key_Area + "</span>" +
      "<p class=\"detail__state detail__state--" + (p.is_monitor_only ? "mono" : p.estado) + "\">" +
      "<span class=\"detail__swatch\" style=\"background:" + cor + ";box-shadow:inset 0 0 0 1px var(--color-swatch-ring-strong)\"></span>" +
      "<span>" + (p.is_monitor_only ? "Limite não declarado" : p.estado_rotulo) + "</span></p>" +
      // A temperatura prevista mora no cartão, ao lado da confiança.
      cartaoConfianca(p, cor) +
      "<dl class=\"detail__rows\">";

    if (p.is_monitor_only) {
      html += linhaDetalhe("Limite do componente", "—", true) +
        linhaDetalhe("Folga", "—", true) +
        linhaDetalhe("Estado de risco", "não se aplica", true) + "</dl>" +
        "<p class=\"legend-note\">Sem limite, não recebe estado nem entra na escala.</p>";
    } else {
      var tol = DADOS.tolerancia_fracao * p.limit_c;
      html += linhaDetalhe("Limite do componente", grausC(p.limit_c) + " °C") +
        linhaDetalhe("Folga", grausC(p.margem_c) + " °C") +
        linhaDetalhe("Folga relativa", percentual(p.margem_percentual)) +
        linhaDetalhe("Tolerância (10% do limite)", grausC(tol) + " °C") + "</dl>";

      // Onde a previsão cai em relação ao limite.
      var frac = Math.max(0, Math.min(1, p.temperatura_prevista_c / (p.limit_c * 1.6)));
      var marca = 1 / 1.6;
      html += "<div class=\"gauge\">" +
        "<div class=\"gauge__fill\" style=\"width:" + (frac * 100).toFixed(1) + "%;background:" + cor + "\"></div>" +
        "<div class=\"gauge__mark\" style=\"left:" + (marca * 100).toFixed(1) + "%\"></div>" +
        "<span class=\"gauge__tag\" style=\"left:calc(" + (marca * 100).toFixed(1) + "% + 5px)\">limite</span></div>" +
        "<p class=\"legend-note\">Valor de triagem. Confirmar por CFD antes de decidir.</p>";
    }

    caixa.innerHTML = html;
  }

  /* Seleção de ponto e de peça andam amarradas por uma regra só: havendo
     ponto selecionado, a peça selecionada é a dele. Escolher um ponto — no
     modelo, na tabela, nos gráficos ou na lista da peça — leva a peça junto;
     trocar ou soltar a peça solta o ponto que não mora nela. Assim os dois
     painéis nunca descrevem coisas diferentes. */
  function selecionar(p) {
    mapa.sel = p ? p.measurement_id : null;
    if (p) {
      var zona = FOGAO.zonaDoPonto(p);
      mapa.zona = zona ? zona.id : null;
      mapa.semDado = null;
    }
    atualizarSelecao(p);
  }

  function pontoSelecionado() {
    if (!mapa.sel) return null;
    return todosOsPontos().filter(function (p) { return p.measurement_id === mapa.sel; })[0] || null;
  }

  function selecionarZona(id) {
    mapa.zona = id;
    mapa.semDado = null;
    var p = pontoSelecionado();
    if (p && (!id || FOGAO.zonaDoPonto(p).id !== id)) mapa.sel = null;
    atualizarSelecao(pontoSelecionado());
  }

  function limparSelecao() {
    mapa.sel = null;
    mapa.zona = null;
    mapa.semDado = null;
    atualizarSelecao(null);
  }

  /* Clique no modelo fora de marcador. Fundo e Esc limpam tudo; peça sem
     termopar também solta a seleção, mas o painel diz que o clique pegou e
     por que não há resumo; clicar de novo na peça já selecionada a solta. */
  function clicarPeca(alvo) {
    if (!alvo) { limparSelecao(); return; }
    if (!alvo.zona) {
      mapa.sel = null;
      mapa.zona = null;
      mapa.semDado = { id: alvo.id, nome: alvo.nome, casca: alvo.casca };
      atualizarSelecao(null);
      return;
    }
    selecionarZona(alvo.zona.id === mapa.zona ? null : alvo.zona.id);
  }

  function desenharPainelPeca() {
    var zona = mapa.zona && FOGAO.ZONA_POR_ID[mapa.zona];
    var sel = zona ? { resumo: PAINEL_PECA.resumir(zona, DADOS) }
      : mapa.semDado ? { semDado: mapa.semDado } : null;
    PAINEL_PECA.desenhar(document.getElementById("part-detail"), sel, {
      rampa: rampaAtual(),
      dados: DADOS,
      pontoSel: mapa.sel,
      aoEscolherPonto: selecionar,
      aoLimpar: limparSelecao
    });
    var escolha = document.getElementById("part-select");
    if (escolha) escolha.value = mapa.zona || "";
  }

  function atualizarSelecao(p) {
    mostrarDetalhe(p);
    desenharPainelPeca();
    redesenharCalor();
    desenharVisuais();

    Object.keys(linhaPorId).forEach(function (id) {
      linhaPorId[id].classList.toggle("row--selected", id === mapa.sel);
    });
    /* A linha fica destacada, mas a página não se move: quem clicou no modelo
       quer ler o painel ao lado, e só desce até a tabela se quiser detalhe. */
  }

  // Caminho de teclado e leitor de tela para a mesma seleção que o clique faz.
  function montarEscolhaDePeca() {
    var escolha = document.getElementById("part-select");
    var areas = {};
    FOGAO.ZONAS.forEach(function (z) { (areas[z.area] = areas[z.area] || []).push(z); });
    Object.keys(areas).forEach(function (area) {
      var grupo = document.createElement("optgroup");
      grupo.label = area;
      areas[area].forEach(function (z) {
        var o = document.createElement("option");
        o.value = z.id;
        o.textContent = z.nome;
        grupo.appendChild(o);
      });
      escolha.appendChild(grupo);
    });
    escolha.addEventListener("change", function () { selecionarZona(this.value || null); });
  }

  /* Só os três estados de RN-01. Monitoramento não entra: por RN-03 esses
     pontos não recebem estado de risco, e listá-los aqui sugeriria um quarto
     estado que a regra não define. Quem os governa é a caixa de inclusão. */
  var ESTADOS = [
    ["acima_do_limite", "Acima do limite"],
    ["banda_de_incerteza", "Banda de incerteza"],
    ["dentro_do_limite", "Dentro do limite"]
  ];

  function montarChips() {
    var caixa = document.getElementById("filter-state");
    caixa.innerHTML = "";
    ESTADOS.forEach(function (e) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = e[1];
      b.setAttribute("aria-pressed", String(!!mapa.estados[e[0]]));
      b.addEventListener("click", function () {
        if (mapa.estados[e[0]]) delete mapa.estados[e[0]]; else mapa.estados[e[0]] = true;
        montarChips();
        aplicarFiltros();
      });
      caixa.appendChild(b);
    });
  }

  /* As faixas de folga moram na legenda de cor, do outro lado do painel. Sem
     um eco aqui, o usuário vê a tabela encolher e não acha o controle que a
     encolheu; o eco também desfaz a faixa, para não virar mero aviso. */
  function montarFaixasAtivas() {
    var caixa = document.getElementById("filter-bands");
    caixa.innerHTML = "";

    Object.keys(mapa.faixas).sort(function (a, b) { return a - b; }).forEach(function (i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip-echo";
      b.setAttribute("aria-label", "Remover a faixa de folga " + FOGAO.FAIXAS[i]);

      var rotulo = document.createElement("span");
      rotulo.textContent = "Folga " + FOGAO.FAIXAS[i];
      b.appendChild(rotulo);

      var x = document.createElement("b");
      x.setAttribute("aria-hidden", "true");
      x.textContent = "×";
      b.appendChild(x);

      b.addEventListener("click", function () {
        delete mapa.faixas[i];
        montarRampa();
        aplicarFiltros();
      });
      caixa.appendChild(b);
    });
  }

  // Volta ao estado de primeira carga: nada filtrado, monitorados inclusos.
  function limparFiltros() {
    mapa.nome = "";
    mapa.estados = {};
    mapa.faixas = {};
    mapa.mono = true;

    document.getElementById("filter-name").value = "";
    document.getElementById("filter-mono").checked = true;
    montarChips();
    montarRampa();
    aplicarFiltros();
  }

  /* Um ponto passa quando atende a todos os filtros ativos ao mesmo tempo.
     Estado e faixa só valem para os 68 com limite declarado: sem limite não
     há folga a comparar (RN-03), então o nome e a caixa de inclusão são os
     únicos filtros que alcançam os 10 monitorados. */
  function passaNoFiltro(p) {
    if (mapa.nome && p.TC_Name.toLowerCase().indexOf(mapa.nome) < 0) return false;
    if (p.is_monitor_only) return mapa.mono;

    var estados = Object.keys(mapa.estados);
    if (estados.length && estados.indexOf(p.estado) < 0) return false;

    var faixas = Object.keys(mapa.faixas);
    if (faixas.length && !mapa.faixas[FOGAO.faixaDaRampa(p.margem_percentual)]) return false;

    return true;
  }

  /* A contagem anda nos dois universos separados, e não num total de 78: os
     68 com limite e os 10 monitorados respondem a filtros diferentes, e somar
     os dois apagaria justamente a separação que RN-03 mantém. */
  function aplicarFiltros() {
    var comLimite = 0, monitorados = 0;
    todosOsPontos().forEach(function (p) {
      var ok = passaNoFiltro(p);
      if (ok) { if (p.is_monitor_only) monitorados += 1; else comLimite += 1; }
      var tr = linhaPorId[p.measurement_id];
      if (tr) tr.hidden = !ok;
    });

    var total = DADOS.total_classificados;
    var mono = DADOS.total_monitoramento;
    var ativo = mapa.nome || !mapa.mono ||
      Object.keys(mapa.faixas).length || Object.keys(mapa.estados).length;

    document.getElementById("filter-count").textContent = ativo
      ? comLimite + "/" + total + " com limite · " + monitorados + "/" + mono + " sem limite"
      : total + " com limite · " + mono + " sem limite";

    montarFaixasAtivas();
    document.getElementById("filter-clear").hidden = !ativo;

    redesenharCalor();
    desenharVisuais();
  }

  var infoDoCampo = null;

  function montarLegendaDoCampo(info) {
    infoDoCampo = info;
    var bloco = document.getElementById("field-legend");
    bloco.hidden = mapa.vista !== "campo";
    if (mapa.vista !== "campo" || !info) return;

    var paradas = FOGAO.RAMPA_CAMPO.map(function (c, i) {
      return c + " " + (i / (FOGAO.RAMPA_CAMPO.length - 1) * 100).toFixed(0) + "%";
    });
    document.getElementById("field-bar").style.background =
      "linear-gradient(to right," + paradas.join(",") + ")";

    /* A rampa e equalizada por quantil, entao as paradas nao sao igualmente
       espacadas em graus: rotular cada uma e o que mantem a cor rastreavel. */
    var eixo = document.getElementById("field-ticks");
    eixo.innerHTML = "";
    (info.paradas || [info.min, info.max]).forEach(function (v) {
      var b = document.createElement("b");
      b.textContent = v.toFixed(0);
      eixo.appendChild(b);
    });
  }

  /* `extra` leva o que vale só para este pedido: `arrastando` adia o
     reenquadro até o slider parar, `imediato` pula a animação no Restaurar. */
  function redesenharCalor(extra) {
    if (!modelo) return;
    extra = extra || {};
    /* Isolar vale também no campo: ali a peça em foco é justamente onde o
       campo tem detalhe por componente, e o resto esmaece em vez de tapar. */
    var foco = mapa.isolar !== "todos" && FOGAO.PECA_DA_AREA[mapa.isolar] ? mapa.isolar : null;

    /* No campo térmico o desenho usa sempre os 78 pontos: a interpolação é
       do produto inteiro, e filtrar amostras deformaria o campo. Os filtros
       continuam valendo para os marcadores e para a tabela. */
    var pontos = mapa.vista === "campo" ? todosOsPontos() : todosOsPontos().filter(passaNoFiltro);

    var saida = modelo.atualizar({
      nivel: 4,
      modo: "calor",
      vista: mapa.vista,
      foco: foco,
      explode: mapa.explode,
      raioX: mapa.raioX,
      arrastando: !!extra.arrastando,
      imediato: !!extra.imediato,
      camadas: mapa.camadas,
      placa: geometria.placa,
      alojamento: geometria.alojamento,
      material: geometria.material,
      caso: geometria.caso,
      escala: mapa.escala,
      isolar: mapa.isolar,
      sel: mapa.sel,
      zonaSel: mapa.zona,
      // Mesmo raio do glifo do cartão: os dois leem CONFIANCA.
      haloDoPonto: function (p) { return CONFIANCA.raioHalo(CONFIANCA.doPonto(p)); },
      pontos: pontos
    });

    montarLegendaDoCampo(saida.info);

    var meta = foco && FOGAO.PECA_DA_AREA[foco];
    document.getElementById("heat-wide").hidden = !meta;

    // Com uma peça em foco a câmera está enquadrada nela: explodir e presets não se aplicam.
    var travado = !!meta;
    ["heat-explode", "heat-xray", "heat-reset"].forEach(function (id) {
      document.getElementById(id).disabled = travado;
    });
    var pct = Math.round(mapa.explode * 100);
    var slider = document.getElementById("heat-explode");
    slider.value = pct;
    slider.setAttribute("aria-valuetext", pct === 0 ? "montado" : pct + "% explodido");
    document.getElementById("heat-explode-valor").textContent = pct + "%";
    document.getElementById("heat-xray").setAttribute("aria-pressed", String(mapa.raioX));
    // No meio do curso nenhum dos dois botões fica marcado: o estado é o do slider.
    Array.prototype.forEach.call(document.querySelectorAll("#heat-montagem button"), function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.explode) === pct));
      b.disabled = travado;
    });
    var explodido = mapa.explode > 0;
    Array.prototype.forEach.call(
      document.querySelectorAll("#heat-preset button"),
      function (b) { b.disabled = !!meta; }
    );

    var campoAtivo = mapa.vista === "campo";
    // No campo a cor é temperatura: a legenda de folga sai para não haver duas escalas.
    document.getElementById("heat").dataset.vista = mapa.vista;
    document.getElementById("heat-layers-bar").hidden = !campoAtivo;

    document.getElementById("occlusion-hint").textContent =
      meta ? meta.nome
      : campoAtivo ? "Passe o cursor para sondar · clique numa peça para o resumo"
      : explodido || mapa.raioX ? "Arraste para girar · clique numa peça para o resumo"
      : "Pontos internos em transparência · clique numa peça";

    var sufixo = mapa.raioX ? " · raio-X" : "";
    document.getElementById("heat-view-name").textContent =
      meta ? "Vista de componente"
      : (campoAtivo && explodido ? "Campo térmico explodido"
      : campoAtivo ? "Campo térmico esquemático"
      : explodido ? "Vista explodida esquemática" : "Vista esquemática") + sufixo;
    document.getElementById("heat-view-note").textContent =
      meta ? "Sem CAD · termopares deste subsistema"
      : campoAtivo ? "Sem CAD · interpolado entre termopares, não é CFD"
      : "Sem CAD · posição indica o subsistema, não a coordenada";
  }

  function ligarAlternancia(id, chave, valores) {
    document.getElementById(id).addEventListener("click", function (evento) {
      var botao = evento.target.closest("button");
      if (!botao) return;
      mapa[chave] = valores(botao);
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", String(b === botao));
      });
      // A escala pinta também os glifos dos dois painéis de seleção.
      if (chave === "escala") { montarRampa(); mostrarDetalhe(pontoSelecionado()); desenharPainelPeca(); }
      redesenharCalor();
      desenharVisuais();
    });
  }

  function montarMapa() {
    criarModelo();
    // A rampa do campo tem variante escura: a barra da legenda acompanha o 3D.
    if (typeof TEMA !== "undefined") TEMA.aoMudar(function () { montarLegendaDoCampo(infoDoCampo); });
    montarEscolhaDePeca();
    desenharPainelPeca();
    montarRampa();
    montarSubsistemas();

    montarChips();
    aplicarFiltros();

    // `input` chega a cada passo do arrasto; `change`, quando a mão solta.
    var slider = document.getElementById("heat-explode");
    slider.addEventListener("input", function () {
      mapa.explode = Number(this.value) / 100;
      redesenharCalor({ arrastando: true });
    });
    slider.addEventListener("change", function () {
      mapa.explode = Number(this.value) / 100;
      redesenharCalor();
    });
    // Atalho para os extremos: anima até lá e o slider acompanha.
    document.getElementById("heat-montagem").addEventListener("click", function (evento) {
      var botao = evento.target.closest("button");
      if (!botao) return;
      mapa.explode = Number(botao.dataset.explode) / 100;
      redesenharCalor();
    });
    document.getElementById("heat-xray").addEventListener("click", function () {
      mapa.raioX = !mapa.raioX;
      redesenharCalor();
    });
    // A seleção fica: restaurar mexe no modelo, não no que está sendo lido.
    document.getElementById("heat-reset").addEventListener("click", function () {
      mapa.explode = 0;
      mapa.raioX = false;
      redesenharCalor({ imediato: true });
    });
    ligarAlternancia("heat-scale", "escala", function (b) { return b.dataset.scale; });
    ligarAlternancia("heat-view", "vista", function (b) { return b.dataset.view; });

    /* As camadas não são exclusivas entre si: cada botão guarda o próprio
       estado, em vez de um só da fila ficar marcado. */
    document.getElementById("heat-layers").addEventListener("click", function (evento) {
      var botao = evento.target.closest("button");
      if (!botao) return;
      var chave = botao.dataset.layer;
      mapa.camadas[chave] = !mapa.camadas[chave];
      botao.setAttribute("aria-pressed", String(mapa.camadas[chave]));
      redesenharCalor();
    });

    document.getElementById("filter-name").addEventListener("input", function () {
      mapa.nome = this.value.trim().toLowerCase();
      aplicarFiltros();
    });

    document.getElementById("filter-mono").addEventListener("change", function () {
      mapa.mono = this.checked;
      aplicarFiltros();
    });

    document.getElementById("filter-clear").addEventListener("click", limparFiltros);

    dicaViz = GRAFICO.balao(
      document.querySelector("#visuais .chart__frame"),
      document.getElementById("viz-tip"));

    document.getElementById("viz-ranking-todos").addEventListener("click", function () {
      rankingTodos = !rankingTodos;
      desenharRanking();
    });

    document.getElementById("viz-mono-count").textContent = DADOS.total_monitoramento;
    // A faixa de KPIs mora no topo da página, e não mais dentro de `visuais`.
    document.getElementById("kpis").hidden = false;
    document.getElementById("visuais").hidden = false;
    desenharVisuais();

    document.getElementById("heat-wide").addEventListener("click", function () {
      mapa.isolar = "todos";
      montarSubsistemas();
      redesenharCalor();
    });

    montarTour();

    document.getElementById("heat").hidden = false;
    redesenharCalor();
  }

  /* ----- Tour pelos pontos críticos -----
     A lista sai do estado já rotulado em DADOS (TOUR.paradas só
     escolhe e ordena). Cada parada é a mesma seleção de um clique, então os
     painéis da peça e do ponto abrem sem o usuário tocar no modelo. */
  var tour = null;

  function montarTour() {
    var status = document.getElementById("tour-status");
    var ctrl = document.getElementById("tour-ctrl");
    var iniciar = document.getElementById("tour-iniciar");
    var pausa = document.getElementById("tour-pausa");
    var anterior = document.getElementById("tour-anterior");
    var proximo = document.getElementById("tour-proximo");

    function escrever(partes) {
      status.innerHTML = "";
      partes.forEach(function (x) {
        status.appendChild(typeof x === "string" ? document.createTextNode(x) : x);
      });
    }

    function textoDaParada(e) {
      var p = e.ponto;
      var pct = Math.abs(p.margem_percentual * 100).toFixed(1) + "%";
      escrever([
        "Parada " + (e.i + 1) + " de " + e.total + " · ",
        el("b", null, p.TC_Name),
        " · " + p.estado_rotulo + " · " +
          (p.margem_percentual < 0 ? pct + " acima do limite" : "folga de " + pct + " do limite") +
          (e.fim ? " · última parada" : e.tocando ? "" : " · pausado")
      ]);
    }

    /* Os marcadores só existem na leitura por pontos, sem subsistema em foco
       e sem filtro que os esconda: o tour abre nesse estado para que toda
       parada tenha onde a câmera pousar. */
    function prepararVista() {
      if (mapa.vista !== "pontos") document.querySelector("#heat-view [data-view='pontos']").click();
      if (mapa.isolar !== "todos") { mapa.isolar = "todos"; montarSubsistemas(); }
      if (mapa.nome || !mapa.mono || Object.keys(mapa.faixas).length || Object.keys(mapa.estados).length) limparFiltros();
    }

    var controle = {
      aoParar: function (p) {
        selecionar(p);
        modelo.focarPonto(p.measurement_id);
        // A coluna dos painéis rola por dentro: cada parada abre no resumo da peça.
        document.querySelector(".heat__side--right").scrollTop = 0;
      },
      aoMudar: function (e) {
        iniciar.hidden = e.ativo;
        ctrl.hidden = !e.ativo;
        if (!e.ativo) return;
        pausa.textContent = e.tocando ? "Pausar" : e.fim ? "Recomeçar" : "Continuar";
        pausa.setAttribute("aria-pressed", String(!e.tocando));
        anterior.disabled = e.i === 0;
        proximo.disabled = e.fim;
        textoDaParada(e);
      },
      // Sair do tour não deixa a câmera presa na última parada.
      aoEncerrar: function () {
        limparSelecao();
        modelo.preset("isometrica");
        escrever([]);
        iniciar.focus();
      }
    };

    // A lista é lida no clique, do dado que a triagem mostra naquele momento.
    iniciar.addEventListener("click", function () {
      var lista = TOUR.paradas(DADOS);
      status.classList.toggle("tour__status--vazio", !lista.length);
      if (!lista.length) {
        escrever(["Nenhum ponto acima do limite ou na banda de incerteza nesta configuração: não há paradas para o tour."]);
        return;
      }
      prepararVista();
      tour = TOUR.criar(lista, controle);
      tour.iniciar();
    });
    pausa.addEventListener("click", function () { tour.alternar(); });
    anterior.addEventListener("click", function () { tour.anterior(); });
    proximo.addEventListener("click", function () { tour.proximo(); });
    document.getElementById("tour-encerrar").addEventListener("click", function () { tour.encerrar(); });

    // Quem pega a câmera durante o tour assume o controle: o avanço automático pausa.
    function pausarSeTocando() { if (tour && tour.estado().tocando) tour.pausar(); }
    ["pointerdown", "wheel"].forEach(function (tipo) {
      palcoCalor.addEventListener(tipo, pausarSeTocando, { passive: true });
    });
    palcoCalor.addEventListener("keydown", function (evento) {
      if (evento.key !== "Escape") pausarSeTocando();
    });
    document.getElementById("heat-preset").addEventListener("click", pausarSeTocando);

    document.getElementById("heat").addEventListener("keydown", function (evento) {
      if (evento.key === "Escape" && tour && tour.estado().ativo) tour.encerrar();
    });
  }

  var balao = document.getElementById("heat-tip");

  /* O balão se ancora na posição de tela do marcador, que o viewport 3D
     devolve já projetada. Fica preso ao quadro e vira para baixo quando não
     cabe acima, para nunca sair da área nem cobrir o ponto. */
  function posicionarBalao(el, x, y) {
    var quadro = palcoCalor.parentNode.parentNode.getBoundingClientRect();
    var palco = palcoCalor.getBoundingClientRect();
    x += palco.left - quadro.left;
    y += palco.top - quadro.top;

    el.dataset.on = "1";
    var acima = y > quadro.height * 0.3;
    el.classList.toggle("tip--acima", acima);
    el.classList.toggle("tip--abaixo", !acima);
    el.style.top = y + "px";
    var w = el.getBoundingClientRect().width;
    el.style.left = Math.max(w / 2 + 6, Math.min(quadro.width - w / 2 - 6, x)) + "px";
  }

  function criarModelo() {
    var presets = document.getElementById("heat-preset");
    modelo = FOGAO3D.criar(palcoCalor, {
      aoMudarCamera: function (atual) {
        Array.prototype.forEach.call(presets.querySelectorAll("button"), function (b) {
          b.setAttribute("aria-pressed", String(b.dataset.preset === atual));
        });
        balao.dataset.on = "0";
      },
      // Só chega clique de verdade: o fim de um arrasto de câmera não conta.
      aoClicar: function (p) {
        if (mapa.vista === "campo") return;
        selecionar(p);
      },
      aoClicarPeca: clicarPeca,
      aoPairarPeca: function (alvo, x, y) {
        if (!alvo) { balao.dataset.on = "0"; return; }
        var n = FOGAO.pontosDaZona(alvo.zona, todosOsPontos()).length;
        var selecionada = alvo.zona.id === mapa.zona;
        balao.innerHTML = "<b class=\"tip__name\">" + alvo.zona.nome + "</b>" +
          "<span class=\"tip__state\">" + alvo.zona.area + " · " + n + (n === 1 ? " ponto" : " pontos") +
          " · " + (selecionada ? "clique para soltar" : "clique para o resumo") + "</span>";
        posicionarBalao(balao, x, y);
      },
      /* No campo o balão vira sonda: mostra a temperatura interpolada sob o
         cursor, que é o que substitui o marcador desta vista. */
      aoSondar: function (s, x, y) {
        if (!s) { balao.dataset.on = "0"; return; }
        balao.innerHTML = "<b class=\"tip__name\">" + (s.peca || "Campo térmico") + "</b>" +
          "<span class=\"tip__num\">" + s.c.toFixed(1) + " °C</span>" +
          "<span class=\"tip__state\"> · interpolado entre termopares</span>";
        posicionarBalao(balao, x, y);
      },
      aoPairar: function (p, x, y) {
        if (!p || mapa.vista === "campo") { balao.dataset.on = "0"; return; }
        balao.innerHTML = "<b class=\"tip__name\">" + p.TC_Name + "</b>" +
          "<span class=\"tip__num\">" + p.temperatura_prevista_c.toFixed(1) + " °C</span>" +
          (p.is_monitor_only
            ? " · <span class=\"tip__state\">sem limite</span>"
            : " · <span class=\"tip__num\">folga " + p.margem_c.toFixed(1) + " °C</span>" +
              "<span class=\"tip__state\"> · " + p.estado_rotulo + "</span>");
        posicionarBalao(balao, x, y);
      }
    });
    presets.addEventListener("click", function (evento) {
      var botao = evento.target.closest("button");
      if (botao) modelo.preset(botao.dataset.preset);
    });
  }

  function mostrarErro(mensagem) {
    document.getElementById("error-message").textContent = mensagem;
    errorSection.hidden = false;
  }

  // A configuração chega na query string, montada pela tela de consulta.

  function renderConfiguracao(config, veioDaUrl) {
    var lista = document.getElementById("config-list");

    // Cada fator num bloco próprio: a lista é grade, e não nove linhas
    // empilhadas empurrando o mapa para fora da tela.
    LEITURA_PUBLICOS.linhasDaConfiguracao(config).forEach(function (linha) {
      var item = document.createElement("div");
      item.className = "cfg-item";

      var dt = document.createElement("dt");
      dt.textContent = linha[0];
      dt.title = linha[0];
      item.appendChild(dt);

      var dd = document.createElement("dd");
      dd.textContent = linha[1];
      item.appendChild(dd);

      lista.appendChild(item);
    });

    document.getElementById("config-default-note").hidden = veioDaUrl;
    document.getElementById("config-panel").hidden = false;
  }

  loading.hidden = true;

  if (typeof DADOS_TRIAGEM === "undefined") {
    mostrarErro(
      "js/dados_triagem.js não foi carregado. Confira se o arquivo existe " +
      "em dashboard/js/ e se a tag <script> que o carrega vem antes desta."
    );
    return;
  }

  var configDaUrl = LEITURA_PUBLICOS.configuracaoDaUrl();
  var configAtiva = configDaUrl || DADOS_TRIAGEM.configuracao;
  DADOS = LEITURA_PUBLICOS.fonte(configAtiva);
  geometria = geometriaDaConfig(configAtiva);
  renderConfiguracao(configAtiva, configDaUrl !== null);

  // Mesmo payload da tabela: o resumo não tem outra fonte de número.
  RESUMO_EXECUTIVO.montar(document.getElementById("resumo-exec"), DADOS,
    { configuracao: configAtiva, prioridades: 3 });
  MODO_LEITURA.iniciar();

  render(DADOS);
})();
