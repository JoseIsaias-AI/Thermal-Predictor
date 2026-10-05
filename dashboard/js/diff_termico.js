/* Diferença térmica ponto a ponto entre duas configurações.
 *
 * Sem DOM: a tela de comparação chama, os testes em dashboard/testes/ também.
 *
 * Não há predição nova aqui. As temperaturas são as de `t` em
 * js/dados_comparacao.js, a mesma camada que a tela já exibe (CFG-19
 * reproduz a triagem ponto a ponto); a diferença é B − A sobre esses dois
 * vetores, nada além de uma subtração por ponto. Estado e folga vêm prontos
 * no dado e só entram no modo absoluto: a diferença não tem estado.
 */

var DIFF_TERMICO = (function () {
  "use strict";

  // Abaixo disto, em módulo, a diferença é desprezível e fica no neutro.
  var LIMIAR_C = 0.5;
  // Menor extremo da escala: um par quase igual não satura a rampa.
  var PISO_C = 5;
  // Degraus finos: arredondar 130 para 200 gastaria um terço da rampa sem dado.
  var PASSOS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

  // Extremo "redondo" acima do valor, para a legenda ler números inteiros.
  function arredondarAcima(v) {
    var base = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    for (var i = 0; i < PASSOS.length; i++) if (PASSOS[i] * base >= v - 1e-9) return PASSOS[i] * base;
    return 10 * base;
  }

  /* Ordem dos termopares na lista: a de severidade da triagem na configuração
     de referência. O lugar no 3D não depende dela — `FOGAO.posicionarPontos`
     tem posição fixa por termopar —, e A, B e a diferença põem o mesmo
     termopar no mesmo lugar. */
  function ordem(D, cfg) {
    var idx = D.pontos.map(function (_, i) { return i; });
    var com = idx.filter(function (i) { return !D.pontos[i].mono; });
    var sem = idx.filter(function (i) { return D.pontos[i].mono; });
    com.sort(function (i, j) { return cfg.e[i] - cfg.e[j] || cfg.m[i] - cfg.m[j]; });
    return com.concat(sem);
  }

  // Ponto no formato de js/dados_triagem.js, lido da configuração sem recalcular nada.
  function ponto(D, cfg, i) {
    var p = D.pontos[i];
    return {
      measurement_id: p.id,
      TC_Name: p.nome,
      Key_Area: p.area,
      temperatura_prevista_c: cfg.t[i],
      limit_c: p.limite,
      is_monitor_only: p.mono,
      margem_c: p.mono ? null : cfg.m[i],
      margem_percentual: p.mono ? null : cfg.m[i] / p.limite,
      estado: D.estados[cfg.e[i]][0],
      estado_rotulo: D.estados[cfg.e[i]][1]
    };
  }

  /* Payload de uma configuração no formato da triagem, para o painel de peça
     do modo absoluto. `ref` fixa a ordem dos pontos no 3D; os classificados
     seguem na ordem de severidade da própria configuração, que é a que o
     painel usa para escolher o ponto que governa a peça. */
  function dadosDaConfig(D, cfg, ref) {
    var pontos = ordem(D, ref || cfg).map(function (i) { return ponto(D, cfg, i); });
    var proprios = ordem(D, cfg).map(function (i) { return ponto(D, cfg, i); });
    return {
      tolerancia_fracao: D.tolerancia_fracao,
      pontos: proprios.filter(function (p) { return !p.is_monitor_only; }),
      monitoramento: proprios.filter(function (p) { return p.is_monitor_only; }),
      campo: pontos
    };
  }

  /* Uma linha por termopar, os 78: monitorados também, porque temperatura
     eles têm — o que não têm é limite e estado, e a diferença não usa nenhum
     dos dois. */
  function diferenca(D, cfgA, cfgB) {
    return ordem(D, cfgA).map(function (i) {
      var p = D.pontos[i], a = cfgA.t[i], b = cfgB.t[i];
      return {
        measurement_id: p.id,
        TC_Name: p.nome,
        Key_Area: p.area,
        is_monitor_only: p.mono,
        a: a,
        b: b,
        diferenca_c: b - a,
        // O 3D interpola `diferenca_c`; a temperatura de B segue movendo o fluxo de ar.
        temperatura_prevista_c: b
      };
    });
  }

  /* Escala do par: simétrica, com o extremo no maior módulo arredondado para
     cima e nunca abaixo do piso. Assim a mesma diferença em graus tem a mesma
     cor enquanto o extremo for o mesmo, e a legenda diz qual é. */
  function escala(linhas) {
    var maior = 0;
    linhas.forEach(function (l) { maior = Math.max(maior, Math.abs(l.diferenca_c)); });
    var extremo = Math.max(PISO_C, arredondarAcima(Math.max(maior, 1e-6)));
    return { extremo: extremo, limiar: LIMIAR_C, maiorModulo: maior };
  }

  function sentido(d) {
    return Math.abs(d) <= LIMIAR_C ? "igual" : d > 0 ? "mais_quente" : "mais_frio";
  }

  return {
    LIMIAR_C: LIMIAR_C,
    PISO_C: PISO_C,
    ordem: ordem,
    dadosDaConfig: dadosDaConfig,
    diferenca: diferenca,
    escala: escala,
    sentido: sentido,
    arredondarAcima: arredondarAcima
  };
})();
