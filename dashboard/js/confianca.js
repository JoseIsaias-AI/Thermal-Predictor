/* Confiança da previsão por ponto de medição — STUB.
 *
 * O preditor desta versão não estima incerteza (RN-08). Tudo que este módulo
 * devolve é PLACEHOLDER: um nível atribuído ao ponto por sorteio fixo, sem
 * estatística, sem relação com temperatura, limite ou estado de risco. Existe
 * para a interface (cartão e halo) ficar pronta antes da métrica real.
 *
 * Ponto único de substituição: `obterConfiancaStub`. Quando houver métrica,
 * troca-se o corpo dessa função (ou a função inteira) por uma que leia o valor
 * vindo do preditor e devolva o mesmo contrato, com `origem: "modelo"` e
 * `ilustrativo: false`. Cartão, halo e rótulo leem só o contrato — o aviso de
 * "ilustrativo" some sozinho, sem mexer na tela.
 *
 * Contrato (objeto congelado):
 *   nivel        "alta" | "media" | "baixa"
 *   rotulo       texto do nível para a interface
 *   valor        confiança em [0, 1]
 *   incerteza    1 − valor, em [0, 1]; é o que o halo desenha
 *   origem       "stub" | "modelo"
 *   ilustrativo  true enquanto o valor não vier de métrica validada
 */

var CONFIANCA = (function () {
  "use strict";

  // Valores fixos e arbitrários por nível. Não são calibrados contra nada.
  var NIVEIS = {
    alta: { rotulo: "Alta", valor: 0.85 },
    media: { rotulo: "Média", valor: 0.6 },
    baixa: { rotulo: "Baixa", valor: 0.35 }
  };
  var ORDEM = ["alta", "media", "baixa"];

  // FNV-1a de 32 bits: o mesmo ponto recebe o mesmo nível em toda carga.
  function hash(texto) {
    var h = 0x811c9dc5;
    for (var i = 0; i < texto.length; i++) {
      h ^= texto.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  function contrato(nivel, valor, origem) {
    return Object.freeze({
      nivel: nivel,
      rotulo: NIVEIS[nivel].rotulo,
      valor: valor,
      incerteza: 1 - valor,
      origem: origem,
      ilustrativo: origem !== "modelo"
    });
  }

  /* PONTO DE SUBSTITUIÇÃO (mock → métrica real).
     Sorteia pelo id do ponto e mais nada: não lê temperatura, limite, folga
     nem estado, para o stub não parecer derivado do risco. */
  function obterConfiancaStub(ponto) {
    var nivel = ORDEM[hash(String(ponto.measurement_id)) % ORDEM.length];
    return contrato(nivel, NIVEIS[nivel].valor, "stub");
  }

  /* Raio do halo em unidades de marcador (o marcador tem raio ~1). Afim na
     incerteza: começa fora do anel de seleção, que chega a 1,95, e cresce
     com a incerteza. Compartilhado pelo 3D e pelo glifo do cartão. */
  var RAIO_MIN = 2.4, RAIO_POR_INCERTEZA = 4;
  function raioHalo(conf) {
    return RAIO_MIN + RAIO_POR_INCERTEZA * Math.max(0, Math.min(1, conf.incerteza));
  }

  return {
    NIVEIS: NIVEIS,
    ORDEM: ORDEM,
    doPonto: obterConfiancaStub,
    raioHalo: raioHalo
  };
})();
