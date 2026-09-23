/* Testes do widget do Robertão: o que ele manda à API e o que faz com a
 * resposta.
 *
 * Rodar da raiz do repositório:  node --test dashboard/testes/chat_widget.test.js
 *
 * O painel é DOM puro, então aqui há um dublê mínimo de document, fetch e
 * sessionStorage. É o bastante para checar o que importa e não pode quebrar:
 * o corpo da requisição, o histórico e o fato de a resposta entrar como
 * texto, nunca como HTML.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var FONTE = fs.readFileSync(
  path.join(__dirname, "..", "js", "chat.js"), "utf8"
);

function criarElemento(tag) {
  var elemento = {
    tagName: tag,
    children: [],
    eventos: {},
    classes: [],
    className: "",
    style: {},
    atributos: {},
    textContent: "",
    value: "",
    hidden: false,
    parentNode: null,
    scrollHeight: 0,
    scrollTop: 0,
    classList: {
      add: function (nome) {
        if (elemento.classes.indexOf(nome) < 0) elemento.classes.push(nome);
      },
      remove: function (nome) {
        elemento.classes = elemento.classes.filter(function (c) { return c !== nome; });
      },
      toggle: function (nome, ligado) {
        if (ligado) elemento.classList.add(nome);
        else elemento.classList.remove(nome);
      },
      contains: function (nome) { return elemento.classes.indexOf(nome) >= 0; }
    },
    appendChild: function (filho) {
      filho.parentNode = elemento;
      elemento.children.push(filho);
      return filho;
    },
    removeChild: function (filho) {
      elemento.children = elemento.children.filter(function (c) { return c !== filho; });
      filho.parentNode = null;
    },
    replaceChild: function (novo, antigo) {
      elemento.children = elemento.children.map(function (c) {
        return c === antigo ? novo : c;
      });
      novo.parentNode = elemento;
    },
    addEventListener: function (nome, fn) {
      (elemento.eventos[nome] = elemento.eventos[nome] || []).push(fn);
    },
    setAttribute: function (chave, valor) { elemento.atributos[chave] = valor; },
    getAttribute: function (chave) { return elemento.atributos[chave]; },
    focus: function () {},
    contains: function (outro) {
      if (outro === elemento) return true;
      return elemento.children.some(function (filho) {
        return filho.contains && filho.contains(outro);
      });
    },
    disparar: function (nome, evento) {
      (elemento.eventos[nome] || []).forEach(function (fn) {
        fn.call(elemento, evento || {});
      });
    }
  };
  return elemento;
}

/* Junta o texto da árvore, como o textContent de um DOM real. O balão agora
   tem filhos (parágrafos, negrito, itens de lista) em vez de texto cru. */
function textoDe(elemento) {
  if (!elemento.children.length) return elemento.textContent;
  return elemento.children.map(textoDe).join("");
}

function marcadas(elemento, tag) {
  var achados = elemento.tagName === tag ? [elemento] : [];
  elemento.children.forEach(function (filho) {
    achados = achados.concat(marcadas(filho, tag));
  });
  return achados;
}

function temClasse(elemento, nome) {
  return elemento.classes.indexOf(nome) >= 0 ||
    String(elemento.className).split(" ").indexOf(nome) >= 0;
}

/* Monta o widget com um fetch controlado. `respostas` é a fila consumida a
   cada requisição: objeto vira corpo 200, Error vira falha de rede. */
function montar(respostas, saude) {
  saude = saude || { warm: "cold" };
  var corpo = criarElemento("body");
  var pedidos = [];
  var aquecimentos = [];

  var documento = {
    body: corpo,
    eventos: {},
    createElement: criarElemento,
    createTextNode: function (valor) {
      var no = criarElemento("#text");
      no.textContent = valor;
      return no;
    },
    addEventListener: function (nome, fn) {
      (documento.eventos[nome] = documento.eventos[nome] || []).push(fn);
    }
  };

  var contexto = {
    window: {},
    document: documento,
    sessionStorage: {
      getItem: function () { return null; },
      setItem: function () {}
    },
    setInterval: function () { return 0; },
    clearInterval: function () {},
    Math: Math,
    Date: Date,
    JSON: JSON,
    fetch: function (url, opcoes) {
      if (/\/api\/health$/.test(url)) {
        return Promise.resolve({ ok: true, status: 200,
                                 json: function () { return Promise.resolve(saude); } });
      }

      if (/\/api\/warmup$/.test(url)) {
        aquecimentos.push(url);
        return Promise.resolve({ ok: true, status: 202,
                                 json: function () { return Promise.resolve({}); } });
      }

      pedidos.push({ url: url, corpo: JSON.parse(opcoes.body) });
      var proxima = respostas.shift();
      if (proxima instanceof Error) return Promise.reject(proxima);
      return Promise.resolve({
        ok: proxima.status === undefined || proxima.status < 400,
        status: proxima.status || 200,
        json: function () { return Promise.resolve(proxima); }
      });
    }
  };

  vm.createContext(contexto);
  vm.runInContext(FONTE, contexto, { filename: "chat.js" });

  var lancador = corpo.children.filter(function (el) {
    return el.className === "chat-launcher";
  })[0];
  var painel = corpo.children.filter(function (el) {
    return el.className === "chat-panel";
  })[0];
  var log = painel.children.filter(function (el) {
    return el.className === "chat-log";
  })[0];
  var form = painel.children.filter(function (el) {
    return el.className === "chat-form";
  })[0];
  var campo = form.children[0];

  return {
    documento: documento,
    pedidos: pedidos,
    aquecimentos: aquecimentos,
    lancador: lancador,
    painel: painel,
    log: log,
    form: form,
    campo: campo,
    baloes: function () {
      return log.children.filter(function (el) {
        return temClasse(el, "chat-msg");
      });
    },
    perguntar: function (texto) {
      campo.value = texto;
      form.disparar("submit", { preventDefault: function () {} });
      return esperar();
    },
    abrir: function () {
      lancador.disparar("click");
      return esperar();
    },
    clicarEm: function (elemento) {
      (documento.eventos.click || []).forEach(function (fn) {
        fn({ target: elemento });
      });
    }
  };
}

// Um salto de macrotask drena a fila de microtasks inteira, e a cadeia do
// fetch tem catch e then encadeados em profundidade variável.
function esperar() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

test("o painel começa fechado e o lançador é o único visível", function () {
  var widget = montar([]);

  assert.equal(widget.painel.hidden, true);
  assert.equal(widget.lancador.getAttribute("aria-expanded"), "false");
});

test("abrir não fala nada: o assistente espera a primeira mensagem", async function () {
  var widget = montar([]);

  await widget.abrir();

  assert.equal(widget.painel.hidden, false);
  // Nenhuma requisição: abrir o painel não é uma pergunta.
  assert.equal(widget.pedidos.length, 0);
  assert.equal(widget.baloes().length, 0);
});

test("a primeira pergunta é que faz o assistente se apresentar", async function () {
  var widget = montar([
    { answer: "Olá! Eu sou o Robertão.", action: "answer", sources: [] }
  ]);

  await widget.abrir();
  await widget.perguntar("oi");

  assert.equal(widget.pedidos.length, 1);
  assert.match(widget.pedidos[0].url, /\/api\/chat$/);
  assert.equal(widget.pedidos[0].corpo.message, "oi");

  var baloes = widget.baloes();
  assert.equal(baloes.length, 2);
  assert.ok(temClasse(baloes[0], "chat-msg--user"));
  assert.equal(textoDe(baloes[1]), "Olá! Eu sou o Robertão.");
});

test("negrito, itálico, código e lista viram elementos, não asteriscos", async function () {
  var resposta = [
    "O fator **Blower Direction** define o fluxo.",
    "",
    "- **To Front**: sopra para a frente",
    "- *To Back*: sopra para tras",
    "",
    "Use `mode=compare` para comparar."
  ].join("\n");
  var widget = montar([{ answer: resposta, action: "answer", sources: [] }]);

  await widget.abrir();
  await widget.perguntar("o que é Blower Direction?");

  var balao = widget.baloes()[1];

  // Nenhum asterisco sobra na tela.
  assert.ok(!/[*`]/.test(textoDe(balao)), textoDe(balao));

  var fortes = marcadas(balao, "strong").map(textoDe);
  assert.deepEqual(fortes, ["Blower Direction", "To Front"]);
  assert.deepEqual(marcadas(balao, "em").map(textoDe), ["To Back"]);
  assert.deepEqual(marcadas(balao, "code").map(textoDe), ["mode=compare"]);

  // Os dois itens ficam numa lista só.
  var listas = marcadas(balao, "ul");
  assert.equal(listas.length, 1);
  assert.equal(marcadas(balao, "li").length, 2);

  // E o texto corrido continua em parágrafos.
  assert.equal(marcadas(balao, "p").length, 2);
});

test("o painel vazio mostra uma dica, que sai na primeira mensagem", async function () {
  var widget = montar([{ answer: "Olá!", action: "answer", sources: [] }]);
  await widget.abrir();

  var dicas = widget.log.children.filter(function (el) {
    return el.className === "chat-empty";
  });
  assert.equal(dicas.length, 1);
  assert.match(textoDe(dicas[0]), /pergunte/i);

  await widget.perguntar("oi");

  assert.equal(widget.log.children.filter(function (el) {
    return el.className === "chat-empty";
  }).length, 0);
});

test("a resposta entra como texto, nunca como HTML", async function () {
  var veneno = '<img src=x onerror="alert(1)">';
  var widget = montar([{ answer: veneno, action: "answer", sources: [] }]);

  await widget.abrir();
  await widget.perguntar("oi");

  var balao = widget.baloes()[1];
  assert.equal(textoDe(balao), veneno);
  // Nada foi interpretado como marcação: nenhum nó além de texto.
  assert.equal(balao.innerHTML, undefined);
  assert.equal(marcadas(balao, "img").length, 0);
});

test("a pergunta seguinte leva o histórico da conversa", async function () {
  var widget = montar([
    { answer: "Olá!", action: "answer", sources: [] },
    { answer: "Blower Direction é a direção do soprador.", action: "answer", sources: ["glossario.md"] }
  ]);

  await widget.abrir();
  await widget.perguntar("oi");
  await widget.perguntar("o que é Blower Direction?");

  var segundo = widget.pedidos[1].corpo;
  assert.equal(segundo.message, "o que é Blower Direction?");
  assert.deepEqual(segundo.history, [
    { role: "user", content: "oi" },
    { role: "assistant", content: "Olá!" },
    { role: "user", content: "o que é Blower Direction?" }
  ]);

  var baloes = widget.baloes();
  assert.equal(baloes.length, 4);
  assert.ok(temClasse(baloes[2], "chat-msg--user"));
  var ultimo = baloes[3];
  assert.match(textoDe(ultimo.children[ultimo.children.length - 1]), /glossario\.md/);
});

test("recusa por falta de evidência não se parece com resposta confirmada", async function () {
  var widget = montar([
    { answer: "Olá!", action: "answer", sources: [] },
    { answer: "Não encontrei esse dado.", action: "insufficient_data", sources: [] }
  ]);

  await widget.abrir();
  await widget.perguntar("oi");
  await widget.perguntar("qual a temperatura do TC99?");

  var ultimo = widget.baloes().pop();
  assert.ok(temClasse(ultimo, "chat-msg--insufficient"));
});

test("backend fora do ar vira aviso e não entra no histórico", async function () {
  var widget = montar([
    { answer: "Olá!", action: "answer", sources: [] },
    new Error("connection refused"),
    { answer: "Agora respondi.", action: "answer", sources: [] }
  ]);

  await widget.abrir();
  await widget.perguntar("oi");
  await widget.perguntar("e agora?");

  var ultimo = widget.baloes().pop();
  assert.ok(temClasse(ultimo, "chat-msg--erro"));
  assert.match(textoDe(ultimo), /não consegui falar com o backend/i);

  await widget.perguntar("de novo");

  // A falha ficou fora do contexto: o modelo não responde sobre o erro.
  var historico = widget.pedidos[2].corpo.history;
  var conteudos = historico.map(function (m) { return m.content; });
  assert.ok(conteudos.every(function (texto) { return !/backend/i.test(texto); }));
});

test("a API respondendo erro mostra o detalhe que ela deu", async function () {
  var widget = montar([
    { answer: "Olá!", action: "answer", sources: [] },
    { status: 503, detail: "O Ollama não respondeu." }
  ]);

  await widget.abrir();
  await widget.perguntar("oi");
  await widget.perguntar("previsão para Broil C2?");

  var ultimo = widget.baloes().pop();
  assert.ok(temClasse(ultimo, "chat-msg--erro"));
  assert.equal(textoDe(ultimo), "O Ollama não respondeu.");
});


test("o avatar sinaliza a espera e volta ao normal quando responde", async function () {
  var widget = montar([{ answer: "Olá!", action: "answer", sources: [] }]);

  widget.lancador.disparar("click");
  widget.campo.value = "oi";
  widget.form.disparar("submit", { preventDefault: function () {} });

  // Ainda sem resposta: o botão e o cabeçalho mostram que ele está pensando.
  assert.ok(temClasse(widget.lancador, "chat-launcher--pensando"));
  assert.ok(temClasse(widget.painel, "chat-panel--pensando"));

  await esperar();

  assert.ok(!temClasse(widget.lancador, "chat-launcher--pensando"));
  assert.ok(!temClasse(widget.painel, "chat-panel--pensando"));
});

test("resposta com o painel fechado chama a atenção; abrir desliga o chamado", async function () {
  var widget = montar([
    { answer: "Olá!", action: "answer", sources: [] },
    { answer: "Respondi depois que você fechou.", action: "answer", sources: [] }
  ]);

  await widget.abrir();
  await widget.perguntar("oi");
  widget.campo.value = "e aquela comparação?";
  widget.form.disparar("submit", { preventDefault: function () {} });
  widget.lancador.disparar("click");   // fecha enquanto a resposta não chegou
  await esperar();

  assert.equal(widget.painel.hidden, true);
  assert.ok(temClasse(widget.lancador, "chat-launcher--novo"));

  await widget.abrir();

  assert.ok(!temClasse(widget.lancador, "chat-launcher--novo"));
});


test("clicar fora fecha o painel; clicar dentro mantém aberto", async function () {
  var widget = montar([{ answer: "Olá!", action: "answer", sources: [] }]);
  await widget.abrir();
  await widget.perguntar("oi");

  var fora = criarElemento("div");   // qualquer ponto da página atrás
  widget.clicarEm(widget.log);
  assert.equal(widget.painel.hidden, false, "clique dentro não pode fechar");

  widget.clicarEm(widget.baloes()[0]);
  assert.equal(widget.painel.hidden, false, "clique num balão não pode fechar");

  widget.clicarEm(fora);
  assert.equal(widget.painel.hidden, true);
  assert.equal(widget.lancador.getAttribute("aria-expanded"), "false");
});

test("clicar no lançador com o painel aberto fecha uma vez só", async function () {
  var widget = montar([{ answer: "Olá!", action: "answer", sources: [] }]);
  await widget.abrir();

  // O navegador dispara o handler do botão e depois o do documento; se o
  // segundo também fechasse, o painel abriria e fecharia no mesmo clique.
  widget.lancador.disparar("click");
  widget.clicarEm(widget.lancador);

  assert.equal(widget.painel.hidden, true);
});


test("abrir manda aquecer o prompt, sem falar nada no painel", async function () {
  var widget = montar([{ answer: "Olá!", action: "answer", sources: [] }]);

  await widget.abrir();
  await esperar();

  assert.equal(widget.aquecimentos.length, 1);
  // Aquecer não é conversar: nenhuma pergunta foi enviada nem exibida.
  assert.equal(widget.pedidos.length, 0);
  assert.equal(widget.baloes().length, 0);

  // Fechar e reabrir não repete o aquecimento.
  widget.lancador.disparar("click");
  await widget.abrir();
  await esperar();
  assert.equal(widget.aquecimentos.length, 1);
});

test("prompt já aquecido não gera pedido de aquecimento", async function () {
  /* O Ollama atende um pedido por vez: aquecer sem precisar poria a pergunta
     seguinte na fila atrás de uma avaliação de ~120 s. */
  var widget = montar([{ answer: "Olá!", action: "answer", sources: [] }],
                      { warm: "warm" });

  await widget.abrir();
  await esperar();

  assert.equal(widget.aquecimentos.length, 0);
});
