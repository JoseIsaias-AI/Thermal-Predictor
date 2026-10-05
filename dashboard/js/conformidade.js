/* Tela de conformidade (RF-23, RF-24).
 *
 * Público de verificação e validação e de qualidade: o que trava a decisão é
 * saber qual componente reprova e com que folga, não o resultado do conjunto.
 * Recorte, agrupamento e tradução vêm de js/leitura_publicos.js; aqui só há
 * formatação e montagem de DOM, como em js/triagem.js.
 */

(function () {
  "use strict";

  var LP = LEITURA_PUBLICOS;
  var PUBLICO = "conformidade";

  var loading = document.getElementById("loading");
  var errorSection = document.getElementById("error");

  // {Key_Area: [subsistemas sem modelo validado]}, montado na carga.
  var naoAferidasPorArea = {};

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

  // Na tela, pt-BR: vírgula decimal, sinal de menos tipográfico e a mesma
  // casa decimal das outras telas. A planilha guarda o número cru.
  function fmt(valor, casas) {
    var t = valor.toFixed(casas);
    if (Number(t) === 0) t = t.replace("-", "");
    return t.replace(".", ",").replace("-", "−");
  }

  function grausC(valor) {
    return valor === null || valor === undefined ? "—" : fmt(valor, 1);
  }

  function percentual(fracao) {
    return fracao === null || fracao === undefined ? "—" : fmt(fracao * 100, 1) + "%";
  }

  /* Título da tela como conclusão: quantos componentes avaliados passam do
     limite admissível. Mesma contagem do resumo acima da tabela. */
  function renderTitulo(contagem, avaliados) {
    var acima = contagem.acima_do_limite;
    var banda = contagem.banda_de_incerteza;
    var texto = acima
      ? acima + " de " + avaliados + (acima === 1 ? " componente acima do limite admissível" : " componentes acima do limite admissível")
      : banda
        ? "Nenhum componente acima do limite; " + banda + " inconclusivos"
        : "Nenhum dos " + avaliados + " componentes acima do limite admissível";
    document.getElementById("page-title").textContent = texto;
  }

  /* Marca o ponto previsto por modelo que o grupo não validou.

     Existe porque o modelo final é uma mescla por área e as áreas não têm a
     mesma qualidade: `AC Blower Inlet` não teve modelo aprovado. Sem a marca, os
     seus pontos apareceriam com o mesmo peso visual dos validados. A pergunta é
     feita a `PREVISAO_SESSAO`, que casa ponto e modelo por `subsistema_modelo`;
     numa resposta sem o bloco `modelos`, nada é marcado. */
  function marcaDeModelo(ponto) {
    if (typeof PREVISAO_SESSAO === "undefined") return null;

    return PREVISAO_SESSAO.marcaDeModelo(document, dados, ponto);
  }

  function marcaDaArea(subsistemas) {
    if (typeof PREVISAO_SESSAO === "undefined") return null;

    return PREVISAO_SESSAO.marcaDeSubsistemas(document, subsistemas);
  }

  /* Quais áreas têm ponto previsto por modelo não validado, e por qual modelo.
     Percorre os pontos uma vez, antes de desenhar. */
  function indexarNaoAferidas(dados, pontos) {
    var porArea = {};

    if (typeof PREVISAO_SESSAO === "undefined") return porArea;

    pontos.forEach(function (p) {
      if (PREVISAO_SESSAO.pontoAferido(dados, p)) return;

      if (!porArea[p.Key_Area]) porArea[p.Key_Area] = [];
      if (porArea[p.Key_Area].indexOf(p.subsistema_modelo) < 0) {
        porArea[p.Key_Area].push(p.subsistema_modelo);
      }
    });

    return porArea;
  }

  // Subsistema na segunda linha da célula, como na tabela da triagem.
  function celulaComponente(ponto) {
    var td = document.createElement("td");
    td.appendChild(el("span", "point__name", ponto.TC_Name));
    td.appendChild(el("span", "point__area", ponto.Key_Area));

    var marca = marcaDeModelo(ponto);
    if (marca) td.appendChild(marca);

    return td;
  }

  // O rótulo textual é sempre exibido: a cor é redundante com ele, nunca
  // substituta.
  function celulaEstado(estado) {
    var td = document.createElement("td");
    td.appendChild(el("span", "state state--" + estado, LP.traduzirEstado(estado, PUBLICO)));
    return td;
  }

  function mostrarErro(mensagem) {
    loading.hidden = true;
    document.getElementById("error-message").textContent = mensagem;
    errorSection.hidden = false;
  }

  /* ----- Cabeçalho de rastreabilidade (RF-23) ----- */

  function renderConfiguracao(config, mat) {
    var lista = document.getElementById("config-list");

    function item(rotulo, valor) {
      var bloco = el("div", "cfg-item");
      var dt = el("dt", null, rotulo);
      dt.title = rotulo;
      bloco.appendChild(dt);
      bloco.appendChild(el("dd", null, valor));
      lista.appendChild(bloco);
    }

    LP.linhasDaConfiguracao(config).forEach(function (linha) {
      item(linha[0], linha[1]);
    });

    // Histórico e modelo entram como campos da mesma grade: no selo, o texto
    // quebrava em três linhas dentro da coluna do título.
    item("Histórico", mat.no_historico === null ? "Catálogo indisponível"
      : mat.no_historico
      ? mat.rodadas + (mat.rodadas === 1 ? " rodada simulada" : " rodadas simuladas")
      : "Nenhuma rodada equivalente");
    item("Modelo", mat.versao_modelo || "—");
    var dataBase = el("div", "cfg-item");
    var rotulo = el("dt");
    rotulo.appendChild(document.createTextNode("Data-base do "));
    rotulo.appendChild(LP.termo("treino", "treino"));
    dataBase.appendChild(rotulo);
    dataBase.appendChild(el("dd", null, mat.data_base_treino || "Não declarada"));
    lista.appendChild(dataBase);

    // A leitura de uma extrapolação não tem o mesmo peso da de uma
    // configuração já rodada, e é o selo que separa as duas.
    var selo = document.getElementById("config-origin");
    selo.textContent = mat.no_historico ? "já simulada" : "configuração nova";
    selo.title = mat.no_historico
      ? "A combinação dos seis fatores diretamente categóricos coincide com uma das configurações já simuladas."
      : "Nenhuma rodada da base combina esses seis fatores. A previsão é extrapolação e não vem com grau de confiança diferenciado.";
    // Sem o catálogo das rodadas não há como dizer se a combinação é nova: sem selo.
    selo.hidden = mat.no_historico === null;


    // A versão acompanha toda previsão exibida.
    document.getElementById("model-version").textContent = mat.versao_modelo || "—";

    document.getElementById("config-panel").hidden = false;
  }

  /* ----- Componentes que travam a decisão (RF-24) ----- */

  function renderTally(contagem) {
    var tally = document.getElementById("tally");

    ["acima_do_limite", "banda_de_incerteza", "dentro_do_limite", "monitoramento"].forEach(function (estado) {
      var li = document.createElement("li");
      li.appendChild(el("span", "tally__term", LP.traduzirEstado(estado, PUBLICO)));
      li.appendChild(el("span", "tally__count", contagem[estado]));
      tally.appendChild(li);
    });
  }

  function renderReprovados(lista, totalAvaliados) {
    var corpo = document.getElementById("reprovados-body");

    lista.forEach(function (p) {
      var tr = document.createElement("tr");
      tr.className = "row--" + p.estado;

      // Folga é a coluna que decide, e a única que sai do neutro quando é
      // negativa.
      var sinal = p.margem_c < 0 ? " margin--negative" : " margin--positive";

      tr.appendChild(celulaComponente(p));
      tr.appendChild(celula(grausC(p.temperatura_prevista_c), "num"));
      tr.appendChild(celula(grausC(p.limit_c), "num"));
      tr.appendChild(celula(grausC(p.margem_c), "num" + sinal));
      tr.appendChild(celula(percentual(p.margem_percentual), "num" + sinal));
      tr.appendChild(celulaEstado(p.estado));

      corpo.appendChild(tr);
    });

    document.getElementById("reprovados-count").textContent = lista.length;
    document.getElementById("avaliados-count").textContent = totalAvaliados;
    document.getElementById("reprovados-panel").hidden = false;
  }

  /* ----- Onde antecipar a checagem (RN-02) ----- */

  function renderSubsistemas(resumos) {
    var corpo = document.getElementById("subsistemas-body");

    resumos.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.className = "row--" + r.estado;

      var tdArea = celula(r.area);

      /* A marca sobe para a área porque o recorte do painel é por `Key_Area` e
         uma área pode ser atendida por mais de um modelo: `Main Vent Sys` reúne
         pontos do modelo dela, validado, e do de `AC Blower Inlet`, que não é. */
      var marcaArea = marcaDaArea(naoAferidasPorArea[r.area]);

      if (marcaArea) {
        tdArea.appendChild(document.createTextNode(" "));
        tdArea.appendChild(marcaArea);
      }

      tr.appendChild(tdArea);
      tr.appendChild(celulaEstado(r.estado));

      // Sem o componente que sustenta a severidade, o subsistema crítico
      // obrigaria a voltar à tabela de cima.
      tr.appendChild(celula(r.pior_ponto ? r.pior_ponto.TC_Name : "—",
        r.pior_ponto ? null : "cell-muted"));

      var sinal = r.pior_margem_c !== null && r.pior_margem_c < 0 ? " margin--negative" : " margin--positive";
      tr.appendChild(celula(grausC(r.pior_margem_c), "num" + sinal));

      tr.appendChild(celula(r.contagem.acima_do_limite, "num"));
      tr.appendChild(celula(r.contagem.banda_de_incerteza, "num"));
      tr.appendChild(celula(r.contagem.dentro_do_limite, "num"));
      tr.appendChild(celula(r.contagem.monitoramento, "num cell-muted"));

      corpo.appendChild(tr);
    });

    document.getElementById("subsistemas-panel").hidden = false;
  }

  /* ----- Exportação ----- */

  /* Número entra como número na planilha, não como texto: é o que permite
     ordenar por folga e formatar as casas decimais na própria célula. */
  var COLUNAS_DA_LEITURA = [
    { titulo: "Componente", tipo: "texto", valor: function (p) { return p.TC_Name; } },
    { titulo: "Subsistema", tipo: "texto", valor: function (p) { return p.Key_Area; } },
    /* Rastreabilidade do modelo final, que é uma mescla: a planilha diz qual
       modelo previu a linha e se ele foi validado. `Subsistema` não responde
       isso — a área `Main Vent Sys` sai de dois modelos diferentes. */
    { titulo: "Modelo", tipo: "texto", valor: function (p) { return p.subsistema_modelo || "—"; } },
    { titulo: "Modelo validado", tipo: "texto", valor: function (p) {
      if (typeof PREVISAO_SESSAO === "undefined") return "—";
      var modelo = PREVISAO_SESSAO.modeloDoPonto(dados, p);
      if (!modelo || modelo.validado === null || modelo.validado === undefined) return "—";
      return modelo.validado ? "Sim" : "Não";
    } },
    { titulo: "Prevista (°C)", tipo: "numero", valor: function (p) { return p.temperatura_prevista_c; } },
    { titulo: "Limite (°C)", tipo: "numero", valor: function (p) { return p.limit_c; } },
    { titulo: "Folga (°C)", tipo: "numero", valor: function (p) { return p.margem_c; } },
    { titulo: "Folga (%)", tipo: "numero1", valor: function (p) { return p.margem_percentual * 100; } },
    { titulo: "Estado", tipo: "texto", valor: function (p) { return LP.traduzirEstado(p.estado, PUBLICO); } }
  ];

  function ligarExportacao(lista, mat) {
    var botao = document.getElementById("export-csv");

    var comHistorico = document.getElementById("export-historico");

    botao.addEventListener("click", function () {
      // Só o resultado da consulta em curso, nunca a base inteira. O
      // histórico da sessão entra como segunda aba, se pedido.
      var abas = [{
        aba: "Conformidade",
        colunas: COLUNAS_DA_LEITURA.concat(LP.colunasDeProcedencia(mat)),
        linhas: lista
      }];
      if (comHistorico && comHistorico.checked && typeof HISTORICO_SESSAO !== "undefined") {
        abas.push(HISTORICO_SESSAO.abaDaPlanilha());
      }
      PLANILHA.baixar("thermal-predictor-conformidade.xlsx", PLANILHA.gerar({ abas: abas }));
    });

    botao.disabled = false;
  }

  /* ----- Montagem ----- */

  // Sem previsão do modelo a tela não monta nada: o estado da tela (carregando,
  // indisponível) fica com js/previsao_sessao.js e js/estado_servico.js.
  if (typeof DADOS_TRIAGEM === "undefined") return;

  var dados = LP.fonte();
  var pontos = LP.todosOsPontos(dados);
  var configDaUrl = LP.configuracaoDaUrl();
  var configAtiva = configDaUrl || dados.configuracao;
  var mat = LP.maturidade(dados, null, configAtiva);
  var reprovados = LP.reprovados(pontos);
  var contagem = LP.contarEstados(pontos);

  naoAferidasPorArea = indexarNaoAferidas(dados, pontos);

  loading.hidden = true;

  renderConfiguracao(configAtiva, mat);
  renderTitulo(contagem, pontos.length - contagem.monitoramento);
  renderTally(contagem);
  renderReprovados(reprovados, pontos.length - contagem.monitoramento);
  renderSubsistemas(LP.porSubsistema(pontos));
  ligarExportacao(reprovados, mat);
})();
