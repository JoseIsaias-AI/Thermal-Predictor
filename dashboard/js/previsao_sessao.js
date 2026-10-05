/* A previsão do modelo que todas as telas exibem.
 *
 * Rodar os testes:
 *   node --test dashboard/testes/previsao_sessao.test.js
 *
 * Carrega antes de qualquer tela e define `DADOS_TRIAGEM` com a resposta de
 * `POST /predicao` para a configuração da URL. As telas e módulos que leem esse
 * objeto não precisam saber de onde ele veio: a resposta tem a forma que elas
 * consomem, campo por campo (`dashboard/api/dominio/contratos.py`). Nenhum valor
 * é convertido, arredondado ou reordenado aqui — o que a API devolveu é o que a
 * tela mostra.
 *
 * Não existe valor de reserva. A previsão vem da sessão, guardada pela consulta
 * (`js/app.js`), ou é pedida à API aqui mesmo, quando a tela abre com uma
 * configuração que a sessão ainda não tem — um link do menu, o botão "Ver na
 * triagem" da comparação, um endereço colado. Enquanto a previsão não existe,
 * `DADOS_TRIAGEM` fica indefinido, as telas não montam nada e o estado da tela
 * fica com `js/estado_servico.js`:
 *
 *   1. A configuração da previsão guardada tem de ser a da URL. Um link antigo,
 *      ou o botão voltar depois de outra consulta, traria a previsão errada para
 *      a configuração que a tela diz estar exibindo; nesse caso a tela pede a
 *      previsão certa e recarrega com ela.
 *   2. O formato tem de estar completo. Resposta truncada no armazenamento é
 *      tratada como ausente, não vira tela meio preenchida.
 *   3. Com a previsão em mãos, a tela ainda espera a API confirmar que está no
 *      ar: sem o serviço, todas as telas mostram o estado indisponível.
 *
 * Um campo da resposta merece nota: `modelos`, a lista de qual modelo previu
 * cada subsistema. O modelo final é uma mescla — um algoritmo escolhido por área,
 * e dentro de cinco delas a média de dois —, e as áreas não têm todas a mesma
 * qualidade: `AC Blower Inlet` não teve modelo validado. `modeloDoPonto` e
 * `pontoAferido` dão às telas esse recorte por ponto.
 */

var PREVISAO_SESSAO = (function () {
  "use strict";

  var CHAVE = "thermal_predictor.previsao";

  var CAMPOS_ESPERADOS = [
    "versao_modelo",
    "preditor_e_stub",
    "configuracao",
    "tolerancia_fracao",
    "total_pontos",
    "total_classificados",
    "total_monitoramento",
    "pontos",
    "monitoramento",
    "modelos"
  ];

  var CAMPOS_DO_PONTO = [
    "measurement_id",
    "TC_Name",
    "Key_Area",
    "subsistema_modelo",
    "temperatura_prevista_c",
    "limit_c",
    "is_monitor_only",
    "margem_c",
    "margem_percentual",
    "estado",
    "estado_rotulo"
  ];

  /* Os fatores da configuração na query string. O resto da busca — a porta da
     API, a seleção da comparação — não é configuração e fica de fora da
     conferência, ou a previsão guardada nunca casaria com a URL dessas telas. */
  var FATORES = [
    "blower_direction",
    "housing",
    "board_position",
    "run_case",
    "deflector_hole",
    "material_coil_support",
    "losses"
  ];

  /* Mesmo formato que `paraQueryString` escreve em `js/app.js`: ponto separa o
     aninhamento de `losses`. Parser próprio, e não o de `js/leitura_publicos.js`,
     porque aquele módulo carrega depois de parte dos consumidores e este
     precisa rodar antes de todos. Devolve `null` sem nenhum fator. */
  function configuracaoDaBusca(busca) {
    var texto = (busca || "").replace(/^\?/, "");

    if (!texto) return null;

    var config = {};

    texto.split("&").forEach(function (par) {
      if (!par) return;

      var corte = par.indexOf("=");
      var chave = decodeURIComponent(par.slice(0, corte < 0 ? par.length : corte));
      var valor = corte < 0 ? "" : decodeURIComponent(par.slice(corte + 1).replace(/\+/g, " "));
      var partes = chave.split(".");

      if (FATORES.indexOf(partes[0]) < 0) return;

      if (partes.length === 1) {
        config[partes[0]] = valor;
        return;
      }

      if (!config[partes[0]]) config[partes[0]] = {};
      config[partes[0]][partes[1]] = valor;
    });

    return Object.keys(config).length ? config : null;
  }

  /* O caminho inverso, para pôr na URL a configuração da previsão guardada. */
  function buscaDaConfiguracao(config) {
    var partes = [];

    Object.keys(config || {}).forEach(function (chave) {
      var valor = config[chave];

      if (valor && typeof valor === "object") {
        Object.keys(valor).forEach(function (sub) {
          if (valor[sub] === null || valor[sub] === undefined || valor[sub] === "") return;
          partes.push(encodeURIComponent(chave + "." + sub) + "=" + encodeURIComponent(valor[sub]));
        });
        return;
      }

      if (valor === null || valor === undefined || valor === "") return;
      partes.push(encodeURIComponent(chave) + "=" + encodeURIComponent(valor));
    });

    return partes.join("&");
  }

  /* Compara só o que a configuração declara, dos dois lados. A query string não
     carrega campo vazio, e a API não recebe subcampo nulo de `losses`, então
     ausente de um lado e ausente do outro é a mesma coisa. */
  function mesmaConfiguracao(a, b) {
    if (!a || !b) return false;

    var chaves = {};

    Object.keys(a).concat(Object.keys(b)).forEach(function (c) { chaves[c] = true; });

    return Object.keys(chaves).every(function (chave) {
      var va = a[chave];
      var vb = b[chave];

      if (va && typeof va === "object") return mesmaConfiguracao(va, vb);
      if (vb && typeof vb === "object") return false;

      // `null`, `undefined` e ausência são equivalentes nos dois lados.
      if (va === null || va === undefined || va === "") {
        return vb === null || vb === undefined || vb === "";
      }

      return String(va) === String(vb);
    });
  }

  function pontoCompleto(ponto) {
    return !!ponto && CAMPOS_DO_PONTO.every(function (campo) { return campo in ponto; });
  }

  function respostaCompleta(resposta) {
    if (!resposta || typeof resposta !== "object") return false;

    var temCampos = CAMPOS_ESPERADOS.every(function (campo) { return campo in resposta; });

    if (!temCampos) return false;
    if (!Array.isArray(resposta.pontos) || !Array.isArray(resposta.monitoramento)) return false;

    // Uma previsão sem nenhum ponto classificado não tem o que mostrar.
    if (resposta.pontos.length === 0) return false;

    return resposta.pontos.every(pontoCompleto) && resposta.monitoramento.every(pontoCompleto);
  }

  function lerGuardado(armazenamento) {
    try {
      var bruto = armazenamento.getItem(CHAVE);
      return bruto ? JSON.parse(bruto) : null;
    } catch (semLeitura) {
      return null;
    }
  }

  /* Resolve o que a tela deve exibir. Devolve sempre um objeto com `origem`,
     para quem quiser registrar ou depurar a escolha:
       modelo            previsão guardada, conferida contra a configuração da URL
       guardada          a URL não traz configuração, e vale a da última
                         previsão da sessão (`configuracao` diz qual)
       a_prever          a URL traz uma configuração sem previsão válida na
                         sessão; `motivo` diz por quê (nada guardado, outra
                         configuração, previsão incompleta, sem armazenamento)
       sem_configuracao  nem a URL nem a sessão têm configuração */
  function resolver(opcoes) {
    opcoes = opcoes || {};

    var armazenamento = opcoes.armazenamento;
    var daUrl = configuracaoDaBusca(opcoes.busca);
    var guardado = armazenamento ? lerGuardado(armazenamento) : null;
    var valido = !!(guardado && guardado.configuracao && respostaCompleta(guardado.resposta));

    if (!daUrl) {
      if (valido) {
        return { dados: guardado.resposta, origem: "guardada", configuracao: guardado.configuracao };
      }
      return { dados: null, origem: "sem_configuracao", configuracao: null };
    }

    if (valido && mesmaConfiguracao(guardado.configuracao, daUrl)) {
      return { dados: guardado.resposta, origem: "modelo", configuracao: daUrl };
    }

    var motivo = !armazenamento ? "sem_armazenamento"
      : !guardado ? "nada_guardado"
      : !valido ? "incompleta"
      : "outra_configuracao";

    return { dados: null, origem: "a_prever", motivo: motivo, configuracao: daUrl };
  }

  /* Qual modelo previu este ponto. A busca é por `subsistema_modelo`, que a API
     grava em cada ponto, e nunca por `Key_Area`: as duas coisas não coincidem.
     A área `Main Vent Sys` é atendida por dois modelos — o dela e o de
     `AC Blower Inlet` —, e o modelo de `HMI / Knobs / Console` cobre as áreas
     `Oven HMI` e `CT Knobs`. Casar por área atribuiria os dois pontos do único
     modelo não validado a um modelo validado, sem erro nenhum à vista.

     Devolve `null` quando não há como saber: resposta sem bloco `modelos`, ou
     ponto cujo subsistema não esteja na lista. */
  function modeloDoPonto(dados, ponto) {
    if (!dados || !ponto || !Array.isArray(dados.modelos)) return null;

    var achado = null;

    dados.modelos.forEach(function (modelo) {
      if (modelo && modelo.subsistema === ponto.subsistema_modelo) achado = modelo;
    });

    return achado;
  }

  /* Se o modelo que previu o ponto passou pela validação do grupo.

     Falso só com evidência: `validado === false` nos metadados do artefato. Sem
     bloco `modelos`, sem o ponto ou com `validado` ausente, devolve verdadeiro,
     porque a marca na tela é uma afirmação sobre o modelo e não deve aparecer
     por falta de informação. Hoje o único caso falso é `AC Blower Inlet`, que
     não teve modelo aprovado e cujos dois pontos a RN-03 já acompanha sem
     aprovar nem reprovar. */
  function pontoAferido(dados, ponto) {
    var modelo = modeloDoPonto(dados, ponto);
    return !modelo || modelo.validado !== false;
  }

  /* Classe da marca de procedência, definida em `css/triagem.css`. Fica aqui, e não
     repetida em cada tela, porque um erro de digitação nela não quebra nada: a marca
     aparece sem estilo nenhum, e ninguém nota. */
  var CLASSE_MARCA = "point__unvalidated";

  var TEXTO_MARCA = "modelo não validado";

  function marca(documento, titulo) {
    var span = documento.createElement("span");

    span.className = CLASSE_MARCA;
    span.textContent = TEXTO_MARCA;
    span.title = titulo;

    return span;
  }

  /* Marca de um ponto previsto por modelo que o grupo não validou, ou `null` quando
     não há o que marcar. Construída aqui porque triagem e conformidade mostram a
     mesma marca, e manter duas cópias do texto e da classe é como elas divergem. */
  function marcaDeModelo(documento, dados, ponto) {
    if (!documento || !ponto || pontoAferido(dados, ponto)) return null;

    return marca(
      documento,
      "Nenhum modelo foi validado para " + ponto.subsistema_modelo +
        ". A temperatura é uma estimativa não aferida e não sustenta aprovação."
    );
  }

  /* A mesma marca, no nível da área, para a tabela que resume por `Key_Area`: uma
     área pode reunir pontos de mais de um modelo, e o texto nomeia quais não são
     aferidos. `null` quando a lista vem vazia. */
  function marcaDeSubsistemas(documento, subsistemas) {
    if (!documento || !subsistemas || !subsistemas.length) return null;

    return marca(
      documento,
      "Nesta área há ponto previsto sem modelo validado (" + subsistemas.join(", ") +
        "). A área reúne pontos de mais de um modelo."
    );
  }

  /* O chip da barra diz qual modelo gerou os números, e quem decide é o próprio
     dado: ele só aparece com a versão de uma previsão do modelo. A regra mora
     aqui, e não em cada tela, porque vale para todas. */
  function refletirNaBarra(documento, dados) {
    if (!documento) return false;

    var chip = documento.getElementById("model-chip");
    var versao = documento.getElementById("model-version");

    if (!chip) return false;

    var temVersao = !!(dados && dados.versao_modelo && dados.preditor_e_stub === false);

    if (versao) versao.textContent = temVersao ? dados.versao_modelo : "—";
    chip.hidden = !temVersao;

    return true;
  }

  /* A tela monta com a previsão guardada, mas só aparece depois que a API
     confirma que está no ar: sem o serviço, o painel mostra o estado
     indisponível e nenhum número, mesmo com uma previsão na sessão. */
  function verificarServico(w) {
    if (typeof ESTADO_SERVICO === "undefined" || typeof API_PREDICAO === "undefined") return null;

    ESTADO_SERVICO.mostrar(w.document, "verificando");

    return API_PREDICAO.saude({ janela: w }).then(function (resultado) {
      if (resultado.ok) ESTADO_SERVICO.limpar(w.document);
      else ESTADO_SERVICO.mostrar(w.document, "indisponivel");
      return resultado;
    });
  }

  var CHAVE_TENTATIVA = CHAVE + ".tentativa";

  function lerArmazenamento(w) {
    // Acessar `sessionStorage` já pode lançar quando o navegador bloqueia
    // armazenamento ou a página veio de `file://`.
    try {
      return w.sessionStorage || null;
    } catch (semArmazenamento) {
      return null;
    }
  }

  /* Pede à API a previsão da configuração da URL, guarda na sessão e recarrega a
     tela, que então monta com ela. A marca de tentativa impede o ciclo: se a
     previsão recém-guardada não casar com a URL depois de recarregar, a tela
     para no estado indisponível em vez de pedir de novo para sempre. */
  function preverEGuardar(w, configuracao, armazenamento) {
    var busca = (w.location && w.location.search) || "";

    if (!armazenamento) {
      ESTADO_SERVICO.mostrar(w.document, "indisponivel", {
        texto: "Este navegador recusou o armazenamento da sessão, onde a previsão " +
          "fica entre as telas. Abra o painel pelo servidor local (Live Server) e tente de novo."
      });
      return Promise.resolve(null);
    }

    try {
      if (armazenamento.getItem(CHAVE_TENTATIVA) === busca) {
        armazenamento.removeItem(CHAVE_TENTATIVA);
        ESTADO_SERVICO.mostrar(w.document, "indisponivel");
        return Promise.resolve(null);
      }
    } catch (semLeitura) { /* segue sem a marca */ }

    ESTADO_SERVICO.mostrar(w.document, "carregando");

    return API_PREDICAO.prever(configuracao, { janela: w }).then(function (resultado) {
      if (!resultado.ok) {
        ESTADO_SERVICO.mostrar(w.document,
          resultado.erro.tipo === "validacao" ? "configuracao_invalida" : "indisponivel");
        return resultado;
      }

      try {
        armazenamento.setItem(CHAVE, JSON.stringify({
          configuracao: resultado.enviado,
          resposta: resultado.dados
        }));
        armazenamento.setItem(CHAVE_TENTATIVA, busca);
      } catch (semEscrita) {
        ESTADO_SERVICO.mostrar(w.document, "indisponivel");
        return resultado;
      }

      w.location.reload();
      return resultado;
    });
  }

  /* Telas que também servem sem configuração — a engenharia, com as métricas do
     modelo, e a comparação, com o catálogo — declaram `data-previsao="opcional"`
     no `body`. */
  function previsaoOpcional(w) {
    return !!(w.document && w.document.body && w.document.body.dataset &&
      w.document.body.dataset.previsao === "opcional");
  }

  /* Define o global com a previsão desta configuração, ou põe a tela no estado
     que explica por que não há previsão. Chamado uma vez, na carga; devolve a
     escolha para os testes e para o console. */
  function aplicar(janela) {
    var w = janela || (typeof window !== "undefined" ? window : null);

    if (!w) return { dados: null, origem: "sem_configuracao" };

    var armazenamento = lerArmazenamento(w);
    var escolha = resolver({
      armazenamento: armazenamento,
      busca: (w.location && w.location.search) || ""
    });

    /* Sem configuração na URL, a tela mostra a da última previsão e passa a
       URL a dizer qual é: é dela que os links do menu partem. */
    if (escolha.origem === "guardada") {
      try {
        var resto = (w.location.search || "").replace(/^\?/, "");
        var busca = buscaDaConfiguracao(escolha.configuracao) + (resto ? "&" + resto : "");
        w.history.replaceState(null, "", w.location.pathname + "?" + busca + (w.location.hash || ""));
      } catch (semHistorico) { /* a tela segue com a previsão, a URL fica como veio */ }
      if (typeof NAVEGACAO !== "undefined") NAVEGACAO.propagar(w.document);
      escolha.origem = "modelo";
    }

    w.PREVISAO_ORIGEM = escolha.origem;

    if (escolha.origem === "modelo") {
      w.DADOS_TRIAGEM = escolha.dados;
      try { if (armazenamento) armazenamento.removeItem(CHAVE_TENTATIVA); } catch (e) { /* sem escrita */ }
      refletirNaBarra(w.document, escolha.dados);
      verificarServico(w);
      return escolha;
    }

    if (typeof ESTADO_SERVICO === "undefined" || typeof API_PREDICAO === "undefined") return escolha;

    if (escolha.origem === "a_prever") {
      preverEGuardar(w, escolha.configuracao, armazenamento);
      return escolha;
    }

    // Sem configuração: a tela opcional segue sem previsão; as demais pedem uma.
    if (previsaoOpcional(w)) {
      verificarServico(w);
      return escolha;
    }

    API_PREDICAO.saude({ janela: w }).then(function (resultado) {
      ESTADO_SERVICO.mostrar(w.document, resultado.ok ? "sem_configuracao" : "indisponivel");
    });

    return escolha;
  }

  if (typeof window !== "undefined" && window.document) aplicar(window);

  return {
    CHAVE: CHAVE,
    CHAVE_TENTATIVA: CHAVE_TENTATIVA,
    configuracaoDaBusca: configuracaoDaBusca,
    buscaDaConfiguracao: buscaDaConfiguracao,
    mesmaConfiguracao: mesmaConfiguracao,
    respostaCompleta: respostaCompleta,
    modeloDoPonto: modeloDoPonto,
    pontoAferido: pontoAferido,
    CLASSE_MARCA: CLASSE_MARCA,
    TEXTO_MARCA: TEXTO_MARCA,
    marcaDeModelo: marcaDeModelo,
    marcaDeSubsistemas: marcaDeSubsistemas,
    refletirNaBarra: refletirNaBarra,
    resolver: resolver,
    verificarServico: verificarServico,
    preverEGuardar: preverEGuardar,
    aplicar: aplicar
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PREVISAO_SESSAO;
