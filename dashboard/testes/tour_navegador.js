/* Teste do tour pelos pontos críticos no navegador, sobre a triagem real.
 *
 * Abrir dashboard/triagem.html, colar este arquivo no console e esperar a
 * tabela. Roda três configurações: a da triagem (muitas paradas), um recorte
 * com só dois pontos críticos e um sem nenhum. Os recortes trocam a lista de
 * DADOS_TRIAGEM.pontos por uma cópia filtrada, sem mexer no estado de ponto
 * nenhum, e a original volta no fim.
 */

(async function () {
  "use strict";

  var host = document.getElementById("heat-3d");
  var d = host._fogao3d._depurar;
  var resultados = [];
  var original = DADOS_TRIAGEM.pontos;

  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Avança o laço de desenho à mão: com a aba em segundo plano o navegador não chama requestAnimationFrame.
  async function assentar() {
    for (var i = 0; i < 90; i++) { d.quadro(); await espera(16); }
  }

  function checar(caso, condicao, detalhe) {
    resultados.push({ caso: caso, ok: !!condicao, detalhe: detalhe || "" });
  }

  function clicar(id) { document.getElementById(id).click(); }
  function texto(sel) { var n = document.querySelector(sel); return n ? n.textContent : null; }
  function status() { return document.getElementById("tour-status").textContent; }

  function distanciaDoCentro(id) {
    var s = d.naTelaDe(id), r = host.getBoundingClientRect();
    return s ? Math.hypot(s.x - (r.left + r.width / 2), s.y - (r.top + r.height / 2)) : Infinity;
  }

  function mesmaCamera(a, b) {
    return Math.abs(a.az - b.az) + Math.abs(a.el - b.el) + Math.abs(a.dist - b.dist) +
      Math.hypot(a.t.x - b.t.x, a.t.y - b.t.y, a.t.z - b.t.z) < 1e-3;
  }

  async function percorrer(nome, esperado) {
    var lista = TOUR.paradas(DADOS_TRIAGEM);
    checar(nome + ": " + esperado + " paradas", lista.length === esperado, "veio " + lista.length);

    // O 3D não se move na página: nem ao iniciar, nem a cada parada, nem ao encerrar.
    var heat = document.getElementById("heat");
    function posicao() { return Math.round(host.getBoundingClientRect().top - heat.getBoundingClientRect().top) + "/" + document.getElementById("tour-bar").offsetHeight; }
    var posicoes = {};
    posicoes[posicao()] = true;

    clicar("tour-iniciar");
    await assentar();
    checar(nome + ": controles visíveis", !document.getElementById("tour-ctrl").hidden);
    clicar("tour-pausa");
    posicoes[posicao()] = true;

    for (var i = 0; i < lista.length; i++) {
      var p = lista[i];
      if (i > 0) {
        var antes = d.camera().atual;
        clicar("tour-proximo");
        // Um quadro depois do pedido a câmera está no meio do caminho, não no destino.
        await espera(120);
        d.quadro();
        var meio = d.camera();
        checar(nome + " #" + (i + 1) + ": transição animada", meio.transicao &&
          !mesmaCamera(meio.atual, antes) && !mesmaCamera(meio.atual, meio.alvo));
        await assentar();
      }
      checar(nome + " #" + (i + 1) + ": status", status().indexOf("Parada " + (i + 1) + " de " + lista.length) === 0, status());
      checar(nome + " #" + (i + 1) + ": painel do ponto sem clique", texto("#detail .detail__name") === p.TC_Name, texto("#detail .detail__name"));
      checar(nome + " #" + (i + 1) + ": painel da peça sem clique", texto("#part-detail .detail__name") === FOGAO.zonaDoPonto(p).nome, texto("#part-detail .detail__name"));
      var dc = distanciaDoCentro(p.measurement_id);
      checar(nome + " #" + (i + 1) + ": câmera pousa no ponto", dc < 24, dc.toFixed(1) + " px do centro");
      // Termopar na face interna (os da traseira) não pode ficar atrás da própria peça.
      var obs = d.obstrucoes(p.measurement_id);
      checar(nome + " #" + (i + 1) + ": nenhuma peça opaca na frente", obs === 0, p.TC_Name + ": " + obs);
      posicoes[posicao()] = true;
    }

    checar(nome + ": próximo desativado na última", document.getElementById("tour-proximo").disabled);

    clicar("tour-encerrar");
    await assentar();
    posicoes[posicao()] = true;
    checar(nome + ": 3D e barra não se movem", Object.keys(posicoes).length === 1, Object.keys(posicoes).join(" | "));
    var cam = d.camera().atual;
    checar(nome + ": encerrar volta à isométrica",
      texto("#heat-preset [aria-pressed='true']") === "Isométrica" && Math.abs(cam.el - 24 * Math.PI / 180) < 1e-3);
    checar(nome + ": encerrar solta a seleção", texto("#detail .detail__name") === null);
    checar(nome + ": barra volta ao início", !document.getElementById("tour-iniciar").hidden && document.getElementById("tour-ctrl").hidden);
  }

  try {
    await percorrer("triagem", DADOS_TRIAGEM.pontos.filter(function (p) { return p.estado !== "dentro_do_limite"; }).length);

    // Poucos: o primeiro de cada estado crítico e todos os de dentro.
    var acima = original.filter(function (p) { return p.estado === "acima_do_limite"; });
    var banda = original.filter(function (p) { return p.estado === "banda_de_incerteza"; });
    var dentro = original.filter(function (p) { return p.estado === "dentro_do_limite"; });
    DADOS_TRIAGEM.pontos = [banda[0], acima[acima.length - 1]].concat(dentro);
    await percorrer("poucos", 2);
    var lista = TOUR.paradas(DADOS_TRIAGEM);
    checar("poucos: acima antes de banda", lista[0] === acima[acima.length - 1] && lista[1] === banda[0]);

    // Nenhum: só pontos dentro do limite.
    DADOS_TRIAGEM.pontos = dentro;
    clicar("tour-iniciar");
    await assentar();
    checar("nenhum: mensagem em vez de tour", /não há paradas/.test(status()), status());
    checar("nenhum: tour não começa", document.getElementById("tour-ctrl").hidden && texto("#detail .detail__name") === null);
  } finally {
    DADOS_TRIAGEM.pontos = original;
  }

  var falhas = resultados.filter(function (r) { return !r.ok; });
  console.table(falhas.length ? falhas : resultados.slice(-6));
  console.log(resultados.length - falhas.length + "/" + resultados.length + " casos ok");
  return { total: resultados.length, falhas: falhas };
})();
