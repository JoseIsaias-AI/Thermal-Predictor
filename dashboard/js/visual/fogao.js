/* Modelo do fogão: peças, posição fixa de cada termopar e escalas de cor.
 *
 * Não desenha. fogao3d.js monta a cena a partir daqui e os gráficos 2D usam as rampas e
 * os marcadores. Unidades: x de 0 a 320 (esquerda → direita), y de 0 a 240 (frente →
 * fundo), z para cima.
 */

var FOGAO = (function () {
  "use strict";

  var CAIXA = { x: 320, y: 240, z: 298 };
  // Centro do modelo: origem dos vetores radiais do explodido.
  var CENTRO = { x: CAIXA.x / 2, y: CAIXA.y / 2, z: CAIXA.z / 2 };

  /* Duas rampas para a folga: a divergente ("Cor"), com cinza neutro sobre a banda de
     incerteza da RN-01, e a monocromática ("Tons de cinza"), que só codifica a ordem e
     evita ler azul como aprovado (RN-07). */
  var RAMPA_A = ["#0d436b", "#3f7aa3", "#9dbdd2", "#d1d3d4", "#dd9a92", "#c04b3d", "#8f2419", "#5e120b"];
  var RAMPA_B = ["#eef0f1", "#cfd2d5", "#a6aaae", "#7c8189", "#5b616b", "#3e444d", "#262b32", "#12151a"];

  /* Campo térmico: rampa contínua de temperatura, na convenção de mapa
     meteorológico. Aqui a cor é temperatura, não estado de risco. */
  var RAMPA_CAMPO = ["#3f1a6b", "#2b52c8", "#1f9fd8", "#35c4c0", "#8ecf5c", "#dcd247", "#e8912f", "#c8301f"];

  /* Diferença de temperatura entre duas configurações (B − A): divergente e
     centrada em zero, azul mais frio em B e vermelho mais quente em B, com o
     meio neutro. Paleta RdBu do ColorBrewer, livre. Não é folga nem estado:
     por isso nem a RAMPA_A, que também vai de azul a vermelho, nem a do campo. */
  var RAMPA_DIFF = ["#053061", "#2166ac", "#4393c3", "#92c5de", "#f7f7f7", "#f4a582", "#d6604d", "#b2182b", "#67001f"];

  /* Variantes do tema escuro. As rampas de folga não mudam (o 3D tem a mesma luz nos dois
     temas). No campo, as paradas que sumiam no fundo escuro sobem em luminosidade (OKLCH)
     até 3:1; na diferença, a luminosidade é espelhada em torno do fundo. */
  var ESCURO = {
    RAMPA_CAMPO: ["#8463ba", "#406be3", "#1f9fd8", "#35c4c0", "#8ecf5c", "#dcd247", "#e8912f", "#d43d2b"],
    RAMPA_DIFF: ["#a8ceff", "#70aff4", "#3999cf", "#437993", "#4d4d4d", "#9e5f48", "#d76a58", "#f68482", "#feb3b9"]
  };
  var CLARO = { RAMPA_CAMPO: RAMPA_CAMPO.slice(), RAMPA_DIFF: RAMPA_DIFF.slice() };
  var RAMPA_A_ORIGINAL = RAMPA_A.slice();

  /* Modo daltônico: uma paleta que mantém a ordem nos três tipos (simulação de Machado et
     al., 2009). Folga: azul e laranja-queimado; campo: cividis; diferença: PuOr. */
  var DALTONICO = {
    RAMPA_A: ["#0b3c6e", "#2f6ea8", "#8fb3d6", "#d1d3d4", "#f2bd84", "#df8a3c", "#b05f12", "#6b3606"],
    CLARO: {
      RAMPA_CAMPO: ["#00224e", "#1f3a6f", "#4a536b", "#6b6d70", "#8a8678", "#a89c6c", "#c4b058", "#e6c62a"],
      RAMPA_DIFF: ["#2d004b", "#542788", "#8073ac", "#b2abd2", "#f7f7f7", "#fdb863", "#e08214", "#b35806", "#7f3b08"]
    },
    ESCURO: {
      RAMPA_CAMPO: ["#4c7ad0", "#6582b8", "#7d8aa0", "#948f88", "#aa9a75", "#c3ad62", "#dcc54d", "#fee838"],
      RAMPA_DIFF: ["#dccff5", "#b9a7e3", "#8f80c2", "#5e5784", "#4d4d4d", "#8a6339", "#c27a2c", "#eda152", "#ffd29a"]
    }
  };

  function daltonico() {
    return typeof ACESSIBILIDADE !== "undefined" && ACESSIBILIDADE.nivel("daltonico") > 0;
  }

  /* Troca as paradas no próprio array: quem guardou a referência (o 3D
     compara `rampa === FOGAO.RAMPA_DIFF`) continua certo. */
  function trocar(rampa, paradas) {
    rampa.splice.apply(rampa, [0, rampa.length].concat(paradas));
  }

  function usarTema(tema) {
    var d = daltonico();
    var fonte = d
      ? (tema === "escuro" ? DALTONICO.ESCURO : DALTONICO.CLARO)
      : (tema === "escuro" ? ESCURO : CLARO);
    trocar(RAMPA_CAMPO, fonte.RAMPA_CAMPO);
    trocar(RAMPA_DIFF, fonte.RAMPA_DIFF);
    trocar(RAMPA_A, d ? DALTONICO.RAMPA_A : RAMPA_A_ORIGINAL);
  }

  if (typeof TEMA !== "undefined") {
    usarTema(TEMA.atual());
    TEMA.aoMudar(usarTema);
  }

  var FAIXAS = ["≥ +50%", "+30 a +50%", "+10 a +30%", "0 a +10%", "−10 a 0%", "−30 a −10%", "−50 a −30%", "< −50%"];

  /* ----- Peças -----
   * `b` é a caixa assentada [x, y, z, largura, profundidade, altura] e `ex` o deslocamento
   * no explodido máximo, radial, escolhido para nenhum par de caixas se interceptar
   * (explosao_raio_x.test.js). `lvl` é o estágio de montagem; `casca` vira fantasma no
   * explodido; `externa` fica transparente no raio-X e não tem termopar. */
  function pecas(op) {
    op = op || {};
    var nivel = op.nivel == null ? 4 : op.nivel;
    var bx = op.placa === "right" ? 164 : 84;

    var lista = [
      { id: "rodape", nome: "Rodapé", lvl: 1, casca: true, externa: true, b: [8, 0, 0, 304, 6, 26], ex: [0, 0, 0] },
      { id: "lateralE", nome: "Lateral esquerda", lvl: 1, casca: true, externa: true, b: [0, -18, 0, 6, 258, 290], ex: [-110, 0, 0] },
      { id: "lateralD", nome: "Lateral direita", lvl: 1, casca: true, externa: true, b: [314, -18, 0, 6, 258, 290], ex: [110, 0, 0] },
      { id: "ovenCavity", nome: "Cavidade do forno", lvl: 1, externa: true, b: [24, 26, 34, 272, 196, 190], ex: [0, 0, 0] },
      { id: "porta", nome: "Porta do forno", lvl: 1, casca: true, externa: true, b: [6, -18, 28, 308, 18, 162], ex: [0, -130, 0] },
      { id: "mainback", nome: "Traseira (Mainback)", lvl: 2, b: [0, 240, 20, 320, 8, 300], ex: [0, 120, 0] },
      { id: "blower", nome: "Soprador", lvl: 2, b: [36, 132, 6, 104, 64, 26], ex: [-100, 0, 0] },
      { id: "duct", nome: "Duto de ar", lvl: 2, b: [146, 148, 6, 48, 44, 22], ex: [120, 0, 0] },
      { id: "deflector", nome: "Defletor", lvl: 3, b: [118, 40, 227, 84, 54, 3], ex: [0, 0, 42] },
      { id: "ipcTray", nome: "Bandeja da IPC", lvl: 3, b: [bx - 10, 30, 232, 160, 132, 6], ex: [0, 0, 88] },
      { id: "ipcBoard", nome: "Placa de potência (IPC)", lvl: 3, b: [bx, 40, 238, 140, 112, 3], ex: [0, 0, 128] },
      { id: "ipcLid", nome: "Tampa da IPC", lvl: 3, b: [bx - 10, 30, 255, 160, 132, 6], ex: [0, 0, 190] },
      { id: "coilSupport", nome: "Suporte das bobinas", lvl: 4, b: [20, 34, 264, 280, 180, 4], ex: [0, 0, 240] },
      { id: "coils", nome: "Bobinas de indução", lvl: 4, b: [48, 28, 268, 226, 188, 9], ex: [0, 0, 272] },
      { id: "cooktop", nome: "Cooktop de vidro", lvl: 4, externa: true, b: [0, 0, 290, 320, 240, 8], ex: [0, 0, 330] },
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

    /* Os pontos de duto moram no duto, e não no soprador: é a peça que a zona
       clicável deles aponta, e o marcador tem de cair onde o clique cai. */
    var bl = acharPeca(lista, "blower");
    s["Main Vent Sys"] = [[16, 24, 27], [60, 18, 27], [30, 44, 12], [82, 36, 22], [46, 54, 14]]
      .map(function (q) { return { peca: "blower", g: [bl.b[0] + q[0], bl.b[1] + q[1], bl.b[2] + q[2]] }; });
    var du = acharPeca(lista, "duct");
    s.dutos = [[14, 10, 23], [36, 30, 23]]
      .map(function (q) { return { peca: "duct", g: [du.b[0] + q[0], du.b[1] + q[1], du.b[2] + q[2]] }; });

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

  /* Lugar fixo de cada termopar ([área do slot, índice]), para o mesmo termopar ficar no
     mesmo lugar em qualquer configuração. Cobre os 78 pontos do catálogo; bobinas e placas
     de Coil Temps casam pelo sufixo de posição (FL, FR, RL, RR). Esquema por zona, não CAD:
     ordem canônica de nucleo/schema.js, com o nome decidindo onde a geometria é legível. */
  var POSICAO_DO_TERMOPAR = {
    "IPC P01 | IPC Comp": ["IPC Comp", 0],
    "IPC P02 | IPC Comp": ["IPC Comp", 1],
    "IPC P03 | IPC Comp": ["IPC Comp", 2],
    "IPC P04 | IPC Comp": ["IPC Comp", 3],
    "IPC P05 | IPC Comp": ["IPC Comp", 4],
    "IPC P06 | IPC Comp": ["IPC Comp", 5],
    "IPC P07 | IPC Comp": ["IPC Comp", 6],
    "IPC P08 | IPC Comp": ["IPC Comp", 7],
    "IPC P09 | IPC Comp": ["IPC Comp", 8],
    "IPC P10 | IPC Comp": ["IPC Comp", 9],
    "IPC P11 | IPC Comp": ["IPC Comp", 10],
    "IPC P12 | IPC Comp": ["IPC Comp", 11],
    "IPC P13 | IPC Comp": ["IPC Comp", 12],
    "IPC P14 | IPC Comp": ["IPC Comp", 13],
    "IPC P15 | IPC Comp": ["IPC Comp", 14],
    "IPC P16 | IPC Comp": ["IPC Comp", 15],
    "IPC P17 | IPC Comp": ["IPC Comp", 16],
    "IPC P18 | IPC Comp": ["IPC Comp", 17],
    "IPC P19 | IPC Comp": ["IPC Comp", 18],
    "IPC P20 | IPC Comp": ["IPC Comp", 19],
    "IPC P21 | IPC Comp": ["IPC Comp", 20],
    "IPC P22 | IPC Comp": ["IPC Comp", 21],
    "IPC P23 | IPC Comp": ["IPC Comp", 22],
    "IPC P24 | IPC Comp": ["IPC Comp", 23],
    "IPC P25 | IPC Comp": ["IPC Comp", 24],
    "IPC P26 | IPC Comp": ["IPC Comp", 25],
    "IPC P27 | IPC Comp": ["IPC Comp", 26],
    "IPC P28 | IPC Comp": ["IPC Comp", 27],
    "IPC P29 | IPC Comp": ["IPC Comp", 28],
    "IPC P30 | IPC Comp": ["IPC Comp", 29],
    "IPC P31 | IPC Comp": ["IPC Comp", 30],
    "IPC P32 | IPC Comp": ["IPC Comp", 31],
    "IPC P33 | IPC Comp": ["IPC Comp", 32],
    "IPC P34 | IPC Comp": ["IPC Comp", 33],
    "IPC P35 | IPC Comp": ["IPC Comp", 34],
    "IPC P36 | IPC Comp": ["IPC Comp", 35],
    "IPC P37 | IPC Comp": ["IPC Comp", 36],
    "Mainback P01 | Mainback": ["Mainback", 0],
    "Mainback P02 | Mainback": ["Mainback", 1],
    "Mainback P03 | Mainback": ["Mainback", 2],
    "Mainback P04 | Mainback": ["Mainback", 3],
    "Mainback P05 | Mainback": ["Mainback", 4],
    "Mainback P06 | Mainback": ["Mainback", 5],
    "Mainback P07 | Mainback": ["Mainback", 6],
    "Mainback P08 | Mainback": ["Mainback", 7],
    "Mainback P09 | Mainback": ["Mainback", 8],
    "Mainback P10 | Mainback": ["Mainback", 9],
    "Mainback P11 | Mainback": ["Mainback", 10],
    "Soprador P01 | Main Vent Sys": ["Main Vent Sys", 0],
    "Soprador P02 | Main Vent Sys": ["Main Vent Sys", 1],
    "Entrada do soprador P01 | Main Vent Sys": ["Main Vent Sys", 2],
    "Entrada do soprador P02 | Main Vent Sys": ["Main Vent Sys", 3],
    "Soprador P03 | Main Vent Sys": ["Main Vent Sys", 4],
    "Duto P01 | Main Vent Sys": ["dutos", 0],
    "Duto P02 | Main Vent Sys": ["dutos", 1],
    "Knobs P05 | CT Knobs": ["CT Knobs", 4],
    "Knobs P06 | CT Knobs": ["CT Knobs", 5],
    "Knobs P02 | CT Knobs": ["CT Knobs", 1],
    "Knobs P01 | CT Knobs": ["CT Knobs", 0],
    "Knobs P03 | CT Knobs": ["CT Knobs", 2],
    "Knobs P04 | CT Knobs": ["CT Knobs", 3],
    "IPC Cooling P02 | IPC Cooling": ["IPC Cooling", 1],
    "IPC Cooling P03 | IPC Cooling": ["IPC Cooling", 2],
    "IPC Cooling P01 | IPC Cooling": ["IPC Cooling", 0],
    "IPC Cooling P04 | IPC Cooling": ["IPC Cooling", 3],
    "IPC Cooling P05 | IPC Cooling": ["IPC Cooling", 4],
    "HMI P01 | Oven HMI": ["Oven HMI", 0],
    "HMI P02 | Oven HMI": ["Oven HMI", 1],
    "HMI P03 | Oven HMI": ["Oven HMI", 2],
    "HMI P04 | Oven HMI": ["Oven HMI", 3]
  };

  function slotDoPonto(pt, slots) {
    if (pt.Key_Area === "Coil Temps") {
      var m = /\b(FL|FR|RL|RR)\s*$/.exec(pt.TC_Name || "");
      if (!m) return null;
      return /^Coil\b/.test(pt.TC_Name) ? slots.bobinas[m[1]] : slots.placas[m[1]];
    }

    var fixo = POSICAO_DO_TERMOPAR[pt.measurement_id];
    if (!fixo || !slots[fixo[0]]) return null;

    return slots[fixo[0]][fixo[1]] || null;
  }

  /* O lugar de cada ponto não depende da lista nem da ordem em que ela vem:
     ponto fora do catálogo não ganha lugar emprestado de outro. */
  function posicionarPontos(pontos, lista) {
    var slots = slotsPorArea(lista), saida = [];
    pontos.forEach(function (pt) {
      var slot = slotDoPonto(pt, slots);
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

  /* ----- Peças clicáveis -----
   * Cada zona liga uma peça a um recorte dos pontos (Key_Area e, quando a peça divide a área,
   * o nome do termopar), e as zonas particionam os 78 pontos. Bobinas e suporte têm uma zona
   * por posição, escolhida pelo ponto mais próximo do clique. */
  var EH_DUTO = /\bDuct\b/;

  var ZONAS = [
    { id: "ipcBoard", peca: "ipcBoard", area: "IPC Comp", nome: "Placa de potência (IPC)" },
    { id: "ipcLid", peca: "ipcLid", area: "IPC Cooling", nome: "Tampa e dutos da IPC" },
    { id: "blower", peca: "blower", area: "Main Vent Sys", nome: "Soprador (AC Blower)", excluiNome: EH_DUTO },
    { id: "duct", peca: "duct", area: "Main Vent Sys", nome: "Duto de ar", nomeTC: EH_DUTO },
    { id: "mainback", peca: "mainback", area: "Mainback", nome: "Traseira (Mainback)" },
    { id: "knobBar", peca: "knobBar", area: "CT Knobs", nome: "Painel de manípulos" },
    { id: "hmiPanel", peca: "hmiPanel", area: "Oven HMI", nome: "Interface do forno (HMI)" }
  ];

  var NOME_POSICAO = { FL: "frontal esquerda", FR: "frontal direita", RL: "traseira esquerda", RR: "traseira direita" };

  POSICOES.forEach(function (c) {
    var raio = RAIO_BOBINA[c[0]];
    ZONAS.push({
      id: "coil-" + c[0], peca: "coils", area: "Coil Temps", pos: c[0],
      nome: "Bobina " + c[0], sub: "posição " + NOME_POSICAO[c[0]],
      nomeTC: new RegExp("^Coil " + c[0] + "$"), regiao: { x: c[1], y: c[2], r: raio + 4 }
    });
    ZONAS.push({
      id: "placa-" + c[0], peca: "coilSupport", area: "Coil Temps", pos: c[0],
      nome: "Placa de alumínio " + c[0], sub: "posição " + NOME_POSICAO[c[0]],
      nomeTC: new RegExp("^Aluminium Plate " + c[0] + "$"), regiao: { x: c[1], y: c[2], r: raio + 16 }
    });
  });

  var ZONA_POR_ID = {};
  ZONAS.forEach(function (z) { ZONA_POR_ID[z.id] = z; });

  function pontoNaZona(z, p) {
    if (p.Key_Area !== z.area) return false;
    if (z.nomeTC && !z.nomeTC.test(p.TC_Name)) return false;
    if (z.excluiNome && z.excluiNome.test(p.TC_Name)) return false;
    return true;
  }

  function zonaDoPonto(p) {
    for (var i = 0; i < ZONAS.length; i++) if (pontoNaZona(ZONAS[i], p)) return ZONAS[i];
    return null;
  }

  // Filtra sem reordenar: a ordem de severidade é a que o dado já traz.
  function pontosDaZona(z, pontos) {
    return pontos.filter(function (p) { return pontoNaZona(z, p); });
  }

  /* Zona sob um ponto atingido na peça, em coordenadas do modelo montado.
     Nas peças por posição vence o centro de bobina mais próximo em planta:
     o suporte inteiro fica coberto, sem fresta entre quadrantes. */
  function zonaEm(pecaId, x, y) {
    var melhor = null, dMin = Infinity;
    ZONAS.forEach(function (z) {
      if (z.peca !== pecaId) return;
      var d = z.regiao ? Math.hypot(x - z.regiao.x, y - z.regiao.y) : 0;
      if (d < dMin) { dMin = d; melhor = z; }
    });
    return melhor;
  }

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

  /* Interpolação por distância inversa. `k` comprime o eixo normal à face, para o que está
     logo atrás de um ponto da superfície pesar mais que o que está longe de lado. */
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

  /* Amostra o campo numa grade regular da caixa, já normalizado em 0-255, que o 3D usa
     como textura de volume; aqui a distância não é comprimida. */
  function grade3D(amostras, eq, nx, ny, nz) {
    var dados = new Uint8Array(nx * ny * nz), i = 0;
    for (var iz = 0; iz < nz; iz++) {
      var z = (iz + 0.5) / nz * CAIXA.z;
      for (var iy = 0; iy < ny; iy++) {
        var y = (iy + 0.5) / ny * CAIXA.y;
        for (var ix = 0; ix < nx; ix++) {
          var t = eq.normalizar(valorEm(amostras, (ix + 0.5) / nx * CAIXA.x, y, z));
          dados[i++] = Math.round(Math.max(0, Math.min(1, t)) * 255);
        }
      }
    }
    return { dados: dados, nx: nx, ny: ny, nz: nz };
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

  /* Normalizador da diferença: linear e simétrico em torno do zero, sem
     equalizar — a cor tem de crescer na proporção dos graus, e o zero cai
     sempre no meio da rampa. Até `limiar` em módulo a diferença é desprezível
     e fica no neutro; além de `extremo` satura. */
  function normalizadorDivergente(extremo, limiar) {
    return {
      normalizar: function (v) {
        if (Math.abs(v) <= (limiar || 0)) return 0.5;
        return 0.5 + Math.max(-1, Math.min(1, v / extremo)) / 2;
      },
      quantil: function (f) { return (f * 2 - 1) * extremo; }
    };
  }

  return {
    CAIXA: CAIXA,
    normalizadorDivergente: normalizadorDivergente,
    RAMPA_DIFF: RAMPA_DIFF,
    CENTRO: CENTRO,
    POSICOES: POSICOES,
    RAIO_BOBINA: RAIO_BOBINA,
    MANIPULOS: MANIPULOS,
    pecas: pecas,
    acharPeca: acharPeca,
    POSICAO_DO_TERMOPAR: POSICAO_DO_TERMOPAR,
    posicionarPontos: posicionarPontos,
    PECA_DA_AREA: PECA_DA_AREA,
    ZONAS: ZONAS,
    ZONA_POR_ID: ZONA_POR_ID,
    zonaDoPonto: zonaDoPonto,
    pontosDaZona: pontosDaZona,
    zonaEm: zonaEm,
    valorEm: valorEm,
    grade3D: grade3D,
    equalizador: equalizador,
    faixaDaRampa: faixaDaRampa,
    formaDoPonto: formaDoPonto,
    corDaRampa: corDaRampa,
    RAMPA_A: RAMPA_A,
    RAMPA_B: RAMPA_B,
    RAMPA_CAMPO: RAMPA_CAMPO,
    RAMPAS_ESCURO: ESCURO,
    RAMPAS_DALTONICO: DALTONICO,
    usarTema: usarTema,
    FAIXAS: FAIXAS
  };
})();
