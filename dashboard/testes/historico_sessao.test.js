/* Testes do histórico da sessão e das exportações em planilha e PDF.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/historico_sessao.test.js
 *
 * Sem navegador: o sessionStorage é um objeto em memória compartilhado entre
 * contextos, e cada contexto novo faz o papel de uma página carregada. O que
 * se confere nos arquivos é o que a tela exibe: a planilha e o PDF são abertos
 * de volta e cada número é comparado com a leitura das mesmas funções que as
 * telas usam, com a formatação de cada tela.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var JS = path.join(__dirname, "..", "js");
var ARQUIVOS = ["schema.js", "dados_triagem.js", "dados_comparacao.js", "planilha.js",
  "leitura_publicos.js", "resumo_executivo.js", "documento_pdf.js", "registro_pdf.js", "historico_sessao.js"];

function armazenamentoFalso() {
  var dados = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : null; },
    setItem: function (k, v) { dados[k] = String(v); },
    removeItem: function (k) { delete dados[k]; },
    _dados: dados
  };
}

/* Uma "página": contexto novo com os scripts do painel. Com `pagina`, simula
   o DOM mínimo para o histórico iniciar sozinho (registro e limpeza). */
function carregar(opcoes) {
  opcoes = opcoes || {};
  var janela = {
    sessionStorage: opcoes.armazenamento,
    location: { pathname: "/dashboard/" + (opcoes.pagina || "triagem.html"), search: opcoes.busca || "" },
    performance: { getEntriesByType: function () { return [{ type: opcoes.navegacao || "navigate" }]; } },
    addEventListener: function () {}
  };
  var ctx = { window: janela, TextEncoder: TextEncoder, Blob: function () {} };
  if (opcoes.pagina) {
    ctx.document = {
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      getElementById: function () { return null; },
      addEventListener: function () {}
    };
  }
  vm.createContext(ctx);
  ARQUIVOS.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
  });
  return {
    DADOS: vm.runInContext("DADOS_TRIAGEM", ctx),
    CATALOGO: vm.runInContext("DADOS_COMPARACAO", ctx),
    LP: vm.runInContext("LEITURA_PUBLICOS", ctx),
    P: vm.runInContext("PLANILHA", ctx),
    PDF: vm.runInContext("DOCUMENTO_PDF", ctx),
    R: vm.runInContext("REGISTRO_PDF", ctx),
    H: vm.runInContext("HISTORICO_SESSAO", ctx)
  };
}

// Três configurações do catálogo e uma fora dele (cai na de referência).
function configuracoes(M) {
  var novas = JSON.parse(JSON.stringify(M.CATALOGO.configuracoes[0].fatores));
  novas.run_case = "valor-que-nao-existe";
  return [
    M.CATALOGO.configuracoes[3].fatores,
    M.CATALOGO.configuracoes[7].fatores,
    M.DADOS.configuracao,
    novas
  ].map(function (c) { return JSON.parse(JSON.stringify(c)); });
}

/* ----- Leitura dos arquivos ----- */

function abrirPacote(bytes) {
  var buf = Buffer.from(bytes);
  var fim = buf.length - 22;
  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim--;
  var total = buf.readUInt16LE(fim + 10);
  var p = buf.readUInt32LE(fim + 16);
  var arquivos = {};
  for (var i = 0; i < total; i++) {
    var tamanho = buf.readUInt32LE(p + 24);
    var nomeLen = buf.readUInt16LE(p + 28);
    var extraLen = buf.readUInt16LE(p + 30);
    var comLen = buf.readUInt16LE(p + 32);
    var desl = buf.readUInt32LE(p + 42);
    var nome = buf.slice(p + 46, p + 46 + nomeLen).toString("utf8");
    var ini = desl + 30 + buf.readUInt16LE(desl + 26) + buf.readUInt16LE(desl + 28);
    arquivos[nome] = buf.slice(ini, ini + tamanho).toString("utf8");
    p += 46 + nomeLen + extraLen + comLen;
  }
  return arquivos;
}

// Linhas da aba como matriz de valores (número como Number, texto como String).
function linhasDaAba(xml) {
  var linhas = [];
  (xml.match(/<row [^>]*>[\s\S]*?<\/row>/g) || []).forEach(function (row) {
    var valores = [];
    (row.match(/<c [^>]*?(\/>|>[\s\S]*?<\/c>)/g) || []).forEach(function (c) {
      var t = /<t xml:space="preserve">([\s\S]*?)<\/t>/.exec(c);
      var v = /<v>([^<]*)<\/v>/.exec(c);
      valores.push(t ? t[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&")
        : (v ? Number(v[1]) : null));
    });
    linhas.push(valores);
  });
  return linhas;
}

var WIN_ANSI_INV = { 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—" };

function decodificarLiteral(s) {
  var saida = "";
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c !== "\\") { saida += c; continue; }
    var prox = s.charAt(i + 1);
    if (/[0-7]/.test(prox)) {
      var cod = parseInt(s.substr(i + 1, 3), 8);
      saida += WIN_ANSI_INV[cod] || String.fromCharCode(cod);
      i += 3;
    } else {
      saida += prox;
      i += 1;
    }
  }
  return saida;
}

/* Abre o PDF: confere a tabela de referências cruzadas e devolve o texto de
   cada página, na ordem em que foi desenhado. */
function abrirPdf(bytes) {
  var s = Buffer.from(bytes).toString("latin1");
  assert.ok(s.indexOf("%PDF-1.4") === 0, "assinatura");
  assert.ok(/%%EOF\n$/.test(s), "fim do arquivo");

  var inicioXref = Number(/startxref\n(\d+)\n%%EOF/.exec(s)[1]);
  assert.equal(s.substr(inicioXref, 4), "xref", "startxref aponta para a tabela");
  var total = Number(/xref\n0 (\d+)\n/.exec(s.slice(inicioXref))[1]);
  var entradas = s.slice(inicioXref).split("\n").slice(3, 3 + total - 1);
  entradas.forEach(function (linha, i) {
    var pos = Number(linha.slice(0, 10));
    assert.equal(s.substr(pos, String(i + 1).length + 6), (i + 1) + " 0 obj", "posição do objeto " + (i + 1));
  });

  var paginas = [];
  var re = /<< \/Length (\d+) >>\nstream\n/g;
  var m;
  while ((m = re.exec(s))) {
    var ini = m.index + m[0].length;
    var fluxo = s.substr(ini, Number(m[1]));
    assert.equal(s.substr(ini + Number(m[1]), 10), "\nendstream", "comprimento do fluxo");
    var textos = [];
    var rt = /\(((?:\\.|[^\\)])*)\) Tj/g;
    var t;
    while ((t = rt.exec(fluxo))) textos.push(decodificarLiteral(t[1]));
    paginas.push(textos);
  }

  var contagem = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)[1]);
  assert.equal(paginas.length, contagem, "uma página por fluxo de conteúdo");
  return paginas;
}

function textoCorrido(paginas) {
  return paginas.map(function (p) { return p.join(" "); }).join(" ").replace(/\s+/g, " ");
}

/* ----- Formatação de cada tela (js/conformidade.js, js/triagem.js,
   js/marketing.js) ----- */

function g2(v) { return v === null || v === undefined ? "—" : v.toFixed(2); }
function g1(v) { return v === null || v === undefined ? "—" : v.toFixed(1); }
function pct(f) { return f === null || f === undefined ? "—" : (f * 100).toFixed(1) + "%"; }

/* ----- Histórico ----- */

test("registra configuração, horário e contagem por estado de cada análise", function () {
  var M = carregar();
  var cfgs = configuracoes(M);
  var quando = new Date(2026, 8, 22, 14, 30);

  var e = M.H.registrar(cfgs[0], quando);
  var pontos = M.LP.todosOsPontos(M.LP.fonte(cfgs[0]));

  assert.equal(e.n, 1);
  assert.equal(e.quando, quando.toISOString());
  assert.deepEqual(JSON.parse(JSON.stringify(e.config)), cfgs[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(e.contagem)), JSON.parse(JSON.stringify(M.LP.contarEstados(pontos))));
  assert.equal(e.contagem.acima_do_limite + e.contagem.banda_de_incerteza +
    e.contagem.dentro_do_limite + e.contagem.monitoramento, pontos.length);
  assert.ok(e.busca.indexOf("?") === 0);
  assert.ok(e.rotulos.length > 0, "rótulos da configuração para a lista");
});

test("a mesma configuração não entra duas vezes; outra entra no fim", function () {
  var M = carregar();
  var cfgs = configuracoes(M);

  M.H.registrar(cfgs[0]);
  M.H.registrar(cfgs[1]);
  var repetida = M.H.registrar(JSON.parse(JSON.stringify(cfgs[0])));

  assert.equal(repetida.n, 1);
  assert.deepEqual(Array.from(M.H.listar(), function (e) { return e.n; }), [1, 2]);
});

test("a busca gravada reabre a mesma configuração", function () {
  var M = carregar();
  M.H.registrar(configuracoes(M)[0]);
  var e = M.H.listar()[0];
  assert.ok(M.LP.mesmosSeteFatores(M.LP.configuracaoDaUrl(e.busca), e.config));
});

test("o histórico atravessa a navegação entre telas e some ao recarregar", function () {
  var armazenamento = armazenamentoFalso();
  var M = carregar();
  var cfgs = configuracoes(M);

  var p1 = carregar({ armazenamento: armazenamento, pagina: "triagem.html", busca: M.H.paraBusca(cfgs[0]) });
  assert.equal(p1.H.listar().length, 1, "a tela de resultado registra a configuração da URL");

  var p2 = carregar({ armazenamento: armazenamento, pagina: "conformidade.html", busca: M.H.paraBusca(cfgs[1]) });
  assert.equal(p2.H.listar().length, 2, "outra tela, outra configuração");

  var p3 = carregar({ armazenamento: armazenamento, pagina: "marketing.html", busca: M.H.paraBusca(cfgs[0]) });
  assert.equal(p3.H.listar().length, 2, "mesma configuração em outra tela não duplica");

  var inicio = carregar({ armazenamento: armazenamento, pagina: "index.html" });
  assert.equal(inicio.H.listar().length, 2, "a consulta lista, não registra nem apaga");

  var recarga = carregar({ armazenamento: armazenamento, pagina: "triagem.html",
    busca: M.H.paraBusca(cfgs[1]), navegacao: "reload" });
  assert.deepEqual(Array.from(recarga.H.listar(), function (e) { return e.n; }), [1],
    "recarregar limpa; sobra só a análise em exibição");
  assert.ok(recarga.LP.mesmosSeteFatores(recarga.H.listar()[0].config, cfgs[1]));
});

test("tela sem configuração na URL mostra a referência e não registra", function () {
  var armazenamento = armazenamentoFalso();
  var p = carregar({ armazenamento: armazenamento, pagina: "triagem.html" });
  assert.equal(p.H.listar().length, 0);
});

test("limpar apaga tudo e a numeração recomeça", function () {
  var M = carregar();
  var cfgs = configuracoes(M);
  M.H.registrar(cfgs[0]);
  M.H.registrar(cfgs[1]);
  M.H.limpar();
  assert.equal(M.H.listar().length, 0);
  assert.equal(M.H.registrar(cfgs[2]).n, 1);
});

test("nada além de configuração, horário e contagem vai para o armazenamento", function () {
  var armazenamento = armazenamentoFalso();
  var M = carregar();
  carregar({ armazenamento: armazenamento, pagina: "triagem.html", busca: M.H.paraBusca(configuracoes(M)[0]) });

  var gravado = armazenamento._dados["thermal-predictor:historico-sessao"];
  assert.ok(gravado);
  assert.equal(/TC_Name|temperatura_prevista|margem_c|limit_c/.test(gravado), false,
    "ponto de medição não é guardado: é recalculado ao exportar");
});

/* ----- Planilha do histórico ----- */

test("planilha do histórico: uma linha por configuração, sem divergência da tela", function () {
  var M = carregar();
  var cfgs = configuracoes(M);
  cfgs.forEach(function (c) { M.H.registrar(c); });

  var aba = M.H.abaDaPlanilha();
  var pacote = abrirPacote(M.P.gerarBytes(aba));
  var linhas = linhasDaAba(pacote["xl/worksheets/sheet1.xml"]);
  var cab = linhas[0];

  assert.equal(linhas.length, cfgs.length + 1, "cabeçalho mais uma linha por análise");

  function col(titulo) {
    var i = cab.indexOf(titulo);
    assert.ok(i >= 0, "coluna ausente: " + titulo);
    return i;
  }

  M.H.listar().forEach(function (e, k) {
    var linha = linhas[k + 1];
    var dados = M.LP.fonte(e.config);
    var pontos = M.LP.todosOsPontos(dados);
    var c = M.LP.contarEstados(pontos);

    assert.equal(linha[col("Análise")], e.n);
    assert.equal(linha[col("Analisada em")], M.LP.dataLegivel(new Date(e.quando)));
    // A contagem que a tela da conformidade mostra no resumo de estados.
    assert.equal(linha[col("Acima do limite")], c.acima_do_limite);
    assert.equal(linha[col("Inconclusivos")], c.banda_de_incerteza);
    assert.equal(linha[col("Dentro do limite")], c.dentro_do_limite);
    assert.equal(linha[col("Sem limite declarado")], c.monitoramento);
    // E a mesma que foi gravada no histórico ao analisar.
    assert.equal(linha[col("Acima do limite")], e.contagem.acima_do_limite);

    var pior = M.LP.reprovados(pontos)[0] || M.LP.ordenarPorRisco(pontos)[0];
    assert.equal(linha[col("Componente de menor folga")], pior.TC_Name);
    assert.equal(linha[col("Menor folga (°C)")], pior.margem_c);
    assert.equal(linha[col("Subsistema mais crítico")], M.LP.porSubsistema(pontos)[0].area);

    e.rotulos.forEach(function (r) { assert.equal(linha[col(r[0])], r[1], "fator " + r[0]); });
    assert.equal(linha[col("Tipo de registro")], "Registro de sessão");
    assert.equal(linha[col("Ressalva")], "Não é parecer de conformidade");
  });
});

test("contagens saem como inteiro e a folga com duas casas", function () {
  var M = carregar();
  M.H.registrar(configuracoes(M)[0]);
  var xml = abrirPacote(M.P.gerarBytes(M.H.abaDaPlanilha()))["xl/worksheets/sheet1.xml"];
  var estilos = abrirPacote(M.P.gerarBytes(M.H.abaDaPlanilha()))["xl/styles.xml"];

  assert.ok(/<c r="A2" s="4"><v>1<\/v><\/c>/.test(xml), "número da análise com estilo inteiro");
  assert.ok(estilos.indexOf('<cellXfs count="5">') > 0);
  assert.ok(estilos.indexOf('numFmtId="1"') > 0);
});

test("conformidade com histórico: duas abas, a da análise primeiro", function () {
  var M = carregar();
  var cfgs = configuracoes(M);
  cfgs.forEach(function (c) { M.H.registrar(c); });
  var pontos = M.LP.todosOsPontos(M.LP.fonte(cfgs[0]));

  var pacote = abrirPacote(M.P.gerarBytes({ abas: [
    { aba: "Conformidade", colunas: [{ titulo: "Componente", tipo: "texto", valor: function (p) { return p.TC_Name; } }],
      linhas: M.LP.reprovados(pontos) },
    M.H.abaDaPlanilha()
  ] }));

  assert.ok(pacote["xl/worksheets/sheet1.xml"]);
  assert.ok(pacote["xl/worksheets/sheet2.xml"]);
  assert.ok(pacote["xl/workbook.xml"].indexOf('name="Conformidade" sheetId="1" r:id="rId1"') > 0);
  assert.ok(pacote["xl/workbook.xml"].indexOf('name="Histórico da sessão" sheetId="2" r:id="rId2"') > 0);
  assert.ok(pacote["xl/_rels/workbook.xml.rels"].indexOf('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"') > 0);
  assert.ok(pacote["[Content_Types].xml"].indexOf("/xl/worksheets/sheet2.xml") > 0);
  assert.ok(pacote["xl/worksheets/sheet1.xml"].indexOf('tabSelected="1"') > 0);
  assert.equal(pacote["xl/worksheets/sheet2.xml"].indexOf('tabSelected="1"'), -1, "só uma aba selecionada");
  assert.equal(linhasDaAba(pacote["xl/worksheets/sheet2.xml"]).length, cfgs.length + 1);
});

test("nomes de aba repetidos ou longos demais não quebram a pasta", function () {
  var M = carregar();
  var col = [{ titulo: "A", tipo: "texto", valor: function (l) { return l; } }];
  var pasta = abrirPacote(M.P.gerarBytes({ abas: [
    { aba: "Um nome de aba muito maior que trinta e um caracteres", colunas: col, linhas: ["x"] },
    { aba: "Um nome de aba muito maior que trinta e um caracteres", colunas: col, linhas: ["y"] },
    { aba: "Com/barra:e[colchete]", colunas: col, linhas: ["z"] }
  ] }))["xl/workbook.xml"];
  var nomes = (pasta.match(/name="([^"]+)"/g) || []).map(function (m) { return m.slice(6, -1); });

  assert.equal(nomes.length, 3);
  assert.equal(new Set(nomes.map(function (n) { return n.toLowerCase(); })).size, 3);
  nomes.forEach(function (n) {
    assert.ok(n.length <= 31, n);
    assert.equal(/[\\/?*[\]:]/.test(n), false, n);
  });
});

/* ----- PDF ----- */

test("PDF de uma análise: estrutura válida e marcação de registro de sessão", function () {
  var M = carregar();
  var e = M.H.registrar(configuracoes(M)[0]);
  var paginas = abrirPdf(M.R.analise(M.H.analise(e)).bytes());
  var texto = textoCorrido(paginas);

  assert.ok(paginas.length >= 2);
  // Toda folha diz o que é, para uma página solta não virar laudo.
  paginas.forEach(function (p, i) {
    var t = p.join(" ");
    assert.ok(t.indexOf("Thermal Predictor · Registro de sessão") >= 0, "cabeçalho na página " + (i + 1));
    assert.ok(t.indexOf("Registro de sessão, não é laudo formal nem parecer de conformidade") >= 0, "rodapé na página " + (i + 1));
    assert.ok(t.indexOf("Página " + (i + 1) + " de " + paginas.length) >= 0);
  });

  // O mesmo enquadramento da faixa de avisos da conformidade.
  ["Registro de sessão, não é laudo formal.", "Triagem pré-simulação.",
    "Não substitui a simulação CFD nem o ensaio físico.", "Não é parecer de conformidade.",
    "Arquitetura única.", "Valores de demonstração."].forEach(function (frase) {
    assert.ok(texto.indexOf(frase) >= 0, "aviso ausente: " + frase);
  });
  assert.ok(texto.indexOf("ANÁLISE 1 DA SESSÃO") >= 0);
});

test("PDF de uma análise: resumo e tabelas conferem com a tela, número a número", function () {
  var M = carregar();
  var cfgs = configuracoes(M);

  cfgs.forEach(function (cfg) {
    var e = M.H.registrar(cfg);
    var a = M.H.analise(e);
    var texto = textoCorrido(abrirPdf(M.R.analise(a).bytes()));
    var LP = M.LP;
    var dados = LP.fonte(cfg);
    var pontos = LP.todosOsPontos(dados);

    // Resumo executivo: o mesmo texto que a triagem monta.
    assert.ok(texto.indexOf(a.resumo.titulo) >= 0, "título do resumo");
    assert.ok(texto.indexOf(a.resumo.texto.replace(/\s+/g, " ")) >= 0, "texto do resumo");
    assert.ok(texto.indexOf("Próximo passo: " + a.resumo.proximo_passo) >= 0, "próximo passo");

    var c = LP.contarEstados(pontos);
    var n = dados.pontos.length;
    assert.ok(texto.indexOf("Acima do limite admissível " + c.acima_do_limite + " " + LP.percentual(c.acima_do_limite, n)) >= 0, "contagem acima");
    assert.ok(texto.indexOf("Dentro do limite nesta triagem " + c.dentro_do_limite + " " + LP.percentual(c.dentro_do_limite, n)) >= 0, "contagem dentro");

    // Conformidade: cada linha da tabela, com a formatação de js/conformidade.js.
    var reprovados = LP.reprovados(pontos);
    assert.ok(texto.indexOf(reprovados.length + " de " + (pontos.length - c.monitoramento) + " componentes avaliados") >= 0);
    reprovados.forEach(function (p) {
      var linha = [p.TC_Name, p.Key_Area, g2(p.temperatura_prevista_c), g2(p.limit_c), g2(p.margem_c),
        pct(p.margem_percentual), LP.traduzirEstado(p.estado, "conformidade")].join(" ");
      assert.ok(texto.indexOf(linha) >= 0, "linha da conformidade: " + linha);
    });

    // Subsistemas.
    LP.porSubsistema(pontos).forEach(function (r) {
      var linha = [r.area, LP.traduzirEstado(r.estado, "conformidade"), r.pior_ponto ? r.pior_ponto.TC_Name : "—",
        g2(r.pior_margem_c), r.contagem.acima_do_limite, r.contagem.banda_de_incerteza,
        r.contagem.dentro_do_limite, r.contagem.monitoramento].join(" ");
      assert.ok(texto.indexOf(linha) >= 0, "linha do subsistema: " + linha);
    });

    // Marketing, com uma casa como em js/marketing.js.
    LP.leiturasDeMarketing(pontos).forEach(function (l) {
      var linha = [l.tema.nome, LP.traduzirEstado(l.estado, "marketing"),
        l.pior_ponto ? l.pior_ponto.TC_Name : "—", g1(l.pior_margem_c)].join(" ");
      assert.ok(texto.indexOf(linha) >= 0, "linha do marketing: " + linha);
    });

    // Triagem: todos os pontos classificados e os monitorados.
    dados.pontos.forEach(function (p) {
      var linha = [p.TC_Name, p.Key_Area, g2(p.temperatura_prevista_c), g2(p.limit_c), g2(p.margem_c),
        pct(p.margem_percentual), p.estado_rotulo].join(" ");
      assert.ok(texto.indexOf(linha) >= 0, "linha da triagem: " + linha);
    });
    dados.monitoramento.forEach(function (p) {
      assert.ok(texto.indexOf([p.TC_Name, p.Key_Area, g2(p.temperatura_prevista_c), "Monitoramento"].join(" ")) >= 0);
    });

    // A configuração avaliada, fator a fator.
    LP.linhasDaConfiguracao(cfg).forEach(function (l) {
      assert.ok(texto.indexOf(l[0] + " " + l[1]) >= 0, "fator " + l[0]);
    });
  });
});

test("PDF do histórico: uma linha por análise, com a contagem gravada", function () {
  var M = carregar();
  var cfgs = configuracoes(M);
  cfgs.forEach(function (c) { M.H.registrar(c); });

  var analises = M.H.listar().map(M.H.analise);
  var paginas = abrirPdf(M.R.historico(analises).bytes());
  var texto = textoCorrido(paginas);

  assert.ok(texto.indexOf(cfgs.length + " análises nesta sessão") >= 0);
  assert.ok(texto.indexOf("Registro de sessão, não é laudo formal.") >= 0);

  M.H.listar().forEach(function (e) {
    var sub = e.no_historico ? "Já simulada · " + e.configuracao_id : "Configuração nova";
    var linha = [e.n, M.LP.dataLegivel(new Date(e.quando)), M.R.configuracaoCurta(e.config), sub,
      e.contagem.acima_do_limite, e.contagem.banda_de_incerteza, e.contagem.dentro_do_limite,
      e.contagem.monitoramento].join(" ");
    assert.ok(texto.indexOf(linha) >= 0, "linha do histórico: " + linha);
    assert.ok(texto.indexOf("ANÁLISE " + e.n + " DA SESSÃO") >= 0, "seção da análise " + e.n);
  });
});

test("PDF escreve acento, grau e travessão pela WinAnsi, e escapa parênteses", function () {
  var M = carregar();
  var doc = M.PDF.criar({});
  doc.paragrafo("Configuração (nova) — 12,5 °C · ação\\");
  var texto = textoCorrido(abrirPdf(doc.bytes()));

  assert.ok(texto.indexOf("Configuração (nova) — 12,5 °C · ação\\") >= 0, texto);
  assert.equal(M.PDF.literal("ã"), "(\\343)");
  assert.equal(M.PDF.literal("—"), "(\\227)");
  assert.equal(M.PDF.literal("(a)"), "(\\(a\\))");
});

test("quebra de linha respeita a largura e não perde palavra", function () {
  var M = carregar();
  var frase = "Na triagem que antecede a simulação CFD, a estimativa põe uma minoria dos pontos acima do limite.";
  var linhas = M.PDF.quebrar(frase, 120, 9, false);

  assert.ok(linhas.length > 1);
  linhas.forEach(function (l) { assert.ok(M.PDF.larguraDoTexto(l, 9, false) <= 120, l); });
  assert.equal(linhas.join(" "), frase);
});

test("tabela longa continua na página seguinte com o cabeçalho repetido", function () {
  var M = carregar();
  var doc = M.PDF.criar({});
  var linhas = [];
  for (var i = 0; i < 150; i++) linhas.push(i);
  doc.tabela({
    colunas: [
      { titulo: "Linha", tipo: "texto", valor: function (l) { return "linha " + l; } },
      { titulo: "Valor (°C)", tipo: "numero", valor: function (l) { return (l / 3).toFixed(2); } }
    ],
    linhas: linhas
  });
  var paginas = abrirPdf(doc.bytes());

  assert.ok(paginas.length >= 3);
  paginas.forEach(function (p) { assert.ok(p.indexOf("Valor (°C)") >= 0, "cabeçalho em toda página"); });
  var texto = textoCorrido(paginas);
  linhas.forEach(function (l) { assert.ok(texto.indexOf("linha " + l + " " + (l / 3).toFixed(2)) >= 0, "linha " + l); });
});
