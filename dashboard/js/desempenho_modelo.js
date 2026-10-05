/* Desempenho do modelo final na tela de engenharia, lido da API.
 *
 * Rodar os testes:
 *   node --test dashboard/testes/desempenho_modelo.test.js
 *
 * Os números vêm de `GET /desempenho`, que serve as métricas agregadas gravadas
 * pelo notebook `5.1_modelo_final.ipynb` (Tabelas 59, 63 e 66 da documentação),
 * e o algoritmo de cada área, de `GET /modelos`. Nada é calculado aqui além de
 * comparar cada valor com o seu alvo: o módulo lê, formata e desenha. Sem a API,
 * a tela fica no estado indisponível, sem nenhum número no lugar.
 *
 * `avaliar` e os formatadores não tocam no DOM e são o que os testes prendem;
 * `montar` e `iniciar` desenham.
 */

var DESEMPENHO_MODELO = (function () {
  "use strict";

  // Nível de significância do teste de HM, fixado na Seção 4.2.3(d).
  var ALFA = 0.05;

  var SOBRESCRITO = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

  /* pt-BR: vírgula decimal e sinal de menos tipográfico, como nas outras telas. */
  function fmt(valor, casas) {
    if (valor === null || valor === undefined || isNaN(valor)) return "—";
    var t = Number(valor).toFixed(casas);
    if (Number(t) === 0) t = t.replace("-", "");
    return t.replace(".", ",").replace("-", "−");
  }

  /* *p* em notação científica quando é pequeno: 1,2 × 10⁻⁸. */
  function fmtP(p) {
    if (p === null || p === undefined || isNaN(p)) return "—";
    if (p >= 0.001) return fmt(p, 3);
    var expoente = Math.floor(Math.log(p) / Math.LN10);
    var mantissa = p / Math.pow(10, expoente);
    var sup = String(expoente).split("").map(function (c) { return SOBRESCRITO[c] || c; }).join("");
    return fmt(mantissa, 1) + " × 10" + sup;
  }

  /* Os cartões de métrica: valor, detalhe, alvo e se o alvo foi atingido.
     `situacao` é "atingido", "nao_atingido" ou "sem_alvo" — este último para
     as métricas que a Seção 4.1.3 reporta sem limiar contratado. */
  function avaliar(d) {
    var g = d.global;
    var ref = g.referencia;
    var piso = d.piso_aprovacao_pct;
    var faixas = d.por_faixa_de_limite || [];
    var comAprovacao = faixas.filter(function (f) { return f.aprovacao_pct !== null; });
    var pior = comAprovacao.slice().sort(function (a, b) { return a.aprovacao_pct - b.aprovacao_pct; })[0];
    var melhor = comAprovacao.slice().sort(function (a, b) { return b.aprovacao_pct - a.aprovacao_pct; })[0];
    var bateMae = g.mae_teste_c < ref.mae_teste_c && g.mae_40_divisoes_c < ref.mae_40_divisoes_c;
    var cobre = g.aprovacao_teste_pct >= piso && g.aprovacao_mediana_40_divisoes_pct >= piso;

    return [
      {
        id: "mae", titulo: "MAE", valor: fmt(g.mae_teste_c, 2), unidade: "°C",
        detalhe: "teste isolado · " + fmt(g.mae_40_divisoes_c, 2) + " °C na média das " + g.divisoes + " divisões",
        alvo: "abaixo da média do ponto na mesma amostra: " + fmt(ref.mae_teste_c, 2) + " °C no teste, " +
          fmt(ref.mae_40_divisoes_c, 2) + " °C nas divisões",
        situacao: bateMae ? "atingido" : "nao_atingido"
      },
      {
        id: "rmse", titulo: "RMSE", valor: fmt(g.rmse_teste_c, 2), unidade: "°C",
        detalhe: "teste isolado",
        alvo: "sem limiar contratado; leitura conjunta com o MAE",
        situacao: "sem_alvo"
      },
      {
        id: "r2", titulo: "R²", valor: fmt(g.r2_teste, 3), unidade: "",
        detalhe: "teste isolado",
        alvo: "sem limiar contratado",
        situacao: "sem_alvo"
      },
      {
        id: "cobertura", titulo: "Cobertura do critério", valor: fmt(g.aprovacao_teste_pct, 1), unidade: "%",
        detalhe: g.pontos_aprovados + " de " + g.pontos_com_limite + " pontos no teste · Wilson " +
          fmt(g.aprovacao_teste_wilson_pct[0], 1) + "% a " + fmt(g.aprovacao_teste_wilson_pct[1], 1) +
          "% · mediana de " + fmt(g.aprovacao_mediana_40_divisoes_pct, 1) + "% nas divisões",
        alvo: "ao menos " + fmt(piso, 1) + "% dos pontos com limite",
        situacao: cobre ? "atingido" : "nao_atingido"
      },
      {
        id: "wilcoxon", titulo: "Wilcoxon pareado", valor: fmtP(g.wilcoxon.p), unidade: "",
        detalhe: "o modelo erra menos em " + g.wilcoxon.divisoes_em_que_o_modelo_erra_menos + " de " +
          g.wilcoxon.pares + " divisões",
        alvo: "rejeitar H₀ a α = " + fmt(ALFA, 2),
        situacao: g.wilcoxon.p < ALFA ? "atingido" : "nao_atingido"
      },
      {
        id: "faixa", titulo: "Erro por faixa de limite",
        valor: pior ? fmt(pior.aprovacao_pct, 1) + "–" + fmt(melhor.aprovacao_pct, 1) : "—", unidade: "%",
        detalhe: pior ? "aprovação entre as faixas · pior: " + pior.faixa + ", MAE de " + fmt(pior.mae_medio_c, 2) + " °C" : "",
        alvo: "reportado, sem limiar por faixa",
        situacao: "sem_alvo"
      },
      {
        id: "sensibilidade", titulo: "Sensibilidade da RN-01", valor: fmt(g.sensibilidade_pct, 1), unidade: "%",
        detalhe: (g.excedencias_teste - g.falsos_negativos) + " de " + g.excedencias_teste +
          " excedências sinalizadas · " + g.falsos_negativos + " falsos negativos, " + g.falsos_positivos + " falsos positivos",
        alvo: "sem limiar contratado; o erro aceito é o do lado do alarme",
        situacao: "sem_alvo"
      }
    ];
  }

  var ROTULO_SITUACAO = {
    atingido: "Alvo atingido",
    nao_atingido: "Alvo não atingido",
    sem_alvo: "Sem limiar"
  };

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function cartao(m) {
    var c = el("article", "metric metric--" + m.situacao);
    c.appendChild(el("h3", "metric__title", m.titulo));
    var valor = el("p", "metric__value", m.valor);
    if (m.unidade) valor.appendChild(el("span", null, m.unidade));
    c.appendChild(valor);
    c.appendChild(el("p", "metric__detail", m.detalhe));
    c.appendChild(el("p", "metric__target", "Alvo: " + m.alvo));
    c.appendChild(el("p", "metric__status", ROTULO_SITUACAO[m.situacao]));
    return c;
  }

  // O algoritmo de cada área, de `GET /modelos`; sem a resposta, o do arquivo.
  function algoritmoDe(modelos, dataset, reserva) {
    var achado = null;
    ((modelos && modelos.modelos) || []).forEach(function (m) {
      if (m.subsistema === dataset) achado = m.algoritmo;
    });
    return achado || reserva || "—";
  }

  function td(texto, classe) { return el("td", classe, texto); }

  function tabelaPorDataset(corpo, d, modelos) {
    corpo.replaceChildren();
    d.por_dataset.forEach(function (ds) {
      var tr = el("tr");
      var nome = el("th", null, ds.dataset);
      nome.setAttribute("scope", "row");
      tr.appendChild(nome);

      if (!ds.validado) {
        var aviso = td((ds.motivo || "Nenhum modelo validado.") +
          " A previsão desta área não apoia decisão.", "is-empty");
        aviso.setAttribute("colspan", "8");
        tr.appendChild(aviso);
        corpo.appendChild(tr);
        return;
      }

      tr.appendChild(td(algoritmoDe(modelos, ds.dataset, ds.modelo_final)));
      tr.appendChild(td(fmt(ds.mae_teste_c, 2), "num"));
      tr.appendChild(td(fmt(ds.referencia_mae_teste_c, 2), "num"));
      tr.appendChild(td(fmt(ds.mae_40_divisoes_c, 2), "num"));
      tr.appendChild(td(fmt(ds.aprovacao_mediana_40_divisoes_pct, 1), "num"));
      tr.appendChild(td(ds.pontos_aprovados + " de " + ds.pontos_com_limite, "num"));
      tr.appendChild(td(ds.sensibilidade_pct === null ? "sem excedência" : fmt(ds.sensibilidade_pct, 1), "num"));
      tr.appendChild(td(ds.falsos_negativos + " / " + ds.falsos_positivos, "num"));
      corpo.appendChild(tr);
    });
  }

  /* ----- Gráficos -----
     SVG gerado aqui, como os outros da tela (js/engenharia.js), com os mesmos
     tokens de cor. O valor de cada barra vem escrito ao lado dela: o gráfico
     mostra a comparação, e o número não depende de ler a escala. */

  var NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    return n;
  }

  function svgTexto(x, y, conteudo, classe, extra) {
    var t = svgEl("text", extra || {});
    t.setAttribute("x", x);
    t.setAttribute("y", y);
    if (classe) t.setAttribute("class", classe);
    t.textContent = conteudo;
    return t;
  }

  function figura(id, largura, altura, rotulo) {
    var alvo = document.getElementById(id);
    if (!alvo) return null;
    alvo.replaceChildren();
    var svg = svgEl("svg", { class: "chart chart--desempenho", viewBox: "0 0 " + largura + " " + altura,
      role: "img", "aria-label": rotulo });
    alvo.appendChild(svg);
    return svg;
  }

  /* Erro do modelo contra a média do ponto, por dataset, no teste isolado. */
  function graficoPorDataset(d) {
    var linhas = d.por_dataset.filter(function (ds) { return ds.validado; });
    var g = d.global;
    linhas = linhas.concat([{ dataset: "Seis áreas juntas", mae_teste_c: g.mae_teste_c,
      referencia_mae_teste_c: g.referencia.mae_teste_c, juntas: true }]);

    var ROTULO = 150, X0 = 158, X1 = 470, PASSO = 38, TOPO = 28;
    var altura = TOPO + linhas.length * PASSO + 8;
    var maximo = 0;
    linhas.forEach(function (l) { maximo = Math.max(maximo, l.mae_teste_c, l.referencia_mae_teste_c); });

    var svg = figura("chart-desempenho-dataset", 520, altura,
      "Erro absoluto médio no teste isolado, modelo final contra a média do ponto: " +
      linhas.map(function (l) {
        return l.dataset + ", " + fmt(l.mae_teste_c, 2) + " contra " + fmt(l.referencia_mae_teste_c, 2) + " graus";
      }).join("; ") + ".");
    if (!svg) return;

    function px(v) { return X0 + (X1 - X0) * (v / maximo); }

    // Legenda no topo: barra cheia é o modelo, barra clara é a referência.
    svg.appendChild(svgEl("rect", { x: X0, y: 6, width: 12, height: 8, fill: "var(--color-data)" }));
    svg.appendChild(svgTexto(X0 + 16, 14, "modelo final", "chart__label"));
    svg.appendChild(svgEl("rect", { x: X0 + 110, y: 6, width: 12, height: 8, fill: "var(--color-data-band)",
      stroke: "var(--color-border-strong)", "stroke-width": 1 }));
    svg.appendChild(svgTexto(X0 + 126, 14, "média do ponto (sem modelo)", "chart__label"));

    linhas.forEach(function (l, i) {
      var y = TOPO + i * PASSO;
      if (l.juntas) {
        svg.appendChild(svgEl("line", { x1: 0, y1: y - 4, x2: 520, y2: y - 4,
          stroke: "var(--color-border)", "stroke-width": 1 }));
      }
      svg.appendChild(svgTexto(ROTULO, y + 14, l.dataset, "chart__label" + (l.juntas ? " chart__label--forte" : ""),
        { "text-anchor": "end" }));
      svg.appendChild(svgEl("rect", { x: X0, y: y + 3, width: Math.max(1, px(l.mae_teste_c) - X0), height: 13,
        fill: "var(--color-data)" }));
      svg.appendChild(svgTexto(px(l.mae_teste_c) + 4, y + 14, fmt(l.mae_teste_c, 2), "chart__valor"));
      svg.appendChild(svgEl("rect", { x: X0, y: y + 18, width: Math.max(1, px(l.referencia_mae_teste_c) - X0),
        height: 9, fill: "var(--color-data-band)", stroke: "var(--color-border-strong)", "stroke-width": 1 }));
      svg.appendChild(svgTexto(px(l.referencia_mae_teste_c) + 4, y + 27, fmt(l.referencia_mae_teste_c, 2),
        "chart__label"));
    });
  }

  /* Aprovação no critério do parceiro por faixa de limite, com o piso. */
  function graficoPorFaixa(d) {
    var faixas = d.por_faixa_de_limite;
    var piso = d.piso_aprovacao_pct;
    var X0 = 44, X1 = 500, Y0 = 22, Y1 = 170, ALTURA = 222;
    var passo = (X1 - X0) / faixas.length;
    var larg = passo * 0.56;

    var svg = figura("chart-desempenho-faixa", 520, ALTURA,
      "Pontos aprovados no teste isolado por faixa de limite: " + faixas.map(function (f) {
        return f.faixa + ", " + fmt(f.aprovacao_pct, 1) + " por cento de " + f.pontos + " pontos";
      }).join("; ") + ". O piso exigido é " + fmt(piso, 0) + " por cento.");
    if (!svg) return;

    function py(p) { return Y1 - (Y1 - Y0) * (p / 100); }

    [0, 50, 100].forEach(function (p) {
      svg.appendChild(svgEl("line", { x1: X0, y1: py(p), x2: X1, y2: py(p),
        stroke: "var(--color-grid)", "stroke-width": 1 }));
      svg.appendChild(svgTexto(X0 - 6, py(p) + 4, p + "%", "chart__eixo", { "text-anchor": "end" }));
    });

    faixas.forEach(function (f, i) {
      var cx = X0 + passo * i + passo / 2;
      var abaixo = f.aprovacao_pct !== null && f.aprovacao_pct < piso;
      if (f.aprovacao_pct !== null) {
        svg.appendChild(svgEl("rect", { x: cx - larg / 2, y: py(f.aprovacao_pct), width: larg,
          height: Math.max(1, Y1 - py(f.aprovacao_pct)),
          fill: abaixo ? "var(--status-critical)" : "var(--color-data)" }));
        svg.appendChild(svgTexto(cx, py(f.aprovacao_pct) - 5, fmt(f.aprovacao_pct, 1) + "%", "chart__valor",
          { "text-anchor": "middle" }));
      }
      svg.appendChild(svgTexto(cx, Y1 + 16, f.faixa, "chart__label chart__label--forte", { "text-anchor": "middle" }));
      svg.appendChild(svgTexto(cx, Y1 + 32, f.aprovados + " de " + f.pontos + " pontos", "chart__label",
        { "text-anchor": "middle" }));
      svg.appendChild(svgTexto(cx, Y1 + 48, "MAE " + fmt(f.mae_medio_c, 2) + " °C", "chart__label",
        { "text-anchor": "middle" }));
    });

    // Piso do parceiro: linha cheia, porque é limiar contratado.
    svg.appendChild(svgEl("line", { x1: X0, y1: py(piso), x2: X1, y2: py(piso),
      stroke: "var(--color-text)", "stroke-width": 1.5, "stroke-dasharray": "5 3" }));
    // Rótulo à esquerda, sobre a primeira faixa: à direita ele batia no valor de 100%.
    svg.appendChild(svgTexto(X0 + 4, py(piso) - 4, "piso de " + fmt(piso, 0) + "%", "chart__label chart__label--forte"));
  }

  function tabelaPorFaixa(d) {
    var corpo = document.getElementById("desempenho-faixas-corpo");
    if (!corpo) return;
    corpo.replaceChildren();
    d.por_faixa_de_limite.forEach(function (f) {
      var tr = el("tr");
      tr.appendChild(td(f.faixa));
      tr.appendChild(td(f.aprovados + " de " + f.pontos, "num"));
      tr.appendChild(td(fmt(f.aprovacao_pct, 1) + "%", "num"));
      tr.appendChild(td(fmt(f.mae_medio_c, 2), "num"));
      corpo.appendChild(tr);
    });
  }

  /* Desenha o painel. `ao_montar` recebe os dados, para a tela preencher o que
     mais depende deles (título, situação dos critérios, gráfico). */
  function montar(d, modelos, opcoes) {
    opcoes = opcoes || {};
    var grade = document.getElementById("desempenho-metricas");
    var corpo = document.getElementById("desempenho-datasets-corpo");
    var origem = document.getElementById("desempenho-origem");
    var painel = document.getElementById("desempenho-panel");

    if (grade) {
      grade.replaceChildren();
      avaliar(d).forEach(function (m) { grade.appendChild(cartao(m)); });
    }
    if (corpo) tabelaPorDataset(corpo, d, modelos);
    graficoPorDataset(d);
    graficoPorFaixa(d);
    tabelaPorFaixa(d);
    if (origem) {
      origem.textContent = "Modelo " + d.versao_modelo + " · métricas de GET /desempenho, gravadas por " +
        d.origem + ". " + d.observacao;
    }
    if (painel) {
      painel.removeAttribute("aria-busy");
      painel.hidden = false;
    }
    if (typeof opcoes.aoMontar === "function") opcoes.aoMontar(d, modelos);
  }

  /* Busca `GET /desempenho` e `GET /modelos` e monta. Sem o desempenho, a tela
     passa ao estado indisponível: a engenharia não tem outro número a mostrar. */
  function iniciar(opcoes) {
    if (typeof API_PREDICAO === "undefined") return Promise.resolve(null);

    return Promise.all([API_PREDICAO.desempenho(), API_PREDICAO.modelos()]).then(function (r) {
      if (!r[0].ok) {
        if (typeof ESTADO_SERVICO !== "undefined") ESTADO_SERVICO.mostrar(document, "indisponivel");
        return null;
      }
      montar(r[0].dados, r[1].ok ? r[1].dados : null, opcoes);
      return r[0].dados;
    });
  }

  return {
    ALFA: ALFA,
    fmt: fmt,
    fmtP: fmtP,
    avaliar: avaliar,
    ROTULO_SITUACAO: ROTULO_SITUACAO,
    montar: montar,
    iniciar: iniciar
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = DESEMPENHO_MODELO;
