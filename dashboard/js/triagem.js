/* Tela de triagem térmica. Estado, folga e ordem das linhas já vêm prontos
 * em js/dados_triagem.js; aqui só há formatação e montagem de DOM.
 */

(function () {
  "use strict";

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

  function grausC(valor) {
    return valor.toFixed(2);
  }

  function percentual(fracao) {
    return (fracao * 100).toFixed(1) + "%";
  }

  function celula(texto, classe) {
    var td = document.createElement("td");
    td.textContent = texto;
    if (classe) td.className = classe;
    return td;
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

    tr.appendChild(celulaPonto(ponto));
    tr.appendChild(celula(grausC(ponto.temperatura_prevista_c), "num"));
    tr.appendChild(celula(grausC(ponto.limit_c), "num"));
    tr.appendChild(celula(grausC(ponto.margem_c), "num"));
    tr.appendChild(celula(percentual(ponto.margem_percentual), "num"));
    tr.appendChild(celulaEstado(ponto));

    return tr;
  }

  // RN-03: três colunas só. As outras não existem para estes pontos, e
  // exibi-las vazias sugeriria dado ausente em vez de regra.
  function linhaMonitorada(ponto) {
    var tr = document.createElement("tr");

    tr.appendChild(celulaPonto(ponto));
    tr.appendChild(celula(grausC(ponto.temperatura_prevista_c), "num"));
    tr.appendChild(celula("Sem limite declarado — monitoramento"));

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

  function render(dados) {
    document.getElementById("tolerance-fraction").textContent =
      (dados.tolerancia_fracao * 100).toFixed(0) + "%";

    if (dados.preditor_e_stub) {
      document.getElementById("model-version").textContent = dados.versao_modelo;
      document.getElementById("stub-banner").hidden = false;
    }

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

    document.getElementById("monitoring-count").textContent = dados.total_monitoramento;
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


  /* ----- Mapa de calor ----- */

  var svgCalor = document.getElementById("heat-svg");
  var mapa = { explode: true, escala: "a", isolar: "todos", faixas: {}, sel: null,
               vista: "pontos", nome: "", estados: {}, mono: true };
  var desenho = null;
  var linhaPorId = {};
  var orbita = null;


  function todosOsPontos() {
    return DADOS_TRIAGEM.pontos.concat(DADOS_TRIAGEM.monitoramento);
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
      fill: mono ? "#ffffff" : cor,
      stroke: mono ? "#767777" : "#484949",
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
    DADOS_TRIAGEM.pontos.forEach(function (p) { contagem[FOGAO.faixaDaRampa(p.margem_percentual)] += 1; });

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

    document.getElementById("mono-count").textContent = DADOS_TRIAGEM.total_monitoramento;
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

    var linhas = [["todos", "Todos", DADOS_TRIAGEM.total_pontos, null]];
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
        over.style.color = linha[3] > 0 ? "#8f2419" : "#9fa0a1";
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
      soprador: config.blower_direction === "To Back" ? "back" : "front"
    };
  }

  var geometria = geometriaDaConfig(null);

  function corDoPonto(p) {
    if (p.is_monitor_only) return "#ffffff";
    return (mapa.escala === "b" ? FOGAO.RAMPA_B : FOGAO.RAMPA_A)[FOGAO.faixaDaRampa(p.margem_percentual)];
  }

  function linhaDetalhe(rotulo, valor, vazio) {
    return "<dt>" + rotulo + "</dt><dd" + (vazio ? " class=\"is-empty\"" : "") + ">" + valor + "</dd>";
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
      "<p class=\"detail__state\" style=\"border-color:" + (p.is_monitor_only ? "#d1d3d4" : cor) + "\">" +
      "<span class=\"detail__swatch\" style=\"background:" + cor + ";border:1px solid #767777\"></span>" +
      "<span style=\"color:" + (p.is_monitor_only ? "#505863" : cor) + "\">" +
      (p.is_monitor_only ? "LIMITE NÃO DECLARADO" : p.estado_rotulo.toUpperCase()) + "</span></p>" +
      "<dl class=\"detail__rows\">" +
      linhaDetalhe("Temperatura prevista", p.temperatura_prevista_c.toFixed(2) + " °C");

    if (p.is_monitor_only) {
      html += linhaDetalhe("Limite do componente", "—", true) +
        linhaDetalhe("Folga", "—", true) +
        linhaDetalhe("Estado de risco", "não se aplica", true) + "</dl>" +
        "<p class=\"legend-note\">Ponto acompanhado sem limite declarado. Não recebe " +
        "estado nem entra na escala (RN-03).</p>";
    } else {
      var tol = DADOS_TRIAGEM.tolerancia_fracao * p.limit_c;
      html += linhaDetalhe("Limite do componente", p.limit_c.toFixed(2) + " °C") +
        linhaDetalhe("Folga", p.margem_c.toFixed(2) + " °C") +
        linhaDetalhe("Folga relativa", (p.margem_percentual * 100).toFixed(1) + "%") +
        linhaDetalhe("Tolerância (10% do limite)", tol.toFixed(2) + " °C") + "</dl>";

      // Onde a previsão cai em relação ao limite.
      var frac = Math.max(0, Math.min(1, p.temperatura_prevista_c / (p.limit_c * 1.6)));
      var marca = 1 / 1.6;
      html += "<div class=\"gauge\">" +
        "<div class=\"gauge__fill\" style=\"width:" + (frac * 100).toFixed(1) + "%;background:" + cor + "\"></div>" +
        "<div class=\"gauge__mark\" style=\"left:" + (marca * 100).toFixed(1) + "%\"></div>" +
        "<span class=\"gauge__tag\" style=\"left:calc(" + (marca * 100).toFixed(1) + "% + 5px)\">limite</span></div>" +
        "<p class=\"legend-note\">Valor de triagem produzido por modelo substituto. " +
        "Confirmar por simulação CFD antes de qualquer decisão de projeto.</p>";
    }

    caixa.innerHTML = html;
  }

  function selecionar(p) {
    mapa.sel = p ? p.measurement_id : null;
    mostrarDetalhe(p);
    redesenharCalor();

    Object.keys(linhaPorId).forEach(function (id) {
      linhaPorId[id].classList.toggle("row--selected", id === mapa.sel);
    });
    /* A linha fica destacada, mas a página não se move: quem clicou no modelo
       quer ler o painel ao lado, e só desce até a tabela se quiser detalhe. */
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

    var total = DADOS_TRIAGEM.total_classificados;
    var mono = DADOS_TRIAGEM.total_monitoramento;
    var ativo = mapa.nome || !mapa.mono ||
      Object.keys(mapa.faixas).length || Object.keys(mapa.estados).length;

    document.getElementById("filter-count").textContent = ativo
      ? comLimite + " de " + total + " com limite · " + monitorados + " de " + mono + " monitorados"
      : "Sem filtro: os " + total + " pontos com limite e os " + mono + " monitorados.";

    montarFaixasAtivas();
    document.getElementById("filter-clear").hidden = !ativo;

    redesenharCalor();
  }

  function montarLegendaDoCampo(info) {
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

  /* Aproximar numa peça é uma transição contínua, não outra tela: `foco` diz
     em qual peça, e `t` é o quanto a câmera já girou e aproximou. Sem isso o
     salto lê como um desenho diferente, não como zoom. */
  var foco = { area: null, t: 0, anim: null, fim: null };

  function assentarFoco(ate) {
    if (foco.anim) { cancelAnimationFrame(foco.anim); foco.anim = null; }
    foco.t = ate;
    if (ate === 0) foco.area = null;
    redesenharProduto();
  }

  function animarFoco(area, ate) {
    if (foco.anim) cancelAnimationFrame(foco.anim);
    if (foco.fim) clearTimeout(foco.fim);
    var de = foco.t, t0 = null;
    if (area) foco.area = area;

    function passo(tempo) {
      if (t0 === null) t0 = tempo;
      var k = Math.min(1, (tempo - t0) / 520);
      k = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      foco.t = de + (ate - de) * k;
      redesenharProduto();
      if (k < 1) { foco.anim = requestAnimationFrame(passo); return; }
      foco.anim = null;
      assentarFoco(ate);
    }

    foco.anim = requestAnimationFrame(passo);
    // Rede de segurança: se o quadro a quadro não rodar — aba em segundo
    // plano, movimento reduzido — o estado final vale do mesmo jeito.
    foco.fim = setTimeout(function () { assentarFoco(ate); }, 640);
    redesenharProduto();
  }

  function redesenharCalor() {
    // O campo cobre o produto inteiro; não há peça para aproximar.
    var alvo = mapa.vista === "campo" ? null
      : (mapa.isolar !== "todos" && FOGAO.PECA_DA_AREA[mapa.isolar] ? mapa.isolar : null);

    if (alvo !== foco.area || (alvo === null && foco.t > 0)) {
      animarFoco(alvo, alvo ? 1 : 0);
      return;
    }
    redesenharProduto();
  }

  function redesenharProduto() {
    /* No campo térmico o desenho usa sempre os 78 pontos: a interpolação é
       do produto inteiro, e filtrar amostras deformaria o campo. Os filtros
       continuam valendo para os marcadores e para a tabela. */
    var pontos = mapa.vista === "campo"
      ? todosOsPontos()
      : todosOsPontos().filter(passaNoFiltro);

    desenho = FOGAO.desenhar(svgCalor, {
      nivel: 4,
      modo: "calor",
      vista: mapa.vista,
      yaw: orbita ? orbita.valor() : 0,
      elev: orbita ? orbita.elevacao() : null,
      foco: foco.area,
      t: foco.t,
      semAnimacao: foco.anim !== null,
      explode: mapa.vista === "campo" ? false : mapa.explode,
      placa: geometria.placa,
      alojamento: geometria.alojamento,
      material: geometria.material,
      escala: mapa.escala,
      isolar: mapa.isolar,
      sel: mapa.sel,
      pontos: pontos
    });

    montarLegendaDoCampo(desenho.info);

    var meta = foco.area && FOGAO.PECA_DA_AREA[foco.area];
    document.getElementById("heat-wide").hidden = !meta;
    svgCalor.parentNode.classList.toggle("viewport__stage--comp", !!meta);

    /* No campo a vista é sempre de planta, e com uma peça em foco a câmera
       está travada de frente para ela: a alternância não se aplica. */
    var travado = mapa.vista === 'campo' || !!meta;
    Array.prototype.forEach.call(
      document.querySelectorAll('#heat-explode button'),
      function (b) { b.disabled = travado; }
    );

    var campoAtivo = mapa.vista === "campo";
    document.getElementById("occlusion-hint").textContent =
      meta ? meta.nome
      : campoAtivo ? "Campo no volume · arraste para girar e inclinar"
      : mapa.explode ? "Explodido · arraste para girar e inclinar"
      : "Assentado oculta pontos · arraste para girar e inclinar";

    document.getElementById("heat-view-name").textContent =
      meta ? "VISTA DE COMPONENTE"
      : campoAtivo ? "CAMPO TÉRMICO ESQUEMÁTICO"
      : mapa.explode ? "VISTA EXPLODIDA ESQUEMÁTICA" : "VISTA ESQUEMÁTICA";
    document.getElementById("heat-view-note").textContent =
      meta ? "Sem CAD · termopares deste subsistema"
      : campoAtivo ? "Sem CAD · interpolado entre termopares, não é resultado de simulação"
      : "Sem CAD · a posição indica o subsistema, não a coordenada real";
  }

  function ligarAlternancia(id, chave, valores) {
    document.getElementById(id).addEventListener("click", function (evento) {
      var botao = evento.target.closest("button");
      if (!botao) return;
      mapa[chave] = valores(botao);
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", String(b === botao));
      });
      if (chave === "escala") montarRampa();
      redesenharCalor();
    });
  }

  function montarMapa() {
    montarRampa();
    montarSubsistemas();
    redesenharCalor();

    montarChips();
    aplicarFiltros();

    ligarAlternancia("heat-explode", "explode", function (b) { return b.dataset.explode === "1"; });
    ligarAlternancia("heat-scale", "escala", function (b) { return b.dataset.scale; });
    ligarAlternancia("heat-view", "vista", function (b) { return b.dataset.view; });

    document.getElementById("filter-name").addEventListener("input", function () {
      mapa.nome = this.value.trim().toLowerCase();
      aplicarFiltros();
    });

    document.getElementById("filter-mono").addEventListener("change", function () {
      mapa.mono = this.checked;
      aplicarFiltros();
    });

    document.getElementById("filter-clear").addEventListener("click", limparFiltros);

    orbita = FOGAO.orbita(svgCalor, function () {
      document.getElementById("heat-reset").hidden = !orbita.girado();
      redesenharCalor();
    });
    document.getElementById("heat-reset").addEventListener("click", function () {
      orbita.zerar();
      this.hidden = true;
    });
    document.getElementById("heat-wide").addEventListener("click", function () {
      mapa.isolar = "todos";
      montarSubsistemas();
      redesenharCalor();
    });

    svgCalor.addEventListener("click", function (evento) {
      // Nao seleciona no fim de um arrasto, nem no campo, que nao tem marcador.
      if (orbita.arrastou() || mapa.vista === "campo") return;
      var c = FOGAO.noDesenho(svgCalor, evento);
      if (!c || !desenho) return;
      var achado = FOGAO.maisProximo(desenho, c.x, c.y, 14);
      selecionar(achado ? achado.ponto : null);
    });

    var balao = document.getElementById("heat-tip");

    /* Regra de tres sobre o tamanho do elemento errava: com preserveAspectRatio
       o viewBox fica encaixotado dentro do SVG, e cada componente agora tem
       proporcao propria. A matriz da tela da a posicao exata em qualquer caso.

       Depois disso o balao e preso dentro do quadro, e vira para baixo quando
       nao cabe acima — para nunca sair da area nem cobrir o ponto. */
    function posicionarBalao(el, cx, cy) {
      var ctm = svgCalor.getScreenCTM();
      if (!ctm) { el.dataset.on = "0"; return; }

      var q = svgCalor.createSVGPoint();
      q.x = cx; q.y = cy;
      var tela = q.matrixTransform(ctm);
      var quadro = svgCalor.parentNode.parentNode.getBoundingClientRect();
      var x = tela.x - quadro.left, y = tela.y - quadro.top;

      /* O deslocamento vertical é feito por transform, e não por medida de
         altura: medir logo depois de trocar o conteúdo devolvia a altura do
         balão anterior, e ele acabava em cima do ponto. O transform não
         precisa saber a altura. */
      el.dataset.on = "1";
      var acima = y > quadro.height * 0.34;
      el.classList.toggle("tip--acima", acima);
      el.classList.toggle("tip--abaixo", !acima);

      el.style.top = y + "px";
      // A largura só desloca de lado; errar nela não cobre o ponto.
      var w = el.getBoundingClientRect().width;
      el.style.left = Math.max(w / 2 + 6, Math.min(quadro.width - w / 2 - 6, x)) + "px";
    }
    svgCalor.addEventListener("pointermove", function (evento) {
      if (mapa.vista === "campo" || !desenho) { balao.dataset.on = "0"; return; }
      var c = FOGAO.noDesenho(svgCalor, evento);
      var achado = c && FOGAO.maisProximo(desenho, c.x, c.y, 12);
      if (!achado) { balao.dataset.on = "0"; return; }

      var p = achado.ponto;
      balao.innerHTML = "<b class=\"tip__name\">" + p.TC_Name + "</b>" +
        "<span class=\"tip__num\">" + p.temperatura_prevista_c.toFixed(1) + " °C</span>" +
        (p.is_monitor_only
          ? " · <span class=\"tip__state\">sem limite</span>"
          : " · <span class=\"tip__num\">folga " + p.margem_c.toFixed(1) + " °C</span>" +
            "<span class=\"tip__state\"> · " + p.estado_rotulo + "</span>");

      posicionarBalao(balao, achado.cx, achado.cy);
    });
    svgCalor.addEventListener("pointerleave", function () { balao.dataset.on = "0"; });

    document.getElementById("heat").hidden = false;
  }

  function mostrarErro(mensagem) {
    document.getElementById("error-message").textContent = mensagem;
    errorSection.hidden = false;
  }

  // A configuração chega na query string, montada pela tela de consulta.
  function lerConfiguracaoDaUrl() {
    var busca = window.location.search.replace(/^\?/, "");
    if (!busca) return null;

    var config = {};
    busca.split("&").forEach(function (par) {
      if (!par) return;
      var corte = par.indexOf("=");
      var chave = decodeURIComponent(par.slice(0, corte < 0 ? par.length : corte));
      var valor = corte < 0 ? "" : decodeURIComponent(par.slice(corte + 1).replace(/\+/g, " "));

      var partes = chave.split(".");
      if (partes.length === 1) {
        config[partes[0]] = valor;
      } else {
        if (!config[partes[0]]) config[partes[0]] = {};
        config[partes[0]][partes[1]] = valor;
      }
    });

    return Object.keys(config).length > 0 ? config : null;
  }

  // Valor fora do vocabulário aparece cru e marcado: RN-04 manda rejeitar,
  // não interpretar por aproximação.
  function rotuloDoNivel(niveis, valor) {
    var encontrado = null;
    (niveis || []).forEach(function (nivel) {
      if (nivel.value === valor) encontrado = nivel.label;
    });
    return encontrado || valor + " (fora do vocabulário)";
  }

  function linhasDaConfiguracao(config) {
    var linhas = [];

    SCHEMA.factors.forEach(function (fator) {
      if (fator.subfields && fator.subfields.length > 0) {
        var aninhado = config[fator.key] || {};
        fator.subfields.forEach(function (sub) {
          var valor = aninhado[sub.key];
          // Campo que não se aplica sai da lista, como sai do formulário.
          if (valor === undefined || valor === null || valor === "") return;
          linhas.push([sub.label, rotuloDoNivel(sub.levels, valor)]);
        });
        return;
      }

      var valor = config[fator.key];
      if (valor === undefined || valor === null || valor === "") return;
      linhas.push([fator.label, rotuloDoNivel(fator.levels, valor)]);
    });

    return linhas;
  }

  function renderConfiguracao(config, veioDaUrl) {
    var lista = document.getElementById("config-list");

    linhasDaConfiguracao(config).forEach(function (linha) {
      var dt = document.createElement("dt");
      dt.textContent = linha[0];
      lista.appendChild(dt);

      var dd = document.createElement("dd");
      dd.textContent = linha[1];
      lista.appendChild(dd);
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

  var configDaUrl = lerConfiguracaoDaUrl();
  var configAtiva = configDaUrl || DADOS_TRIAGEM.configuracao;
  geometria = geometriaDaConfig(configAtiva);
  renderConfiguracao(configAtiva, configDaUrl !== null);

  render(DADOS_TRIAGEM);
})();
