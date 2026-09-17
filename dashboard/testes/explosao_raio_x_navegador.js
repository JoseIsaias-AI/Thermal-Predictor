/* Teste do slider de explosão, do raio-X e do Restaurar no navegador.
 *
 * Abrir dashboard/triagem.html, colar este arquivo no console e esperar a
 * tabela. Controles mexidos pelos eventos da página e cliques como
 * PointerEvents no palco 3D, resolvidos pelo mesmo raycasting do mouse.
 */

(async function () {
  "use strict";

  var host = document.getElementById("heat-3d");
  var d = host._fogao3d._depurar;
  var painel = document.getElementById("part-detail");
  var slider = document.getElementById("heat-explode");
  var raioX = document.getElementById("heat-xray");
  var restaurar = document.getElementById("heat-reset");
  var resultados = [];
  var U = 0.01;

  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function assentarAnimacao() {
    for (var i = 0; i < 70; i++) { d.quadro(); await espera(20); }
  }

  function ponteiro(tipo, x, y) {
    host.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, buttons: tipo === "pointerup" ? 0 : 1, isPrimary: true }));
  }

  async function clicar(x, y) {
    ponteiro("pointerdown", x, y);
    ponteiro("pointerup", x, y);
    await espera(30);
  }

  function checar(caso, condicao, detalhe) {
    resultados.push({ caso: caso, ok: !!condicao, detalhe: detalhe === undefined ? "" : String(detalhe) });
  }

  function sel() { return d.realces().sel; }
  function nome() { var n = painel.querySelector(".detail__name"); return n ? n.textContent : null; }

  function mover(pct, soltar) {
    slider.value = pct;
    slider.dispatchEvent(new Event(soltar ? "change" : "input", { bubbles: true }));
  }

  function perto(a, b) { return Math.abs(a - b) < 1e-3; }

  // Posição de cada peça igual a ex · t, convertida para a cena como o viewport faz.
  function posicoesBatem(t) {
    var v = d.vista(), ruins = [];
    FOGAO.pecas({}).forEach(function (pc) {
      var p = v.pecas[pc.id];
      if (!perto(p.x, pc.ex[0] * U * t) || !perto(p.y, pc.ex[2] * U * t) || !perto(p.z, -pc.ex[1] * U * t)) ruins.push(pc.id);
    });
    return ruins;
  }

  async function clicarZona(zonaId) {
    d.quadro();
    var t = d.telaDaZona(zonaId);
    if (!t) return null;
    await clicar(t.x, t.y);
    return t;
  }

  host.scrollIntoView({ block: "center" });
  host._fogao3d.preset("isometrica");
  document.getElementById("heat-reset").click();
  await assentarAnimacao();

  // 1. Valor zero do slider: montado.
  checar("Zero: nenhuma peça deslocada", posicoesBatem(0).length === 0, posicoesBatem(0));

  // 2. Meio do curso: cada peça anda ex · 0,5, sem deformar.
  mover(50, true);
  await assentarAnimacao();
  checar("50%: explode desenhado", perto(d.vista().explode, 0.5), d.vista().explode);
  checar("50%: posição radial proporcional", posicoesBatem(0.5).length === 0, posicoesBatem(0.5));
  checar("50%: rótulo do slider", document.getElementById("heat-explode-valor").textContent === "50%");

  // 3. Clique em peça deslocada, com o slider parado no meio.
  var t = await clicarZona("coil-FL");
  checar("50%: Bobina FL alcançável", !!t);
  checar("50%: Bobina FL selecionada", sel() === "coil-FL", sel());
  checar("50%: painel da Bobina FL", nome() === "Bobina FL", nome());
  t = await clicarZona("knobBar");
  checar("50%: troca para manípulos", sel() === "knobBar" && nome() === "Painel de manípulos", sel());

  /* 4. O pixel que seleciona a placa fica sobre a malha deslocada: o raio vai
     contra a posição de agora, e a zona sai do ponto trazido de volta à peça
     montada. */
  checar("50%: placa IPC deslocada em z", d.vista().pecas.ipcBoard.y > 0.5, d.vista().pecas.ipcBoard.y);
  t = await clicarZona("ipcBoard");
  checar("50%: placa IPC selecionada na posição deslocada", !!t && sel() === "ipcBoard", sel());
  var sob = t && d.pecaSob(t.x, t.y);
  checar("50%: pixel resolve para a placa e a zona dela", !!sob && sob.id === "ipcBoard" && sob.zona === "ipcBoard", JSON.stringify(sob));

  // 5. Durante o arrasto: clique a cada passo, antes de a animação assentar.
  var certos = 0, tentativas = 0, emMovimento = 0;
  for (var pct = 20; pct <= 90; pct += 14) {
    mover(pct, false);
    for (var q = 0; q < 2; q++) { d.quadro(); await espera(16); }
    var z = tentativas % 2 ? "coil-RR" : "mainback";
    var tz = d.telaDaZona(z);
    if (!tz) continue;
    tentativas++;
    var vv = d.vista();
    if (Math.abs(vv.explode - vv.explodeAlvo) > 0.005) emMovimento++;
    await clicar(tz.x, tz.y);
    if (sel() === z) certos++;
  }
  mover(90, true);
  checar("Arrastando: cliques com o modelo ainda em movimento", tentativas > 0 && emMovimento > 0, emMovimento + "/" + tentativas);
  checar("Arrastando: toda seleção caiu na peça certa", certos === tentativas, certos + "/" + tentativas);

  // 6. Raio-X com o modelo montado: a casca e o vidro deixam o clique passar.
  restaurar.click();
  await assentarAnimacao();
  d.quadro();
  checar("Montado sem raio-X: bobina coberta pelo vidro", d.telaDaZona("coil-FL") === null);
  checar("Montado sem raio-X: soprador coberto pela casca", d.telaDaZona("blower") === null);
  raioX.click();
  await assentarAnimacao();
  var v = d.vista();
  var externas = FOGAO.pecas({}).filter(function (pc) { return pc.externa; });
  checar("Raio-X: botão marcado", raioX.getAttribute("aria-pressed") === "true");
  checar("Raio-X: externas transparentes", externas.every(function (pc) { return v.pecas[pc.id].opacidade < 0.2; }));
  checar("Raio-X: internas opacas", FOGAO.pecas({}).filter(function (pc) { return !pc.externa; }).every(function (pc) { return v.pecas[pc.id].opacidade === 1; }));
  checar("Raio-X: modelo continua montado", posicoesBatem(0).length === 0, posicoesBatem(0));
  t = await clicarZona("coil-FL");
  checar("Raio-X: Bobina FL selecionada através do vidro", sel() === "coil-FL" && nome() === "Bobina FL", sel());
  t = await clicarZona("blower");
  checar("Raio-X: soprador selecionado através da casca", sel() === "blower" && nome() === "Soprador (AC Blower)", sel());
  var mono = document.getElementById("filter-mono");
  mono.checked = false; mono.dispatchEvent(new Event("change"));
  t = await clicarZona("duct");
  checar("Raio-X: duto sob a cavidade selecionado", sel() === "duct", sel());
  mono.checked = true; mono.dispatchEvent(new Event("change"));

  // 7. Combinação: raio-X segue ligado com o slider no meio.
  mover(60, true);
  await assentarAnimacao();
  v = d.vista();
  checar("Combinado: raio-X mantido", v.raioX === true && raioX.getAttribute("aria-pressed") === "true");
  checar("Combinado: posição de 60%", posicoesBatem(0.6).length === 0, posicoesBatem(0.6));
  checar("Combinado: externas no menor esmaecimento", externas.every(function (pc) { return v.pecas[pc.id].alvo === 0.12; }));
  t = await clicarZona("knobBar");
  checar("Combinado: manípulos selecionados", sel() === "knobBar" && nome() === "Painel de manípulos", sel());

  // 8. Restaurar: montado e opaco no mesmo instante, sem esperar quadro.
  restaurar.click();
  v = d.vista();
  checar("Restaurar: explode zerado na hora", v.explode === 0 && v.explodeAlvo === 0, v.explode);
  checar("Restaurar: opacidades originais na hora", FOGAO.pecas({}).every(function (pc) { return v.pecas[pc.id].opacidade === 1; }));
  checar("Restaurar: raio-X desligado", v.raioX === false && raioX.getAttribute("aria-pressed") === "false");
  checar("Restaurar: slider no zero", slider.value === "0" && document.getElementById("heat-explode-valor").textContent === "0%");
  d.quadro();
  checar("Restaurar: peças na origem no quadro seguinte", posicoesBatem(0).length === 0, posicoesBatem(0));
  checar("Restaurar: seleção mantida", sel() === "knobBar" && nome() === "Painel de manípulos", sel());

  // 9. Botões de montagem convivem com o slider.
  function marcado(v) { return document.querySelector("#heat-montagem [data-explode='" + v + "']").getAttribute("aria-pressed") === "true"; }
  document.querySelector("#heat-montagem [data-explode='100']").click();
  await assentarAnimacao();
  checar("Botão Explodido: modelo e slider no máximo", perto(d.vista().explode, 1) && slider.value === "100", slider.value);
  checar("Botão Explodido: posição de 100%", posicoesBatem(1).length === 0, posicoesBatem(1));
  checar("Botão Explodido: só ele marcado", marcado(100) && !marcado(0));
  mover(40, true);
  checar("Slider no meio: nenhum botão marcado", !marcado(100) && !marcado(0));
  document.querySelector("#heat-montagem [data-explode='0']").click();
  await assentarAnimacao();
  checar("Botão Assentado: modelo e slider no zero", perto(d.vista().explode, 0) && slider.value === "0", slider.value);
  checar("Botão Assentado: só ele marcado", marcado(0) && !marcado(100));

  // Volta ao estado em que a página nasce.
  mover(100, true);
  await assentarAnimacao();

  console.table(resultados);
  var falhas = resultados.filter(function (x) { return !x.ok; });
  console.log(falhas.length ? falhas.length + " falha(s)" : "Todos os " + resultados.length + " casos passaram");
  return resultados;
})();
