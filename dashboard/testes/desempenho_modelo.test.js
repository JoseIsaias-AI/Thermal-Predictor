/* Testes do painel de desempenho da engenharia.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/desempenho_modelo.test.js
 *
 * O painel não calcula métrica: lê `GET /desempenho` e compara cada valor com o
 * seu alvo. O que se prende aqui é essa comparação e a formatação que a tela
 * exibe, sobre um desempenho inventado no formato da API: o modelo erra menos
 * que a referência e não atinge a cobertura de 90%.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");

var DM = require("../js/leitura/desempenho_modelo.js");

function faixa(rotulo, min, max, pontos, aprovados, mae) {
  return { faixa: rotulo, limite_min_c: min, limite_max_c: max, pontos: pontos,
    aprovados: aprovados, aprovacao_pct: 100 * aprovados / pontos, mae_medio_c: mae };
}

function dataset(nome, mae, aprovacao) {
  return { dataset: nome, modelo_final: "Média de Random Forest e Gradient Boosting",
    validado: true, mae_teste_c: mae, rmse_teste_c: mae * 1.4, r2_teste: 0.8,
    pontos_aprovados: 5, pontos_com_limite: 8, aprovacao_teste_pct: 62.5,
    mae_40_divisoes_c: mae * 0.9, aprovacao_mediana_40_divisoes_pct: aprovacao,
    excedencias_teste: 2, sensibilidade_pct: 100, falsos_negativos: 0, falsos_positivos: 1,
    referencia_mae_teste_c: mae * 1.5, referencia_mae_40_divisoes_c: mae * 1.4 };
}

var DESEMPENHO = {
  versao_modelo: "fixture-teste",
  origem: "teste",
  observacao: "Valores inventados para testar a tela.",
  piso_aprovacao_pct: 90,
  tolerancia_fracao: 0.1,
  global: {
    mae_teste_c: 4.37, rmse_teste_c: 6.82, r2_teste: 0.913,
    pontos_aprovados: 41, pontos_com_limite: 60, aprovacao_teste_pct: 68.3333,
    mae_40_divisoes_c: 3.95, aprovacao_mediana_40_divisoes_pct: 71.4,
    excedencias_teste: 12, sensibilidade_pct: 83.3333, falsos_negativos: 2, falsos_positivos: 9,
    aprovacao_teste_wilson_pct: [55.8, 78.7],
    divisoes: 40, divisoes_no_piso: 3,
    referencia: { estrategia: "Média histórica do ponto no treino, sem modelo.",
      mae_teste_c: 6.21, mae_40_divisoes_c: 5.88 },
    wilcoxon: { descricao: "Wilcoxon pareado.", pares: 40, estatistica: 12,
      p: 3.4e-7, divisoes_em_que_o_modelo_erra_menos: 37 }
  },
  por_dataset: [
    dataset("Mainback", 4.1, 70.0), dataset("Coil Temps", 6.3, 75.0),
    dataset("Main Vent Sys", 3.2, 100.0), dataset("IPC Cooling", 5.0, 100.0),
    dataset("IPC Comp", 4.4, 64.9), dataset("HMI / Knobs / Console", 2.2, 90.0),
    { dataset: "AC Blower Inlet", modelo_final: null, validado: false,
      motivo: "Poucas rodadas com leitura." }
  ],
  por_faixa_de_limite: [
    faixa("até 90 °C", 0, 90, 30, 18, 3.1), faixa("90 a 110 °C", 90, 110, 10, 7, 4.4),
    faixa("110 a 130 °C", 110, 130, 8, 4, 6.0), faixa("acima de 130 °C", 130, 250, 12, 12, 5.2)
  ]
};

function cartao(id) {
  return DM.avaliar(DESEMPENHO).filter(function (m) { return m.id === id; })[0];
}

test("os valores exibidos saem dos dados, no formato da tela", function () {
  assert.equal(cartao("mae").valor, "4,37");
  assert.equal(cartao("rmse").valor, "6,82");
  assert.equal(cartao("r2").valor, "0,913");
  assert.equal(cartao("cobertura").valor, "68,3");
  assert.equal(cartao("wilcoxon").valor, "3,4 × 10⁻⁷");
  assert.equal(cartao("sensibilidade").valor, "83,3");
  assert.match(cartao("cobertura").detalhe, /41 de 60 pontos/);
  assert.match(cartao("cobertura").detalhe, /Wilson 55,8% a 78,7%/);
  assert.match(cartao("cobertura").detalhe, /mediana de 71,4%/);
});

test("o modelo bate a referência em erro e não atinge a cobertura de 90%", function () {
  assert.equal(cartao("mae").situacao, "atingido");
  assert.equal(cartao("wilcoxon").situacao, "atingido");
  assert.equal(cartao("cobertura").situacao, "nao_atingido");
  ["rmse", "r2", "faixa", "sensibilidade"].forEach(function (id) {
    assert.equal(cartao(id).situacao, "sem_alvo", id);
  });
});

test("a situação sai dos dados, e não de texto fixo", function () {
  var alterado = JSON.parse(JSON.stringify(DESEMPENHO));
  alterado.global.aprovacao_teste_pct = 92;
  alterado.global.aprovacao_mediana_40_divisoes_pct = 95;
  alterado.global.wilcoxon.p = 0.2;
  var cartoes = DM.avaliar(alterado);
  var por = {};
  cartoes.forEach(function (m) { por[m.id] = m; });
  assert.equal(por.cobertura.situacao, "atingido");
  assert.equal(por.wilcoxon.situacao, "nao_atingido");
});

test("a faixa de limite mostra o intervalo de aprovação e a pior faixa", function () {
  assert.equal(cartao("faixa").valor, "50,0–100,0");
  assert.match(cartao("faixa").detalhe, /110 a 130 °C/);
});

test("formatação pt-BR, com p em notação científica só quando pequeno", function () {
  assert.equal(DM.fmt(-0.04, 1), "0,0");
  assert.equal(DM.fmt(-1.25, 2), "−1,25");
  assert.equal(DM.fmt(null, 2), "—");
  assert.equal(DM.fmtP(0.0123), "0,012");
  assert.equal(DM.fmtP(8.4e-4), "8,4 × 10⁻⁴");
});

test("título e situação dos critérios saem dos números da API", function () {
  var t = DM.textosDaTela(DESEMPENHO);
  assert.equal(t.titulo, "O modelo final erra menos que a média histórica, mas cobre 68,3% dos pontos e o critério exige 90%");
  assert.match(t.engenharia, /^Não atingida: 68,3% \(41 de 60\)/);
  assert.match(t.estatistica, /^Atingida: p = 3,4 × 10⁻⁷/);
  assert.match(t.porque, /4,37 °C no teste isolado/);
  assert.match(t.porque, /10 das 12 excedências/);
});

test("onde confiar menos sai da comparação de cada área com a média do ponto e com o piso", function () {
  var t = DM.textosDaTela(DESEMPENHO);
  assert.equal(t.onde, "Onde a previsão é mais fraca: em IPC Comp ela é indicativa, com aprovação mediana " +
    "de 64,9% nas divisões, e as configurações com pontos de pouca folga seguem para o CFD; em AC Blower " +
    "Inlet nenhuma previsão apoia decisão.");
  assert.match(t.porqueDuas, /que bate a referência em erro e não chega à cobertura exigida\.$/);

  var alterado = JSON.parse(JSON.stringify(DESEMPENHO));
  alterado.por_dataset[3].mae_teste_c = 9;
  assert.match(DM.textosDaTela(alterado).onde, /em IPC Cooling a média histórica do ponto é a melhor referência/);

  alterado.global.aprovacao_teste_pct = 95;
  alterado.global.aprovacao_mediana_40_divisoes_pct = 95;
  assert.equal(DM.textosDaTela(alterado).porqueDuas,
    "Duas exigências independentes: cumprir uma não implica cumprir a outra.");
});
