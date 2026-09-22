/* Teste do diff térmico 3D no navegador, sobre a tela de comparação real.
 *
 * Abrir dashboard/comparacao.html, colar este arquivo no console e esperar.
 * Escolhe cada par pelos cartões do catálogo (a mesma bandeja do usuário) e
 * confere, nos dois pares — um de diferença pequena, outro grande:
 *   - a cor de cada termopar na rampa divergente, proporcional à diferença;
 *   - a legenda com os extremos e a maior diferença reais;
 *   - o painel de cada peça com A, B e diferença iguais aos do dado;
 *   - a alternância para o modo absoluto e de volta.
 */

(async function () {
  "use strict";

  var host = document.getElementById("cmp3d-3d");
  var painel = document.getElementById("cmp3d-peca");
  var D = DADOS_COMPARACAO;
  var resultados = [];
  var PARES = [["CFG-23", "CFG-25", "pequena"], ["CFG-29", "CFG-32", "grande"]];

  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function checar(caso, ok, detalhe) { resultados.push({ caso: caso, ok: !!ok, detalhe: detalhe || "" }); }
  function dep() { return host._fogao3d._depurar; }
  function texto(sel) { var n = document.querySelector(sel); return n ? n.textContent : ""; }
  function cfg(id) { return D.configuracoes.filter(function (c) { return c.id === id; })[0]; }
  function graus(v) { return v.toFixed(2) + " °C"; }
  function sinal(v) { return (v < 0 ? "−" : "+") + Math.abs(v).toFixed(2) + " °C"; }

  async function assentar() { for (var i = 0; i < 40; i++) { dep().quadro(); await espera(12); } }

  async function escolherPar(a, b) {
    document.getElementById("cfg-clear").click();
    document.querySelector(".cfg-card[data-id='" + a + "']").click();
    document.querySelector(".cfg-card[data-id='" + b + "']").click();
    await assentar();
  }

  function modo(m) { document.querySelector("#cmp3d-modo [data-modo='" + m + "']").click(); }

  async function clicarZona(z) {
    dep().quadro();
    var t = dep().telaDaZona(z);
    if (!t) return false;
    var o = { bubbles: true, clientX: t.x, clientY: t.y, pointerId: 1, pointerType: "mouse", button: 0, isPrimary: true };
    host.dispatchEvent(new PointerEvent("pointerdown", Object.assign({ buttons: 1 }, o)));
    host.dispatchEvent(new PointerEvent("pointerup", Object.assign({ buttons: 0 }, o)));
    await espera(40);
    return true;
  }

  function trio() {
    return Array.prototype.map.call(painel.querySelectorAll(".part__trio-cel dd"), function (dd) { return dd.textContent; });
  }

  for (var k = 0; k < PARES.length; k++) {
    var A = cfg(PARES[k][0]), B = cfg(PARES[k][1]), nome = PARES[k][2] + " (" + A.id + " × " + B.id + ")";
    await escolherPar(A.id, B.id);
    modo("diferenca");
    await assentar();

    var linhas = DIFF_TERMICO.diferenca(D, A, B), esc = DIFF_TERMICO.escala(linhas);
    var n = FOGAO.normalizadorDivergente(esc.extremo, esc.limiar);

    checar(nome + ": rótulo do modo", /Modo diferença/.test(texto("#cmp3d-rotulo")) &&
      texto("#cmp3d-rotulo").indexOf(B.id + " (B)") >= 0 && texto("#cmp3d-rotulo").indexOf(A.id + " (A") >= 0, texto("#cmp3d-rotulo"));

    // Cor de cada termopar: posição na rampa proporcional à diferença.
    var erros = 0;
    linhas.forEach(function (l) {
      var c = dep().campoNoPonto(l.measurement_id);
      if (!c || c.rampa !== "diferenca" || Math.abs(c.v - l.diferenca_c) > 1e-9 || Math.abs(c.t - n.normalizar(l.diferenca_c)) > 1e-9) erros += 1;
    });
    checar(nome + ": 78 termopares na posição certa da rampa", erros === 0, erros + " divergentes");

    var maior = linhas.reduce(function (m, l) { return Math.abs(l.diferenca_c) > Math.abs(m.diferenca_c) ? l : m; });
    var cm = dep().campoNoPonto(maior.measurement_id);
    checar(nome + ": maior diferença perto da ponta", Math.abs(cm.t - 0.5) >= 0.5 * Math.abs(maior.diferenca_c) / esc.extremo - 1e-9 &&
      Math.abs(maior.diferenca_c) / esc.extremo > 0.4, "t = " + cm.t.toFixed(3) + ", extremo " + esc.extremo);

    // Legenda: extremos e maior diferença do par.
    var marcas = Array.prototype.map.call(document.querySelectorAll("#cmp3d-marcas b"), function (b) { return b.textContent; });
    checar(nome + ": legenda com ±extremo", marcas.length === 5 && marcas[0] === "−" + esc.extremo.toFixed(1) && marcas[2] === "0" && marcas[4] === "+" + esc.extremo.toFixed(1), marcas.join(" "));
    checar(nome + ": legenda cita a maior diferença real", texto(".cmp3d__legenda-nota").indexOf(maior.TC_Name) >= 0, texto(".cmp3d__legenda-nota"));

    // Painel: A, B e diferença em cada peça que o clique alcança.
    var testadas = 0;
    for (var z = 0; z < FOGAO.ZONAS.length; z++) {
      var zona = FOGAO.ZONAS[z];
      if (!(await clicarZona(zona.id))) continue;
      var r = PAINEL_PECA.resumirDiff(zona, linhas, esc.limiar), ref = r.referencia;
      var t = trio();
      checar(nome + " · " + zona.id + ": A, B e diferença",
        t.length === 3 && t[0] === graus(ref.a) && t[1] === graus(ref.b) && t[2] === sinal(ref.diferenca_c),
        t.join(" | ") + " esperado " + [graus(ref.a), graus(ref.b), sinal(ref.diferenca_c)].join(" | "));
      checar(nome + " · " + zona.id + ": sem estado de risco no painel", !painel.querySelector(".part__state"));
      testadas += 1;
      await clicarZona(zona.id); // solta
    }
    checar(nome + ": peças testadas", testadas >= 8, testadas + " peças");

    // Absoluto: temperatura de A, depois de B, na rampa do campo.
    var painel3d = document.getElementById("cmp3d-panel");
    var alturaDiff = painel3d.offsetHeight, topoDiff = host.getBoundingClientRect().top - painel3d.getBoundingClientRect().top;
    modo("absoluto");
    checar(nome + ": trocar de modo não move o 3D nem muda a altura", painel3d.offsetHeight === alturaDiff &&
      host.getBoundingClientRect().top - painel3d.getBoundingClientRect().top === topoDiff);
    // A escolha A/B do absoluto persiste entre modos: o teste começa sempre por A.
    document.querySelector("#cmp3d-qual button:first-child").click();
    await assentar();
    var i0 = D.pontos.map(function (p) { return p.id; }).indexOf(maior.measurement_id);
    var ca = dep().campoNoPonto(maior.measurement_id);
    checar(nome + ": absoluto mostra A", /Modo absoluto/.test(texto("#cmp3d-rotulo")) && ca.rampa === "absoluto" && ca.v === A.t[i0], ca && ca.v);
    document.querySelector("#cmp3d-qual button:last-child").click();
    await assentar();
    var cb = dep().campoNoPonto(maior.measurement_id);
    checar(nome + ": absoluto mostra B", cb.v === B.t[i0] && texto("#cmp3d-rotulo").indexOf(B.id + " (B)") >= 0, cb && cb.v);
    checar(nome + ": legenda do absoluto é temperatura", /Temperatura prevista/.test(texto("#cmp3d-legenda")));
    document.querySelector("#cmp3d-qual button:first-child").click();
    modo("diferenca");
    await assentar();
    checar(nome + ": volta ao modo diferença", dep().campoNoPonto(maior.measurement_id).rampa === "diferenca");
  }

  var falhas = resultados.filter(function (r) { return !r.ok; });
  console.table(falhas.length ? falhas : resultados.slice(-6));
  console.log(resultados.length - falhas.length + "/" + resultados.length + " casos ok");
  return { total: resultados.length, falhas: falhas };
})();
