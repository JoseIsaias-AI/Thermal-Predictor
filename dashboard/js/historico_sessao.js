/* Histórico da sessão: cada configuração analisada desde que o painel abriu.
 *
 * Fica no sessionStorage da aba, e não num arquivo ou banco: o painel tem uma
 * página por tela, e a memória do script morre a cada navegação entre elas.
 * O sessionStorage é o menor escopo que atravessa essa navegação; o navegador
 * o descarta ao fechar a aba, e recarregar a página o apaga aqui mesmo. Nada
 * vai para disco pelo painel nem sai da máquina.
 *
 * Cada entrada guarda a configuração, o horário, a contagem por estado e a
 * resposta do modelo para ela: para revisitar ou exportar uma análise antiga,
 * a leitura é refeita sobre essa resposta pelas mesmas funções das telas, e é
 * isso que garante que o arquivo conta o mesmo que a tela contou. Sem a
 * resposta guardada, a entrada fica fora da exportação — nenhuma outra fonte
 * entra no lugar.
 *
 * Telas que recebem configuração pela URL registram sozinhas ao carregar. A
 * tela de consulta só lista, porque não carrega as leituras.
 */

var HISTORICO_SESSAO = (function () {
  "use strict";

  var CHAVE = "thermal-predictor:historico-sessao";
  var TELAS_DE_RESULTADO = ["triagem.html", "conformidade.html", "design.html", "marketing.html", "engenharia.html"];
  var TELA_PADRAO = "triagem.html";

  // Sem sessionStorage (modo privado restrito, file:// em alguns navegadores)
  // o histórico vale só para a página aberta.
  var emMemoria = { proximo: 1, entradas: [] };

  function armazenamento() {
    try {
      var s = window.sessionStorage;
      s.setItem(CHAVE + ":teste", "1");
      s.removeItem(CHAVE + ":teste");
      return s;
    } catch (e) { return null; }
  }

  function ler() {
    var s = armazenamento();
    if (!s) return emMemoria;
    try {
      var estado = JSON.parse(s.getItem(CHAVE));
      if (estado && Array.isArray(estado.entradas)) return estado;
    } catch (e) { /* conteúdo corrompido vale como vazio */ }
    return { proximo: 1, entradas: [] };
  }

  function gravar(estado) {
    emMemoria = estado;
    var s = armazenamento();
    if (s) {
      try { s.setItem(CHAVE, JSON.stringify(estado)); } catch (e) { /* cheio: fica em memória */ }
    }
    avisar();
  }

  var ouvintes = [];
  function avisar() {
    ouvintes.forEach(function (fn) { fn(); });
  }

  function aoMudar(fn) { ouvintes.push(fn); }

  /* ----- Registro ----- */

  function temLeitura() {
    return typeof LEITURA_PUBLICOS !== "undefined" && typeof DADOS_TRIAGEM !== "undefined";
  }

  // Mesmo formato de `paraQueryString` em js/app.js, lido por configuracaoDaUrl.
  function paraBusca(config) {
    var partes = [];
    Object.keys(config || {}).forEach(function (chave) {
      var valor = config[chave];
      if (valor === null || valor === undefined || valor === "") return;
      if (typeof valor === "object") {
        Object.keys(valor).forEach(function (sub) {
          if (valor[sub] === null || valor[sub] === undefined || valor[sub] === "") return;
          partes.push(encodeURIComponent(chave + "." + sub) + "=" + encodeURIComponent(valor[sub]));
        });
        return;
      }
      partes.push(encodeURIComponent(chave) + "=" + encodeURIComponent(valor));
    });
    return partes.length ? "?" + partes.join("&") : "";
  }

  function mesma(a, b) {
    return LEITURA_PUBLICOS.mesmosSeteFatores(a, b);
  }

  /* Registra a configuração analisada. Configuração já registrada não entra
     de novo: o histórico tem uma linha por configuração, e abrir a mesma
     análise em outra tela não é outra análise. */
  function registrar(config, quando) {
    if (!config || !temLeitura()) return null;
    var LP = LEITURA_PUBLICOS;
    var estado = ler();

    var existente = null;
    estado.entradas.forEach(function (e) { if (!existente && mesma(e.config, config)) existente = e; });
    if (existente) return existente;

    // Só a previsão desta configuração entra no histórico.
    var dados = LP.fonte();
    if (!dados || !mesma(dados.configuracao, config)) return null;
    var pontos = LP.todosOsPontos(dados);
    var mat = LP.maturidade(dados, null, config);

    var entrada = {
      n: estado.proximo,
      quando: (quando || new Date()).toISOString(),
      config: config,
      busca: paraBusca(config),
      rotulos: LP.linhasDaConfiguracao(config),
      configuracao_id: mat.configuracao_id,
      no_historico: mat.no_historico,
      versao_modelo: mat.versao_modelo,
      contagem: LP.contarEstados(pontos),
      resposta: dados
    };

    estado.entradas.push(entrada);
    estado.proximo += 1;
    gravar(estado);
    return entrada;
  }

  function listar() {
    return ler().entradas.slice();
  }

  function limpar() {
    var s = armazenamento();
    if (s) {
      try { s.removeItem(CHAVE); } catch (e) { /* nada a apagar */ }
    }
    emMemoria = { proximo: 1, entradas: [] };
    avisar();
  }

  function entradaDaConfiguracao(config) {
    if (!config || !temLeitura()) return null;
    var achada = null;
    listar().forEach(function (e) { if (!achada && mesma(e.config, config)) achada = e; });
    return achada;
  }

  /* ----- Leitura recalculada ----- */

  /* A resposta do modelo para a entrada: a guardada com ela ou, para a
     configuração aberta agora, a da tela. `null` sem nenhuma das duas. */
  function dadosDaEntrada(entrada) {
    if (entrada && entrada.resposta) return entrada.resposta;
    var atual = LEITURA_PUBLICOS.fonte();
    return atual && entrada && mesma(atual.configuracao, entrada.config) ? atual : null;
  }

  /* A análise completa de uma entrada, pelas mesmas funções das telas. `null`
     quando a entrada não tem a resposta do modelo. */
  function analise(entrada) {
    var LP = LEITURA_PUBLICOS;
    var dados = dadosDaEntrada(entrada);
    if (!dados) return null;
    var pontos = LP.todosOsPontos(dados);

    return {
      entrada: entrada,
      dados: dados,
      pontos: pontos,
      contagem: LP.contarEstados(pontos),
      mat: LP.maturidade(dados, null, entrada.config),
      reprovados: LP.reprovados(pontos),
      subsistemas: LP.porSubsistema(pontos),
      temas: LP.leiturasDeMarketing(pontos),
      resumo: RESUMO_EXECUTIVO.gerar(dados, {})
    };
  }

  /* ----- Planilha ----- */

  // Colunas dos fatores na ordem de js/schema.js, com o rótulo da tela.
  function colunasDosFatores() {
    var titulos = [];
    ((typeof SCHEMA === "undefined" ? null : SCHEMA) || { factors: [] }).factors.forEach(function (f) {
      if (f.subfields && f.subfields.length) f.subfields.forEach(function (s) { titulos.push(s.label); });
      else titulos.push(f.label);
    });

    return titulos.map(function (titulo) {
      return {
        titulo: titulo,
        tipo: "texto",
        valor: function (a) {
          var achado = "";
          a.entrada.rotulos.forEach(function (l) { if (l[0] === titulo) achado = l[1]; });
          return achado;
        }
      };
    });
  }

  /* A procedência de js/leitura_publicos.js, mas por linha: cada análise tem
     a sua origem no histórico de rodadas. */
  function colunasDeProcedencia() {
    var LP = LEITURA_PUBLICOS;
    return LP.metadadosDoRegistro(null).map(function (par, i) {
      return {
        titulo: par[0],
        tipo: "texto",
        valor: function (a) {
          if (par[0] === "Tipo de registro") return "Registro de sessão";
          return LP.metadadosDoRegistro(a.mat)[i][1];
        }
      };
    });
  }

  /* Aba do histórico, uma linha por configuração analisada. Contagem e folga
     entram como número, para a planilha ordenar e somar. */
  function abaDaPlanilha(entradas) {
    var LP = LEITURA_PUBLICOS;
    var analises = (entradas || listar()).map(analise).filter(Boolean);

    function maisCritico(a) { return a.subsistemas[0] || null; }
    function piorPonto(a) { return a.reprovados[0] || LP.ordenarPorRisco(a.pontos)[0] || null; }

    var colunas = [
      { titulo: "Análise", tipo: "inteiro", valor: function (a) { return a.entrada.n; } },
      { titulo: "Analisada em", tipo: "texto", valor: function (a) { return LP.dataLegivel(new Date(a.entrada.quando)); } },
      { titulo: "Origem", tipo: "texto", valor: function (a) {
        return a.mat.no_historico ? "Já simulada · " + a.mat.configuracao_id : "Configuração nova";
      } }
    ].concat(colunasDosFatores()).concat([
      { titulo: "Acima do limite", tipo: "inteiro", valor: function (a) { return a.contagem.acima_do_limite; } },
      { titulo: "Inconclusivos", tipo: "inteiro", valor: function (a) { return a.contagem.banda_de_incerteza; } },
      { titulo: "Dentro do limite", tipo: "inteiro", valor: function (a) { return a.contagem.dentro_do_limite; } },
      { titulo: "Sem limite declarado", tipo: "inteiro", valor: function (a) { return a.contagem.monitoramento; } },
      { titulo: "Subsistema mais crítico", tipo: "texto", valor: function (a) { var s = maisCritico(a); return s ? s.area : ""; } },
      { titulo: "Componente de menor folga", tipo: "texto", valor: function (a) { var p = piorPonto(a); return p ? p.TC_Name : ""; } },
      { titulo: "Menor folga (°C)", tipo: "numero", valor: function (a) { var p = piorPonto(a); return p ? p.margem_c : null; } }
    ]).concat(colunasDeProcedencia());

    return { aba: "Histórico da sessão", colunas: colunas, linhas: analises };
  }

  function exportarPlanilha() {
    PLANILHA.baixar("thermal-predictor-historico-sessao.xlsx", PLANILHA.gerar(abaDaPlanilha()));
  }

  /* ----- PDF ----- */

  function exportarPdf(entrada) {
    var a = analise(entrada);
    if (!a) return;
    DOCUMENTO_PDF.baixar("thermal-predictor-analise-" + (entrada.n || "referencia") + ".pdf",
      REGISTRO_PDF.analise(a).blob());
  }

  function exportarPdfDoHistorico() {
    DOCUMENTO_PDF.baixar("thermal-predictor-historico-sessao.pdf",
      REGISTRO_PDF.historico(listar().map(analise).filter(Boolean)).blob());
  }

  /* A análise em exibição. Sem configuração na URL, a tela mostra a
     referência do conjunto de dados, que não é análise da sessão e sai sem
     número. */
  function entradaAtual() {
    var LP = LEITURA_PUBLICOS;
    var config = LP.configuracaoDaUrl();
    return entradaDaConfiguracao(config) ||
      { n: null, quando: new Date().toISOString(), config: config || DADOS_TRIAGEM.configuracao };
  }

  function exportarPdfAtual() {
    exportarPdf(entradaAtual());
  }

  /* ----- Ciclo de vida ----- */

  function foiRecarregada() {
    try {
      var nav = window.performance.getEntriesByType("navigation")[0];
      if (nav) return nav.type === "reload";
    } catch (e) { /* API antiga abaixo */ }
    try { return window.performance.navigation.type === 1; } catch (e2) { return false; }
  }

  function telaAtual() {
    var partes = window.location.pathname.split("/");
    return partes[partes.length - 1] || "index.html";
  }

  /* ----- Painel ----- */

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function hora(iso) {
    var d = new Date(iso);
    function dois(n) { return (n < 10 ? "0" : "") + n; }
    return dois(d.getHours()) + ":" + dois(d.getMinutes());
  }

  var botao = null;
  var painel = null;
  var lista = null;
  var acoes = null;

  function destinoDe(entrada) {
    var tela = TELAS_DE_RESULTADO.indexOf(telaAtual()) >= 0 ? telaAtual() : TELA_PADRAO;
    return tela + entrada.busca;
  }

  function contagemTexto(c) {
    return [
      { n: c.acima_do_limite, t: "acima", e: "acima_do_limite" },
      { n: c.banda_de_incerteza, t: c.banda_de_incerteza === 1 ? "inconclusivo" : "inconclusivos", e: "banda_de_incerteza" },
      { n: c.dentro_do_limite, t: "dentro", e: "dentro_do_limite" },
      { n: c.monitoramento, t: "sem limite", e: "monitoramento" }
    ];
  }

  function itemDaLista(entrada, atual) {
    var li = el("li", "sessao-item" + (atual ? " sessao-item--atual" : ""));
    if (atual) li.setAttribute("aria-current", "true");

    var topo = el("div", "sessao-item__topo");
    topo.appendChild(el("span", "sessao-item__n", "#" + entrada.n));
    topo.appendChild(el("span", "sessao-item__hora", hora(entrada.quando)));
    var selo = el("span", "config__tag" + (entrada.no_historico ? "" : " config__tag--nota"),
      entrada.no_historico ? "já simulada · " + entrada.configuracao_id : "configuração nova");
    topo.appendChild(selo);
    if (atual) topo.appendChild(el("span", "sessao-item__atual", "em exibição"));
    li.appendChild(topo);

    var resumo = entrada.rotulos.map(function (l) { return l[1]; }).join(" · ");
    var cfg = el("p", "sessao-item__config", resumo);
    cfg.title = entrada.rotulos.map(function (l) { return l[0] + ": " + l[1]; }).join("\n");
    li.appendChild(cfg);

    var conta = el("p", "sessao-item__conta");
    contagemTexto(entrada.contagem).forEach(function (p, i) {
      if (i) conta.appendChild(document.createTextNode(" · "));
      var s = el("span", "sessao-conta sessao-conta--" + p.e);
      s.appendChild(el("strong", null, String(p.n)));
      s.appendChild(document.createTextNode(" " + p.t));
      conta.appendChild(s);
    });
    li.appendChild(conta);

    var botoes = el("div", "sessao-item__acoes");
    if (atual) {
      botoes.appendChild(el("span", "sessao-item__nota", "Resultado aberto nesta tela"));
    } else {
      var ver = el("a", "btn btn--ghost btn--mini", "Ver resultado");
      ver.href = destinoDe(entrada);
      botoes.appendChild(ver);
    }
    if (typeof REGISTRO_PDF !== "undefined") {
      var pdf = el("button", "btn btn--ghost btn--mini", "PDF");
      pdf.type = "button";
      pdf.title = "Baixar o registro desta análise em PDF";
      pdf.addEventListener("click", function () { exportarPdf(entrada); });
      botoes.appendChild(pdf);
    }
    li.appendChild(botoes);

    return li;
  }

  function desenhar() {
    if (!painel) return;
    var entradas = listar();
    var configDaTela = temLeitura() ? LEITURA_PUBLICOS.configuracaoDaUrl() : null;

    botao.querySelector(".sessao-botao__n").textContent = entradas.length;

    lista.innerHTML = "";
    if (!entradas.length) {
      lista.appendChild(el("li", "sessao-vazio",
        "Nenhuma análise nesta sessão ainda. Cada configuração consultada entra aqui, na ordem da consulta."));
    }
    // Mais recente primeiro: é a que se procura ao voltar.
    entradas.slice().reverse().forEach(function (e) {
      var atual = configDaTela !== null && mesma(e.config, configDaTela);
      lista.appendChild(itemDaLista(e, atual));
    });

    Array.prototype.forEach.call(acoes.querySelectorAll("button"), function (b) {
      b.disabled = entradas.length === 0;
    });

    var opcao = document.getElementById("export-historico");
    if (opcao) {
      opcao.disabled = entradas.length === 0;
      if (!entradas.length) opcao.checked = false;
      var n = document.getElementById("export-historico-n");
      if (n) n.textContent = entradas.length === 1 ? "1 análise" : entradas.length + " análises";
    }
  }

  // Painel logo abaixo do botão, alinhado à borda direita dele.
  function posicionar() {
    var r = botao.getBoundingClientRect();
    var largura = document.documentElement.clientWidth;
    painel.style.top = (r.bottom + window.scrollY + 8) + "px";
    painel.style.right = Math.max(16, largura - r.right) + "px";
  }

  function abrir(aberto) {
    if (aberto) posicionar();
    painel.hidden = !aberto;
    botao.setAttribute("aria-expanded", String(aberto));
    if (aberto) painel.querySelector(".sessao__fechar").focus();
  }

  /* O botão fica nas ações do cabeçalho da tela, ao lado das exportações, e
     não na barra do topo: a barra já está no limite com as sete telas. A
     tela de consulta, sem esse cabeçalho, marca o lugar com
     `data-historico-sessao`. */
  function montarPainel() {
    var alvo = document.querySelector("[data-historico-sessao]") || document.querySelector(".page-head__actions");
    if (!alvo) return;

    botao = el("button", "btn btn--ghost sessao-botao");
    botao.type = "button";
    botao.setAttribute("aria-expanded", "false");
    botao.setAttribute("aria-controls", "sessao-painel");
    botao.title = "Configurações analisadas desde que o painel foi aberto nesta aba";
    botao.appendChild(el("span", null, "Histórico da sessão"));
    botao.appendChild(el("span", "sessao-botao__n", "0"));
    // Antes de "Alterar configuração", que fecha a fila de ações.
    var alterar = alvo.querySelector('a[href="index.html"]');
    alvo.insertBefore(botao, alterar || null);

    painel = el("section", "sessao");
    painel.id = "sessao-painel";
    painel.setAttribute("role", "dialog");
    painel.setAttribute("aria-labelledby", "sessao-titulo");
    painel.hidden = true;

    var cabeca = el("div", "sessao__cabeca");
    var titulo = el("h2", "sessao__titulo", "Histórico desta sessão");
    titulo.id = "sessao-titulo";
    cabeca.appendChild(titulo);
    var fechar = el("button", "sessao__fechar", "×");
    fechar.type = "button";
    fechar.setAttribute("aria-label", "Fechar o histórico");
    fechar.addEventListener("click", function () { abrir(false); botao.focus(); });
    cabeca.appendChild(fechar);
    painel.appendChild(cabeca);

    // A limpeza fica dita antes da lista, para ninguém contar com o histórico
    // depois de fechar a aba.
    var aviso = el("p", "sessao__aviso");
    aviso.appendChild(el("strong", null, "Some ao fechar ou recarregar o painel."));
    aviso.appendChild(document.createTextNode(
      " O histórico fica só nesta aba do navegador enquanto ela estiver aberta. Nada é salvo em disco nem enviado. Exporte o que precisar guardar."));
    painel.appendChild(aviso);

    lista = el("ol", "sessao__lista");
    painel.appendChild(lista);

    acoes = el("div", "sessao__acoes");
    if (typeof PLANILHA !== "undefined" && typeof RESUMO_EXECUTIVO !== "undefined") {
      var xlsx = el("button", "btn btn--ghost", "Planilha do histórico");
      xlsx.type = "button";
      xlsx.addEventListener("click", exportarPlanilha);
      acoes.appendChild(xlsx);
    }
    if (typeof REGISTRO_PDF !== "undefined") {
      var pdf = el("button", "btn btn--ghost", "PDF do histórico");
      pdf.type = "button";
      pdf.addEventListener("click", exportarPdfDoHistorico);
      acoes.appendChild(pdf);
    }
    if (!acoes.children.length) {
      acoes.appendChild(el("span", "sessao__nota", "Para exportar, abra uma das telas de resultado."));
    }
    var limparBtn = el("button", "btn btn--ghost sessao__limpar", "Limpar histórico");
    limparBtn.type = "button";
    limparBtn.addEventListener("click", function () {
      if (window.confirm("Apagar as análises desta sessão? Não há como recuperar.")) limpar();
    });
    acoes.appendChild(limparBtn);
    painel.appendChild(acoes);

    document.body.appendChild(painel);

    botao.addEventListener("click", function () { abrir(painel.hidden); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !painel.hidden) { abrir(false); botao.focus(); }
    });
    document.addEventListener("click", function (ev) {
      if (!painel.hidden && !painel.contains(ev.target) && !botao.contains(ev.target)) abrir(false);
    });

    aoMudar(desenhar);
    desenhar();
  }

  // Botões `data-exportar-pdf` nas telas baixam o PDF da análise em exibição.
  function ligarBotoesDaTela() {
    if (typeof REGISTRO_PDF === "undefined") return;
    Array.prototype.forEach.call(document.querySelectorAll("[data-exportar-pdf]"), function (b) {
      b.addEventListener("click", exportarPdfAtual);
      b.disabled = false;
    });
  }

  function iniciar() {
    if (foiRecarregada()) limpar();

    if (temLeitura() && TELAS_DE_RESULTADO.indexOf(telaAtual()) >= 0) {
      registrar(LEITURA_PUBLICOS.configuracaoDaUrl());
    }

    montarPainel();
    ligarBotoesDaTela();

    // Volta pelo histórico do navegador pode restaurar a página congelada,
    // com a lista da hora em que ela foi deixada.
    window.addEventListener("pageshow", function (ev) { if (ev.persisted) desenhar(); });
    window.addEventListener("resize", function () { if (painel && !painel.hidden) posicionar(); });
  }

  if (typeof document !== "undefined" && document.querySelector) iniciar();

  return {
    CHAVE: CHAVE,
    registrar: registrar,
    listar: listar,
    limpar: limpar,
    analise: analise,
    abaDaPlanilha: abaDaPlanilha,
    entradaAtual: entradaAtual,
    paraBusca: paraBusca,
    exportarPdf: exportarPdf,
    exportarPdfDoHistorico: exportarPdfDoHistorico,
    exportarPlanilha: exportarPlanilha,
    aoMudar: aoMudar
  };
})();
