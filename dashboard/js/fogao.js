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
  // Centro do modelo: origem dos vetores radiais do explodido.
  var CENTRO = { x: CAIXA.x / 2, y: CAIXA.y / 2, z: CAIXA.z / 2 };

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

  /* Diferença de temperatura entre duas configurações (B − A): divergente e
     centrada em zero, azul mais frio em B e vermelho mais quente em B, com o
     meio neutro. Paleta RdBu do ColorBrewer, livre. Não é folga nem estado:
     por isso nem a RAMPA_A, que também vai de azul a vermelho, nem a do campo. */
  var RAMPA_DIFF = ["#053061", "#2166ac", "#4393c3", "#92c5de", "#f7f7f7", "#f4a582", "#d6604d", "#b2182b", "#67001f"];

  /* Variantes do tema escuro para as duas escalas calibradas sobre fundo
     claro. As de folga (A e B) não mudam: são lidas sobre o modelo 3D, cuja
     luz é a mesma nos dois temas, e a legenda tem de bater com o marcador.

     Campo: mesmas matizes na mesma ordem; só as paradas que sumiam no palco
     escuro (#232b39) — o violeta e o azul frios e o vermelho do topo — sobem
     em luminosidade (OKLCH, matiz e croma mantidos) até 3:1 contra ele.

     Diferença: a luminosidade espelhada em torno do fundo, como a "berlin"
     de Crameri. No claro o meio neutro é o que mais se parece com o fundo e
     os extremos os que mais se afastam; no escuro também, então o neutro
     vira cinza-escuro e os extremos clareiam. Azul continua frio em B e
     vermelho quente em B. */
  var ESCURO = {
    RAMPA_CAMPO: ["#8463ba", "#406be3", "#1f9fd8", "#35c4c0", "#8ecf5c", "#dcd247", "#e8912f", "#d43d2b"],
    RAMPA_DIFF: ["#a8ceff", "#70aff4", "#3999cf", "#437993", "#4d4d4d", "#9e5f48", "#d76a58", "#f68482", "#feb3b9"]
  };
  var CLARO = { RAMPA_CAMPO: RAMPA_CAMPO.slice(), RAMPA_DIFF: RAMPA_DIFF.slice() };
  var RAMPA_A_ORIGINAL = RAMPA_A.slice();

  /* Modo daltônico (recursos assistivos). Uma paleta para os três tipos, e não
     um filtro por tipo: as escalas mudam de fato, e a ordem continua legível
     em deuteranopia, protanopia e tritanopia (simulação de Machado et al.,
     2009, severidade total; testes/acessibilidade.test.js).
     - Folga: o azul segue "com folga" e o vermelho vira laranja-queimado; o
       laranja não se confunde com o azul em nenhum dos três tipos.
     - Campo: cividis, feita para daltonismo. O arco-íris sobe e desce de
       luminosidade e, sem a matiz, duas temperaturas diferentes pareciam a
       mesma; a cividis só sobe, e a ordem sobrevive à perda de cor.
     - Diferença: PuOr do ColorBrewer no lugar do RdBu, roxo mais frio em B e
       laranja mais quente em B. O escuro espelha a luminosidade como o RdBu. */
  var DALTONICO = {
    RAMPA_A: ["#0b3c6e", "#2f6ea8", "#8fb3d6", "#d1d3d4", "#f2bd84", "#df8a3c", "#b05f12", "#6b3606"],
    CLARO: {
      RAMPA_CAMPO: ["#00224e", "#1f3a6f", "#4a536b", "#6b6d70", "#8a8678", "#a89c6c", "#c7b356", "#d9c13a"],
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
   *
   * `b` é a caixa assentada [x, y, z, largura, profundidade, altura] e `ex` o
   * deslocamento com o slider no máximo; no meio do curso a peça anda
   * `ex · t`, sem deformar. Cada componente de `ex` aponta para fora do
   * CENTRO, no lado em que a peça mora (radial), e os vetores foram escolhidos
   * para que nenhum par de caixas se intercepte em t algum de 0 a 1 — o teste
   * explosao_raio_x.test.js verifica isso por intervalo exato, não amostrado.
   * Soprador e duto saem pelos lados, e não pela frente: pela frente
   * atravessariam o rodapé no meio do curso.
   *
   * `lvl` é o estágio de montagem em que a peça aparece (1 chassi, 2
   * ventilação, 3 eletrônica, 4 cooktop). `casca` marca o que fecha o produto
   * por fora e vira fantasma no explodido, para não tapar o miolo. `externa`
   * é o que o raio-X torna transparente: a casca, o vidro do cooktop e a
   * cavidade, que escondem a eletrônica e a ventilação. Nenhuma delas tem
   * termopar, então o raio-X não tira nenhuma zona clicável de alcance. */
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
        var chave = pt.Key_Area === "Main Vent Sys" && EH_DUTO.test(pt.TC_Name) ? "dutos" : pt.Key_Area;
        var disp = slots[chave];
        if (disp) {
          var k = fila[chave] || 0;
          slot = disp[k % disp.length];
          fila[chave] = k + 1;
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

  /* ----- Peças clicáveis -----
   *
   * Cada zona liga uma peça do modelo a um recorte dos pontos: a Key_Area e,
   * quando a peça divide a área com outra, o nome do termopar. As zonas
   * particionam os 78 pontos — cada um cai em exatamente uma — e cada zona
   * aponta para uma peça só. A fidelidade é a da especificação: esquema por
   * zona, não posição de CAD.
   *
   * Bobinas e suporte guardam uma zona por posição (FL, FR, RL, RR). O clique
   * nessas peças escolhe a zona pela posição mais próxima do ponto atingido,
   * e `regiao` é o círculo, em planta, que o destaque acende.
   *
   * Peça fora desta lista (laterais, porta, cavidade, cooktop, defletor,
   * bandeja) não tem termopar no conjunto de dados. */
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

  /* Amostra o campo numa grade regular da caixa inteira, já normalizado em
     0-255 pelo equalizador. O 3D sobe isso como textura de volume: em vez de
     refazer a soma de 78 termos a cada pixel, cada superfície lê o valor por
     interpolação trilinear, e a mesma grade serve à pele das peças, aos cortes
     e às linhas de fluxo.

     Aqui a distância não é comprimida em eixo nenhum: a compressão do
     `valorEm` das faces existe para a amostragem rasante de uma casca, e num
     volume ela deformaria o campo. */
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
