/* Resumo executivo em linguagem natural.
 *
 * Gerado por template e regra fixa, sem modelo de linguagem: o texto só pode
 * dizer o que a contagem de estados já diz, e cada número citado sai da mesma
 * contagem que a tela técnica exibe. Estado vem pronto em cada ponto (RN-01);
 * aqui só se conta, escolhe o template e preenche.
 *
 * Sintaxe dos templates:
 *   {var}           valor já formatado
 *   {var|um|vários} escolhe pela quantidade em `var`; `#` vira o número
 * O subsistema entra com artigo e contração prontos: {sub} "o conjunto…",
 * {ao_sub} "ao conjunto…", {pelo_sub} "pelo conjunto…".
 */

var RESUMO_EXECUTIVO = (function () {
  "use strict";

  var LP = LEITURA_PUBLICOS;

  // Mesmo enquadramento em todo cenário, dentro da primeira frase.
  var ABERTURA = "Na triagem que antecede a simulação CFD, ";

  var FRASE_BANDA = {
    se: "banda",
    texto: "{banda|Outro ponto ficou|Outros # pontos ficaram} perto demais do limite para decidir sem verificação ({pct_banda})."
  };

  var FRASE_SUBSISTEMA = {
    texto: "O subsistema mais afetado é {sub}, com {sub_acima} de {sub_n} {sub_n|ponto|pontos} acima do limite."
  };

  var PASSO_REVER = {
    geral: "Rever a configuração antes de ocupar a fila da simulação CFD, a começar {pelo_sub}.",
    marketing: "Não planejar campanha sobre os temas técnicos desta configuração até a engenharia rever o projeto."
  };

  /* Um template por distribuição possível dos estados. A escolha em
     `cenario` cobre todos os casos, e o teste percorre cada um. */
  var TEMPLATES = {
    sem_limite: {
      titulo: "Nada a classificar nesta configuração",
      corpo: [
        { texto: ABERTURA + "nenhum ponto medido tem limite declarado, então não há como separar o que fica dentro do que passa do limite." }
      ],
      passo: {
        geral: "Mandar a configuração para a simulação CFD sem ordem de prioridade: a triagem não tem o que antecipar aqui.",
        marketing: "Nenhum tema técnico tem leitura nesta configuração. Aguardar a simulação CFD antes de planejar a campanha."
      }
    },

    todos_dentro: {
      titulo: "Nenhum ponto passa do limite",
      corpo: [
        { texto: ABERTURA + "a estimativa deixa {total|o único ponto com limite declarado|todos os # pontos com limite declarado} dentro do limite, com folga maior que a tolerância." }
      ],
      passo: {
        geral: "Seguir para a simulação CFD sem correção prévia. Ficar dentro do limite na triagem não é aprovação: quem confirma é a simulação.",
        marketing: "Os temas técnicos se sustentam nesta leitura e já dá para planejar a campanha com eles, mas nenhuma promessa sai antes de a simulação CFD e a validação formal confirmarem."
      }
    },

    so_inconclusivos: {
      titulo: "Nenhum ponto passa do limite, mas {banda|# fica|# ficam} sem decisão",
      corpo: [
        { texto: ABERTURA + "a estimativa não põe {total|o único ponto com limite declarado|nenhum dos # pontos com limite declarado} acima do limite, mas {banda|# ponto ficou|# pontos ficaram} perto demais dele para decidir sem verificação ({pct_banda})." },
        { texto: "O subsistema mais exposto é {sub}, com {sub_banda} de {sub_n} {sub_n|ponto|pontos} nessa situação." }
      ],
      passo: {
        geral: "Mandar para a simulação CFD começando {pelo_sub}: os pontos inconclusivos são os que ela precisa confirmar primeiro.",
        marketing: "Segurar os temas ligados {ao_sub} até a engenharia confirmar. Os demais já dá para planejar, sujeitos à validação formal."
      }
    },

    minoria_fora: {
      titulo: "{acima} de {total} pontos {acima|passa|passam} do limite",
      corpo: [
        { texto: ABERTURA + "a estimativa põe uma minoria dos {total} pontos com limite declarado acima do limite: {acima|# ponto|# pontos}, ou {pct_acima}." },
        FRASE_BANDA,
        FRASE_SUBSISTEMA
      ],
      passo: {
        geral: "Seguir para a simulação CFD com prioridade para {sub}, onde a triagem aponta o maior risco.",
        marketing: "Deixar fora da campanha, por ora, os temas ligados {ao_sub}. Os demais podem entrar no planejamento, sujeitos à validação formal."
      }
    },

    metade_fora: {
      titulo: "Metade dos pontos passa do limite",
      corpo: [
        { texto: ABERTURA + "a estimativa põe metade dos {total} pontos com limite declarado acima do limite: {acima|# ponto|# pontos}, ou {pct_acima}." },
        FRASE_BANDA,
        FRASE_SUBSISTEMA
      ],
      passo: PASSO_REVER
    },

    maioria_fora: {
      titulo: "A maioria dos pontos passa do limite",
      corpo: [
        { texto: ABERTURA + "a estimativa põe a maioria dos {total} pontos com limite declarado acima do limite: {acima|# ponto|# pontos}, ou {pct_acima}." },
        FRASE_BANDA,
        FRASE_SUBSISTEMA
      ],
      passo: PASSO_REVER
    },

    todos_fora: {
      titulo: "{total|O único ponto avaliado passa do limite|Todos os # pontos passam do limite}",
      corpo: [
        { texto: ABERTURA + "a estimativa põe {total|o único ponto com limite declarado|todos os # pontos com limite declarado} acima do limite." }
      ],
      passo: {
        geral: "Rever o projeto antes de mandar esta configuração para a simulação CFD: nesta triagem, nenhum ponto com limite fica dentro dele.",
        marketing: PASSO_REVER.marketing
      }
    }
  };

  var CENARIOS = Object.keys(TEMPLATES);

  // Fora do limite é acima do limite; a banda é contada à parte.
  function cenario(n) {
    if (n.total === 0) return "sem_limite";
    if (n.acima === 0) return n.banda === 0 ? "todos_dentro" : "so_inconclusivos";
    if (n.acima === n.total) return "todos_fora";
    if (n.acima * 2 > n.total) return "maioria_fora";
    if (n.acima * 2 === n.total) return "metade_fora";
    return "minoria_fora";
  }

  /* Os números que o texto pode citar, todos contados dos mesmos pontos que a
     tabela da triagem lista. */
  function numeros(dados) {
    var classificados = (dados && dados.pontos) || [];
    var contagem = LP.contarEstados(classificados);
    var total = classificados.length;
    var sub = LP.subsistemaMaisCritico(classificados);

    return {
      total: total,
      acima: contagem.acima_do_limite,
      banda: contagem.banda_de_incerteza,
      dentro: contagem.dentro_do_limite,
      monitorados: ((dados && dados.monitoramento) || []).length,
      pct_acima: LP.percentual(contagem.acima_do_limite, total),
      pct_banda: LP.percentual(contagem.banda_de_incerteza, total),
      pct_dentro: LP.percentual(contagem.dentro_do_limite, total),
      subsistema: sub
    };
  }

  function preencher(modelo, valores) {
    return modelo
      .replace(/\{(\w+)\|([^|{}]*)\|([^|{}]*)\}/g, function (_, chave, um, varios) {
        var n = Number(valores[chave]);
        return (n === 1 ? um : varios).replace(/#/g, String(valores[chave]));
      })
      .replace(/\{(\w+)\}/g, function (_, chave) {
        return valores[chave] === undefined ? "{" + chave + "}" : String(valores[chave]);
      });
  }

  function nomeDoSubsistema(area) {
    return LP.NOME_SUBSISTEMA[area] || { nome: area, genero: "m" };
  }

  // Artigo e contrações do subsistema, para o template não depender do gênero.
  function formasDoSubsistema(area) {
    var s = nomeDoSubsistema(area);
    var f = s.genero === "f";
    return {
      sub: (f ? "a " : "o ") + s.nome,
      ao_sub: (f ? "à " : "ao ") + s.nome,
      pelo_sub: (f ? "pela " : "pelo ") + s.nome
    };
  }

  function gerar(dados, opcoes) {
    var publico = (opcoes && opcoes.publico) === "marketing" ? "marketing" : "geral";
    var n = numeros(dados);
    var chave = cenario(n);
    var t = TEMPLATES[chave];
    var sub = n.subsistema;

    var formas = sub ? formasDoSubsistema(sub.area) : { sub: "", ao_sub: "", pelo_sub: "" };
    var valores = {
      total: n.total, acima: n.acima, banda: n.banda, dentro: n.dentro,
      pct_acima: n.pct_acima, pct_banda: n.pct_banda, pct_dentro: n.pct_dentro,
      sub: formas.sub, ao_sub: formas.ao_sub, pelo_sub: formas.pelo_sub,
      sub_n: sub ? sub.n : 0,
      sub_acima: sub ? sub.acima : 0,
      sub_banda: sub ? sub.banda : 0
    };

    var frases = t.corpo
      .filter(function (f) { return !f.se || valores[f.se] > 0; })
      .map(function (f) { return preencher(f.texto, valores); });

    return {
      cenario: chave,
      titulo: preencher(t.titulo, valores),
      frases: frases,
      texto: frases.join(" "),
      proximo_passo: preencher(t.passo[publico], valores),
      numeros: n
    };
  }

  /* ----- Desenho ----- */

  function el(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  // A cor do cartão segue o pior estado presente, como em RN-02.
  function tom(n) {
    if (n.acima > 0) return "acima_do_limite";
    if (n.banda > 0) return "banda_de_incerteza";
    return n.total > 0 ? "dentro_do_limite" : "monitoramento";
  }

  /* RN-05 pelo catálogo do modelo. Sem o catálogo não há como dizer se a
     combinação é nova: `null`, e o resumo sai sem selo. */
  function origemDaConfiguracao(config) {
    if (!LP.catalogoDoModelo()) return null;
    var entrada = LP.configuracaoNoCatalogo(config);
    if (entrada) {
      return {
        selo: "Já simulada · " + entrada.id,
        explicacao: "Esta combinação já foi simulada antes, então a leitura se apoia em rodada existente."
      };
    }
    return {
      selo: "Configuração nova",
      explicacao: "Nenhuma rodada anterior combina estas escolhas. A leitura é uma projeção, e tende a mudar mais que a de uma configuração já simulada."
    };
  }

  function numeroDoResumo(rotulo, valor, pct, estado) {
    var bloco = el("div", "resumo-exec__numero resumo-exec__numero--" + estado);
    bloco.appendChild(el("dt", null, rotulo));
    var dd = el("dd");
    dd.appendChild(el("strong", null, String(valor)));
    dd.appendChild(el("span", null, pct));
    bloco.appendChild(dd);
    return bloco;
  }

  /* Subsistemas na mesma ordem da regra que escolhe o mais afetado, para a
     lista nunca contradizer a frase. Só entram os que têm o que resolver. */
  function prioridades(dados, limite) {
    return LP.subsistemasPorCriticidade(dados.pontos || [])
      .filter(function (g) { return g.acima + g.banda > 0; })
      .slice(0, limite);
  }

  function linhaDePrioridade(g) {
    var li = el("li");
    var nome = el("span", "resumo-exec__prio-nome", nomeDoSubsistema(g.area).nome);
    nome.title = g.area;
    li.appendChild(nome);

    var partes = [];
    if (g.acima) partes.push(g.acima + " de " + g.n + " acima");
    if (g.banda) partes.push(g.banda + (g.banda === 1 ? " inconclusivo" : " inconclusivos"));
    li.appendChild(el("span", "resumo-exec__prio-conta", partes.join(" · ")));
    return li;
  }

  /* Monta o cartão em `alvo`, substituindo o que houver. `opcoes`:
     publico ("geral" | "marketing"), configuracao (a avaliada) e
     prioridades (quantos subsistemas listar; 0 omite a lista). */
  function montar(alvo, dados, opcoes) {
    opcoes = opcoes || {};
    var r = gerar(dados, opcoes);
    var n = r.numeros;
    var origem = origemDaConfiguracao(opcoes.configuracao || dados.configuracao);

    alvo.innerHTML = "";
    alvo.className = "resumo-exec resumo-exec--" + tom(n);
    alvo.dataset.cenario = r.cenario;

    // Duas colunas em tela larga: a leitura à esquerda, os números à direita.
    var corpo = el("div", "resumo-exec__corpo");
    var leitura = el("div", "resumo-exec__leitura");
    var lateral = el("div", "resumo-exec__dados");
    corpo.appendChild(leitura);
    corpo.appendChild(lateral);

    var topo = el("p", "resumo-exec__kicker", "Resumo executivo");
    if (origem) {
      var selo = el("span", "config__tag", origem.selo);
      selo.title = origem.explicacao;
      topo.appendChild(selo);
    }
    leitura.appendChild(topo);

    var titulo = el("h2", "resumo-exec__titulo", r.titulo);
    titulo.id = (alvo.id || "resumo-exec") + "-titulo";
    alvo.setAttribute("aria-labelledby", titulo.id);
    leitura.appendChild(titulo);

    var passo = el("div", "resumo-exec__passo");
    passo.appendChild(el("h3", null, "Próximo passo"));
    passo.appendChild(el("p", null, r.proximo_passo));
    leitura.appendChild(passo);

    // O texto corrido repete em frases os números ao lado: fica a um clique,
    // junto das ressalvas, e não disputa a primeira leitura.
    var extenso = el("details", "more resumo-exec__extenso");
    extenso.appendChild(el("summary", null, "Ler o resumo por extenso"));
    extenso.appendChild(el("p", "resumo-exec__texto", r.texto));
    leitura.appendChild(extenso);

    if (n.total > 0) {
      var lista = el("dl", "resumo-exec__numeros");
      lista.appendChild(numeroDoResumo("Acima do limite", n.acima, n.pct_acima, "acima_do_limite"));
      lista.appendChild(numeroDoResumo("Inconclusivos", n.banda, n.pct_banda, "banda_de_incerteza"));
      lista.appendChild(numeroDoResumo("Dentro do limite", n.dentro, n.pct_dentro, "dentro_do_limite"));
      lateral.appendChild(lista);

      // Proporção à vista; os números acima já dizem o mesmo em texto.
      var barra = el("div", "resumo-exec__barra");
      barra.setAttribute("aria-hidden", "true");
      [["acima_do_limite", n.acima], ["banda_de_incerteza", n.banda], ["dentro_do_limite", n.dentro]]
        .forEach(function (par) {
          if (!par[1]) return;
          var seg = el("span", "resumo-exec__seg resumo-exec__seg--" + par[0]);
          seg.style.flexGrow = par[1];
          barra.appendChild(seg);
        });
      lateral.appendChild(barra);

      if (n.monitorados) {
        lateral.appendChild(el("p", "resumo-exec__fora", n.monitorados === 1
          ? "Não entra na conta 1 ponto só monitorado, sem limite declarado."
          : "Não entram na conta " + n.monitorados + " pontos só monitorados, sem limite declarado."));
      }
    }

    var prios = opcoes.prioridades ? prioridades(dados, opcoes.prioridades) : [];
    if (prios.length > 1) {
      var bloco = el("div", "resumo-exec__prio");
      bloco.appendChild(el("h3", null, "Ordem sugerida para a simulação"));
      var ol = el("ol");
      prios.forEach(function (g) { ol.appendChild(linhaDePrioridade(g)); });
      bloco.appendChild(ol);
      lateral.appendChild(bloco);
    }

    alvo.appendChild(corpo);

    // A contagem dos monitorados já está junto dos números; o resto das
    // ressalvas acompanha o texto por extenso.
    var notas = [];
    if (n.monitorados && n.total === 0) {
      notas.push(n.monitorados === 1
        ? "Não entra na conta 1 ponto só monitorado, sem limite declarado."
        : "Não entram na conta " + n.monitorados + " pontos só monitorados, sem limite declarado.");
    }
    if (notas.length) extenso.appendChild(el("p", "resumo-exec__nota", notas.join(" ")));

    alvo.hidden = false;
    return r;
  }

  return {
    TEMPLATES: TEMPLATES,
    CENARIOS: CENARIOS,
    cenario: cenario,
    numeros: numeros,
    preencher: preencher,
    gerar: gerar,
    prioridades: prioridades,
    montar: montar
  };
})();
