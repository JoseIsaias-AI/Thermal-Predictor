/* Passagem da consulta para a triagem.
 *
 * O painel leva o mesmo modelo 3D que o formulário monta para o centro da
 * tela, abre o produto, varre os pontos de medição e devolve o resultado. Não
 * é enfeite: é o intervalo em que a previsão será calculada quando houver
 * endpoint, e é o que dá ao usuário a noção de que os 78 pontos foram olhados,
 * um a um, na configuração que ele acabou de escolher.
 *
 * Enquanto o preditor for o stub, nada é calculado nesse intervalo. Por isso o
 * rodapé do painel diz, durante a animação, que os valores são de demonstração.
 * Quando a chamada real existir, ela roda aqui dentro e o tempo da coreografia
 * passa a ser tempo de cálculo.
 *
 * Uso, a partir de js/app.js:
 *   ANALISE.executar({ palco, destino, aoExplodir, aoMudarCamera });
 */

var ANALISE = (function () {
  "use strict";

  var TOTAL_DE_PONTOS = 78;

  /* A coreografia, em etapas. `ate` é a fração do total já percorrida ao fim da
     etapa, o que mantém barra, contador e texto no mesmo relógio. */
  var ETAPAS = [
    { ate: 0.18, texto: "Montando a configuração escolhida", camera: "isometrica", explode: 0 },
    { ate: 0.44, texto: "Abrindo o produto por camadas", camera: "frontal", explode: 1 },
    { ate: 0.72, texto: "Varrendo os pontos de medição", camera: "lateral", explode: 1, varrendo: true },
    { ate: 0.92, texto: "Comparando com os limites de cada componente", camera: "isometrica", explode: 0 },
    { ate: 1, texto: "Fechando a leitura", camera: "isometrica", explode: 0 }
  ];

  /* Mover o palco e redimensionar o renderer custa alguns décimos antes do
     primeiro quadro, e o relógio só começa a contar ali. A duração desconta
     isso para a passagem inteira ficar na casa dos cinco segundos. */
  var DURACAO = 4600;
  var ESPERA_NO_FIM = 800;

  var movimentoReduzido = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  function elemento(id) { return document.getElementById(id); }

  function suavizar(t) {
    // Começa e termina devagar: a explosão fica mecânica com passo constante.
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function etapaEm(fracao) {
    for (var i = 0; i < ETAPAS.length; i++) {
      if (fracao <= ETAPAS[i].ate) return { indice: i, etapa: ETAPAS[i] };
    }
    return { indice: ETAPAS.length - 1, etapa: ETAPAS[ETAPAS.length - 1] };
  }

  // Progresso dentro da etapa atual, de 0 a 1.
  function progressoNaEtapa(fracao, indice) {
    var inicio = indice === 0 ? 0 : ETAPAS[indice - 1].ate;
    var fim = ETAPAS[indice].ate;
    return fim === inicio ? 1 : Math.max(0, Math.min(1, (fracao - inicio) / (fim - inicio)));
  }

  function executar(opcoes) {
    var painel = elemento("analise");
    var palcoDestino = elemento("analise-palco");
    var etapaTexto = elemento("analise-etapa");
    var preenche = elemento("analise-preenche");
    var contador = elemento("analise-pontos");
    var fim = elemento("analise-fim");
    var varredura = elemento("analise-varredura");

    var palco = opcoes.palco;
    var berco = palco.parentNode;
    var irrelevante = document.querySelector(".page");

    function concluir() {
      window.location.href = opcoes.destino;
    }

    // Abre o véu antes de mover o palco: sem isso o modelo salta pela tela.
    painel.hidden = false;
    painel.removeAttribute("aria-hidden");
    document.body.classList.add("analisando");
    if (irrelevante) irrelevante.setAttribute("aria-hidden", "true");

    // O mesmo canvas, reaproveitado: o fogão que a pessoa montou é o que ela vê
    // ser analisado. O observador de tamanho do modelo cuida do resto.
    palcoDestino.appendChild(palco);

    /* Quem pediu menos movimento recebe o mesmo conteúdo sem a coreografia: a
       informação é o texto e o resultado, não o giro. */
    if (movimentoReduzido.matches) {
      etapaTexto.textContent = "Analisando a configuração";
      preenche.style.width = "100%";
      contador.textContent = TOTAL_DE_PONTOS;
      setTimeout(function () {
        fim.hidden = false;
        setTimeout(concluir, ESPERA_NO_FIM);
      }, 600);
      return;
    }


    /* O relógio conta do clique, e não do primeiro quadro. Navegador que
       congela o `requestAnimationFrame` de aba em segundo plano faria a
       contagem começar tarde, e a passagem duraria o dobro para quem voltasse
       à aba no meio dela. */
    var comeco = performance.now();
    var ultimaEtapa = -1;
    var terminou = false;

    function encerrar() {
      if (terminou) return;
      terminou = true;
      varredura.hidden = true;
      fim.hidden = false;
      setTimeout(concluir, ESPERA_NO_FIM);
    }

    // Rede de segurança: sem quadro nenhum, a pessoa ficaria presa no véu.
    var resgate = setTimeout(encerrar, DURACAO + 1500);

    function quadro(agora) {
      var fracao = Math.min(1, (agora - comeco) / DURACAO);
      var atual = etapaEm(fracao);
      var dentro = progressoNaEtapa(fracao, atual.indice);

      if (atual.indice !== ultimaEtapa) {
        ultimaEtapa = atual.indice;
        etapaTexto.textContent = atual.etapa.texto;
        varredura.hidden = !atual.etapa.varrendo;
        if (opcoes.aoMudarCamera) opcoes.aoMudarCamera(atual.etapa.camera);
      }

      // Explosão interpolada entre o valor da etapa anterior e o da atual.
      if (opcoes.aoExplodir) {
        var de = atual.indice === 0 ? 0 : ETAPAS[atual.indice - 1].explode;
        opcoes.aoExplodir(de + (atual.etapa.explode - de) * suavizar(dentro));
      }

      preenche.style.width = (fracao * 100).toFixed(1) + "%";
      contador.textContent = Math.round(fracao * TOTAL_DE_PONTOS);

      if (fracao < 1) { requestAnimationFrame(quadro); return; }

      clearTimeout(resgate);
      encerrar();
    }

    requestAnimationFrame(quadro);

    // Devolve o palco ao lugar se a navegação for cancelada pelo botão voltar.
    window.addEventListener("pageshow", function (evento) {
      if (!evento.persisted) return;
      berco.appendChild(palco);
      painel.hidden = true;
      document.body.classList.remove("analisando");
    });
  }

  return {
    TOTAL_DE_PONTOS: TOTAL_DE_PONTOS,
    ETAPAS: ETAPAS,
    DURACAO: DURACAO,
    etapaEm: etapaEm,
    progressoNaEtapa: progressoNaEtapa,
    suavizar: suavizar,
    executar: executar
  };
})();
