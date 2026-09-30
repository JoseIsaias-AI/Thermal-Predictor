/* Robertão — assistente do Thermal Predictor no canto das quatro telas.
 *
 * Fala com o backend local (llm/) por POST /api/chat. Todo texto entra por
 * textContent: a resposta vem de um modelo de linguagem e de documentos
 * recuperados, então tratá-la como HTML deixaria a página injetável.
 *
 * O painel monta a si mesmo aqui em vez de repetir marcação nas quatro
 * páginas — cada tela só precisa incluir este arquivo e o css/chat.css.
 */

(function () {
  "use strict";

  // Origem do backend. O CORS da API libera 127.0.0.1:5500 e localhost:5500,
  // que é onde o Live Server publica este painel.
  var API_BASE = baseDaApi();
  var AVATAR = "../assets/dashboard/robertao.png";
  var NOME = "Robertão";

  // A API aceita 20 mensagens de histórico e recorta as seis últimas no
  // prompt. Mandar mais do que ela usa só aumentaria o corpo da requisição.
  var HISTORICO_MAX = 12;
  var CHAVE_SESSAO = "robertao.conversa";

  var historico = carregarHistorico();
  var aguardando = false;
  var painel = null;
  var lancador = null;
  var log = null;
  var campo = null;
  var enviar = null;
  var aviso = null;
  var vazio = null;
  var aquecido = false;

  /* A porta 8000 é a do README, mas nem sempre está livre. `?api=8010` na URL
     troca a porta sem editar arquivo. Só o número entra, e sempre em
     127.0.0.1: assim um link não consegue apontar o painel — e a conversa —
     para um servidor de fora. */
  function baseDaApi() {
    if (window.CHATBOT_API_BASE) return window.CHATBOT_API_BASE;

    var busca = (window.location && window.location.search) || "";
    var porta = /[?&]api=(\d{2,5})(?:&|$)/.exec(busca);
    return "http://127.0.0.1:" + (porta ? porta[1] : "8000");
  }

  function criarAvatar(classe) {
    var img = document.createElement("img");
    img.className = classe;
    img.src = AVATAR;
    img.alt = "";
    // Enquanto a arte não estiver em assets/dashboard/, uma inicial mantém o botão legível.
    img.addEventListener("error", function () {
      var inicial = document.createElement("span");
      inicial.className = "chat-launcher__initial";
      inicial.textContent = NOME.charAt(0);
      if (img.parentNode) img.parentNode.replaceChild(inicial, img);
    });
    return img;
  }

  function montarLancador() {
    lancador = document.createElement("button");
    lancador.type = "button";
    lancador.className = "chat-launcher";
    lancador.setAttribute("aria-expanded", "false");
    lancador.setAttribute("aria-controls", "chat-panel");
    lancador.title = "Falar com o " + NOME;
    lancador.setAttribute("aria-label", "Abrir conversa com o " + NOME);
    lancador.appendChild(criarAvatar("chat-launcher__avatar"));

    aviso = document.createElement("span");
    aviso.className = "chat-launcher__dot";
    aviso.hidden = true;
    lancador.appendChild(aviso);

    lancador.addEventListener("click", alternar);
    document.body.appendChild(lancador);
  }

  function montarPainel() {
    painel = document.createElement("section");
    painel.className = "chat-panel";
    painel.id = "chat-panel";
    painel.hidden = true;
    painel.setAttribute("role", "dialog");
    painel.setAttribute("aria-label", "Conversa com o " + NOME);

    var cabecalho = document.createElement("header");
    cabecalho.className = "chat-panel__head";
    cabecalho.appendChild(criarAvatar("chat-panel__avatar"));

    var identidade = document.createElement("div");
    identidade.className = "chat-panel__identity";

    var nome = document.createElement("p");
    nome.className = "chat-panel__name";
    nome.textContent = NOME;
    identidade.appendChild(nome);

    var papel = document.createElement("p");
    papel.className = "chat-panel__role";
    papel.textContent = "Assistente de triagem térmica";
    identidade.appendChild(papel);
    cabecalho.appendChild(identidade);

    var fechar = document.createElement("button");
    fechar.type = "button";
    fechar.className = "chat-panel__close";
    fechar.setAttribute("aria-label", "Fechar conversa");
    fechar.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      '<path d="M3 3l8 8M11 3l-8 8"></path></svg>';
    fechar.addEventListener("click", function () { alternar(true); });
    cabecalho.appendChild(fechar);
    painel.appendChild(cabecalho);

    log = document.createElement("div");
    log.className = "chat-log";
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");

    vazio = document.createElement("p");
    vazio.className = "chat-empty";
    vazio.textContent =
      "Pergunte sobre os fatores do projeto, os ensaios já medidos ou a " +
      "comparação entre dois níveis.";
    log.appendChild(vazio);

    painel.appendChild(log);

    var form = document.createElement("form");
    form.className = "chat-form";

    campo = document.createElement("textarea");
    campo.className = "chat-form__input";
    campo.rows = 1;
    campo.placeholder = "Escreva sua dúvida…";
    campo.setAttribute("aria-label", "Mensagem para o " + NOME);
    campo.addEventListener("input", ajustarAltura);
    campo.addEventListener("keydown", function (evento) {
      // Enter envia; Shift+Enter continua sendo quebra de linha.
      if (evento.key === "Enter" && !evento.shiftKey) {
        evento.preventDefault();
        form.requestSubmit ? form.requestSubmit() : submeter(evento);
      }
    });
    form.appendChild(campo);

    enviar = document.createElement("button");
    enviar.type = "submit";
    enviar.className = "chat-form__send";
    enviar.setAttribute("aria-label", "Enviar mensagem");
    enviar.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      '<path d="M2 8h11"></path><path d="M9 4l4 4-4 4"></path></svg>';
    form.appendChild(enviar);

    form.addEventListener("submit", submeter);
    painel.appendChild(form);

    document.body.appendChild(painel);
  }

  function ajustarAltura() {
    campo.style.height = "auto";
    campo.style.height = Math.min(campo.scrollHeight, 112) + "px";
  }

  function alternar(devolverFoco) {
    if (painel.hidden) abrir();
    else fechar(devolverFoco);
  }

  function abrir() {
    painel.hidden = false;
    lancador.setAttribute("aria-expanded", "true");
    lancador.setAttribute("aria-label", "Fechar conversa com o " + NOME);
    aviso.hidden = true;
    lancador.classList.remove("chat-launcher--novo");
    campo.focus();
    rolarParaOFim();
    aquecer();
  }

  /* Pede o aquecimento do prompt enquanto a pessoa ainda está escrevendo.
     Medido em CPU, avaliar o prompt de sistema custa ~120 s na primeira vez e
     quase nada depois.

     Só pede se a saúde disser que ainda não está aquecido. O Ollama atende um
     pedido por vez em cada modelo, então um aquecimento desnecessário poria a
     pergunta na fila atrás dele — o contrário do que se quer aqui.

     Nada disso aparece no painel nem conta como interação: o assistente
     continua calado até a primeira mensagem. */
  function aquecer() {
    if (aquecido || aguardando) return;
    aquecido = true;

    fetch(API_BASE + "/api/health")
      .then(function (resposta) { return resposta.json(); })
      .then(function (saude) {
        if (saude.warm === "warm" || saude.warm === "warming") return;
        return fetch(API_BASE + "/api/warmup", { method: "POST" });
      })
      .catch(function () {
        // Backend fora do ar aparece quando houver pergunta de verdade;
        // avisar duas vezes a mesma coisa só polui o painel.
        aquecido = false;
      });
  }

  function fechar(devolverFoco) {
    painel.hidden = true;
    lancador.setAttribute("aria-expanded", "false");
    lancador.setAttribute("aria-label", "Abrir conversa com o " + NOME);
    // Só quando o comando partiu do teclado ou do próprio X: num clique fora,
    // puxar o foco roubaria o campo ou o botão que a pessoa acabou de clicar.
    if (devolverFoco) lancador.focus();
  }

  function submeter(evento) {
    if (evento) evento.preventDefault();
    var texto = campo.value.trim();
    if (!texto || aguardando) return;

    campo.value = "";
    ajustarAltura();
    conversar(texto, { silencioso: false });
  }

  function conversar(mensagem, opcoes) {
    if (!opcoes.silencioso) {
      desenharMensagem({ texto: mensagem, autor: "user" });
      historico.push({ role: "user", content: mensagem });
    }

    var digitando = desenharDigitando();
    definirAguardando(true);

    requisitar(mensagem)
      .then(function (resposta) {
        digitando.remover();
        desenharMensagem({
          texto: resposta.answer,
          autor: "bot",
          action: resposta.action,
          sources: resposta.sources
        });
        historico.push({ role: "assistant", content: resposta.answer });
        guardarHistorico();
      })
      .catch(function (erro) {
        digitando.remover();
        // Falha de rede não entra no histórico: reenviá-la como contexto
        // faria o modelo responder sobre o erro na pergunta seguinte.
        desenharMensagem({ texto: erro.message, autor: "bot", action: "erro" });
      })
      .then(function () {
        definirAguardando(false);
        if (painel.hidden) {
          aviso.hidden = false;
          lancador.classList.add("chat-launcher--novo");
        }
      });
  }

  function requisitar(mensagem) {
    return fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: mensagem,
        history: historico.slice(-HISTORICO_MAX)
      })
    })
      .catch(function () {
        throw new Error(
          "Não consegui falar com o backend em " + API_BASE + ". " +
          "Verifique se a API do chatbot está no ar."
        );
      })
      .then(function (resposta) {
        return resposta.json().catch(function () { return {}; })
          .then(function (corpo) {
            if (!resposta.ok) {
              throw new Error(
                corpo.detail || ("A API respondeu " + resposta.status + ".")
              );
            }
            return corpo;
          });
      });
  }

  function desenharMensagem(dados) {
    var balao = document.createElement("div");
    balao.className = "chat-msg chat-msg--" + (dados.autor === "user" ? "user" : "bot");

    if (dados.action === "insufficient_data") balao.classList.add("chat-msg--insufficient");
    if (dados.action === "erro") balao.classList.add("chat-msg--erro");

    escreverTexto(balao, dados.texto);

    if (dados.sources && dados.sources.length > 0) {
      var fontes = document.createElement("span");
      fontes.className = "chat-msg__sources";
      fontes.textContent = "Fontes: " + dados.sources.join(" · ");
      balao.appendChild(fontes);
    }

    if (vazio && vazio.parentNode) log.removeChild(vazio);

    log.appendChild(balao);
    rolarParaOFim();
    return balao;
  }

  /* O modelo escreve em Markdown mesmo quando o prompt não pede, e "**assim**"
     na tela é pior que sem formatação nenhuma. Então um subconjunto — negrito,
     itálico, código e lista — é convertido em elementos.

     A conversão monta nós e usa textContent em cada pedaço de texto; nunca
     innerHTML. O conteúdo vem de um modelo de linguagem e de documentos
     recuperados, e interpretar isso como HTML deixaria a página injetável. */
  function escreverTexto(destino, texto) {
    var lista = null;

    String(texto).split("\n").forEach(function (linha) {
      var item = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(linha);

      if (item) {
        if (!lista) {
          lista = document.createElement("ul");
          lista.className = "chat-msg__list";
          destino.appendChild(lista);
        }
        var li = document.createElement("li");
        escreverTrecho(li, item[1]);
        lista.appendChild(li);
        return;
      }

      lista = null;
      if (!linha.trim()) return;   // linha vazia já vira espaço entre blocos

      var paragrafo = document.createElement("p");
      paragrafo.className = "chat-msg__p";
      escreverTrecho(paragrafo, linha);
      destino.appendChild(paragrafo);
    });
  }

  var MARCACAO = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|`([^`]+)`/g;

  function escreverTrecho(destino, linha) {
    var posicao = 0;
    var achado;

    MARCACAO.lastIndex = 0;
    while ((achado = MARCACAO.exec(linha)) !== null) {
      if (achado.index > posicao) {
        destino.appendChild(document.createTextNode(linha.slice(posicao, achado.index)));
      }

      var forte = achado[1] || achado[2];
      var enfase = achado[3];
      var elemento = document.createElement(forte ? "strong" : enfase ? "em" : "code");
      elemento.textContent = forte || enfase || achado[4];
      destino.appendChild(elemento);

      posicao = MARCACAO.lastIndex;
    }

    if (posicao < linha.length) {
      destino.appendChild(document.createTextNode(linha.slice(posicao)));
    }
  }

  function desenharDigitando() {
    var linha = document.createElement("p");
    linha.className = "chat-typing";

    var rotulo = document.createElement("span");
    rotulo.textContent = NOME + " está pensando";
    linha.appendChild(rotulo);

    var pontos = document.createElement("span");
    pontos.className = "chat-typing__dots";
    pontos.innerHTML = "<span></span><span></span><span></span>";
    linha.appendChild(pontos);

    log.appendChild(linha);
    rolarParaOFim();

    // Em CPU, uma resposta livre leva dezenas de segundos. Sem o relógio, a
    // espera parece travamento.
    var inicio = Date.now();
    var timer = setInterval(function () {
      var s = Math.round((Date.now() - inicio) / 1000);
      rotulo.textContent = NOME + " está pensando · " + s + " s";
    }, 1000);

    return {
      remover: function () {
        clearInterval(timer);
        if (linha.parentNode) linha.parentNode.removeChild(linha);
      }
    };
  }

  function definirAguardando(valor) {
    aguardando = valor;
    enviar.disabled = valor;
    campo.disabled = valor;
    // O avatar respira enquanto a resposta não vem: em CPU a espera é longa
    // o bastante para o painel parado parecer quebrado.
    lancador.classList.toggle("chat-launcher--pensando", valor);
    painel.classList.toggle("chat-panel--pensando", valor);
    if (!valor && !painel.hidden) campo.focus();
  }

  function rolarParaOFim() {
    log.scrollTop = log.scrollHeight;
  }

  /* A conversa sobrevive à navegação entre Consulta, Triagem, Comparação e
     Engenharia — trocar de tela no meio de uma dúvida é o caso normal aqui. */
  function carregarHistorico() {
    try {
      return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO)) || [];
    } catch (erro) {
      return [];
    }
  }

  function guardarHistorico() {
    try {
      sessionStorage.setItem(
        CHAVE_SESSAO, JSON.stringify(historico.slice(-HISTORICO_MAX))
      );
    } catch (erro) {
      // Aba anônima ou armazenamento bloqueado: a conversa continua válida
      // nesta página, só não atravessa a navegação.
    }
  }

  function restaurar() {
    historico.slice(-HISTORICO_MAX).forEach(function (mensagem) {
      desenharMensagem({
        texto: mensagem.content,
        autor: mensagem.role === "user" ? "user" : "bot"
      });
    });
  }

  /* Clicar em qualquer ponto do painel atrás fecha a conversa, como em
     qualquer popover. O clique no próprio lançador fica de fora: ele já
     alterna, e fechar aqui desfaria a abertura no mesmo clique. */
  document.addEventListener("click", function (evento) {
    if (!painel || painel.hidden) return;
    if (painel.contains(evento.target) || lancador.contains(evento.target)) return;
    fechar(false);
  });

  document.addEventListener("keydown", function (evento) {
    if (evento.key === "Escape" && painel && !painel.hidden) fechar(true);
  });

  montarPainel();
  montarLancador();
  restaurar();
})();
