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

  // Na tela, pt-BR: vírgula decimal e sinal de menos tipográfico.
  function grausC(valor) {
    if (valor === null || valor === undefined) return "—";
    var t = valor.toFixed(1);
    if (Number(t) === 0) t = t.replace("-", "");
    return t.replace(".", ",").replace("-", "−");
  }

  // Número grande com a unidade menor e mais leve ao lado.
  function metrica(valor, classe) {
    var p = el("p", classe);
    p.appendChild(document.createTextNode(grausC(valor)));
    p.appendChild(el("span", "card__unit", "°C"));
    return p;
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

    // O que é a peça vai no balão do título (e para leitor de tela), e não
    // numa terceira linha de texto no cartão.
    var titulo = el("h3", "card__title", NOME_DA_AREA[area] || area);
    if (DESCRICAO_DA_AREA[area]) {
      titulo.title = DESCRICAO_DA_AREA[area];
      titulo.appendChild(el("span", "sr-only", " — " + DESCRICAO_DA_AREA[area]));
    }
    cartao.appendChild(titulo);
    cartao.appendChild(marcaDeEstado(estado));

    if (pior) {
      cartao.appendChild(metrica(pior.margem_c,
        "card__metric" + (pior.margem_c < 0 ? " card__metric--negative" : "")));
      cartao.appendChild(el("p", "card__note",
        "de folga no ponto mais quente da peça, " + pior.TC_Name + "."));
    }

    // A instrução de clique fica uma vez só, acima dos cartões (design.html).
    cartao.appendChild(el("p", "card__note card__note--acao",
      avaliados.length + (avaliados.length === 1 ? " ponto medido" : " pontos medidos")));

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

    renderTitulo(ordem.map(function (area) {
      return { nome: NOME_DA_AREA[area] || area, estado: LP.severidade(porArea[area]) };
    }));

    document.getElementById("contato-count").textContent = pecas.length;
    document.getElementById("contato-panel").hidden = false;
  }

  /* Título da tela como conclusão: o estado das peças de contato, pela mesma
     severidade dos cartões. */
  function renderTitulo(pecas) {
    function nomes(estado) {
      return pecas.filter(function (p) { return p.estado === estado; })
        .map(function (p) { return p.nome.toLowerCase(); });
    }
    function lista(itens) {
      return itens.length > 1 ? itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1] : itens[0];
    }
    function inicial(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

    var acima = nomes("acima_do_limite");
    var banda = nomes("banda_de_incerteza");
    var texto;
    if (acima.length) {
      texto = acima.length + " de " + pecas.length + (acima.length === 1 ? " peça de contato acima do limite" : " peças de contato acima do limite");
    } else if (banda.length) {
      texto = "Nenhuma peça de contato acima do limite; " + lista(banda) + " a verificar";
    } else {
      texto = inicial(lista(pecas.map(function (p) { return p.nome.toLowerCase(); }))) + " viáveis nesta triagem";
    }
    document.getElementById("page-title").textContent = texto;
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

  /* Opções de um fator como barras horizontais, e não como cartões: a leitura
     é uma comparação, e comprimento a partir do mesmo zero compara melhor que
     números soltos em caixas. Pior folga primeiro; a escala é a mesma para os
     dois fatores, para as barras de um se lerem contra as do outro. */
  function blocoDoFator(chave, niveis, nivelAtual, escala) {
    var fator = rotuloDoFator(chave);
    var bloco = el("section", "fator");

    bloco.appendChild(el("h3", "fator__titulo", fator ? fator.label : chave));

    /* Quando todas as opções terminam na mesma folga, a resposta que interessa
       é justamente essa: aqui a escolha não mexe no que a pessoa toca. Vira a
       conclusão do fator, logo abaixo do nome. */
    if (naoSepara(niveis)) {
      bloco.appendChild(el("p", "fator__conclusao",
        "Nas rodadas já simuladas, esta escolha não separou as peças de contato: " +
        "a menor folga é a mesma em todas as opções. O que muda entre elas aparece " +
        "em outras partes do produto."));
    }

    function pos(v) { return (v - escala.lo) / (escala.hi - escala.lo) * 100; }
    // Percentual da largura útil do trilho, sem o respiro da coluna (1rem).
    function x(p) { return "calc((100% - 1rem) * " + (p / 100).toFixed(4) + ")"; }
    var zero = pos(0);

    var lista = el("ul", "opcoes");
    lista.setAttribute("aria-label", (fator ? fator.label : chave) + ": menor folga já vista nas peças de contato, por opção");

    var cab = el("li", "opcoes__cab");
    cab.setAttribute("aria-hidden", "true");
    cab.appendChild(el("span", null, "Opção"));
    cab.appendChild(el("span", null, "Menor folga já vista nas peças de contato"));
    cab.appendChild(el("span", null, "°C"));
    lista.appendChild(cab);

    var ordenados = niveis.slice().sort(function (a, b) {
      if (a.pior_margem_c === null) return 1;
      if (b.pior_margem_c === null) return -1;
      return a.pior_margem_c - b.pior_margem_c;
    });

    ordenados.forEach(function (nivel) {
      /* Sem a cor de estado na barra: aqui o estado é o pior caso já visto com
         esta opção, e não o resultado da configuração consultada. Pintar a
         opção em vigor de vermelho diria que ela reprovou, o que não é o caso. */
      var atual = nivel.nivel === nivelAtual;
      var linha = el("li", "opcao" + (atual ? " opcao--atual" : ""));

      var nome = el("span", "opcao__nome", fator ? LP.rotuloDoNivel(fator.levels, nivel.nivel) : nivel.nivel);
      if (atual) nome.appendChild(el("span", "config__tag", "escolha atual"));
      var partes = [];
      if (nivel.pior_ponto) partes.push("em " + nivel.pior_ponto.nome);
      partes.push(nivel.configuracoes + (nivel.configuracoes === 1 ? " configuração" : " configurações") +
        " na base · " + nivel.criticas + " com peça de contato acima do limite");
      nome.appendChild(el("span", "opcao__nota", partes.join(" · ")));
      linha.appendChild(nome);

      var trilho = el("span", "opcao__trilho");
      trilho.setAttribute("aria-hidden", "true");
      if (nivel.pior_margem_c !== null) {
        var v = pos(nivel.pior_margem_c);
        var barra = el("span", "opcao__barra" + (nivel.pior_margem_c < 0 ? " opcao__barra--negativa" : ""));
        barra.style.left = x(Math.min(v, zero));
        barra.style.width = x(Math.max(0.6, Math.abs(v - zero)));
        trilho.appendChild(barra);
      }
      var z = el("span", "opcao__zero");
      z.style.left = x(zero);
      trilho.appendChild(z);
      linha.appendChild(trilho);

      linha.appendChild(el("span", "opcao__valor" + (nivel.pior_margem_c < 0 ? " opcao__valor--negativo" : ""),
        grausC(nivel.pior_margem_c)));

      lista.appendChild(linha);
    });

    // Eixo: só o zero, que é o limite, e as pontas da escala.
    var eixo = el("li", "opcoes__eixo");
    eixo.setAttribute("aria-hidden", "true");
    eixo.appendChild(el("span"));
    var trilhoEixo = el("span", "opcao__trilho");
    [[escala.lo, grausC(escala.lo)], [0, "0 · limite"], [escala.hi, grausC(escala.hi)]].forEach(function (m) {
      if (m[0] !== 0 && Math.abs(pos(m[0]) - zero) < 12) return;
      var r = el("span", "opcoes__eixo-rotulo", m[1]);
      r.style.left = x(pos(m[0]));
      if (m[0] === escala.lo) r.style.transform = "none";
      if (m[0] === escala.hi) r.style.transform = "translateX(-100%)";
      trilhoEixo.appendChild(r);
    });
    eixo.appendChild(trilhoEixo);
    eixo.appendChild(el("span"));
    lista.appendChild(eixo);

    bloco.appendChild(lista);
    return bloco;
  }

  function renderFatores(catalogo, config) {
    var destino = document.getElementById("fatores-blocos");

    var efeitos = LP.FATORES_DE_DESIGN.map(function (chave) {
      return { chave: chave, niveis: LP.efeitoDoFator(catalogo, chave) };
    });

    // Escala comum aos fatores, sempre com o zero dentro e uma folga nas pontas.
    var lo = 0, hi = 0;
    efeitos.forEach(function (e) {
      e.niveis.forEach(function (n) {
        if (n.pior_margem_c === null) return;
        lo = Math.min(lo, n.pior_margem_c);
        hi = Math.max(hi, n.pior_margem_c);
      });
    });
    var folga = Math.max(1, (hi - lo) * 0.08);
    var escala = { lo: lo < 0 ? lo - folga : 0, hi: hi > 0 ? hi + folga : folga };

    efeitos.forEach(function (e) {
      destino.appendChild(blocoDoFator(e.chave, e.niveis, config[e.chave], escala));
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
      caso: config.run_case,
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
