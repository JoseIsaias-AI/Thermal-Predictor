/* Tela de marketing.
 *
 * Público que decide calendário de campanha sem ler dado de engenharia: o que
 * trava a decisão é saber quais temas técnicos já se sustentam e quais ainda
 * podem mudar antes da divulgação.
 *
 * A tela fala de temas, e não de frases de campanha prontas: a ferramenta não
 * autoriza promessa, e um texto publicitário redigido aqui seria lido como
 * autorização. Recorte e tradução vêm de js/leitura_publicos.js.
 */

(function () {
  "use strict";

  var LP = LEITURA_PUBLICOS;
  var PUBLICO = "marketing";

  /* Cada tema é um assunto que a campanha poderia tocar, amarrado aos
     subsistemas que sustentam a afirmação. Nenhum tema existe sem componente
     medido por trás: sem isso a tela viraria opinião. */
  var TEMAS = [
    {
      nome: "Segurança ao toque nos comandos",
      areas: ["CT Knobs"],
      significado: "Os manípulos que a pessoa gira durante o preparo."
    },
    {
      nome: "Painel e display do forno",
      areas: ["Oven HMI"],
      significado: "A face de comando do forno, onde a pessoa encosta para programar."
    },
    {
      nome: "Ventilação e saída de ar",
      areas: ["Main Vent Sys"],
      significado: "O caminho do ar quente até sair do produto."
    },
    {
      nome: "Eletrônica de potência",
      areas: ["IPC Comp", "IPC Cooling"],
      significado: "A placa que aciona as bobinas e o sistema que a resfria."
    },
    {
      nome: "Conjunto de indução",
      areas: ["Coil Temps"],
      significado: "As bobinas sob o vidro e as peças que as sustentam."
    },
    {
      nome: "Estrutura interna do produto",
      areas: ["Mainback"],
      significado: "Fiação, conectores e peças da traseira, fora do alcance da pessoa."
    }
  ];

  /* O que a leitura significa para quem planeja campanha, no lugar de um
     rótulo solto. */
  var CONSEQUENCIA = {
    acima_do_limite: "Não leve este tema para a campanha agora. A estimativa passa do limite e a configuração precisa mudar antes de qualquer promessa.",
    banda_de_incerteza: "Segure este tema. A estimativa ficou perto demais do limite para decidir, e a engenharia precisa confirmar antes de fechar texto.",
    dentro_do_limite: "O tema se sustenta nesta leitura. Ainda depende da validação formal, mas já dá para planejar a campanha contando com ele.",
    monitoramento: "Sem limite declarado para estes componentes, a ferramenta não tem o que responder sobre este tema."
  };

  var loading = document.getElementById("loading");
  var errorSection = document.getElementById("error");

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

  // Termo técnico que sobra na tela vai com a explicação junto, no próprio
  // elemento.
  function termo(texto, explicacao) {
    var n = el("abbr", "termo", texto);
    n.title = explicacao;
    return n;
  }

  function mostrarErro(mensagem) {
    loading.hidden = true;
    document.getElementById("error-message").textContent = mensagem;
    errorSection.hidden = false;
  }

  /* ----- Temas ----- */

  /* A leitura do tema é a pior entre os subsistemas que o sustentam: um tema
     não fica liberado porque a maioria dos seus componentes passou. */
  function lerTema(tema, porArea) {
    var pontos = [];
    tema.areas.forEach(function (area) {
      if (porArea[area]) pontos = pontos.concat(porArea[area]);
    });

    var avaliados = LP.ordenarPorRisco(pontos).filter(function (p) {
      return p.estado !== "monitoramento";
    });

    return {
      tema: tema,
      estado: LP.severidade(pontos),
      pior_ponto: avaliados.length ? avaliados[0] : null,
      pior_margem_c: avaliados.length ? avaliados[0].margem_c : null,
      total: pontos.length
    };
  }

  function cartaoDoTema(leitura) {
    var cartao = el("li", "card card--" + leitura.estado);

    cartao.appendChild(el("h3", "card__title", leitura.tema.nome));
    cartao.appendChild(el("span", "state state--" + leitura.estado,
      LP.traduzirEstado(leitura.estado, PUBLICO)));

    cartao.appendChild(el("p", "card__note", leitura.tema.significado));
    cartao.appendChild(el("p", "card__consequencia", CONSEQUENCIA[leitura.estado]));

    if (leitura.pior_ponto) {
      var rodape = el("p", "card__note card__note--acao");
      rodape.appendChild(document.createTextNode("Decidido por " + leitura.pior_ponto.TC_Name + ", a "));
      rodape.appendChild(document.createTextNode(grausC(leitura.pior_margem_c) + " °C "));
      rodape.appendChild(termo("do limite",
        "Temperatura máxima que o componente pode atingir, definida na especificação do produto. Valor negativo significa que a estimativa passou dela."));
      rodape.appendChild(document.createTextNode("."));
      cartao.appendChild(rodape);
    }

    return cartao;
  }

  function renderTemas(leituras) {
    var lista = document.getElementById("temas-cards");
    leituras.forEach(function (leitura) { lista.appendChild(cartaoDoTema(leitura)); });
    document.getElementById("temas-panel").hidden = false;
  }

  /* ----- Configuração consultada ----- */

  function renderConfiguracao(config, mat, veioDaUrl) {
    var lista = document.getElementById("config-list");

    LP.linhasDaConfiguracao(config).forEach(function (linha) {
      var bloco = el("div", "cfg-item");
      var dt = el("dt", null, linha[0]);
      dt.title = linha[0];
      bloco.appendChild(dt);
      bloco.appendChild(el("dd", null, linha[1]));
      lista.appendChild(bloco);
    });

    var selo = document.getElementById("config-origin");
    selo.textContent = mat.no_historico ? "já simulada" : "configuração nova";
    selo.title = mat.no_historico
      ? "Esta combinação já foi simulada antes, então a leitura se apoia em rodada existente."
      : "Nenhuma rodada anterior combina estas escolhas. A leitura é uma projeção, e tende a mudar mais que a de uma configuração já simulada.";
    selo.hidden = false;

    document.getElementById("config-default-note").hidden = veioDaUrl;
    document.getElementById("config-panel").hidden = false;
  }

  /* ----- Quando isso ainda pode mudar ----- */

  function itemDeMaturidade(lista, rotulo, valor, explicacao, glossario) {
    var bloco = el("div", "cfg-item");
    var dt = el("dt");

    // Termo técnico no rótulo leva a explicação junto, e não só no corpo.
    if (glossario) {
      dt.appendChild(document.createTextNode(rotulo.replace(glossario.palavra, "")));
      dt.appendChild(termo(glossario.palavra, glossario.explicacao));
    } else {
      dt.textContent = rotulo;
    }
    bloco.appendChild(dt);

    var dd = el("dd");
    dd.appendChild(document.createTextNode(valor));
    dd.appendChild(document.createElement("br"));
    dd.appendChild(el("span", "maturidade__nota", explicacao));
    bloco.appendChild(dd);

    lista.appendChild(bloco);
  }

  function renderMaturidade(mat) {
    var lista = document.getElementById("maturidade-lista");

    itemDeMaturidade(lista, "Base da leitura",
      mat.no_historico ? "Configuração já simulada" : "Configuração nova",
      mat.no_historico
        ? "A combinação consta das rodadas anteriores. Entre as leituras disponíveis, é a que menos tende a mudar."
        : "Nenhuma rodada anterior combina estas escolhas. Esta leitura tende a mudar mais quando a simulação rodar.");

    itemDeMaturidade(lista, "Versão do modelo", mat.versao_modelo || "—",
      "Identifica qual versão gerou os números. Se ela mudar, a leitura precisa ser refeita antes de sustentar peça.",
      { palavra: "modelo", explicacao: "Programa que aprendeu padrões nas simulações já feitas e, a partir deles, estima a temperatura de uma configuração nova sem precisar simular de novo." });

    itemDeMaturidade(lista, "Data-base do treino", mat.data_base_treino || "Não declarada",
      "Até quando vão os dados que treinaram o modelo. Mudança de material ou de fornecedor depois dessa data não está refletida aqui.");

    document.getElementById("maturidade-nota").textContent = mat.ilustrativo
      ? "Enquanto o painel exibir valores de demonstração, nenhuma leitura desta tela pode sustentar decisão de campanha."
      : "Confirme a leitura com a engenharia antes de fechar o calendário: a validação formal continua sendo o que autoriza a promessa.";

    document.getElementById("maturidade-panel").hidden = false;
  }

  /* ----- Registro ----- */

  var COLUNAS_DO_REGISTRO = [
    { titulo: "Tema", tipo: "texto", valor: function (l) { return l.tema.nome; } },
    { titulo: "Leitura", tipo: "texto", valor: function (l) { return LP.traduzirEstado(l.estado, PUBLICO); } },
    { titulo: "Componente que decide", tipo: "texto", valor: function (l) { return l.pior_ponto ? l.pior_ponto.TC_Name : ""; } },
    { titulo: "Margem até o limite (°C)", tipo: "numero", valor: function (l) { return l.pior_margem_c; } },
    { titulo: "O que fazer", tipo: "texto", valor: function (l) { return CONSEQUENCIA[l.estado]; } }
  ];

  function renderRegistro(leituras, mat, config) {
    var corpo = document.getElementById("registro-body");

    leituras.forEach(function (l) {
      var tr = document.createElement("tr");
      tr.className = "row--" + l.estado;

      tr.appendChild(celula(l.tema.nome));

      var estado = document.createElement("td");
      estado.appendChild(el("span", "state state--" + l.estado, LP.traduzirEstado(l.estado, PUBLICO)));
      tr.appendChild(estado);

      tr.appendChild(celula(l.pior_ponto ? l.pior_ponto.TC_Name : "—",
        l.pior_ponto ? null : "cell-muted"));

      var sinal = l.pior_margem_c < 0 ? " margin--negative" : " margin--positive";
      tr.appendChild(celula(grausC(l.pior_margem_c), "num" + sinal));

      corpo.appendChild(tr);
    });

    var botao = document.getElementById("export-registro");
    botao.addEventListener("click", function () {
      // A configuração consultada entra como coluna: sem ela o registro não
      // diz de que produto se falava.
      var fatores = LP.linhasDaConfiguracao(config).map(function (linha) {
        return { titulo: linha[0], tipo: "texto", valor: function () { return linha[1]; } };
      });

      PLANILHA.baixar("thermal-predictor-marketing.xlsx", PLANILHA.gerar({
        aba: "Marketing",
        colunas: COLUNAS_DO_REGISTRO.concat(fatores).concat(LP.colunasDeProcedencia(mat)),
        linhas: leituras
      }));
    });
    botao.disabled = false;

    document.getElementById("registro-panel").hidden = false;
  }

  /* ----- Montagem ----- */

  if (typeof DADOS_TRIAGEM === "undefined") {
    mostrarErro(
      "js/dados_triagem.js não foi carregado. Confira se o arquivo existe " +
      "em dashboard/js/ e se a tag <script> que o carrega vem antes desta."
    );
    return;
  }

  var dados = LP.fonte();
  var configDaUrl = LP.configuracaoDaUrl();
  var configAtiva = configDaUrl || dados.configuracao;
  var mat = LP.maturidade(dados, null, configAtiva);

  var porArea = {};
  LP.todosOsPontos(dados).forEach(function (p) {
    if (!porArea[p.Key_Area]) porArea[p.Key_Area] = [];
    porArea[p.Key_Area].push(p);
  });

  // Do que trava a campanha para o que já se sustenta: a primeira pergunta de
  // quem planeja é o que não dá.
  var leituras = TEMAS.map(function (tema) { return lerTema(tema, porArea); })
    .sort(function (a, b) {
      var d = LP.ORDEM_ESTADOS.indexOf(a.estado) - LP.ORDEM_ESTADOS.indexOf(b.estado);
      if (d !== 0) return d;
      return (a.pior_margem_c === null ? 1e9 : a.pior_margem_c) -
             (b.pior_margem_c === null ? 1e9 : b.pior_margem_c);
    });

  loading.hidden = true;

  document.getElementById("model-version").textContent = mat.versao_modelo || "—";
  renderConfiguracao(configAtiva, mat, configDaUrl !== null);
  renderTemas(leituras);
  renderMaturidade(mat);
  renderRegistro(leituras, mat, configAtiva);
})();
