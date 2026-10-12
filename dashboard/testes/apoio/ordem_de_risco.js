/* Ordem da lista principal da triagem com os empates desfeitos pelo identificador.
 *
 * A lista vem ordenada por estado e depois por folga, e a folga chega arredondada a duas
 * casas: dois pontos com a mesma folga arredondada não têm ordem definida entre si. Os testes
 * que comparam duas listas ponto a ponto passam as duas por aqui antes.
 */

"use strict";

function desempatar(lista) {
  var saida = lista.slice();
  var inicio = 0;
  while (inicio < saida.length) {
    var fim = inicio + 1;
    while (fim < saida.length && saida[fim].estado === saida[inicio].estado &&
      saida[fim].margem_c === saida[inicio].margem_c) fim++;
    var empatados = saida.slice(inicio, fim).sort(function (x, y) {
      return x.measurement_id < y.measurement_id ? -1 : 1;
    });
    Array.prototype.splice.apply(saida, [inicio, fim - inicio].concat(empatados));
    inicio = fim;
  }
  return saida;
}

module.exports = desempatar;
