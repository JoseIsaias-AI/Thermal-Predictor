/* O estado da tela quando ela não tem previsão do modelo para mostrar.
 *
 * Rodar os testes:
 *   node --test dashboard/testes/estado_servico.test.js
 *
 * O painel só exibe número calculado pelo modelo. Sem o serviço de predição,
 * nenhuma tela cai num valor de reserva: todas mostram o mesmo aviso, com a
 * instrução para subir a API e o botão de tentar de novo, e nada mais. O estado
 * mora em `body[data-servico]`, e o CSS (`css/app.css`) esconde o resto do
 * conteúdo e o chip do modelo — nenhuma tela precisa saber esconder o que é seu.
 *
 * Estados:
 *   verificando           a tela já montou com a previsão guardada e espera a
 *                         API confirmar que está no ar; o conteúdo fica
 *                         invisível, sem sair do lugar (o 3D mede o palco)
 *   carregando            a tela pede a previsão da configuração da URL
 *   indisponivel          a API não respondeu ou não tem modelo carregado
 *   configuracao_invalida a configuração da URL está fora do vocabulário
 *   sem_configuracao      nenhuma configuração foi consultada nesta sessão
 */

var ESTADO_SERVICO = (function () {
  "use strict";

  var ID = "servico-estado";
  var CLASSE = "servico";

  var COMANDO_API = "cd dashboard && uvicorn api.main:app --port 8001";

  var TEXTOS = {
    carregando: {
      titulo: "Consultando o modelo",
      texto: "Calculando a previsão desta configuração no serviço de predição."
    },
    indisponivel: {
      titulo: "Serviço de predição indisponível",
      texto:
        "O painel só mostra números calculados pelo modelo, e o serviço de " +
        "predição não respondeu. Inicie a API de predição e tente de novo.",
      comando: true,
      tentar: true
    },
    configuracao_invalida: {
      titulo: "Configuração fora do vocabulário do modelo",
      texto:
        "A configuração deste endereço não é aceita pelo serviço de predição. " +
        "Volte à consulta e escolha os fatores de novo.",
      consulta: true
    },
    sem_configuracao: {
      titulo: "Nenhuma configuração consultada",
      texto:
        "Esta tela mostra a previsão de uma configuração. Escolha os fatores na " +
        "consulta para o modelo calcular a previsão.",
      consulta: true
    }
  };

  function el(doc, tag, classe, texto) {
    var n = doc.createElement(tag);
    if (classe) n.className = classe;
    if (texto) n.textContent = texto;
    return n;
  }

  function principal(doc) {
    return doc.getElementById("conteudo") || doc.querySelector("main") || doc.body;
  }

  function limparCaixa(doc) {
    var antiga = doc.querySelector("." + CLASSE);
    if (antiga && antiga.parentNode) antiga.parentNode.removeChild(antiga);
  }

  /* Põe a tela no estado pedido. `opcoes.aoTentar` troca o recarregar do botão
     "Tentar de novo" (a consulta, por exemplo, só refaz a verificação). */
  function mostrar(documento, estado, opcoes) {
    var doc = documento || (typeof document !== "undefined" ? document : null);

    if (!doc || !doc.body) return null;

    opcoes = opcoes || {};
    doc.body.dataset.servico = estado;
    limparCaixa(doc);

    var conteudo = TEXTOS[estado];

    // `verificando` não tem caixa: só segura o conteúdo invisível.
    if (!conteudo) return null;

    var caixa = el(doc, "section", CLASSE + " " + CLASSE + "--" + estado);
    caixa.id = ID;
    caixa.setAttribute("role", estado === "carregando" ? "status" : "alert");
    caixa.setAttribute("aria-live", "polite");

    caixa.appendChild(el(doc, "p", "servico__kicker", "Serviço de predição"));
    caixa.appendChild(el(doc, "h2", "servico__titulo", conteudo.titulo));
    caixa.appendChild(el(doc, "p", "servico__texto", opcoes.texto || conteudo.texto));

    if (conteudo.comando) {
      var instrucao = el(doc, "p", "servico__instrucao", "No terminal, na raiz do repositório:");
      caixa.appendChild(instrucao);
      caixa.appendChild(el(doc, "code", "servico__comando", COMANDO_API));
    }

    var acoes = el(doc, "div", "servico__acoes");
    var temAcao = false;

    if (conteudo.tentar) {
      var botao = el(doc, "button", "button servico__tentar", "Tentar de novo");
      botao.type = "button";
      botao.addEventListener("click", function () {
        if (typeof opcoes.aoTentar === "function") {
          opcoes.aoTentar();
          return;
        }
        if (typeof window !== "undefined") window.location.reload();
      });
      acoes.appendChild(botao);
      temAcao = true;
    }

    if (conteudo.consulta) {
      var link = el(doc, "a", "button servico__consulta", "Ir para a consulta");
      link.setAttribute("href", "index.html");
      acoes.appendChild(link);
      temAcao = true;
    }

    if (temAcao) caixa.appendChild(acoes);

    var alvo = principal(doc);
    alvo.insertBefore(caixa, alvo.firstChild);

    return caixa;
  }

  // Volta a tela ao normal: o conteúdo reaparece e a caixa sai.
  function limpar(documento) {
    var doc = documento || (typeof document !== "undefined" ? document : null);

    if (!doc || !doc.body) return;

    delete doc.body.dataset.servico;
    limparCaixa(doc);
  }

  function atual(documento) {
    var doc = documento || (typeof document !== "undefined" ? document : null);
    return (doc && doc.body && doc.body.dataset.servico) || null;
  }

  return {
    ID: ID,
    COMANDO_API: COMANDO_API,
    TEXTOS: TEXTOS,
    mostrar: mostrar,
    limpar: limpar,
    atual: atual
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ESTADO_SERVICO;
