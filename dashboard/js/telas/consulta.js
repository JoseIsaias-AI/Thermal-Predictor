/* Tela de entrada do Thermal Predictor. Monta o formulário dos sete fatores
 * a partir de js/nucleo/schema.js e, ao submeter, leva para a triagem.
 *
 * Não pede ponto de medição de propósito: escolher um termopar pressupõe já
 * saber qual componente é o problema, e é isso que a triagem responde.
 */

(function () {
  "use strict";

  var TELA_RESULTADO = "triagem.html";
  /* A previsão não cabe em query string, então viaja por sessionStorage. A
     tela de resultado confere a configuração guardada contra a que veio na
     URL antes de usar: assim um link antigo não mostra a previsão de outra
     consulta. */
  var CHAVE_PREVISAO = "thermal_predictor.previsao";

  var form = document.getElementById("prediction-form");
  var fieldsContainer = document.getElementById("factor-fields");
  var errorSection = document.getElementById("error");

  function buildSelect(name, factor) {
    var wrapper = document.createElement("label");
    wrapper.className = "field";

    var label = document.createElement("span");
    label.className = "field__label";
    label.textContent = factor.label;
    wrapper.appendChild(label);

    var select = document.createElement("select");
    select.name = name;

    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = factor.optional ? "(não se aplica)" : "(escolher)";
    select.appendChild(blank);

    factor.levels.forEach(function (level) {
      var option = document.createElement("option");
      option.value = level.value;
      option.textContent = level.label;
      select.appendChild(option);
    });
    wrapper.appendChild(select);

    if (factor.help_text) {
      var help = document.createElement("span");
      help.className = "field__help";
      help.textContent = factor.help_text;
      wrapper.appendChild(help);
    }

    return wrapper;
  }

  function buildFieldset(factor) {
    var fieldset = document.createElement("fieldset");
    fieldset.className = "fieldset";

    var legend = document.createElement("legend");
    legend.textContent = factor.label;
    fieldset.appendChild(legend);

    if (factor.help_text) {
      var help = document.createElement("p");
      help.className = "field__help";
      help.textContent = factor.help_text;
      fieldset.appendChild(help);
    }

    var grid = document.createElement("div");
    grid.className = "field-grid";

    // Nome com ponto ("losses.config") marca o aninhamento lido em collectInput.
    var controls = {};
    factor.subfields.forEach(function (sub) {
      var wrapper = buildSelect(factor.key + "." + sub.key, sub);
      grid.appendChild(wrapper);
      controls[sub.key] = { wrapper: wrapper, select: wrapper.querySelector("select") };
    });
    fieldset.appendChild(grid);

    applyDependencies(factor.subfields, controls);
    return fieldset;
  }

  // Desabilita o campo enquanto a condição declarada em `requires` não vale.
  function applyDependencies(subfields, controls) {
    subfields.forEach(function (sub) {
      if (!sub.requires) return;

      var gate = controls[sub.requires.field];
      var target = controls[sub.key];
      if (!gate || !target) return;

      var sync = function () {
        var aplicavel = gate.select.value === sub.requires.value;
        target.select.disabled = !aplicavel;
        target.wrapper.classList.toggle("field--inactive", !aplicavel);
      };

      gate.select.addEventListener("change", sync);
      sync();
    });
  }

  /* `Pyro` e "sem perda declarada" são a mesma condição na base: nas rodadas da base, as de
     Pyro são exatamente as rodadas sem perda, e a codificação descartou `losses_present_none`
     por ser idêntica a `Run_Case_Pyro` (Seção 4.2.2d). A API recusa a combinação que não
     existe, dos dois lados, e oferecer na tela um caminho que termina em erro é pior que
     não oferecer: aqui o formulário fica impedido de expressá-la.

     O que se desabilita é a *opção*, nunca o `select`: `collectInput` deixa de fora todo
     campo desabilitado, e um `losses.present` ausente bloquearia o envio em vez de
     corrigi-lo. */
  function applyPyroEquivalence() {
    var runCase = form.elements.run_case;
    var present = form.elements["losses.present"];

    if (!runCase || !present) return;

    function opcao(valor) {
      return Array.prototype.filter.call(present.options, function (o) {
        return o.value === valor;
      })[0];
    }

    var semPerda = opcao("none");
    var comPerda = opcao("declared");
    var semDado = opcao("missing");

    var sync = function () {
      var pyro = runCase.value === "Pyro";

      if (semPerda) semPerda.disabled = !pyro;
      if (comPerda) comPerda.disabled = pyro;
      if (semDado) semDado.disabled = pyro;

      var alvo = pyro ? "none" : "declared";

      // Só mexe no valor quando o escolhido deixou de ser possível.
      if (pyro !== (present.value === "none")) {
        present.value = alvo;
        // `requires` de config e ordem escuta `change`, que atribuir valor não dispara.
        present.dispatchEvent(new Event("change"));
      }
    };

    runCase.addEventListener("change", sync);
    sync();
  }

  /* "Alterar configuração" volta para cá com a configuração na URL: o formulário
     abre preenchido com ela, e a pessoa muda só o que quer. Os campos seguem a
     ordem do formulário, que é a das dependências — `run_case` antes de
     `losses.present`, e este antes de `config` e `order` —, e cada um dispara
     `change` para as regras de `requires` e de Pyro valerem como no clique. O
     evento não sobe ao formulário: o selo de peça é para a escolha feita à mão,
     e o desenho final sai do `redesenhar` da carga. */
  function preencherDaUrl(busca) {
    var texto = (busca || "").replace(/^\?/, "");

    if (!texto) return;

    var valores = {};

    texto.split("&").forEach(function (par) {
      var corte = par.indexOf("=");
      if (corte < 0) return;
      valores[decodeURIComponent(par.slice(0, corte))] =
        decodeURIComponent(par.slice(corte + 1).replace(/\+/g, " "));
    });

    Array.prototype.forEach.call(form.elements, function (campo) {
      if (!campo.name || !(campo.name in valores) || !campo.options) return;

      // Valor fora do vocabulário, ou impedido pela regra de Pyro, fica em branco.
      var possivel = Array.prototype.some.call(campo.options, function (o) {
        return o.value === valores[campo.name] && !o.disabled;
      });

      if (!possivel) return;

      campo.value = valores[campo.name];
      campo.dispatchEvent(new Event("change"));
    });
  }

  function buildForm() {
    SCHEMA.factors.forEach(function (factor) {
      if (factor.subfields && factor.subfields.length > 0) {
        fieldsContainer.appendChild(buildFieldset(factor));
      } else {
        fieldsContainer.appendChild(buildSelect(factor.key, factor));
      }
    });

    applyPyroEquivalence();
  }

  function collectInput() {
    var input = {};

    Array.prototype.forEach.call(form.elements, function (element) {
      // Campo desabilitado não se aplica: fica de fora em vez de ir vazio.
      if (!element.name || element.disabled) return;

      var value = element.value === "" ? null : element.value;
      var parts = element.name.split(".");

      if (parts.length === 1) {
        input[parts[0]] = value;
      } else {
        if (!input[parts[0]]) input[parts[0]] = {};
        input[parts[0]][parts[1]] = value;
      }
    });

    return input;
  }

  function showError(message) {
    document.getElementById("error-message").textContent = message;
    errorSection.hidden = false;
  }

  /* Guardar é melhor esforço: por `file://` o navegador pode recusar o
     armazenamento, e nesse caso a tela de resultado refaz a consulta. Por isso
     a falha aqui não interrompe a navegação nem vira erro na tela. */
  function guardarPrevisao(resultado) {
    try {
      window.sessionStorage.setItem(CHAVE_PREVISAO, JSON.stringify({
        configuracao: resultado.enviado,
        resposta: resultado.dados
      }));
    } catch (semArmazenamento) {
      // segue sem guardar
    }
  }

  // Campo ausente de `input` foi desabilitado por `requires` e não se
  // aplica; campo presente e nulo ficou em branco de verdade.
  function camposObrigatoriosVazios(input) {
    var vazios = [];

    function conferir(campo, valor) {
      if (valor === undefined) return;
      if (valor === null && !campo.optional) vazios.push(campo.label);
    }

    SCHEMA.factors.forEach(function (fator) {
      if (fator.subfields && fator.subfields.length > 0) {
        var aninhado = input[fator.key] || {};
        fator.subfields.forEach(function (sub) {
          conferir(sub, aninhado[sub.key]);
        });
        return;
      }
      conferir(fator, input[fator.key]);
    });

    return vazios;
  }

  // Ponto separa o aninhamento ("losses.config"), como no atributo name dos
  // campos. Query string em vez de sessionStorage: funciona por file://.
  function paraQueryString(input) {
    var partes = [];

    Object.keys(input).forEach(function (chave) {
      var valor = input[chave];

      if (valor === null) return;

      if (typeof valor === "object") {
        Object.keys(valor).forEach(function (sub) {
          if (valor[sub] === null) return;
          partes.push(
            encodeURIComponent(chave + "." + sub) + "=" +
            encodeURIComponent(valor[sub])
          );
        });
        return;
      }

      partes.push(encodeURIComponent(chave) + "=" + encodeURIComponent(valor));
    });

    return partes.join("&");
  }

  /* Peça que cada fator materializa. Caso de operação e perdas não têm
     manifestação geométrica — o viewport diz isso em vez de fingir movimento. */
  var PECA_DO_FATOR = {
    blower_direction: "blower",
    housing: "ipcLid",
    board_position: "ipcBoard",
    deflector_hole: "deflector",
    material_coil_support: "coilSupport",
    run_case: null,
    losses: null
  };

  var palco = document.getElementById("fogao-3d");
  var badge = document.getElementById("fogao-badge");
  // De 0 (montado) a 1 (explodido), regulado pelo slider ou pelos botões.
  var explodido = 0;
  var destaque = null;
  var timerBadge = null;
  var modelo = null;

  function rotuloDoNivel(fator, valor) {
    var achado = null;
    (fator.levels || []).forEach(function (n) { if (n.value === valor) achado = n.label; });
    return achado;
  }

  function acharFator(chave) {
    var achado = null;
    SCHEMA.factors.forEach(function (f) { if (f.key === chave) achado = f; });
    return achado;
  }

  function contarEscolhidos(input) {
    var n = 0;
    SCHEMA.factors.forEach(function (f) {
      if (f.subfields && f.subfields.length > 0) {
        var sub = input[f.key] || {};
        if (sub.present) n++;
        return;
      }
      if (input[f.key]) n++;
    });
    return n;
  }

  function atualizarFaixa(input) {
    var regime = input.run_case ? rotuloDoNivel(acharFator("run_case"), input.run_case) : null;
    var perdas = input.losses || {};
    var arranjo = null;
    if (perdas.present === "declared") {
      arranjo = [perdas.config, perdas.order].filter(Boolean).join(" · ") || "declarada";
    } else if (perdas.present === "none") {
      arranjo = "Sem perda";
    } else if (perdas.present === "missing") {
      arranjo = "Não declarado";
    }
    var fluxo = input.blower_direction || null;

    function põe(id, texto, classe) {
      var el = document.getElementById(id);
      el.textContent = texto || "—";
      el.className = texto ? (classe || "") : "is-none";
    }
    põe("st-regime", regime);
    põe("st-losses", arranjo);
    põe("st-flow", fluxo, "is-flow");
  }

  function mostrarBadge(texto) {
    if (timerBadge) clearTimeout(timerBadge);
    if (!texto) { badge.hidden = true; return; }
    badge.textContent = texto;
    badge.hidden = false;
    timerBadge = setTimeout(function () {
      badge.hidden = true;
      destaque = null;
      redesenhar();
    }, 1600);
  }

  // `extra.arrastando` adia o reenquadro da câmera até o slider parar.
  function redesenhar(extra) {
    extra = extra || {};
    var input = collectInput();
    var n = contarEscolhidos(input);
    // Quatro estados de montagem: chassi, ventilação, eletrônica, cooktop.
    var nivel = n === 0 ? 1 : n <= 2 ? 2 : n <= 4 ? 3 : 4;

    document.getElementById("build-count").textContent = n;
    // Mesma contagem, no cabeçalho do formulário: quem está preenchendo olha
    // para a coluna dos campos, não para a barra do modelo.
    document.getElementById("form-count").textContent = n;
    document.getElementById("form-fill").style.width = (n / 7 * 100) + "%";
    // O título diz o estado do formulário, e não só o nome dele.
    document.getElementById("form-title").textContent = n === 7
      ? "Pronta para a triagem"
      : "Faltam " + (7 - n) + (7 - n === 1 ? " fator" : " fatores");
    atualizarFaixa(input);
    atualizarExplosao();

    if (!modelo) return;
    modelo.atualizar({
      nivel: nivel,
      modo: "montagem",
      explode: explodido,
      arrastando: !!extra.arrastando,
      defletor: input.deflector_hole === "Open" ? "open" : "closed",
      placa: input.board_position === "Right" ? "right" : "center",
      soprador: input.blower_direction === "To Back" ? "back" : input.blower_direction ? "front" : null,
      alojamento: input.housing && input.housing !== "Closed" ? "open" : "closed",
      caso: input.run_case,
      material: input.material_coil_support === "Plastic" ? "plastic"
        : input.material_coil_support === "Aluminium Plate" ? "plate" : "aluminium",
      novo: destaque
    });
  }

  form.addEventListener("change", function (event) {
    var chave = (event.target.name || "").split(".")[0];
    var peca = PECA_DO_FATOR[chave];
    destaque = peca || null;
    redesenhar();

    if (!event.target.value) { mostrarBadge(null); return; }
    var fator = acharFator(chave);
    mostrarBadge(peca
      ? (fator ? fator.label.toUpperCase() : chave)
      : (fator ? fator.label.toUpperCase() + " · SEM EFEITO GEOMÉTRICO" : ""));
  });

  var sliderExplode = document.getElementById("view-explode");

  // Slider, rótulo e botões mostram o mesmo valor; no meio do curso nenhum botão fica marcado.
  function atualizarExplosao() {
    var pct = Math.round(explodido * 100);
    sliderExplode.value = pct;
    sliderExplode.setAttribute("aria-valuetext", pct === 0 ? "montado" : pct + "% explodido");
    document.getElementById("view-explode-valor").textContent = pct + "%";
    Array.prototype.forEach.call(document.querySelectorAll("#view-toggle button"), function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.explode) === pct));
    });
  }

  document.getElementById("view-toggle").addEventListener("click", function (event) {
    var botao = event.target.closest("button");
    if (!botao) return;
    explodido = Number(botao.dataset.explode) / 100;
    redesenhar();
  });

  // `input` chega a cada passo do arrasto; `change`, quando a mão solta.
  sliderExplode.addEventListener("input", function () {
    explodido = Number(this.value) / 100;
    redesenhar({ arrastando: true });
  });
  sliderExplode.addEventListener("change", function () {
    explodido = Number(this.value) / 100;
    redesenhar();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    errorSection.hidden = true;

    var input = collectInput();
    var faltando = camposObrigatoriosVazios(input);

    if (faltando.length > 0) {
      showError("Informe: " + faltando.join(", ") + ".");
      return;
    }

    var url = TELA_RESULTADO + "?" + paraQueryString(input);

    /* A previsão sai agora e corre junto com a coreografia, em vez de somar-se
       a ela: `destino` só resolve quando a resposta volta. É o que o cabeçalho
       de js/visual/analise.js antecipava — o intervalo da animação vira tempo de
       cálculo. */
    var previsao = API_PREDICAO.prever(input);
    var totalPrevisto = null;

    // O contador da animação conta até o total de pontos que o modelo previu.
    previsao.then(function (resultado) {
      if (resultado.ok) totalPrevisto = resultado.dados.total_pontos;
    });

    /* A passagem leva o mesmo modelo que o formulário montou para o centro da
       tela e navega ao terminar. */
    ANALISE.executar({
      palco: palco,
      destino: function () {
        return previsao.then(function (resultado) {
          if (resultado.ok) {
            guardarPrevisao(resultado);
            return url;
          }

          /* Configuração fora do contrato ou falha do servidor param aqui, com
             a mensagem da API. Sem resposta do serviço, não há previsão para
             mostrar em tela nenhuma: a consulta passa ao estado indisponível. */
          if (resultado.erro.tipo === "validacao" || resultado.erro.tipo === "falha") {
            showError(resultado.erro.mensagem);
            return null;
          }

          ESTADO_SERVICO.mostrar(document, "indisponivel", { aoTentar: verificarServico });
          return null;
        });
      },
      totalDePontos: function () { return totalPrevisto; },
      aoExplodir: function (valor) {
        explodido = valor;
        redesenhar({ arrastando: true });
      },
      aoMudarCamera: function (nome) { modelo.preset(nome); }
    });
  });

  buildForm();
  preencherDaUrl(window.location.search);

  // Arrasto, roda, pinça, teclado e presets passam todos pela câmera do modelo 3D.
  var presets = document.getElementById("view-preset");
  modelo = FOGAO3D.criar(palco, {
    aoMudarCamera: function (atual) {
      Array.prototype.forEach.call(presets.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.preset === atual));
      });
    }
  });
  presets.addEventListener("click", function (event) {
    var botao = event.target.closest("button");
    if (botao) modelo.preset(botao.dataset.preset);
  });

  redesenhar();

  /* A consulta abre conferindo o serviço: com ele no ar, o chip mostra a versão
     do modelo carregado; sem ele, a tela fica no estado indisponível, porque
     nenhuma configuração teria previsão. "Tentar de novo" refaz só a conferência. */
  function verificarServico() {
    return API_PREDICAO.saude().then(function (resultado) {
      if (!resultado.ok) {
        ESTADO_SERVICO.mostrar(document, "indisponivel", { aoTentar: verificarServico });
        return;
      }
      ESTADO_SERVICO.limpar(document);
      document.getElementById("model-version").textContent = resultado.versao;
      document.getElementById("model-chip").hidden = false;
    });
  }

  verificarServico();
})();
