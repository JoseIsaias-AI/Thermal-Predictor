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

  // Temas e consequências moram em js/leitura_publicos.js: o registro em PDF
  // da sessão lê os mesmos.
  var CONSEQUENCIA = LP.CONSEQUENCIA_MARKETING;

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

  // Na tela, pt-BR: vírgula decimal e sinal de menos tipográfico.
  function grausC(valor) {
    if (valor === null || valor === undefined) return "—";
    var t = valor.toFixed(1);
    if (Number(t) === 0) t = t.replace("-", "");
    return t.replace(".", ",").replace("-", "−");
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

  /* O cartão diz o tema, a leitura e quem a decide. O que o tema abrange vai
     no balão do título; o que fazer com a leitura é o mesmo para todo cartão
     com o mesmo estado, e por isso fica uma vez só, na legenda abaixo. */
  function cartaoDoTema(leitura) {
    var cartao = el("li", "card card--" + leitura.estado);

    var titulo = el("h3", "card__title", leitura.tema.nome);
    if (leitura.tema.significado) {
      titulo.title = leitura.tema.significado;
      titulo.appendChild(el("span", "sr-only", " — " + leitura.tema.significado));
    }
    cartao.appendChild(titulo);
    cartao.appendChild(el("span", "state state--" + leitura.estado,
      LP.traduzirEstado(leitura.estado, PUBLICO)));

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

    // Uma linha por estado presente, na ordem em que os cartões aparecem.
    var legenda = document.getElementById("temas-legenda-lista");
    var vistos = [];
    leituras.forEach(function (l) {
      if (vistos.indexOf(l.estado) >= 0) return;
      vistos.push(l.estado);
      var dt = el("dt");
      dt.appendChild(el("span", "state state--" + l.estado, LP.traduzirEstado(l.estado, PUBLICO)));
      legenda.appendChild(dt);
      legenda.appendChild(el("dd", null, CONSEQUENCIA[l.estado]));
    });
    document.getElementById("temas-legenda").hidden = vistos.length === 0;

    document.getElementById("temas-panel").hidden = false;
  }

  /* Título da tela como conclusão: quantos temas já podem entrar no
     planejamento, contados das mesmas leituras dos cartões. */
  function renderTitulo(leituras) {
    var total = leituras.length;
    var podem = leituras.filter(function (l) { return l.estado === "dentro_do_limite"; }).length;
    var aguardam = leituras.filter(function (l) { return l.estado === "banda_de_incerteza"; }).length;
    var texto;
    if (podem) {
      texto = podem + " de " + total + (podem === 1 ? " tema pode entrar no planejamento de campanha" : " temas podem entrar no planejamento de campanha");
    } else if (aguardam) {
      texto = "Nenhum tema pronto para planejar; " + aguardam + " aguardam verificação";
    } else {
      texto = "Nenhum dos " + total + " temas dá para comunicar agora";
    }
    document.getElementById("page-title").textContent = texto;
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

    // Sem o catálogo das rodadas não há como dizer se a combinação é nova: sem selo.
    var selo = document.getElementById("config-origin");
    selo.textContent = mat.no_historico ? "já simulada" : "configuração nova";
    selo.title = mat.no_historico
      ? "Esta combinação já foi simulada antes, então a leitura se apoia em rodada existente."
      : "Nenhuma rodada anterior combina estas escolhas. A leitura é uma projeção, e tende a mudar mais que a de uma configuração já simulada.";
    selo.hidden = mat.no_historico === null;

    document.getElementById("config-default-note").hidden = veioDaUrl;
    document.getElementById("config-panel").hidden = false;
  }

  /* ----- Quando isso ainda pode mudar ----- */

  /* O item mostra rótulo e valor; o porquê de cada um vai para o bloco
     expansível logo abaixo, na mesma ordem. */
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

    bloco.appendChild(el("dd", null, valor));
    lista.appendChild(bloco);

    var porque = el("p");
    porque.appendChild(el("strong", null, rotulo + ". "));
    porque.appendChild(document.createTextNode(explicacao));
    document.getElementById("maturidade-explica").appendChild(porque);
  }

  function renderMaturidade(mat) {
    var lista = document.getElementById("maturidade-lista");

    itemDeMaturidade(lista, "Base da leitura",
      mat.no_historico === null ? "Histórico indisponível"
        : mat.no_historico ? "Configuração já simulada" : "Configuração nova",
      mat.no_historico === null
        ? "O serviço de predição não publicou o catálogo das rodadas anteriores, e sem ele não há como dizer se esta combinação já foi simulada."
        : mat.no_historico
        ? "A combinação consta das rodadas anteriores. Entre as leituras disponíveis, é a que menos tende a mudar."
        : "Nenhuma rodada anterior combina estas escolhas. Esta leitura tende a mudar mais quando o cálculo detalhado da engenharia rodar.");

    itemDeMaturidade(lista, "Versão do modelo", mat.versao_modelo || "—",
      "Identifica qual versão gerou os números. Se ela mudar, a leitura precisa ser refeita antes de sustentar peça.",
      { palavra: "modelo", explicacao: "Programa que aprendeu padrões nas simulações já feitas e, a partir deles, estima a temperatura de uma configuração nova sem precisar simular de novo." });

    itemDeMaturidade(lista, "Data-base do treino", mat.data_base_treino || "Não declarada",
      "Até quando vão os dados que ensinaram o modelo. Mudança de material ou de fornecedor depois dessa data não está refletida aqui.",
      { palavra: "treino", explicacao: LP.GLOSSARIO.treino });

    document.getElementById("maturidade-nota").textContent =
      "Confirme a leitura com a engenharia antes de fechar o calendário: a validação formal continua sendo o que autoriza a promessa.";

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

  // Sem previsão do modelo a tela não monta nada: o estado da tela (carregando,
  // indisponível) fica com js/previsao_sessao.js e js/estado_servico.js.
  if (typeof DADOS_TRIAGEM === "undefined") return;

  var dados = LP.fonte();
  var configDaUrl = LP.configuracaoDaUrl();
  var configAtiva = configDaUrl || dados.configuracao;
  var mat = LP.maturidade(dados, null, configAtiva);

  var leituras = LP.leiturasDeMarketing(LP.todosOsPontos(dados));

  loading.hidden = true;

  // Mesmo payload dos cartões e do registro, na voz de quem planeja campanha.
  RESUMO_EXECUTIVO.montar(document.getElementById("resumo-exec"), dados,
    { publico: "marketing", configuracao: configAtiva });
  MODO_LEITURA.iniciar();

  document.getElementById("model-version").textContent = mat.versao_modelo || "—";
  renderConfiguracao(configAtiva, mat, configDaUrl !== null);
  renderTitulo(leituras);
  renderTemas(leituras);
  renderMaturidade(mat);
  renderRegistro(leituras, mat, configAtiva);
})();
