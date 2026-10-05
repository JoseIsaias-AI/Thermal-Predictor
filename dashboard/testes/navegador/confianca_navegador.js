/* Teste do cartão de confiança e do halo de incerteza no navegador.
 *
 * Abrir dashboard/triagem.html, colar este arquivo no console e esperar a
 * tabela. Os pontos são escolhidos pela linha da tabela, como o usuário faz.
 * Cobre um ponto de cada nível calculado, um monitorado (sem limite) e o de nome
 * mais longo, e aperta o painel para ver o layout se acomodar.
 */

(async function () {
  "use strict";

  var host = document.getElementById("heat-3d");
  var d = host._fogao3d._depurar;
  var detalhe = document.getElementById("detail");
  var resultados = [];
  var PX_MARCA_CARTAO = 4.4, TAMANHO_MARCA_PX = 5.5;

  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function checar(caso, condicao, detalheTexto) {
    resultados.push({ caso: caso, ok: !!condicao, detalhe: detalheTexto === undefined ? "" : String(detalheTexto) });
  }
  function perto(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-6); }

  var TODOS = DADOS_TRIAGEM.pontos.concat(DADOS_TRIAGEM.monitoramento);

  function linhaDe(p) {
    var linhas = document.querySelectorAll("#screening-body tr, #monitoring-body tr");
    return Array.prototype.filter.call(linhas, function (tr) {
      var c = tr.cells[0] ? tr.cells[0].textContent : "";
      return c.indexOf(p.TC_Name) >= 0 && c.indexOf(p.Key_Area) >= 0;
    })[0] || null;
  }

  // Nada do cartão pode vazar para fora dele, nem o cartão para fora do painel.
  function semVazamento(caixa) {
    var r = caixa.getBoundingClientRect(), vazou = [];
    Array.prototype.forEach.call(caixa.querySelectorAll("*"), function (el) {
      var e = el.getBoundingClientRect();
      if (e.width && (e.right > r.right + 0.5 || e.left < r.left - 0.5)) vazou.push(el.className.baseVal !== undefined ? el.className.baseVal : el.className);
    });
    if (caixa.scrollWidth > caixa.clientWidth + 1) vazou.push("scroll horizontal");
    return vazou;
  }

  function visivel(el) {
    if (!el) return false;
    var s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0 && r.width > 0 && r.height > 0;
  }

  // Um ponto classificado de cada nível, um monitorado e o nome mais longo.
  var casos = [];
  CONFIANCA.ORDEM.forEach(function (nivel) {
    var p = DADOS_TRIAGEM.pontos.filter(function (x) { return CONFIANCA.doPonto(x).nivel === nivel; })[0];
    casos.push({ titulo: "nível " + nivel, p: p });
  });
  casos.push({ titulo: "monitorado", p: DADOS_TRIAGEM.monitoramento[0] });
  casos.push({ titulo: "nome mais longo", p: TODOS.slice().sort(function (a, b) { return b.TC_Name.length - a.TC_Name.length; })[0] });

  // Retrato do estado de risco antes de qualquer seleção.
  function retratoDoRisco() {
    return JSON.stringify({
      linhas: Array.prototype.map.call(document.querySelectorAll("#screening-body tr"), function (tr) { return tr.className.replace(/\s*row--selected/, ""); }),
      kpis: document.getElementById("kpis").textContent,
      dados: TODOS.map(function (p) { return [p.measurement_id, p.estado, p.margem_c]; })
    });
  }
  var riscoAntes = retratoDoRisco();

  host.scrollIntoView({ block: "center" });
  var raiosVistos = {};

  for (var i = 0; i < casos.length; i++) {
    var caso = casos[i], p = caso.p, conf = CONFIANCA.doPonto(p), nome = caso.titulo + " (" + p.TC_Name + ")";
    var tr = linhaDe(p);
    checar(nome + ": linha na tabela", !!tr);
    if (!tr) continue;
    tr.click();
    await espera(40);

    var cartao = detalhe.querySelector(".conf");
    checar(nome + ": cartão renderizado", visivel(cartao));
    if (!cartao) continue;

    // Temperatura prevista junto do nível.
    checar(nome + ": temperatura no cartão", cartao.querySelector(".conf__temp").textContent === p.temperatura_prevista_c.toFixed(2) + " °C",
      cartao.querySelector(".conf__temp").textContent);
    checar(nome + ": nível no cartão", cartao.querySelector(".conf__nivel").textContent === conf.rotulo, cartao.querySelector(".conf__nivel").textContent);
    var indice = CONFIANCA.ORDEM.indexOf(conf.nivel);
    checar(nome + ": passos acesos", cartao.querySelectorAll(".conf__passo.is-on").length === (indice < 0 ? 0 : CONFIANCA.ORDEM.length - indice));

    // Faixa provável quando há MAE, e nenhum rótulo de valor ilustrativo.
    checar(nome + ": faixa provável", !conf.faixa_c || !!cartao.querySelector(".conf__faixa"));
    checar(nome + ": sem rótulo ilustrativo", !/ilustrativo|preliminar/i.test(cartao.textContent));
    checar(nome + ": nota diz que não altera o risco", /não altera o estado de risco/i.test(cartao.querySelector(".conf__nota").textContent));

    // Estado de risco intacto, ao lado do cartão.
    var estado = detalhe.querySelector(".detail__state span:last-child").textContent;
    checar(nome + ": estado de risco inalterado", estado === (p.is_monitor_only ? "Limite não declarado" : p.estado_rotulo), estado);
    checar(nome + ": classe do estado inalterada", detalhe.querySelector(".detail__state").classList.contains("detail__state--" + (p.is_monitor_only ? "mono" : p.estado)));

    // Halo do cartão: mesmo raio do contrato, em px de marcador.
    var raio = CONFIANCA.raioHalo(conf);
    var r2d = +cartao.querySelector(".conf__halo").getAttribute("r");
    checar(nome + ": halo do cartão proporcional", perto(r2d, raio * PX_MARCA_CARTAO, 0.06), r2d);
    var glifo = cartao.querySelector(".conf__glifo").getBoundingClientRect();
    checar(nome + ": halo cabe no glifo", r2d * 2 <= glifo.width + 0.5, r2d * 2 + " > " + glifo.width);

    // Halo no 3D, no ponto selecionado.
    d.quadro();
    var h = d.halos().sel;
    checar(nome + ": halo 3D presente", !!h);
    if (h) {
      checar(nome + ": halo 3D com o raio do contrato", perto(h.raio, raio), h.raio);
      // 1% de folga: o canvas mede altura inteira, o retângulo da página, fracionária.
      checar(nome + ": halo 3D na tela proporcional ao raio", perto(h.px, TAMANHO_MARCA_PX * raio, TAMANHO_MARCA_PX * raio * 0.01), h.px.toFixed(3));
      raiosVistos[conf.nivel] = h.px;
    }

    // Layout: largura normal e painel espremido.
    checar(nome + ": nada vaza no painel", semVazamento(cartao).length === 0, semVazamento(cartao).join(","));
    var larguraOriginal = detalhe.style.width;
    detalhe.style.width = "190px";
    await espera(20);
    var aperto = semVazamento(cartao);
    checar(nome + ": nada vaza com o painel a 190 px", aperto.length === 0, aperto.join(","));
    detalhe.style.width = larguraOriginal;
  }

  checar("Halo cresce com a incerteza: alta < média < baixa",
    raiosVistos.alta < raiosVistos.media && raiosVistos.media < raiosVistos.baixa, JSON.stringify(raiosVistos));

  // Sem seleção, sem halo.
  host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await espera(30);
  d.quadro();
  checar("Esc: halo some com a seleção", d.halos().sel === null);
  checar("Esc: cartão some", !detalhe.querySelector(".conf"));

  checar("Tabela, KPIs e estados iguais aos de antes das seleções", retratoDoRisco() === riscoAntes);

  console.table(resultados);
  var falhas = resultados.filter(function (x) { return !x.ok; });
  console.log(falhas.length ? falhas.length + " falha(s)" : "Todos os " + resultados.length + " casos passaram");
  return resultados;
})();
