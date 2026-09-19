/* Leitura da triagem para os públicos que consomem o resultado sem operar o
 * painel: conformidade (RF-23, RF-24), design (RF-25, RF-26) e marketing
 * (RF-27, RF-28).
 *
 * Nenhuma tela que lê daqui recalcula estado de risco: RN-01 já foi aplicado
 * na origem e `estado` vem pronto em cada ponto, como em js/triagem.js. O que
 * este módulo faz é recortar, agrupar e traduzir.
 *
 * Ponto único de substituição: `fonte`. Quando existir o endpoint de predição,
 * troca-se o corpo dela e as telas seguem sem alteração.
 */

var LEITURA_PUBLICOS = (function () {
  "use strict";

  var PUBLICOS = ["conformidade", "design", "marketing"];

  // Mesma ordem de severidade de js/triagem.js, com monitoramento no fim por
  // não ter estado de risco (RN-03), e não por ser o menos grave.
  var ORDEM_ESTADOS = ["acima_do_limite", "banda_de_incerteza", "dentro_do_limite", "monitoramento"];

  // Subsistemas que a pessoa encosta: manípulos e console. Recorte da tela de
  // design (RF-25).
  var AREAS_DE_CONTATO = ["CT Knobs", "Oven HMI"];

  // Os dois únicos fatores sob influência do design (Seção 4.1.6, RF-26).
  var FATORES_DE_DESIGN = ["deflector_hole", "material_coil_support"];

  // Os seis fatores diretamente categóricos que RN-05 compara com o histórico;
  // `losses` fica fora por ser composto.
  var FATORES_CATEGORICOS = [
    "blower_direction", "housing", "board_position",
    "run_case", "deflector_hole", "material_coil_support"
  ];

  var ROTULO_CANONICO = {
    acima_do_limite: "Acima do limite",
    banda_de_incerteza: "Banda de incerteza",
    dentro_do_limite: "Dentro do limite",
    monitoramento: "Monitoramento"
  };

  /* Fonte única do vocabulário das três telas (RNF-07). Nenhum rótulo de
     `dentro_do_limite` diz aprovado: RN-07 proíbe ler qualquer estado como
     conformidade verificada. */
  var ROTULOS = {
    conformidade: {
      acima_do_limite: "Acima do limite admissível",
      banda_de_incerteza: "Inconclusivo, encaminhar à verificação",
      dentro_do_limite: "Dentro do limite nesta triagem",
      monitoramento: "Sem limite declarado"
    },
    design: {
      acima_do_limite: "Não viável",
      banda_de_incerteza: "A verificar com a engenharia",
      dentro_do_limite: "Viável nesta triagem",
      monitoramento: "Sem leitura"
    },
    marketing: {
      acima_do_limite: "Ainda não dá para comunicar",
      banda_de_incerteza: "Aguarda verificação",
      dentro_do_limite: "Pode comunicar, sujeito a verificação",
      monitoramento: "Sem leitura"
    }
  };

  function indiceEstado(estado) {
    var i = ORDEM_ESTADOS.indexOf(estado);
    return i < 0 ? ORDEM_ESTADOS.length : i;
  }

  // Global de js/dados_triagem.js hoje; amanhã, a resposta da API.
  function fonte() {
    return typeof DADOS_TRIAGEM === "undefined" ? null : DADOS_TRIAGEM;
  }

  // Classificados e monitorados na mesma lista, para quem precisa dos 78.
  function todosOsPontos(dados) {
    if (!dados) return [];
    return (dados.pontos || []).concat(dados.monitoramento || []);
  }

  /* Ordena por gravidade e, dentro dela, pela folga mais apertada. Monitorados
     não têm folga e vão para o fim sem disputar posição. */
  function ordenarPorRisco(pontos) {
    return pontos.slice().sort(function (a, b) {
      var d = indiceEstado(a.estado) - indiceEstado(b.estado);
      if (d !== 0) return d;
      if (a.margem_c === null || a.margem_c === undefined) return 1;
      if (b.margem_c === null || b.margem_c === undefined) return -1;
      return a.margem_c - b.margem_c;
    });
  }

  /* Os pontos que reprovam ou que não se pode declarar (RF-24). A banda de
     incerteza entra porque inconclusivo também trava a decisão de validação. */
  function reprovados(pontos) {
    return ordenarPorRisco(pontos.filter(function (p) {
      return p.estado === "acima_do_limite" || p.estado === "banda_de_incerteza";
    }));
  }

  /* RN-02: a severidade do conjunto é o pior estado entre os pontos avaliados,
     nunca média nem contagem. Monitorados só respondem quando não há nenhum
     ponto avaliado no conjunto. */
  function severidade(pontos) {
    var pior = null;
    var temMonitorado = false;

    pontos.forEach(function (p) {
      if (p.estado === "monitoramento") { temMonitorado = true; return; }
      if (pior === null || indiceEstado(p.estado) < indiceEstado(pior)) pior = p.estado;
    });

    if (pior !== null) return pior;
    return temMonitorado ? "monitoramento" : null;
  }

  function contarEstados(pontos) {
    var contagem = {};
    ORDEM_ESTADOS.forEach(function (e) { contagem[e] = 0; });
    pontos.forEach(function (p) {
      if (contagem[p.estado] !== undefined) contagem[p.estado] += 1;
    });
    return contagem;
  }

  /* Agrupa pelos sete subsistemas e resume cada um por RN-02, com o ponto que
     sustenta a severidade junto: subsistema crítico sem o componente que o
     tornou crítico obrigaria a voltar à tabela da triagem. */
  function porSubsistema(pontos) {
    var ordem = [];
    var grupos = {};

    pontos.forEach(function (p) {
      if (!grupos[p.Key_Area]) { grupos[p.Key_Area] = []; ordem.push(p.Key_Area); }
      grupos[p.Key_Area].push(p);
    });

    var resumos = ordem.map(function (area) {
      var doGrupo = ordenarPorRisco(grupos[area]);
      var avaliados = doGrupo.filter(function (p) { return p.estado !== "monitoramento"; });

      return {
        area: area,
        estado: severidade(doGrupo),
        contagem: contarEstados(doGrupo),
        total: doGrupo.length,
        total_avaliados: avaliados.length,
        pior_ponto: avaliados.length ? avaliados[0] : null,
        pior_margem_c: avaliados.length ? avaliados[0].margem_c : null
      };
    });

    return resumos.sort(function (a, b) {
      var d = indiceEstado(a.estado) - indiceEstado(b.estado);
      if (d !== 0) return d;
      if (a.pior_margem_c === null) return 1;
      if (b.pior_margem_c === null) return -1;
      return a.pior_margem_c - b.pior_margem_c;
    });
  }

  // Recorte da tela de design: só o que a pessoa toca.
  function pecasDeContato(pontos) {
    return ordenarPorRisco(pontos.filter(function (p) {
      return AREAS_DE_CONTATO.indexOf(p.Key_Area) >= 0;
    }));
  }

  /* Rótulo do estado no vocabulário do público. Cai no rótulo canônico quando
     falta mapeamento, para a tela nunca exibir vazio; é o teste que cobra a
     tabela completa. */
  function traduzirEstado(estado, publico) {
    var tabela = ROTULOS[publico];
    if (tabela && tabela[estado]) return tabela[estado];
    return ROTULO_CANONICO[estado] || "—";
  }

  function mesmaConfiguracao(a, b) {
    if (!a || !b) return false;
    return FATORES_CATEGORICOS.every(function (chave) { return a[chave] === b[chave]; });
  }

  /* RN-05: a consulta consta do histórico de rodadas ou é nova. É o que
     marketing precisa antes de prometer (RF-28) e o que validação anexa ao
     registro (RF-23).
     `data_base_treino` fica nulo até existir modelo treinado: a tela mostra o
     traço, não uma data inventada (RF-18, RNF-06). */
  function maturidade(dados, catalogo) {
    var cfg = dados && dados.configuracao;
    var lista = (catalogo && catalogo.configuracoes) ||
      (typeof DADOS_COMPARACAO === "undefined" ? [] : DADOS_COMPARACAO.configuracoes) || [];

    var achada = null;
    lista.forEach(function (c) {
      if (!achada && mesmaConfiguracao(cfg, c.fatores)) achada = c;
    });

    return {
      no_historico: achada !== null,
      configuracao_id: achada ? achada.id : null,
      rodadas: achada ? achada.rodadas : 0,
      versao_modelo: (dados && dados.versao_modelo) || null,
      data_base_treino: (dados && dados.data_base_treino) || null,
      ilustrativo: !dados || dados.preditor_e_stub !== false
    };
  }

  // Vírgula decimal, como o resto do painel já exibe em pt-BR.
  function numero(valor, casas) {
    if (valor === null || valor === undefined) return "";
    return valor.toFixed(casas === undefined ? 2 : casas).replace(".", ",");
  }

  function celula(valor) {
    var texto = valor === null || valor === undefined ? "" : String(valor);
    if (/["\r\n;]/.test(texto)) return '"' + texto.replace(/"/g, '""') + '"';
    return texto;
  }

  /* CSV do resultado da consulta em curso, e só dele (RNF-05). O preâmbulo em
     `#` carrega o rótulo que RF-22 exige: sem ele o arquivo circula solto e
     vira a evidência formal que RF-16 nega emitir. Separador `;` porque a
     vírgula já é o decimal. */
  function paraCsv(linhas, colunas, preambulo) {
    var partes = (preambulo || []).map(function (linha) { return "# " + linha; });

    partes.push(colunas.map(function (c) { return celula(c.titulo); }).join(";"));
    linhas.forEach(function (linha) {
      partes.push(colunas.map(function (c) { return celula(c.valor(linha)); }).join(";"));
    });

    return partes.join("\r\n") + "\r\n";
  }

  /* Sem acento no preâmbulo: ele atravessa planilha, editor de texto e anexo
     de e-mail, e é o rótulo que não pode chegar ilegível do outro lado. */
  function preambuloDeRegistro(mat) {
    return [
      "Thermal Predictor - registro de trabalho, nao e evidencia de conformidade (RF-22, RF-16)",
      "Triagem pre-simulacao: nao substitui a simulacao por dinamica de fluidos computacional (RF-15)",
      "Arquitetura unica coberta pela base; sem distincao entre mercados (RN-06)",
      "Modelo: " + ((mat && mat.versao_modelo) || "-") +
        " | data-base do treino: " + ((mat && mat.data_base_treino) || "nao declarada"),
      "Configuracao: " + (mat && mat.no_historico
        ? "consta do historico de rodadas (" + mat.configuracao_id + ")"
        : "fora do historico de rodadas"),
      "Gerado em: " + new Date().toISOString()
    ];
  }

  // Só aqui há DOM; `paraCsv` fica puro para o teste.
  function baixarCsv(nomeArquivo, texto) {
    // BOM: sem ele o Excel lê os acentos como ruído.
    var url = URL.createObjectURL(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }));
    var a = document.createElement("a");

    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    PUBLICOS: PUBLICOS,
    ORDEM_ESTADOS: ORDEM_ESTADOS,
    AREAS_DE_CONTATO: AREAS_DE_CONTATO,
    FATORES_DE_DESIGN: FATORES_DE_DESIGN,
    ROTULO_CANONICO: ROTULO_CANONICO,
    ROTULOS: ROTULOS,

    fonte: fonte,
    todosOsPontos: todosOsPontos,
    ordenarPorRisco: ordenarPorRisco,
    reprovados: reprovados,
    severidade: severidade,
    contarEstados: contarEstados,
    porSubsistema: porSubsistema,
    pecasDeContato: pecasDeContato,
    traduzirEstado: traduzirEstado,
    maturidade: maturidade,
    numero: numero,
    paraCsv: paraCsv,
    preambuloDeRegistro: preambuloDeRegistro,
    baixarCsv: baixarCsv
  };
})();
