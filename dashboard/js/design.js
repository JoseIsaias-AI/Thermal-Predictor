/* Tela de design.
 *
 * Público que decide acabamento e material sem manipular os fatores de
 * engenharia: o que trava a decisão é saber se a peça que a pessoa encosta
 * passa do limite e o que as escolhas do próprio design fizeram nas rodadas já
 * simuladas.
 *
 * Recorte e leitura vêm de js/leitura_publicos.js; aqui só há formatação e
 * montagem de DOM, como em js/triagem.js.
 */

(function () {
  "use strict";

  var LP = LEITURA_PUBLICOS;
  var PUBLICO = "design";

  // Peça do modelo 3D correspondente a cada subsistema de contato, para o
  // cartão acender a peça certa.
  var PECA_DA_AREA = { "CT Knobs": "knobBar", "Oven HMI": "hmiPanel" };

  var NOME_DA_AREA = {
    "CT Knobs": "Manípulos",
    "Oven HMI": "Console do forno"
  };

  var DESCRICAO_DA_AREA = {
    "CT Knobs": "Botões de comando do cooktop, em contato direto com a mão.",
    "Oven HMI": "Painel e display do forno, na frente do produto."
  };

  var loading = document.getElementById("loading");
  var errorSection = document.getElementById("error");
  var modelo = null;
  var areaAcesa = null;
  var opcoesDoModelo = {};

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function celula(texto, classe) {
    var td = document.createElement("td");
    td.textContent = texto;
    if (classe) td.className = classe;
    return td;
  }

  function grausC(valor) {
    return valor === null || valor === undefined ? "—" : valor.toFixed(1);
  }

  function mostrarErro(mensagem) {
    loading.hidden = true;
    document.getElementById("error-message").textContent = mensagem;
    errorSection.hidden = false;
  }

  function marcaDeEstado(estado) {
    return el("span", "state state--" + estado, LP.traduzirEstado(estado, PUBLICO));
  }

  /* ----- Configuração avaliada ----- */

  function renderConfiguracao(config, veioDaUrl) {
    var lista = document.getElementById("config-list");

    LP.linhasDaConfiguracao(config).forEach(function (linha) {
      var bloco = el("div", "cfg-item");
      var dt = el("dt", null, linha[0]);
      dt.title = linha[0];
      bloco.appendChild(dt);
      bloco.appendChild(el("dd", null, linha[1]));
      lista.appendChild(bloco);
    });

    document.getElementById("config-default-note").hidden = veioDaUrl;
    document.getElementById("config-panel").hidden = false;
  }

  /* ----- Peças que a pessoa toca ----- */

  /* `atualizar` substitui as opções inteiras a cada chamada, então a tela
     guarda a montagem e reenvia tudo junto do realce. Mandar só a peça acesa
     desmontaria o fogão. */
  function desenharModelo(extra) {
    if (!modelo) return;
    var opcoes = {};

    Object.keys(opcoesDoModelo).forEach(function (k) { opcoes[k] = opcoesDoModelo[k]; });
    Object.keys(extra || {}).forEach(function (k) { opcoes[k] = extra[k]; });

    modelo.atualizar(opcoes);
  }

  function acender(area) {
    areaAcesa = areaAcesa === area ? null : area;

    Array.prototype.forEach.call(document.querySelectorAll("#contato-cards .card"), function (cartao) {
      cartao.setAttribute("aria-pressed", String(cartao.dataset.area === areaAcesa));
    });

    desenharModelo({ zonaSel: areaAcesa ? PECA_DA_AREA[areaAcesa] : null });
  }

  function cartaoDaPeca(area, pontos) {
    var avaliados = pontos.filter(function (p) { return p.estado !== "monitoramento"; });
    var estado = LP.severidade(pontos);
    var pior = avaliados.length ? avaliados[0] : null;

    var cartao = el("li", "card card--" + estado + " card--acionavel");
    cartao.dataset.area = area;
    cartao.setAttribute("role", "button");
    cartao.setAttribute("tabindex", "0");
    cartao.setAttribute("aria-pressed", "false");

    cartao.appendChild(el("h3", "card__title", NOME_DA_AREA[area] || area));
    cartao.appendChild(marcaDeEstado(estado));

    if (pior) {
      var metrica = el("p", "card__metric" + (pior.margem_c < 0 ? " card__metric--negative" : ""),
        grausC(pior.margem_c) + " °C");
      cartao.appendChild(metrica);
      cartao.appendChild(el("p", "card__note",
        "de folga no ponto mais quente da peça, " + pior.TC_Name + "."));
    }

    cartao.appendChild(el("p", "card__note", DESCRICAO_DA_AREA[area] || ""));
    cartao.appendChild(el("p", "card__note card__note--acao",
      avaliados.length + (avaliados.length === 1 ? " ponto medido" : " pontos medidos") +
      " · clique para ver a peça no modelo"));

    cartao.addEventListener("click", function () { acender(area); });
    cartao.addEventListener("keydown", function (evento) {
      if (evento.key !== "Enter" && evento.key !== " ") return;
      evento.preventDefault();
      acender(area);
    });

    return cartao;
  }

  function renderContato(pecas) {
    var lista = document.getElementById("contato-cards");
    var porArea = {};
    var ordem = [];

    pecas.forEach(function (p) {
      if (!porArea[p.Key_Area]) { porArea[p.Key_Area] = []; ordem.push(p.Key_Area); }
      porArea[p.Key_Area].push(p);
    });

    ordem.forEach(function (area) {
      lista.appendChild(cartaoDaPeca(area, porArea[area]));
    });

    document.getElementById("contato-count").textContent = pecas.length;
    document.getElementById("contato-panel").hidden = false;
  }

  /* ----- O que está na sua mão ----- */

  function rotuloDoFator(chave) {
    var achado = null;
    SCHEMA.factors.forEach(function (f) { if (f.key === chave) achado = f; });
    return achado;
  }

  // Mesma pior folga em todos os níveis, na casa decimal que a tela exibe.
  function naoSepara(niveis) {
    var comLeitura = niveis.filter(function (n) { return n.pior_margem_c !== null; });
    if (comLeitura.length < 2) return false;

    return comLeitura.every(function (n) {
      return Math.abs(n.pior_margem_c - comLeitura[0].pior_margem_c) < 0.05;
    });
  }

  function blocoDoFator(chave, niveis, nivelAtual) {
    var fator = rotuloDoFator(chave);
    var bloco = el("section", "fator");

    bloco.appendChild(el("h3", "fator__titulo", fator ? fator.label : chave));

    var lista = el("ul", "cards cards--densa");
    niveis.forEach(function (nivel) {
      /* Sem a cor de estado: aqui o estado é o pior caso já visto com esta
         opção, e não o resultado da configuração consultada. Pintar a opção
         em vigor de vermelho diria que ela reprovou, o que não é o caso. */
      var cartao = el("li", "card card--opcao");
      var atual = nivel.nivel === nivelAtual;
      if (atual) cartao.className += " card--atual";

      cartao.appendChild(el("h4", "card__title",
        fator ? LP.rotuloDoNivel(fator.levels, nivel.nivel) : nivel.nivel));

      /* O selo sai do desenho mas guarda o lugar: sem isso os cartões com e
         sem selo põem o número em alturas diferentes, e a comparação entre as
         opções, que é o que a seção existe para fazer, fica torta. */
      var selo = el("span", "config__tag", "escolha atual");
      if (!atual) {
        selo.className += " config__tag--reservado";
        selo.setAttribute("aria-hidden", "true");
      }
      cartao.appendChild(selo);

      if (nivel.pior_margem_c !== null) {
        cartao.appendChild(el("p", "card__metric" + (nivel.pior_margem_c < 0 ? " card__metric--negative" : ""),
          grausC(nivel.pior_margem_c) + " °C"));
        cartao.appendChild(el("p", "card__note",
          "menor folga já vista nas peças de contato com esta opção, em " +
          nivel.pior_ponto.nome + "."));
      }

      cartao.appendChild(el("p", "card__note",
        nivel.configuracoes + (nivel.configuracoes === 1 ? " configuração" : " configurações") +
        " na base · " + nivel.criticas + " com peça de contato acima do limite"));

      lista.appendChild(cartao);
    });

    bloco.appendChild(lista);

    /* Quando todas as opções terminam na mesma folga, o cartão repetido parece
       defeito. A resposta que interessa é justamente essa: aqui a escolha não
       mexe no que a pessoa toca. */
    if (naoSepara(niveis)) {
      bloco.appendChild(el("p", "panel__note",
        "Nas rodadas já simuladas, esta escolha não separou as peças de contato: " +
        "a menor folga é a mesma em todas as opções. O que muda entre elas aparece " +
        "em outras partes do produto."));
    }

    return bloco;
  }

  function renderFatores(catalogo, config) {
    var destino = document.getElementById("fatores-blocos");

    LP.FATORES_DE_DESIGN.forEach(function (chave) {
      destino.appendChild(blocoDoFator(chave, LP.efeitoDoFator(catalogo, chave), config[chave]));
    });

    document.getElementById("fatores-panel").hidden = false;
  }

  /* ----- Alternativas ----- */

  function renderAlternativas(alternativas) {
    var corpo = document.getElementById("alternativas-body");
    var defletor = rotuloDoFator("deflector_hole");
    var material = rotuloDoFator("material_coil_support");

    alternativas.forEach(function (a) {
      var tr = document.createElement("tr");
      tr.className = "row--" + a.contato.estado;

      var primeira = celula(LP.rotuloDoNivel(defletor && defletor.levels, a.fatores.deflector_hole));
      if (a.igual_a_consulta) {
        primeira.appendChild(el("span", "point__area", "escolha atual"));
      }
      tr.appendChild(primeira);

      tr.appendChild(celula(LP.rotuloDoNivel(material && material.levels, a.fatores.material_coil_support)));

      var estado = document.createElement("td");
      estado.appendChild(marcaDeEstado(a.contato.estado));
      tr.appendChild(estado);

      tr.appendChild(celula(a.contato.pior_ponto ? a.contato.pior_ponto.nome : "—"));

      var sinal = a.contato.pior_margem_c < 0 ? " margin--negative" : " margin--positive";
      tr.appendChild(celula(grausC(a.contato.pior_margem_c), "num" + sinal));
      tr.appendChild(celula(a.rodadas, "num"));

      corpo.appendChild(tr);
    });

    document.getElementById("alternativas-vazio").hidden = alternativas.length > 0;
    document.getElementById("alternativas-panel").hidden = false;
  }

  /* ----- Modelo 3D, em leitura ----- */

  function criarModelo(config) {
    var palco = document.getElementById("design-3d");
    var presets = document.getElementById("view-preset");

    modelo = FOGAO3D.criar(palco, {
      aoMudarCamera: function (atual) {
        Array.prototype.forEach.call(presets.querySelectorAll("button"), function (b) {
          b.setAttribute("aria-pressed", String(b.dataset.preset === atual));
        });
      },
      // Clicar na peça no modelo acende o mesmo cartão: os dois lados da tela
      // respondem ao mesmo gesto.
      aoClicarPeca: function (alvo) {
        if (alvo && alvo.zona && PECA_DA_AREA[alvo.zona.area]) acender(alvo.zona.area);
      }
    });

    // Montado como a configuração pede, sem explosão: aqui a pergunta é como a
    // peça fica, não onde ela mora por dentro.
    opcoesDoModelo = {
      nivel: 4,
      modo: "montagem",
      explode: 0,
      defletor: config.deflector_hole === "Open" ? "open" : "closed",
      placa: config.board_position === "Right" ? "right" : "center",
      soprador: config.blower_direction === "To Back" ? "back" : config.blower_direction ? "front" : null,
      alojamento: config.housing && config.housing !== "Closed" ? "open" : "closed",
      material: config.material_coil_support === "Plastic" ? "plastic"
        : config.material_coil_support === "Aluminium Plate" ? "plate" : "aluminium"
    };
    desenharModelo();

    presets.addEventListener("click", function (evento) {
      var botao = evento.target.closest("button");
      if (botao) modelo.preset(botao.dataset.preset);
    });
  }

  /* ----- Montagem ----- */

  if (typeof DADOS_TRIAGEM === "undefined" || typeof DADOS_COMPARACAO === "undefined") {
    mostrarErro(
      "js/dados_triagem.js ou js/dados_comparacao.js não foi carregado. Confira " +
      "se os arquivos existem em dashboard/js/ e se as tags <script> que os " +
      "carregam vêm antes desta."
    );
    return;
  }

  var dados = LP.fonte();
  var configDaUrl = LP.configuracaoDaUrl();
  var configAtiva = configDaUrl || dados.configuracao;
  var pecas = LP.pecasDeContato(LP.todosOsPontos(dados));

  loading.hidden = true;

  document.getElementById("model-version").textContent = dados.versao_modelo || "—";
  renderConfiguracao(configAtiva, configDaUrl !== null);
  renderContato(pecas);
  renderFatores(DADOS_COMPARACAO, configAtiva);
  renderAlternativas(LP.alternativasDeDesign(DADOS_COMPARACAO, configAtiva));
  criarModelo(configAtiva);
})();
