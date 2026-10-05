/* Registro em PDF de uma análise da sessão, ou do histórico inteiro.
 *
 * Não tem leitura própria: o resumo é o de js/resumo_executivo.js e as tabelas
 * são as das telas de triagem, conformidade e marketing, com os mesmos
 * recortes de js/leitura_publicos.js e a mesma formatação de número de cada
 * tela. Um número que diverge da tela seria pior que não exportar.
 *
 * `analise` é o que HISTORICO_SESSAO.analise() devolve: a entrada do
 * histórico e o payload recalculado a partir da configuração.
 */

var REGISTRO_PDF = (function () {
  "use strict";

  var LP = LEITURA_PUBLICOS;
  var PDF = DOCUMENTO_PDF;
  var COR = PDF.COR;

  var CABECALHO = "Thermal Predictor · Registro de sessão";
  var RODAPE = "Registro de sessão, não é laudo formal nem parecer de conformidade · Triagem anterior à simulação CFD";

  // Casas decimais de cada tela: duas na triagem e na conformidade, uma no
  // marketing.
  function graus(valor, casas) {
    return valor === null || valor === undefined ? "—" : valor.toFixed(casas === undefined ? 2 : casas);
  }

  function percentual(fracao) {
    return fracao === null || fracao === undefined ? "—" : (fracao * 100).toFixed(1) + "%";
  }

  function folga(valor, casas) {
    return { texto: graus(valor, casas), cor: valor !== null && valor !== undefined && valor < 0 ? COR.critico : null };
  }

  function estado(e, publico) {
    return {
      texto: LP.traduzirEstado(e, publico),
      negrito: e === "acima_do_limite",
      cor: e === "acima_do_limite" ? COR.critico : (e === "banda_de_incerteza" ? COR.acento : null)
    };
  }

  function origem(mat) {
    if (mat.no_historico === null) {
      return "Histórico indisponível: o serviço não publicou o catálogo das rodadas";
    }
    if (mat.no_historico) {
      return "Já simulada · " + mat.configuracao_id + ", " + mat.rodadas +
        (mat.rodadas === 1 ? " rodada" : " rodadas") + " na base";
    }
    return "Configuração nova: nenhuma rodada da base combina esses fatores, e a leitura é extrapolação";
  }

  function criarDocumento(titulo) {
    return PDF.criar({
      titulo: titulo,
      cabecalho: CABECALHO,
      cabecalhoDireita: "Gerado em " + LP.dataLegivel(new Date()),
      rodape: RODAPE
    });
  }

  /* O mesmo enquadramento da faixa de avisos da conformidade, mais a marca de
     registro de sessão. Vem antes de qualquer número. */
  function enquadramento(doc, mat) {
    function item(forte, resto) {
      return [{ texto: forte, negrito: true, cor: COR.texto }, { texto: " " + resto }];
    }

    var itens = [
      item("Registro de sessão, não é laudo formal.",
        "Gerado a partir do histórico desta sessão do painel, que não fica salvo. Serve para acompanhar a discussão, não como documento de engenharia."),
      item("Triagem pré-simulação.",
        "A saída estima o comportamento térmico para ordenar o que simular primeiro. Não substitui a simulação CFD nem o ensaio físico."),
      item("Não é parecer de conformidade.",
        "A ferramenta não declara atendimento a norma e não gera evidência formal para auditoria ou certificação."),
      item("Arquitetura única.",
        "Esta prova de conceito cobre a arquitetura presente na base disponível, sem distinguir os requisitos de Brasil e México.")
    ];

    doc.aviso(itens, { barra: COR.acento });
  }

  function cabecalhoDaAnalise(doc, a) {
    var e = a.entrada;
    doc.sobretitulo(e.n ? "Análise " + e.n + " da sessão" : "Configuração de referência");
    doc.titulo("Resultado da triagem térmica");
    doc.paragrafo([
      { texto: e.quando ? "Analisada em " + LP.dataLegivel(new Date(e.quando)) + " · " : "" },
      { texto: "Modelo " + (a.mat.versao_modelo || "não informado") + " · " },
      { texto: "Data-base do treino " + (a.mat.data_base_treino || "não declarada") }
    ], { tamanho: 8.5, cor: COR.suave, depois: 10 });
  }

  function secaoConfiguracao(doc, a) {
    doc.secao("Configuração avaliada", origem(a.mat));
    doc.tabela({
      colunas: [
        { titulo: "Fator", tipo: "texto", valor: function (l) { return { texto: l[0], cor: COR.suave }; } },
        { titulo: "Nível", tipo: "texto", valor: function (l) { return l[1]; } }
      ],
      linhas: LP.linhasDaConfiguracao(a.entrada.config)
    });
  }

  function secaoResumo(doc, a) {
    var r = a.resumo;
    var n = r.numeros;

    doc.secao("Resumo executivo", "O mesmo texto das telas de triagem e engenharia, gerado da contagem abaixo.");
    doc.paragrafo(r.titulo, { negrito: true, tamanho: 10.5, depois: 4 });
    doc.paragrafo(r.texto);
    doc.paragrafo([{ texto: "Próximo passo:", negrito: true }, { texto: " " + r.proximo_passo }], { depois: 8 });

    doc.tabela({
      colunas: [
        { titulo: "Estado", tipo: "texto", valor: function (l) { return estado(l[0], "conformidade"); } },
        { titulo: "Pontos", tipo: "numero", valor: function (l) { return String(l[1]); } },
        { titulo: "Proporção", tipo: "numero", valor: function (l) { return l[2]; } }
      ],
      linhas: [
        ["acima_do_limite", n.acima, n.pct_acima],
        ["banda_de_incerteza", n.banda, n.pct_banda],
        ["dentro_do_limite", n.dentro, n.pct_dentro],
        ["monitoramento", n.monitorados, "—"]
      ],
      estado: function (l) { return l[0]; },
      nota: "Proporção sobre os " + n.total + " pontos com limite declarado. Pontos sem limite são só monitorados e não entram na conta."
    });
  }

  function secaoConformidade(doc, a) {
    var avaliados = a.pontos.length - a.contagem.monitoramento;
    doc.secao("Componentes que travam a decisão",
      "Conformidade · " + a.reprovados.length + " de " + avaliados + " componentes avaliados · da folga mais apertada para a menos");

    if (!a.reprovados.length) {
      doc.paragrafo("Nenhum componente acima do limite admissível ou inconclusivo nesta configuração.", { cor: COR.suave });
      return;
    }

    doc.tabela({
      colunas: [
        { titulo: "Componente", tipo: "texto", valor: function (p) { return { texto: p.TC_Name, sub: p.Key_Area }; } },
        { titulo: "Prevista (°C)", tipo: "numero", valor: function (p) { return graus(p.temperatura_prevista_c); } },
        { titulo: "Limite (°C)", tipo: "numero", valor: function (p) { return graus(p.limit_c); } },
        { titulo: "Folga (°C)", tipo: "numero", valor: function (p) { return folga(p.margem_c); } },
        { titulo: "Folga (%)", tipo: "numero", valor: function (p) {
          return { texto: percentual(p.margem_percentual), cor: p.margem_c < 0 ? COR.critico : null };
        } },
        { titulo: "Estado", tipo: "texto", valor: function (p) { return estado(p.estado, "conformidade"); } }
      ],
      linhas: a.reprovados,
      estado: function (p) { return p.estado; },
      nota: "Componentes acima do limite admissível ou inconclusivos. Os demais não aparecem aqui, o que não os declara conformes."
    });
  }

  function secaoSubsistemas(doc, a) {
    doc.secao("Onde antecipar a checagem", "Conformidade · os sete subsistemas, do mais crítico para o menos");
    doc.tabela({
      colunas: [
        { titulo: "Subsistema", tipo: "texto", valor: function (r) { return r.area; } },
        { titulo: "Estado", tipo: "texto", valor: function (r) { return estado(r.estado, "conformidade"); } },
        { titulo: "Componente que decide", tipo: "texto", valor: function (r) { return r.pior_ponto ? r.pior_ponto.TC_Name : "—"; } },
        { titulo: "Pior folga (°C)", tipo: "numero", valor: function (r) { return folga(r.pior_margem_c); } },
        { titulo: "Acima", tipo: "numero", valor: function (r) { return String(r.contagem.acima_do_limite); } },
        { titulo: "Inconclusivos", tipo: "numero", valor: function (r) { return String(r.contagem.banda_de_incerteza); } },
        { titulo: "Dentro", tipo: "numero", valor: function (r) { return String(r.contagem.dentro_do_limite); } },
        { titulo: "Monitorados", tipo: "numero", valor: function (r) { return String(r.contagem.monitoramento); } }
      ],
      linhas: a.subsistemas,
      estado: function (r) { return r.estado; },
      nota: "O estado do subsistema é o pior dos seus componentes avaliados, nunca a média."
    });
  }

  function secaoMarketing(doc, a) {
    doc.secao("Temas de comunicação", "Marketing · cada tema recebe a leitura do componente mais quente ligado a ele");
    doc.tabela({
      colunas: [
        { titulo: "Tema", tipo: "texto", valor: function (l) { return l.tema.nome; } },
        { titulo: "Leitura", tipo: "texto", valor: function (l) { return estado(l.estado, "marketing"); } },
        { titulo: "Componente que decide", tipo: "texto", valor: function (l) { return l.pior_ponto ? l.pior_ponto.TC_Name : "—"; } },
        { titulo: "Margem até o limite (°C)", tipo: "numero", valor: function (l) { return folga(l.pior_margem_c, 1); } }
      ],
      linhas: a.temas,
      estado: function (l) { return l.estado; }
    });
  }

  function secaoTriagem(doc, a) {
    var classificados = a.dados.pontos || [];
    var monitorados = a.dados.monitoramento || [];

    doc.secao("Pontos de medição ordenados por risco",
      "Triagem · " + classificados.length + " pontos classificados e " + monitorados.length + " só monitorados");
    doc.tabela({
      colunas: [
        { titulo: "Ponto de medição", tipo: "texto", valor: function (p) { return { texto: p.TC_Name, sub: p.Key_Area }; } },
        { titulo: "Prevista (°C)", tipo: "numero", valor: function (p) { return graus(p.temperatura_prevista_c); } },
        { titulo: "Limite (°C)", tipo: "numero", valor: function (p) { return graus(p.limit_c); } },
        { titulo: "Folga (°C)", tipo: "numero", valor: function (p) { return folga(p.margem_c); } },
        { titulo: "Folga (%)", tipo: "numero", valor: function (p) {
          return { texto: percentual(p.margem_percentual), cor: p.margem_c < 0 ? COR.critico : null };
        } },
        { titulo: "Estado", tipo: "texto", valor: function (p) {
          return { texto: p.estado_rotulo || LP.traduzirEstado(p.estado), negrito: p.estado === "acima_do_limite",
            cor: p.estado === "acima_do_limite" ? COR.critico : null };
        } }
      ],
      linhas: classificados,
      estado: function (p) { return p.estado; }
    });

    if (monitorados.length) {
      doc.tabela({
        colunas: [
          { titulo: "Ponto sem limite declarado", tipo: "texto", valor: function (p) { return { texto: p.TC_Name, sub: p.Key_Area }; } },
          { titulo: "Prevista (°C)", tipo: "numero", valor: function (p) { return graus(p.temperatura_prevista_c); } },
          { titulo: "Leitura", tipo: "texto", valor: function () { return { texto: "Monitoramento", cor: COR.suave }; } }
        ],
        linhas: monitorados,
        nota: "Sem limite declarado, estes pontos não recebem estado nem folga."
      });
    }
  }

  function escreverAnalise(doc, a, completa) {
    cabecalhoDaAnalise(doc, a);
    enquadramento(doc, a.mat);
    secaoConfiguracao(doc, a);
    secaoResumo(doc, a);
    secaoConformidade(doc, a);
    secaoSubsistemas(doc, a);
    secaoMarketing(doc, a);
    if (completa) secaoTriagem(doc, a);
  }

  function analise(a) {
    var doc = criarDocumento("Thermal Predictor · Análise " + (a.entrada.n || "de referência"));
    escreverAnalise(doc, a, true);
    return doc;
  }

  // Resumo da configuração numa linha, para a tabela do histórico.
  function configuracaoCurta(config) {
    return LP.linhasDaConfiguracao(config).map(function (l) { return l[1]; }).join(" · ");
  }

  /* O histórico abre com uma linha por análise e segue com cada análise numa
     página nova, sem a tabela ponto a ponto: essa sai no PDF individual. */
  function historico(analises) {
    var doc = criarDocumento("Thermal Predictor · Histórico da sessão");
    var primeira = analises[0];
    var ultima = analises[analises.length - 1];

    doc.sobretitulo("Histórico da sessão");
    doc.titulo(analises.length + (analises.length === 1 ? " análise nesta sessão" : " análises nesta sessão"));
    if (primeira) {
      doc.paragrafo("De " + LP.dataLegivel(new Date(primeira.entrada.quando)) + " a " +
        LP.dataLegivel(new Date(ultima.entrada.quando)) + " · na ordem em que foram consultadas",
        { tamanho: 8.5, cor: COR.suave, depois: 10 });
    }
    enquadramento(doc, primeira ? primeira.mat : {});

    doc.secao("Análises da sessão", "Uma linha por configuração analisada. O detalhamento de cada uma vem nas páginas seguintes.");
    doc.tabela({
      colunas: [
        { titulo: "#", tipo: "numero", valor: function (a) { return String(a.entrada.n); } },
        { titulo: "Analisada em", tipo: "texto", valor: function (a) { return LP.dataLegivel(new Date(a.entrada.quando)); } },
        { titulo: "Configuração", tipo: "texto", valor: function (a) {
          return { texto: configuracaoCurta(a.entrada.config), sub: a.mat.no_historico === null ? "Histórico indisponível" : a.mat.no_historico ? "Já simulada · " + a.mat.configuracao_id : "Configuração nova" };
        } },
        { titulo: "Acima", tipo: "numero", valor: function (a) {
          return { texto: String(a.contagem.acima_do_limite), cor: a.contagem.acima_do_limite ? COR.critico : null, negrito: a.contagem.acima_do_limite > 0 };
        } },
        { titulo: "Inconclusivos", tipo: "numero", valor: function (a) { return String(a.contagem.banda_de_incerteza); } },
        { titulo: "Dentro", tipo: "numero", valor: function (a) { return String(a.contagem.dentro_do_limite); } },
        { titulo: "Sem limite", tipo: "numero", valor: function (a) { return String(a.contagem.monitoramento); } }
      ],
      linhas: analises,
      estado: function (a) { return a.contagem.acima_do_limite ? "acima_do_limite" : null; }
    });

    analises.forEach(function (a) {
      doc.novaPagina();
      escreverAnalise(doc, a, false);
    });

    return doc;
  }

  return {
    analise: analise,
    historico: historico,
    configuracaoCurta: configuracaoCurta
  };
})();
