/* Tela de engenharia: resumo executivo, estatísticas da base e desempenho do modelo final.
 *
 * Nenhum número é fixo nesta tela. O resumo executivo sai da mesma fonte da tela de
 * triagem; o desempenho do modelo e as estatísticas da base vêm da API (GET /desempenho),
 * por desempenho_modelo.js e estatisticas_base.js.
 */

(function () {
  "use strict";

  /* ----- Modo executivo -----
   *
   * O resumo da triagem para a configuração da URL, pela mesma fonte da tela
   * de triagem. Aqui ele é leitura, não apuração: nada se recalcula. */
  function resumoExecutivo() {
    var alvo = document.getElementById("resumo-exec");
    if (alvo && typeof RESUMO_EXECUTIVO !== "undefined" && typeof DADOS_TRIAGEM !== "undefined") {
      var config = LEITURA_PUBLICOS.configuracaoDaUrl() || DADOS_TRIAGEM.configuracao;
      RESUMO_EXECUTIVO.montar(alvo, LEITURA_PUBLICOS.fonte(), { configuracao: config, prioridades: 3 });
    }
    if (typeof MODO_LEITURA !== "undefined") MODO_LEITURA.iniciar();
  }

  resumoExecutivo();

  // Uma leitura da API só: o desempenho monta o seu painel e entrega a resposta às
  // estatísticas da base, que vêm no mesmo corpo.
  if (typeof DESEMPENHO_MODELO !== "undefined") {
    DESEMPENHO_MODELO.iniciar({
      aoMontar: function (dados) {
        if (typeof ESTATISTICAS_BASE !== "undefined") ESTATISTICAS_BASE.montar(dados);
      }
    });
  }
})();
