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
  var mapa = { explode: true, escala: "a", isolar: "todos", faixa: null, sel: null };
  var desenho = null;
  var linhaPorId = {};

  function todosOsPontos() {
    return DADOS_TRIAGEM.pontos.concat(DADOS_TRIAGEM.monitoramento);
  }

  // Um marcador de 9px com 78 deles se sobrepondo torna o clique frustrante:
  // captura o mais próximo dentro de um raio, em coordenadas do viewBox.
  function coordenadaNoDesenho(evento) {
    var pt = svgCalor.createSVGPoint();
    pt.x = evento.clientX;
    pt.y = evento.clientY;
    var ctm = svgCalor.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : null;
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
      b.setAttribute("aria-pressed", String(mapa.faixa === i));

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
        mapa.faixa = mapa.faixa === i ? null : i;
        montarRampa();
        redesenharCalor();
      });
      caixa.appendChild(b);
    });

    document.getElementById("mono-count").textContent = DADOS_TRIAGEM.total_monitoramento;
    document.getElementById("scale-name").textContent = mapa.escala === "b" ? "Escala B" : "Escala A";
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
    if (p && linhaPorId[mapa.sel]) {
      linhaPorId[mapa.sel].scrollIntoView({ block: "nearest" });
    }
  }

  function redesenharCalor() {
    var pontos = todosOsPontos().filter(function (p) {
      if (mapa.faixa === null) return true;
      if (p.is_monitor_only) return false;
      return FOGAO.faixaDaRampa(p.margem_percentual) === mapa.faixa;
    });

    desenho = FOGAO.desenhar(svgCalor, {
      nivel: 4,
      modo: "calor",
      explode: mapa.explode,
      placa: "right",
      alojamento: "open",
      material: "plate",
      escala: mapa.escala,
      isolar: mapa.isolar,
      sel: mapa.sel,
      pontos: pontos
    });

    document.getElementById("occlusion-hint").textContent = mapa.explode
      ? "Explodido · todos os pontos visíveis"
      : "Assentado oculta pontos sob o cooktop e na traseira";
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

    ligarAlternancia("heat-explode", "explode", function (b) { return b.dataset.explode === "1"; });
    ligarAlternancia("heat-scale", "escala", function (b) { return b.dataset.scale; });

    svgCalor.addEventListener("click", function (evento) {
      var c = coordenadaNoDesenho(evento);
      if (!c || !desenho) return;
      selecionar(FOGAO.maisProximo(desenho, c.x, c.y, 14));
    });

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
  renderConfiguracao(configDaUrl || DADOS_TRIAGEM.configuracao, configDaUrl !== null);

  render(DADOS_TRIAGEM);
})();
