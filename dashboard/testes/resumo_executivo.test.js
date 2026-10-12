/* Testes do resumo executivo em linguagem natural.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/resumo_executivo.test.js
 *
 * Sem DOM: o que se verifica é o texto gerado. Três cenários nomeados (todos
 * dentro, poucos críticos, muitos críticos), a varredura de toda distribuição
 * pequena de estados, a gramática, a conferência de cada número citado contra
 * a contagem da tela técnica e a ausência de nome de componente.
 */

"use strict";

var test = require("node:test");
var payloadDoCatalogo = require("./apoio/previsao_do_catalogo.js");
var desempatar = require("./apoio/ordem_de_risco.js");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var caminho = require("./apoio/fonte_painel.js").caminho;

function carregar() {
  var ctx = vm.createContext({ window: {} });
  ["schema.js", "dados_triagem.js", "dados_comparacao.js", "leitura_publicos.js", "resumo_executivo.js"].forEach(function (f) {
    vm.runInContext(fs.readFileSync(caminho(f), "utf8"), ctx, { filename: f });
  });
  return {
    DADOS: vm.runInContext("DADOS_TRIAGEM", ctx),
    CATALOGO: vm.runInContext("DADOS_COMPARACAO", ctx),
    LP: vm.runInContext("LEITURA_PUBLICOS", ctx),
    R: vm.runInContext("RESUMO_EXECUTIVO", ctx)
  };
}

var M = carregar();
var LP = M.LP;
var R = M.R;

/* Payload sintético no formato da triagem. `areas` diz quantos pontos de cada
   estado cada subsistema tem, na ordem em que o dado os traria. */
function payload(areas, monitorados) {
  var pontos = [];
  Object.keys(areas).forEach(function (area) {
    [["acima_do_limite", -5], ["banda_de_incerteza", 2], ["dentro_do_limite", 20]].forEach(function (par) {
      var chave = par[0] === "acima_do_limite" ? "acima" : par[0] === "banda_de_incerteza" ? "banda" : "dentro";
      for (var i = 0; i < (areas[area][chave] || 0); i++) {
        pontos.push({ TC_Name: "Ponto " + area + " " + chave + " " + i, Key_Area: area, estado: par[0], margem_c: par[1] });
      }
    });
  });
  var mono = [];
  for (var j = 0; j < (monitorados === undefined ? 10 : monitorados); j++) {
    mono.push({ TC_Name: "Monitorado " + j, Key_Area: "Main Vent Sys", estado: "monitoramento", margem_c: null });
  }
  return { pontos: pontos, monitoramento: mono, preditor_e_stub: false };
}

// Tudo que o texto pode citar em número, contado dos pontos, como a tabela.
function numerosPermitidos(dados) {
  var c = LP.contarEstados(dados.pontos);
  var sub = LP.subsistemaMaisCritico(dados.pontos);
  var total = dados.pontos.length;
  var inteiros = [total, c.acima_do_limite, c.banda_de_incerteza, c.dentro_do_limite];
  if (sub) inteiros.push(sub.n, sub.acima, sub.banda);
  return {
    inteiros: inteiros.map(String),
    percentuais: [c.acima_do_limite, c.banda_de_incerteza, c.dentro_do_limite].map(function (k) {
      return LP.percentual(k, total);
    })
  };
}

/* O que se cobra de toda saída: sem resto de template, frases completas,
   concordância de número, enquadramento pré-CFD e cada número conferido. */
function validar(r, dados, rotulo) {
  var todas = [r.titulo, r.proximo_passo].concat(r.frases);
  var junto = todas.join(" ");

  assert.doesNotMatch(junto, /[{}#]|undefined|NaN|null/, rotulo + ": sobra de template em «" + junto + "»");
  assert.doesNotMatch(junto, /\s{2,}|\s[.,:)]/, rotulo + ": espaço fora do lugar");
  assert.doesNotMatch(junto, /\b1 pontos\b|\b1 deles\b|\b1 ficam\b|\b1 inconclusivos\b/, rotulo + ": plural com um");
  assert.doesNotMatch(junto, /\b(?:[02-9]|\d{2,}) ponto\b/, rotulo + ": singular com vários");
  assert.doesNotMatch(junto, /\b1 de \d+ pontos passam\b/, rotulo + ": verbo no plural com um");

  r.frases.concat([r.proximo_passo]).forEach(function (f) {
    assert.match(f, /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/, rotulo + ": frase começa em minúscula: «" + f + "»");
    assert.match(f, /\.$/, rotulo + ": frase sem ponto final: «" + f + "»");
  });
  assert.match(r.titulo, /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9]/, rotulo + ": título em minúscula");

  // Enquadramento dentro do texto corrido, e não como nota à parte.
  assert.match(r.frases[0], /antecede a simulação CFD/, rotulo + ": sem enquadramento pré-CFD");

  var ok = numerosPermitidos(dados);
  (junto.match(/\d+%/g) || []).forEach(function (p) {
    assert.ok(ok.percentuais.indexOf(p) >= 0, rotulo + ": percentual " + p + " não sai da contagem");
  });
  (junto.replace(/\d+%/g, "").match(/\d+/g) || []).forEach(function (n) {
    assert.ok(ok.inteiros.indexOf(n) >= 0, rotulo + ": número " + n + " não sai da contagem");
  });
}

/* ----- Os três cenários pedidos ----- */

test("todos os pontos dentro: diz que nenhum passa, sem sugerir aprovação", function () {
  var dados = payload({ "CT Knobs": { dentro: 6 }, "IPC Comp": { dentro: 30 }, "Mainback": { dentro: 11 } });
  var r = R.gerar(dados);

  assert.equal(r.cenario, "todos_dentro");
  assert.equal(r.titulo, "Nenhum ponto passa do limite");
  assert.equal(r.texto,
    "Na triagem que antecede a simulação CFD, a estimativa deixa todos os 47 pontos com limite declarado dentro do limite, com folga maior que a tolerância.");
  assert.match(r.proximo_passo, /não é aprovação/);
  validar(r, dados, "todos dentro");
});

test("poucos críticos: minoria, com percentual e subsistema mais afetado", function () {
  var dados = payload({
    "IPC Comp": { acima: 2, banda: 3, dentro: 32 },
    "Coil Temps": { acima: 3, dentro: 5 },
    "Mainback": { banda: 1, dentro: 10 }
  });
  var r = R.gerar(dados);

  assert.equal(r.cenario, "minoria_fora");
  assert.equal(r.titulo, "5 de 56 pontos passam do limite");
  // Array.from traz o vetor do contexto do vm para este, e o deepEqual compara.
  assert.deepEqual(Array.from(r.frases), [
    "Na triagem que antecede a simulação CFD, a estimativa põe uma minoria dos 56 pontos com limite declarado acima do limite: 5 pontos, ou 9%.",
    "Outros 4 pontos ficaram perto demais do limite para decidir sem verificação (7%).",
    "O subsistema mais afetado é o conjunto de indução, com 3 de 8 pontos acima do limite."
  ]);
  assert.equal(r.proximo_passo, "Seguir para a simulação CFD com prioridade para o conjunto de indução, onde a triagem aponta o maior risco.");
  validar(r, dados, "poucos críticos");
});

test("muitos críticos: maioria, pede revisão antes da fila de simulação", function () {
  var dados = payload({
    "IPC Comp": { acima: 20, banda: 2, dentro: 5 },
    "Oven HMI": { acima: 4 },
    "CT Knobs": { acima: 1, dentro: 5 }
  });
  var r = R.gerar(dados);

  assert.equal(r.cenario, "maioria_fora");
  assert.equal(r.titulo, "A maioria dos pontos passa do limite");
  assert.equal(r.frases[0],
    "Na triagem que antecede a simulação CFD, a estimativa põe a maioria dos 37 pontos com limite declarado acima do limite: 25 pontos, ou 68%.");
  assert.equal(r.frases[2], "O subsistema mais afetado é o painel de comando do forno, com 4 de 4 pontos acima do limite.");
  assert.match(r.proximo_passo, /^Rever a configuração antes de ocupar a fila da simulação CFD, a começar pelo painel de comando do forno\.$/);
  validar(r, dados, "muitos críticos");
});

/* ----- Cobertura de todo cenário ----- */

test("toda distribuição pequena de estados cai num template e sai correta", function () {
  var vistos = {};
  for (var total = 0; total <= 7; total++) {
    for (var acima = 0; acima <= total; acima++) {
      for (var banda = 0; acima + banda <= total; banda++) {
        [0, 1, 3].forEach(function (mono) {
          var dados = payload({ "IPC Comp": { acima: acima, banda: banda, dentro: total - acima - banda } }, mono);
          ["geral", "marketing"].forEach(function (publico) {
            var r = R.gerar(dados, { publico: publico });
            vistos[r.cenario] = true;
            if (total > 0) validar(r, dados, total + "/" + acima + "/" + banda + " " + publico);
            else assert.equal(r.cenario, "sem_limite");
          });
        });
      }
    }
  }
  assert.deepEqual(Object.keys(vistos).sort(), Array.from(R.CENARIOS).sort(),
    "algum template nunca é escolhido, ou algum cenário ficou sem template");
});

test("singular e plural concordam nos extremos de um ponto só", function () {
  var um = R.gerar(payload({ "CT Knobs": { acima: 1, dentro: 5 } }));
  assert.equal(um.titulo, "1 de 6 pontos passa do limite");
  assert.match(um.frases[0], /acima do limite: 1 ponto, ou 17%\.$/);

  var banda = R.gerar(payload({ "CT Knobs": { acima: 1, banda: 1, dentro: 5 } }));
  assert.equal(banda.frases[1], "Outro ponto ficou perto demais do limite para decidir sem verificação (14%).");

  var soUm = R.gerar(payload({ "CT Knobs": { banda: 1 } }));
  assert.equal(soUm.titulo, "Nenhum ponto passa do limite, mas 1 fica sem decisão");
  assert.match(soUm.frases[1], /com 1 de 1 ponto nessa situação\.$/);

  var todos = R.gerar(payload({ "CT Knobs": { acima: 1 } }));
  assert.equal(todos.titulo, "O único ponto avaliado passa do limite");
});

/* ----- Dado real ----- */

test("configuração de referência: números batem com a tabela e o cartão da triagem", function () {
  var r = R.gerar(M.DADOS);
  var c = LP.contarEstados(M.DADOS.pontos);
  var sub = LP.subsistemaMaisCritico(M.DADOS.pontos);

  assert.equal(r.numeros.total, M.DADOS.total_classificados);
  assert.equal(r.numeros.acima, c.acima_do_limite);
  assert.equal(r.numeros.banda, c.banda_de_incerteza);
  assert.equal(r.numeros.dentro, c.dentro_do_limite);
  assert.equal(r.numeros.monitorados, M.DADOS.total_monitoramento);

  // O cartão "Acima do limite" da triagem mostra "22 de 68"; o título repete.
  assert.equal(r.titulo, c.acima_do_limite + " de " + M.DADOS.total_classificados + " pontos passam do limite");
  // O cartão "Subsistema mais crítico" mostra a sigla e "a de n acima".
  assert.ok(r.texto.indexOf(LP.NOME_SUBSISTEMA[sub.area].nome + ", com " + sub.acima + " de " + sub.n + " pontos acima") >= 0);
  validar(r, M.DADOS, "referência");
});

test("todas as configurações do histórico geram texto válido, para os dois públicos", function () {
  M.CATALOGO.configuracoes.forEach(function (entrada) {
    var dados = payloadDoCatalogo(M.CATALOGO, entrada);
    ["geral", "marketing"].forEach(function (publico) {
      validar(R.gerar(dados, { publico: publico }), dados, entrada.id + " " + publico);
    });
  });
});

test("nenhum componente é citado pelo nome no resumo", function () {
  var nomes = M.CATALOGO.pontos.map(function (p) { return p.nome; });
  M.CATALOGO.configuracoes.forEach(function (entrada) {
    var r = R.gerar(payloadDoCatalogo(M.CATALOGO, entrada));
    var junto = [r.titulo, r.texto, r.proximo_passo].join(" ");
    nomes.forEach(function (nome) {
      assert.ok(junto.indexOf(nome) < 0, entrada.id + " cita o componente " + nome);
    });
  });
});

/* ----- Troca de configuração ----- */

test("o catálogo reproduz a configuração de referência ponto a ponto", function () {
  var ref = LP.configuracaoNoCatalogo(M.DADOS.configuracao, M.CATALOGO);
  assert.equal(ref.id, M.CATALOGO.config_referencia_triagem);

  var gerado = payloadDoCatalogo(M.CATALOGO, ref);
  assert.equal(gerado.pontos.length, M.DADOS.pontos.length);
  assert.equal(gerado.monitoramento.length, M.DADOS.monitoramento.length);

  // A lista principal tem ordem garantida (estado, depois folga), a menos de empates na folga
  // arredondada; a de monitoramento não tem ordem, e por isso é comparada pelo identificador.
  function porId(lista) {
    return lista.slice().sort(function (x, y) { return x.measurement_id < y.measurement_id ? -1 : 1; });
  }
  var esperados = desempatar(M.DADOS.pontos).concat(porId(M.DADOS.monitoramento));
  desempatar(gerado.pontos).concat(porId(gerado.monitoramento)).forEach(function (p, i) {
    var q = esperados[i];
    ["measurement_id", "TC_Name", "Key_Area", "temperatura_prevista_c", "limit_c", "is_monitor_only", "estado", "estado_rotulo"]
      .forEach(function (k) { assert.equal(p[k], q[k], k + " de " + q.measurement_id); });
    if (q.margem_c !== null) {
      assert.ok(Math.abs(p.margem_c - q.margem_c) < 1e-9);
      // Dois arredondamentos da API: a folga do catálogo vai a duas casas (até 0,005 °C) e
      // margem_percentual da triagem, a quatro. A diferença fica abaixo da soma dos dois.
      assert.ok(Math.abs(p.margem_percentual - q.margem_percentual) <= 0.005 / q.limit_c + 5e-5);
    }
  });

  assert.equal(R.gerar(gerado).texto, R.gerar(M.DADOS).texto);
});

test("a fonte é a previsão do modelo da tela, e o catálogo serve à leitura de outra configuração", function () {
  // Não há outra fonte: a previsão que js/nucleo/previsao_sessao.js conferiu contra a URL.
  assert.equal(LP.fonte(), M.DADOS);
  assert.equal(LP.fonte(M.DADOS.configuracao), M.DADOS);

  var outra = M.CATALOGO.configuracoes.filter(function (c) { return c.id === "CFG-31"; })[0];
  var dados = payloadDoCatalogo(M.CATALOGO, outra);
  assert.equal(dados.configuracao_id, "CFG-31");
  assert.equal(dados.pontos.length, outra.resumo.reduce(function (a, b) { return a + b; }, 0));
  assert.notEqual(R.gerar(dados).texto, R.gerar(M.DADOS).texto);

  // Campo vazio vindo da URL conta como ausente.
  var comVazio = JSON.parse(JSON.stringify(outra.fatores));
  comVazio.losses.order = "";
  assert.equal(LP.configuracaoNoCatalogo(comVazio, M.CATALOGO).id, "CFG-31");
});
