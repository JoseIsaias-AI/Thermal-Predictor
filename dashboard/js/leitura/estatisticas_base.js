/* Estatísticas da base na tela de engenharia: referência, validação, procedência,
 * hipóteses e escalonamento.
 *
 * Lê o campo `base` de GET /desempenho, gravado pelo mesmo script que avalia o modelo, e
 * escreve os números e as frases que dependem deles. Nenhum valor é fixo no HTML: sem a
 * API, os painéis ficam ocultos.
 */

var ESTATISTICAS_BASE = (function () {
  "use strict";

  var DM = typeof DESEMPENHO_MODELO !== "undefined" ? DESEMPENHO_MODELO : require("./desempenho_modelo.js");
  var fmt = DM.fmt;

  /* Inteiro com ponto de milhar: 3.744. */
  function fmtInt(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  /* *p* como na documentação: "< 0,001" abaixo disso, e o valor acima. */
  function fmtPLimiar(p) {
    if (p === null || p === undefined || isNaN(p)) return "—";
    return p < 0.001 ? "< 0,001" : "= " + fmt(p, 3);
  }

  function decisao(rejeita) {
    return rejeita ? "Rejeita H₀" : "Não rejeita H₀";
  }

  /* ----- Textos -----
     Tudo o que a tela escreve sai daqui, em função dos números da API. */

  function referencia(b, d) {
    var r = b.referencia;
    var cob = r.cobertura_pct, exig = r.cobertura_exigida_pct;
    var distancia = cob >= exig ? "acima dos" : exig - cob <= 10 ? "abaixo dos" : "longe dos";
    var g = d.global;
    var modelo;
    if (g.mae_teste_c >= g.referencia.mae_teste_c) {
      modelo = ", e o modelo final não a bate em erro médio no teste isolado.";
    } else if (g.aprovacao_teste_pct < d.piso_aprovacao_pct) {
      modelo = ", e o modelo final, que a bate, também fica abaixo do piso.";
    } else {
      modelo = ", e o modelo final, que a bate, chega a " + fmt(g.aprovacao_teste_pct, 1) + "%.";
    }
    return {
      titulo: "A média histórica cobre " + fmt(cob, 1) + "% dos pontos, " + distancia + " " +
        fmt(exig, 0) + "% exigidos",
      numeros: [
        { titulo: "Erro a superar", valor: fmt(r.mae_c, 2), unidade: "°C",
          nota: "erro absoluto médio da referência" },
        { titulo: "Cobertura da referência", valor: fmt(cob, 1), unidade: "%", lacuna: cob < exig,
          nota: r.pontos_cobertos + " de " + r.pontos_com_limite + " pontos · Wilson " +
            fmt(r.cobertura_wilson_pct[0], 1) + "% a " + fmt(r.cobertura_wilson_pct[1], 1) + "%" },
        { titulo: "Cobertura exigida", valor: fmt(exig, 1), unidade: "%", nota: "critério de sucesso do modelo" }
      ],
      tabela: [
        ["Estimativa pontual da referência (" + r.pontos_cobertos + " de " + r.pontos_com_limite + ")",
          fmt(cob, 1) + "%"],
        ["Intervalo de Wilson", fmt(r.cobertura_wilson_pct[0], 1) + "% a " + fmt(r.cobertura_wilson_pct[1], 1) + "%"],
        ["Exigido pelo critério", fmt(exig, 1) + "%"]
      ],
      suficiencia: "Bater a referência em erro médio é condição necessária e está longe de ser " +
        "suficiente: a própria referência cobre " + fmt(cob, 1) + "% contra os " + fmt(exig, 0) +
        "% exigidos" + modelo,
      barraTitulo: "Por que a barra é " + fmt(r.mae_c, 2) + " °C, e não " + fmt(r.mae_na_amostra_c, 2) + " °C",
      barraAmostra: "Calculada sobre as mesmas linhas em que é avaliada, a média por ponto produz " +
        fmt(r.mae_na_amostra_c, 2) + " °C, valor que embute vantagem indevida: a referência enxerga a " +
        "rodada em que está sendo medida, e o modelo, sob validação agrupada, não enxerga.",
      barraFora: "A referência foi por isso recalculada deixando de fora a rodada avaliada, e é esse " +
        "valor, " + fmt(r.mae_c, 2) + " °C, que serve de barra. Comparar o modelo contra " +
        fmt(r.mae_na_amostra_c, 2) + " °C seria compará-lo contra uma referência que trapaceia."
    };
  }

  function validacao(b) {
    var v = b.validacao;
    var varias = v.distribuicao.filter(function (l) { return l.rodadas_por_configuracao > 1; })
      .reduce(function (s, l) { return s + l.configuracoes; }, 0);
    return {
      titulo: v.rodadas_em_configuracao_compartilhada > 0
        ? fmt(v.rodadas_em_configuracao_compartilhada_pct, 1) + "% das rodadas dividem configuração com " +
          "outra, por isso a validação agrupa por configuração"
        : "Nenhuma rodada repete configuração, e a validação agrupa por configuração mesmo assim",
      numeros: [
        { titulo: "Rodadas", valor: fmtInt(v.rodadas) },
        { titulo: "Configurações distintas", valor: fmtInt(v.configuracoes),
          nota: "de " + fmtInt(v.configuracoes_possiveis) + " possíveis" },
        { titulo: "Rodadas em configuração compartilhada", valor: fmtInt(v.rodadas_em_configuracao_compartilhada),
          nota: fmt(v.rodadas_em_configuracao_compartilhada_pct, 1) + "% das " + v.rodadas }
      ],
      legenda: "Distribuição das " + v.rodadas + " rodadas entre as " + v.configuracoes + " configurações. " +
        "É a base do argumento de agrupamento: " + varias +
        (varias === 1 ? " configuração reúne" : " configurações reúnem") + " mais de uma rodada.",
      tabela: v.distribuicao.map(function (l) {
        return [String(l.rodadas_por_configuracao), String(l.configuracoes), String(l.rodadas)];
      }),
      rodape: v.rodadas_em_configuracao_compartilhada + " das " + v.rodadas + " rodadas dividem configuração com outra"
    };
  }

  function procedencia(b) {
    var p = b.procedencia;
    return {
      titulo: fmt(p.sem_leitura_pct, 2) + "% das combinações não têm leitura e ficam fora, sem imputação",
      numeros: [
        { titulo: "Combinações possíveis", valor: fmtInt(p.combinacoes),
          nota: p.pontos + " pontos × " + p.rodadas + " rodadas" },
        { titulo: "Sem leitura", valor: fmtInt(p.sem_leitura), nota: fmt(p.sem_leitura_pct, 2) + "% · descartadas" },
        { titulo: "Tabela de modelagem", valor: fmtInt(p.observacoes), nota: "observações usadas" }
      ],
      tabela: p.por_classe.map(function (c) { return [c.classe, c.mecanismo, fmtInt(c.ocorrencias)]; }),
      porque: "Imputar temperatura estimaria a própria grandeza que o modelo existe para prever, " +
        "contaminando a variável dependente com uma estimativa anterior ao modelo. E nenhuma técnica de " +
        "imputação recuperaria informação física nos " + fmtInt(p.estruturais) + " casos estruturais, em que " +
        "não houve falha de medição, houve ausência de medição."
    };
  }

  function hd1(h, pontosDaBase) {
    var r = h.hd1;
    var celulas = r.celulas_esperadas_abaixo_de_5 > 0
      ? r.celulas_esperadas_abaixo_de_5 + " das " + r.celulas + " células têm frequência esperada abaixo de 5, " +
        "o que viola a condição de validade da aproximação assintótica."
      : "nenhuma das " + r.celulas + " células tem frequência esperada abaixo de 5, e a aproximação " +
        "assintótica vale.";
    var reamostragem = r.reamostragens_que_alcancaram === 0
      ? "nenhuma alcançou o valor observado."
      : r.reamostragens_que_alcancaram + " alcançaram o valor observado (p = " + fmt(r.p_reamostragem, 3) + ").";
    var dez = r.violacoes ? 100 * r.violacoes_dos_pontos_de_maior_risco / r.violacoes : 0;
    return {
      numeros: [
        ["Teste", r.teste],
        ["Estatística", r.estatistica === null ? "sem violação a comparar"
          : "χ² = " + fmt(r.estatistica, 2) + " · gl = " + r.gl + " · p " + fmtPLimiar(r.p)],
        ["Decisão", decisao(r.rejeita_h0)]
      ],
      impacto: r.rejeita_h0
        ? "precisão uniforme entre os " + pontosDaBase + " pontos não é o objetivo; o erro precisa ser " +
          "pequeno onde o risco se concentra."
        : "o risco se distribui entre os pontos, e o erro precisa ser pequeno em todos eles.",
      nota: "A magnitude do valor-p não deve ser lida como força do resultado: " + celulas +
        " A decisão foi conferida por reamostragem, e em " + fmtInt(r.reamostragens) + " reamostragens " +
        reamostragem + " O que interessa é o tamanho de efeito: " + r.pontos_com_violacao + " dos " + r.pontos +
        " pontos registram ao menos uma violação, e os " + r.pontos_de_maior_risco + " de maior risco concentram " +
        r.violacoes_dos_pontos_de_maior_risco + " das " + r.violacoes + " violações, ou " + fmt(dez, 1) + "%."
    };
  }

  function hd2(h) {
    var r = h.hd2;
    var prop = r.proporcao_rejeita_h0, marg = r.margem_rejeita_h0;
    var veredito = prop && marg ? "Rejeita H₀ nas duas medidas"
      : !prop && !marg ? "Não rejeita H₀ em nenhuma das duas medidas"
        : prop ? "Dividida: H₀ das proporções é rejeitada, H₀ das margens não é"
          : "Dividida: H₀ das proporções não é rejeitada, H₀ das margens é";
    var mais = r.margem_no_modo_c >= r.margem_nos_demais_c;
    var efeito = r.pontos_que_esquentam_no_modo > 0 && r.pontos_que_esfriam_no_modo > 0
      ? "o efeito do modo muda de sinal entre os pontos: em " + r.modo + " a temperatura média sobe em " +
        r.pontos_que_esquentam_no_modo + " pontos e desce em " + r.pontos_que_esfriam_no_modo + ", o que é " +
        "interação por definição. O modelo precisa de termos que cruzem ponto e modo, não de um indicador de " +
        "modo isolado."
      : "o modo desloca a temperatura de todos os pontos no mesmo sentido, e entra como fator do modelo.";
    return {
      numeros: [
        ["Teste", "Permutação do rótulo de modo entre as " + r.rodadas + " rodadas e Mann-Whitney"],
        ["Proporção de violação", "p = " + fmt(r.proporcao_p_permutacao, 3) + " por permutação · U = " +
          fmt(r.proporcao_u, 1) + ", p = " + fmt(r.proporcao_p_mann_whitney, 3)],
        ["Margem térmica", "p = " + fmt(r.margem_p_permutacao, 3) + " por permutação · U = " +
          fmt(r.margem_u, 1) + ", p = " + fmt(r.margem_p_mann_whitney, 3)],
        ["Violação por rodada", fmt(r.proporcao_no_modo_pct, 1) + "% das leituras com limite em " + r.modo +
          ", contra " + fmt(r.proporcao_nos_demais_pct, 1) + "% nos demais modos"],
        ["Decisão", veredito]
      ],
      impacto: efeito,
      nota: "O resultado depende da unidade de análise, e é por isso que ele está aqui. O modo é atributo " +
        "da rodada, não da leitura: tratar as " + fmtInt(r.leituras) + " leituras como independentes " +
        "multiplicaria por cerca de " + Math.round(r.leituras / r.rodadas) + " o tamanho de amostra efetivo e " +
        "produziria significância artificial. Sobre leituras, a diferença de proporção daria z = " +
        fmt(r.leituras_z, 3) + " e p " + fmtPLimiar(r.leituras_p) +
        (prop ? "; na rodada, ela se sustenta, com p = " + fmt(r.proporcao_p_permutacao, 3) + " por permutação."
          : "; corrigida a unidade, ela deixa de se sustentar.") +
        " Na margem, " + r.modo + " fica com " + fmt(r.margem_no_modo_c, 2) + " °C contra " +
        fmt(r.margem_nos_demais_c, 2) + " °C nos demais modos, " +
        fmt(Math.abs(r.margem_no_modo_c - r.margem_nos_demais_c), 2) + " °C de folga " +
        (mais ? "adicional" : "a menos") + (marg ? ", diferença que se sustenta na rodada." :
          ", diferença que não se sustenta na rodada.")
    };
  }

  function hd3(h) {
    var r = h.hd3;
    var tMin = r.limite_min_c / 10, tMax = r.limite_max_c / 10;
    return {
      numeros: [
        ["Teste", r.teste],
        ["Estatística", "r = " + fmt(r.r, 3) + " · ρ = " + fmt(r.rho, 3) + " · p " + fmtPLimiar(r.p) +
          " · n = " + r.n],
        ["Decisão", decisao(r.rejeita_h0)]
      ],
      leitura: "O critério de 10% traduzido em graus. O mesmo requisito exige erro abaixo de " + fmt(tMin, 1) +
        " °C no ponto de limite " + fmt(r.limite_min_c, 0) + " e admite até " + fmt(tMax, 1) + " °C no de limite " +
        fmt(r.limite_max_c, 0) + ".",
      tabela: [[fmt(r.limite_min_c, 0), "±" + fmt(tMin, 1)], [fmt(r.limite_max_c, 0), "±" + fmt(tMax, 1)]],
      rodape: "Mesmo critério, precisão absoluta " + fmt(r.limite_max_c / r.limite_min_c, 1) +
        " vezes mais exigente num extremo"
    };
  }

  function hn(h) {
    var algumaRejeita = h.hn.some(function (v) { return v.rejeita_h0; });
    return {
      tabela: h.hn.map(function (v) {
        return [v.variavel, fmtInt(v.n), fmt(v.w, 4), v.p < 0.001 ? "< 0,001" : fmt(v.p, 3), decisao(v.rejeita_h0)];
      }),
      impacto: algumaRejeita
        ? "a rejeição de HN é o que obriga os testes de comparação a serem não paramétricos. É daí que vêm " +
          "o Wilcoxon de HM e o Mann-Whitney de HD2, e não de preferência metodológica."
        : "sem rejeição de HN, testes paramétricos seriam admissíveis; a tela mantém os não paramétricos, " +
          "que valem nos dois casos."
    };
  }

  function tituloHipoteses(h) {
    var todasRejeitam = h.hn.every(function (v) { return v.rejeita_h0; });
    if (h.hd1.rejeita_h0 && todasRejeitam) {
      return "O risco se concentra em poucos pontos e o dado não é normal: quatro hipóteses testadas";
    }
    return "Quatro hipóteses sobre o dado, testadas na base";
  }

  function escalonamento(b) {
    return b.escalonamento.map(function (v) {
      return [v.variavel, fmtInt(v.n), fmt(v.media_c, 2), fmt(v.desvio_c, 2),
        "z = (" + v.variavel + " − " + fmt(v.media_c, 2) + ") / " + fmt(v.desvio_c, 2)];
    });
  }

  /* Todos os textos e tabelas, a partir da resposta de GET /desempenho. */
  function textos(d) {
    var b = d.base;
    return {
      referencia: referencia(b, d),
      validacao: validacao(b),
      procedencia: procedencia(b),
      hipoteses: {
        titulo: tituloHipoteses(b.hipoteses),
        hd1: hd1(b.hipoteses, b.procedencia.pontos),
        hd2: hd2(b.hipoteses),
        hd3: hd3(b.hipoteses),
        hn: hn(b.hipoteses)
      },
      escalonamento: escalonamento(b)
    };
  }

  /* ----- DOM ----- */

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function escrever(id, texto) {
    var alvo = document.getElementById(id);
    if (alvo) alvo.textContent = texto;
  }

  function numeros(id, itens) {
    var alvo = document.getElementById(id);
    if (!alvo) return;
    alvo.replaceChildren();
    itens.forEach(function (item) {
      var caixa = el("div", "stat" + (item.lacuna ? " stat--gap" : ""));
      caixa.appendChild(el("dt", null, item.titulo));
      var valor = el("dd", "stat__value", item.valor);
      if (item.unidade) valor.appendChild(el("span", null, item.unidade));
      caixa.appendChild(valor);
      if (item.nota) caixa.appendChild(el("dd", "stat__note", item.nota));
      alvo.appendChild(caixa);
    });
  }

  function definicoes(id, pares) {
    var alvo = document.getElementById(id);
    if (!alvo) return;
    alvo.replaceChildren();
    pares.forEach(function (par) {
      alvo.appendChild(el("dt", null, par[0]));
      alvo.appendChild(el("dd", null, par[1]));
    });
  }

  /* Linhas de tabela; as colunas marcadas em `numericas` vão alinhadas à direita, e a
     primeira coluna de código (classe de ausência, variável) vai em <code>. */
  function linhas(id, dados, numericas, codigo) {
    var corpo = document.getElementById(id);
    if (!corpo) return;
    corpo.replaceChildren();
    dados.forEach(function (linha) {
      var tr = el("tr");
      linha.forEach(function (celula, i) {
        var td = el("td", numericas.indexOf(i) >= 0 ? "num" : null);
        if (codigo && (i === 0 || (codigo === "equacao" && i === linha.length - 1))) {
          td.appendChild(el("code", null, celula));
        } else {
          td.textContent = celula;
        }
        tr.appendChild(td);
      });
      corpo.appendChild(tr);
    });
  }

  function impacto(id, texto) {
    var alvo = document.getElementById(id);
    if (!alvo) return;
    alvo.replaceChildren(el("strong", null, "Para o modelo:"), document.createTextNode(" " + texto));
  }

  /* ----- Gráficos -----
     SVG gerado aqui, com os mesmos tokens de cor do painel de desempenho. */

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

  /* O gráfico entra como figura com rótulo: quem usa leitor de tela recebe a
     leitura em uma frase, e não a lista de elementos gráficos. */
  function figura(id, viewBox, rotulo) {
    var alvo = document.getElementById(id);
    if (!alvo) return null;
    alvo.replaceChildren();
    var svg = svgEl("svg", { class: "chart", viewBox: viewBox, role: "img", "aria-label": rotulo });
    alvo.appendChild(svg);
    return svg;
  }

  /* Cobertura da referência contra o alvo, com o intervalo de Wilson. */
  function graficoCobertura(r) {
    var cob = r.cobertura_pct, baixo = r.cobertura_wilson_pct[0], alto = r.cobertura_wilson_pct[1];
    var exig = r.cobertura_exigida_pct;
    var svg = figura("chart-cobertura", "0 0 520 132",
      "Cobertura da referência: " + fmt(cob, 1) + " por cento, com intervalo de confiança de " + fmt(baixo, 1) +
      " a " + fmt(alto, 1) + " por cento, contra o alvo de " + fmt(exig, 0) + " por cento exigido pelo critério.");
    if (!svg) return;

    var x0 = 16, x1 = 476, y = 46, alt = 26;
    function px(p) { return x0 + (x1 - x0) * (p / 100); }

    // Trilho de 0 a 100%: dá a escala em que as duas marcas se comparam.
    svg.appendChild(svgEl("rect", { x: x0, y: y, width: x1 - x0, height: alt,
      fill: "var(--color-surface-sunken)", stroke: "var(--color-border)", "stroke-width": 1 }));
    svg.appendChild(svgEl("rect", { x: px(baixo), y: y + 4, width: Math.max(1, px(alto) - px(baixo)), height: alt - 8,
      fill: "var(--color-data-band)", stroke: "var(--color-highlight)", "stroke-width": 1 }));
    svg.appendChild(svgEl("rect", { x: x0, y: y + 8, width: Math.max(1, px(cob) - x0), height: alt - 16,
      fill: "var(--color-data)" }));
    // Alvo: linha cheia, porque é limiar contratado e não estimativa.
    svg.appendChild(svgEl("line", { x1: px(exig), y1: y - 10, x2: px(exig), y2: y + alt + 10,
      stroke: "var(--color-text)", "stroke-width": 2 }));

    svg.appendChild(svgTexto(px(cob), y - 14, fmt(cob, 1) + "% da referência", "chart__label",
      { "text-anchor": "middle" }));
    // O rótulo do alvo vai do lado em que há espaço, para não cruzar o do intervalo.
    var alvoADireita = px(exig) + 96 <= 520;
    svg.appendChild(svgTexto(alvoADireita ? px(exig) + 6 : px(exig) - 6, y + alt + 24,
      fmt(exig, 0) + "% exigidos", "chart__label chart__label--forte",
      { "text-anchor": alvoADireita ? "start" : "end" }));
    svg.appendChild(svgTexto(px(baixo), y + alt + 24, "Wilson " + fmt(baixo, 1) + "% a " + fmt(alto, 1) + "%",
      "chart__label", { "text-anchor": "start" }));
    svg.appendChild(svgTexto(x0, 122, r.pontos_cobertos + " de " + r.pontos_com_limite +
      " pontos com limite declarado", "chart__foot"));
  }

  /* Rodadas por configuração: as barras cheias são as configurações repetidas. */
  function graficoConfiguracoes(v, rodape) {
    var dados = v.distribuicao;
    var svg = figura("chart-configuracoes", "0 0 520 196",
      "Distribuição das " + v.rodadas + " rodadas entre " + v.configuracoes + " configurações: " +
      dados.map(function (l) {
        return l.configuracoes + (l.configuracoes === 1 ? " configuração tem " : " configurações têm ") +
          l.rodadas_por_configuracao + (l.rodadas_por_configuracao === 1 ? " rodada" : " rodadas");
      }).join(", ") + ".");
    if (!svg) return;

    var x0 = 40, base = 140, altMax = 86;
    var passo = Math.min(78, (500 - x0) / Math.max(1, dados.length));
    var larg = passo * 0.74;
    var maxConf = Math.max.apply(null, dados.map(function (l) { return l.configuracoes; }).concat([1]));

    svg.appendChild(svgEl("line", { x1: x0 - 8, y1: base, x2: 500, y2: base,
      stroke: "var(--color-border-strong)", "stroke-width": 1 }));

    dados.forEach(function (l, i) {
      var h = (l.configuracoes / maxConf) * altMax;
      var x = x0 + i * passo;
      // Uma configuração com uma rodada só não sustenta o argumento; as demais sustentam.
      var sozinha = l.rodadas_por_configuracao === 1;
      svg.appendChild(svgEl("rect", { x: x, y: base - h, width: larg, height: h,
        fill: sozinha ? "var(--color-surface-sunken)" : "var(--color-data)",
        stroke: sozinha ? "var(--color-border-strong)" : "var(--color-data)", "stroke-width": 1 }));
      svg.appendChild(svgTexto(x + larg / 2, base - h - 8, l.configuracoes, "chart__valor",
        { "text-anchor": "middle" }));
      svg.appendChild(svgTexto(x + larg / 2, base + 18, l.rodadas_por_configuracao, "chart__label",
        { "text-anchor": "middle" }));
      svg.appendChild(svgTexto(x + larg / 2, base + 32, sozinha ? "rodada" : "rodadas", "chart__label",
        { "text-anchor": "middle" }));
    });

    svg.appendChild(svgTexto(x0 - 8, 16, "Configurações", "chart__eixo"));
    svg.appendChild(svgTexto(x0 - 8, 188, rodape, "chart__foot"));
  }

  /* Procedência: uma barra por etapa, na mesma escala, com a ausência estrutural
     separada da aleatória. */
  function graficoProcedencia(p) {
    var svg = figura("chart-procedencia", "0 0 520 168",
      "Das " + fmtInt(p.combinacoes) + " combinações possíveis, " + fmtInt(p.sem_leitura) + " não têm leitura, " +
      "sendo " + fmtInt(p.estruturais) + " de ausência estrutural e " + fmtInt(p.aleatorias) + " de falha " +
      "aleatória, restando " + fmtInt(p.observacoes) + " observações na tabela de modelagem.");
    if (!svg) return;

    var x0 = 16, larg = 460;
    function w(v) { return (v / p.combinacoes) * larg; }

    var etapas = [
      { y: 24, titulo: "Combinações possíveis", valor: fmtInt(p.combinacoes), partes: [
        { v: p.combinacoes, fill: "var(--color-border)", stroke: "var(--color-border-strong)" }] },
      { y: 70, titulo: "Sem leitura", valor: fmtInt(p.sem_leitura), partes: [
        { v: p.estruturais, fill: "var(--color-data-strong)", stroke: "var(--color-data-strong)",
          rotulo: fmtInt(p.estruturais) + " estruturais" },
        { v: p.aleatorias, fill: "var(--color-data-muted)", stroke: "var(--color-data-muted)",
          rotulo: fmtInt(p.aleatorias) + " aleatórias" }] },
      { y: 116, titulo: "Tabela de modelagem", valor: fmtInt(p.observacoes), partes: [
        { v: p.observacoes, fill: "var(--color-data)", stroke: "var(--color-data)" }] }
    ];

    etapas.forEach(function (etapa) {
      svg.appendChild(svgTexto(x0, etapa.y - 6, etapa.titulo, "chart__label"));
      svg.appendChild(svgTexto(x0 + larg, etapa.y - 6, etapa.valor, "chart__valor", { "text-anchor": "end" }));
      var x = x0, rotulos = [];
      etapa.partes.forEach(function (parte) {
        // Piso de 2px: a parcela aleatória é pequena, e é ela que precisa ser vista.
        var largura = Math.max(2, w(parte.v));
        svg.appendChild(svgEl("rect", { x: x, y: etapa.y, width: largura, height: 18,
          fill: parte.fill, stroke: parte.stroke, "stroke-width": 1 }));
        if (parte.rotulo) rotulos.push(parte.rotulo);
        x += largura;
      });
      // Um rótulo só, depois do grupo inteiro: dois rótulos em parcelas estreitas se sobrepõem.
      if (rotulos.length) svg.appendChild(svgTexto(x + 8, etapa.y + 13, rotulos.join(" · "), "chart__label"));
    });

    svg.appendChild(svgTexto(x0, 160, "Nenhuma ausência recebe valor imputado no alvo", "chart__foot"));
  }

  /* Tolerância absoluta por limite declarado: 10% do limite, linear por construção. */
  function graficoTolerancia(r, rodape) {
    var lMin = r.limite_min_c, lMax = r.limite_max_c, tMin = lMin / 10, tMax = lMax / 10;
    var svg = figura("chart-tolerancia", "0 0 520 178",
      "A tolerância de 10% do limite declarado vale " + fmt(tMin, 1) + " graus Celsius no ponto de limite " +
      fmt(lMin, 0) + " e " + fmt(tMax, 1) + " graus Celsius no ponto de limite " + fmt(lMax, 0) + ".");
    if (!svg) return;

    var x0 = 52, x1 = 470, base = 118, topo = 30;
    function px(l) { return lMax > lMin ? x0 + (x1 - x0) * ((l - lMin) / (lMax - lMin)) : (x0 + x1) / 2; }
    function py(t) { return base - (base - topo) * (t / tMax); }

    svg.appendChild(svgEl("line", { x1: x0, y1: base, x2: x1, y2: base,
      stroke: "var(--color-border-strong)", "stroke-width": 1 }));
    svg.appendChild(svgEl("line", { x1: x0, y1: base, x2: x0, y2: topo - 6,
      stroke: "var(--color-border-strong)", "stroke-width": 1 }));
    svg.appendChild(svgEl("line", { x1: px(lMin), y1: py(tMin), x2: px(lMax), y2: py(tMax),
      stroke: "var(--color-data)", "stroke-width": 2 }));

    [{ l: lMin, t: tMin }, { l: lMax, t: tMax }].forEach(function (p) {
      svg.appendChild(svgEl("circle", { cx: px(p.l), cy: py(p.t), r: 4,
        fill: "var(--color-surface)", stroke: "var(--color-data)", "stroke-width": 2 }));
      svg.appendChild(svgEl("line", { x1: px(p.l), y1: py(p.t), x2: px(p.l), y2: base,
        stroke: "var(--color-border-strong)", "stroke-width": 1, "stroke-dasharray": "3 3" }));
      svg.appendChild(svgTexto(px(p.l), py(p.t) - 12, "±" + fmt(p.t, 1) + " °C", "chart__valor",
        { "text-anchor": "middle" }));
      svg.appendChild(svgTexto(px(p.l), base + 18, fmt(p.l, 0) + " °C", "chart__label",
        { "text-anchor": "middle" }));
    });

    svg.appendChild(svgTexto(x0 - 44, topo + 4, "Tolerância", "chart__eixo"));
    svg.appendChild(svgTexto((x0 + x1) / 2, base + 36, "Limite declarado", "chart__eixo",
      { "text-anchor": "middle" }));
    svg.appendChild(svgTexto(x0 - 44, 168, rodape, "chart__foot"));
  }

  /* Preenche e mostra os painéis. Sem o campo `base` na resposta, eles seguem ocultos. */
  function montar(d) {
    if (!d || !d.base) return;
    var t = textos(d);
    var b = d.base;

    escrever("referencia-titulo", t.referencia.titulo);
    numeros("referencia-numeros", t.referencia.numeros);
    linhas("referencia-tabela", t.referencia.tabela, [1]);
    escrever("referencia-suficiencia", t.referencia.suficiencia);
    escrever("referencia-barra-titulo", t.referencia.barraTitulo);
    escrever("referencia-barra-amostra", t.referencia.barraAmostra);
    escrever("referencia-barra-fora", t.referencia.barraFora);
    graficoCobertura(b.referencia);

    escrever("validacao-titulo", t.validacao.titulo);
    numeros("validacao-numeros", t.validacao.numeros);
    escrever("validacao-legenda", t.validacao.legenda);
    linhas("validacao-tabela", t.validacao.tabela, [0, 1, 2]);
    graficoConfiguracoes(b.validacao, t.validacao.rodape);

    escrever("procedencia-titulo", t.procedencia.titulo);
    numeros("procedencia-numeros", t.procedencia.numeros);
    linhas("procedencia-tabela", t.procedencia.tabela, [2], "classe");
    escrever("procedencia-porque", t.procedencia.porque);
    graficoProcedencia(b.procedencia);

    var h = t.hipoteses;
    escrever("hipoteses-titulo", h.titulo);
    definicoes("hd1-numeros", h.hd1.numeros);
    impacto("hd1-impacto", h.hd1.impacto);
    escrever("hd1-nota", h.hd1.nota);
    definicoes("hd2-numeros", h.hd2.numeros);
    impacto("hd2-impacto", h.hd2.impacto);
    escrever("hd2-nota", h.hd2.nota);
    definicoes("hd3-numeros", h.hd3.numeros);
    escrever("hd3-leitura", h.hd3.leitura);
    linhas("hd3-tabela", h.hd3.tabela, [0, 1]);
    graficoTolerancia(b.hipoteses.hd3, h.hd3.rodape);
    linhas("hn-tabela", h.hn.tabela, [1, 2], "variavel");
    impacto("hn-impacto", h.hn.impacto);

    linhas("escalonamento-tabela", t.escalonamento, [1, 2, 3], "equacao");

    Array.prototype.forEach.call(document.querySelectorAll("[data-base]"), function (painel) {
      painel.hidden = false;
    });
  }

  return {
    fmtInt: fmtInt,
    fmtPLimiar: fmtPLimiar,
    textos: textos,
    montar: montar
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ESTATISTICAS_BASE;
