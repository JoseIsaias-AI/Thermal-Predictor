/* Desenho axonométrico do fogão, em SVG.
 *
 * Projeção dimétrica de eixos fixos: largura (1, 0,22), profundidade
 * (0,70, -0,40), altura vertical. Sem ponto de fuga — comparar peças importa
 * mais que realismo, e perspectiva sugeriria precisão dimensional que não
 * temos (não há CAD).
 *
 * Representação esquemática: as proporções são aproximadas e a posição dos
 * pontos indica o subsistema, não a coordenada real do termopar.
 */

var FOGAO = (function () {
  "use strict";

  var S = 0.8, OX = 60, OY = 520;
  var NS = "http://www.w3.org/2000/svg";

  // Oito paradas discretas: o engenheiro lê faixa, não pixel.
  var RAMPA_A = ["#0d436b", "#3f7aa3", "#9dbdd2", "#d1d3d4", "#dd9a92", "#c04b3d", "#8f2419", "#5e120b"];
  var RAMPA_B = ["#eef0f1", "#cfd2d5", "#a6aaae", "#7c8189", "#5b616b", "#3e444d", "#262b32", "#12151a"];

  var FAIXAS = ["≥ +50%", "+30 a +50%", "+10 a +30%", "0 a +10%", "−10 a 0%", "−30 a −10%", "−50 a −30%", "< −50%"];

  function p(x, y, z) {
    return [OX + S * (x + 0.70 * y), OY + S * (0.22 * x - 0.40 * y - z)];
  }

  function poly(lista) {
    return lista.map(function (a) {
      return p(a[0], a[1], a[2]).map(function (n) { return n.toFixed(1); }).join(",");
    }).join(" ");
  }

  // Três valores planos de face, sem gradiente e sem sombra: a forma vem do
  // valor da face, não de luz simulada.
  function facesDaPeca(b, st) {
    var x = b[0], y = b[1], z = b[2], w = b[3], d = b[4], h = b[5];
    var topo = poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]);
    var frente = poly([[x, y, z], [x + w, y, z], [x + w, y, z + h], [x, y, z + h]]);
    var lado = poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]]);
    var traco = st.hi ? "#00a0dd" : "#9fa0a1";
    var esp = st.hi ? 2 : 1;
    return [
      { pts: lado, fill: st.dim ? "#e7e9eb" : "#dee0e3", stroke: traco, sw: esp },
      { pts: frente, fill: st.dim ? "#fafbfb" : "#f5f6f7", stroke: traco, sw: esp },
      { pts: topo, fill: "#ffffff", stroke: traco, sw: esp }
    ];
  }

  /* As 12 peças, com o nível de montagem em que cada uma entra e o
     deslocamento que recebe na vista explodida. `placa: "right"` desloca a
     PCB de 84 para 168 — é o fator com efeito geométrico mais visível. */
  function pecas(op) {
    var nivel = op.nivel == null ? 4 : op.nivel;
    var ex = op.explode ? 1 : 0;
    var bx = op.placa === "right" ? 168 : 84;
    var aberto = op.alojamento && op.alojamento !== "closed";
    var E = function (v) { return v * ex; };

    var lista = [
      { id: "mainback", lvl: 2, b: [0, 236, 20, 320, 10, 296], dy: E(90) },
      { id: "ovenCavity", lvl: 2, b: [24, 26, 34, 272, 196, 190], dy: 0 },
      { id: "blower", lvl: 2, b: [30, 140, 4, 100, 60, 30], dy: 0, dz: E(-4) },
      { id: "duct", lvl: 2, b: [140, 156, 4, 44, 40, 26], dy: 0, dz: E(-4) },
      { id: "deflector", lvl: 3, b: [122, 44, 232, 76, 46, 8], dz: E(52) },
      { id: "ipcTray", lvl: 3, b: [bx - 10, 30, 236, 160, 132, 10], dz: E(96) },
      { id: "ipcBoard", lvl: 3, b: [bx, 40, 248, 140, 112, 6], dz: E(124) },
      { id: "ipcLid", lvl: 3, b: [bx - 10, 30, 258, 160, 132, 8], dz: E(164) + (aberto ? 34 : 0), dy: aberto ? 26 : 0 },
      { id: "coilSupport", lvl: 4, b: [20, 40, 254, 280, 160, 8], dz: E(76) },
      { id: "cooktop", lvl: 4, b: [0, 0, 290, 320, 240, 10], dz: E(140) },
      { id: "knobBar", lvl: 4, b: [16, -12, 196, 288, 12, 42], dy: E(-52) },
      { id: "hmiPanel", lvl: 4, b: [110, -10, 116, 100, 10, 54], dy: E(-34) }
    ];

    return lista.map(function (pc) {
      var b = pc.b.slice();
      b[1] += pc.dy || 0;
      b[2] += pc.dz || 0;
      return { id: pc.id, lvl: pc.lvl, b: b, present: nivel >= pc.lvl, hi: op.novo === pc.id };
    });
  }

  function acharPeca(lista, id) {
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i];
    return null;
  }

  // FL/FR/RL/RR são as quatro posições reais das bobinas no cooktop.
  function centrosDasBobinas(lista, op) {
    var cs = acharPeca(lista, "coilSupport");
    var z = cs.b[2] + cs.b[5] + (op.explode ? 30 : 3);
    return [["FL", 90, 70], ["FR", 232, 70], ["RL", 90, 168], ["RR", 232, 168]].map(function (c) {
      return { k: c[0], x: c[1], y: c[2], z: z };
    });
  }

  /* Posições disponíveis para os 78 pontos, agrupadas por subsistema. As
     contagens seguem a base: 37 / 11 / 8 / 7 / 6 / 5 / 4. */
  function slotsPorArea(lista, op) {
    var s = {};
    var board = acharPeca(lista, "ipcBoard");
    var topoPlaca = board.b[2] + board.b[5];

    s["IPC Comp"] = [];
    for (var i = 0; i < 37; i++) {
      var c = i % 7, r = Math.floor(i / 7);
      s["IPC Comp"].push([board.b[0] + 14 + c * 19, board.b[1] + 14 + r * 21, topoPlaca]);
    }

    var mb = acharPeca(lista, "mainback");
    s["Mainback"] = [];
    for (var j = 0; j < 11; j++) {
      var cj = j % 4, rj = Math.floor(j / 4);
      s["Mainback"].push([34 + cj * 78, mb.b[1] + mb.b[4], 70 + rj * 88]);
    }

    var cc = centrosDasBobinas(lista, op);
    var cs = acharPeca(lista, "coilSupport");
    s.bobinas = {};
    s.placas = {};
    cc.forEach(function (c) {
      s.bobinas[c.k] = [c.x, c.y, c.z + 4];
      s.placas[c.k] = [c.x + 30, c.y + 26, cs.b[2] + cs.b[5] + 2];
    });

    var bl = acharPeca(lista, "blower");
    s["Main Vent Sys"] = [[52, 156, 34], [96, 150, 34], [66, 176, 6], [156, 168, 30], [176, 156, 18], [40, 168, 18], [120, 148, 34]]
      .map(function (q) { return [q[0], q[1] + (bl.b[1] - 140), q[2] + (bl.b[2] - 4)]; });

    var kb = acharPeca(lista, "knobBar");
    s["CT Knobs"] = [46, 100, 154, 208, 250, 276].map(function (x, i) {
      return [x, kb.b[1], kb.b[2] + (i > 3 ? 12 : 26)];
    });

    var lid = acharPeca(lista, "ipcLid");
    s["IPC Cooling"] = [
      [lid.b[0] + 20, lid.b[1] + 30, lid.b[2] + lid.b[5]],
      [lid.b[0] + 130, lid.b[1] + 40, lid.b[2] + lid.b[5]],
      [lid.b[0] + 156, lid.b[1] + 90, lid.b[2] + 4],
      [lid.b[0] + 74, lid.b[1] + 110, lid.b[2] + lid.b[5]],
      [lid.b[0] + 100, lid.b[1] + 16, lid.b[2] + lid.b[5]]
    ];

    var hp = acharPeca(lista, "hmiPanel");
    s["Oven HMI"] = [
      [hp.b[0] + 22, hp.b[1], hp.b[2] + 38], [hp.b[0] + 54, hp.b[1], hp.b[2] + 38],
      [hp.b[0] + 22, hp.b[1], hp.b[2] + 14], [hp.b[0] + 76, hp.b[1], hp.b[2] + 16]
    ];

    return s;
  }

  /* Liga cada ponto real da triagem a uma posição no desenho.
     `Bobina FL` e `Suporte FL` casam pelo sufixo de posição, e não pela
     ordem em que chegam — a ordem do dado é por severidade, não geométrica. */
  function posicionarPontos(pontos, slots) {
    var fila = {};
    var saida = [];

    pontos.forEach(function (pt) {
      var area = pt.Key_Area;
      var g = null;

      if (area === "Coil Temps") {
        var m = /\b(FL|FR|RL|RR)\s*$/.exec(pt.TC_Name);
        if (m) g = /^Coil\b/.test(pt.TC_Name) ? slots.bobinas[m[1]] : slots.placas[m[1]];
      }

      if (!g) {
        var disp = slots[area];
        if (disp) {
          var k = fila[area] || 0;
          g = disp[k % disp.length];
          fila[area] = k + 1;
        }
      }

      if (g) saida.push({ ponto: pt, g: g });
    });

    return saida;
  }

  // Faixa da rampa. Os cortes acompanham RN-01: 0 e +10% são fronteiras.
  function faixaDaRampa(mp) {
    if (mp >= 0.50) return 0;
    if (mp >= 0.30) return 1;
    if (mp >= 0.10) return 2;
    if (mp >= 0) return 3;
    if (mp >= -0.10) return 4;
    if (mp >= -0.30) return 5;
    if (mp >= -0.50) return 6;
    return 7;
  }

  // Forma carrega a mesma informação que a cor: cor nunca é o único canal.
  function formaDoPonto(cx, cy, estado, mono) {
    var x = cx.toFixed(1), y = cy.toFixed(1);
    if (mono) return "M" + (cx - 4.2).toFixed(1) + " " + (cy - 4.2).toFixed(1) + " h8.4 v8.4 h-8.4 Z";
    if (estado === "acima_do_limite") return "M" + x + " " + (cy - 6).toFixed(1) + " L" + (cx + 5.4).toFixed(1) + " " + (cy + 3.6).toFixed(1) + " L" + (cx - 5.4).toFixed(1) + " " + (cy + 3.6).toFixed(1) + " Z";
    if (estado === "banda_de_incerteza") return "M" + x + " " + (cy - 5.6).toFixed(1) + " L" + (cx + 5.6).toFixed(1) + " " + y + " L" + x + " " + (cy + 5.6).toFixed(1) + " L" + (cx - 5.6).toFixed(1) + " " + y + " Z";
    return "M" + (cx - 4.4).toFixed(1) + " " + y + " a4.4 4.4 0 1 0 8.8 0 a4.4 4.4 0 1 0 -8.8 0";
  }

  function calcular(op) {
    var modo = op.modo || "montagem";
    var nivel = op.nivel == null ? 4 : op.nivel;
    var lista = pecas(op);
    var faces = [], fantasmas = [], discos = [], trilhas = [], fluxo = [], setas = [], pts = [];

    lista.forEach(function (pc) {
      if (!pc.present) {
        // Peça não montada: contorno tracejado, sem preenchimento. O viewport
        // nunca fica vazio.
        var f = facesDaPeca(pc.b, {});
        fantasmas.push(f[2].pts);
        fantasmas.push(f[1].pts);
        return;
      }
      facesDaPeca(pc.b, { hi: pc.hi, dim: modo === "calor" }).forEach(function (f) { faces.push(f); });
    });

    fantasmas.push(poly([[0, 0, 0], [320, 0, 0], [320, 240, 0], [0, 240, 0]]));
    fantasmas.push(poly([[0, 0, 0], [0, 0, 300], [320, 0, 300], [320, 0, 0]]));

    var cs = acharPeca(lista, "coilSupport");
    if (cs.present) {
      // Material do suporte: diferença de valor e de traço, nunca de matiz.
      var mat = op.material === "plastic" ? "#f5f6f7" : op.material === "plate" ? "#dee0e3" : "#ffffff";
      centrosDasBobinas(lista, op).forEach(function (c) {
        var q = p(c.x, c.y, c.z);
        var rot = "rotate(9 " + q[0].toFixed(1) + " " + q[1].toFixed(1) + ")";
        discos.push({ cx: q[0], cy: q[1], rx: 34, ry: 15, fill: "#ffffff", stroke: op.novo === "coils" ? "#00a0dd" : "#767777", sw: op.novo === "coils" ? 2 : 1, dash: "", rot: rot });
        for (var r = 26; r > 8; r -= 8) {
          discos.push({ cx: q[0], cy: q[1], rx: r, ry: r * 0.44, fill: "none", stroke: "#d1d3d4", sw: 1, dash: "", rot: rot });
        }
        var s = p(c.x, c.y, cs.b[2] + cs.b[5] + 1);
        discos.push({
          cx: s[0], cy: s[1], rx: 40, ry: 17.6, fill: mat,
          stroke: op.novo === "coilSupport" ? "#00a0dd" : "#9fa0a1",
          sw: op.novo === "coilSupport" ? 2 : 1,
          dash: op.material === "plastic" ? "4 3" : "",
          rot: "rotate(9 " + s[0].toFixed(1) + " " + s[1].toFixed(1) + ")"
        });
      });
    }

    var board = acharPeca(lista, "ipcBoard");
    if (board.present && modo === "montagem") {
      for (var i = 0; i < 16; i++) {
        var c = i % 4, r2 = Math.floor(i / 4);
        var a = p(board.b[0] + 16 + c * 30, board.b[1] + 18 + r2 * 24, board.b[2] + board.b[5]);
        var b2 = p(board.b[0] + 30 + c * 30, board.b[1] + 30 + r2 * 24, board.b[2] + board.b[5]);
        trilhas.push({ x1: a[0], y1: a[1], x2: b2[0], y2: b2[1] });
      }
    }

    if (nivel >= 2 && modo === "montagem" && op.soprador) {
      var paFrente = op.soprador !== "back";
      for (var k = 0; k < 3; k++) {
        var x = 70 + k * 90;
        var a2 = p(x, paFrente ? 200 : 40, 60), b3 = p(x, paFrente ? -30 : 270, 60);
        fluxo.push("M" + a2[0].toFixed(1) + " " + a2[1].toFixed(1) + " L" + b3[0].toFixed(1) + " " + b3[1].toFixed(1));
        var dx = b3[0] - a2[0], dy = b3[1] - a2[1], L = Math.hypot(dx, dy);
        var ux = dx / L, uy = dy / L, px = -uy, py = ux;
        setas.push("M" + b3[0].toFixed(1) + " " + b3[1].toFixed(1) +
          " L" + (b3[0] - ux * 9 + px * 4).toFixed(1) + " " + (b3[1] - uy * 9 + py * 4).toFixed(1) +
          " L" + (b3[0] - ux * 9 - px * 4).toFixed(1) + " " + (b3[1] - uy * 9 - py * 4).toFixed(1) + " Z");
      }
    }

    if (modo === "calor" && op.pontos) {
      var rampa = op.escala === "b" ? RAMPA_B : RAMPA_A;
      var iso = op.isolar || "todos";
      posicionarPontos(op.pontos, slotsPorArea(lista, op)).forEach(function (item) {
        var pt = item.ponto;
        var q = p(item.g[0], item.g[1], item.g[2]);
        var mono = pt.is_monitor_only;
        // Isolar mantém os demais como contorno vazio, não os apaga.
        var dentro = iso === "todos" || pt.Key_Area === iso;
        pts.push({
          d: formaDoPonto(q[0], q[1], pt.estado, mono),
          fill: !dentro ? "#ffffff" : mono ? "#ffffff" : rampa[faixaDaRampa(pt.margem_percentual)],
          stroke: mono ? "#767777" : dentro ? "#484949" : "#dee0e3",
          sw: mono ? 1.2 : 0.8,
          dash: mono ? "2.5 2" : "",
          cx: q[0], cy: q[1],
          ponto: pt,
          dentro: dentro
        });
      });
    }

    return { faces: faces, fantasmas: fantasmas, discos: discos, trilhas: trilhas, fluxo: fluxo, setas: setas, pts: pts };
  }

  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== "" && attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }

  function grupo(pai) { var g = el("g", {}); pai.appendChild(g); return g; }

  /* Desenha dentro de um <svg> existente e devolve o cálculo, para que quem
     chamou possa ligar clique aos pontos. */
  function desenhar(svg, op) {
    var v = calcular(op);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 520 620");

    var gf = grupo(svg);
    v.fantasmas.forEach(function (pts) {
      gf.appendChild(el("polygon", { points: pts, fill: "none", stroke: "#dee0e3", "stroke-width": 1, "stroke-dasharray": "3 3", "stroke-linejoin": "round" }));
    });

    var gc = grupo(svg);
    v.faces.forEach(function (f) {
      gc.appendChild(el("polygon", { points: f.pts, fill: f.fill, stroke: f.stroke, "stroke-width": f.sw, "stroke-linejoin": "round" }));
    });

    var gd = grupo(svg);
    v.discos.forEach(function (d) {
      gd.appendChild(el("ellipse", { cx: d.cx.toFixed(1), cy: d.cy.toFixed(1), rx: d.rx, ry: d.ry, fill: d.fill, stroke: d.stroke, "stroke-width": d.sw, "stroke-dasharray": d.dash, transform: d.rot }));
    });

    var gt = grupo(svg);
    v.trilhas.forEach(function (l) {
      gt.appendChild(el("line", { x1: l.x1.toFixed(1), y1: l.y1.toFixed(1), x2: l.x2.toFixed(1), y2: l.y2.toFixed(1), stroke: "#9fa0a1", "stroke-width": 1 }));
    });

    var gx = grupo(svg);
    v.fluxo.forEach(function (d) {
      gx.appendChild(el("path", { d: d, fill: "none", stroke: "#00a0dd", "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
    });
    v.setas.forEach(function (d) { gx.appendChild(el("path", { d: d, fill: "#00a0dd" })); });

    var gp = grupo(svg);
    v.pts.forEach(function (pt) {
      var no = el("path", { d: pt.d, fill: pt.fill, stroke: pt.stroke, "stroke-width": pt.sw, "stroke-dasharray": pt.dash });
      no.style.cursor = "pointer";
      gp.appendChild(no);
      pt.no = no;
    });

    var gs = grupo(svg);
    if (op.sel) {
      for (var i = 0; i < v.pts.length; i++) {
        if (v.pts[i].ponto.measurement_id === op.sel) {
          gs.appendChild(el("circle", { cx: v.pts[i].cx.toFixed(1), cy: v.pts[i].cy.toFixed(1), r: 11, fill: "none", stroke: "#0d436b", "stroke-width": 1.5 }));
          gs.appendChild(el("circle", { cx: v.pts[i].cx.toFixed(1), cy: v.pts[i].cy.toFixed(1), r: 15, fill: "none", stroke: "#0d436b", "stroke-width": 1, "stroke-opacity": 0.35 }));
          break;
        }
      }
    }

    return v;
  }

  /* Ponto mais próximo dentro de um raio, em coordenadas do viewBox. Um alvo
     de 9px com 78 marcadores se sobrepondo torna o clique frustrante. */
  function maisProximo(v, x, y, raio) {
    var achado = null, melhor = raio * raio;
    v.pts.forEach(function (pt) {
      if (!pt.dentro) return;
      var dx = pt.cx - x, dy = pt.cy - y, d2 = dx * dx + dy * dy;
      if (d2 <= melhor) { melhor = d2; achado = pt.ponto; }
    });
    return achado;
  }

  return {
    desenhar: desenhar,
    maisProximo: maisProximo,
    faixaDaRampa: faixaDaRampa,
    formaDoPonto: formaDoPonto,
    RAMPA_A: RAMPA_A,
    RAMPA_B: RAMPA_B,
    FAIXAS: FAIXAS
  };
})();
