/* Testes das estatísticas da base na tela de engenharia.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/estatisticas_base.test.js
 *
 * A tela não calcula estatística: lê o campo `base` de `GET /desempenho` e escreve
 * os números e as frases que dependem deles. O que se prende aqui é que cada frase
 * acompanha o resultado, sobre uma base inventada no formato da API.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

var EB = require("../js/leitura/estatisticas_base.js");

function base() {
  return {
    referencia: {
      estrategia: "Média histórica do ponto, deixando de fora a rodada avaliada.",
      mae_c: 8.4321, mae_na_amostra_c: 8.1234, pontos_cobertos: 30, pontos_com_limite: 60,
      cobertura_pct: 50, cobertura_wilson_pct: [37.7, 62.3], cobertura_exigida_pct: 90
    },
    validacao: {
      rodadas: 40, configuracoes: 28, configuracoes_possiveis: 768,
      rodadas_em_configuracao_compartilhada: 18, rodadas_em_configuracao_compartilhada_pct: 45,
      distribuicao: [
        { rodadas_por_configuracao: 1, configuracoes: 22, rodadas: 22 },
        { rodadas_por_configuracao: 2, configuracoes: 3, rodadas: 6 },
        { rodadas_por_configuracao: 4, configuracoes: 3, rodadas: 12 }
      ]
    },
    procedencia: {
      pontos: 70, rodadas: 40, combinacoes: 2800, sem_leitura: 140, sem_leitura_pct: 5,
      estruturais: 100, aleatorias: 40, observacoes: 2660,
      por_classe: [
        { classe: "structural_absence", mecanismo: "Estrutural", ocorrencias: 100 },
        { classe: "random_read_failure", mecanismo: "Aleatória", ocorrencias: 40 }
      ]
    },
    hipoteses: {
      alfa: 0.05,
      hd1: {
        teste: "Qui-quadrado de homogeneidade", pontos: 60, leituras: 2400, violacoes: 200,
        pontos_com_violacao: 35, violacoes_dos_pontos_de_maior_risco: 120, pontos_de_maior_risco: 10,
        reamostragens: 2000, estatistica: 812.5, gl: 59, p: 1e-90, celulas: 120,
        celulas_esperadas_abaixo_de_5: 12, reamostragens_que_alcancaram: 0, p_reamostragem: 0.0005,
        rejeita_h0: true
      },
      hd2: {
        teste: "Permutação", modo: "Pyro", rodadas: 40, rodadas_no_modo: 8, leituras: 2400,
        proporcao_no_modo_pct: 12.5, proporcao_nos_demais_pct: 9.25, proporcao_p_permutacao: 0.21,
        proporcao_u: 160, proporcao_p_mann_whitney: 0.25, proporcao_rejeita_h0: false,
        margem_no_modo_c: 30.5, margem_nos_demais_c: 21.25, margem_p_permutacao: 0.004,
        margem_u: 230, margem_p_mann_whitney: 0.006, margem_rejeita_h0: true,
        leituras_z: 2.5, leituras_p: 0.0124, pontos_que_esquentam_no_modo: 40, pontos_que_esfriam_no_modo: 20
      },
      hd3: {
        teste: "Correlação de Pearson", n: 60, r: 0.8, p: 1e-12, rho: 0.7, p_spearman: 1e-9,
        rejeita_h0: true, limite_min_c: 50, limite_max_c: 200
      },
      hn: [
        { variavel: "Value", n: 2660, w: 0.91, p: 1e-30, rejeita_h0: true },
        { variavel: "limit_c", n: 60, w: 0.85, p: 1e-6, rejeita_h0: true },
        { variavel: "margem_termica", n: 2400, w: 0.93, p: 1e-25, rejeita_h0: true }
      ]
    },
    escalonamento: [
      { variavel: "Value", n: 2660, media_c: 80.125, desvio_c: 30.5 },
      { variavel: "limit_c", n: 2400, media_c: 100, desvio_c: 35.25 },
      { variavel: "margem_termica", n: 2400, media_c: 20, desvio_c: 25 }
    ]
  };
}

function desempenho(alteracoes) {
  var d = {
    piso_aprovacao_pct: 90,
    global: { mae_teste_c: 5.1, aprovacao_teste_pct: 80, referencia: { mae_teste_c: 8.2 } },
    base: base()
  };
  if (alteracoes) alteracoes(d);
  return d;
}

test("formatação: milhar com ponto e p com limiar", function () {
  assert.equal(EB.fmtInt(3744), "3.744");
  assert.equal(EB.fmtInt(48), "48");
  assert.equal(EB.fmtPLimiar(1e-9), "< 0,001");
  assert.equal(EB.fmtPLimiar(0.0124), "= 0,012");
});

test("a referência diz a distância até o piso e o que o modelo faz com ela", function () {
  var t = EB.textos(desempenho()).referencia;
  assert.equal(t.titulo, "A média histórica cobre 50,0% dos pontos, longe dos 90% exigidos");
  assert.equal(t.numeros[0].valor, "8,43");
  assert.equal(t.numeros[1].lacuna, true);
  assert.match(t.numeros[1].nota, /^30 de 60 pontos · Wilson 37,7% a 62,3%$/);
  assert.equal(t.barraTitulo, "Por que a barra é 8,43 °C, e não 8,12 °C");
  assert.match(t.suficiencia, /que a bate, também fica abaixo do piso\.$/);

  var perto = EB.textos(desempenho(function (d) { d.base.referencia.cobertura_pct = 85; })).referencia;
  assert.match(perto.titulo, /abaixo dos 90% exigidos$/);

  var semGanho = EB.textos(desempenho(function (d) { d.global.mae_teste_c = 9; })).referencia;
  assert.match(semGanho.suficiencia, /não a bate em erro médio/);
});

test("validação e procedência saem da distribuição e das classes", function () {
  var t = EB.textos(desempenho());
  assert.equal(t.validacao.titulo,
    "45,0% das rodadas dividem configuração com outra, por isso a validação agrupa por configuração");
  assert.match(t.validacao.legenda, /6 configurações reúnem mais de uma rodada\.$/);
  assert.deepEqual(t.validacao.tabela[2], ["4", "3", "12"]);
  assert.equal(t.validacao.numeros[1].nota, "de 768 possíveis");

  assert.equal(t.procedencia.titulo, "5,00% das combinações não têm leitura e ficam fora, sem imputação");
  assert.equal(t.procedencia.numeros[0].valor, "2.800");
  assert.equal(t.procedencia.numeros[0].nota, "70 pontos × 40 rodadas");
  assert.deepEqual(t.procedencia.tabela[1], ["random_read_failure", "Aleatória", "40"]);
  assert.match(t.procedencia.porque, /nos 100 casos estruturais/);
});

test("HD1 descreve as células, a reamostragem e o tamanho de efeito", function () {
  var t = EB.textos(desempenho()).hipoteses.hd1;
  assert.equal(t.numeros[1][1], "χ² = 812,50 · gl = 59 · p < 0,001");
  assert.equal(t.numeros[2][1], "Rejeita H₀");
  assert.match(t.nota, /12 das 120 células têm frequência esperada abaixo de 5/);
  assert.match(t.nota, /em 2.000 reamostragens nenhuma alcançou o valor observado/);
  assert.match(t.nota, /35 dos 60 pontos/);
  assert.match(t.nota, /concentram 120 das 200 violações, ou 60,0%/);
  assert.match(t.impacto, /entre os 70 pontos/);
});

test("HD2 decide por medida e explica a unidade de análise", function () {
  var t = EB.textos(desempenho()).hipoteses.hd2;
  assert.equal(t.numeros[t.numeros.length - 1][1],
    "Dividida: H₀ das proporções não é rejeitada, H₀ das margens é");
  assert.match(t.nota, /tratar as 2.400 leituras como independentes multiplicaria por cerca de 60/);
  assert.match(t.nota, /corrigida a unidade, ela deixa de se sustentar/);
  assert.match(t.nota, /9,25 °C de folga adicional, diferença que se sustenta na rodada\.$/);
  assert.match(t.impacto, /sobe em 40 pontos e desce em 20/);

  var mesmoSentido = EB.textos(desempenho(function (d) {
    d.base.hipoteses.hd2.pontos_que_esfriam_no_modo = 0;
  })).hipoteses.hd2;
  assert.match(mesmoSentido.impacto, /no mesmo sentido/);
});

test("HD3, HN e escalonamento", function () {
  var h = EB.textos(desempenho()).hipoteses;
  assert.match(h.hd3.leitura, /erro abaixo de 5,0 °C no ponto de limite 50 e admite até 20,0 °C/);
  assert.equal(h.hd3.rodape, "Mesmo critério, precisão absoluta 4,0 vezes mais exigente num extremo");
  assert.deepEqual(h.hn.tabela[0], ["Value", "2.660", "0,9100", "< 0,001", "Rejeita H₀"]);
  assert.equal(h.titulo, "O risco se concentra em poucos pontos e o dado não é normal: quatro hipóteses testadas");

  var normal = EB.textos(desempenho(function (d) {
    d.base.hipoteses.hn.forEach(function (v) { v.rejeita_h0 = false; v.p = 0.4; });
  })).hipoteses;
  assert.equal(normal.titulo, "Quatro hipóteses sobre o dado, testadas na base");
  assert.match(normal.hn.impacto, /testes paramétricos seriam admissíveis/);

  var esc = EB.textos(desempenho()).escalonamento;
  assert.deepEqual(esc[0], ["Value", "2.660", "80,13", "30,50", "z = (Value − 80,13) / 30,50"]);
});
