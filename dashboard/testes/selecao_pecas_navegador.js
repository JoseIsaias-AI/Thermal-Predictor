/* Teste de seleção de peças no navegador, sobre a triagem real.
 *
 * Abrir dashboard/triagem.html, colar este arquivo no console e esperar a
 * tabela. Os cliques são PointerEvents de verdade no palco 3D, resolvidos
 * pelo mesmo raycasting do mouse: nada chama a seleção por dentro.
 */

(async function () {
  "use strict";

  var host = document.getElementById("heat-3d");
  var d = host._fogao3d._depurar;
  var painel = document.getElementById("part-detail");
  var resultados = [];

  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Avança o laço de desenho à mão: com a aba em segundo plano o navegador não chama requestAnimationFrame.
  async function assentarAnimacao() {
    for (var i = 0; i < 70; i++) { d.quadro(); await espera(20); }
  }

  function ponteiro(tipo, x, y, extra) {
    var e = Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, isPrimary: true }, extra || {});
    host.dispatchEvent(new PointerEvent(tipo, e));
  }

  async function clicar(x, y, extra) {
    ponteiro("pointerdown", x, y, extra);
    ponteiro("pointerup", x, y, Object.assign({ buttons: 0 }, extra || {}));
    await espera(30);
  }

  // Arrasto lento, 1 px por evento: o caso que o limiar por evento deixava passar.
  async function arrastar(x, y, dx, dy) {
    var n = Math.max(Math.abs(dx), Math.abs(dy));
    ponteiro("pointerdown", x, y);
    for (var i = 1; i <= n; i++) ponteiro("pointermove", x + dx * i / n, y + dy * i / n);
    ponteiro("pointerup", x + dx, y + dy, { buttons: 0 });
    await espera(30);
  }

  function checar(caso, condicao, detalhe) {
    resultados.push({ caso: caso, ok: !!condicao, detalhe: detalhe || "" });
  }

  function linhas() {
    var m = {};
    var dts = painel.querySelectorAll("dt");
    Array.prototype.forEach.call(dts, function (dt) { m[dt.textContent] = dt.nextElementSibling.textContent; });
    return m;
  }
  function nome() { var n = painel.querySelector(".detail__name"); return n ? n.textContent : null; }
  function faixa() { var n = painel.querySelector(".part__state span"); return n ? n.textContent : null; }
  function sel() { return d.realces().sel; }

  // Botões Assentado (0) e Explodido (100); o slider tem teste próprio.
  function explodir(pct) {
    document.querySelector("#heat-montagem [data-explode='" + pct + "']").click();
  }

  async function alvo(zonaId) {
    d.quadro();
    var t = d.telaDaZona(zonaId);
    if (!t) throw new Error("zona fora da tela: " + zonaId);
    // O clique tem de cair na peça: se só sobrou pixel sob marcador, o caso testaria o marcador.
    checar(zonaId + ": alvo livre de marcador", !t.sobMarcador);
    return t;
  }

  function fonte(nomeTC) {
    return DADOS_TRIAGEM.pontos.concat(DADOS_TRIAGEM.monitoramento).filter(function (p) { return p.TC_Name === nomeTC; })[0];
  }

  // Parte sempre do mesmo quadro: explodido, isométrica enquadrada.
  host.scrollIntoView({ block: "center" });
  explodir(100);
  host._fogao3d.preset("isometrica");
  await assentarAnimacao();

  // 1. Bobina FL — ponto único, acima do limite.
  var t = await alvo("coil-FL");
  await clicar(t.x, t.y);
  var coil = fonte("Bobina FL"), l = linhas();
  checar("Bobina FL: realce na zona", sel() === "coil-FL", sel());
  checar("Bobina FL: nome no painel", nome() === "Bobina FL", nome());
  checar("Bobina FL: status do dado", faixa() === coil.estado_rotulo, faixa());
  checar("Bobina FL: temperatura", l["Temperatura prevista"] === coil.temperatura_prevista_c.toFixed(2) + " °C", l["Temperatura prevista"]);
  checar("Bobina FL: limite", l["Limite do componente"] === coil.limit_c.toFixed(2) + " °C", l["Limite do componente"]);
  checar("Bobina FL: folga", l["Folga"] === "−" + Math.abs(coil.margem_c).toFixed(2) + " °C", l["Folga"]);
  checar("Bobina FL: ponto único sem mediana", !Object.keys(l).some(function (k) { return /^Mediana/.test(k); }));
  checar("Bobina FL: is_monitor_only", l["Só monitoramento"] === "Não", l["Só monitoramento"]);

  // 2. Clicar de novo na mesma peça solta a seleção. O painel cresce e desloca o palco: mira de novo.
  t = await alvo("coil-FL");
  await clicar(t.x, t.y);
  checar("Mesma peça de novo: deseleciona", sel() === null && !!painel.querySelector(".detail__empty"), sel());

  // 3. Painel de manípulos — seis pontos dentro do limite.
  t = await alvo("knobBar");
  await clicar(t.x, t.y);
  var knobs = DADOS_TRIAGEM.pontos.filter(function (p) { return p.Key_Area === "CT Knobs"; });
  l = linhas();
  checar("Manípulos: realce", sel() === "knobBar", sel());
  checar("Manípulos: status do primeiro da triagem", faixa() === knobs[0].estado_rotulo, faixa());
  checar("Manípulos: temperatura rotulada como do ponto mais crítico", l["Temperatura do ponto mais crítico"] === knobs[0].temperatura_prevista_c.toFixed(2) + " °C", l["Temperatura do ponto mais crítico"]);
  checar("Manípulos: sem rótulo genérico de temperatura", !("Temperatura prevista" in l));
  var tk = knobs.map(function (p) { return p.temperatura_prevista_c; }).sort(function (a, b) { return a - b; });
  checar("Manípulos: mediana dos 6 pontos", l["Mediana dos 6 pontos"] === ((tk[2] + tk[3]) / 2).toFixed(1) + " °C", l["Mediana dos 6 pontos"]);
  checar("Manípulos: seis pontos listados", painel.querySelectorAll(".part__item").length === 6);

  // 4. Duto de ar — só monitorados. Tira os marcadores monitorados para mirar a peça, não o marcador.
  var mono = document.getElementById("filter-mono");
  mono.checked = false; mono.dispatchEvent(new Event("change"));
  t = await alvo("duct");
  await clicar(t.x, t.y);
  l = linhas();
  checar("Duto: realce", sel() === "duct", sel());
  checar("Duto: limite não declarado", faixa() === "Limite não declarado", faixa());
  checar("Duto: is_monitor_only", l["Só monitoramento"] === "Sim · todos os 2 pontos", l["Só monitoramento"]);
  checar("Duto: limite e folga vazios", l["Limite do componente"] === "—" && l["Folga"] === "—");
  mono.checked = true; mono.dispatchEvent(new Event("change"));

  // 5. Trocar de peça por clique direto.
  t = await alvo("mainback");
  await clicar(t.x, t.y);
  checar("Traseira: troca de peça", sel() === "mainback" && nome() === "Traseira (Mainback)", sel());

  // 6. Arrasto lento sobre outra peça: gira, não seleciona.
  var az0 = d.camera().alvo.az;
  t = await alvo("knobBar");
  await arrastar(t.x, t.y, 24, 0);
  checar("Arrasto lento: não seleciona", sel() === "mainback", sel());
  checar("Arrasto lento: câmera girou", Math.abs(d.camera().alvo.az - az0) > 0.1);

  // 7. Tremor dentro da zona morta ainda é clique, e não gira.
  await assentarAnimacao();
  t = await alvo("knobBar");
  az0 = d.camera().alvo.az;
  ponteiro("pointerdown", t.x, t.y);
  ponteiro("pointermove", t.x + 2, t.y + 1);
  ponteiro("pointerup", t.x + 2, t.y + 1, { buttons: 0 });
  await espera(30);
  checar("Tremor de 2 px: seleciona", sel() === "knobBar", sel());
  checar("Tremor de 2 px: câmera parada", d.camera().alvo.az === az0);

  // 8. Botão direito é gesto de câmera.
  t = await alvo("mainback");
  await clicar(t.x, t.y, { button: 2, buttons: 2 });
  checar("Botão direito: não seleciona", sel() === "knobBar", sel());

  // 9. Peça sem termopar: pisca, solta a seleção e explica.
  explodir(0);
  await assentarAnimacao();
  var r = host.getBoundingClientRect(), achou = null;
  for (var y = r.top + 20; y < r.bottom && !achou; y += 8) for (var x = r.left + 20; x < r.right && !achou; x += 8) {
    var a = d.pecaSob(x, y);
    if (a && a.id === "cooktop") achou = [x, y];
  }
  checar("Cooktop: alcançável no assentado", !!achou);
  if (achou) await clicar(achou[0], achou[1]);
  checar("Cooktop: pisca como sem dado", d.realces().nega === "cooktop", d.realces().nega);
  checar("Cooktop: nenhuma peça selecionada", sel() === null, sel());
  checar("Cooktop: painel explica", /sem ponto de medição/i.test(painel.textContent), painel.textContent.slice(0, 60));
  explodir(100);
  await assentarAnimacao();

  // 10. Marcador leva a peça junto; linha da tabela também.
  var ponto = DADOS_TRIAGEM.pontos.filter(function (p) { return p.TC_Name === "IPC P19"; })[0];
  d.quadro();
  var m = d.naTelaDe(ponto.measurement_id);
  await clicar(m.x, m.y);
  checar("Marcador IPC P19: peça segue o ponto", sel() === "ipcBoard", sel());
  checar("Marcador IPC P19: ponto marcado na lista", !!painel.querySelector(".part__item[aria-current='true']"));

  var tr = Array.prototype.filter.call(document.querySelectorAll("#screening-body tr"), function (x) { return x.textContent.indexOf("Bobina RR") >= 0; })[0];
  tr.click();
  await espera(30);
  checar("Linha Bobina RR: peça segue o ponto", sel() === "coil-RR", sel());

  // 11. Fundo e Esc desfazem.
  await clicar(r.left + 6, r.top + 6);
  checar("Fundo: limpa", sel() === null, sel());
  t = await alvo("mainback");
  await clicar(t.x, t.y);
  host.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await espera(30);
  checar("Esc: limpa", sel() === null, sel());

  console.table(resultados);
  var falhas = resultados.filter(function (x) { return !x.ok; });
  console.log(falhas.length ? falhas.length + " falha(s)" : "Todos os " + resultados.length + " casos passaram");
  return resultados;
})();
