/* Viewport 3D do fogão, em WebGL (three.js).
 *
 * A geometria vem de FOGAO.pecas: cada peça é um grupo com volume real, então
 * girar a câmera não muda a posição relativa de nada. Os termopares são filhos
 * da peça em que moram e a acompanham no explodido.
 *
 * Eixos da cena: X para a direita, Y para cima, Z para quem olha de frente.
 * Uma unidade do modelo vale 0,01 na cena.
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

  function texDisplay() {
    return textura(512, 208, function (c, w, h) {
      c.fillStyle = "#050607"; c.fillRect(0, 0, w, h);
      c.shadowColor = "rgba(90,200,255,0.9)"; c.shadowBlur = 14;
      c.fillStyle = "#8fdcff";
      c.font = "bold 92px 'Segoe UI', Arial, sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("180°", w / 2, h / 2 + 4);
      c.font = "600 26px 'Segoe UI', Arial, sans-serif";
      c.fillStyle = "rgba(143,220,255,0.75)";
      c.fillText("BROIL", 70, h / 2);
      c.fillText("12:45", w - 72, h / 2);
    });
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
     A forma repete a do painel 2D em volume: esfera para dentro do limite,
     pirâmide para acima, octaedro para a banda de incerteza e cubo para os
     monitorados. O preenchimento é plano e sem tone mapping, para a cor bater
     com a legenda; o contorno escuro sai de uma casca invertida. */

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
      return { atualizar: function () { return {}; }, preset: function () {}, presetAtual: function () { return null; } };
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
    var grupoCampo = null;

    var estado = {
      op: {}, chaveGeo: null, pecas: {}, lista: [],
      explode: 0, explodeAlvo: 0,
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
        g.position.copy(origem);
        var k = new Kit(g, origem);
        CONSTRUTORES[pc.id](k, pc, M, op);
        fundirEstaticos(g);

        var mats = [];
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
          o.userData.real = Array.isArray(o.material) ? reais : reais[0];
          o.userData.argila = Array.isArray(o.material) ? argila : argila[0];
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
      var argila = estado.op.modo === "calor";
    // Argila sob luz mais dirigida: o volume lê por sombra, e as cores ficam só nos marcadores.
    cena.environmentIntensity = argila ? 0.45 : 0.85;
    sol.intensity = argila ? 2.8 : 2.1;
      estado.lista.forEach(function (pc) {
        estado.pecas[pc.id].corpo.traverse(function (o) {
          if (o.isMesh && o.userData.real) o.material = argila ? o.userData.argila : o.userData.real;
        });
      });
    }

    /* ----- Campo térmico -----
       Cor por vértice numa caixa subdividida. A interpolação é a mesma do
       painel 2D, feita uma vez: girar só muda a câmera. */

    function construirCampo(colocados) {
      if (grupoCampo) { cena.remove(grupoCampo); grupoCampo = null; }
      var amostras = colocados.map(function (c) { return { x: c.g[0], y: c.g[1], z: c.g[2], v: c.ponto.temperatura_prevista_c }; });
      if (!amostras.length) return null;
      var eq = FOGAO.equalizador(amostras.map(function (a) { return a.v; }));
      var C = FOGAO.CAIXA;

      var geo = new T.BoxGeometry(C.x * U, C.z * U, C.y * U, 64, 60, 48);
      var pos = geo.attributes.position, nor = geo.attributes.normal;
      var cores = new Float32Array(pos.count * 3), cor = new T.Color();
      for (var i = 0; i < pos.count; i++) {
        var x = pos.getX(i) / U + C.x / 2, zz = pos.getY(i) / U + C.z / 2, y = C.y / 2 - pos.getZ(i) / U;
        // 0,08 medido contra os termopares: correlação 0,86 contra 0,58 sem compressão.
        var kk = [nor.getX(i) ? 0.08 : 1, nor.getZ(i) ? 0.08 : 1, nor.getY(i) ? 0.08 : 1];
        var rgb = FOGAO.corDaRampa(FOGAO.RAMPA_CAMPO, eq.normalizar(FOGAO.valorEm(amostras, x, y, zz, kk)));
        cor.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, T.SRGBColorSpace);
        cores[i * 3] = cor.r; cores[i * 3 + 1] = cor.g; cores[i * 3 + 2] = cor.b;
      }
      geo.setAttribute("color", new T.BufferAttribute(cores, 3));

      grupoCampo = new T.Group();
      var caixa = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      caixa.position.set(0, C.z / 2 * U, 0);
      caixa.castShadow = true;
      grupoCampo.add(caixa);
      var arestas = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(C.x * U, C.z * U, C.y * U)), new T.LineBasicMaterial({ color: 0x1b1b1b }));
      arestas.position.copy(caixa.position);
      grupoCampo.add(arestas);
      FOGAO.POSICOES.forEach(function (p) {
        var r = FOGAO.RAIO_BOBINA[p[0]] * 1.08 * U;
        var pts = [];
        for (var a = 0; a <= 64; a++) pts.push(new T.Vector3(Math.cos(a / 64 * Math.PI * 2) * r, 0, Math.sin(a / 64 * Math.PI * 2) * r));
        var anel = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0x1b1b1b, transparent: true, opacity: 0.75 }));
        anel.position.copy(mundo(p[1], p[2], C.z + 0.3));
        grupoCampo.add(anel);
      });
      // Contornos de porta, painel e puxador: o volume colorido segue lendo como fogão.
      var traco = new T.LineBasicMaterial({ color: 0x1b1b1b, transparent: true, opacity: 0.7 });
      function retangulo(x0, z0, x1, z1) {
        var y = -0.4;
        return [mundo(x0, y, z0), mundo(x1, y, z0), mundo(x1, y, z0), mundo(x1, y, z1), mundo(x1, y, z1), mundo(x0, y, z1), mundo(x0, y, z1), mundo(x0, y, z0)];
      }
      var linhas = [].concat(retangulo(10, 30, 310, 188), retangulo(116, 238, 204, 274), [mundo(40, -0.4, 176), mundo(280, -0.4, 176), mundo(0, -0.4, 192), mundo(320, -0.4, 192)]);
      grupoCampo.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(linhas), traco));
      FOGAO.MANIPULOS.forEach(function (x) {
        var pts = [];
        for (var a = 0; a <= 32; a++) pts.push(mundo(x + Math.cos(a / 32 * Math.PI * 2) * 10, -0.4, 240 + Math.sin(a / 32 * Math.PI * 2) * 10));
        grupoCampo.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), traco));
      });
      cena.add(grupoCampo);
      renderer.shadowMap.needsUpdate = true;

      var paradas = [0, 0.25, 0.5, 0.75, 1].map(function (f) { return eq.quantil(f); });
      return { min: paradas[0], max: paradas[4], paradas: paradas };
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
      var a = new T.Mesh(new T.RingGeometry(1.55, 1.95, 48), new T.MeshBasicMaterial({ color: 0x0d436b, depthTest: false, transparent: true, toneMapped: false }));
      var eco = new T.Mesh(new T.RingGeometry(2.2, 2.45, 48), new T.MeshBasicMaterial({ color: 0x0d436b, depthTest: false, transparent: true, opacity: 0.35, toneMapped: false }));
      a.renderOrder = eco.renderOrder = 10;
      anelSel.add(a, eco);
      anelSel.userData.eco = eco;
      anelSel.visible = false;
      cena.add(anelSel);
    })();

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

    var ELEV_MIN = 4 * GRAU;   // acima do chão: nunca por baixo do produto
    var ELEV_MAX = 86 * GRAU;  // antes do zênite: a frente segue reconhecível

    var PRESETS = {
      isometrica: { az: 32 * GRAU, el: 24 * GRAU },
      frontal: { az: 0, el: 6 * GRAU },
      lateral: { az: 90 * GRAU, el: 10 * GRAU },
      superior: { az: 0, el: 86 * GRAU }
    };
    var TECLA_PRESET = { "1": "isometrica", "2": "frontal", "3": "lateral", "4": "superior" };

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
      if (estado.campo) {
        var C = FOGAO.CAIXA;
        caixas.push(new T.Box3(mundo(0, C.y, 0), mundo(C.x, 0, C.z)));
        return caixas;
      }
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
      c.el = Math.max(ELEV_MIN, Math.min(ELEV_MAX, c.el));
      var caixas = caixasVisiveis(), tudo = uniao(caixas);
      if (tudo.isEmpty()) return;
      tudo.clampPoint(c.t, c.t);
      c.t.y = Math.max(0.05, c.t.y);

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
      var reduzido = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

    function manipular() {
      if (cam.transicao) { cam.alvo = copiaCam(cam.atual); cam.transicao = null; }
      if (cam.preset) { cam.preset = null; avisarCamera(); }
    }

    function avisarCamera() { if (opcoes.aoMudarCamera) opcoes.aoMudarCamera(cam.preset); }

    /* ----- Entradas ----- */

    var el = host;
    var ponteiros = {}, gesto = null, andou = false;
    var raycaster = new T.Raycaster();

    function ndc(cx, cy) {
      var r = renderer.domElement.getBoundingClientRect();
      return new T.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    }

    function pontoSob(cx, cy) {
      raycaster.setFromCamera(ndc(cx, cy), camera);
      var alvos = [];
      if (estado.campo && grupoCampo) alvos.push(grupoCampo);
      else estado.lista.forEach(function (pc) {
        var p = estado.pecas[pc.id];
        if (pc.present && p.opacidade > 0.5) alvos.push(p.corpo);
      });
      var hits = raycaster.intersectObjects(alvos, true);
      return hits.length ? hits[0].point : null;
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
        el.classList.add("girando");
      } else if (n === 2) {
        var par = doisPonteiros();
        gesto = { tipo: "pinca", d: Math.hypot(par[0].x - par[1].x, par[0].y - par[1].y) || 1, mx: (par[0].x + par[1].x) / 2, my: (par[0].y + par[1].y) / 2 };
        andou = true;
      }
    });

    el.addEventListener("pointermove", function (e) {
      if (!ponteiros[e.pointerId] || !gesto) { pairar(e); return; }
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
      if (Math.abs(dx) + Math.abs(dy) > 3) andou = true;
      gesto.x = e.clientX; gesto.y = e.clientY;
      if (gesto.tipo === "pan") { pan(dx, dy); return; }
      manipular();
      cam.alvo.az -= dx * 0.008;
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
        if (!andou && e.type === "pointerup" && opcoes.aoClicar) {
          var achado = marcadorSob(e.clientX, e.clientY, 16);
          opcoes.aoClicar(achado ? achado.ponto : null);
        }
      }
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
      if (TECLA_PRESET[k]) { e.preventDefault(); if (!estado.foco) aplicarPreset(TECLA_PRESET[k]); return; }
      if (k === "+" || k === "=") { e.preventDefault(); zoom(1 / 1.2); return; }
      if (k === "-" || k === "_") { e.preventDefault(); zoom(1.2); return; }
      var az = 0, elv = 0;
      if (k === "ArrowLeft") az = -1; else if (k === "ArrowRight") az = 1;
      else if (k === "ArrowUp") elv = 1; else if (k === "ArrowDown") elv = -1;
      else return;
      e.preventDefault();
      manipular();
      cam.alvo.az += az * 6 * GRAU * mult;
      cam.alvo.el += elv * 5 * GRAU * mult;
      limitarCamera(cam.alvo);
      pedir();
    });

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

    function pairar(e) {
      if (!opcoes.aoPairar || estado.campo) return;
      var achado = marcadorSob(e.clientX, e.clientY, 13);
      if (achado !== estado.pairado) {
        estado.pairado = achado;
        el.style.cursor = achado ? "pointer" : "";
        pedir();
      }
      if (!achado) { opcoes.aoPairar(null); return; }
      var s = naTela(achado);
      opcoes.aoPairar(achado.ponto, s.x, s.y);
    }

    el.addEventListener("pointerleave", function () {
      estado.pairado = null;
      el.style.cursor = "";
      if (opcoes.aoPairar) opcoes.aoPairar(null);
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

    // Com movimento reduzido no sistema, explodir e montar saltam direto ao fim.
    var movimentoReduzido = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

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

      // Explodido e opacidades.
      var ex = estado.explode;
      estado.explode = aproximar(estado.explode, estado.explodeAlvo, 7, dt);
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
        c.az = aproximar(c.az, a.az, taxa, dt);
        c.el = aproximar(c.el, a.el, taxa, dt);
        c.dist = aproximar(c.dist, a.dist, taxa, dt);
        c.t.lerp(a.t, 1 - Math.exp(-dt * taxa));
        if (Math.abs(c.az - a.az) + Math.abs(c.el - a.el) + Math.abs(c.dist - a.dist) + c.t.distanceTo(a.t) > 0.0004) continuar = true;
        else { c.az = a.az; c.el = a.el; c.dist = a.dist; c.t.copy(a.t); }
      }
      camera.position.copy(c.t).addScaledVector(direcao(c.az, c.el), c.dist);
      camera.lookAt(c.t);
      camera.updateMatrixWorld();

      // Rotor e fluxo de ar.
      var soprador = estado.pecas.blower;
      if (soprador && estado.op.soprador && soprador.pc.present && estado.op.modo !== "calor") {
        soprador.corpo.traverse(function (o) { if (o.userData.rotor) o.rotation.x += dt * 14 * o.userData.rotor; });
        animarFluxo(soprador, agora);
        continuar = true;
      } else fluxo.visible = false;

      // Marcadores com tamanho constante na tela.
      var pxMundo = 2 * Math.tan(camera.fov * GRAU / 2) / (renderer.domElement.clientHeight || 1);
      posicionarMarcadores(pxMundo);

      var sel = estado.sel;
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

    /* ----- Interface pública ----- */

    function atualizar(op) {
      var antes = estado.op;
      estado.op = op;
      var info = null;

      var chave = chaveGeometria(op);
      if (chave !== estado.chaveGeo) {
        estado.chaveGeo = chave;
        construirPecas(op);
      } else {
        // Só o nível mudou: as peças já existem, basta atualizar quem aparece.
        var nova = FOGAO.pecas(op);
        nova.forEach(function (pc) { estado.pecas[pc.id].pc.present = pc.present; });
      }

      var campo = op.modo === "calor" && op.vista === "campo";
      if (campo !== estado.campo || (campo && op.pontos !== antes.pontos)) {
        estado.campo = campo;
        if (campo) {
          info = construirCampo(FOGAO.posicionarPontos(op.pontos || [], FOGAO.pecas(Object.assign({}, op, { explode: false }))));
          estado.infoCampo = info;
        } else if (grupoCampo) { cena.remove(grupoCampo); grupoCampo = null; }
        renderer.shadowMap.needsUpdate = true;
      }
      if (campo) info = estado.infoCampo;
      produto.visible = !campo;
      contato.visible = true;

      aplicarModo();
      estado.explodeAlvo = op.explode && !campo ? 1 : 0;

      // Foco em subsistema: a peça fica, o resto esmaece quase até sumir.
      var foco = !campo && op.foco && FOGAO.PECA_DA_AREA[op.foco] ? op.foco : null;
      var meta = foco && FOGAO.PECA_DA_AREA[foco];
      var noFoco = meta ? [meta.peca].concat(meta.junto || []) : null;
      estado.lista.forEach(function (pc) {
        var p = estado.pecas[pc.id];
        var alvo = 1;
        if (noFoco) alvo = noFoco.indexOf(pc.id) >= 0 ? 1 : 0.06;
        else if (pc.casca && op.explode) alvo = 0.14;
        if (p.opacidadeAlvo !== alvo) { p.opacidadeAlvo = alvo; }
        aplicarOpacidade(p);
      });

      construirMarcadores(op);
      estado.sel = null;
      if (op.sel) estado.marcadores.forEach(function (m) { if (m.ponto.measurement_id === op.sel) estado.sel = m; });
      if (estado.pairado && estado.marcadores.indexOf(estado.pairado) < 0) estado.pairado = null;

      if (op.novo && op.novo !== antes.novo) destacar(op.novo);

      if (!cam.enquadrado && host.clientWidth) redimensionar();
      if (foco !== estado.foco) {
        estado.foco = foco;
        if (foco) enquadrarFoco(foco);
        else if (cam.enquadrado) aplicarPreset(cam.preset || "isometrica", 900);
      } else if (!!op.explode !== !!antes.explode && cam.enquadrado && !foco) {
        // Explodir muda o volume: reenquadra mantendo o ângulo.
        var alvoE = copiaCam(cam.alvo), caixa = uniao(caixasVisiveis());
        alvoE.t = caixa.getCenter(new T.Vector3());
        alvoE.dist = distanciaQueEnquadra(caixa, 1.04);
        irPara(alvoE, cam.preset, 800);
      }

      pedir();
      return { info: info };
    }

    var api = {
      atualizar: atualizar,
      preset: function (nome) { if (!estado.foco) aplicarPreset(nome); },
      presetAtual: function () { return cam.preset; },
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
        marcadores: function () { return estado.marcadores.map(function (m) { return m.ponto.measurement_id; }); }
      }
    };
    // Acesso para depuração pelo console: document.getElementById(...)._fogao3d.
    Object.defineProperty(host, "_fogao3d", { value: api });
    return api;
  }

  return { criar: criar };
})();
