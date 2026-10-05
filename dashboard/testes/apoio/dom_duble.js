/* DOM dublê para carregar uma tela do painel dentro do `node --test`.
 *
 * Não é um navegador: não há layout, estilo calculado nem eventos de verdade.
 * O que ele dá é árvore — criar elemento, pendurar filho, ler texto — que é o
 * bastante para conferir *o que a tela montou*, e é o que separa "a lógica
 * decidiu certo" de "o usuário vê".
 *
 * Duas escolhas importam:
 *
 *   `getElementById` cria o elemento que pedirem e devolve sempre o mesmo, de
 *   modo que uma tela com dezenas de ids carrega sem o teste listar o HTML.
 *
 *   `textContent` se comporta como no DOM real: atribuir substitui o conteúdo
 *   por um único nó de texto, que continua lá quando a tela faz `appendChild`
 *   depois. Sem isso, uma célula que recebe texto *e* um filho perderia o
 *   texto, e o teste acusaria defeito onde não há.
 *
 * `appendChild` recusa `null` de propósito: no navegador isso é TypeError, e
 * deixar passar esconderia o caso de a tela pendurar um elemento que não foi
 * construído.
 */

"use strict";

/* Seletor mínimo: nome de tag, `.classe`, `#id`, `[atributo]` e listas separadas
   por vírgula, combináveis (`button.ativo`). É o que as telas usam; qualquer
   coisa além disso estoura em vez de devolver vazio em silêncio, porque um
   seletor que não casa nada é indistinguível de um seletor não suportado — e o
   segundo faria o teste passar por engano. */
function casa(no, seletor) {
  var partes = seletor.match(/^[a-zA-Z][\w-]*|\.[\w-]+|#[\w-]+|\[[\w-]+\]/g);

  if (!partes || partes.join("") !== seletor) {
    throw new Error("dom_duble: seletor não suportado: " + JSON.stringify(seletor));
  }

  return partes.every(function (parte) {
    if (parte[0] === ".") return no.classes.indexOf(parte.slice(1)) >= 0 ||
      (no.className || "").split(/\s+/).indexOf(parte.slice(1)) >= 0;
    if (parte[0] === "#") return no.atributos.id === parte.slice(1) || no.id === parte.slice(1);
    if (parte[0] === "[") return no.hasAttribute(parte.slice(1, -1));
    return no.tagName === parte;
  });
}

function buscar(raiz, seletor) {
  var alternativas = String(seletor).split(",").map(function (s) { return s.trim(); });
  var achados = [];

  (function andar(atual) {
    if (!atual.children) return;

    atual.children.forEach(function (filho) {
      if (alternativas.some(function (s) { return casa(filho, s); })) achados.push(filho);
      andar(filho);
    });
  })(raiz);

  return achados;
}

function criarElemento(tag) {
  var textoProprio = "";

  var elemento = {
    tagName: tag,
    children: [],
    classes: [],
    className: "",
    style: {},
    dataset: {},
    atributos: {},
    title: "",
    value: "",
    hidden: false,
    disabled: false,
    eventos: {},
    classList: {
      add: function (n) { if (elemento.classes.indexOf(n) < 0) elemento.classes.push(n); },
      remove: function (n) {
        elemento.classes = elemento.classes.filter(function (c) { return c !== n; });
      },
      toggle: function (n, ligado) {
        if (ligado) elemento.classList.add(n); else elemento.classList.remove(n);
      },
      contains: function (n) { return elemento.classes.indexOf(n) >= 0; }
    },
    appendChild: function (filho) {
      if (!filho) {
        throw new TypeError("appendChild recebeu " + filho + ": a tela montaria quebrada");
      }
      elemento.children.push(filho);
      filho.parentNode = elemento;
      return filho;
    },
    insertBefore: function (filho, referencia) {
      var i = elemento.children.indexOf(referencia);
      if (i < 0) elemento.children.push(filho);
      else elemento.children.splice(i, 0, filho);
      filho.parentNode = elemento;
      return filho;
    },
    removeChild: function (filho) {
      elemento.children = elemento.children.filter(function (c) { return c !== filho; });
      filho.parentNode = null;
    },
    replaceChildren: function () {
      elemento.children = Array.prototype.slice.call(arguments);
    },
    addEventListener: function (nome, fn) {
      (elemento.eventos[nome] = elemento.eventos[nome] || []).push(fn);
    },
    removeEventListener: function () {},
    dispatchEvent: function (evento) {
      var nome = evento && evento.type;
      (elemento.eventos[nome] || []).forEach(function (fn) { fn.call(elemento, evento); });
      return true;
    },
    setAttribute: function (c, v) { elemento.atributos[c] = v; },
    getAttribute: function (c) {
      return Object.prototype.hasOwnProperty.call(elemento.atributos, c)
        ? elemento.atributos[c] : null;
    },
    removeAttribute: function (c) { delete elemento.atributos[c]; },
    hasAttribute: function (c) {
      return Object.prototype.hasOwnProperty.call(elemento.atributos, c);
    },
    getBoundingClientRect: function () {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    scrollIntoView: function () {},
    focus: function () {},
    blur: function () {},
    closest: function () { return null; },
    querySelector: function (seletor) { return buscar(elemento, seletor)[0] || null; },
    querySelectorAll: function (seletor) { return buscar(elemento, seletor); },
    insertAdjacentHTML: function () {}
  };

  Object.defineProperty(elemento, "firstChild", {
    get: function () { return elemento.children[0] || null; }
  });

  /* `options` de um `select` e `elements` de um `form`, como no DOM real: vistas
     vivas sobre a árvore, e não listas que o teste precisa manter em dia. É o que
     permite exercitar um formulário — escolher um nível, disparar `change`, ver o
     que ficou habilitado — sem navegador. */
  Object.defineProperty(elemento, "options", {
    enumerable: false,
    configurable: true,
    get: function () {
      return elemento.children.filter(function (filho) { return filho.tagName === "option"; });
    }
  });

  Object.defineProperty(elemento, "elements", {
    enumerable: false,
    configurable: true,
    get: function () {
      var campos = [];

      (function andar(atual) {
        atual.children.forEach(function (filho) {
          if (filho.name) campos.push(filho);
          andar(filho);
        });
      })(elemento);

      campos.forEach(function (campo) {
        if (!(campo.name in campos)) campos[campo.name] = campo;
      });

      return campos;
    }
  });

  Object.defineProperty(elemento, "textContent", {
    enumerable: true,
    configurable: true,
    get: function () {
      if (tag === "#text") return textoProprio;
      return elemento.children.map(function (filho) { return filho.textContent; }).join("");
    },
    set: function (valor) {
      if (tag === "#text") {
        textoProprio = valor === null || valor === undefined ? "" : String(valor);
        return;
      }

      elemento.children = [];

      if (valor === null || valor === undefined || valor === "") return;

      var no = criarElemento("#text");
      no.textContent = String(valor);
      elemento.children.push(no);
    }
  });

  return elemento;
}

function criarDocumento() {
  var porId = {};

  var documento = {
    porId: porId,
    documentElement: criarElemento("html"),
    createElement: criarElemento,
    createElementNS: function (_ns, tag) { return criarElemento(tag); },
    createTextNode: function (texto) {
      var no = criarElemento("#text");
      no.textContent = texto;
      return no;
    },
    createDocumentFragment: function () { return criarElemento("#fragment"); },
    getElementById: function (id) {
      if (!porId[id]) porId[id] = criarElemento("div");
      return porId[id];
    },
    getElementsByClassName: function (classe) { return buscar(documento.body, "." + classe); },
    querySelector: function (seletor) { return buscar(documento.body, seletor)[0] || null; },
    querySelectorAll: function (seletor) { return buscar(documento.body, seletor); },
    addEventListener: function () {},
    removeEventListener: function () {}
  };

  documento.body = criarElemento("body");
  documento.head = criarElemento("head");

  return documento;
}

/* Janela mínima, com o que as telas costumam consultar na carga. */
function criarJanela(documento, busca) {
  var janela = {
    document: documento || criarDocumento(),
    location: {
      search: busca || "",
      href: "http://127.0.0.1:5500/tela.html" + (busca || ""),
      hash: "",
      pathname: "/tela.html"
    },
    navigator: { userAgent: "node", language: "pt-BR" },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 900,
    addEventListener: function () {},
    removeEventListener: function () {},
    matchMedia: function () {
      return { matches: false, addEventListener: function () {}, addListener: function () {} };
    },
    getComputedStyle: function () {
      return { getPropertyValue: function () { return ""; } };
    },
    requestAnimationFrame: function () { return 0; },
    cancelAnimationFrame: function () {},
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    sessionStorage: armazenamento(),
    localStorage: armazenamento(),
    console: console,
    Event: function (tipo) { return { type: tipo }; },
    CustomEvent: function (tipo, opcoes) {
      return { type: tipo, detail: opcoes && opcoes.detail };
    },
    URL: URL,
    URLSearchParams: URLSearchParams,
    TextEncoder: TextEncoder,
    Blob: function () { return {}; },
    fetch: function () { return Promise.reject(new Error("sem rede no dublê")); }
  };

  janela.window = janela;
  janela.self = janela;

  return janela;
}

function armazenamento() {
  var itens = {};

  return {
    getItem: function (c) {
      return Object.prototype.hasOwnProperty.call(itens, c) ? itens[c] : null;
    },
    setItem: function (c, v) { itens[c] = String(v); },
    removeItem: function (c) { delete itens[c]; },
    clear: function () { itens = {}; }
  };
}

/* Todos os descendentes com a classe pedida, em profundidade. */
function comClasse(no, classe) {
  var achados = [];

  (function andar(atual) {
    if (!atual || !atual.children) return;

    atual.children.forEach(function (filho) {
      if (filho.className === classe) achados.push(filho);
      andar(filho);
    });
  })(no);

  return achados;
}

module.exports = {
  criarElemento: criarElemento,
  criarDocumento: criarDocumento,
  criarJanela: criarJanela,
  comClasse: comClasse
};
