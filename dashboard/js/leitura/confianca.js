/* Confiança da previsão por ponto, a partir do MAE de teste do modelo da área
 * (GET /modelos, guardado em MODELOS_API).
 *
 *   faixa provável  previsto ± MAE
 *   nível           alto se |folga| ≥ 2 × MAE, médio se ≥ 1 × MAE, baixo abaixo disso
 *
 * AC Blower Inlet sai como "sem modelo validado"; ponto sem limite (RN-03) tem faixa e
 * não tem nível. A confiança não altera o estado de risco da RN-01. Não mede
 * extrapolação para configuração fora do histórico (RN-08).
 *
 * Contrato (objeto congelado): nivel, rotulo, mae_c, faixa_c, folga_em_mae, incerteza.
 */

var CONFIANCA = (function () {
  "use strict";

  var NIVEIS = {
    alta: { rotulo: "Alta", incerteza: 0.15 },
    media: { rotulo: "Média", incerteza: 0.4 },
    baixa: { rotulo: "Baixa", incerteza: 0.7 },
    sem_modelo: { rotulo: "Sem modelo validado", incerteza: 1 },
    sem_limite: { rotulo: "Sem limite declarado", incerteza: 0 },
    desconhecida: { rotulo: "Métrica indisponível", incerteza: 0 }
  };

  // Os três níveis calculados, do mais ao menos confiável.
  var ORDEM = ["alta", "media", "baixa"];

  // Quantos MAE de folga cada nível exige.
  var LIMIARES = { alta: 2, media: 1 };

  function modelosPublicados(modelos) {
    if (modelos) return modelos;
    return typeof window !== "undefined" && window.MODELOS_API ? window.MODELOS_API : null;
  }

  /* O modelo que previu o ponto, na lista de `GET /modelos`, ou null. */
  function modeloDoPonto(ponto, modelos) {
    var lista = (modelosPublicados(modelos) || {}).modelos || [];
    var achado = null;

    lista.forEach(function (m) {
      if (m && m.subsistema === ponto.subsistema_modelo) achado = m;
    });

    return achado;
  }

  function contrato(nivel, extra) {
    extra = extra || {};
    return Object.freeze({
      nivel: nivel,
      rotulo: NIVEIS[nivel].rotulo,
      mae_c: extra.mae_c === undefined ? null : extra.mae_c,
      faixa_c: extra.faixa_c || null,
      folga_em_mae: extra.folga_em_mae === undefined ? null : extra.folga_em_mae,
      incerteza: NIVEIS[nivel].incerteza
    });
  }

  function nivelDaFolga(folga, mae) {
    var razao = Math.abs(folga) / mae;
    if (razao >= LIMIARES.alta) return "alta";
    if (razao >= LIMIARES.media) return "media";
    return "baixa";
  }

  /* Confiança de um ponto. `modelos` é a resposta de `GET /modelos`; sem ela,
     vale a que a sessão guardou. */
  function doPonto(ponto, modelos) {
    if (!ponto) return contrato("desconhecida");

    var publicados = modelosPublicados(modelos);
    if (!publicados) return contrato("desconhecida");

    var modelo = modeloDoPonto(ponto, publicados);
    if (!modelo) return contrato("desconhecida");

    var mae = modelo.metricas && modelo.metricas.mae_c;

    if (modelo.validado === false || typeof mae !== "number" || !(mae > 0)) {
      return contrato("sem_modelo");
    }

    var t = ponto.temperatura_prevista_c;
    var faixa = typeof t === "number" ? [t - mae, t + mae] : null;

    if (ponto.is_monitor_only || typeof ponto.margem_c !== "number") {
      return contrato("sem_limite", { mae_c: mae, faixa_c: faixa });
    }

    return contrato(nivelDaFolga(ponto.margem_c, mae), {
      mae_c: mae,
      faixa_c: faixa,
      folga_em_mae: Math.abs(ponto.margem_c) / mae
    });
  }

  /* Raio do halo em unidades de marcador (o marcador tem raio ~1). Afim na
     incerteza: começa fora do anel de seleção, que chega a 1,95, e cresce
     com a incerteza. Sem incerteza calculada, não há halo. Compartilhado pelo
     3D e pelo glifo do cartão. */
  var RAIO_MIN = 2.4, RAIO_POR_INCERTEZA = 4;
  function raioHalo(conf) {
    if (!conf || !(conf.incerteza > 0)) return 0;
    return RAIO_MIN + RAIO_POR_INCERTEZA * Math.max(0, Math.min(1, conf.incerteza));
  }

  return {
    NIVEIS: NIVEIS,
    ORDEM: ORDEM,
    LIMIARES: LIMIARES,
    modeloDoPonto: modeloDoPonto,
    doPonto: doPonto,
    raioHalo: raioHalo
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CONFIANCA;
