/* Testes da busca da configuração segura mais próxima.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/segura_proxima.test.js
 *
 * Duas frentes. No catálogo da fixture, a conta de distância; numa cópia sem
 * nenhuma configuração segura, o caso sem sugestão. Numa cópia com algumas
 * configurações tornadas seguras à mão, a busca com duas referências (poucos e
 * muitos pontos fora), conferida contra força bruta.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var caminho = require("./apoio/fonte_painel.js").caminho;

var ctx = vm.createContext({});
["dados_comparacao.js", "segura_proxima.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(caminho(f), "utf8"), ctx, { filename: f });
});

// JSON de ida e volta: objetos do contexto vm não passam em deepEqual com os daqui.
var D = JSON.parse(JSON.stringify(vm.runInContext("DADOS_COMPARACAO", ctx)));
var SP = vm.runInContext("SEGURA_PROXIMA", ctx);

var DENTRO = 2;
var ACIMA = 0;
var COM_LIMITE = [];
D.pontos.forEach(function (p, i) { if (!p.mono) COM_LIMITE.push(i); });

function porId(dados, id) {
  return dados.configuracoes.filter(function (c) { return c.id === id; })[0];
}

// Classificação refeita aqui, sem passar pelo módulo: é o que a triagem lê.
function seguraPelaTriagem(cfg) {
  return COM_LIMITE.every(function (i) { return cfg.e[i] === DENTRO; });
}

function forcaBruta(fatoresRef, dados, idRef) {
  var pad = SP.padronizacao(dados.configuracoes);
  var melhor = null;
  dados.configuracoes.forEach(function (c) {
    if (c.id === idRef || !seguraPelaTriagem(c)) return;
    var d = SP.distancia(fatoresRef, c.fatores, pad);
    if (!melhor || d < melhor.d || (d === melhor.d && c.id < melhor.id)) melhor = { id: c.id, d: d };
  });
  return melhor;
}


/* ----- Catálogo da fixture ----- */

var META_DO_MODELO = path.join(__dirname, "..", "..", "modelos", "gradient_boosting", "mainback.json");

test("codificação tem as 13 colunas dos modelos, na mesma ordem", {
  skip: !fs.existsSync(META_DO_MODELO) && "modelos não treinados: rode sintetico/treinar_modelos.py"
}, function () {
  var meta = JSON.parse(fs.readFileSync(META_DO_MODELO, "utf8"));
  var esperadas = meta.colunas_entrada.filter(function (c) { return c !== "codigo_termopar"; });
  assert.deepEqual(Array.from(SP.COLUNAS, function (c) { return c.coluna; }), esperadas);
});

test("distância calculada para todas as configurações conhecidas", function () {
  var ref = porId(D, D.config_referencia_triagem);
  var res = SP.buscar(ref.fatores, D, ref.id);

  assert.equal(res.todas.length, D.configuracoes.length);
  assert.equal(res.todas.length, D.total_configuracoes);
  res.todas.forEach(function (x, k) {
    assert.ok(Number.isFinite(x.distancia) && x.distancia >= 0, x.id + " com distância inválida");
    if (k > 0) assert.ok(x.distancia >= res.todas[k - 1].distancia, "ranking fora de ordem em " + x.id);
  });
  assert.equal(res.todas[0].id, ref.id);
  assert.equal(res.todas[0].distancia, 0);
});

/* Zero só quando a codificação coincide. Acontece entre configurações que
   diferem apenas em "Open" e "Open - Updated", que os modelos também não
   distinguem (codificacao.py). */
test("distância é simétrica e se anula só entre codificações iguais", function () {
  var pad = SP.padronizacao(D.configuracoes);
  D.configuracoes.forEach(function (a) {
    D.configuracoes.forEach(function (b) {
      var ab = SP.distancia(a.fatores, b.fatores, pad);
      assert.ok(Math.abs(ab - SP.distancia(b.fatores, a.fatores, pad)) < 1e-12);
      var mesmaCodificacao = SP.codificar(a.fatores).join() === SP.codificar(b.fatores).join();
      assert.equal(ab === 0, mesmaCodificacao, a.id + " × " + b.id);
    });
  });
});

test("padronização usa desvio padrão populacional das configurações", function () {
  var pad = SP.padronizacao(D.configuracoes);
  var j = SP.COLUNAS.map(function (c) { return c.coluna; }).indexOf("Run_Case_Pyro");
  var x = D.configuracoes.map(function (c) { return c.fatores.run_case === "Pyro" ? 1 : 0; });
  var mu = x.reduce(function (s, v) { return s + v; }, 0) / x.length;
  var sigma = Math.sqrt(x.reduce(function (s, v) { return s + (v - mu) * (v - mu); }, 0) / x.length);
  assert.ok(Math.abs(pad.mu[j] - mu) < 1e-12);
  assert.ok(Math.abs(pad.sigma[j] - sigma) < 1e-12);
});

test("distância ao quadrado é a soma dos pesos dos fatores divergentes", function () {
  var pad = SP.padronizacao(D.configuracoes);
  var a = D.configuracoes[0], b = D.configuracoes[D.configuracoes.length - 1];
  var soma = SP.camposDivergentes(a.fatores, b.fatores, pad)
    .reduce(function (s, d) { return s + d.peso; }, 0);
  assert.ok(Math.abs(soma - Math.pow(SP.distancia(a.fatores, b.fatores, pad), 2)) < 1e-9);
});

test("classificação do módulo bate com a contagem da triagem", function () {
  D.configuracoes.forEach(function (c) {
    var foraPelaTriagem = COM_LIMITE.filter(function (i) { return c.e[i] !== DENTRO; }).length;
    assert.equal(SP.pontosFora(c, D), foraPelaTriagem, c.id);
    assert.equal(SP.ehSegura(c, D), seguraPelaTriagem(c), c.id);
  });
});

test("sem configuração segura na base, a busca devolve null e não uma sugestão vazia", function () {
  // Cópia do catálogo em que toda configuração tem ao menos um ponto acima do limite.
  var dados = JSON.parse(JSON.stringify(D));
  dados.configuracoes.forEach(function (c) { c.e[COM_LIMITE[0]] = ACIMA; });
  assert.ok(dados.configuracoes.every(function (c) { return !seguraPelaTriagem(c); }));

  var ref = porId(dados, dados.config_referencia_triagem);
  var res = SP.buscar(ref.fatores, dados, ref.id);
  assert.equal(res.sugestao, null);
  assert.equal(res.seguras.length, 0);
});


/* ----- Base com seguras fabricadas ----- */

function comSeguras(ids) {
  var dados = JSON.parse(JSON.stringify(D));
  ids.forEach(function (id) {
    var c = porId(dados, id);
    COM_LIMITE.forEach(function (i) { c.e[i] = DENTRO; });
  });
  return dados;
}

// Referência com só `n` pontos acima do limite e o resto dentro.
function comPoucosFora(dados, id, n) {
  var c = porId(dados, id);
  COM_LIMITE.forEach(function (i, k) { c.e[i] = k < n ? ACIMA : DENTRO; });
  return c;
}

var SEGURAS = ["CFG-04", "CFG-11", "CFG-23", "CFG-30"];

test("referência com poucos pontos fora: sugere a segura mais próxima", function () {
  var dados = comSeguras(SEGURAS);
  var ref = comPoucosFora(dados, "CFG-19", 2);
  assert.equal(SP.pontosFora(ref, dados), 2);

  var res = SP.buscar(ref.fatores, dados, ref.id);
  var esperada = forcaBruta(ref.fatores, dados, ref.id);

  assert.ok(res.sugestao, "sem sugestão com seguras na base");
  assert.equal(res.sugestao.id, esperada.id);
  assert.ok(seguraPelaTriagem(porId(dados, res.sugestao.id)), "sugestão não é segura na triagem");
  // As fabricadas e as que já são seguras no catálogo, menos a própria referência.
  var esperadas = dados.configuracoes.filter(function (c) {
    return c.id !== ref.id && seguraPelaTriagem(c);
  }).map(function (c) { return c.id; });
  assert.deepEqual(res.seguras.map(function (x) { return x.id; }).sort(), esperadas.sort());
});

test("referência com muitos pontos fora: sugere a segura mais próxima", function () {
  var dados = comSeguras(SEGURAS);
  // A configuração com mais pontos fora do catálogo.
  var ref = dados.configuracoes.reduce(function (a, b) {
    return SP.pontosFora(b, dados) > SP.pontosFora(a, dados) ? b : a;
  });
  var fora = SP.pontosFora(ref, dados);
  assert.ok(fora >= 10, ref.id + " deveria ter muitos pontos fora, tem " + fora);

  var res = SP.buscar(ref.fatores, dados, ref.id);
  var esperada = forcaBruta(ref.fatores, dados, ref.id);

  assert.equal(res.sugestao.id, esperada.id);
  assert.ok(seguraPelaTriagem(porId(dados, res.sugestao.id)));
});

test("filtro vem antes da ordenação: uma não segura mais perto não é sugerida", function () {
  var dados = comSeguras(SEGURAS);
  var ref = porId(dados, "CFG-19");
  var res = SP.buscar(ref.fatores, dados, ref.id);

  var maisPerto = res.todas.filter(function (x) { return x.id !== ref.id; })[0];
  assert.ok(!maisPerto.segura, "fixture sem não segura à frente das seguras");
  assert.notEqual(res.sugestao.id, maisPerto.id);
  assert.ok(res.sugestao.distancia >= maisPerto.distancia);
  res.seguras.forEach(function (x, k) {
    if (k > 0) assert.ok(x.distancia >= res.seguras[k - 1].distancia);
  });
});

test("a própria referência nunca é sugerida", function () {
  var dados = comSeguras(["CFG-19", "CFG-04"]);
  var ref = porId(dados, "CFG-19");
  var res = SP.buscar(ref.fatores, dados, ref.id);
  assert.equal(res.sugestao.id, "CFG-04");
});

test("fatores divergentes são exatamente os campos que mudam", function () {
  var dados = comSeguras(SEGURAS);
  var ref = porId(dados, "CFG-01");
  var res = SP.buscar(ref.fatores, dados, ref.id);
  var sug = res.sugestao.cfg;

  var difs = SP.camposDivergentes(ref.fatores, sug.fatores, res.padronizacao);
  var esperados = SP.CAMPOS.filter(function (c) {
    return SP.valorDoCampo(ref.fatores, c) !== SP.valorDoCampo(sug.fatores, c);
  });
  assert.deepEqual(difs.map(function (d) { return d.campo; }).sort(), esperados.sort());
  difs.forEach(function (d, k) { if (k > 0) assert.ok(d.peso <= difs[k - 1].peso); });
});

test("combinação editada fora da base: busca pelos fatores sem referência", function () {
  var dados = comSeguras(SEGURAS);
  var editada = JSON.parse(JSON.stringify(porId(dados, "CFG-19").fatores));
  editada.run_case = "Broil C1";
  editada.losses = { present: "none" };
  assert.equal(SP.localizar(editada, dados.configuracoes), null);

  var res = SP.buscar(editada, dados, null);
  assert.equal(res.sugestao.id, forcaBruta(editada, dados, null).id);
});
