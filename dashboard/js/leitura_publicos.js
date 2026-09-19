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

  /* ----- Leitura do histórico para a tela de design -----
   *
   * As funções abaixo leem js/dados_comparacao.js, que traz as configurações
   * já rodadas. São leitura observacional: as rodadas não variam um fator de
   * cada vez, então o que sai daqui é o que se viu na base, e não o efeito
   * isolado de um fator. A tela diz isso em palavras. */

  // Posição, em `catalogo.pontos`, dos pontos de contato com limite declarado.
  function indicesDeContato(catalogo) {
    var indices = [];
    (catalogo.pontos || []).forEach(function (ponto, i) {
      if (!ponto.mono && AREAS_DE_CONTATO.indexOf(ponto.area) >= 0) indices.push(i);
    });
    return indices;
  }

  function codigoDoEstado(catalogo, indice) {
    var par = (catalogo.estados || [])[indice];
    return par ? par[0] : null;
  }

  /* Resume as peças de contato de uma configuração do histórico. Mesma regra de
     RN-02 da triagem: pior estado, com o ponto que o sustenta. */
  function leituraDeContato(catalogo, configuracao, indices) {
    var alvos = indices || indicesDeContato(catalogo);
    var contagem = {};
    ORDEM_ESTADOS.forEach(function (e) { contagem[e] = 0; });

    var pior = null;
    var piorMargem = null;
    var piorPonto = null;

    alvos.forEach(function (i) {
      var estado = codigoDoEstado(catalogo, configuracao.e[i]);
      var margem = configuracao.m[i];
      if (contagem[estado] !== undefined) contagem[estado] += 1;
      if (estado === "monitoramento" || margem === null) return;

      if (pior === null || indiceEstado(estado) < indiceEstado(pior) ||
          (estado === pior && margem < piorMargem)) {
        pior = estado;
        piorMargem = margem;
        piorPonto = catalogo.pontos[i];
      }
    });

    return {
      estado: pior,
      pior_margem_c: piorMargem,
      pior_ponto: piorPonto,
      contagem: contagem,
      total: alvos.length
    };
  }

  /* O que se observou nas peças de contato para cada nível de um fator. Só os
     fatores que o design controla passam por aqui. */
  function efeitoDoFator(catalogo, chave) {
    var indices = indicesDeContato(catalogo);
    var ordem = [];
    var porNivel = {};

    (catalogo.configuracoes || []).forEach(function (config) {
      var nivel = config.fatores[chave];
      if (nivel === undefined || nivel === null) return;

      if (!porNivel[nivel]) {
        porNivel[nivel] = { nivel: nivel, configuracoes: 0, rodadas: 0, pior_margem_c: null, pior_ponto: null, estado: null, criticas: 0 };
        ordem.push(nivel);
      }

      var resumo = porNivel[nivel];
      var leitura = leituraDeContato(catalogo, config, indices);

      resumo.configuracoes += 1;
      resumo.rodadas += config.rodadas || 0;
      if (leitura.estado === "acima_do_limite") resumo.criticas += 1;

      if (leitura.pior_margem_c !== null &&
          (resumo.pior_margem_c === null || leitura.pior_margem_c < resumo.pior_margem_c)) {
        resumo.pior_margem_c = leitura.pior_margem_c;
        resumo.pior_ponto = leitura.pior_ponto;
        resumo.estado = leitura.estado;
      }
    });

    return ordem.map(function (nivel) { return porNivel[nivel]; });
  }

  /* As alternativas que mudam só o que o design decide: os outros quatro
     fatores categóricos ficam parados e variam apenas a abertura do defletor e
     o material do suporte. É a comparação que se lê sem pedir tradução, porque
     a diferença entre as linhas é a escolha do próprio design.

     Agrupa por par de fatores: rodadas que diferem só no arranjo de bobinas
     descrevem a mesma escolha de design e viravam linhas repetidas. Dentro do
     grupo vale a mesma regra de RN-02, o pior estado. */
  function alternativasDeDesign(catalogo, fatores) {
    var fixos = FATORES_CATEGORICOS.filter(function (chave) {
      return FATORES_DE_DESIGN.indexOf(chave) < 0;
    });
    var indices = indicesDeContato(catalogo);
    var ordem = [];
    var grupos = {};

    (catalogo.configuracoes || []).forEach(function (config) {
      var comparavel = fixos.every(function (chave) {
        return config.fatores[chave] === (fatores || {})[chave];
      });
      if (!comparavel) return;

      var escolha = FATORES_DE_DESIGN.map(function (chave) { return config.fatores[chave]; });
      var chaveDoGrupo = escolha.join(" | ");

      if (!grupos[chaveDoGrupo]) {
        grupos[chaveDoGrupo] = {
          escolha: escolha,
          fatores: {},
          configuracoes: [],
          rodadas: 0,
          contato: null,
          igual_a_consulta: FATORES_DE_DESIGN.every(function (chave) {
            return config.fatores[chave] === (fatores || {})[chave];
          })
        };
        FATORES_DE_DESIGN.forEach(function (chave, k) { grupos[chaveDoGrupo].fatores[chave] = escolha[k]; });
        ordem.push(chaveDoGrupo);
      }

      var grupo = grupos[chaveDoGrupo];
      var leitura = leituraDeContato(catalogo, config, indices);

      grupo.configuracoes.push(config.id);
      grupo.rodadas += config.rodadas || 0;

      if (!grupo.contato || indiceEstado(leitura.estado) < indiceEstado(grupo.contato.estado) ||
          (leitura.estado === grupo.contato.estado && leitura.pior_margem_c < grupo.contato.pior_margem_c)) {
        grupo.contato = leitura;
      }
    });

    return ordem.map(function (chave) { return grupos[chave]; }).sort(function (a, b) {
      var d = indiceEstado(a.contato.estado) - indiceEstado(b.contato.estado);
      if (d !== 0) return d;
      return b.contato.pior_margem_c - a.contato.pior_margem_c;
    });
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
  function maturidade(dados, catalogo, configuracao) {
    // A configuração avaliada pode vir da querystring e ser outra que a do
    // payload; é ela que RN-05 localiza, não a do dado de exemplo.
    var cfg = configuracao || (dados && dados.configuracao);
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

  /* A configuração que a tela de consulta passou na querystring, no formato
     `fator=valor` e `losses.present=valor`. Compartilhada por triagem e
     conformidade: as duas mostram o mesmo cabeçalho de rastreabilidade. */
  function configuracaoDaUrl(busca) {
    var texto = (busca === undefined ? window.location.search : busca).replace(/^\?/, "");
    if (!texto) return null;

    var config = {};
    texto.split("&").forEach(function (par) {
      if (!par) return;
      var corte = par.indexOf("=");
      var chave = decodeURIComponent(par.slice(0, corte < 0 ? par.length : corte));
      var valor = corte < 0 ? "" : decodeURIComponent(par.slice(corte + 1).replace(/\+/g, " "));

      var partes = chave.split(".");
      if (partes.length === 1) {
        config[partes[0]] = valor;
      } else {
        if (!config[partes[0]]) config[partes[0]] = {};
        config[partes[0]][partes[1]] = valor;
      }
    });

    return Object.keys(config).length > 0 ? config : null;
  }

  /* Valor fora do vocabulário aparece cru e marcado: RN-04 manda rejeitar, não
     interpretar por aproximação. */
  function rotuloDoNivel(niveis, valor) {
    var encontrado = null;
    (niveis || []).forEach(function (nivel) {
      if (nivel.value === valor) encontrado = nivel.label;
    });
    return encontrado || valor + " (fora do vocabulário)";
  }

  /* A configuração avaliada em pares rótulo/valor, na ordem de js/schema.js.
     Nasceu em js/triagem.js e subiu para cá quando a tela de conformidade
     passou a precisar do mesmo cabeçalho de rastreabilidade (RF-23). */
  function linhasDaConfiguracao(config, esquema) {
    var fatores = ((esquema || (typeof SCHEMA === "undefined" ? null : SCHEMA)) || {}).factors || [];
    var linhas = [];

    fatores.forEach(function (fator) {
      if (fator.subfields && fator.subfields.length > 0) {
        var aninhado = (config || {})[fator.key] || {};
        fator.subfields.forEach(function (sub) {
          var valor = aninhado[sub.key];
          // Campo que não se aplica sai da lista, como sai do formulário.
          if (valor === undefined || valor === null || valor === "") return;
          linhas.push([sub.label, rotuloDoNivel(sub.levels, valor)]);
        });
        return;
      }

      var valor = (config || {})[fator.key];
      if (valor === undefined || valor === null || valor === "") return;
      linhas.push([fator.label, rotuloDoNivel(fator.levels, valor)]);
    });

    return linhas;
  }

  // Vírgula decimal, como o resto do painel já exibe em pt-BR.
  function numero(valor, casas) {
    if (valor === null || valor === undefined) return "";
    return valor.toFixed(casas === undefined ? 2 : casas).replace(".", ",");
  }

  // Data do registro no formato que quem recebe o arquivo lê, e não o de
  // máquina.
  function dataLegivel(quando) {
    function dois(n) { return (n < 10 ? "0" : "") + n; }
    return dois(quando.getDate()) + "/" + dois(quando.getMonth() + 1) + "/" + quando.getFullYear() +
      " " + dois(quando.getHours()) + ":" + dois(quando.getMinutes());
  }

  /* A procedência que acompanha cada linha do arquivo exportado. Vira coluna
     fixa, repetida em toda linha: assim nenhuma linha perde o contexto se
     alguém filtrar a planilha ou colar um trecho em outro lugar.
     Valores curtos de propósito, para caberem na largura da coluna. */
  function metadadosDoRegistro(mat) {
    return [
      ["Tipo de registro", "Registro de trabalho"],
      ["Natureza", "Triagem anterior à simulação"],
      ["Ressalva", "Não é parecer de conformidade"],
      ["Abrangência", "Arquitetura única, sem distinção de mercado"],
      ["Modelo", (mat && mat.versao_modelo) || "não informado"],
      ["Data-base do treino", (mat && mat.data_base_treino) || "não declarada"],
      ["Configuração", mat && mat.no_historico
        ? "Já simulada, " + mat.rodadas + (mat.rodadas === 1 ? " rodada" : " rodadas")
        : "Nova, sem rodada equivalente"],
      ["Gerado em", dataLegivel(new Date())]
    ];
  }

  /* As mesmas colunas, no formato que o gerador de planilha consome. O valor é
     constante na coluna inteira. */
  function colunasDeProcedencia(mat) {
    return metadadosDoRegistro(mat).map(function (par) {
      return {
        titulo: par[0],
        tipo: "texto",
        valor: function () { return par[1]; }
      };
    });
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
    indicesDeContato: indicesDeContato,
    leituraDeContato: leituraDeContato,
    efeitoDoFator: efeitoDoFator,
    alternativasDeDesign: alternativasDeDesign,
    traduzirEstado: traduzirEstado,
    maturidade: maturidade,
    configuracaoDaUrl: configuracaoDaUrl,
    rotuloDoNivel: rotuloDoNivel,
    linhasDaConfiguracao: linhasDaConfiguracao,
    numero: numero,
    metadadosDoRegistro: metadadosDoRegistro,
    colunasDeProcedencia: colunasDeProcedencia,
    dataLegivel: dataLegivel
  };
})();
