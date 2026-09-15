/* Modelo do fogão: peças, posições dos termopares e escalas de cor.
 *
 * Não desenha nada. O viewport 3D (fogao3d.js) monta a cena a partir daqui, e
 * os gráficos 2D das telas usam as rampas e os marcadores. Unidades do modelo:
 * x da esquerda para a direita (0 a 320), y da frente para o fundo (0 a 240) e
 * z para cima; o topo do cooktop fica em 298.
 */

var FOGAO = (function () {
  "use strict";

  var CAIXA = { x: 320, y: 240, z: 298 };

  /* Duas rampas para a mesma folga, expostas na interface como "Cor" e "Tons
     de cinza". A divergente codifica o sinal da folga na matiz, e o cinza
     neutro do meio cai sobre a faixa de 0 a +10%, que e a banda de incerteza
     de RN-01: inconclusivo nao puxa para lado nenhum. A monocromatica codifica
     so a ordem, e existe porque azul-vermelho convida a ler azul como
     aprovado — leitura que RN-07 proibe. */
  var RAMPA_A = ["#0d436b", "#3f7aa3", "#9dbdd2", "#d1d3d4", "#dd9a92", "#c04b3d", "#8f2419", "#5e120b"];
  var RAMPA_B = ["#eef0f1", "#cfd2d5", "#a6aaae", "#7c8189", "#5b616b", "#3e444d", "#262b32", "#12151a"];

  /* Campo térmico: rampa contínua de temperatura, na convenção de mapa
     meteorológico. Aqui a cor é temperatura, não estado de risco. */
  var RAMPA_CAMPO = ["#3f1a6b", "#2b52c8", "#1f9fd8", "#35c4c0", "#8ecf5c", "#dcd247", "#e8912f", "#c8301f"];

  var FAIXAS = ["≥ +50%", "+30 a +50%", "+10 a +30%", "0 a +10%", "−10 a 0%", "−30 a −10%", "−50 a −30%", "< −50%"];

  /* ----- Peças -----
   *
   * `b` é a caixa assentada [x, y, z, largura, profundidade, altura] e `ex` o
   * deslocamento no explodido. As caixas não se interceptam em nenhum dos dois
   * estados: a pilha de eletrônica cabe nos 66 entre o teto da cavidade e o
   * vidro, e no explodido cada nível sobe acima do anterior.
   *
   * `lvl` é o estágio de montagem em que a peça aparece (1 chassi, 2
   * ventilação, 3 eletrônica, 4 cooktop). `casca` marca o que fecha o produto
   * por fora e vira fantasma no explodido, para não tapar o miolo. */
  function pecas(op) {
    op = op || {};
    var nivel = op.nivel == null ? 4 : op.nivel;
    var bx = op.placa === "right" ? 164 : 84;

    var lista = [
      { id: "rodape", nome: "Rodapé", lvl: 1, casca: true, b: [8, 0, 0, 304, 6, 26], ex: [0, 0, 0] },
      { id: "lateralE", nome: "Lateral esquerda", lvl: 1, casca: true, b: [0, -18, 0, 6, 258, 290], ex: [-70, 0, 0] },
      { id: "lateralD", nome: "Lateral direita", lvl: 1, casca: true, b: [314, -18, 0, 6, 258, 290], ex: [70, 0, 0] },
      { id: "ovenCavity", nome: "Cavidade do forno", lvl: 1, b: [24, 26, 34, 272, 196, 190], ex: [0, 0, 0] },
      { id: "porta", nome: "Porta do forno", lvl: 1, casca: true, b: [6, -18, 28, 308, 18, 162], ex: [0, -130, 0] },
      { id: "mainback", nome: "Traseira (Mainback)", lvl: 2, b: [0, 240, 20, 320, 8, 300], ex: [0, 120, 0] },
      { id: "blower", nome: "Soprador", lvl: 2, b: [36, 132, 6, 104, 64, 26], ex: [0, -200, 0] },
      { id: "duct", nome: "Duto de ar", lvl: 2, b: [146, 148, 6, 48, 44, 22], ex: [0, -200, 0] },
      { id: "deflector", nome: "Defletor", lvl: 3, b: [118, 40, 227, 84, 54, 3], ex: [0, 0, 42] },
      { id: "ipcTray", nome: "Bandeja da IPC", lvl: 3, b: [bx - 10, 30, 232, 160, 132, 6], ex: [0, 0, 88] },
      { id: "ipcBoard", nome: "Placa de potência (IPC)", lvl: 3, b: [bx, 40, 238, 140, 112, 3], ex: [0, 0, 128] },
      { id: "ipcLid", nome: "Tampa da IPC", lvl: 3, b: [bx - 10, 30, 255, 160, 132, 6], ex: [0, 0, 190] },
      { id: "coilSupport", nome: "Suporte das bobinas", lvl: 4, b: [20, 34, 264, 280, 180, 4], ex: [0, 0, 240] },
      { id: "coils", nome: "Bobinas de indução", lvl: 4, b: [48, 28, 268, 226, 188, 9], ex: [0, 0, 272] },
      { id: "cooktop", nome: "Cooktop de vidro", lvl: 4, b: [0, 0, 290, 320, 240, 8], ex: [0, 0, 330] },
      { id: "knobBar", nome: "Painel de manípulos", lvl: 4, b: [6, -14, 194, 308, 14, 94], ex: [0, -86, 0] },
      { id: "hmiPanel", nome: "Interface do forno (HMI)", lvl: 4, b: [116, -19, 238, 88, 5, 36], ex: [0, -112, 0] }
    ];

    return lista.map(function (pc) {
      pc.present = nivel >= pc.lvl;
      pc.hi = op.novo === pc.id;
      return pc;
    });
  }

  function acharPeca(lista, id) {
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i];
    return null;
  }

  // FL/FR/RL/RR são as quatro posições reais das bobinas no cooktop.
  var POSICOES = [["FL", 90, 76], ["FR", 232, 76], ["RL", 90, 176], ["RR", 232, 176]];
  var RAIO_BOBINA = { FL: 40, FR: 32, RL: 32, RR: 40 };

  // Manípulos: quatro zonas à esquerda e à direita, o display no meio.
  var MANIPULOS = [34, 70, 250, 286];

  /* Posições dos 78 pontos por subsistema, na caixa assentada, com a peça a
     que cada um pertence. O viewport prende o marcador à peça, e ele segue a
     peça no explodido. Contagens da base: 37 / 11 / 8 / 7 / 6 / 5 / 4. */
  function slotsPorArea(lista) {
    var s = {};

    var board = acharPeca(lista, "ipcBoard");
    var topo = board.b[2] + board.b[5];
    s["IPC Comp"] = [];
    for (var i = 0; i < 37; i++) {
      s["IPC Comp"].push({ peca: "ipcBoard", g: [board.b[0] + 13 + (i % 7) * 19, board.b[1] + 13 + Math.floor(i / 7) * 17, topo + 20], haste: topo });
    }

    var mb = acharPeca(lista, "mainback");
    s["Mainback"] = [];
    for (var j = 0; j < 11; j++) {
      s["Mainback"].push({ peca: "mainback", g: [40 + (j % 4) * 80, mb.b[1] - 2, 70 + Math.floor(j / 4) * 80] });
    }

    var cs = acharPeca(lista, "coilSupport");
    var co = acharPeca(lista, "coils");
    s.bobinas = {}; s.placas = {};
    POSICOES.forEach(function (c) {
      s.bobinas[c[0]] = { peca: "coils", g: [c[1], c[2], co.b[2] + co.b[5] + 2] };
      s.placas[c[0]] = { peca: "coilSupport", g: [c[1] + RAIO_BOBINA[c[0]] + 6, c[2] + 20, cs.b[2] + cs.b[5] + 1] };
    });

    var bl = acharPeca(lista, "blower");
    s["Main Vent Sys"] = [[16, 24, 27], [60, 18, 27], [30, 44, 12], [82, 36, 22], [46, 54, 14], [4, 30, 16], [96, 16, 27]]
      .map(function (q) { return { peca: "blower", g: [bl.b[0] + q[0], bl.b[1] + q[1], bl.b[2] + q[2]] }; });

    var kb = acharPeca(lista, "knobBar");
    s["CT Knobs"] = [MANIPULOS[0], MANIPULOS[1], MANIPULOS[2], MANIPULOS[3], 106, 214].map(function (x, i) {
      return { peca: "knobBar", g: [x, kb.b[1] - (i < 4 ? 14 : 2), kb.b[2] + (i < 4 ? 46 : 20)] };
    });

    var lid = acharPeca(lista, "ipcLid");
    var tl = lid.b[2] + lid.b[5] + 1;
    s["IPC Cooling"] = [
      [lid.b[0] + 20, lid.b[1] + 30, tl], [lid.b[0] + 130, lid.b[1] + 40, tl], [lid.b[0] + lid.b[3] + 2, lid.b[1] + 90, lid.b[2] + 2],
      [lid.b[0] + 74, lid.b[1] + 110, tl], [lid.b[0] + 100, lid.b[1] + 16, tl]
    ].map(function (g) { return { peca: "ipcLid", g: g }; });

    var hp = acharPeca(lista, "hmiPanel");
    s["Oven HMI"] = [[18, 26], [44, 26], [18, 10], [70, 12]].map(function (q) {
      return { peca: "hmiPanel", g: [hp.b[0] + q[0], hp.b[1] - 1, hp.b[2] + q[1]] };
    });

    return s;
  }

  /* `Bobina FL` e `Suporte FL` casam pelo sufixo de posição, e não pela
     ordem em que chegam — a ordem do dado é por severidade, não geométrica. */
  function posicionarPontos(pontos, lista) {
    var slots = slotsPorArea(lista), fila = {}, saida = [];
    pontos.forEach(function (pt) {
      var slot = null;
      if (pt.Key_Area === "Coil Temps") {
        var m = /\b(FL|FR|RL|RR)\s*$/.exec(pt.TC_Name);
        if (m) slot = /^Coil\b/.test(pt.TC_Name) ? slots.bobinas[m[1]] : slots.placas[m[1]];
      }
      if (!slot) {
        var disp = slots[pt.Key_Area];
        if (disp) {
          var k = fila[pt.Key_Area] || 0;
          slot = disp[k % disp.length];
          fila[pt.Key_Area] = k + 1;
        }
      }
      if (slot) saida.push({ ponto: pt, g: slot.g, peca: slot.peca, haste: slot.haste });
    });
    return saida;
  }

  /* Peça em que cada subsistema mora, e de onde ela se lê melhor: de cima
     ("planta") ou de frente ("elevacao"). `junto` são peças que seguem
     visíveis com ela no foco. */
  var PECA_DA_AREA = {
    "IPC Comp": { peca: "ipcBoard", plano: "planta", nome: "Placa de potência (IPC)" },
    "IPC Cooling": { peca: "ipcLid", plano: "planta", nome: "Tampa e dutos da IPC" },
    "Coil Temps": { peca: "coilSupport", junto: ["coils"], plano: "planta", nome: "Bobinas e placas de alumínio" },
    "Main Vent Sys": { peca: "blower", junto: ["duct"], plano: "planta", nome: "Ventilação principal" },
    "Mainback": { peca: "mainback", plano: "elevacao", nome: "Traseira do produto" },
    "CT Knobs": { peca: "knobBar", plano: "elevacao", nome: "Manípulos do cooktop" },
    "Oven HMI": { peca: "hmiPanel", plano: "elevacao", nome: "Interface do forno" }
  };

  // Os cortes acompanham RN-01: 0 e +10% são fronteiras.
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
    function n(v) { return v.toFixed(2); }
    var x = n(cx), y = n(cy);
    if (mono) return "M" + n(cx - 4.2) + " " + n(cy - 4.2) + " h8.4 v8.4 h-8.4 Z";
    if (estado === "acima_do_limite") return "M" + x + " " + n(cy - 6) + " L" + n(cx + 5.4) + " " + n(cy + 3.6) + " L" + n(cx - 5.4) + " " + n(cy + 3.6) + " Z";
    if (estado === "banda_de_incerteza") return "M" + x + " " + n(cy - 5.6) + " L" + n(cx + 5.6) + " " + y + " L" + x + " " + n(cy + 5.6) + " L" + n(cx - 5.6) + " " + y + " Z";
    return "M" + n(cx - 4.4) + " " + y + " a4.4 4.4 0 1 0 8.8 0 a4.4 4.4 0 1 0 -8.8 0";
  }

  function corDaRampa(rampa, t) {
    var f = Math.max(0, Math.min(0.9999, t)) * (rampa.length - 1);
    var i = Math.floor(f), r = f - i;
    var a = rampa[i], b = rampa[i + 1] || rampa[i];
    function ch(h, k) { return parseInt(h.substr(1 + k * 2, 2), 16); }
    return [
      Math.round(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * r),
      Math.round(ch(a, 1) + (ch(b, 1) - ch(a, 1)) * r),
      Math.round(ch(a, 2) + (ch(b, 2) - ch(a, 2)) * r)
    ];
  }

  /* Interpolação por distância inversa no volume.

     `k` comprime um eixo. Os termopares estão dentro do produto, e a distância
     atravessando a chapa dominaria a distância ao longo dela: comprimir a
     direção normal à face faz o que está logo atrás de um ponto da superfície
     pesar mais do que o que está longe de lado. */
  function valorEm(amostras, x, y, z, k) {
    var kx = k ? k[0] : 1, ky = k ? k[1] : 1, kz = k ? k[2] : 1;
    var soma = 0, peso = 0;
    for (var i = 0; i < amostras.length; i++) {
      var a = amostras[i];
      var dx = (a.x - x) * kx, dy = (a.y - y) * ky, dz = (a.z - z) * kz;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 4) return a.v;
      var w = 1 / (d2 * d2);
      soma += a.v * w;
      peso += w;
    }
    return soma / peso;
  }

  /* Equaliza por quantil: a base é assimétrica (a mediana fica bem abaixo
     do máximo), e numa rampa linear três quartos dos pontos cairiam no primeiro
     quarto da escala. A legenda rotula os quartis em graus. */
  function equalizador(valores) {
    var ord = valores.slice().sort(function (a, b) { return a - b; });
    var n = ord.length;
    return {
      normalizar: function (v) {
        var lo = 0, hi = n;
        while (lo < hi) { var m = (lo + hi) >> 1; if (ord[m] < v) lo = m + 1; else hi = m; }
        return n > 1 ? lo / (n - 1) : 0;
      },
      quantil: function (f) { return ord[Math.round(f * (n - 1))]; }
    };
  }

  return {
    CAIXA: CAIXA,
    POSICOES: POSICOES,
    RAIO_BOBINA: RAIO_BOBINA,
    MANIPULOS: MANIPULOS,
    pecas: pecas,
    acharPeca: acharPeca,
    posicionarPontos: posicionarPontos,
    PECA_DA_AREA: PECA_DA_AREA,
    valorEm: valorEm,
    equalizador: equalizador,
    faixaDaRampa: faixaDaRampa,
    formaDoPonto: formaDoPonto,
    corDaRampa: corDaRampa,
    RAMPA_A: RAMPA_A,
    RAMPA_B: RAMPA_B,
    RAMPA_CAMPO: RAMPA_CAMPO,
    FAIXAS: FAIXAS
  };
})();
