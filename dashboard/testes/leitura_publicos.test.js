/* Testes da camada de tradução das áreas por público.
 *
 * Rodar da raiz do repositório:
 *   node --test dashboard/testes/leitura_publicos.test.js
 *
 * Sem DOM: leitura_publicos.js não desenha. O que se verifica é que o recorte
 * e a tradução preservam RN-01, RN-02, RN-03 e RN-07, e que nenhuma tela
 * precisará recalcular estado para montar a sua leitura.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var JS = path.join(__dirname, "..", "js");

function carregar() {
  var ctx = vm.createContext({ window: {} });
  ["schema.js", "dados_triagem.js", "dados_comparacao.js", "leitura_publicos.js"].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
  });
  return {
    DADOS: vm.runInContext("DADOS_TRIAGEM", ctx),
    CATALOGO: vm.runInContext("DADOS_COMPARACAO", ctx),
    SCHEMA: vm.runInContext("SCHEMA", ctx),
    LP: vm.runInContext("LEITURA_PUBLICOS", ctx)
  };
}

var M = carregar();
var LP = M.LP;
var TODOS = LP.todosOsPontos(M.DADOS);

test("a fonte entrega os 78 pontos da triagem, sem perder nem duplicar", function () {
  // Ponto único de substituição: hoje é o global de dados_triagem.js.
  assert.equal(LP.fonte(), M.DADOS);
  assert.equal(TODOS.length, M.DADOS.total_pontos);
  assert.equal(M.DADOS.pontos.length, M.DADOS.total_classificados);
  assert.equal(M.DADOS.monitoramento.length, M.DADOS.total_monitoramento);
});

test("reprovados traz só o que trava decisão, da folga mais apertada para a menos", function () {
  var lista = LP.reprovados(TODOS);
  var esperado = TODOS.filter(function (p) {
    return p.estado === "acima_do_limite" || p.estado === "banda_de_incerteza";
  }).length;

  assert.equal(lista.length, esperado);
  assert.ok(lista.length > 0, "a base sintética precisa ter ponto crítico para o teste valer");

  lista.forEach(function (p) {
    assert.notEqual(p.estado, "dentro_do_limite");
    assert.notEqual(p.estado, "monitoramento");
  });

  // Acima do limite vem antes da banda, e dentro de cada bloco a folga cresce.
  var indice = lista.map(function (p) { return LP.ORDEM_ESTADOS.indexOf(p.estado); });
  for (var i = 1; i < lista.length; i++) {
    assert.ok(indice[i] >= indice[i - 1], "a ordem por gravidade quebrou em " + i);
    if (indice[i] === indice[i - 1]) {
      assert.ok(lista[i].margem_c >= lista[i - 1].margem_c, "a ordem por folga quebrou em " + i);
    }
  }
});

test("RN-02: o subsistema herda o pior estado, nunca a média nem a contagem", function () {
  var um = { Key_Area: "X", estado: "acima_do_limite", margem_c: -40 };
  var muitos = [];
  for (var i = 0; i < 20; i++) muitos.push({ Key_Area: "X", estado: "dentro_do_limite", margem_c: 50 });

  assert.equal(LP.severidade(muitos.concat([um])), "acima_do_limite");
  assert.equal(LP.severidade(muitos), "dentro_do_limite");

  // Grupo só de monitorados não inventa estado de risco (RN-03).
  assert.equal(LP.severidade([{ Key_Area: "X", estado: "monitoramento", margem_c: null }]), "monitoramento");
  assert.equal(LP.severidade([]), null);
});

test("porSubsistema cobre os sete subsistemas sem perder ponto", function () {
  var resumo = LP.porSubsistema(TODOS);
  var soma = 0;

  assert.equal(resumo.length, 7);
  resumo.forEach(function (r) {
    soma += r.total;

    var contados = LP.ORDEM_ESTADOS.reduce(function (acc, e) { return acc + r.contagem[e]; }, 0);
    assert.equal(contados, r.total, r.area);
    assert.equal(r.total_avaliados, r.total - r.contagem.monitoramento, r.area);

    // O componente que sustenta a severidade acompanha o resumo.
    if (r.total_avaliados > 0) {
      assert.equal(r.pior_ponto.estado, r.estado, r.area);
      assert.equal(r.pior_margem_c, r.pior_ponto.margem_c, r.area);
    } else {
      assert.equal(r.pior_ponto, null, r.area);
    }
  });

  assert.equal(soma, TODOS.length);

  // Do mais grave para o menos, como a tabela da triagem.
  for (var i = 1; i < resumo.length; i++) {
    var anterior = LP.ORDEM_ESTADOS.indexOf(resumo[i - 1].estado);
    assert.ok(LP.ORDEM_ESTADOS.indexOf(resumo[i].estado) >= anterior, "ordem quebrou em " + resumo[i].area);
  }
});

test("RN-03: ponto sem limite declarado não recebe estado de risco em recorte nenhum", function () {
  var monitorados = TODOS.filter(function (p) { return p.estado === "monitoramento"; });

  assert.equal(monitorados.length, M.DADOS.total_monitoramento);
  monitorados.forEach(function (p) {
    assert.equal(p.limit_c, null, p.measurement_id);
    assert.equal(p.margem_c, null, p.measurement_id);
  });

  LP.reprovados(TODOS).forEach(function (p) { assert.notEqual(p.estado, "monitoramento"); });
});

test("pecasDeContato fica nos subsistemas que a pessoa toca", function () {
  var pecas = LP.pecasDeContato(TODOS);
  var esperado = TODOS.filter(function (p) {
    return LP.AREAS_DE_CONTATO.indexOf(p.Key_Area) >= 0;
  }).length;

  assert.equal(pecas.length, esperado);
  assert.ok(pecas.length > 0, "manípulos e console precisam existir na base");
  pecas.forEach(function (p) {
    assert.ok(LP.AREAS_DE_CONTATO.indexOf(p.Key_Area) >= 0, p.measurement_id);
  });
});

test("RNF-07: os três públicos têm rótulo próprio para os quatro estados", function () {
  LP.PUBLICOS.forEach(function (publico) {
    LP.ORDEM_ESTADOS.forEach(function (estado) {
      var rotulo = LP.traduzirEstado(estado, publico);

      assert.ok(rotulo && rotulo !== "—", publico + " / " + estado);
      assert.notEqual(rotulo, LP.ROTULO_CANONICO[estado],
        publico + " caiu no rótulo canônico em " + estado + ": falta mapeamento");
    });
  });

  // Público desconhecido não quebra a tela: cai no rótulo da triagem.
  assert.equal(LP.traduzirEstado("acima_do_limite", "inexistente"), LP.ROTULO_CANONICO.acima_do_limite);
  assert.equal(LP.traduzirEstado("inventado", "design"), "—");
});

test("RN-07: nenhum estado é apresentado como aprovação", function () {
  LP.PUBLICOS.forEach(function (publico) {
    LP.ORDEM_ESTADOS.forEach(function (estado) {
      var rotulo = LP.traduzirEstado(estado, publico).toLowerCase();
      assert.ok(rotulo.indexOf("aprovad") < 0, publico + " / " + estado + ": " + rotulo);
      assert.ok(rotulo.indexOf("conforme") < 0, publico + " / " + estado + ": " + rotulo);
    });
  });
});

test("RN-05: a consulta é localizada no histórico pelos seis fatores categóricos", function () {
  var mat = LP.maturidade(M.DADOS, M.CATALOGO);
  var chaves = ["blower_direction", "housing", "board_position", "run_case", "deflector_hole", "material_coil_support"];

  var compativeis = M.CATALOGO.configuracoes.filter(function (c) {
    return chaves.every(function (k) { return c.fatores[k] === M.DADOS.configuracao[k]; });
  }).map(function (c) { return c.id; });

  assert.equal(mat.no_historico, true);
  assert.ok(compativeis.indexOf(mat.configuracao_id) >= 0, mat.configuracao_id);
  assert.ok(compativeis.indexOf(M.CATALOGO.config_referencia_triagem) >= 0,
    "a configuração exibida na triagem tem de estar entre as compatíveis");
  assert.ok(mat.rodadas > 0);

  // Data-base do treino não existe até haver modelo: a tela mostra o traço.
  assert.equal(mat.data_base_treino, null);
  assert.equal(mat.ilustrativo, true);
  assert.equal(mat.versao_modelo, "stub");
});

test("configuração fora do vocabulário da base é sinalizada como nova", function () {
  var inventada = { configuracao: { blower_direction: "To Front", housing: "Closed", board_position: "Center", run_case: "Broil C1", deflector_hole: "Open", material_coil_support: "Plastic" } };
  var mat = LP.maturidade(inventada, { configuracoes: [] });

  assert.equal(mat.no_historico, false);
  assert.equal(mat.configuracao_id, null);
  assert.equal(mat.rodadas, 0);
});

test("a procedência do registro tem campo curto e diz o que o arquivo não é", function () {
  var meta = LP.metadadosDoRegistro(LP.maturidade(M.DADOS, M.CATALOGO));
  var campos = meta.map(function (par) { return par[0]; });

  meta.forEach(function (par) {
    assert.equal(par.length, 2, par[0]);
    assert.ok(par[0].length <= 24, "campo longo: " + par[0]);
    assert.ok(String(par[1]).length <= 46, "valor maior que a largura da coluna: " + par[1]);
  });

  assert.ok(campos.indexOf("Tipo de registro") >= 0);
  assert.ok(campos.indexOf("Ressalva") >= 0, "o arquivo tem de dizer o que não é");
  assert.ok(campos.indexOf("Modelo") >= 0);
  assert.ok(campos.indexOf("Data-base do treino") >= 0);
  assert.ok(campos.indexOf("Configuração") >= 0);
});

test("nenhum código de requisito vaza para o arquivo exportado", function () {
  var meta = LP.metadadosDoRegistro(LP.maturidade(M.DADOS, M.CATALOGO));
  var texto = meta.map(function (par) { return par.join(" "); }).join(" ");

  // RF-22, RN-03 e afins são vocabulário do projeto, não de quem recebe o arquivo.
  assert.equal(/\b(RF|RN|RNF)-\d+/.test(texto), false, texto);
});

test("a data do registro sai legível, e não em formato de máquina", function () {
  assert.equal(LP.dataLegivel(new Date(2026, 8, 19, 9, 5)), "19/09/2026 09:05");
  assert.equal(LP.dataLegivel(new Date(2026, 11, 31, 23, 59)), "31/12/2026 23:59");
});

test("ler para um público não altera o dado nem o estado de risco", function () {
  var antes = JSON.stringify(M.DADOS);

  TODOS.forEach(function (p) { Object.freeze(p); });
  LP.reprovados(TODOS);
  LP.porSubsistema(TODOS);
  LP.pecasDeContato(TODOS);
  LP.ordenarPorRisco(TODOS);

  assert.equal(JSON.stringify(M.DADOS), antes);
});

test("RF-23: o cabeçalho de rastreabilidade lista os fatores na ordem do esquema", function () {
  var linhas = LP.linhasDaConfiguracao(M.DADOS.configuracao, M.SCHEMA);
  var rotulos = linhas.map(function (l) { return l[0]; });

  // Sete fatores, mas `losses` é composto: entra pelos subcampos preenchidos.
  assert.equal(rotulos[0], "Direção do soprador");
  assert.ok(rotulos.indexOf("Perda declarada") > 0);
  assert.ok(rotulos.indexOf("Material do suporte da bobina") > 0);

  // Rótulo legível, não o valor cru da coluna de origem.
  var direcao = linhas[0][1];
  assert.notEqual(direcao, "To Front");
  assert.ok(direcao.indexOf("To Front") === 0, direcao);
});

test("RN-04: valor fora do vocabulário aparece cru e marcado, não por aproximação", function () {
  var linhas = LP.linhasDaConfiguracao({ blower_direction: "To Side" }, M.SCHEMA);

  assert.equal(linhas.length, 1);
  assert.equal(linhas[0][1], "To Side (fora do vocabulário)");
  assert.equal(LP.rotuloDoNivel([], "qualquer"), "qualquer (fora do vocabulário)");

  // Campo que não se aplica sai da lista, como sai do formulário.
  assert.equal(LP.linhasDaConfiguracao({ housing: "" }, M.SCHEMA).length, 0);
});

test("a configuração chega da querystring com o fator composto aninhado", function () {
  var config = LP.configuracaoDaUrl("?run_case=Broil+C2&losses.present=declared&losses.config=Config+S");

  // JSON: cada contexto vm tem o próprio Object.prototype, e deepEqual
  // estrito compara protótipos.
  assert.equal(JSON.stringify(config), JSON.stringify({
    run_case: "Broil C2",
    losses: { present: "declared", config: "Config S" }
  }));

  assert.equal(LP.configuracaoDaUrl(""), null);
  assert.equal(LP.configuracaoDaUrl("?"), null);
});

test("RN-05: é a configuração avaliada que se procura no histórico, não a do payload", function () {
  // Pyro com soprador para trás, alojamento aberto, placa à direita, defletor
  // aberto e suporte plástico não é nenhuma das 32 rodadas da base.
  var daUrl = LP.configuracaoDaUrl(
    "?run_case=Pyro&blower_direction=To+Back&housing=Open&board_position=Right" +
    "&deflector_hole=Open&material_coil_support=Plastic&losses.present=none");

  assert.equal(LP.maturidade(M.DADOS, M.CATALOGO).no_historico, true, "a do payload consta");
  assert.equal(LP.maturidade(M.DADOS, M.CATALOGO, daUrl).no_historico, false,
    "a da querystring não pode herdar o selo da configuração do payload");

  // Os metadados do modelo continuam vindo do payload.
  assert.equal(LP.maturidade(M.DADOS, M.CATALOGO, daUrl).versao_modelo, "stub");
});

test("os pontos de contato do catálogo são os mesmos dez da triagem", function () {
  var indices = LP.indicesDeContato(M.CATALOGO);
  var daTriagem = LP.pecasDeContato(TODOS);

  assert.equal(indices.length, 10);
  assert.equal(daTriagem.length, 10);

  indices.forEach(function (i) {
    var ponto = M.CATALOGO.pontos[i];
    assert.ok(LP.AREAS_DE_CONTATO.indexOf(ponto.area) >= 0, ponto.id);
    assert.equal(ponto.mono, false, "ponto sem limite não entra no semáforo de contato");
  });
});

test("a leitura de contato de uma configuração bate com a triagem daquela configuração", function () {
  var cfg = M.CATALOGO.configuracoes.filter(function (c) {
    return c.id === M.CATALOGO.config_referencia_triagem;
  })[0];
  var leitura = LP.leituraDeContato(M.CATALOGO, cfg);
  var daTriagem = LP.pecasDeContato(TODOS).filter(function (p) { return p.estado !== "monitoramento"; });

  // A configuração de referência reproduz o payload da triagem ponto a ponto.
  assert.equal(leitura.total, 10);
  assert.equal(leitura.estado, daTriagem[0].estado);
  // Os dois arquivos guardam a mesma folga com arredondamentos diferentes: o
  // catálogo já vem em duas casas, a triagem traz o ponto flutuante inteiro.
  assert.ok(Math.abs(leitura.pior_margem_c - daTriagem[0].margem_c) < 0.005,
    leitura.pior_margem_c + " contra " + daTriagem[0].margem_c);
  assert.equal(leitura.pior_ponto.nome, daTriagem[0].TC_Name);
});

test("RN-02 vale também no semáforo de contato", function () {
  var catalogo = {
    pontos: [
      { id: "a", nome: "A", area: "CT Knobs", mono: false },
      { id: "b", nome: "B", area: "Oven HMI", mono: false },
      { id: "c", nome: "C", area: "Mainback", mono: false }
    ],
    estados: M.CATALOGO.estados
  };
  // B está acima do limite; A tem folga larga. O conjunto não fica na média.
  var leitura = LP.leituraDeContato(catalogo, { e: [2, 0, 0], m: [40, -3, -99] });

  assert.equal(leitura.total, 2, "Mainback não é peça de contato");
  assert.equal(leitura.estado, "acima_do_limite");
  assert.equal(leitura.pior_ponto.nome, "B", "o ponto fora do contato não pode ser o que decide");
  assert.equal(leitura.pior_margem_c, -3);
});

test("o efeito por fator cobre todos os níveis presentes na base", function () {
  LP.FATORES_DE_DESIGN.forEach(function (chave) {
    var niveis = LP.efeitoDoFator(M.CATALOGO, chave);
    var soma = niveis.reduce(function (acc, n) { return acc + n.configuracoes; }, 0);

    assert.ok(niveis.length >= 2, chave + " precisa de mais de um nível para haver escolha");
    assert.equal(soma, M.CATALOGO.total_configuracoes, chave);

    niveis.forEach(function (n) {
      assert.ok(n.configuracoes > 0, chave + " / " + n.nivel);
      assert.ok(n.criticas <= n.configuracoes, chave + " / " + n.nivel);
      if (n.pior_ponto) {
        assert.ok(LP.AREAS_DE_CONTATO.indexOf(n.pior_ponto.area) >= 0, n.pior_ponto.id);
      }
    });
  });
});

test("as alternativas mudam só o que o design decide", function () {
  var alternativas = LP.alternativasDeDesign(M.CATALOGO, M.DADOS.configuracao);
  var fixos = ["blower_direction", "housing", "board_position", "run_case"];
  var vistas = {};

  assert.ok(alternativas.length >= 2, "sem segunda opção não há o que comparar");

  alternativas.forEach(function (a) {
    fixos.forEach(function (chave) {
      assert.equal(a.fatores[chave], undefined, chave + " não é escolha de design e não entra na linha");
    });
    assert.equal(a.escolha.length, 2);

    // Um par de níveis por linha: rodadas que diferem só no arranjo de bobinas
    // descrevem a mesma escolha de design.
    var chave = a.escolha.join("|");
    assert.equal(vistas[chave], undefined, "par repetido: " + chave);
    vistas[chave] = true;

    assert.ok(a.configuracoes.length >= 1);
    assert.ok(a.rodadas >= a.configuracoes.length);
  });

  var consultadas = alternativas.filter(function (a) { return a.igual_a_consulta; });
  assert.equal(consultadas.length, 1, "a própria consulta aparece uma vez entre as alternativas");
  assert.equal(consultadas[0].fatores.deflector_hole, M.DADOS.configuracao.deflector_hole);
  assert.equal(consultadas[0].fatores.material_coil_support, M.DADOS.configuracao.material_coil_support);
});

test("configuração sem par no histórico não inventa alternativa", function () {
  var alternativas = LP.alternativasDeDesign(M.CATALOGO, {
    blower_direction: "To Back", housing: "Open - Updated", board_position: "Right", run_case: "Broil C1"
  });
  assert.equal(alternativas.length, 0);
});
