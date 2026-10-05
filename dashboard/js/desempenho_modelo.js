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
        var aviso = td("Nenhum modelo validado: " + (ds.motivo || "sem métrica de teste") +
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
