/* Viewport 3D do fogão em WebGL (three.js).
 *
 * Cada peça de FOGAO.pecas é um grupo, e os termopares são filhos da peça em que moram.
 * Eixos da cena: X para a direita, Y para cima, Z para quem olha de frente; uma unidade
 * do modelo vale 0,01. Explodido mexe na posição e raio-X na opacidade das peças
 * externas, por isso os dois combinam livremente.
 */

var FOGAO3D = (function () {
  "use strict";

  var T = window.THREE;
  var U = 0.01;

  function mundo(x, y, z) { return new T.Vector3((x - 160) * U, z * U, (120 - y) * U); }
  function centroDe(b) { return mundo(b[0] + b[3] / 2, b[1] + b[4] / 2, b[2] + b[5] / 2); }
  function desloc(ex) { return new T.Vector3(ex[0] * U, ex[2] * U, -ex[1] * U); }
  function suave(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  var GRAU = Math.PI / 180;

  // Cor de um token de tokens.css no tema em vigor; sem TEMA, a do tema claro.
  function corDoTema(nome, reserva) {
    var v = typeof TEMA !== "undefined" ? TEMA.token(nome) : "";
    return new T.Color(v || reserva);
  }

  /* ----- Texturas procedurais -----
     Tudo desenhado em canvas: nenhum arquivo de imagem a carregar, e o painel
     segue abrindo sem servidor. */

  function textura(w, h, pintar, cor) {
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    pintar(cv.getContext("2d"), w, h);
    var tx = new T.CanvasTexture(cv);
    if (cor !== false) tx.colorSpace = T.SRGBColorSpace;
    tx.anisotropy = 8;
    return tx;
  }

  function ruido(seed) {
    var s = seed || 1;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  function texEscovado() {
    var r = ruido(7);
    var tx = textura(256, 256, function (c, w, h) {
      c.fillStyle = "#c8c8c8"; c.fillRect(0, 0, w, h);
      for (var i = 0; i < 900; i++) {
        var v = 170 + Math.floor(r() * 80);
        c.fillStyle = "rgba(" + v + "," + v + "," + v + "," + (0.25 + r() * 0.35) + ")";
        c.fillRect(0, r() * h, w, 0.6 + r() * 1.4);
      }
    }, false);
    tx.wrapS = tx.wrapT = T.RepeatWrapping;
    return tx;
  }

  // Espiral de cobre de uma bobina de indução, vista de cima.
  function texBobina() {
    return textura(512, 512, function (c, w) {
      var m = w / 2;
      c.fillStyle = "#1a1512"; c.fillRect(0, 0, w, w);
      for (var r = m * 0.96; r > m * 0.22; r -= 5.2) {
        var t = (r / m);
        c.strokeStyle = "hsl(" + (22 + t * 6) + ", 68%, " + (38 + Math.sin(r * 0.9) * 7) + "%)";
        c.lineWidth = 3.6;
        c.beginPath(); c.arc(m, m, r, 0, Math.PI * 2); c.stroke();
      }
      // Frestas radiais entre os feixes de fio.
      c.strokeStyle = "rgba(20,14,10,0.85)"; c.lineWidth = 7;
      for (var k = 0; k < 6; k++) {
        var a = k * Math.PI / 3;
        c.beginPath(); c.moveTo(m + Math.cos(a) * m * 0.24, m + Math.sin(a) * m * 0.24);
        c.lineTo(m + Math.cos(a) * m * 0.97, m + Math.sin(a) * m * 0.97); c.stroke();
      }
      c.fillStyle = "#2a2522"; c.beginPath(); c.arc(m, m, m * 0.2, 0, Math.PI * 2); c.fill();
    });
  }

  function texPCB() {
    var r = ruido(11);
    return textura(512, 410, function (c, w, h) {
      c.fillStyle = "#0f4a3a"; c.fillRect(0, 0, w, h);
      c.strokeStyle = "rgba(214,178,94,0.55)"; c.lineWidth = 2;
      for (var i = 0; i < 70; i++) {
        var x = r() * w, y = r() * h, x2 = x + (r() - 0.5) * 180, y2 = y;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2);
        c.lineTo(x2 + (r() < 0.5 ? 1 : -1) * 30, y2 + 30); c.lineTo(x2 + 30, y2 + 30 + r() * 80); c.stroke();
      }
      c.fillStyle = "rgba(220,190,110,0.9)";
      for (var j = 0; j < 160; j++) c.fillRect(r() * w, r() * h, 5, 5);
      c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 1.5;
      for (var k = 0; k < 14; k++) c.strokeRect(r() * w, r() * h, 24 + r() * 40, 14 + r() * 24);
    });
  }

  // Cooktop visto de cima: zonas serigrafadas e o controle de toque na frente.
  function texCooktop() {
    var W = 1024, H = 768;
    return textura(W, H, function (c) {
      c.fillStyle = "#0b0c0e"; c.fillRect(0, 0, W, H);
      function px(x) { return x / 320 * W; }
      function py(y) { return (240 - y) / 240 * H; }
      FOGAO.POSICOES.forEach(function (p) {
        var r = FOGAO.RAIO_BOBINA[p[0]] / 320 * W;
        c.strokeStyle = "rgba(190,196,204,0.55)"; c.lineWidth = 3;
        c.beginPath(); c.arc(px(p[1]), py(p[2]), r * 1.08, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = "rgba(190,196,204,0.28)"; c.lineWidth = 2;
        c.beginPath(); c.arc(px(p[1]), py(p[2]), r * 0.72, 0, Math.PI * 2); c.stroke();
      });
      c.fillStyle = "rgba(190,196,204,0.45)";
      for (var i = 0; i < 9; i++) c.fillRect(px(118 + i * 10), py(10), 16, 4);
      c.beginPath(); c.arc(px(160), py(24), 10, 0, Math.PI * 2); c.fill();
    });
  }

  /* O que o display do forno mostra em cada caso de operação. Representação
     esquemática, como o resto do modelo: o rótulo acompanha o regime escolhido
     no formulário, e a temperatura é a ordem de grandeza do ciclo, não uma
     especificação de produto. */
  var DISPLAY_POR_CASO = {
    "Broil Qualitative": { modo: "BROIL", valor: "180°" },
    "Broil C1": { modo: "BROIL C1", valor: "180°" },
    "Broil C2": { modo: "BROIL C2", valor: "180°" },
    "Pyro": { modo: "PYRO", valor: "480°" }
  };
  var DISPLAY_PADRAO = { modo: "BROIL", valor: "180°" };

  function pintarDisplay(c, w, h, caso) {
    var leitura = DISPLAY_POR_CASO[caso] || DISPLAY_PADRAO;

    c.clearRect(0, 0, w, h);
    c.fillStyle = "#050607"; c.fillRect(0, 0, w, h);
    c.shadowColor = "rgba(90,200,255,0.9)"; c.shadowBlur = 14;
    c.fillStyle = "#8fdcff";
    c.font = "bold 92px 'Segoe UI', Arial, sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(leitura.valor, w / 2, h / 2 + 4);
    c.font = "600 26px 'Segoe UI', Arial, sans-serif";
    c.fillStyle = "rgba(143,220,255,0.75)";
    // À esquerda, e não centrado num ponto fixo: "BROIL C2" é bem mais largo
    // que "PYRO" e escaparia do vidro.
    c.textAlign = "left";
    c.fillText(leitura.modo, 26, h / 2);
    c.textAlign = "right";
    c.fillText("12:45", w - 26, h / 2);
  }

  /* O display é a única textura que muda depois de pronta, e por isso não passa
     por `textura`: cada peça clona os seus materiais ao ser construída, então
     trocar o mapa do material original não alcançaria os clones. Repintar o
     canvas da textura alcança, porque a instância é a mesma em todos. */
  function texDisplay() {
    var largura = 512, altura = 208;
    var cv = document.createElement("canvas");
    cv.width = largura; cv.height = altura;

    var ctx = cv.getContext("2d");
    pintarDisplay(ctx, largura, altura, null);

    var tx = new T.CanvasTexture(cv);
    tx.colorSpace = T.SRGBColorSpace;
    tx.anisotropy = 8;
    tx.userData.repintar = function (caso) {
      if (tx.userData.caso === caso) return;
      tx.userData.caso = caso;
      pintarDisplay(ctx, largura, altura, caso);
      tx.needsUpdate = true;
    };
    return tx;
  }

  // Mapa de transparência de chapa perfurada: aberta vira venezianas largas.
  function texPerfurado(aberto) {
    return textura(512, 512, function (c, w, h) {
      c.fillStyle = "#ffffff"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#000000";
      if (aberto) {
        for (var i = 0; i < 6; i++) for (var j = 0; j < 3; j++) c.fillRect(40 + j * 150, 40 + i * 76, 120, 34);
      } else {
        for (var y = 30; y < h - 20; y += 22) for (var x = 30 + (y % 44 ? 11 : 0); x < w - 20; x += 22) {
          c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
        }
      }
    }, false);
  }

  function texSombra() {
    return textura(256, 256, function (c, w) {
      var g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, "rgba(0,0,0,0.42)");
      g.addColorStop(0.55, "rgba(0,0,0,0.18)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.fillRect(0, 0, w, w);
    });
  }

  /* ----- Ambiente de estúdio -----
     Refletido pelo inox e pelo vidro. Softboxes nas laterais e uma faixa de
     luz atrás desenham os brilhos longos de foto de produto; o teto fica
     escuro, para o cooktop visto de cima continuar preto. */
  function ambienteEstudio() {
    var s = new T.Scene();
    var sala = new T.Mesh(new T.BoxGeometry(24, 14, 24), new T.MeshBasicMaterial({ color: 0x3c4148, side: T.BackSide }));
    sala.position.y = 5;
    s.add(sala);
    var piso = new T.Mesh(new T.PlaneGeometry(24, 24), new T.MeshBasicMaterial({ color: 0x9aa0a6 }));
    piso.rotation.x = -Math.PI / 2;
    piso.position.y = -1.9;
    s.add(piso);
    function painel(w, h, x, y, z, forca) {
      var m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(forca, forca, forca * 1.02) }));
      m.position.set(x, y, z);
      m.lookAt(0, 1.5, 0);
      s.add(m);
    }
    painel(5, 7, -8, 4, 5, 7);
    painel(4, 7, 8.5, 3.5, 3, 4.5);
    painel(12, 1.2, 0, 6.5, -8, 6);
    painel(10, 2.5, 0, 1.5, 10, 1.6);
    return s;
  }

  /* ----- Materiais ----- */

  function criarMateriais() {
    var escovado = texEscovado();
    var M = {};
    M.inox = new T.MeshPhysicalMaterial({ color: 0xd3d8dd, metalness: 1, roughness: 0.3, roughnessMap: escovado, anisotropy: 0.7 });
    M.inoxEscuro = new T.MeshPhysicalMaterial({ color: 0x8d949b, metalness: 1, roughness: 0.38, roughnessMap: escovado, anisotropy: 0.5 });
    M.vidro = new T.MeshPhysicalMaterial({ color: 0x07080a, metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 });
    M.vidroPorta = new T.MeshPhysicalMaterial({ color: 0x0a0c10, metalness: 0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.78 });
    M.cooktop = new T.MeshPhysicalMaterial({ color: 0xffffff, map: texCooktop(), metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 });
    M.esmalte = new T.MeshStandardMaterial({ color: 0x23272e, roughness: 0.5, metalness: 0.15 });
    M.esmalteQuente = new T.MeshStandardMaterial({ color: 0x23272e, roughness: 0.55, metalness: 0.1, emissive: 0x6a3a14, emissiveIntensity: 0.35 });
    M.galvanizado = new T.MeshStandardMaterial({ color: 0xb4bac1, metalness: 0.85, roughness: 0.42, roughnessMap: escovado });
    M.aluminio = new T.MeshStandardMaterial({ color: 0xdfe3e7, metalness: 1, roughness: 0.28 });
    M.aluminioFosco = new T.MeshStandardMaterial({ color: 0xaeb4ba, metalness: 0.9, roughness: 0.55, roughnessMap: escovado });
    M.plastico = new T.MeshStandardMaterial({ color: 0xe9e4d8, metalness: 0, roughness: 0.62 });
    M.plasticoPreto = new T.MeshStandardMaterial({ color: 0x17181b, metalness: 0.05, roughness: 0.42 });
    M.plasticoCinza = new T.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.1, roughness: 0.5 });
    M.borracha = new T.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.9 });
    M.cobre = new T.MeshStandardMaterial({ color: 0xffffff, map: texBobina(), metalness: 0.85, roughness: 0.36 });
    M.cobreLado = new T.MeshStandardMaterial({ color: 0x9a5a2c, metalness: 0.9, roughness: 0.4 });
    M.ferrite = new T.MeshStandardMaterial({ color: 0x202124, roughness: 0.75 });
    M.pcb = new T.MeshStandardMaterial({ color: 0xffffff, map: texPCB(), roughness: 0.55, metalness: 0.05 });
    M.pcbLado = new T.MeshStandardMaterial({ color: 0x0f4a3a, roughness: 0.6 });
    M.capacitor = new T.MeshStandardMaterial({ color: 0x1d3b73, roughness: 0.35, metalness: 0.2 });
    M.conector = new T.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.5 });
    M.cromo = new T.MeshStandardMaterial({ color: 0xe8ebee, metalness: 1, roughness: 0.14 });
    M.display = new T.MeshBasicMaterial({ map: texDisplay(), toneMapped: false });
    M.luz = new T.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
    M.resistencia = new T.MeshStandardMaterial({ color: 0x3b3430, metalness: 0.6, roughness: 0.45, emissive: 0x4a1a08, emissiveIntensity: 0.6 });
    M.perfuradoFechado = new T.MeshStandardMaterial({ color: 0xbfc5cb, metalness: 0.85, roughness: 0.4, alphaMap: texPerfurado(false), alphaTest: 0.5, side: T.DoubleSide });
    M.perfuradoAberto = new T.MeshStandardMaterial({ color: 0xbfc5cb, metalness: 0.85, roughness: 0.4, alphaMap: texPerfurado(true), alphaTest: 0.5, side: T.DoubleSide });
    M.argila = new T.MeshStandardMaterial({ color: 0xdde1e6, roughness: 0.78, metalness: 0 });
    M.argilaEscura = new T.MeshStandardMaterial({ color: 0x9ea6af, roughness: 0.8, metalness: 0 });
    return M;
  }

  /* ----- Peças -----
     Cada construtor recebe o grupo da peça, cuja origem é o centro da caixa
     assentada, e desenha em coordenadas do modelo pelos atalhos abaixo. */

  function Kit(grupo, origem) {
    this.g = grupo; this.o = origem;
  }

  Kit.prototype.pos = function (x, y, z) { return mundo(x, y, z).sub(this.o); };

  Kit.prototype.caixa = function (mat, x, y, z, w, d, h, raio) {
    var geo = raio ? new T.RoundedBoxGeometry(w * U, h * U, d * U, 3, raio * U) : new T.BoxGeometry(w * U, h * U, d * U);
    var m = new T.Mesh(geo, mat);
    m.position.copy(this.pos(x + w / 2, y + d / 2, z + h / 2));
    this.g.add(m);
    return m;
  };

  // Cilindro de eixo "x", "y" (profundidade do modelo) ou "z" (vertical).
  Kit.prototype.cilindro = function (mat, cx, cy, cz, r, comp, eixo, segs, rTopo) {
    var geo = new T.CylinderGeometry((rTopo == null ? r : rTopo) * U, r * U, comp * U, segs || 32);
    var m = new T.Mesh(geo, mat);
    if (eixo === "x") m.rotation.z = Math.PI / 2;
    if (eixo === "y") m.rotation.x = Math.PI / 2;
    m.position.copy(this.pos(cx, cy, cz));
    this.g.add(m);
    return m;
  };

  var CONSTRUTORES = {
    rodape: function (k, pc, M) {
      var b = pc.b;
      k.caixa(M.plasticoPreto, b[0], b[1], b[2] + 4, b[3], b[4], b[5] - 4, 1.5);
      for (var i = 0; i < 12; i++) k.caixa(M.borracha, 60 + i * 17, b[1] - 0.5, 10, 10, 1, 8);
      [[16, 12], [304, 12], [16, 228], [304, 228]].forEach(function (p) {
        k.cilindro(M.borracha, p[0], p[1], 2, 6, 4, "z");
      });
    },

    lateralE: function (k, pc, M) { var b = pc.b; k.caixa(M.inox, b[0], b[1], b[2], b[3], b[4], b[5], 0.6); },
    lateralD: function (k, pc, M) { var b = pc.b; k.caixa(M.inox, b[0], b[1], b[2], b[3], b[4], b[5], 0.6); },

    ovenCavity: function (k, pc, M) {
      var b = pc.b, x = b[0], y = b[1], z = b[2], w = b[3], d = b[4], h = b[5], e = 5;
      k.caixa(M.esmalte, x, y + d - e, z, w, e, h);
      k.caixa(M.esmalte, x, y, z, e, d, h);
      k.caixa(M.esmalte, x + w - e, y, z, e, d, h);
      k.caixa(M.esmalte, x, y, z + h - e, w, d, e);
      k.caixa(M.esmalte, x, y, z, w, d, e);
      // Moldura da boca do forno.
      k.caixa(M.inoxEscuro, x - 4, y - 3, z - 4, w + 8, 3, 8);
      k.caixa(M.inoxEscuro, x - 4, y - 3, z + h - 4, w + 8, 3, 8);
      k.caixa(M.inoxEscuro, x - 4, y - 3, z, 8, 3, h);
      k.caixa(M.inoxEscuro, x + w - 4, y - 3, z, 8, 3, h);
      // Duas grades cromadas.
      [84, 148].forEach(function (zg) {
        k.cilindro(M.cromo, x + 12, y + d / 2, zg, 1.4, d - 20, "y", 8);
        k.cilindro(M.cromo, x + w - 12, y + d / 2, zg, 1.4, d - 20, "y", 8);
        k.cilindro(M.cromo, x + w / 2, y + 14, zg, 1.4, w - 24, "x", 8);
        k.cilindro(M.cromo, x + w / 2, y + d - 14, zg, 1.4, w - 24, "x", 8);
        for (var i = 1; i < 12; i++) k.cilindro(M.cromo, x + 12 + i * (w - 24) / 12, y + d / 2, zg, 0.8, d - 28, "y", 6);
      });
      // Resistência do grill, em serpentina sob o teto.
      var pts = [];
      for (var s = 0; s <= 5; s++) {
        var yy = y + 30 + s * (d - 60) / 5;
        pts.push(k.pos(x + 40, yy, z + h - 16), k.pos(x + w - 40, yy, z + h - 16));
      }
      for (var p = 1; p < pts.length - 1; p += 2) if (p % 4 === 3) { var t = pts[p]; pts[p] = pts[p + 1]; pts[p + 1] = t; }
      var tubo = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts, false, "catmullrom", 0.1), 160, 2.2 * U, 8), M.resistencia);
      k.g.add(tubo);
      // Luz do forno só emissiva: luz pontual sem sombra vazava pelas paredes e acendia o vidro do cooktop.
      k.cilindro(M.luz, x + w - 20, y + d - 30, z + h - 6, 6, 3, "z", 20);
      k.caixa(M.esmalteQuente, x + e, y + d - e - 0.5, z + e, w - 2 * e, 0.5, h - 2 * e);
    },

    porta: function (k, pc, M) {
      var b = pc.b;
      k.caixa(M.inox, b[0], b[1] + 12, b[2], b[3], 6, b[5], 1.5);
      k.caixa(M.vidroPorta, b[0] + 4, b[1], b[2] + 4, b[3] - 8, 12, b[5] - 20, 2);
      k.caixa(M.inox, b[0], b[1] - 1, b[2] + b[5] - 18, b[3], 5, 18, 1.2);
      // Puxador tubular.
      k.cilindro(M.inox, 160, b[1] - 18, b[2] + b[5] - 9, 4.6, 250, "x", 32);
      [42, 278].forEach(function (x) { k.cilindro(M.inox, x, b[1] - 9, b[2] + b[5] - 9, 3, 18, "y", 20); });
    },

    mainback: function (k, pc, M) {
      var b = pc.b;
      k.caixa(M.inoxEscuro, b[0], b[1], b[2], b[3], b[4], b[5], 1.5);
      for (var i = 0; i < 3; i++) for (var j = 0; j < 7; j++) {
        k.caixa(M.plasticoPreto, 36 + j * 38, b[1] + b[4], 70 + i * 60, 26, 1.5, 6);
      }
    },

    blower: function (k, pc, M, op) {
      var b = pc.b, cx = b[0] + 44, cy = b[1] + 34, cz = b[2] + 13;
      // Voluta aberta: dá para ver o rotor tangencial girando.
      var voluta = new T.Mesh(new T.CylinderGeometry(15 * U, 15 * U, 84 * U, 40, 1, true, Math.PI * 0.15, Math.PI * 1.35), M.plasticoCinza);
      voluta.material = M.plasticoCinza;
      voluta.rotation.z = Math.PI / 2;
      voluta.position.copy(k.pos(cx, cy, cz));
      k.g.add(voluta);
      k.cilindro(M.plasticoCinza, cx - 43, cy, cz, 15.5, 2.5, "x");
      k.cilindro(M.plasticoCinza, cx + 43, cy, cz, 15.5, 2.5, "x");

      var rotor = new T.Group();
      rotor.position.copy(k.pos(cx, cy, cz));
      for (var i = 0; i < 28; i++) {
        var a = i / 28 * Math.PI * 2;
        var pa = new T.Mesh(new T.BoxGeometry(80 * U, 0.6 * U, 4.5 * U), M.aluminioFosco);
        pa.position.set(0, Math.cos(a) * 10 * U, Math.sin(a) * 10 * U);
        pa.rotation.x = a + 0.5;
        rotor.add(pa);
      }
      var eixo = new T.Mesh(new T.CylinderGeometry(3 * U, 3 * U, 82 * U, 16), M.aluminioFosco);
      eixo.rotation.z = Math.PI / 2;
      rotor.add(eixo);
      rotor.userData.rotor = op.soprador === "back" ? -1 : 1;
      k.g.add(rotor);

      // Motor na ponta e boca de saída virada para onde o ar vai.
      k.cilindro(M.plasticoPreto, b[0] + 97, cy, cz, 10, 14, "x");
      k.cilindro(M.cobreLado, b[0] + 97, cy, cz, 10.4, 3, "x");
      var paraFrente = op.soprador !== "back";
      k.caixa(M.plasticoCinza, cx - 40, paraFrente ? b[1] + 2 : cy + 10, cz - 11, 80, 22, 22, 2);
    },

    duct: function (k, pc, M) {
      var b = pc.b;
      k.caixa(M.galvanizado, b[0], b[1], b[2], b[3], b[4], b[5], 2);
      k.caixa(M.galvanizado, b[0] - 3, b[1] - 1, b[2] - 1, b[3] + 6, 4, b[5] + 2, 1);
    },

    deflector: function (k, pc, M, op) {
      var b = pc.b, w = b[3], d = b[4];
      var forma = new T.Shape();
      forma.moveTo(-w / 2 * U, -d / 2 * U); forma.lineTo(w / 2 * U, -d / 2 * U);
      forma.lineTo(w / 2 * U, d / 2 * U); forma.lineTo(-w / 2 * U, d / 2 * U); forma.closePath();
      if (op.defletor === "open") {
        var furo = new T.Path();
        furo.absarc(0, 0, 15 * U, 0, Math.PI * 2, true);
        forma.holes.push(furo);
      }
      var geo = new T.ExtrudeGeometry(forma, { depth: b[5] * U, bevelEnabled: false, curveSegments: 40 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -b[5] / 2 * U, 0);
      k.g.add(new T.Mesh(geo, M.aluminio));
      // Abas dobradas nas pontas.
      k.caixa(M.aluminio, b[0], b[1], b[2] - 8, 2, d, 8);
      k.caixa(M.aluminio, b[0] + w - 2, b[1], b[2] - 8, 2, d, 8);
    },

    ipcTray: function (k, pc, M) {
      var b = pc.b;
      k.caixa(M.galvanizado, b[0], b[1], b[2], b[3], b[4], 2);
      k.caixa(M.galvanizado, b[0], b[1], b[2], b[3], 2, b[5]);
      k.caixa(M.galvanizado, b[0], b[1] + b[4] - 2, b[2], b[3], 2, b[5]);
      k.caixa(M.galvanizado, b[0], b[1], b[2], 2, b[4], b[5]);
      k.caixa(M.galvanizado, b[0] + b[3] - 2, b[1], b[2], 2, b[4], b[5]);
    },

    ipcBoard: function (k, pc, M) {
      var b = pc.b, X = b[0], Y = b[1], Z = b[2] + b[5];
      var placa = new T.Mesh(new T.BoxGeometry(b[3] * U, b[5] * U, b[4] * U),
        [M.pcbLado, M.pcbLado, M.pcb, M.pcbLado, M.pcbLado, M.pcbLado]);
      placa.position.copy(k.pos(X + b[3] / 2, Y + b[4] / 2, b[2] + b[5] / 2));
      k.g.add(placa);
      // Dissipador com aletas sobre os semicondutores de potência.
      k.caixa(M.aluminioFosco, X + 8, Y + 78, Z, 124, 26, 3);
      for (var i = 0; i < 16; i++) k.caixa(M.aluminioFosco, X + 10 + i * 7.8, Y + 78, Z + 3, 1.6, 26, 11);
      // Capacitores de barramento.
      [22, 38, 54].forEach(function (dx) {
        k.cilindro(M.capacitor, X + dx, Y + 22, Z + 7, 6.5, 14, "z");
        k.cilindro(M.aluminio, X + dx, Y + 22, Z + 14.4, 6.3, 0.8, "z");
      });
      // Indutor toroidal.
      var toro = new T.Mesh(new T.TorusGeometry(9 * U, 3.6 * U, 16, 40), M.cobreLado);
      toro.rotation.x = Math.PI / 2;
      toro.position.copy(k.pos(X + 104, Y + 30, Z + 3.6));
      k.g.add(toro);
      k.caixa(M.plasticoPreto, X + 72, Y + 12, Z, 12, 9, 10, 1);
      k.caixa(M.plasticoPreto, X + 72, Y + 30, Z, 12, 9, 10, 1);
      k.caixa(M.conector, X + 4, Y + 58, Z, 22, 8, 7, 1);
      k.caixa(M.conector, X + 116, Y + 58, Z, 20, 8, 7, 1);
      k.caixa(M.plasticoPreto, X + 40, Y + 52, Z, 14, 14, 2.4, 0.5);
    },

    ipcLid: function (k, pc, M, op) {
      var b = pc.b, aberto = op.alojamento === "open";
      var topo = new T.Mesh(new T.BoxGeometry(b[3] * U, b[5] * U, b[4] * U), aberto ? M.perfuradoAberto : M.perfuradoFechado);
      topo.position.copy(k.pos(b[0] + b[3] / 2, b[1] + b[4] / 2, b[2] + b[5] / 2));
      k.g.add(topo);
      // Saias descem até a bandeja; aberto, só a de trás fica.
      var z0 = 240, h = b[2] - z0;
      k.caixa(M.galvanizado, b[0], b[1] + b[4] - 2, z0, b[3], 2, h);
      if (!aberto) {
        k.caixa(M.galvanizado, b[0], b[1], z0, b[3], 2, h);
        k.caixa(M.galvanizado, b[0], b[1], z0, 2, b[4], h);
        k.caixa(M.galvanizado, b[0] + b[3] - 2, b[1], z0, 2, b[4], h);
      }
    },

    coilSupport: function (k, pc, M, op) {
      var b = pc.b;
      var mat = op.material === "plastic" ? M.plastico : op.material === "plate" ? M.aluminioFosco : M.aluminio;
      k.caixa(mat, b[0], b[1], b[2], b[3], b[4], b[5], 1);
      FOGAO.POSICOES.forEach(function (p) {
        k.cilindro(M.aluminio, p[1], p[2], b[2] + b[5] + 0.6, FOGAO.RAIO_BOBINA[p[0]] + 6, 1.2, "z", 64);
      });
    },

    coils: function (k, pc, M) {
      var b = pc.b, z = b[2];
      FOGAO.POSICOES.forEach(function (p) {
        var r = FOGAO.RAIO_BOBINA[p[0]];
        for (var i = 0; i < 8; i++) {
          var a = i / 8 * Math.PI * 2, m = r * 0.55;
          var barra = k.caixa(M.ferrite, p[1] + Math.cos(a) * m - 2, p[2] + Math.sin(a) * m - r * 0.35, z, 4, r * 0.7, 2);
          barra.rotation.y = -a + Math.PI / 2;
          barra.position.copy(k.pos(p[1] + Math.cos(a) * m, p[2] + Math.sin(a) * m, z + 1));
        }
        var disco = new T.Mesh(new T.CylinderGeometry(r * U, r * U, 5 * U, 72), [M.cobreLado, M.cobre, M.ferrite]);
        disco.position.copy(k.pos(p[1], p[2], z + 4.5));
        k.g.add(disco);
        k.cilindro(M.conector, p[1], p[2], z + 8, 3.5, 2, "z", 20);
      });
    },

    cooktop: function (k, pc, M) {
      var b = pc.b;
      var geo = new T.BoxGeometry(b[3] * U, b[5] * U, b[4] * U);
      var m = new T.Mesh(geo, [M.vidro, M.vidro, M.cooktop, M.vidro, M.vidro, M.vidro]);
      m.position.copy(k.pos(b[0] + b[3] / 2, b[1] + b[4] / 2, b[2] + b[5] / 2));
      k.g.add(m);
    },

    knobBar: function (k, pc, M) {
      var b = pc.b;
      k.caixa(M.inox, b[0], b[1], b[2], b[3], b[4], b[5], 2);
      // Moldura sob a borda do vidro: fecha a fresta por onde se viam as bobinas.
      k.caixa(M.inoxEscuro, b[0], b[1] + b[4], b[2] + b[5] - 6, b[3], 26, 6);
      k.caixa(M.vidro, 104, b[1] - 1.5, b[2] + 30, 112, 2, 58, 0.8);
      FOGAO.MANIPULOS.forEach(function (x, i) {
        var zc = b[2] + 46;
        k.cilindro(M.inoxEscuro, x, b[1] - 1, zc, 13, 2.5, "y", 40);
        k.cilindro(M.plasticoPreto, x, b[1] - 7, zc, 10.5, 10, "y", 40);
        var cap = k.cilindro(M.inox, x, b[1] - 13, zc, 10, 3, "y", 40);
        var ind = k.caixa(M.conector, x - 1, b[1] - 15, zc, 2, 1, 8);
        var giro = [0.4, -0.9, 1.3, -0.3][i];
        ind.position.copy(k.pos(x + Math.sin(giro) * 5, b[1] - 15, zc + Math.cos(giro) * 5));
        ind.rotation.z = -giro;
        cap.userData.manipulo = true;
      });
    },

    hmiPanel: function (k, pc, M) {
      var b = pc.b;
      k.caixa(M.vidro, b[0], b[1], b[2], b[3], b[4], b[5], 1.5);
      var tela = new T.Mesh(new T.PlaneGeometry((b[3] - 10) * U, (b[5] - 10) * U), M.display);
      tela.position.copy(k.pos(b[0] + b[3] / 2, b[1] - 0.2, b[2] + b[5] / 2));
      k.g.add(tela);
    }
  };

  /* ----- Marcadores -----
     Esfera dentro do limite, pirâmide acima, octaedro na banda de incerteza e cubo nos
     monitorados; preenchimento plano para a cor bater com a legenda. */

  var GEO_MARCA = null;
  function geometriasDeMarca() {
    if (GEO_MARCA) return GEO_MARCA;
    var piramide = new T.ConeGeometry(1.05, 1.9, 3);
    piramide.translate(0, 0.15, 0);
    GEO_MARCA = {
      acima_do_limite: piramide,
      banda_de_incerteza: new T.OctahedronGeometry(1.15),
      dentro_do_limite: new T.SphereGeometry(0.9, 20, 14),
      mono: new T.BoxGeometry(1.4, 1.4, 1.4)
    };
    return GEO_MARCA;
  }

  var TAMANHO_MARCA_PX = 5.5;

  /* ----- Viewport ----- */

  function criar(host, opcoes) {
    opcoes = opcoes || {};

    var renderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (erro) {
      host.innerHTML = "<p class=\"viewport__sem3d\">Este navegador não oferece WebGL, necessário para o modelo 3D.</p>";
      return { atualizar: function () { return {}; }, preset: function () {}, presetAtual: function () { return null; }, focarPonto: function () { return false; } };
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    host.appendChild(renderer.domElement);

    var cena = new T.Scene();
    var pmrem = new T.PMREMGenerator(renderer);
    cena.environment = pmrem.fromScene(ambienteEstudio(), 0.02).texture;
    cena.environmentIntensity = 0.85;

    var camera = new T.PerspectiveCamera(30, 1, 0.05, 80);

    var sol = new T.DirectionalLight(0xffffff, 2.1);
    sol.position.set(-3.2, 7.5, 5.2);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    sol.shadow.camera.left = -5; sol.shadow.camera.right = 5;
    sol.shadow.camera.top = 6; sol.shadow.camera.bottom = -5;
    sol.shadow.camera.near = 1; sol.shadow.camera.far = 20;
    sol.shadow.radius = 5;
    sol.shadow.bias = -0.0004;
    sol.shadow.normalBias = 0.02;
    cena.add(sol);
    cena.add(new T.HemisphereLight(0xf4f8ff, 0xd9d2c8, 0.55));

    var chao = new T.Mesh(new T.PlaneGeometry(30, 30), new T.ShadowMaterial({ opacity: 0.12 }));
    chao.rotation.x = -Math.PI / 2;
    chao.receiveShadow = true;
    cena.add(chao);
    var contato = new T.Mesh(new T.PlaneGeometry(4.6, 3.8), new T.MeshBasicMaterial({ map: texSombra(), transparent: true, depthWrite: false, toneMapped: false }));
    contato.rotation.x = -Math.PI / 2;
    contato.position.y = 0.002;
    cena.add(contato);

    var M = criarMateriais();
    var produto = new T.Group();
    cena.add(produto);

    var estado = {
      op: {}, chaveGeo: null, pecas: {}, lista: [],
      explode: 0, explodeAlvo: 0, raioX: false, reenquadro: null,
      foco: null, marcadores: [], sel: null, pairado: null,
      campo: false
    };

    /* ----- Construção das peças ----- */

    function chaveGeometria(op) {
      return [op.placa, op.alojamento, op.material, op.defletor, op.soprador].join("|");
    }

    function construirPecas(op) {
      var anteriores = estado.pecas;
      produto.clear();
      estado.pecas = {};
      estado.lista = FOGAO.pecas(op);

      estado.lista.forEach(function (pc) {
        var origem = centroDe(pc.b);
        var g = new T.Group();
        g.userData.pecaId = pc.id;
        g.position.copy(origem);
        var k = new Kit(g, origem);
        CONSTRUTORES[pc.id](k, pc, M, op);
        fundirEstaticos(g);

        var mats = [];
        // Deslocamento do explodido, lido pela pele termica para descontar o
        // afastamento: a peca leva a temperatura de onde ela mora montada.
        var uDesloc = { value: new T.Vector3() };
        g.traverse(function (o) {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          // Material próprio por peça: cada uma esmaece sem arrastar as outras.
          var lista = Array.isArray(o.material) ? o.material : [o.material];
          var reais = lista.map(function (m) {
            var c = m.clone();
            c.userData.opacidade = m.opacity;
            c.userData.transparente = m.transparent;
            mats.push(c);
            return c;
          });
          var argila = reais.map(function (m) {
            if (o.userData.semArgila) return m;
            var a = (m.color && m.color.getHSL({}).l < 0.25 ? M.argilaEscura : M.argila).clone();
            if (m.alphaMap) { a.alphaMap = m.alphaMap; a.alphaTest = m.alphaTest; a.side = T.DoubleSide; }
            a.userData.opacidade = 1;
            a.userData.transparente = false;
            mats.push(a);
            return a;
          });
          var termico = reais.map(function (m) {
            var t = materialTermico(m, uDesloc);
            mats.push(t);
            return t;
          });
          o.userData.real = Array.isArray(o.material) ? reais : reais[0];
          o.userData.argila = Array.isArray(o.material) ? argila : argila[0];
          o.userData.termico = Array.isArray(o.material) ? termico : termico[0];
          o.material = o.userData.real;
        });

        // Fantasma para peça ainda não montada: só as arestas, tracejadas.
        var caixa = new T.BoxGeometry(pc.b[3] * U, pc.b[5] * U, pc.b[4] * U);
        var fantasma = new T.LineSegments(new T.EdgesGeometry(caixa),
          new T.LineDashedMaterial({ color: 0x6f95b4, dashSize: 0.05, gapSize: 0.035, transparent: true, opacity: 0.7, depthWrite: false }));
        fantasma.computeLineDistances();
        fantasma.position.copy(origem);
        fantasma.visible = false;

        var raiz = new T.Group();
        raiz.add(g);
        raiz.add(fantasma);
        produto.add(raiz);

        var ant = anteriores[pc.id];
        estado.pecas[pc.id] = {
          pc: pc, raiz: raiz, corpo: g, fantasma: fantasma, origem: origem, mats: mats,
          uDesloc: uDesloc,
          opacidade: ant ? ant.opacidade : 1, opacidadeAlvo: 1,
          aparecer: ant ? ant.aparecer : (pc.present ? 1 : 0), marcas: new T.Group()
        };
        estado.pecas[pc.id].marcas.position.copy(origem);
        raiz.add(estado.pecas[pc.id].marcas);
      });
      renderer.shadowMap.needsUpdate = true;
    }

    /* Junta as malhas estáticas de mesmo material numa só: grade, aletas e
       venezianas viram poucas chamadas de desenho em vez de centenas. */
    function fundirEstaticos(g) {
      var porMaterial = new Map(), soltas = [];
      g.children.slice().forEach(function (o) {
        if (!o.isMesh || Array.isArray(o.material)) return;
        o.updateMatrix();
        var geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix);
        geo.clearGroups();
        Object.keys(geo.attributes).forEach(function (nome) {
          if (nome !== "position" && nome !== "normal" && nome !== "uv") geo.deleteAttribute(nome);
        });
        if (!geo.attributes.uv || !geo.attributes.normal) return;
        if (!porMaterial.has(o.material)) porMaterial.set(o.material, []);
        porMaterial.get(o.material).push(geo);
        soltas.push(o);
      });
      soltas.forEach(function (o) { g.remove(o); });
      porMaterial.forEach(function (geos, mat) {
        g.add(new T.Mesh(geos.length > 1 ? T.mergeGeometries(geos, false) : geos[0], mat));
      });
    }

    function aplicarModo() {
      var campo = estado.campo;
      var argila = estado.op.modo === "calor" && !campo;
      /* Argila sob luz mais dirigida: o volume lê por sombra, e as cores ficam
         só nos marcadores. No campo a luz recua ainda mais — ali a cor é o
         dado, e sombra demais falseia a leitura da escala. */
      cena.environmentIntensity = campo ? 0.38 : argila ? 0.45 : 0.85;
      sol.intensity = campo ? 1.15 : argila ? 2.8 : 2.1;
      estado.lista.forEach(function (pc) {
        estado.pecas[pc.id].corpo.traverse(function (o) {
          if (!o.isMesh || !o.userData.real) return;
          o.material = campo ? o.userData.termico : argila ? o.userData.argila : o.userData.real;
        });
      });
    }

    /* ----- Campo térmico -----
       Interpolação por distância inversa nos termopares, amostrada numa grade que vira textura
       de volume. Três camadas leem a mesma grade: a pele das peças, as fatias de volume e as
       linhas de fluxo. A animação só desloca a leitura no volume; o dado continua sendo a
       interpolação. */

    var DOM = FOGAO.CAIXA;
    /* Resolução da grade. Custa ~160 ms para montar, uma vez por troca de
       previsão, e é o que mantém as isotermas curvas: numa grade mais grossa a
       interpolação trilinear quebra o gradiente na borda da célula e as linhas
       saem facetadas. */
    var GRADE = { x: 64, y: 48, z: 60 };

    function texturaVolume(grade) {
      var t = new T.Data3DTexture(grade.dados, grade.nx, grade.ny, grade.nz);
      t.format = T.RedFormat;
      t.type = T.UnsignedByteType;
      t.minFilter = T.LinearFilter;
      t.magFilter = T.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = T.ClampToEdgeWrapping;
      t.unpackAlignment = 1;
      t.needsUpdate = true;
      return t;
    }

    function preencherRampa(px, rampa) {
      for (var i = 0, n = px.length / 4; i < n; i++) {
        var c = FOGAO.corDaRampa(rampa, i / (n - 1));
        px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
      }
    }

    function texturaRampa(rampa) {
      var n = 256, px = new Uint8Array(n * 4);
      preencherRampa(px, rampa);
      var t = new T.DataTexture(px, n, 1, T.RGBAFormat);
      t.colorSpace = T.SRGBColorSpace;
      t.minFilter = T.LinearFilter;
      t.magFilter = T.LinearFilter;
      t.needsUpdate = true;
      return t;
    }

    /* Uniformes compartilhados por referência: trocar a grade, o tempo ou a
       força das isotermas atinge as três camadas numa atribuição só. */
    var RAMPAS = { absoluto: texturaRampa(FOGAO.RAMPA_CAMPO), diferenca: texturaRampa(FOGAO.RAMPA_DIFF) };
    var UC = {
      uCampo: { value: texturaVolume({ dados: new Uint8Array([128]), nx: 1, ny: 1, nz: 1 }) },
      uRampa: { value: RAMPAS.absoluto },
      // 1 no modo diferença: o volume mostra os dois sentidos a partir do meio neutro.
      uDiverge: { value: 0 },
      uTempo: { value: 0 },
      uOnda: { value: 1 },
      uIso: { value: 11 },
      uForcaIso: { value: 0.55 }
    };

    function comUC(extra) {
      var u = {};
      Object.keys(UC).forEach(function (k) { u[k] = UC[k]; });
      Object.keys(extra || {}).forEach(function (k) { u[k] = extra[k]; });
      return u;
    }

    var INV_U = (1 / U).toFixed(1);

    /* Trecho comum aos três shaders: leitura do volume, cor e isotermas.
       `campoUVW` desfaz `mundo()` — da cena para as coordenadas do modelo, e
       daí para 0–1 na caixa. */
    var GLSL_CAMPO = [
      "uniform highp sampler3D uCampo;",
      "uniform sampler2D uRampa;",
      "uniform float uTempo;",
      "uniform float uOnda;",
      "uniform float uIso;",
      "uniform float uForcaIso;",
      "uniform float uDiverge;",
      "vec3 campoNorm(vec3 p) {",
      "  vec3 m = vec3(p.x * " + INV_U + " + 160.0, 120.0 - p.z * " + INV_U + ", p.y * " + INV_U + ");",
      "  return m / vec3(" + DOM.x.toFixed(1) + ", " + DOM.y.toFixed(1) + ", " + DOM.z.toFixed(1) + ");",
      "}",
      "vec3 campoUVW(vec3 p) { return clamp(campoNorm(p), vec3(0.004), vec3(0.996)); }",
      // A onda desloca a leitura dentro do volume: o campo parece mexido, e
      // nenhum valor é criado fora do que a grade já contém.
      "float campoEm(vec3 p) {",
      "  vec3 q = campoUVW(p);",
      "  vec3 d = vec3(sin(uTempo * 0.90 + q.y * 19.0 + q.z * 11.0),",
      "                sin(uTempo * 0.74 + q.z * 17.0 + q.x * 13.0),",
      "                sin(uTempo * 1.13 + q.x * 15.0 + q.y *  9.0));",
      "  q = clamp(q + d * uOnda * 0.012, vec3(0.004), vec3(0.996));",
      "  return texture(uCampo, q).r;",
      "}",
      "vec3 corCampo(float v) { return texture(uRampa, vec2(clamp(v, 0.0, 1.0), 0.5)).rgb; }",
      // Isotermas: uma franja escura a cada degrau da escala, deslizando.
      "float isoFranja(float v) {",
      "  float f = fract(v * uIso - uTempo * 0.33);",
      "  return 1.0 - smoothstep(0.0, 0.06, min(f, 1.0 - f));",
      "}"
    ].join("\n");

    /* Pele térmica: o material da peça com a cor trocada pela do campo no
       ponto que a peça ocupa montada. `uDesloc` desconta o explodido — a peça
       afastada leva a temperatura de onde ela mora, não a do ar em que flutua. */
    function materialTermico(base, uDesloc) {
      var m = new T.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.62, metalness: 0,
        alphaMap: base.alphaMap || null,
        alphaTest: base.alphaTest || 0,
        side: base.side,
        emissive: 0xffffff,
        transparent: base.transparent,
        opacity: base.opacity
      });
      m.userData.opacidade = base.userData.opacidade == null ? 1 : base.userData.opacidade;
      m.userData.transparente = base.userData.transparente;
      m.onBeforeCompile = function (sh) {
        Object.keys(UC).forEach(function (k) { sh.uniforms[k] = UC[k]; });
        sh.uniforms.uDesloc = uDesloc;
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vCampoP;")
          .replace("#include <begin_vertex>",
            "#include <begin_vertex>\nvCampoP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>",
            "#include <common>\nvarying vec3 vCampoP;\nuniform vec3 uDesloc;\n" + GLSL_CAMPO)
          .replace("#include <map_fragment>", [
            "#include <map_fragment>",
            "float campoV = campoEm(vCampoP - uDesloc);",
            "vec3 campoCor = corCampo(campoV);",
            "campoCor = mix(campoCor, campoCor * 0.32, isoFranja(campoV) * uForcaIso);",
            "diffuseColor.rgb = campoCor;"
          ].join("\n"))
          .replace("#include <emissivemap_fragment>", [
            "#include <emissivemap_fragment>",
            // Borda acesa: a silhueta da peça segue legível quando ela e a
            // vizinha caem na mesma isoterma.
            "float campoRim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);",
            "totalEmissiveRadiance = campoCor * (0.26 + 0.50 * campoRim);"
          ].join("\n"));
      };
      // Todos compilam o mesmo programa; o que muda são os uniformes.
      m.customProgramCacheKey = function () { return "campo-termico"; };
      return m;
    }

    /* ----- Camada de volume -----
       Vinte fatias horizontais que ondulam; só o quente aparece. */
    var grupoVolume = new T.Group();
    (function () {
      var geo = new T.PlaneGeometry(DOM.x * U * 1.02, DOM.y * U * 1.02, 48, 36);
      geo.rotateX(-Math.PI / 2);
      var mat = new T.ShaderMaterial({
        uniforms: comUC({ uAlfa: { value: 0.17 } }),
        transparent: true, depthWrite: false, side: T.DoubleSide,
        vertexShader: [
          "varying vec3 vP;",
          "uniform float uTempo;",
          "uniform float uOnda;",
          "void main() {",
          "  vec3 p = position;",
          "  float w = sin(p.x * 8.5 + uTempo * 1.5 + p.z * 4.0) + sin(p.z * 11.0 - uTempo * 1.05);",
          "  p.y += w * uOnda * 0.018;",
          "  vec4 mp = modelMatrix * vec4(p, 1.0);",
          "  vP = mp.xyz;",
          "  gl_Position = projectionMatrix * viewMatrix * mp;",
          "}"
        ].join("\n"),
        fragmentShader: [
          "varying vec3 vP;",
          "uniform float uAlfa;",
          GLSL_CAMPO,
          "void main() {",
          "  float v = campoEm(vP);",
          "  vec3 q = campoNorm(vP);",
          // Desvanece na borda do domínio: senão o retângulo da fatia aparece
          // como se fosse uma parede, e ali não há produto nenhum.
          "  float borda = smoothstep(0.0, 0.11, q.x) * smoothstep(1.0, 0.89, q.x)",
          "              * smoothstep(0.0, 0.11, q.y) * smoothstep(1.0, 0.89, q.y);",
          // Na diferença conta a distância ao meio: mais frio e mais quente aparecem, o neutro some.
          "  float s = uDiverge > 0.5 ? abs(v - 0.5) * 2.0 : v;",
          "  float a = uAlfa * borda * smoothstep(uDiverge > 0.5 ? 0.1 : 0.34, 0.95, s);",
          "  if (a < 0.004) discard;",
          "  vec3 c = corCampo(v);",
          "  c = mix(c, c * 0.45, isoFranja(v) * uForcaIso);",
          "  gl_FragColor = vec4(c, a);",
          "  #include <tonemapping_fragment>",
          "  #include <colorspace_fragment>",
          "}"
        ].join("\n")
      });
      for (var i = 0; i < 20; i++) {
        var fatia = new T.Mesh(geo, mat);
        fatia.position.set(0, (8 + i * 17) * U, 0);
        fatia.renderOrder = 3;
        grupoVolume.add(fatia);
      }
      // Arame do domínio: a caixa em que o campo foi interpolado fica declarada.
      var fio = new T.LineSegments(
        new T.EdgesGeometry(new T.BoxGeometry(DOM.x * U, DOM.z * U, DOM.y * U)),
        new T.LineBasicMaterial({ color: corDoTema("--color-3d-arame", 0x2b3038), transparent: true, opacity: 0.35 }));
      fio.position.y = DOM.z / 2 * U;
      grupoVolume.userData.fio = fio;
      grupoVolume.add(fio);
      grupoVolume.visible = false;
      cena.add(grupoVolume);
    })();

    /* ----- Camada de fluxo -----
       Campo de velocidade aproximado, para visualização, sem resolver Navier-Stokes: jato do
       soprador, empuxo pela temperatura, giro nas bobinas e sucção pelo fundo. */
    function velocidadeNo(x, y, z, amostras, eq, sentido, v) {
      // Jato do soprador, espalhando ao se afastar da boca.
      var dx = (x - 88) / 72, dz = (z - 19) / 44;
      v.set(0, sentido * 34 * Math.exp(-(dx * dx + dz * dz)), 0);
      // Empuxo: o ar sobe onde está quente, e é o que leva o jato ao cooktop.
      var t = eq.normalizar(FOGAO.valorEm(amostras, x, y, z));
      v.z += 7 + 48 * t * t;
      // Giro em torno das bobinas, forte só perto do plano do cooktop. O ganho
      // é da ordem do empuxo de propósito: abaixo disso a linha sobe reta e o
      // desenho perde justamente a recirculação que interessa ver.
      var alt = Math.exp(-Math.pow((z - 278) / 95, 2));
      for (var i = 0; i < FOGAO.POSICOES.length; i++) {
        var c = FOGAO.POSICOES[i];
        var rx = x - c[1], ry = y - c[2], r = Math.sqrt(rx * rx + ry * ry) + 1;
        var g = 46000 / (r * r + 340) * alt;
        v.x += -ry / r * g;
        v.y += rx / r * g;
      }
      // Recirculação de fundo, só função da posição: as linhas se separam sem
      // nunca se cruzarem, que é o que um campo de velocidade permite.
      v.x += 9 * Math.sin(z * 0.041 + y * 0.017);
      v.y += 9 * Math.cos(z * 0.037 + x * 0.019);
      // Sucção pelas venezianas da traseira, na meia altura do produto.
      v.y += 18 * Math.exp(-Math.pow((y - 240) / 74, 2)) * Math.exp(-Math.pow((z - 150) / 130, 2));
      return v;
    }

    function trajetoria(semente, amostras, eq, sentido) {
      var p = new T.Vector3(semente[0], semente[1], semente[2]);
      var v = new T.Vector3(), pts = [];
      for (var s = 0; s < 150; s++) {
        if (p.x < -12 || p.x > DOM.x + 12 || p.y < -12 || p.y > DOM.y + 12 || p.z < -6 || p.z > DOM.z + 52) break;
        pts.push(mundo(p.x, p.y, p.z));
        velocidadeNo(p.x, p.y, p.z, amostras, eq, sentido, v);
        var n = v.length();
        if (n < 1e-3) break;
        p.addScaledVector(v, 4.2 / n);
      }
      return pts;
    }

    var grupoFluxo = new T.Group();
    var matFluxo = new T.ShaderMaterial({
      uniforms: comUC({ uAlfa: { value: 0.95 } }),
      transparent: true, depthWrite: false,
      vertexShader: [
        "attribute float aFase;",
        "varying vec3 vP;",
        "varying vec2 vUvF;",
        "varying float vFase;",
        "void main() {",
        "  vec4 mp = modelMatrix * vec4(position, 1.0);",
        "  vP = mp.xyz; vUvF = uv; vFase = aFase;",
        "  gl_Position = projectionMatrix * viewMatrix * mp;",
        "}"
      ].join("\n"),
      fragmentShader: [
        "varying vec3 vP;",
        "varying vec2 vUvF;",
        "varying float vFase;",
        "uniform float uAlfa;",
        GLSL_CAMPO,
        "void main() {",
        "  float v = campoEm(vP);",
        "  vec3 c = corCampo(v);",
        // Contas de luz correndo pela linha: o sentido do escoamento fica visível.
        "  float pulso = pow(fract(vUvF.x * 5.0 - uTempo * 0.20 + vFase), 4.0);",
        "  vec3 cor = mix(c * 0.75, mix(c, vec3(1.0), 0.35), pulso);",
        "  gl_FragColor = vec4(cor, uAlfa * (0.42 + 0.58 * pulso));",
        "  #include <tonemapping_fragment>",
        "  #include <colorspace_fragment>",
        "}"
      ].join("\n")
    });
    /* Réplica sem teste de profundidade: a linha que passa dentro do produto
       segue visível, apagada, no mesmo truque dos marcadores. */
    var matFluxoVelado = matFluxo.clone();
    matFluxoVelado.uniforms = comUC({ uAlfa: { value: 0.16 } });
    matFluxoVelado.depthTest = false;
    grupoFluxo.visible = false;
    cena.add(grupoFluxo);

    function construirFluxo(amostras, eq, sentido) {
      grupoFluxo.children.slice().forEach(function (o) {
        grupoFluxo.remove(o);
        if (o.geometry) o.geometry.dispose();
      });
      var sementes = [], i, j;
      // Boca do soprador e coroa de cada bobina: é por onde o ar entra no campo.
      for (i = 0; i < 7; i++) for (j = 0; j < 2; j++) {
        sementes.push([46 + i * 15, sentido > 0 ? 192 : 138, 12 + j * 15, (i * 2 + j) / 14]);
      }
      FOGAO.POSICOES.forEach(function (c, n) {
        for (var a = 0; a < 5; a++) {
          var ang = a / 5 * Math.PI * 2 + 0.6, raio = FOGAO.RAIO_BOBINA[c[0]] + 16;
          sementes.push([c[1] + Math.cos(ang) * raio, c[2] + Math.sin(ang) * raio, 252, (n * 5 + a) / 20]);
        }
      });

      var geos = [];
      sementes.forEach(function (s) {
        var pts = trajetoria(s, amostras, eq, sentido);
        if (pts.length < 8) return;
        var curva = new T.CatmullRomCurve3(pts, false, "catmullrom", 0.2);
        var geo = new T.TubeGeometry(curva, pts.length, 1.7 * U, 5, false);
        var fase = new Float32Array(geo.attributes.position.count).fill(s[3]);
        geo.setAttribute("aFase", new T.BufferAttribute(fase, 1));
        geos.push(geo);
      });
      if (!geos.length) return;

      var tudo = geos.length > 1 ? T.mergeGeometries(geos, false) : geos[0];
      if (geos.length > 1) geos.forEach(function (g) { g.dispose(); });
      var nitido = new T.Mesh(tudo, matFluxo);
      nitido.renderOrder = 4;
      var velado = new T.Mesh(tudo, matFluxoVelado);
      velado.renderOrder = 6;
      grupoFluxo.add(nitido, velado);
    }

    /* ----- Focos quentes -----
       Halo pulsante nos termopares mais quentes: marca onde o campo tem pico
       medido, e não só onde ele está alto por vizinhança. */
    var grupoFocos = new T.Group();
    grupoFocos.visible = false;
    cena.add(grupoFocos);
    var TEX_FOCO = textura(128, 128, function (c, w) {
      var g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,255,255,0.42)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g; c.fillRect(0, 0, w, w);
    });
    var GEO_FOCO = new T.PlaneGeometry(1, 1);

    // `valor` lê o número que o campo interpola; na diferença os focos são as maiores variações.
    function construirFocos(colocados, eq, valor, rampa, diverge) {
      grupoFocos.children.slice().forEach(function (o) {
        grupoFocos.remove(o);
        o.material.dispose();
      });
      function peso(c) { return diverge ? Math.abs(valor(c)) : valor(c); }
      colocados.slice()
        .filter(function (c) { return !diverge || eq.normalizar(valor(c)) !== 0.5; })
        .sort(function (a, b) { return peso(b) - peso(a); })
        .slice(0, 10)
        .forEach(function (c, i) {
          var rgb = FOGAO.corDaRampa(rampa, eq.normalizar(valor(c)));
          var halo = new T.Mesh(GEO_FOCO, new T.MeshBasicMaterial({
            map: TEX_FOCO, color: new T.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255),
            transparent: true, depthWrite: false, depthTest: false,
            blending: T.AdditiveBlending, toneMapped: false, opacity: 0.4
          }));
          halo.position.copy(mundo(c.g[0], c.g[1], c.g[2]));
          halo.renderOrder = 7;
          halo.userData.fase = i / 10;
          grupoFocos.add(halo);
        });
    }

    /* ----- Montagem do campo ----- */

    /* `op.diferenca` ({ extremo, limiar }) liga o modo diferença: o campo
       interpola `diferenca_c` de cada ponto numa escala linear centrada em
       zero, e não a temperatura equalizada por quantil. O fluxo de ar segue
       movido pela temperatura, que é o que empurra o ar. */
    function construirCampo(colocados, op) {
      var dif = op.diferenca || null;
      function valor(c) { return dif ? c.ponto.diferenca_c : c.ponto.temperatura_prevista_c; }
      function amostra(c, v) { return { x: c.g[0], y: c.g[1], z: c.g[2], v: v }; }
      var amostras = colocados.map(function (c) { return amostra(c, valor(c)); });
      if (!amostras.length) return null;

      // Guardadas em graus: a sonda responde em °C, não na escala normalizada.
      estado.campoAmostras = amostras;
      var temps = dif ? colocados.map(function (c) { return amostra(c, c.ponto.temperatura_prevista_c); }) : amostras;
      var eqTemp = FOGAO.equalizador(temps.map(function (a) { return a.v; }));
      var eq = dif ? FOGAO.normalizadorDivergente(dif.extremo, dif.limiar) : eqTemp;
      var grade = FOGAO.grade3D(amostras, eq, GRADE.x, GRADE.y, GRADE.z);
      if (UC.uCampo.value) UC.uCampo.value.dispose();
      UC.uCampo.value = texturaVolume(grade);
      UC.uRampa.value = dif ? RAMPAS.diferenca : RAMPAS.absoluto;
      UC.uDiverge.value = dif ? 1 : 0;
      estado.campoLeitura = { colocados: colocados, valor: valor, eq: eq, rampa: dif ? FOGAO.RAMPA_DIFF : FOGAO.RAMPA_CAMPO };

      construirFluxo(temps, eqTemp, op.soprador === "back" ? 1 : -1);
      construirFocos(colocados, eq, valor, dif ? FOGAO.RAMPA_DIFF : FOGAO.RAMPA_CAMPO, !!dif);
      renderer.shadowMap.needsUpdate = true;

      var paradas = [0, 0.25, 0.5, 0.75, 1].map(function (f) { return eq.quantil(f); });
      return { min: paradas[0], max: paradas[4], paradas: paradas, diferenca: !!dif };
    }

    // Camadas ligadas pela barra do viewport; sem pedido, todas ligadas.
    function aplicarCamadas(op) {
      var c = op.camadas || {};
      function liga(v) { return v !== false; }
      grupoVolume.visible = estado.campo && liga(c.volume);
      grupoFluxo.visible = estado.campo && liga(c.fluxo);
      grupoFocos.visible = estado.campo && liga(c.focos);
      UC.uForcaIso.value = liga(c.iso) ? 0.55 : 0;
      UC.uOnda.value = movimentoReduzido.matches ? 0 : 1;
    }

    /* ----- Marcadores ----- */

    /* Uma malha instanciada por forma e por passe (preenchimento, contorno e
       réplica em transparência): 12 chamadas de desenho para os 78 pontos. */
    var FORMAS = ["acima_do_limite", "banda_de_incerteza", "dentro_do_limite", "mono"];
    var CAPACIDADE = 128;
    var instancias = {};
    (function () {
      var G = geometriasDeMarca();
      FORMAS.forEach(function (forma) {
        var fill = new T.InstancedMesh(G[forma], new T.MeshBasicMaterial({ toneMapped: false }), CAPACIDADE);
        var borda = new T.InstancedMesh(G[forma], new T.MeshBasicMaterial({ side: T.BackSide, toneMapped: false }), CAPACIDADE);
        // Réplica sem teste de profundidade: o ponto atrás de uma peça segue visível, apagado.
        var raio = new T.InstancedMesh(G[forma], new T.MeshBasicMaterial({ transparent: true, opacity: 0.26, depthTest: false, depthWrite: false, toneMapped: false }), CAPACIDADE);
        raio.renderOrder = 5;
        [fill, borda, raio].forEach(function (m) {
          m.count = 0;
          m.frustumCulled = false;
          m.instanceMatrix.setUsage(T.DynamicDrawUsage);
          cena.add(m);
        });
        instancias[forma] = { fill: fill, borda: borda, raio: raio };
      });
    })();

    function construirMarcadores(op) {
      estado.marcadores = [];
      estado.lista.forEach(function (pc) { estado.pecas[pc.id].marcas.clear(); });
      FORMAS.forEach(function (f) { instancias[f].fill.count = instancias[f].borda.count = instancias[f].raio.count = 0; });
      if (op.modo !== "calor" || !op.pontos || estado.campo) return;

      var rampa = op.escala === "b" ? FOGAO.RAMPA_B : FOGAO.RAMPA_A;
      var iso = op.isolar || "todos";
      var hastes = {}, cor = new T.Color();

      FOGAO.posicionarPontos(op.pontos, estado.lista).forEach(function (item) {
        var p = item.ponto, peca = estado.pecas[item.peca];
        if (!peca) return;
        if (op.foco && p.Key_Area !== op.foco) return;
        var mono = p.is_monitor_only;
        var dentro = iso === "todos" || p.Key_Area === iso;
        var forma = mono ? "mono" : FORMAS.indexOf(p.estado) >= 0 ? p.estado : "dentro_do_limite";
        var inst = instancias[forma], i = inst.fill.count;
        if (i >= CAPACIDADE) return;
        inst.fill.count = inst.borda.count = inst.raio.count = i + 1;

        cor.set(!dentro || mono ? "#ffffff" : rampa[FOGAO.faixaDaRampa(p.margem_percentual)]);
        inst.fill.setColorAt(i, cor);
        inst.raio.setColorAt(i, cor);
        cor.set(mono ? "#767777" : dentro ? "#2b2c2c" : "#c9ccd0");
        inst.borda.setColorAt(i, cor);

        var m = { ponto: p, dentro: dentro, peca: item.peca, forma: forma, i: i, base: mundo(item.g[0], item.g[1], item.g[2]), mundo: new T.Vector3(), visivel: true };
        /* Já nasce onde a peça está: cada passo do slider refaz os marcadores,
           e um clique antes do próximo quadro os acharia todos na origem. */
        m.mundo.copy(m.base).add(peca.raiz.position);
        m.visivel = peca.opacidade > 0.3 && peca.corpo.visible;
        estado.marcadores.push(m);

        if (item.haste != null) {
          (hastes[item.peca] = hastes[item.peca] || []).push(
            mundo(item.g[0], item.g[1], item.haste).sub(peca.origem), m.base.clone().sub(peca.origem));
        }
      });

      FORMAS.forEach(function (f) {
        ["fill", "borda", "raio"].forEach(function (k) {
          if (instancias[f][k].instanceColor) instancias[f][k].instanceColor.needsUpdate = true;
        });
      });
      Object.keys(hastes).forEach(function (id) {
        estado.pecas[id].marcas.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(hastes[id]),
          new T.LineBasicMaterial({ color: 0x9aa3ab, transparent: true, opacity: 0.8 })));
      });
    }

    // Marcadores com tamanho constante na tela, virados para a câmera.
    var mTmp = new T.Matrix4(), escTmp = new T.Vector3();
    function posicionarMarcadores(pxMundo) {
      estado.marcadores.forEach(function (m) {
        var peca = estado.pecas[m.peca];
        m.visivel = peca.opacidade > 0.3 && peca.corpo.visible;
        m.mundo.copy(m.base).add(peca.raiz.position);
        var s = m.visivel ? m.mundo.distanceTo(camera.position) * pxMundo * TAMANHO_MARCA_PX : 0;
        if (estado.pairado === m) s *= 1.45;
        var inst = instancias[m.forma];
        mTmp.compose(m.mundo, camera.quaternion, escTmp.setScalar(s));
        inst.fill.setMatrixAt(m.i, mTmp);
        inst.raio.setMatrixAt(m.i, mTmp);
        mTmp.compose(m.mundo, camera.quaternion, escTmp.setScalar(s * 1.28));
        inst.borda.setMatrixAt(m.i, mTmp);
      });
      FORMAS.forEach(function (f) {
        instancias[f].fill.instanceMatrix.needsUpdate = true;
        instancias[f].borda.instanceMatrix.needsUpdate = true;
        instancias[f].raio.instanceMatrix.needsUpdate = true;
      });
    }

    var anelSel = new T.Group();
    (function () {
      var a = new T.Mesh(new T.RingGeometry(1.55, 1.95, 48), new T.MeshBasicMaterial({ color: corDoTema("--color-selecao", 0x0d436b), depthTest: false, transparent: true, toneMapped: false }));
      var eco = new T.Mesh(new T.RingGeometry(2.2, 2.45, 48), new T.MeshBasicMaterial({ color: corDoTema("--color-selecao", 0x0d436b), depthTest: false, transparent: true, opacity: 0.35, toneMapped: false }));
      a.renderOrder = eco.renderOrder = 10;
      anelSel.add(a, eco);
      anelSel.userData.eco = eco;
      anelSel.visible = false;
      cena.add(anelSel);
    })();

    /* ----- Halo de incerteza -----
       Disco atrás do ponto selecionado e do ponto sob o cursor, com raio de
       `op.haloDoPonto(ponto)`; 0 ou ausente, sem halo. Não muda cor nem forma do marcador. */
    function criarHalo() {
      var g = new T.Group();
      var disco = new T.Mesh(new T.CircleGeometry(1, 48), new T.MeshBasicMaterial({ color: corDoTema("--color-3d-halo", 0x5d6675), transparent: true, opacity: 0.16, depthTest: false, depthWrite: false, toneMapped: false }));
      var borda = new T.Mesh(new T.RingGeometry(0.97, 1, 64), new T.MeshBasicMaterial({ color: corDoTema("--color-3d-halo", 0x5d6675), transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false }));
      // Abaixo da réplica em transparência dos marcadores (5) e do anel de seleção (10).
      disco.renderOrder = borda.renderOrder = 4;
      g.add(disco, borda);
      g.visible = false;
      cena.add(g);
      return g;
    }
    var haloSel = criarHalo(), haloPairado = criarHalo();

    function posicionarHalo(halo, m, pxMundo) {
      var raio = m && m.visivel && estado.op.haloDoPonto ? estado.op.haloDoPonto(m.ponto) : 0;
      halo.visible = raio > 0;
      halo.userData.raio = raio;
      if (!halo.visible) return;
      halo.position.copy(m.mundo);
      halo.scale.setScalar(m.mundo.distanceTo(camera.position) * pxMundo * TAMANHO_MARCA_PX * raio);
      halo.quaternion.copy(camera.quaternion);
    }

    /* ----- Realce de peça -----
       Casca sobre a geometria, sem trocar o material: borda acesa (fresnel), parte oculta em
       raio-X tênue e arestas em contorno. `sel` entra com um pulso, `pairar` é a sugestão sob
       o cursor e `nega` pisca em cinza na peça sem dado. */
    /* `campo` troca os pesos no campo térmico: ali a pele da peça é o dado, e
       preenchê-la de branco apagaria a temperatura que se quer ler. Sobra a
       borda e o contorno. */
    var TIPOS_REALCE = {
      sel: { cor: 0x00a0dd, alfa: 0.10, borda: 0.60, oculto: 0.20, arestas: 0.95, cantos: 1, pulso: true, campo: { alfa: 0, borda: 0, oculto: 0, arestas: 0.1, cantos: 1 } },
      pairar: { cor: 0x00a0dd, alfa: 0.04, borda: 0.32, oculto: 0, arestas: 0.35, cantos: 0, pulso: false, campo: { alfa: 0, borda: 0, oculto: 0, arestas: 0, cantos: 0.55 } },
      nega: { cor: corDoTema("--color-3d-nega", 0x505863).getHex(), alfa: 0, borda: 0.18, oculto: 0, arestas: 0.8, cantos: 0, pulso: true, vida: 0.75 }
    };

    /* Colchetes nos oito cantos da caixa da peça, ou do quadrado que cerca a
       região da zona. Marcam a seleção sem cobrir nada: no campo térmico é o
       único realce que fica, porque ali qualquer tinta sobre a peça falseia a
       cor que é o dado. */
    function geometriaCantos(pc, zona) {
      var b = pc.b, x0 = b[0], x1 = b[0] + b[3], y0 = b[1], y1 = b[1] + b[4], z0 = b[2], z1 = b[2] + b[5];
      if (zona && zona.regiao) {
        var g = zona.regiao;
        x0 = g.x - g.r; x1 = g.x + g.r; y0 = g.y - g.r; y1 = g.y + g.r;
      }
      // Folga de 3 unidades para o colchete não encostar na chapa.
      x0 -= 3; y0 -= 3; z0 -= 3; x1 += 3; y1 += 3; z1 += 3;
      var f = 0.22, pts = [];
      [x0, x1].forEach(function (x) {
        [y0, y1].forEach(function (y) {
          [z0, z1].forEach(function (z) {
            var c = mundo(x, y, z);
            pts.push(c, mundo(x + (x === x0 ? 1 : -1) * (x1 - x0) * f, y, z));
            pts.push(c, mundo(x, y + (y === y0 ? 1 : -1) * (y1 - y0) * f, z));
            pts.push(c, mundo(x, y, z + (z === z0 ? 1 : -1) * (z1 - z0) * f));
          });
        });
      });
      return new T.BufferGeometry().setFromPoints(pts);
    }
    var DURACAO_PULSO = 1.3;

    var GLSL_REALCE_V = [
      "varying vec3 vMundo;",
      "#ifndef LINHA",
      "varying vec3 vNormalM;",
      "#endif",
      "void main() {",
      "  vec4 mp = modelMatrix * vec4(position, 1.0);",
      "  vMundo = mp.xyz;",
      "#ifndef LINHA",
      "  vNormalM = normalize(mat3(modelMatrix) * normal);",
      "#endif",
      "  gl_Position = projectionMatrix * viewMatrix * mp;",
      // Linha não aceita polygonOffset: o recuo em profundidade é feito à mão.
      "#ifdef LINHA",
      "  gl_Position.z -= 1.5e-5 * gl_Position.w;",
      "#endif",
      "}"
    ].join("\n");

    var GLSL_REALCE_F = [
      "uniform vec3 uCor;",
      "uniform float uAlfa;",
      "uniform float uBorda;",
      "uniform float uPulso;",
      // xz do centro e raio, na cena; raio zero desliga o recorte.
      "uniform vec3 uRegiao;",
      "varying vec3 vMundo;",
      "#ifndef LINHA",
      "varying vec3 vNormalM;",
      "#endif",
      "void main() {",
      "  if (uRegiao.z > 0.0 && distance(vMundo.xz, uRegiao.xy) > uRegiao.z) discard;",
      "#ifdef LINHA",
      "  float a = uAlfa * (1.0 + uPulso * 0.4);",
      "  vec3 c = mix(uCor, vec3(1.0), uPulso * 0.35);",
      "#else",
      // Face dupla: o módulo do cosseno acende a borda dos dois lados da chapa.
      "  float rim = 1.0 - abs(dot(normalize(vNormalM), normalize(cameraPosition - vMundo)));",
      "  rim *= rim;",
      "  float a = uAlfa + uBorda * rim + uPulso * 0.42;",
      "  vec3 c = uCor * (0.9 + 0.5 * rim) + vec3(uPulso * 0.28);",
      "#endif",
      "  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));",
      "  #include <colorspace_fragment>",
      "}"
    ].join("\n");

    function materialRealce(passe) {
      var m = new T.ShaderMaterial({
        uniforms: {
          uCor: { value: new T.Color() },
          uAlfa: { value: 0 }, uBorda: { value: 0 }, uPulso: { value: 0 },
          uRegiao: { value: new T.Vector3() }
        },
        defines: passe === "arestas" ? { LINHA: "" } : {},
        vertexShader: GLSL_REALCE_V,
        fragmentShader: GLSL_REALCE_F,
        transparent: true, depthWrite: false, side: T.DoubleSide
      });
      // Um fio à frente da superfície que ele cobre: sem isso as duas brigam pelo mesmo pixel.
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
      // O oculto só passa onde há algo na frente.
      if (passe === "oculto") m.depthFunc = T.GreaterDepth;
      return m;
    }

    // Arestas vivas por geometria, calculadas uma vez: a malha fundida não muda.
    var cacheArestas = new WeakMap();
    function arestasDe(geo) {
      if (!cacheArestas.has(geo)) cacheArestas.set(geo, new T.EdgesGeometry(geo, 32));
      return cacheArestas.get(geo);
    }

    var realces = { sel: null, pairar: null, nega: null };

    function montarRealce(tipo, id, zona) {
      var p = estado.pecas[id], cfg = TIPOS_REALCE[tipo];
      if (!p) return null;
      var grupo = new T.Group(), pares = [], mats = [];
      var passes = [["superficie", T.Mesh, 9]];
      if (cfg.oculto) passes.push(["oculto", T.Mesh, 9]);
      if (cfg.arestas) passes.push(["arestas", T.LineSegments, 10]);

      var porPasse = {};
      passes.forEach(function (ps) { porPasse[ps[0]] = materialRealce(ps[0]); mats.push(porPasse[ps[0]]); });

      p.corpo.updateMatrixWorld(true);
      p.corpo.traverse(function (o) {
        if (!o.isMesh || !o.geometry.attributes.normal) return;
        passes.forEach(function (ps) {
          var geo = ps[0] === "arestas" ? arestasDe(o.geometry) : o.geometry;
          var copia = new ps[1](geo, porPasse[ps[0]]);
          copia.matrixAutoUpdate = false;
          copia.frustumCulled = false;
          copia.renderOrder = ps[2];
          grupo.add(copia);
          pares.push([copia, o]);
        });
      });
      var cantos = null;
      if (cfg.cantos || (cfg.campo && cfg.campo.cantos)) {
        var matCantos = new T.LineBasicMaterial({ color: cfg.cor, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
        cantos = new T.LineSegments(geometriaCantos(p.pc, zona), matCantos);
        cantos.renderOrder = 11;
        cantos.frustumCulled = false;
        grupo.add(cantos);
        mats.push(matCantos);
      }

      cena.add(grupo);
      return { tipo: tipo, cfg: cfg, id: id, zona: zona || null, grupo: grupo, pares: pares, porPasse: porPasse, mats: mats, cantos: cantos, t0: performance.now() };
    }

    function descartarRealce(r) {
      if (!r) return;
      cena.remove(r.grupo);
      r.mats.forEach(function (m) { m.dispose(); });
      if (r.cantos) r.cantos.geometry.dispose();
    }

    function trocarRealce(tipo, novo) {
      descartarRealce(realces[tipo]);
      realces[tipo] = novo;
      pedir();
    }

    var corCampoRealce = new T.Color(0xffffff);

    // Acompanha a peça no explodido e no rotor, e devolve se ainda anima.
    function atualizarRealce(r, agora) {
      if (!r) return false;
      var p = estado.pecas[r.id];
      if (!p) return false;
      r.grupo.visible = p.pc.present && p.corpo.visible && p.opacidade > 0.3;
      if (!r.grupo.visible) return false;

      var t = (agora - r.t0) / 1000;
      var pulso = 0;
      if (r.cfg.pulso && !movimentoReduzido.matches && t < DURACAO_PULSO) {
        // Duas batidas que se apagam: lê como confirmação, não como alarme.
        pulso = Math.exp(-t * 3.4) * (0.55 + 0.45 * Math.cos(t * Math.PI * 2 * 2.2));
      }
      var cfg = r.cfg;
      // No campo a pele já é a escala de cor: o realce passa a branco para não virar mais uma temperatura.
      var cor = estado.campo && r.tipo !== "nega" ? corCampoRealce : null;
      var zr = r.zona && r.zona.regiao;
      var cx = 0, cz = 0, raio = 0;
      if (zr) {
        cx = (zr.x - 160) * U + p.raiz.position.x;
        cz = (120 - zr.y) * U + p.raiz.position.z;
        raio = zr.r * U;
      }
      var pesos = estado.campo && cfg.campo ? cfg.campo : cfg;
      Object.keys(r.porPasse).forEach(function (passe) {
        var u = r.porPasse[passe].uniforms;
        if (cor) u.uCor.value.copy(cor); else u.uCor.value.setHex(cfg.cor);
        // No campo o pulso também não pode cobrir a escala.
        u.uPulso.value = estado.campo ? pulso * 0.5 : pulso;
        u.uRegiao.value.set(cx, cz, raio);
        var peso = passe === "superficie" ? pesos.alfa + pesos.borda : passe === "oculto" ? pesos.oculto : pesos.arestas;
        // Passe zerado sai do desenho, em vez de desenhar transparente por cima.
        r.porPasse[passe].visible = peso > 0 || pulso > 0.02;
        if (passe === "superficie") { u.uAlfa.value = pesos.alfa; u.uBorda.value = pesos.borda; }
        else if (passe === "oculto") { u.uAlfa.value = pesos.oculto * 0.35; u.uBorda.value = pesos.oculto; }
        else u.uAlfa.value = pesos.arestas;
      });
      if (r.cantos) {
        r.cantos.position.copy(p.raiz.position);
        if (cor) r.cantos.material.color.copy(cor); else r.cantos.material.color.setHex(cfg.cor);
        r.cantos.material.opacity = Math.min(1, pesos.cantos + pulso * 0.5);
        r.cantos.visible = pesos.cantos > 0;
      }

      r.pares.forEach(function (par) { par[0].matrix.copy(par[1].matrixWorld); });
      return r.cfg.pulso && t < (r.cfg.vida || DURACAO_PULSO);
    }

    function atualizarRealces(agora) {
      produto.updateMatrixWorld(true);
      var anima = false;
      ["sel", "pairar"].forEach(function (k) { if (atualizarRealce(realces[k], agora)) anima = true; });
      if (realces.nega) {
        if (atualizarRealce(realces.nega, agora)) anima = true;
        else trocarRealce("nega", null);
      }
      return anima;
    }

    function chaveDoRealce(r) { return r ? (r.zona ? r.zona.id : "peca:" + r.id) : null; }

    /* ----- Fluxo de ar ----- */

    var fluxo = new T.Group();
    (function () {
      var geo = new T.SphereGeometry(1, 10, 8);
      geo.scale(1, 1, 3.2);
      for (var i = 0; i < 24; i++) {
        var gota = new T.Mesh(geo, new T.MeshBasicMaterial({ color: 0x21b6ee, transparent: true, depthWrite: false, toneMapped: false }));
        gota.renderOrder = 6;
        gota.userData.fase = i / 24;
        gota.userData.faixa = i % 3;
        fluxo.add(gota);
      }
      fluxo.visible = false;
      cena.add(fluxo);
    })();

    /* ----- Câmera -----
       Órbita esférica em torno de um alvo. `alvo` é o estado pedido e `atual`
       o desenhado, que o persegue com amortecimento; presets e foco usam uma
       transição com easing. */

    /* A elevação dá a volta inteira: passando de 90° a câmera cruza o zênite
       e desce pelo outro lado de cabeça para baixo, o que só fecha se o vetor
       "para cima" acompanhar o sinal do cosseno. Exatamente no polo os dois
       são paralelos e `lookAt` degenera, então o polo é evitado por um fio. */
    var POLO = 0.0015;
    function normalizarEl(el) {
      el = (el + Math.PI) % (Math.PI * 2);
      if (el < 0) el += Math.PI * 2;
      el -= Math.PI;
      if (Math.abs(Math.abs(el) - Math.PI / 2) < POLO) el += el > 0 ? POLO : -POLO;
      return el;
    }
    function sinalCima(el) { return Math.cos(el) >= 0 ? 1 : -1; }

    var PRESETS = {
      isometrica: { az: 32 * GRAU, el: 24 * GRAU },
      frontal: { az: 0, el: 6 * GRAU },
      lateral: { az: 90 * GRAU, el: 10 * GRAU },
      superior: { az: 0, el: 86 * GRAU },
      inferior: { az: 0, el: -62 * GRAU }
    };
    var TECLA_PRESET = { "1": "isometrica", "2": "frontal", "3": "lateral", "4": "superior", "5": "inferior" };

    var cam = {
      alvo: { az: PRESETS.isometrica.az, el: PRESETS.isometrica.el, dist: 9, t: new T.Vector3(0, 1.5, 0) },
      atual: { az: PRESETS.isometrica.az, el: PRESETS.isometrica.el, dist: 9, t: new T.Vector3(0, 1.5, 0) },
      transicao: null, preset: "isometrica", enquadrado: false
    };

    function copiaCam(c) { return { az: c.az, el: c.el, dist: c.dist, t: c.t.clone() }; }

    function direcao(az, el) {
      return new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    }

    // Caixas das peças visíveis na posição corrente, para enquadrar e limitar.
    function caixasVisiveis() {
      var caixas = [];
      estado.lista.forEach(function (pc) {
        var p = estado.pecas[pc.id];
        // Na montagem o fantasma da peça futura também conta: o quadro não muda a cada fator.
        var fantasma = !pc.present && estado.op.modo !== "calor";
        if ((!pc.present && !fantasma) || p.opacidadeAlvo < 0.5) return;
        var c = p.origem.clone().add(desloc(pc.ex).multiplyScalar(estado.explodeAlvo));
        var meia = new T.Vector3(pc.b[3] * U / 2, pc.b[5] * U / 2, pc.b[4] * U / 2);
        caixas.push(new T.Box3(c.clone().sub(meia), c.clone().add(meia)));
      });
      if (!caixas.length) {
        estado.lista.forEach(function (pc) {
          var c = estado.pecas[pc.id].origem, meia = new T.Vector3(pc.b[3] * U / 2, pc.b[5] * U / 2, pc.b[4] * U / 2);
          caixas.push(new T.Box3(c.clone().sub(meia), c.clone().add(meia)));
        });
      }
      return caixas;
    }

    function uniao(caixas) {
      var u = new T.Box3();
      caixas.forEach(function (c) { u.union(c); });
      return u;
    }

    // Distância que enquadra a esfera da caixa no campo de visão mais estreito.
    function distanciaQueEnquadra(caixa, folga) {
      var r = caixa.getBoundingSphere(new T.Sphere()).radius;
      var vfov = camera.fov * GRAU;
      var hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
      return r / Math.sin(Math.min(vfov, hfov) / 2) * (folga || 1);
    }

    /* Limites de distância a partir da escala real. O máximo afasta até a cena
       inteira caber 1,6 vez no quadro. O mínimo impede a câmera de entrar em
       qualquer peça: se o ponto de vista cai dentro de uma caixa, ele é
       empurrado para fora dela ao longo da linha de visão. */
    var MARGEM = 0.12;
    function limitarCamera(c) {
      c.el = normalizarEl(c.el);
      var caixas = caixasVisiveis(), tudo = uniao(caixas);
      if (tudo.isEmpty()) return;
      tudo.clampPoint(c.t, c.t);

      var max = distanciaQueEnquadra(tudo, 1.6);
      c.dist = Math.min(max, Math.max(0.4, c.dist));
      var dir = direcao(c.az, c.el), saida = new T.Vector3();
      for (var it = 0; it < 6; it++) {
        var p = c.t.clone().addScaledVector(dir, c.dist), empurrou = false;
        for (var i = 0; i < caixas.length; i++) {
          var cx = caixas[i].clone().expandByScalar(MARGEM);
          if (!cx.containsPoint(p)) continue;
          // Saída do raio: entra-se na caixa pelo outro lado para medir.
          var longe = c.t.clone().addScaledVector(dir, 100);
          var volta = new T.Ray(longe, dir.clone().negate());
          if (volta.intersectBox(cx, saida)) { c.dist = saida.distanceTo(c.t) + 0.01; empurrou = true; }
        }
        if (!empurrou) break;
      }
    }

    function irPara(destino, nome, duracao) {
      var de = copiaCam(cam.atual);
      var para = copiaCam(destino);
      // Menor arco: trocar de preset não dá a volta inteira.
      while (para.az - de.az > Math.PI) para.az -= Math.PI * 2;
      while (para.az - de.az < -Math.PI) para.az += Math.PI * 2;
      while (para.el - de.el > Math.PI) para.el -= Math.PI * 2;
      while (para.el - de.el < -Math.PI) para.el += Math.PI * 2;
      // Consulta direta: a câmera pode se mover antes de `movimentoReduzido` existir.
      var reduzido = typeof ACESSIBILIDADE !== "undefined"
        ? ACESSIBILIDADE.movimentoReduzido.matches
        : window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      cam.alvo = copiaCam(para);
      cam.preset = nome || null;
      if (reduzido) { cam.atual = copiaCam(para); cam.transicao = null; }
      else cam.transicao = { de: de, para: para, t0: performance.now(), dur: duracao || 750 };
      avisarCamera();
      pedir();
    }

    function enquadramento(nome) {
      var p = PRESETS[nome], caixa = uniao(caixasVisiveis());
      return { az: p.az, el: p.el, dist: distanciaQueEnquadra(caixa, 1.04), t: caixa.getCenter(new T.Vector3()) };
    }

    function aplicarPreset(nome, duracao) {
      if (!PRESETS[nome]) return;
      irPara(enquadramento(nome), nome, duracao);
    }

    function enquadrarFoco(area) {
      var meta = FOGAO.PECA_DA_AREA[area];
      var ids = [meta.peca].concat(meta.junto || []);
      var caixas = [];
      ids.forEach(function (id) {
        var p = estado.pecas[id], pc = p.pc;
        var c = p.origem.clone().add(desloc(pc.ex).multiplyScalar(estado.explodeAlvo));
        var meia = new T.Vector3(pc.b[3] * U / 2, pc.b[5] * U / 2, pc.b[4] * U / 2);
        caixas.push(new T.Box3(c.clone().sub(meia), c.clone().add(meia)));
      });
      var caixa = uniao(caixas);
      var planta = meta.plano === "planta";
      irPara({
        az: planta ? 12 * GRAU : 8 * GRAU, el: planta ? 58 * GRAU : 14 * GRAU,
        dist: distanciaQueEnquadra(caixa, 1.3), t: caixa.getCenter(new T.Vector3())
      }, null, 900);
    }

    // Peças opacas entre a câmera e o ponto: 0 é vista livre.
    var raioVista = new T.Raycaster();
    function obstrucoes(destino) {
      var olho = destino.t.clone().addScaledVector(direcao(destino.az, destino.el), destino.dist);
      var ate = destino.t.clone().sub(olho), longe = ate.length();
      raioVista.set(olho, ate.normalize());
      // Folga no fim: o marcador encosta na própria peça e não conta como obstáculo.
      raioVista.far = Math.max(0, longe - 0.08);
      var alvos = [];
      estado.lista.forEach(function (pc) {
        var p = estado.pecas[pc.id];
        if (pc.present && p.corpo.visible && p.opacidadeAlvo > 0.5) alvos.push(p.corpo);
      });
      return raioVista.intersectObjects(alvos, true).length;
    }

    /* Aproxima do marcador de um ponto: testa ângulos em volta dele e fica com o de vista
       livre mais perto da câmera atual, mirando a posição de destino do explodido. */
    function enquadrarPonto(id, duracao) {
      if (estado.foco) return false;
      var m = estado.marcadores.filter(function (x) { return x.ponto.measurement_id === id; })[0];
      if (!m) return false;
      var peca = estado.pecas[m.peca];
      var t = m.base.clone().add(desloc(peca.pc.ex).multiplyScalar(estado.explodeAlvo));
      var dist = distanciaQueEnquadra(uniao(caixasVisiveis()), 1.04) * 0.5;
      var iso = PRESETS.isometrica, melhor = null;
      [iso.el, 48 * GRAU, 8 * GRAU].forEach(function (el) {
        for (var k = 0; k < 12; k++) {
          var c = { az: iso.az + k * 30 * GRAU, el: el, dist: dist, t: t.clone() };
          limitarCamera(c);
          var giro = Math.abs(Math.atan2(Math.sin(c.az - cam.atual.az), Math.cos(c.az - cam.atual.az)));
          var nota = obstrucoes(c) * 10 + giro + Math.abs(el - iso.el);
          if (!melhor || nota < melhor.nota) melhor = { nota: nota, destino: c };
        }
      });
      irPara(melhor.destino, null, duracao || 1100);
      return true;
    }

    function manipular() {
      if (cam.transicao) { cam.alvo = copiaCam(cam.atual); cam.transicao = null; }
      if (cam.preset) { cam.preset = null; avisarCamera(); }
    }

    function avisarCamera() { if (opcoes.aoMudarCamera) opcoes.aoMudarCamera(cam.preset); }

    /* ----- Entradas ----- */

    var el = host;
    var ponteiros = {}, gesto = null, andou = false, toque = null;
    var raycaster = new T.Raycaster();

    /* Quanto o ponteiro pode andar e ainda valer como clique. O dedo treme
       mais que o mouse. Dentro desse raio a câmera também não se mexe: um
       clique não gira o modelo nem um grau. */
    var LIMIAR_CLIQUE = { mouse: 4, pen: 6, touch: 10 };

    function ndc(cx, cy) {
      var r = renderer.domElement.getBoundingClientRect();
      return new T.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    }

    /* Peça montada e opaca sob o cursor; o ponto volta a coordenadas do modelo montado para
       resolver a zona. */
    function pecaSob(cx, cy) {
      raycaster.setFromCamera(ndc(cx, cy), camera);
      var alvos = [];
      estado.lista.forEach(function (pc) {
        var p = estado.pecas[pc.id];
        // Peça que está esmaecendo sai do raio já no pedido, sem esperar a animação.
        if (pc.present && p.corpo.visible && Math.min(p.opacidade, p.opacidadeAlvo) > 0.5) alvos.push(p.corpo);
      });
      var hits = raycaster.intersectObjects(alvos, true);
      if (!hits.length) return null;

      var o = hits[0].object, id = null;
      while (o && !id) { id = o.userData.pecaId; o = o.parent; }
      var peca = id && estado.pecas[id];
      if (!peca) return null;
      // A posição desenhada é a de agora, também no meio do slider: descontá-la leva o ponto de volta à peça montada.
      var local = hits[0].point.clone().sub(peca.raiz.position);
      var modelo = { x: local.x / U + 160, y: 120 - local.z / U, z: local.y / U };
      return {
        id: id, nome: peca.pc.nome, casca: !!peca.pc.casca,
        mundo: hits[0].point, modelo: modelo,
        zona: FOGAO.zonaEm(id, modelo.x, modelo.y)
      };
    }

    function pontoSob(cx, cy) {
      var alvo = pecaSob(cx, cy);
      return alvo ? alvo.mundo : null;
    }

    function zoom(fator, cx, cy) {
      manipular();
      var antes = cam.alvo.dist;
      cam.alvo.dist = antes * fator;
      limitarCamera(cam.alvo);
      var real = cam.alvo.dist / antes;
      // Aproxima em direção ao que está sob o cursor, como num mapa.
      if (cx != null && real < 1) {
        var h = pontoSob(cx, cy);
        if (h) cam.alvo.t.lerp(h, 1 - real);
      }
      limitarCamera(cam.alvo);
      pedir();
    }

    function pan(dx, dy) {
      manipular();
      var altura = renderer.domElement.clientHeight || 1;
      var escala = 2 * cam.atual.dist * Math.tan(camera.fov * GRAU / 2) / altura;
      var dir = direcao(cam.alvo.az, cam.alvo.el);
      var direita = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), dir).normalize();
      var cima = new T.Vector3().crossVectors(dir, direita).normalize();
      cam.alvo.t.addScaledVector(direita, -dx * escala).addScaledVector(cima, dy * escala);
      limitarCamera(cam.alvo);
      pedir();
    }

    function doisPonteiros() {
      var ids = Object.keys(ponteiros);
      return [ponteiros[ids[0]], ponteiros[ids[1]]];
    }

    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    el.addEventListener("pointerdown", function (e) {
      ponteiros[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { el.setPointerCapture(e.pointerId); } catch (erro) { /* segue sem captura */ }
      var n = Object.keys(ponteiros).length;
      if (n === 1) {
        andou = false;
        var panear = e.button === 2 || e.button === 1 || e.shiftKey;
        gesto = { tipo: panear ? "pan" : "orbita", x: e.clientX, y: e.clientY };
        // Só o botão principal, sem Shift, seleciona: os outros são gesto de câmera.
        toque = { x0: e.clientX, y0: e.clientY, limiar: LIMIAR_CLIQUE[e.pointerType] || 4, seleciona: e.button === 0 && !e.shiftKey };
      } else if (n === 2) {
        var par = doisPonteiros();
        gesto = { tipo: "pinca", d: Math.hypot(par[0].x - par[1].x, par[0].y - par[1].y) || 1, mx: (par[0].x + par[1].x) / 2, my: (par[0].y + par[1].y) / 2 };
        andou = true;
      }
    });

    el.addEventListener("pointermove", function (e) {
      if (!ponteiros[e.pointerId] || !gesto) { agendarPairar(e); return; }
      ponteiros[e.pointerId] = { x: e.clientX, y: e.clientY };

      if (gesto.tipo === "pinca") {
        var par = doisPonteiros();
        if (!par[1]) return;
        var d = Math.hypot(par[0].x - par[1].x, par[0].y - par[1].y) || 1;
        var mx = (par[0].x + par[1].x) / 2, my = (par[0].y + par[1].y) / 2;
        zoom(gesto.d / d, mx, my);
        pan(mx - gesto.mx, my - gesto.my);
        gesto.d = d; gesto.mx = mx; gesto.my = my;
        return;
      }

      var dx = e.clientX - gesto.x, dy = e.clientY - gesto.y;
      gesto.x = e.clientX; gesto.y = e.clientY;
      /* Distância contada da origem, e não por evento: um arrasto lento chega
         em passos de 1 px e nunca passaria de um limiar por passo. Ao sair
         da zona morta o gesto recupera o que ela segurou, sem salto. */
      if (!andou) {
        if (!toque || Math.hypot(e.clientX - toque.x0, e.clientY - toque.y0) <= toque.limiar) return;
        andou = true;
        dx = e.clientX - toque.x0; dy = e.clientY - toque.y0;
        el.classList.add("girando");
        limparPairar();
      }
      if (gesto.tipo === "pan") { pan(dx, dy); return; }
      manipular();
      cam.alvo.az -= dx * 0.008 * sinalCima(cam.alvo.el);
      cam.alvo.el += dy * 0.006;
      limitarCamera(cam.alvo);
      pedir();
    });

    function soltar(e) {
      if (!ponteiros[e.pointerId]) return;
      delete ponteiros[e.pointerId];
      if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      var ids = Object.keys(ponteiros);
      if (ids.length === 1) gesto = { tipo: "orbita", x: ponteiros[ids[0]].x, y: ponteiros[ids[0]].y };
      else if (!ids.length) {
        gesto = null;
        el.classList.remove("girando");
        if (!andou && e.type === "pointerup" && toque && toque.seleciona) clicar(e.clientX, e.clientY);
        toque = null;
      }
    }

    /* Clique confirmado. Marcador tem prioridade: é o alvo menor, e quem mira
       nele não quer a peça inteira. Sem marcador, a peça sob o cursor; sem
       peça, o fundo, que desfaz a seleção. A peça sem dado ganha uma piscada
       cinza — o clique foi reconhecido, só não há o que resumir. */
    function clicar(cx, cy) {
      if (!estado.campo && opcoes.aoClicar) {
        var marca = marcadorSob(cx, cy, 16);
        if (marca) { opcoes.aoClicar(marca.ponto); return; }
      }
      if (!opcoes.aoClicarPeca) {
        if (opcoes.aoClicar && !estado.campo) opcoes.aoClicar(null);
        return;
      }
      var alvo = pecaSob(cx, cy);
      if (alvo && !alvo.zona) {
        var nega = montarRealce("nega", alvo.id, null);
        trocarRealce("nega", nega);
      }
      opcoes.aoClicarPeca(alvo);
    }
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);

    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      var dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      // Pinça de trackpad chega como wheel com ctrlKey e deltas pequenos.
      zoom(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0012)), e.clientX, e.clientY);
    }, { passive: false });

    el.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var k = e.key, mult = e.shiftKey ? 3 : 1;
      if (k === "Escape" && opcoes.aoClicarPeca) { e.preventDefault(); opcoes.aoClicarPeca(null); return; }
      if (TECLA_PRESET[k]) { e.preventDefault(); if (!estado.foco) aplicarPreset(TECLA_PRESET[k]); return; }
      if (k === "+" || k === "=") { e.preventDefault(); zoom(1 / 1.2); return; }
      if (k === "-" || k === "_") { e.preventDefault(); zoom(1.2); return; }
      var az = 0, elv = 0;
      if (k === "ArrowLeft") az = -1; else if (k === "ArrowRight") az = 1;
      else if (k === "ArrowUp") elv = 1; else if (k === "ArrowDown") elv = -1;
      else return;
      e.preventDefault();
      manipular();
      cam.alvo.az += az * 6 * GRAU * mult * sinalCima(cam.alvo.el);
      cam.alvo.el += elv * 5 * GRAU * mult;
      limitarCamera(cam.alvo);
      pedir();
    });

    /* ----- Sonda do campo -----
       No campo não há marcador para apontar, então o que responde ao ponteiro
       é a própria superfície: o ponto atingido volta para coordenadas do
       modelo e a interpolação é refeita ali, em graus. */
    function sondarCampo(alvo) {
      if (!estado.campoAmostras || !alvo) return null;
      // O ponto já vem descontado do explodido: a sonda lê a temperatura do lugar montado.
      var m = alvo.modelo;
      return {
        c: FOGAO.valorEm(estado.campoAmostras, m.x, m.y, m.z),
        peca: alvo.zona ? alvo.zona.nome : alvo.nome,
        zona: alvo.zona
      };
    }

    /* ----- Seleção e balão ----- */

    var vTmp = new T.Vector3();
    function naTela(m) {
      vTmp.copy(m.mundo);
      var depth = vTmp.distanceTo(camera.position);
      vTmp.project(camera);
      var r = renderer.domElement;
      return { x: (vTmp.x + 1) / 2 * r.clientWidth, y: (1 - vTmp.y) / 2 * r.clientHeight, z: depth, fora: vTmp.z > 1 };
    }

    // O mais próximo do cursor, em pixels; empate fica com o mais perto da câmera.
    function marcadorSob(cx, cy, raio) {
      var r = renderer.domElement.getBoundingClientRect();
      var x = cx - r.left, y = cy - r.top, achado = null, melhor = Infinity;
      estado.marcadores.forEach(function (m) {
        if (!m.dentro || !m.visivel) return;
        var s = naTela(m);
        if (s.fora) return;
        var d = Math.hypot(s.x - x, s.y - y);
        if (d > raio) return;
        var nota = d + s.z * 0.5;
        if (nota < melhor) { melhor = nota; achado = m; }
      });
      return achado;
    }

    /* Peça sugerida sob o cursor: só a que tem zona acende, e a já
       selecionada não ganha um segundo realce por cima do dela. */
    function pairarPeca(alvo) {
      var zona = alvo && alvo.zona;
      var chave = zona ? zona.id : null;
      if (chave === chaveDoRealce(realces.sel)) chave = null;
      if (chave === chaveDoRealce(realces.pairar)) return;
      trocarRealce("pairar", chave ? montarRealce("pairar", alvo.id, zona) : null);
    }

    function pairar(e) {
      var caixa = renderer.domElement.getBoundingClientRect();
      var clicaveis = !!opcoes.aoClicarPeca;
      if (estado.campo) {
        if (!opcoes.aoSondar && !clicaveis) return;
        var alvoCampo = pecaSob(e.clientX, e.clientY);
        if (clicaveis) pairarPeca(alvoCampo);
        var sonda = sondarCampo(alvoCampo);
        el.style.cursor = alvoCampo && alvoCampo.zona && clicaveis ? "pointer" : sonda ? "crosshair" : "";
        if (opcoes.aoSondar) opcoes.aoSondar(sonda, e.clientX - caixa.left, e.clientY - caixa.top);
        return;
      }
      if (!opcoes.aoPairar && !clicaveis) return;
      var achado = marcadorSob(e.clientX, e.clientY, 13);
      if (achado !== estado.pairado) {
        estado.pairado = achado;
        pedir();
      }
      if (achado) {
        if (clicaveis) pairarPeca(null);
        el.style.cursor = "pointer";
        var s = naTela(achado);
        if (opcoes.aoPairar) opcoes.aoPairar(achado.ponto, s.x, s.y);
        return;
      }
      if (opcoes.aoPairar) opcoes.aoPairar(null);
      if (!clicaveis) { el.style.cursor = ""; return; }
      var alvo = pecaSob(e.clientX, e.clientY);
      pairarPeca(alvo);
      el.style.cursor = alvo && alvo.zona ? "pointer" : "";
      if (opcoes.aoPairarPeca) opcoes.aoPairarPeca(alvo && alvo.zona ? alvo : null, e.clientX - caixa.left, e.clientY - caixa.top);
    }

    // Um raio por quadro, no máximo: o ponteiro dispara mais eventos que a tela desenha.
    var pairarPendente = null;
    function agendarPairar(e) {
      if (!pairarPendente) {
        requestAnimationFrame(function () {
          var ev = pairarPendente;
          pairarPendente = null;
          if (ev && !gesto) pairar(ev);
        });
      }
      pairarPendente = { clientX: e.clientX, clientY: e.clientY };
    }

    function limparPairar() {
      pairarPendente = null;
      estado.pairado = null;
      el.style.cursor = "";
      trocarRealce("pairar", null);
      if (opcoes.aoPairar) opcoes.aoPairar(null);
      if (opcoes.aoPairarPeca) opcoes.aoPairarPeca(null);
      if (opcoes.aoSondar) opcoes.aoSondar(null);
    }

    el.addEventListener("pointerleave", function () {
      limparPairar();
      pedir();
    });

    /* ----- Laço de desenho -----
       Só desenha quando algo mudou: parado, o viewport não gasta GPU. */

    var quadroPedido = false, ultimo = performance.now(), visivel = true;
    var tempos = [];

    function pedir() {
      if (quadroPedido || !visivel) return;
      quadroPedido = true;
      requestAnimationFrame(quadro);
    }

    /* Com movimento reduzido (no sistema ou nos recursos assistivos), explodir e
       montar saltam direto ao fim e o campo para de ondular. */
    var movimentoReduzido = typeof ACESSIBILIDADE !== "undefined"
      ? ACESSIBILIDADE.movimentoReduzido
      : (window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false });

    function aproximar(atual, alvo, taxa, dt) {
      if (movimentoReduzido.matches) return alvo;
      var k = 1 - Math.exp(-dt * taxa);
      return atual + (alvo - atual) * k;
    }

    function quadro(agora) {
      quadroPedido = false;
      var t0 = performance.now();
      var dt = Math.min(0.05, (agora - ultimo) / 1000 || 0.016);
      ultimo = agora;
      var continuar = false;

      // O campo é estacionário; o que anda é a leitura dele.
      if (estado.campo && !movimentoReduzido.matches) {
        UC.uTempo.value = agora / 1000;
        continuar = true;
      }

      // Explodido e opacidades.
      var ex = estado.explode;
      // Taxa alta: arrastando o slider, o modelo acompanha a mão sem arrasto visível.
      estado.explode = aproximar(estado.explode, estado.explodeAlvo, 12, dt);
      if (Math.abs(estado.explode - estado.explodeAlvo) < 0.0005) estado.explode = estado.explodeAlvo;
      var mexeu = estado.explode !== ex;

      estado.lista.forEach(function (pc) {
        var p = estado.pecas[pc.id];
        var ap = pc.present ? 1 : 0;
        if (p.aparecer !== ap) {
          p.aparecer = Math.abs(p.aparecer - ap) < 0.003 ? ap : aproximar(p.aparecer, ap, 6, dt);
          mexeu = true;
        }
        if (p.opacidade !== p.opacidadeAlvo) {
          p.opacidade = Math.abs(p.opacidade - p.opacidadeAlvo) < 0.003 ? p.opacidadeAlvo : aproximar(p.opacidade, p.opacidadeAlvo, 8, dt);
          aplicarOpacidade(p);
          continuar = true;
        }
        var queda = (1 - p.aparecer) * 0.9;
        p.raiz.position.copy(desloc(pc.ex).multiplyScalar(estado.explode));
        p.raiz.position.y += queda;
        p.uDesloc.value.copy(p.raiz.position);
        p.corpo.visible = p.aparecer > 0.01;
        p.fantasma.visible = !pc.present && estado.op.modo !== "calor";
        if (pc.present && p.aparecer < 1) aplicarOpacidade(p);
      });
      if (mexeu) { renderer.shadowMap.needsUpdate = true; continuar = true; }

      // Câmera.
      var c = cam.atual;
      if (cam.transicao) {
        var tr = cam.transicao, k = Math.min(1, (agora - tr.t0) / tr.dur), e = suave(k);
        c.az = lerp(tr.de.az, tr.para.az, e);
        c.el = lerp(tr.de.el, tr.para.el, e);
        c.dist = lerp(tr.de.dist, tr.para.dist, e);
        c.t.lerpVectors(tr.de.t, tr.para.t, e);
        if (k >= 1) cam.transicao = null;
        continuar = true;
      } else {
        var a = cam.alvo, taxa = 14;
        // Mantém o azimute em uma volta, deslocando alvo e atual juntos: sem salto na tela.
        if (Math.abs(a.az) > Math.PI) { var volta = Math.round(a.az / (Math.PI * 2)) * Math.PI * 2; a.az -= volta; c.az -= volta; }
        if (Math.abs(a.el) > Math.PI) { var giro = Math.round(a.el / (Math.PI * 2)) * Math.PI * 2; a.el -= giro; c.el -= giro; }
        c.az = aproximar(c.az, a.az, taxa, dt);
        c.el = aproximar(c.el, a.el, taxa, dt);
        c.dist = aproximar(c.dist, a.dist, taxa, dt);
        c.t.lerp(a.t, 1 - Math.exp(-dt * taxa));
        if (Math.abs(c.az - a.az) + Math.abs(c.el - a.el) + Math.abs(c.dist - a.dist) + c.t.distanceTo(a.t) > 0.0004) continuar = true;
        else { c.az = a.az; c.el = a.el; c.dist = a.dist; c.t.copy(a.t); }
      }
      camera.position.copy(c.t).addScaledVector(direcao(c.az, c.el), c.dist);
      camera.up.set(0, sinalCima(c.el), 0);
      camera.lookAt(c.t);
      camera.updateMatrixWorld();

      // Visto por baixo, o chão e a sombra de contato viram um tampo opaco.
      var porBaixo = camera.position.y < 0.01;
      chao.visible = contato.visible = !porBaixo;

      // Rotor e fluxo de ar.
      var soprador = estado.pecas.blower;
      if (soprador && estado.op.soprador && soprador.pc.present && (estado.op.modo !== "calor" || estado.campo)) {
        soprador.corpo.traverse(function (o) { if (o.userData.rotor) o.rotation.x += dt * 14 * o.userData.rotor; });
        if (!estado.campo) animarFluxo(soprador, agora);
        else fluxo.visible = false;
        continuar = true;
      } else fluxo.visible = false;

      // Marcadores com tamanho constante na tela.
      var pxMundo = 2 * Math.tan(camera.fov * GRAU / 2) / (renderer.domElement.clientHeight || 1);
      posicionarMarcadores(pxMundo);

      // Focos quentes: halo de tamanho constante na tela, pulsando devagar.
      if (grupoFocos.visible) {
        grupoFocos.children.forEach(function (h) {
          var pulso = 0.5 + 0.5 * Math.sin(agora / 620 + h.userData.fase * Math.PI * 2);
          h.scale.setScalar(h.position.distanceTo(camera.position) * pxMundo * (20 + pulso * 10));
          h.quaternion.copy(camera.quaternion);
          h.material.opacity = 0.20 + pulso * 0.26;
        });
        continuar = true;
      }

      var sel = estado.sel;
      posicionarHalo(haloSel, sel, pxMundo);
      posicionarHalo(haloPairado, estado.pairado !== sel ? estado.pairado : null, pxMundo);
      anelSel.visible = !!sel && sel.visivel !== false;
      if (sel) {
        anelSel.position.copy(sel.mundo);
        var s2 = anelSel.position.distanceTo(camera.position) * pxMundo * TAMANHO_MARCA_PX;
        anelSel.scale.setScalar(s2);
        anelSel.quaternion.copy(camera.quaternion);
        var pulso = (agora % 1600) / 1600;
        anelSel.userData.eco.scale.setScalar(1 + pulso * 0.6);
        anelSel.userData.eco.material.opacity = 0.4 * (1 - pulso);
        continuar = true;
      }

      // Destaque de peça recém-escolhida: pulsa em azul por cima de tudo.
      if (estado.destaque) {
        var fase = (agora - estado.destaque.t0) / 1000;
        var brilho = Math.max(0, Math.sin(fase * Math.PI * 2.2)) * Math.max(0, 1 - fase / 1.8);
        estado.destaque.mats.forEach(function (m) { m.opacity = 0.12 + brilho * 0.4; });
        if (fase < 1.8) continuar = true;
        else { cena.remove(estado.destaque.grupo); estado.destaque = null; }
      }

      if (atualizarRealces(agora)) continuar = true;

      renderer.render(cena, camera);
      tempos.push(performance.now() - t0);
      if (tempos.length > 240) tempos.shift();
      if (continuar) pedir();
    }

    function animarFluxo(soprador, agora) {
      fluxo.visible = true;
      var sentido = estado.op.soprador === "back" ? 1 : -1;
      var base = soprador.raiz.position.clone().add(soprador.origem);
      fluxo.children.forEach(function (g) {
        var f = (g.userData.fase + agora / 1600) % 1;
        var x = (g.userData.faixa - 1) * 30 * U;
        var y = sentido * (10 + f * 150) * U;
        g.position.set(base.x + x, base.y + (4 + Math.sin(f * 9 + g.userData.faixa) * 2) * U, base.z - y);
        g.scale.setScalar(2.2 * U);
        g.material.opacity = Math.sin(f * Math.PI) * 0.85;
      });
    }

    function aplicarOpacidade(p) {
      var o = p.opacidade * (p.pc.present ? Math.min(1, p.aparecer * 1.2) : 0);
      p.mats.forEach(function (m) {
        var base = m.userData.opacidade == null ? 1 : m.userData.opacidade;
        var transp = o < 0.999 || m.userData.transparente;
        if (m.transparent !== transp) { m.transparent = transp; m.needsUpdate = true; }
        m.opacity = base * o;
        m.depthWrite = o > 0.6;
      });
      p.corpo.traverse(function (obj) { if (obj.isMesh) obj.castShadow = o > 0.6; });
      renderer.shadowMap.needsUpdate = true;
      p.marcas.visible = o > 0.3;
    }

    function destacar(id) {
      if (estado.destaque) { cena.remove(estado.destaque.grupo); estado.destaque = null; }
      var p = id && estado.pecas[id];
      if (!p) return;
      var grupo = new T.Group(), mats = [];
      p.corpo.updateMatrixWorld(true);
      p.corpo.traverse(function (o) {
        if (!o.isMesh) return;
        var mat = new T.MeshBasicMaterial({ color: 0x00a0dd, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false, toneMapped: false });
        mats.push(mat);
        var copia = new T.Mesh(o.geometry, mat);
        copia.matrixAutoUpdate = false;
        copia.matrix.copy(o.matrixWorld);
        copia.renderOrder = 8;
        grupo.add(copia);
      });
      cena.add(grupo);
      estado.destaque = { grupo: grupo, mats: mats, t0: performance.now() };
    }

    /* ----- Tamanho e visibilidade ----- */

    function redimensionar() {
      var w = host.clientWidth || 300, h = host.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!cam.enquadrado && estado.lista.length) {
        cam.enquadrado = true;
        var inicio = enquadramento("isometrica");
        cam.alvo = copiaCam(inicio);
        cam.atual = copiaCam(inicio);
      }
      pedir();
    }
    if (window.ResizeObserver) new ResizeObserver(redimensionar).observe(host);
    else window.addEventListener("resize", redimensionar);

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entradas) {
        visivel = entradas[0].isIntersecting;
        if (visivel) pedir();
      }).observe(host);
    }

    /* ----- Tema -----
       O palco herda o fundo do CSS; aqui só se repreenchem as texturas e os focos com as
       rampas do tema. */
    function aplicarTema() {
      preencherRampa(RAMPAS.absoluto.image.data, FOGAO.RAMPA_CAMPO);
      preencherRampa(RAMPAS.diferenca.image.data, FOGAO.RAMPA_DIFF);
      RAMPAS.absoluto.needsUpdate = RAMPAS.diferenca.needsUpdate = true;

      var selecao = corDoTema("--color-selecao", 0x0d436b), halo = corDoTema("--color-3d-halo", 0x5d6675);
      anelSel.children.forEach(function (m) { m.material.color.copy(selecao); });
      [haloSel, haloPairado].forEach(function (g) {
        g.children.forEach(function (m) { m.material.color.copy(halo); });
      });
      TIPOS_REALCE.nega.cor = corDoTema("--color-3d-nega", 0x505863).getHex();
      grupoVolume.userData.fio.material.color.copy(corDoTema("--color-3d-arame", 0x2b3038));

      var l = estado.campoLeitura;
      if (l) construirFocos(l.colocados, l.eq, l.valor, l.rampa, l.rampa === FOGAO.RAMPA_DIFF);
      pedir();
    }
    if (typeof TEMA !== "undefined") TEMA.aoMudar(aplicarTema);

    // Pausar ou retomar as animações vale já, sem esperar a próxima interação.
    if (typeof ACESSIBILIDADE !== "undefined") {
      ACESSIBILIDADE.aoMudar(function (m) {
        if (m.id !== "animacoes") return;
        UC.uOnda.value = movimentoReduzido.matches ? 0 : 1;
        pedir();
      });
    }

    /* ----- Interface pública ----- */

    function atualizar(op) {
      var antes = estado.op;
      estado.op = op;
      var info = null;

      var chave = chaveGeometria(op);
      if (chave !== estado.chaveGeo) {
        estado.chaveGeo = chave;
        construirPecas(op);
        // As malhas mudaram: realce apontando para as antigas é refeito abaixo.
        trocarRealce("pairar", null);
        trocarRealce("nega", null);
        trocarRealce("sel", null);
      } else {
        // Só o nível mudou: as peças já existem, basta atualizar quem aparece.
        var nova = FOGAO.pecas(op);
        nova.forEach(function (pc) { estado.pecas[pc.id].pc.present = pc.present; });
      }

      // Só o rótulo do display depende do caso de operação; a geometria, não.
      if (M.display.map && M.display.map.userData.repintar) {
        M.display.map.userData.repintar(op.caso);
      }

      var campo = op.modo === "calor" && op.vista === "campo";
      if (campo !== estado.campo || (campo && op.pontos !== antes.pontos)) {
        estado.campo = campo;
        if (campo) {
          info = construirCampo(FOGAO.posicionarPontos(op.pontos || [], FOGAO.pecas(op)), op);
          estado.infoCampo = info;
        }
        renderer.shadowMap.needsUpdate = true;
      }
      if (campo) info = estado.infoCampo;
      produto.visible = true;

      aplicarModo();
      aplicarCamadas(op);
      var explodeAntes = estado.explodeAlvo;
      estado.explodeAlvo = valorExplode(op.explode);
      estado.raioX = !!op.raioX;

      // Foco em subsistema: a peça fica, o resto esmaece quase até sumir.
      var foco = op.foco && FOGAO.PECA_DA_AREA[op.foco] ? op.foco : null;
      var meta = foco && FOGAO.PECA_DA_AREA[foco];
      var noFoco = meta ? [meta.peca].concat(meta.junto || []) : null;
      estado.lista.forEach(function (pc) {
        var p = estado.pecas[pc.id];
        var alvo = 1;
        if (noFoco) alvo = noFoco.indexOf(pc.id) >= 0 ? 1 : 0.06;
        else {
          /* A casca some no primeiro terço do curso: é ali que ela ainda tapa
             o miolo, e o clique precisa atravessá-la desde cedo. */
          if (pc.casca) alvo = lerp(1, OPACIDADE_CASCA, Math.min(1, estado.explodeAlvo / 0.35));
          if (estado.raioX && pc.externa) alvo = Math.min(alvo, OPACIDADE_RAIO_X);
        }
        if (p.opacidadeAlvo !== alvo) { p.opacidadeAlvo = alvo; }
        aplicarOpacidade(p);
      });

      // Restaurar: sem animação, o modelo volta montado e opaco neste mesmo quadro.
      if (op.imediato) {
        estado.explode = estado.explodeAlvo;
        estado.lista.forEach(function (pc) {
          var p = estado.pecas[pc.id];
          p.opacidade = p.opacidadeAlvo;
          aplicarOpacidade(p);
        });
      }

      construirMarcadores(op);
      estado.sel = null;
      if (op.sel) estado.marcadores.forEach(function (m) { if (m.ponto.measurement_id === op.sel) estado.sel = m; });
      if (estado.pairado && estado.marcadores.indexOf(estado.pairado) < 0) estado.pairado = null;

      if (op.novo && op.novo !== antes.novo) destacar(op.novo);

      // Peça selecionada: o realce entra com pulso só quando a escolha muda.
      var zonaSel = op.zonaSel ? FOGAO.ZONA_POR_ID[op.zonaSel] || null : null;
      if ((zonaSel ? zonaSel.id : null) !== chaveDoRealce(realces.sel)) {
        trocarRealce("sel", zonaSel ? montarRealce("sel", zonaSel.peca, zonaSel) : null);
        if (zonaSel && chaveDoRealce(realces.pairar) === zonaSel.id) trocarRealce("pairar", null);
      }

      if (!cam.enquadrado && host.clientWidth) redimensionar();
      if (foco !== estado.foco) {
        estado.foco = foco;
        if (foco) enquadrarFoco(foco);
        else if (cam.enquadrado) aplicarPreset(cam.preset || "isometrica", 900);
      } else if (estado.explodeAlvo !== explodeAntes && cam.enquadrado && !foco) {
        /* Explodir muda o volume: reenquadra mantendo o ângulo. Arrastando o
           slider, espera a mão parar — reenquadrar a cada passo faria a câmera
           brigar com o modelo. */
        clearTimeout(estado.reenquadro);
        if (op.arrastando) estado.reenquadro = setTimeout(function () { reenquadrar(800); }, 260);
        else reenquadrar(op.imediato ? 0 : 800);
      }

      pedir();
      return { info: info };
    }

    var OPACIDADE_CASCA = 0.14, OPACIDADE_RAIO_X = 0.12;

    // Aceita o booleano das telas antigas e o valor contínuo do slider.
    function valorExplode(v) {
      if (typeof v !== "number" || isNaN(v)) return v ? 1 : 0;
      return Math.max(0, Math.min(1, v));
    }

    function reenquadrar(duracao) {
      if (estado.foco) return;
      var alvoE = copiaCam(cam.alvo), caixa = uniao(caixasVisiveis());
      alvoE.t = caixa.getCenter(new T.Vector3());
      alvoE.dist = distanciaQueEnquadra(caixa, 1.04);
      if (duracao) { irPara(alvoE, cam.preset, duracao); return; }
      cam.alvo = copiaCam(alvoE);
      cam.atual = copiaCam(alvoE);
      cam.transicao = null;
      pedir();
    }

    var api = {
      atualizar: atualizar,
      preset: function (nome) { if (!estado.foco) aplicarPreset(nome); },
      presetAtual: function () { return cam.preset; },
      focarPonto: enquadrarPonto,
      _depurar: {
        camera: function () { return { atual: copiaCam(cam.atual), alvo: copiaCam(cam.alvo), transicao: !!cam.transicao }; },
        tempos: function () { return tempos.slice(); },
        info: function () { return renderer.info.render; },
        // Custo real de um quadro, GPU incluída: gl.finish espera o desenho terminar.
        medir: function (n) {
          var gl = renderer.getContext(), t = [];
          for (var i = 0; i < (n || 30); i++) {
            cam.atual.az += 0.02;
            var t0 = performance.now();
            quadro(performance.now());
            gl.finish();
            t.push(performance.now() - t0);
          }
          t.sort(function (a, b) { return a - b; });
          return { mediana: +t[t.length >> 1].toFixed(2), p95: +t[Math.floor(t.length * 0.95)].toFixed(2) };
        },
        renderer: renderer,
        cena: cena,
        quadro: function () { quadro(performance.now()); },
        naTelaDe: function (id) {
          var m = estado.marcadores.filter(function (x) { return x.ponto.measurement_id === id; })[0];
          if (!m) return null;
          var r = renderer.domElement.getBoundingClientRect(), s = naTela(m);
          return { x: r.left + s.x, y: r.top + s.y };
        },
        marcadores: function () { return estado.marcadores.map(function (m) { return m.ponto.measurement_id; }); },
        // Valor, posição na rampa (0–1) e cor que o campo dá ao termopar.
        campoNoPonto: function (id) {
          var l = estado.campo && estado.campoLeitura;
          var c = l && l.colocados.filter(function (x) { return x.ponto.measurement_id === id; })[0];
          if (!c) return null;
          var t = l.eq.normalizar(l.valor(c));
          return { v: l.valor(c), t: t, rgb: FOGAO.corDaRampa(l.rampa, t), rampa: l.rampa === FOGAO.RAMPA_DIFF ? "diferenca" : "absoluto" };
        },
        // Peças opacas entre a câmera desenhada e o marcador; 0 é vista livre.
        obstrucoes: function (id) {
          var m = estado.marcadores.filter(function (x) { return x.ponto.measurement_id === id; })[0];
          return m ? obstrucoes(cam.atual) : null;
        },
        // Halos desenhados no último quadro: raio em unidades de marcador e raio na tela, em px.
        halos: function () {
          var r = renderer.domElement.getBoundingClientRect();
          var pxMundo = 2 * Math.tan(camera.fov * GRAU / 2) / (r.height || 1);
          function ler(h) {
            if (!h.visible) return null;
            var dist = h.position.distanceTo(camera.position);
            return { raio: h.userData.raio, px: h.scale.x / (dist * pxMundo) };
          }
          return { sel: ler(haloSel), pairado: ler(haloPairado) };
        },
        // Estado desenhado de explodido e opacidade, para os testes compararem com o pedido.
        vista: function () {
          var pecas = {};
          estado.lista.forEach(function (pc) {
            var p = estado.pecas[pc.id];
            pecas[pc.id] = { opacidade: p.opacidade, alvo: p.opacidadeAlvo, x: p.raiz.position.x, y: p.raiz.position.y, z: p.raiz.position.z };
          });
          return { explode: estado.explode, explodeAlvo: estado.explodeAlvo, raioX: estado.raioX, pecas: pecas };
        },
        pecaSob: function (cx, cy) {
          var a = pecaSob(cx, cy);
          return a && { id: a.id, zona: a.zona ? a.zona.id : null };
        },
        realces: function () {
          return { sel: chaveDoRealce(realces.sel), pairar: chaveDoRealce(realces.pairar), nega: realces.nega ? realces.nega.id : null };
        },
        /* Ponto de tela, em coordenadas do documento, onde um clique cai na
           zona pedida: varre a caixa da peça em grade e devolve o primeiro
           pixel cujo raio resolve para a zona. Serve aos testes de seleção. */
        telaDaZona: function (zonaId) {
          var z = FOGAO.ZONA_POR_ID[zonaId], p = z && estado.pecas[z.peca];
          if (!p) return null;
          p.corpo.updateMatrixWorld(true);
          var caixa = new T.Box3().setFromObject(p.corpo), r = renderer.domElement.getBoundingClientRect();
          var cantos = [], v = new T.Vector3();
          for (var i = 0; i < 8; i++) {
            v.set(i & 1 ? caixa.max.x : caixa.min.x, i & 2 ? caixa.max.y : caixa.min.y, i & 4 ? caixa.max.z : caixa.min.z).project(camera);
            cantos.push([r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]);
          }
          var x0 = Math.max(r.left, Math.min.apply(null, cantos.map(function (c) { return c[0]; })));
          var x1 = Math.min(r.right, Math.max.apply(null, cantos.map(function (c) { return c[0]; })));
          var y0 = Math.max(r.top, Math.min.apply(null, cantos.map(function (c) { return c[1]; })));
          var y1 = Math.min(r.bottom, Math.max.apply(null, cantos.map(function (c) { return c[1]; })));
          if (x1 <= x0 || y1 <= y0) return null;
          var passo = Math.max(3, Math.sqrt((x1 - x0) * (y1 - y0) / 400)), achados = [], sobMarca = [];
          for (var y = y0 + passo / 2; y < y1; y += passo) for (var x = x0 + passo / 2; x < x1; x += passo) {
            var a = pecaSob(x, y);
            if (!a || !a.zona || a.zona.id !== zonaId) continue;
            // Folga sobre o raio de 16 px do clique: o teste mira a peça, não o marcador.
            (marcadorSob(x, y, 18) ? sobMarca : achados).push([x, y]);
          }
          var livre = achados.length > 0;
          if (!livre) achados = sobMarca;
          if (!achados.length) return null;
          // O do meio: longe da borda, onde um tremor de pixel mudaria de peça.
          var mx = 0, my = 0;
          achados.forEach(function (c) { mx += c[0]; my += c[1]; });
          mx /= achados.length; my /= achados.length;
          achados.sort(function (a, b) { return Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my); });
          return { x: achados[0][0], y: achados[0][1], n: achados.length, sobMarcador: !livre };
        }
      }
    };
    // Acesso para depuração pelo console: document.getElementById(...)._fogao3d.
    Object.defineProperty(host, "_fogao3d", { value: api });
    return api;
  }

  return { criar: criar };
})();
