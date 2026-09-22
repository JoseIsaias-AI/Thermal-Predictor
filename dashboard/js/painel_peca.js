/* Painel de resumo da peça selecionada no modelo 3D.
 *
 * Não calcula estado, folga nem ordem: tudo vem pronto em DADOS_TRIAGEM, o
 * mesmo dado da tabela. O painel só recorta os pontos da zona (FOGAO.ZONAS),
 * conta os estados que já vieram rotulados e escolhe como referência o ponto
 * que a triagem já pôs primeiro.
 */

var PAINEL_PECA = (function () {
  "use strict";

  var ESTADOS = ["acima_do_limite", "banda_de_incerteza", "dentro_do_limite"];
  var ROTULO_CURTO = { acima_do_limite: "acima", banda_de_incerteza: "na banda", dentro_do_limite: "dentro", monitoramento: "monitorados" };

  /* Resumo de uma zona. Puro: sem DOM, para rodar também nos testes em Node.

     A referência é o primeiro ponto com limite da zona. `pontos` chega
     ordenado do mais crítico para o menos, então o primeiro é o que governa
     a peça — escolher, e não recalcular. Zona só de monitorados não tem
     ponto que governe: a referência vira o mais quente, e o estado dela
     segue sendo "monitoramento". */
  function resumir(zona, dados) {
    var classificados = FOGAO.pontosDaZona(zona, dados.pontos);
    var monitorados = FOGAO.pontosDaZona(zona, dados.monitoramento);
    var todos = classificados.concat(monitorados);

    var contagem = { acima_do_limite: 0, banda_de_incerteza: 0, dentro_do_limite: 0, monitoramento: monitorados.length };
    classificados.forEach(function (p) { contagem[p.estado] += 1; });

    var referencia = classificados[0] || null;
    if (!referencia) {
      monitorados.forEach(function (p) {
        if (!referencia || p.temperatura_prevista_c > referencia.temperatura_prevista_c) referencia = p;
      });
    }

    /* Mediana, e não média: um ponto quente não arrasta o valor central, e
       nenhum dos dois decide estado — quem decide é o ponto mais crítico,
       como a RN-02 faz para a configuração. */
    var temps = todos.map(function (p) { return p.temperatura_prevista_c; }).sort(function (a, b) { return a - b; });
    var meio = temps.length >> 1;
    var mediana = temps.length % 2 ? temps[meio] : (temps[meio - 1] + temps[meio]) / 2;

    return {
      zona: zona,
      classificados: classificados,
      monitorados: monitorados,
      total: todos.length,
      contagem: contagem,
      referencia: referencia,
      // Espelha is_monitor_only na peça: nenhum, parte ou todos os pontos.
      soMonitoramento: !todos.length ? "vazio"
        : monitorados.length === todos.length ? "todos"
        : monitorados.length ? "parcial" : "nenhum",
      temperatura: todos.length ? { min: temps[0], max: temps[temps.length - 1], mediana: mediana } : null
    };
  }

  // A mesma cor do marcador e da tabela: monitorado é branco, o resto segue a faixa.
  function corDoPonto(p, rampa) {
    if (p.is_monitor_only) return "#ffffff";
    return rampa[FOGAO.faixaDaRampa(p.margem_percentual)];
  }

  /* ----- DOM ----- */

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }

  var SVG = "http://www.w3.org/2000/svg";

  function glifo(p, rampa, lado) {
    lado = lado || 12;
    var svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("width", lado);
    svg.setAttribute("height", lado);
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("aria-hidden", "true");
    var forma = document.createElementNS(SVG, "path");
    forma.setAttribute("d", FOGAO.formaDoPonto(6, 6, p.estado, p.is_monitor_only));
    forma.setAttribute("fill", corDoPonto(p, rampa));
    forma.setAttribute("stroke", p.is_monitor_only ? "#767777" : "#484949");
    forma.setAttribute("stroke-width", "0.8");
    if (p.is_monitor_only) forma.setAttribute("stroke-dasharray", "2.5 2");
    svg.appendChild(forma);
    return svg;
  }

  function linha(dl, rotulo, valor, vazio, dica) {
    var dt = el("dt", null, rotulo);
    if (dica) dt.title = dica;
    var dd = el("dd", vazio ? "is-empty" : null, valor);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  // Na tela, pt-BR: vírgula decimal e uma casa para temperatura e folga, como
  // nas tabelas.
  function num(v, casas) { return v.toFixed(casas == null ? 1 : casas).replace(".", ","); }
  function graus(v) { return num(v).replace("-", "−") + " °C"; }
  function sinal(v, casas) { return (v < 0 ? "−" : "+") + num(Math.abs(v), casas); }

  function plural(n, um, varios) { return n + " " + (n === 1 ? um : varios); }

  function cabecalho(caixa, titulo, sub, aoLimpar) {
    var topo = el("div", "part__head");
    var textos = el("div", "part__titles");
    textos.appendChild(el("p", "detail__name", titulo));
    textos.appendChild(el("span", "detail__area", sub));
    topo.appendChild(textos);
    if (aoLimpar) {
      var fechar = el("button", "part__close");
      fechar.type = "button";
      fechar.setAttribute("aria-label", "Desfazer a seleção da peça");
      fechar.title = "Desfazer a seleção (Esc no modelo)";
      fechar.textContent = "×";
      fechar.addEventListener("click", aoLimpar);
      topo.appendChild(fechar);
    }
    caixa.appendChild(topo);
  }

  function vazio(caixa) {
    caixa.appendChild(el("p", "detail__empty",
      "Clique numa peça do modelo para ver o resumo. Esc desfaz."));
  }

  // Clique registrado numa peça que o dado não cobre: diz qual foi, e por que não há resumo.
  function semDado(caixa, peca, aoLimpar) {
    cabecalho(caixa, peca.nome, "Sem ponto de medição", null);
    var aviso = el("p", "part__notice");
    aviso.appendChild(document.createTextNode(
      "Esta peça não tem termopar no conjunto de dados, então não há temperatura, limite ou estado a resumir. Nenhuma peça ficou selecionada."));
    caixa.appendChild(aviso);
    if (peca.casca || peca.id === "cooktop") {
      caixa.appendChild(el("p", "legend-note",
        "As peças instrumentadas ficam por dentro: na vista explodida a casca recua e o clique as alcança."));
    }
    if (aoLimpar) {
      var ok = el("button", "vbtn part__dismiss", "Entendi");
      ok.type = "button";
      ok.addEventListener("click", aoLimpar);
      caixa.appendChild(ok);
    }
  }

  function faixaDeEstado(caixa, r, rampa) {
    var ref = r.referencia;
    var mono = ref.is_monitor_only;
    var bloco = el("p", "detail__state part__state" + (mono ? " part__state--mono" : " part__state--" + ref.estado));
    bloco.appendChild(glifo(ref, rampa, 14));
    bloco.appendChild(el("span", null, mono ? "Limite não declarado" : ref.estado_rotulo));
    caixa.appendChild(bloco);

    if (r.total > 1) {
      var nota = el("p", "part__ref");
      nota.appendChild(document.createTextNode(mono ? "Maior temperatura entre os monitorados: " : "Estado do ponto mais crítico: "));
      nota.appendChild(el("b", null, ref.TC_Name));
      caixa.appendChild(nota);
    }
  }

  function linhasDaReferencia(caixa, r, dados) {
    var ref = r.referencia;
    var dl = el("dl", "detail__rows");

    /* Com vários pontos, o rótulo diz de onde vem o número: é a temperatura
       de um ponto escolhido, não um agregado da peça. Mais crítico é o de
       pior folga, que nem sempre é o mais quente. */
    var rotuloTemp = r.total < 2 ? "Temperatura prevista"
      : ref.is_monitor_only ? "Temperatura do ponto mais quente" : "Temperatura do ponto mais crítico";
    linha(dl, rotuloTemp, graus(ref.temperatura_prevista_c), false, "temperatura_prevista_c de " + ref.TC_Name);

    if (ref.is_monitor_only) {
      linha(dl, "Limite do componente", "—", true, "limit_c");
      linha(dl, "Folga", "—", true, "margem_c");
    } else {
      linha(dl, "Limite do componente", graus(ref.limit_c), false, "limit_c");
      linha(dl, "Folga", sinal(ref.margem_c) + " °C", false, "margem_c = limit_c − temperatura prevista");
      linha(dl, "Folga relativa", sinal(ref.margem_percentual * 100, 1) + "%", false, "margem_percentual");
      linha(dl, "Tolerância (" + (dados.tolerancia_fracao * 100).toFixed(0) + "% do limite)",
        graus(dados.tolerancia_fracao * ref.limit_c), false);
    }

    var mono = r.soMonitoramento === "todos" ? (r.total > 1 ? "Sim · todos os " + r.total + " pontos" : "Sim")
      : r.soMonitoramento === "parcial" ? "Parcial · " + r.monitorados.length + " de " + r.total + " pontos"
      : "Não";
    linha(dl, "Só monitoramento", mono, r.soMonitoramento === "nenhum", "is_monitor_only");

    if (r.total > 1) {
      linha(dl, "Faixa prevista na peça", num(r.temperatura.min) + " a " + num(r.temperatura.max) + " °C", false);
      linha(dl, "Mediana dos " + r.total + " pontos", num(r.temperatura.mediana) + " °C", false,
        "Valor central, só informativo: não decide o estado da peça, que segue o ponto mais crítico");
    }
    caixa.appendChild(dl);
  }

  // Mesma régua do painel do ponto: onde a previsão cai contra o limite.
  function medidor(caixa, p, rampa) {
    if (p.is_monitor_only) return;
    var escala = 1.6;
    var g = el("div", "gauge");
    var cheio = el("div", "gauge__fill");
    cheio.style.width = (Math.max(0, Math.min(1, p.temperatura_prevista_c / (p.limit_c * escala))) * 100).toFixed(1) + "%";
    cheio.style.background = corDoPonto(p, rampa);
    g.appendChild(cheio);
    var marca = el("div", "gauge__mark");
    marca.style.left = (100 / escala).toFixed(1) + "%";
    g.appendChild(marca);
    var tag = el("span", "gauge__tag", "limite");
    tag.style.left = "calc(" + (100 / escala).toFixed(1) + "% + 5px)";
    g.appendChild(tag);
    caixa.appendChild(g);
  }

  /* Composição da peça pelos estados que já vieram no dado. Barra empilhada
     com rótulo numérico ao lado: a cor nunca é o único canal. */
  function composicao(caixa, r) {
    if (r.total < 2) return;
    caixa.appendChild(el("h4", "part__sub", "Composição"));
    var barra = el("div", "part__bar");
    barra.setAttribute("role", "img");
    var partes = [];
    ESTADOS.concat(["monitoramento"]).forEach(function (e) {
      var n = r.contagem[e];
      if (!n) return;
      var seg = el("span", "part__seg part__seg--" + e);
      seg.style.flexGrow = String(n);
      barra.appendChild(seg);
      partes.push(n + " " + ROTULO_CURTO[e]);
    });
    barra.setAttribute("aria-label", "Pontos da peça por estado: " + partes.join(", "));
    caixa.appendChild(barra);
    caixa.appendChild(el("p", "part__legend", partes.join(" · ")));
  }

  function listaDePontos(caixa, r, op) {
    caixa.appendChild(el("h4", "part__sub", plural(r.total, "Ponto nesta peça", "Pontos nesta peça")));
    var lista = el("ol", "part__list");
    r.classificados.concat(r.monitorados).forEach(function (p) {
      var item = el("li");
      var b = el("button", "part__item");
      b.type = "button";
      if (p.measurement_id === op.pontoSel) b.setAttribute("aria-current", "true");
      b.appendChild(glifo(p, op.rampa));
      b.appendChild(el("span", "part__item-name", p.TC_Name));
      var num = el("span", "part__item-num", num(p.temperatura_prevista_c) + " °C");
      num.appendChild(el("small", p.is_monitor_only ? null : (p.margem_c < 0 ? "is-neg" : null),
        p.is_monitor_only ? "sem limite" : "folga " + sinal(p.margem_c, 1)));
      b.appendChild(num);
      b.addEventListener("click", function () { if (op.aoEscolherPonto) op.aoEscolherPonto(p); });
      item.appendChild(b);
      lista.appendChild(item);
    });
    caixa.appendChild(lista);
  }

  /* `sel` é null (nada escolhido), { semDado: peça } ou { resumo }. */
  function desenhar(caixa, sel, op) {
    op = op || {};
    caixa.innerHTML = "";
    if (!sel) { vazio(caixa); return; }
    if (sel.semDado) { semDado(caixa, sel.semDado, op.aoLimpar); return; }

    var r = sel.resumo, z = r.zona;
    cabecalho(caixa, z.nome,
      z.area + (z.sub ? " · " + z.sub : "") + " · " + plural(r.total, "ponto", "pontos"),
      op.aoLimpar);
    faixaDeEstado(caixa, r, op.rampa);
    linhasDaReferencia(caixa, r, op.dados);
    medidor(caixa, r.referencia, op.rampa);
    composicao(caixa, r);
    listaDePontos(caixa, r, op);
    caixa.appendChild(el("p", "legend-note",
      "Mesmos valores da tabela. Os filtros não recortam a peça."));
  }

  /* ----- Modo diferença -----
     Mesma peça, outra pergunta: quanto cada termopar muda de A para B. As
     linhas vêm de DIFF_TERMICO.diferenca, com `a`, `b` e `diferenca_c`
     prontos; aqui só se recorta a zona e se escolhe o ponto de maior
     variação. Estado e limite não entram: diferença não é risco. */

  function mediana(v) {
    var s = v.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function resumirDiff(zona, linhas, limiar) {
    var da = FOGAO.pontosDaZona(zona, linhas);
    var ref = null;
    da.forEach(function (l) { if (!ref || Math.abs(l.diferenca_c) > Math.abs(ref.diferenca_c)) ref = l; });
    var contagem = { mais_quente: 0, mais_frio: 0, igual: 0 };
    da.forEach(function (l) {
      var d = l.diferenca_c;
      contagem[Math.abs(d) <= limiar ? "igual" : d > 0 ? "mais_quente" : "mais_frio"] += 1;
    });
    var ds = da.map(function (l) { return l.diferenca_c; });
    return {
      zona: zona,
      linhas: da,
      total: da.length,
      referencia: ref,
      contagem: contagem,
      diferenca: da.length ? { min: Math.min.apply(null, ds), max: Math.max.apply(null, ds), mediana: mediana(ds) } : null
    };
  }

  function corDaDiferenca(d, escala) {
    var rgb = FOGAO.corDaRampa(FOGAO.RAMPA_DIFF,
      FOGAO.normalizadorDivergente(escala.extremo, escala.limiar).normalizar(d));
    return "rgb(" + rgb.join(",") + ")";
  }

  function textoDiferenca(d, limiar) {
    return Math.abs(d) <= limiar ? "sem diferença relevante" : d > 0 ? "mais quente em B" : "mais frio em B";
  }

  function trio(caixa, l, op) {
    var g = el("dl", "part__trio");
    function celula(rotulo, valor, classe, dica) {
      var c = el("div", "part__trio-cel" + (classe ? " " + classe : ""));
      var dt = el("dt", null, rotulo);
      if (dica) dt.title = dica;
      c.appendChild(dt);
      var dd = el("dd", null, valor);
      c.appendChild(dd);
      g.appendChild(c);
      return dd;
    }
    celula("A · " + op.rotuloA, graus(l.a), null, "Temperatura prevista na configuração A");
    celula("B · " + op.rotuloB, graus(l.b), null, "Temperatura prevista na configuração B");
    var dd = celula("Diferença B − A", sinal(l.diferenca_c) + " °C", "part__trio-cel--dif", "Temperatura de B menos temperatura de A");
    var amostra = el("span", "part__trio-cor");
    amostra.style.background = corDaDiferenca(l.diferenca_c, op.escala);
    amostra.setAttribute("aria-hidden", "true");
    dd.insertBefore(amostra, dd.firstChild);
    caixa.appendChild(g);
    caixa.appendChild(el("p", "part__trio-nota", textoDiferenca(l.diferenca_c, op.escala.limiar)));
  }

  function listaDiff(caixa, r, op) {
    caixa.appendChild(el("h4", "part__sub", plural(r.total, "Ponto nesta peça", "Pontos nesta peça")));
    var lista = el("ol", "part__list");
    r.linhas.slice().sort(function (x, y) { return Math.abs(y.diferenca_c) - Math.abs(x.diferenca_c); }).forEach(function (l) {
      var item = el("li");
      var linha = el("div", "part__item part__item--dif");
      if (r.referencia && l.measurement_id === r.referencia.measurement_id) linha.setAttribute("aria-current", "true");
      var cor = el("span", "part__trio-cor");
      cor.style.background = corDaDiferenca(l.diferenca_c, op.escala);
      cor.setAttribute("aria-hidden", "true");
      linha.appendChild(cor);
      linha.appendChild(el("span", "part__item-name", l.TC_Name));
      var num = el("span", "part__item-num", sinal(l.diferenca_c, 1) + " °C");
      num.appendChild(el("small", null, num(l.a) + " → " + num(l.b)));
      linha.appendChild(num);
      item.appendChild(linha);
      lista.appendChild(item);
    });
    caixa.appendChild(lista);
  }

  /* `sel` como em `desenhar`, com `{ resumo }` vindo de resumirDiff.
     `op`: rotuloA, rotuloB, escala ({ extremo, limiar }) e aoLimpar. */
  function desenharDiff(caixa, sel, op) {
    op = op || {};
    if (!sel || sel.semDado) { desenhar(caixa, sel, op); return; }
    caixa.innerHTML = "";
    var r = sel.resumo, z = r.zona;
    cabecalho(caixa, z.nome,
      z.area + (z.sub ? " · " + z.sub : "") + " · " + plural(r.total, "ponto", "pontos"),
      op.aoLimpar);

    // O que ocupa o lugar da faixa de estado: dizer que aqui não há estado.
    caixa.appendChild(el("p", "part__modo", "Diferença B − A · variação entre previsões, não estado de risco"));

    if (r.total > 1) {
      var nota = el("p", "part__ref");
      nota.appendChild(document.createTextNode("Ponto de maior variação: "));
      nota.appendChild(el("b", null, r.referencia.TC_Name));
      caixa.appendChild(nota);
    }
    trio(caixa, r.referencia, op);

    if (r.total > 1) {
      var dl = el("dl", "detail__rows");
      linha(dl, "Faixa da diferença na peça", sinal(r.diferenca.min, 1) + " a " + sinal(r.diferenca.max, 1) + " °C", false);
      linha(dl, "Mediana dos " + r.total + " pontos", sinal(r.diferenca.mediana, 1) + " °C", false);
      caixa.appendChild(dl);
      var c = r.contagem, partes = [];
      if (c.mais_quente) partes.push(c.mais_quente + " mais quente" + (c.mais_quente > 1 ? "s" : "") + " em B");
      if (c.mais_frio) partes.push(c.mais_frio + " mais frio" + (c.mais_frio > 1 ? "s" : "") + " em B");
      if (c.igual) partes.push(c.igual + " sem diferença relevante");
      caixa.appendChild(el("p", "part__legend", partes.join(" · ")));
      listaDiff(caixa, r, op);
    }
    caixa.appendChild(el("p", "legend-note",
      "Diferença entre previsões, não entre simulações. Até ±" + num(op.escala.limiar) + " °C conta como sem diferença."));
  }

  return {
    resumir: resumir,
    corDoPonto: corDoPonto,
    desenhar: desenhar,
    resumirDiff: resumirDiff,
    desenharDiff: desenharDiff,
    corDaDiferenca: corDaDiferenca
  };
})();
