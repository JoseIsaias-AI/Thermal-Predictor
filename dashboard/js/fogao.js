/* Desenho axonométrico do fogão, em SVG.
 *
 * Projeção dimétrica: largura (1, 0,22), profundidade (0,70, -0,40), altura
 * vertical. Sem ponto de fuga — comparar peças importa mais que realismo, e
 * perspectiva sugeriria precisão dimensional que não temos (não há CAD).
 *
 * `yaw` gira o modelo em torno do eixo vertical e `elev` inclina a câmera
 * entre a vista quase frontal e a quase de planta. A ordem de pintura das
 * peças é a ordem de montagem, que é invariante aos dois.
 */

var FOGAO = (function () {
  "use strict";

  var S = 0.8, OX = 60, OY_BASE = 520, OY = OY_BASE;
  var NS = "http://www.w3.org/2000/svg";
  var CAIXA = { x: 320, y: 240, z: 300 };
  var CX = 160, CY = 120;

  var YAW = 0;
  var LIMITE_YAW = 0.6; // ±34°, faixa em que as três faces da frente seguem visíveis

  /* Elevação da câmera.
   *
   * ELEV_0 é o ângulo já embutido nos coeficientes originais, e é o que faz
   * inclinação neutra reproduzir exatamente o desenho anterior. Ele sai do
   * eixo de profundidade (0,70, −0,40): uma direção unitária do modelo com
   * 0,70 na horizontal da tela guarda √(1 − 0,70²) = 0,714 entrando na tela,
   * e o que se enxerga disso na vertical é 0,714 · sen(ELEV_0) = 0,40.
   *
   * Subir a elevação abre o plano do chão e achata a altura: é o que separa
   * pontos que, de planta, caem uns sobre os outros. Descer aproxima da
   * elevação frontal, onde o empilhamento vertical fica legível.
   *
   * A faixa foi medida sobre os 78 marcadores, e não arbitrada. Subindo até
   * 68° os pares de marcadores que se tocam caem de 11 para 7, e o desenho
   * ainda cabe no quadro. Descendo, quem limita é a grade de 37 pontos da
   * placa IPC, que é plana e horizontal: a menor distância entre marcadores
   * vai de 9,5 em ELEV_0 para 7,45 a 22° e 6,04 a 12°, com o símbolo medindo
   * cerca de 9. Por isso o piso fica em 22°, onde os marcadores ainda se
   * distinguem e nenhum outro subsistema piora. */
  var ELEV_0 = Math.asin(0.40 / Math.sqrt(1 - 0.70 * 0.70));
  var ELEV_MIN = 22 * Math.PI / 180;
  var ELEV_MAX = 68 * Math.PI / 180;
  var ELEV = ELEV_0;

  /* Duas rampas para a mesma folga, expostas na interface como "Cor" e "Tons
     de cinza". A divergente codifica o sinal da folga na matiz, e o cinza
     neutro do meio cai sobre a faixa de 0 a +10%, que e a banda de incerteza
     de RN-01: inconclusivo nao puxa para lado nenhum. A monocromatica codifica
     so a ordem, e existe porque azul-vermelho convida a ler azul como
     aprovado — leitura que RN-07 proibe. Quem precisa dessa garantia troca a
     paleta e perde a matiz, nao a informacao: forma do marcador, rotulo do
     estado e faixa numerica seguem iguais nas duas. */
  var RAMPA_A = ["#0d436b", "#3f7aa3", "#9dbdd2", "#d1d3d4", "#dd9a92", "#c04b3d", "#8f2419", "#5e120b"];
  var RAMPA_B = ["#eef0f1", "#cfd2d5", "#a6aaae", "#7c8189", "#5b616b", "#3e444d", "#262b32", "#12151a"];

  /* Campo térmico: rampa contínua de temperatura, na convenção de mapa
     meteorológico. Sai da paleta do guia de propósito — aqui a cor é
     temperatura, não estado de risco, e nenhuma parada significa aprovação. */
  var RAMPA_CAMPO = ["#3f1a6b", "#2b52c8", "#1f9fd8", "#35c4c0", "#8ecf5c", "#dcd247", "#e8912f", "#c8301f"];

  var FAIXAS = ["≥ +50%", "+30 a +50%", "+10 a +30%", "0 a +10%", "−10 a 0%", "−30 a −10%", "−50 a −30%", "< −50%"];

  /* Estado do enquadramento em uma peça. `t` vai de 0 (produto inteiro, em
     axonometria) a 1 (peça de frente, sem axonometria). A projeção interpola
     entre as duas bases, então a câmera parece aproximar e girar até encarar
     a peça — em vez de cortar para outro desenho. */
  var FOCO = { t: 0, plano: "planta" };

  function entre(a, b, t) { return a + (b - a) * t; }

  /* Contribuição de cada eixo do modelo para a tela. Na axonometria os três
     eixos contribuem; de frente, o eixo perpendicular à peça deixa de
     contribuir e é isso que achata o desenho.

     A inclinação entra como dois fatores sobre as componentes verticais: o
     plano do chão cresce com sen(ELEV) e o eixo vertical encolhe com
     cos(ELEV), ambos medidos contra ELEV_0. Em ELEV_0 os dois valem 1 e a
     base volta a ser a original. As componentes horizontais não mudam: o
     eixo vertical do modelo continua vertical na tela, que é o que mantém a
     leitura de altura direta em qualquer inclinação.

     O alvo do enquadramento em peça não é escalado: aproximar numa peça leva
     a uma vista de planta ou de elevação fixa, e é para lá que a
     interpolação precisa convergir, venha de onde vier a inclinação. */
  function base() {
    var t = FOCO.t;
    var plano = FOCO.plano === "elevacao";
    var chao = Math.sin(ELEV) / Math.sin(ELEV_0);
    var alto = Math.cos(ELEV) / Math.cos(ELEV_0);
    return {
      ax: [entre(S, 1, t), entre(S * 0.22 * chao, 0, t)],
      ay: [entre(S * 0.70, 0, t), entre(S * -0.40 * chao, plano ? 0 : 1, t)],
      az: [0, entre(S * -1 * alto, plano ? -1 : 0, t)]
    };
  }

  /* Volume que a cena pode ocupar, já contando o deslocamento do explodido: o
     mainback recua 90 em y, a barra de manípulos avança 52, e a tampa da IPC
     sobe até 464 em z. Serve só para enquadrar, não é desenhado. */
  var CENA = { x0: -18, x1: 338, y0: -64, y1: 336, z0: 0, z1: 464 };

  /* Centro vertical projetado da cena, na elevação dada.
     Inclinar para cima abre o plano do chão e empurraria o desenho para fora
     da base do quadro, que é fixo em 520×620. Comparar este centro com o
     mesmo centro em ELEV_0 dá a correção exata da origem, e em ELEV_0 a
     correção é zero, o que mantém o enquadramento original intacto. */
  function centroVertical(elev) {
    var guarda = ELEV, min = Infinity, max = -Infinity, i, j, k;
    ELEV = elev;
    var b = base();
    for (i = 0; i < 2; i++) for (j = 0; j < 2; j++) for (k = 0; k < 2; k++) {
      var r = girar(i ? CENA.x1 : CENA.x0, j ? CENA.y1 : CENA.y0);
      var v = b.ax[1] * r[0] + b.ay[1] * r[1] + b.az[1] * (k ? CENA.z1 : CENA.z0);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ELEV = guarda;
    return (min + max) / 2;
  }

  /* Direção que entra na tela: é o vetor que a projeção anula, ou seja, o
     núcleo da matriz 2×3 formada pelos três eixos projetados. Serve para
     ordenar por profundidade e para descartar as faces de trás.

     Era uma constante, (−0,7, 1, −0,554), válida só enquanto a base fosse
     fixa. Derivar da base corrente mantém as duas coisas corretas em
     qualquer inclinação: sem isso, inclinar a câmera manteria visíveis faces
     que passaram para trás e inverteria a ordem de pintura do campo térmico.
     Em ELEV_0 o cálculo devolve exatamente a direção da constante antiga.
     Normalizado, para que a margem de tolerância de `viradaParaFrente`
     signifique sempre o mesmo ângulo. */
  function olhar() {
    var b = base(), A = b.ax, B = b.ay, C = b.az;
    var v = [
      B[0] * C[1] - C[0] * B[1],
      C[0] * A[1] - A[0] * C[1],
      A[0] * B[1] - B[0] * A[1]
    ];
    var n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
  }

  function girar(x, y) {
    // O giro some junto com a axonometria: de frente, a peça fica alinhada.
    var yaw = YAW * (1 - FOCO.t);
    var c = Math.cos(yaw), s = Math.sin(yaw), dx = x - CX, dy = y - CY;
    return [dx * c - dy * s + CX, dx * s + dy * c + CY];
  }

  function p(x, y, z) {
    var r = girar(x, y), b = base();
    return [
      OX + b.ax[0] * r[0] + b.ay[0] * r[1] + b.az[0] * z,
      OY + b.ax[1] * r[0] + b.ay[1] * r[1] + b.az[1] * z
    ];
  }

  function poly(lista) {
    return lista.map(function (a) {
      return p(a[0], a[1], a[2]).map(function (n) { return n.toFixed(1); }).join(",");
    }).join(" ");
  }

  /* Profundidade de um ponto: valor maior está mais longe. Serve para as
     faces do envelope no campo térmico, que são coplanares por construção.

     Não serve para ordenar as peças entre si: o centroide de uma bobina na
     borda direita fica "mais perto" que o centro do cooktop que a cobre, e a
     bobina vazaria por cima. Peça usa a ordem de montagem, que é a ordem de
     empilhamento física — e essa é invariante ao giro em torno do vertical. */
  function fundura(x, y, z) {
    var r = girar(x, y), o = olhar();
    return o[0] * r[0] + o[1] * r[1] + o[2] * z;
  }

  /* Tons por peça: branco segue dominante e o azul do guia aparece só no
     vidro do cooktop, como acento. */
  var TONS = {
    cooktop: { topo: "#e9f1fa", frente: "#dee8f2", lado: "#d0deeb" },
    ipcBoard: { topo: "#e7eaec", frente: "#dde0e3", lado: "#d1d5d8" },
    knobBar: { topo: "#f0f1f2", frente: "#e7e9ec", lado: "#dbdee1" },
    hmiPanel: { topo: "#eef0f2", frente: "#e5e8eb", lado: "#d9dcdf" }
  };

  /* Três valores planos de face; a forma vem do valor, não de luz simulada. */
  function facesDaPeca(b, st) {
    var x = b[0], y = b[1], z = b[2], w = b[3], d = b[4], h = b[5];
    var tom = st.tom || {};
    var traco = st.hi ? "#00a0dd" : "#9fa0a1";
    var esp = st.hi ? 2 : 1;
    return [
      { pts: poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]]),
        fill: tom.lado || (st.dim ? "#e7e9eb" : "#dee0e3"), stroke: traco, sw: esp },
      { pts: poly([[x, y, z], [x + w, y, z], [x + w, y, z + h], [x, y, z + h]]),
        fill: tom.frente || (st.dim ? "#fafbfb" : "#f5f6f7"), stroke: traco, sw: esp },
      { pts: poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]),
        fill: tom.topo || "#ffffff", stroke: traco, sw: esp }
    ];
  }

  function pecas(op) {
    var nivel = op.nivel == null ? 4 : op.nivel;
    var ex = op.explode ? 1 : 0;
    var bx = op.placa === "right" ? 168 : 84;
    var aberto = op.alojamento && op.alojamento !== "closed";
    var E = function (v) { return v * ex; };

    var lista = [
      { id: "mainback", lvl: 2, b: [0, 236, 20, 320, 10, 296], dy: E(90) },
      { id: "ovenCavity", lvl: 2, b: [24, 26, 34, 272, 196, 190], dy: 0 },
      { id: "blower", lvl: 2, b: [30, 140, 4, 100, 60, 30], dz: E(-4) },
      { id: "duct", lvl: 2, b: [140, 156, 4, 44, 40, 26], dz: E(-4) },
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
      return { id: pc.id, b: b, present: nivel >= pc.lvl, hi: op.novo === pc.id };
    });
  }

  function acharPeca(lista, id) {
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i];
    return null;
  }

  // FL/FR/RL/RR são as quatro posições reais das bobinas no cooktop.
  var POSICOES = [["FL", 90, 70], ["FR", 232, 70], ["RL", 90, 168], ["RR", 232, 168]];

  function centrosDasBobinas(lista, op) {
    var cs = acharPeca(lista, "coilSupport");
    var z = cs.b[2] + cs.b[5] + (op.explode ? 30 : 3);
    return POSICOES.map(function (c) { return { k: c[0], x: c[1], y: c[2], z: z }; });
  }

  /* Posições dos 78 pontos por subsistema. Contagens da base:
     37 / 11 / 8 / 7 / 6 / 5 / 4. */
  function slotsPorArea(lista, op) {
    var s = {};
    var board = acharPeca(lista, "ipcBoard");
    var topoPlaca = board.b[2] + board.b[5];

    s["IPC Comp"] = [];
    for (var i = 0; i < 37; i++) {
      s["IPC Comp"].push([board.b[0] + 13 + (i % 7) * 19, board.b[1] + 13 + Math.floor(i / 7) * 17, topoPlaca]);
    }

    var mb = acharPeca(lista, "mainback");
    s["Mainback"] = [];
    for (var j = 0; j < 11; j++) {
      s["Mainback"].push([34 + (j % 4) * 78, mb.b[1] + mb.b[4], 70 + Math.floor(j / 4) * 88]);
    }

    var cs = acharPeca(lista, "coilSupport");
    s.bobinas = {}; s.placas = {};
    centrosDasBobinas(lista, op).forEach(function (c) {
      s.bobinas[c.k] = [c.x, c.y, c.z + 4];
      s.placas[c.k] = [c.x + 30, c.y + 26, cs.b[2] + cs.b[5] + 2];
    });

    var bl = acharPeca(lista, "blower");
    s["Main Vent Sys"] = [[52, 156, 26], [96, 150, 26], [66, 176, 10], [118, 168, 22], [82, 186, 14], [40, 162, 16], [120, 148, 26]]
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

  /* `Bobina FL` e `Suporte FL` casam pelo sufixo de posição, e não pela
     ordem em que chegam — a ordem do dado é por severidade, não geométrica. */
  function posicionarPontos(pontos, slots) {
    var fila = {}, saida = [];
    pontos.forEach(function (pt) {
      var g = null;
      if (pt.Key_Area === "Coil Temps") {
        var m = /\b(FL|FR|RL|RR)\s*$/.exec(pt.TC_Name);
        if (m) g = /^Coil\b/.test(pt.TC_Name) ? slots.bobinas[m[1]] : slots.placas[m[1]];
      }
      if (!g) {
        var disp = slots[pt.Key_Area];
        if (disp) {
          var k = fila[pt.Key_Area] || 0;
          g = disp[k % disp.length];
          fila[pt.Key_Area] = k + 1;
        }
      }
      if (g) saida.push({ ponto: pt, g: g });
    });
    return saida;
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
    var x = cx.toFixed(1), y = cy.toFixed(1);
    if (mono) return "M" + (cx - 4.2).toFixed(1) + " " + (cy - 4.2).toFixed(1) + " h8.4 v8.4 h-8.4 Z";
    if (estado === "acima_do_limite") return "M" + x + " " + (cy - 6).toFixed(1) + " L" + (cx + 5.4).toFixed(1) + " " + (cy + 3.6).toFixed(1) + " L" + (cx - 5.4).toFixed(1) + " " + (cy + 3.6).toFixed(1) + " Z";
    if (estado === "banda_de_incerteza") return "M" + x + " " + (cy - 5.6).toFixed(1) + " L" + (cx + 5.6).toFixed(1) + " " + y + " L" + x + " " + (cy + 5.6).toFixed(1) + " L" + (cx - 5.6).toFixed(1) + " " + y + " Z";
    return "M" + (cx - 4.4).toFixed(1) + " " + y + " a4.4 4.4 0 1 0 8.8 0 a4.4 4.4 0 1 0 -8.8 0";
  }

  /* ----- Campo térmico ----- */

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

     `k` comprime um eixo. Sem isso a face externa fica quase uniforme: os
     termopares estão dentro do produto — a PCB a ~45 abaixo do cooktop, o
     Mainback a ~245 da face frontal — e a distância atravessando a chapa
     domina a distância ao longo dela, então cada pixel acaba puxando o mesmo
     conjunto de pontos. Comprimir a direção normal à face faz o que está
     logo atrás de um pixel pesar mais do que o que está longe de lado, que é
     o comportamento de uma leitura de superfície. */
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

  /* Equaliza por quantil: a cor representa a posição do valor na
     distribuição, não a fração linear entre mínimo e máximo. A base é
     assimétrica — a mediana fica bem abaixo do máximo — e numa rampa linear três
     quartos dos pontos cairiam no primeiro quarto da escala. A legenda
     rotula os quartis em graus, para a cor seguir rastreável. */
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

  /* As seis faces do envelope: origem, eixo horizontal e vertical da imagem,
     e a normal que decide se a face está virada para o observador. */
  function facesDoEnvelope() {
    var X = CAIXA.x, Y = CAIXA.y, Z = CAIXA.z;
    return [
      { o: [0, 0, Z], u: [X, 0, 0], v: [0, Y, 0], n: [0, 0, 1] },
      { o: [0, 0, Z], u: [X, 0, 0], v: [0, 0, -Z], n: [0, -1, 0] },
      { o: [X, 0, Z], u: [0, Y, 0], v: [0, 0, -Z], n: [1, 0, 0] },
      { o: [X, Y, Z], u: [-X, 0, 0], v: [0, 0, -Z], n: [0, 1, 0] },
      { o: [0, Y, Z], u: [0, -Y, 0], v: [0, 0, -Z], n: [-1, 0, 0] },
      { o: [0, Y, 0], u: [X, 0, 0], v: [0, -Y, 0], n: [0, 0, -1] }
    ];
  }

  function viradaParaFrente(n) {
    var c = Math.cos(YAW), s = Math.sin(YAW), o = olhar();
    var nx = n[0] * c - n[1] * s, ny = n[0] * s + n[1] * c;
    return nx * o[0] + ny * o[1] + n[2] * o[2] < -0.02;
  }

  function campoTermico(pontos) {
    var amostras = pontos.map(function (pt) {
      return { x: pt.g[0], y: pt.g[1], z: pt.g[2], v: pt.ponto.temperatura_prevista_c };
    });
    if (!amostras.length) return null;

    var eq = equalizador(amostras.map(function (a) { return a.v; }));
    var saida = [];

    facesDoEnvelope().forEach(function (f) {
      if (!viradaParaFrente(f.n)) return;

      var largura = Math.max(24, Math.round(Math.hypot(f.u[0], f.u[1], f.u[2]) * 0.5));
      var altura = Math.max(24, Math.round(Math.hypot(f.v[0], f.v[1], f.v[2]) * 0.5));

      // Comprime a direção normal à face; ver o comentário de valorEm.
      /* 0,08 medido contra os termopares: o campo acompanha os termoparesbem melhor do que sem compressão. Abaixo disso o campo
         começa a virar bolhas isoladas em vez de campo contínuo. */
      var k = [f.n[0] ? 0.08 : 1, f.n[1] ? 0.08 : 1, f.n[2] ? 0.08 : 1];

      var cv = document.createElement("canvas");
      cv.width = largura; cv.height = altura;
      var ctx = cv.getContext("2d");
      var img = ctx.createImageData(largura, altura);

      for (var py = 0; py < altura; py++) {
        var tv = (py + 0.5) / altura;
        for (var px = 0; px < largura; px++) {
          var tu = (px + 0.5) / largura;
          var c = corDaRampa(RAMPA_CAMPO, eq.normalizar(valorEm(amostras,
            f.o[0] + f.u[0] * tu + f.v[0] * tv,
            f.o[1] + f.u[1] * tu + f.v[1] * tv,
            f.o[2] + f.u[2] * tu + f.v[2] * tv, k)));
          var o = (py * largura + px) * 4;
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);

      /* A projeção é afim, então a matriz leva o retângulo da imagem ao
         paralelogramo da face sem distorção, em qualquer ângulo. */
      var O = p(f.o[0], f.o[1], f.o[2]);
      var U = p(f.o[0] + f.u[0], f.o[1] + f.u[1], f.o[2] + f.u[2]);
      var V = p(f.o[0] + f.v[0], f.o[1] + f.v[1], f.o[2] + f.v[2]);

      saida.push({
        url: cv.toDataURL("image/png"), w: 100, h: 100,
        matriz: "matrix(" + ((U[0] - O[0]) / 100) + "," + ((U[1] - O[1]) / 100) + "," +
          ((V[0] - O[0]) / 100) + "," + ((V[1] - O[1]) / 100) + "," + O[0] + "," + O[1] + ")",
        fundura: fundura(f.o[0] + (f.u[0] + f.v[0]) / 2, f.o[1] + (f.u[1] + f.v[1]) / 2, f.o[2] + (f.u[2] + f.v[2]) / 2)
      });
    });

    var paradas = [0, 0.25, 0.5, 0.75, 1].map(function (f) { return eq.quantil(f); });
    return { faces: saida, min: paradas[0], max: paradas[4], paradas: paradas };
  }

  // Arestas e detalhes que fazem o volume ler como fogão por cima da cor.
  function envelope(põe) {
    facesDoEnvelope().forEach(function (f) {
      if (!viradaParaFrente(f.n)) return;
      põe(500, { t: "edge", pts: poly([
        f.o,
        [f.o[0] + f.u[0], f.o[1] + f.u[1], f.o[2] + f.u[2]],
        [f.o[0] + f.u[0] + f.v[0], f.o[1] + f.u[1] + f.v[1], f.o[2] + f.u[2] + f.v[2]],
        [f.o[0] + f.v[0], f.o[1] + f.v[1], f.o[2] + f.v[2]]
      ]) });
    });

    POSICOES.forEach(function (c) {
      var q = p(c[1], c[2], CAIXA.z);
      var rot = "rotate(9 " + q[0].toFixed(1) + " " + q[1].toFixed(1) + ")";
      põe(500, { t: "disc", cx: q[0], cy: q[1], rx: 34, ry: 15, fill: "none", stroke: "#1b1b1b", sw: 1.1, dash: "", rot: rot });
      põe(500, { t: "disc", cx: q[0], cy: q[1], rx: 22, ry: 9.7, fill: "none", stroke: "#1b1b1b", sw: 0.8, dash: "", rot: rot });
    });

    põe(500, { t: "edge", pts: poly([[16, 0, 196], [304, 0, 196], [304, 0, 238], [16, 0, 238]]) });
  }

  function calcular(op) {
    YAW = Math.max(-LIMITE_YAW, Math.min(LIMITE_YAW, op.yaw || 0));
    ELEV = Math.max(ELEV_MIN, Math.min(ELEV_MAX, op.elev == null ? ELEV_0 : op.elev));

    var meta = PECA_DA_AREA[op.foco];
    FOCO.t = meta ? Math.max(0, Math.min(1, op.t == null ? 1 : op.t)) : 0;
    FOCO.plano = meta ? meta.plano : "planta";
    var pecaEmFoco = meta ? meta.peca : null;

    // Depois de YAW, ELEV e FOCO: a correção é medida na projeção corrente.
    OY = OY_BASE + (centroVertical(ELEV_0) - centroVertical(ELEV));

    // Opacidade de tudo que pertence a uma peça que não é a que está em foco.
    function esmaece(idDaPeca) {
      return pecaEmFoco && idDaPeca !== pecaEmFoco ? 1 - FOCO.t : 1;
    }

    var modo = op.modo || "montagem";
    var nivel = op.nivel == null ? 4 : op.nivel;
    var campo = modo === "calor" && op.vista === "campo";
    var lista = pecas(op);
    var camadas = [], pts = [], info = null;

    // Camada menor desenha primeiro. `ordem` de peça vem da montagem.
    function põe(c, item) { item.c = c; camadas.push(item); }

    var ORDEM = {};
    lista.forEach(function (pc, i) { ORDEM[pc.id] = i; });

    // Piso plano sob o produto: assenta o volume sem sombra difusa.
    põe(-100, { t: "ground", pts: poly([[-18, -18, 0], [338, -18, 0], [338, 258, 0], [-18, 258, 0]]), o: pecaEmFoco ? 1 - FOCO.t : 1 });

    if (!campo) {
      if (!pecaEmFoco || FOCO.t < 0.5) põe(-99, { t: "ghost", pts: poly([[0, 0, 0], [320, 0, 0], [320, 240, 0], [0, 240, 0]]) });

      lista.forEach(function (pc) {
        if (!pc.present) {
          var f = facesDaPeca(pc.b, {});
          põe(ORDEM[pc.id], { t: "ghost", pts: f[2].pts });
          põe(ORDEM[pc.id], { t: "ghost", pts: f[1].pts });
          return;
        }
        var st = { hi: pc.hi, dim: modo === "calor", tom: modo === "calor" ? null : TONS[pc.id] };
        // Ao aproximar numa peça, as outras se apagam em vez de sumir de vez.
        var op2 = esmaece(pc.id);
        if (op2 < 0.03) return;
        facesDaPeca(pc.b, st).forEach(function (f) {
          põe(ORDEM[pc.id], { t: "face", pts: f.pts, fill: f.fill, stroke: f.stroke, sw: f.sw, novo: pc.hi, o: op2 });
        });
      });
    }

    var cs = acharPeca(lista, "coilSupport");
    var cooktop = acharPeca(lista, "cooktop");

    var oBobina = esmaece("coilSupport");
    if (cs.present && !campo && oBobina > 0.03) {
      var mat = op.material === "plastic" ? "#f5f6f7" : op.material === "plate" ? "#dee0e3" : "#ffffff";
      centrosDasBobinas(lista, op).forEach(function (c) {
        var q = p(c.x, c.y, c.z);
        var rot = "rotate(9 " + q[0].toFixed(1) + " " + q[1].toFixed(1) + ")";
        var d = ORDEM.coilSupport + 0.6;
        põe(d, { t: "disc", cx: q[0], cy: q[1], rx: 34, ry: 15, fill: "#ffffff", stroke: op.novo === "coils" ? "#00a0dd" : "#767777", sw: op.novo === "coils" ? 2 : 1, dash: "", rot: rot, o: oBobina });
        for (var r = 26; r > 8; r -= 8) {
          põe(d + 0.01, { t: "disc", cx: q[0], cy: q[1], rx: r, ry: r * 0.44, fill: "none", stroke: "#d1d3d4", sw: 1, dash: "", rot: rot, o: oBobina });
        }
        var zs = cs.b[2] + cs.b[5] + 1;
        var s2 = p(c.x, c.y, zs);
        põe(ORDEM.coilSupport + 0.4, {
          t: "disc", cx: s2[0], cy: s2[1], rx: 40, ry: 17.6, fill: mat,
          stroke: op.novo === "coilSupport" ? "#00a0dd" : "#9fa0a1",
          sw: op.novo === "coilSupport" ? 2 : 1,
          dash: op.material === "plastic" ? "4 3" : "", o: oBobina,
          rot: "rotate(9 " + s2[0].toFixed(1) + " " + s2[1].toFixed(1) + ")"
        });
      });
    }

    // Bocas na superfície: é o que se vê de um fogão fechado.
    if (cooktop.present && !op.explode && !campo && esmaece("cooktop") > 0.03) {
      var zt = cooktop.b[2] + cooktop.b[5];
      POSICOES.forEach(function (c) {
        var q = p(c[1], c[2], zt);
        var rot = "rotate(9 " + q[0].toFixed(1) + " " + q[1].toFixed(1) + ")";
        var d = ORDEM.cooktop + 0.5;
        põe(d, { t: "disc", cx: q[0], cy: q[1], rx: 34, ry: 15, fill: "none", stroke: "#8fa9c0", sw: 1.3, dash: "", rot: rot });
        põe(d, { t: "disc", cx: q[0], cy: q[1], rx: 22, ry: 9.7, fill: "none", stroke: "#b3c6d6", sw: 1, dash: "", rot: rot });
      });
    }

    var board = acharPeca(lista, "ipcBoard");
    if (board.present && modo === "montagem" && esmaece("ipcBoard") > 0.03) {
      var zb = board.b[2] + board.b[5];
      for (var i = 0; i < 16; i++) {
        var ax = board.b[0] + 16 + (i % 4) * 30, ay = board.b[1] + 18 + Math.floor(i / 4) * 24;
        var a3 = p(ax, ay, zb), b3 = p(ax + 14, ay + 12, zb);
        põe(ORDEM.ipcBoard + 0.5, { t: "line", x1: a3[0], y1: a3[1], x2: b3[0], y2: b3[1] });
      }
    }

    if (nivel >= 2 && modo === "montagem" && op.soprador) {
      var paFrente = op.soprador !== "back";
      for (var k = 0; k < 3; k++) {
        var x = 70 + k * 90;
        var a4 = p(x, paFrente ? 200 : 40, 60), b4 = p(x, paFrente ? -30 : 270, 60);
        põe(500, { t: "flow", d: "M" + a4[0].toFixed(1) + " " + a4[1].toFixed(1) + " L" + b4[0].toFixed(1) + " " + b4[1].toFixed(1) });
        var dx = b4[0] - a4[0], dy = b4[1] - a4[1], L = Math.hypot(dx, dy);
        var ux = dx / L, uy = dy / L, px2 = -uy, py2 = ux;
        põe(500, { t: "head", d: "M" + b4[0].toFixed(1) + " " + b4[1].toFixed(1) +
          " L" + (b4[0] - ux * 9 + px2 * 4).toFixed(1) + " " + (b4[1] - uy * 9 + py2 * 4).toFixed(1) +
          " L" + (b4[0] - ux * 9 - px2 * 4).toFixed(1) + " " + (b4[1] - uy * 9 - py2 * 4).toFixed(1) + " Z" });
      }
    }

    var colocados = null;
    if (modo === "calor" && op.pontos) {
      colocados = posicionarPontos(op.pontos, slotsPorArea(lista, op));

      if (campo) {
        /* Sem marcadores: a cor já carrega a leitura, e 78 símbolos por cima
           dela viram ruído. Ponto individual se consulta na aba Pontos. */
        var cp = campoTermico(colocados);
        if (cp) {
          cp.faces.sort(function (a, b) { return b.fundura - a.fundura; });
          cp.faces.forEach(function (face, i) {
            põe(i, { t: "field", url: face.url, w: face.w, h: face.h, matriz: face.matriz });
          });
          info = { min: cp.min, max: cp.max, paradas: cp.paradas };
        }
        envelope(põe);
      } else {
        var rampa = op.escala === "b" ? RAMPA_B : RAMPA_A;
        var iso = op.isolar || "todos";
        colocados.forEach(function (item, idx) {
          var pt = item.ponto;
          var q = p(item.g[0], item.g[1], item.g[2]);
          var mono = pt.is_monitor_only;
          var dentro = iso === "todos" || pt.Key_Area === iso;
          var noFoco = !op.foco || pt.Key_Area === op.foco;
          var opac = noFoco ? 1 : 1 - FOCO.t;

          /* Com a peça em foco, os pontos das outras áreas saem do desenho em
             vez de ficarem transparentes. Mantê-los invisíveis no DOM deixava
             fantasmas sempre que a transição parasse perto do fim. */
          if (opac < 0.02) return;

          pts.push({
            d: formaDoPonto(q[0], q[1], pt.estado, mono),
            fill: !dentro ? "#ffffff" : mono ? "#ffffff" : rampa[faixaDaRampa(pt.margem_percentual)],
            stroke: mono ? "#767777" : dentro ? "#484949" : "#dee0e3",
            sw: mono ? 1.2 : 0.8,
            dash: mono ? "2.5 2" : "",
            o: opac,
            cx: q[0], cy: q[1], ponto: pt, dentro: dentro && noFoco, i: idx
          });
        });
      }
    }

    camadas.sort(function (a, b) { return a.c - b.c; }); // de baixo para cima
    return {
      camadas: camadas, pts: pts, info: info, colocados: colocados || [],
      quadro: enquadrar(lista, op.foco, FOCO.t)
    };
  }

  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== "" && attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }

  var EMISSORES = {
    ground: function (i) { return el("polygon", { points: i.pts, fill: "#e8ebee", stroke: "none", opacity: i.o }); },
    ghost: function (i) { return el("polygon", { points: i.pts, fill: "none", stroke: "#dee0e3", "stroke-width": 1, "stroke-dasharray": "3 3", "stroke-linejoin": "round" }); },
    face: function (i) {
      var n = el("polygon", { points: i.pts, fill: i.fill, stroke: i.stroke, "stroke-width": i.sw, "stroke-linejoin": "round" });
      if (i.o != null && i.o < 1) n.setAttribute("opacity", i.o.toFixed(3));
      if (i.novo) n.setAttribute("class", "peca-nova");
      return n;
    },
    edge: function (i) { return el("polygon", { points: i.pts, fill: "none", stroke: "#1b1b1b", "stroke-width": 1.2, "stroke-linejoin": "round" }); },
    disc: function (i) { return el("ellipse", { cx: i.cx.toFixed(1), cy: i.cy.toFixed(1), rx: i.rx, ry: i.ry, fill: i.fill, stroke: i.stroke, "stroke-width": i.sw, "stroke-dasharray": i.dash, transform: i.rot, opacity: i.o }); },
    line: function (i) { return el("line", { x1: i.x1.toFixed(1), y1: i.y1.toFixed(1), x2: i.x2.toFixed(1), y2: i.y2.toFixed(1), stroke: "#9fa0a1", "stroke-width": 1 }); },
    flow: function (i) { return el("path", { d: i.d, fill: "none", stroke: "#00a0dd", "stroke-width": 1.5, "stroke-dasharray": "5 4", class: "fluxo" }); },
    head: function (i) { return el("path", { d: i.d, fill: "#00a0dd" }); },
    field: function (i) {
      var im = el("image", { x: 0, y: 0, width: i.w, height: i.h, transform: i.matriz, preserveAspectRatio: "none" });
      im.setAttributeNS("http://www.w3.org/1999/xlink", "href", i.url);
      im.setAttribute("href", i.url);
      return im;
    }
  };

  function desenhar(svg, op) {
    var v = calcular(op);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", (op.viewBox || v.quadro).toString().replace(/,/g, " "));

    var g = el("g", {});
    v.camadas.forEach(function (item) { g.appendChild(EMISSORES[item.t](item)); });
    svg.appendChild(g);

    var gp = el("g", { class: "pontos" });
    v.pts.forEach(function (pt) {
      var no = el("path", { d: pt.d, fill: pt.fill, stroke: pt.stroke, "stroke-width": pt.sw, "stroke-dasharray": pt.dash, class: "ponto" });
      if (pt.o != null && pt.o < 1) no.setAttribute("opacity", pt.o.toFixed(3));
      // Entrada escalonada: a tabela aparece de uma vez, o modelo se preenche.
      if (!op.semAnimacao) no.style.animationDelay = Math.min(pt.i * 6, 400) + "ms";
      gp.appendChild(no);
      pt.no = no;
    });
    svg.appendChild(gp);

    if (op.sel) {
      var gs = el("g", {});
      for (var i = 0; i < v.pts.length; i++) {
        if (v.pts[i].ponto.measurement_id === op.sel) {
          gs.appendChild(el("circle", { cx: v.pts[i].cx.toFixed(1), cy: v.pts[i].cy.toFixed(1), r: 11, fill: "none", stroke: "#0d436b", "stroke-width": 1.5, class: "anel" }));
          gs.appendChild(el("circle", { cx: v.pts[i].cx.toFixed(1), cy: v.pts[i].cy.toFixed(1), r: 15, fill: "none", stroke: "#0d436b", "stroke-width": 1, "stroke-opacity": 0.35, class: "anel anel--eco" }));
          break;
        }
      }
      svg.appendChild(gs);
    }

    return v;
  }

  var ENQUADRE_TOTAL = [0, 0, 520, 620];

  /* Peça em que cada subsistema mora, e o plano de onde ela se lê melhor.
     Serve para aproximar num componente sem perder a continuidade: o mesmo
     desenho gira e amplia até essa peça, em vez de virar outro desenho. */
  var PECA_DA_AREA = {
    "IPC Comp": { peca: "ipcBoard", plano: "planta", nome: "Placa de potência (IPC)" },
    "IPC Cooling": { peca: "ipcLid", plano: "planta", nome: "Tampa e dutos da IPC" },
    "Coil Temps": { peca: "coilSupport", plano: "planta", nome: "Bobinas e placas de alumínio" },
    "Main Vent Sys": { peca: "blower", plano: "planta", nome: "Ventilação principal" },
    "Mainback": { peca: "mainback", plano: "elevacao", nome: "Traseira do produto" },
    "CT Knobs": { peca: "knobBar", plano: "elevacao", nome: "Manípulos do cooktop" },
    "Oven HMI": { peca: "hmiPanel", plano: "elevacao", nome: "Interface do forno" }
  };

  /* Enquadramento no meio do caminho: interpola entre o produto inteiro e a
     caixa da peça, com a peça já medida na projeção corrente. */
  function enquadrar(lista, area, t) {
    var meta = PECA_DA_AREA[area];
    if (!meta || t <= 0) return ENQUADRE_TOTAL.slice();

    var pc = acharPeca(lista, meta.peca);
    var b = pc.b, xs = [], ys = [];
    [0, 1].forEach(function (i) {
      [0, 1].forEach(function (j) {
        [0, 1].forEach(function (k) {
          var q = p(b[0] + i * b[3], b[1] + j * b[4], b[2] + k * b[5]);
          xs.push(q[0]); ys.push(q[1]);
        });
      });
    });

    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var m = Math.max(26, Math.max(x1 - x0, y1 - y0) * 0.22);
    x0 -= m; x1 += m; y0 -= m; y1 += m;

    var razao = ENQUADRE_TOTAL[2] / ENQUADRE_TOTAL[3];
    var w = x1 - x0, h = y1 - y0;
    if (w / h > razao) h = w / razao; else w = h * razao;
    var alvo = [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h];

    return ENQUADRE_TOTAL.map(function (v, i) { return entre(v, alvo[i], t); });
  }

  /* Ponto mais próximo dentro de um raio, em coordenadas do viewBox. Um alvo
     de 9px com 78 marcadores se sobrepondo torna o clique frustrante. */
  function maisProximo(v, x, y, raio) {
    var achado = null, melhor = raio * raio;
    v.pts.forEach(function (pt) {
      if (!pt.dentro) return;
      var dx = pt.cx - x, dy = pt.cy - y, d2 = dx * dx + dy * dy;
      if (d2 <= melhor) { melhor = d2; achado = pt; }
    });
    return achado;
  }

  // Converte coordenada de tela para o sistema do viewBox.
  function noDesenho(svg, evento) {
    var pt = svg.createSVGPoint();
    pt.x = evento.clientX; pt.y = evento.clientY;
    var ctm = svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : null;
  }

  /* Arrastar para girar, na horizontal, e para inclinar, na vertical. Devolve
     os dois ângulos e avisa se houve arrasto, para o clique não ser
     confundido com o fim de uma rotação.

     Arrastar para baixo puxa o topo do produto na direção de quem olha, e
     por isso sobe a elevação: é a mesma metáfora de agarrar que o giro
     horizontal já usava. A sensibilidade vertical é um pouco menor que a
     horizontal porque o curso útil é menor. */
  function orbita(svg, aoGirar) {
    var yaw = 0, elev = ELEV_0;
    var arrastando = false, x0 = 0, y0 = 0, baseYaw = 0, baseElev = 0, andou = false;

    svg.addEventListener("pointerdown", function (e) {
      arrastando = true; andou = false;
      x0 = e.clientX; y0 = e.clientY;
      baseYaw = yaw; baseElev = elev;
      // A captura falha se o ponteiro ja foi liberado entre o evento e aqui.
      // Sem o guarda a excecao interrompia o resto do handler, e o cursor
      // ficava sem o estado de arrasto embora o arrasto funcionasse.
      try { svg.setPointerCapture(e.pointerId); } catch (erro) { /* segue sem captura */ }
      svg.classList.add("girando");
    });

    svg.addEventListener("pointermove", function (e) {
      if (!arrastando) return;
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) andou = true;
      yaw = Math.max(-LIMITE_YAW, Math.min(LIMITE_YAW, baseYaw + dx * 0.005));
      elev = Math.max(ELEV_MIN, Math.min(ELEV_MAX, baseElev + dy * 0.004));
      aoGirar(yaw, elev);
    });

    function soltar(e) {
      if (!arrastando) return;
      arrastando = false;
      svg.classList.remove("girando");
      if (e.pointerId != null && svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    }
    svg.addEventListener("pointerup", soltar);
    svg.addEventListener("pointercancel", soltar);

    return {
      valor: function () { return yaw; },
      elevacao: function () { return elev; },
      arrastou: function () { return andou; },
      zerar: function () { yaw = 0; elev = ELEV_0; aoGirar(0, ELEV_0); },
      girado: function () {
        return Math.abs(yaw) > 0.001 || Math.abs(elev - ELEV_0) > 0.001;
      }
    };
  }

  return {
    desenhar: desenhar,
    PECA_DA_AREA: PECA_DA_AREA,
    valorEm: valorEm,
    maisProximo: maisProximo,
    noDesenho: noDesenho,
    orbita: orbita,
    faixaDaRampa: faixaDaRampa,
    formaDoPonto: formaDoPonto,
    corDaRampa: corDaRampa,
    RAMPA_A: RAMPA_A,
    RAMPA_B: RAMPA_B,
    RAMPA_CAMPO: RAMPA_CAMPO,
    FAIXAS: FAIXAS
  };
})();
