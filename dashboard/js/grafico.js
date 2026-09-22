/* Primitivas dos desenhos em SVG, comuns à triagem e à comparação.
 *
 * Nenhuma biblioteca de gráficos entra no painel: o desenho é feito à mão,
 * como em js/fogao.js, e por isso a página continua rodando sem rede e sem
 * ferramenta de build.
 *
 * O que mora aqui é o que as duas telas precisam ver igual. O eixo de folga
 * é o caso central: a fronteira do limite no zero e a banda de incerteza
 * sombreada têm de ter a mesma aparência nas duas, ou quem aprende a ler uma
 * não lê a outra. Duplicar esse desenho seria duplicar a chance de as duas
 * saírem de sincronia.
 */

var GRAFICO = (function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k]));
    }
    return n;
  }

  function texto(x, y, conteudo, classe, ancora) {
    var t = el("text", {
      x: x, y: y,
      "class": classe || "ax-text",
      "text-anchor": ancora || "start"
    });
    t.textContent = conteudo;
    return t;
  }

  function limpar(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function corta(t, n) {
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }

  /* Passo do eixo que não passa de oito marcas: mais que isso e os rótulos
     começam a se encostar; menos, e a escala deixa de ser legível. */
  function passoDoEixo(faixa) {
    var alvos = [0.05, 0.1, 0.2, 0.25, 0.5, 1];
    for (var k = 0; k < alvos.length; k++) if (faixa / alvos[k] <= 8) return alvos[k];
    return 1;
  }

  /* Eixo de folga relativa ao limite. Devolve a função de escala, para que o
     chamador só se preocupe com as marcas.

     A banda de incerteza é desenhada como região, e não anotada como rótulo:
     a fronteira de decisão fica visível sem custar uma legenda. */
  function eixoDeFolga(svg, o) {
    var lo = o.lo, hi = o.hi;

    function X(v) { return o.x0 + (v - lo) / (hi - lo) * o.largura; }

    if (o.tolerancia && hi > 0 && lo < o.tolerancia) {
      var a = Math.max(lo, 0), b = Math.min(hi, o.tolerancia);
      svg.appendChild(el("rect", {
        x: X(a), y: o.topo, width: X(b) - X(a), height: o.base - o.topo,
        "class": "ax-band"
      }));
    }

    var passo = passoDoEixo(hi - lo);
    for (var v = Math.ceil(lo / passo) * passo; v <= hi; v += passo) {
      var vr = Math.abs(v) < 1e-9 ? 0 : v;
      svg.appendChild(el("line", {
        x1: X(vr), y1: o.topo, x2: X(vr), y2: o.base,
        "class": vr === 0 ? "ax-zero" : "ax-line"
      }));
      svg.appendChild(texto(X(vr), o.yRotulo,
        vr === 0 ? "0% · limite" : (vr * 100).toFixed(0).replace("-", "−") + "%",
        vr === 0 ? "ax-text ax-text--forte" : "ax-text", "middle"));
    }

    return X;
  }

  /* Balão preso à marca sob o ponteiro. Medir a posição do próprio retângulo
     sensível dispensa a matriz do SVG e sobrevive à rolagem horizontal, que
     é onde a conta manual erra. */
  function balao(quadro, caixa) {
    function esconder() { caixa.dataset.on = "0"; }

    function mostrar(alvo, html) {
      var r = alvo.getBoundingClientRect();
      var q = quadro.getBoundingClientRect();

      caixa.innerHTML = html;
      caixa.dataset.on = "1";

      var y = r.top + r.height / 2 - q.top;
      // Vira para baixo quando não cabe acima, para nunca cobrir a marca.
      var acima = y > q.height * 0.28;
      caixa.classList.toggle("tip--acima", acima);
      caixa.classList.toggle("tip--abaixo", !acima);
      caixa.style.top = y + "px";

      var w = caixa.getBoundingClientRect().width;
      var x = r.left + r.width / 2 - q.left;
      caixa.style.left = Math.max(w / 2 + 6, Math.min(q.width - w / 2 - 6, x)) + "px";
    }

    return { mostrar: mostrar, esconder: esconder };
  }

  /* Empacotamento em faixas: marcas com valores próximos se afastam na
     vertical em vez de se cobrirem. Alterna acima e abaixo da linha central,
     de modo que o enxame fique simétrico e o centro continue sendo o valor. */
  function enxame(valores, distancia, alturaDaFaixa) {
    // A varredura precisa correr da esquerda para a direita; a ordenação é
    // feita aqui para o chamador não precisar saber disso.
    var ordem = valores.map(function (x, i) { return i; })
      .sort(function (a, b) { return valores[a] - valores[b]; });

    var ocupadas = [], saida = new Array(valores.length);
    ordem.forEach(function (i) {
      var x = valores[i], k = 0;
      for (; k < ocupadas.length; k++) {
        if (x - ocupadas[k] >= distancia) break;
      }
      ocupadas[k] = x;
      var degrau = Math.ceil(k / 2) * alturaDaFaixa;
      saida[i] = k % 2 === 1 ? -degrau : degrau;
    });
    return saida;
  }

  return {
    el: el,
    texto: texto,
    limpar: limpar,
    corta: corta,
    passoDoEixo: passoDoEixo,
    eixoDeFolga: eixoDeFolga,
    balao: balao,
    enxame: enxame
  };
})();
