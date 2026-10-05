/* Configuração segura mais próxima de uma referência, dentro do catálogo do modelo.
 *
 * Distância euclidiana na mesma codificação dos modelos (13 colunas de
 * api/predicao/codificacao.py), com cada coluna padronizada em z-score: trocar para um
 * nível raro custa mais, porque afasta a configuração do que a base cobre.
 */

var SEGURA_PROXIMA = (function () {
  "use strict";

  /* Colunas na ordem de `colunas_entrada` dos metadados em modelos/. Cada uma
     diz de que campo vem, para somar a contribuição por fator. A categoria de
     referência de cada bloco não tem coluna: é o vetor todo em zero. */
  var COLUNAS = [
    { coluna: "losses_present_missing", campo: "losses.present", valor: "missing" },
    { coluna: "losses_config_m", campo: "losses.config", valor: "Config M" },
    { coluna: "losses_order_back_order", campo: "losses.order", valor: "Back Order" },
    { coluna: "losses_order_front_order", campo: "losses.order", valor: "Front Order" },
    { coluna: "Run_Case_Broil C1", campo: "run_case", valor: "Broil C1" },
    { coluna: "Run_Case_Broil C2", campo: "run_case", valor: "Broil C2" },
    { coluna: "Run_Case_Pyro", campo: "run_case", valor: "Pyro" },
    { coluna: "Blower_Direction_To Back", campo: "blower_direction", valor: "To Back" },
    { coluna: "Housing_Open", campo: "housing", valor: "Open" },
    { coluna: "Board_Position_Right", campo: "board_position", valor: "Right" },
    { coluna: "Deflector_Hole_Open", campo: "deflector_hole", valor: "Open" },
    { coluna: "Material_Coil_Support_Aluminium Plate", campo: "material_coil_support", valor: "Aluminium Plate" },
    { coluna: "Material_Coil_Support_Plastic", campo: "material_coil_support", valor: "Plastic" }
  ];

  // Os campos na granularidade da tela: o fator composto de perdas aberto.
  var CAMPOS = ["blower_direction", "housing", "board_position", "run_case",
                "losses.present", "losses.config", "losses.order",
                "deflector_hole", "material_coil_support"];

  // Mesmo tratamento de codificacao.py: "Open - Updated" entrou como "Open".
  var SINONIMOS = { "Open - Updated": "Open" };

  function valorDoCampo(fatores, campo) {
    var corte = campo.indexOf(".");
    if (corte < 0) return fatores[campo] || "";
    var sub = fatores[campo.slice(0, corte)] || {};
    return sub[campo.slice(corte + 1)] || "";
  }

  // Arranjo e ordem só existem quando a perda foi declarada.
  function valorEfetivo(fatores, campo) {
    if ((campo === "losses.config" || campo === "losses.order") &&
        valorDoCampo(fatores, "losses.present") !== "declared") return "";
    var v = valorDoCampo(fatores, campo);
    return SINONIMOS[v] || v;
  }

  function codificar(fatores) {
    return COLUNAS.map(function (c) {
      return valorEfetivo(fatores, c.campo) === c.valor ? 1 : 0;
    });
  }

  /* μ e σ de cada coluna sobre as configurações conhecidas. Coluna constante
     (σ = 0) não separa ninguém e fica fora da soma. */
  function padronizacao(configuracoes) {
    var n = configuracoes.length;
    var vetores = configuracoes.map(function (c) { return codificar(c.fatores); });

    var mu = COLUNAS.map(function (_, j) {
      var s = 0;
      vetores.forEach(function (v) { s += v[j]; });
      return s / n;
    });

    var sigma = COLUNAS.map(function (_, j) {
      var s = 0;
      vetores.forEach(function (v) { s += (v[j] - mu[j]) * (v[j] - mu[j]); });
      return Math.sqrt(s / n);
    });

    return { mu: mu, sigma: sigma };
  }

  function padronizar(vetor, pad) {
    return vetor.map(function (x, j) {
      return pad.sigma[j] > 0 ? (x - pad.mu[j]) / pad.sigma[j] : 0;
    });
  }

  // Quadrado da diferença padronizada, somado por campo da tela.
  function contribuicoes(fatoresA, fatoresB, pad) {
    var za = padronizar(codificar(fatoresA), pad);
    var zb = padronizar(codificar(fatoresB), pad);
    var porCampo = {};
    COLUNAS.forEach(function (c, j) {
      var d = za[j] - zb[j];
      porCampo[c.campo] = (porCampo[c.campo] || 0) + d * d;
    });
    return porCampo;
  }

  function distancia(fatoresA, fatoresB, pad) {
    var porCampo = contribuicoes(fatoresA, fatoresB, pad);
    var s = 0;
    Object.keys(porCampo).forEach(function (k) { s += porCampo[k]; });
    return Math.sqrt(s);
  }


  /* ----- Classificação -----
     Segura é a configuração em que todo ponto com limite declarado está
     "dentro do limite" pelo critério de 10% — o estado já vem no dado, o
     mesmo que a triagem exibe. Pontos só monitorados (RN-03) não contam. */

  function indiceDoEstado(dados, codigo) {
    for (var k = 0; k < dados.estados.length; k++) {
      if (dados.estados[k][0] === codigo) return k;
    }
    return -1;
  }

  function pontosFora(cfg, dados) {
    var dentro = indiceDoEstado(dados, "dentro_do_limite");
    var n = 0;
    dados.pontos.forEach(function (p, i) {
      if (!p.mono && cfg.e[i] !== dentro) n++;
    });
    return n;
  }

  function ehSegura(cfg, dados) { return pontosFora(cfg, dados) === 0; }


  /* ----- Busca -----
     Na ordem da tarefa: distância para todas, filtro das seguras, ordenação.
     Empate em distância desempata pelo identificador, para a sugestão não
     depender da ordem de carga. */

  function porDistancia(a, b) {
    if (a.distancia !== b.distancia) return a.distancia - b.distancia;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  function buscar(fatoresRef, dados, idRef) {
    var cfgs = dados.configuracoes;
    var pad = padronizacao(cfgs);

    var todas = cfgs.map(function (c) {
      return {
        id: c.id,
        cfg: c,
        distancia: distancia(fatoresRef, c.fatores, pad),
        fora: pontosFora(c, dados),
        segura: ehSegura(c, dados)
      };
    });

    var seguras = todas.filter(function (x) { return x.segura && x.id !== idRef; });
    seguras.sort(porDistancia);
    todas.sort(porDistancia);

    return {
      padronizacao: pad,
      todas: todas,
      seguras: seguras,
      sugestao: seguras.length ? seguras[0] : null
    };
  }

  /* Campos em que as duas configurações discordam, do que mais pesa na
     distância ao que menos pesa. Compara o nível cru: "Open - Updated" contra
     "Open" aparece como diferença, ainda que com peso zero na distância. */
  function camposDivergentes(fatoresA, fatoresB, pad) {
    var porCampo = contribuicoes(fatoresA, fatoresB, pad);
    return CAMPOS.filter(function (campo) {
      return valorDoCampo(fatoresA, campo) !== valorDoCampo(fatoresB, campo);
    }).map(function (campo) {
      return {
        campo: campo,
        de: valorDoCampo(fatoresA, campo),
        para: valorDoCampo(fatoresB, campo),
        peso: porCampo[campo] || 0
      };
    }).sort(function (a, b) { return b.peso - a.peso; });
  }

  // Configuração conhecida com exatamente estes fatores, ou null.
  function localizar(fatores, configuracoes) {
    for (var k = 0; k < configuracoes.length; k++) {
      var c = configuracoes[k];
      var igual = CAMPOS.every(function (campo) {
        return valorDoCampo(fatores, campo) === valorDoCampo(c.fatores, campo);
      });
      if (igual) return c;
    }
    return null;
  }

  return {
    COLUNAS: COLUNAS,
    CAMPOS: CAMPOS,
    codificar: codificar,
    padronizacao: padronizacao,
    distancia: distancia,
    pontosFora: pontosFora,
    ehSegura: ehSegura,
    buscar: buscar,
    camposDivergentes: camposDivergentes,
    localizar: localizar,
    valorDoCampo: valorDoCampo
  };
})();
