/* Monta, para os testes, uma previsão no formato de `POST /predicao` a partir de uma entrada
 * do catálogo de fixture. O painel não precisa disso: a API devolve a previsão pronta.
 */

"use strict";

var ORDEM_ESTADOS = ["acima_do_limite", "banda_de_incerteza", "dentro_do_limite", "monitoramento"];

function indiceEstado(estado) {
  var i = ORDEM_ESTADOS.indexOf(estado);
  return i < 0 ? ORDEM_ESTADOS.length : i;
}

// O estado vem pronto no vetor `e` do catálogo; nada é reclassificado.
function payloadDoCatalogo(catalogo, entrada) {
  var pontos = [];
  var monitorados = [];

  catalogo.pontos.forEach(function (ponto, i) {
    var par = catalogo.estados[entrada.e[i]];
    var mono = ponto.mono || par[0] === "monitoramento";
    var p = {
      measurement_id: ponto.id,
      TC_Name: ponto.nome,
      Key_Area: ponto.area,
      temperatura_prevista_c: entrada.t[i],
      limit_c: mono ? null : ponto.limite,
      is_monitor_only: mono,
      margem_c: mono ? null : entrada.m[i],
      margem_percentual: mono ? null : entrada.m[i] / ponto.limite,
      estado: par[0],
      estado_rotulo: par[1]
    };
    (mono ? monitorados : pontos).push(p);
  });

  // A ordem que a triagem espera pronta no dado: estado, depois folga.
  pontos.sort(function (a, b) {
    return indiceEstado(a.estado) - indiceEstado(b.estado) || a.margem_c - b.margem_c;
  });

  return {
    versao_modelo: catalogo.versao_modelo,
    preditor_e_stub: catalogo.preditor_e_stub,
    configuracao: entrada.fatores,
    configuracao_id: entrada.id,
    tolerancia_fracao: catalogo.tolerancia_fracao,
    pontos: pontos,
    monitoramento: monitorados,
    total_pontos: pontos.length + monitorados.length,
    total_classificados: pontos.length,
    total_monitoramento: monitorados.length
  };
}

module.exports = payloadDoCatalogo;
