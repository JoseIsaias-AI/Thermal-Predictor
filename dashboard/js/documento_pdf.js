/* Gerador de documento PDF, sem biblioteca externa.
 *
 * Mesma premissa de js/planilha.js: o painel não usa gerenciador de pacotes e
 * a licença aberta vale também para a exportação, então o arquivo é montado
 * aqui. Usa as fontes padrão do PDF (Helvetica e Helvetica-Bold), que todo
 * leitor já tem, com a codificação WinAnsi, que cobre os acentos do português.
 * Os fluxos saem sem compressão: o arquivo continua pequeno e o teste consegue
 * ler o texto de volta para conferir os números.
 *
 * Uso:
 *   var doc = DOCUMENTO_PDF.criar({ cabecalho: "…", rodape: "…" });
 *   doc.titulo("…"); doc.paragrafo("…");
 *   doc.tabela({ colunas: [{ titulo, tipo, valor }], linhas: [...] });
 *   DOCUMENTO_PDF.baixar("registro.pdf", doc.blob());
 */

var DOCUMENTO_PDF = (function () {
  "use strict";

  // A4 retrato, em pontos.
  var LARGURA = 595.28;
  var ALTURA = 841.89;
  var MARGEM_X = 42;
  var TOPO = 64;
  var BASE = 56;
  var UTIL = LARGURA - 2 * MARGEM_X;

  // As cores de css/tokens.css, para o PDF não parecer outro sistema.
  var COR = {
    texto: [0x1b, 0x22, 0x30],
    suave: [0x5d, 0x66, 0x75],
    borda: [0xe3, 0xe7, 0xed],
    bordaForte: [0xcf, 0xd5, 0xdd],
    fundoCabecalho: [0xf4, 0xf6, 0xf9],
    fundoAviso: [0xf7, 0xf9, 0xfb],
    acento: [0x0b, 0x4a, 0x77],
    fundoAcento: [0xea, 0xf2, 0xf9],
    critico: [0xa0, 0x26, 0x1a],
    fundoCritico: [0xfd, 0xf2, 0xf0]
  };

  /* ----- Métrica das fontes -----
   *
   * Larguras AFM de Helvetica e Helvetica-Bold, em milésimos do corpo, do
   * espaço (32) ao til (126). Letra acentuada mede o mesmo que a letra-base. */
  var LARG_REGULAR = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
  ];

  var LARG_NEGRITO = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
  ];

  var LARG_ESPECIAL = {
    "°": [400, 400], "·": [278, 278], "—": [1000, 1000], "–": [556, 556],
    "…": [1000, 1000], "“": [333, 500], "”": [333, 500], "‘": [222, 278],
    "’": [222, 278], "ª": [370, 370], "º": [365, 365], "•": [350, 350],
    "×": [584, 584], "±": [584, 584], "§": [556, 556]
  };

  // Posição na WinAnsi dos caracteres fora do Latin-1.
  var WIN_ANSI = {
    "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‰": 0x89, "‘": 0x91, "’": 0x92,
    "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99
  };

  // O que a WinAnsi não tem vira o equivalente mais próximo, e não um "?".
  var TROCAS = { "≥": ">=", "≤": "<=", "→": "->", "−": "-", " ": " ", " ": " " };

  function normalizar(texto) {
    return String(texto === null || texto === undefined ? "" : texto)
      .replace(/[≥≤→−  ]/g, function (c) { return TROCAS[c]; })
      .replace(/[\r\n\t]+/g, " ");
  }

  function larguraDoCaractere(c, negrito) {
    var codigo = c.charCodeAt(0);
    var tabela = negrito ? LARG_NEGRITO : LARG_REGULAR;
    if (codigo >= 32 && codigo <= 126) return tabela[codigo - 32];
    if (LARG_ESPECIAL[c]) return LARG_ESPECIAL[c][negrito ? 1 : 0];

    var base = c.normalize ? c.normalize("NFD").charAt(0) : c;
    var b = base.charCodeAt(0);
    return b >= 32 && b <= 126 ? tabela[b - 32] : 556;
  }

  function larguraDoTexto(texto, tamanho, negrito) {
    var t = normalizar(texto);
    var soma = 0;
    for (var i = 0; i < t.length; i++) soma += larguraDoCaractere(t.charAt(i), negrito);
    return soma * tamanho / 1000;
  }

  /* String literal do PDF só com ASCII: byte acima de 127 sai em octal. Assim
     o arquivo inteiro é ASCII e a posição de cada objeto é o comprimento da
     string, sem conversão de bytes no meio. */
  function literal(texto) {
    var t = normalizar(texto);
    var saida = "(";
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i);
      var codigo = c.charCodeAt(0);
      if (WIN_ANSI[c]) codigo = WIN_ANSI[c];
      else if (codigo > 255) codigo = 63;

      if (c === "(" || c === ")" || c === "\\") saida += "\\" + c;
      else if (codigo < 32 || codigo > 126) saida += "\\" + ("00" + codigo.toString(8)).slice(-3);
      else saida += c;
    }
    return saida + ")";
  }

  /* ----- Quebra de linha ----- */

  /* Quebra uma sequência de trechos (`{texto, negrito}`) em linhas que cabem
     em `largura`. Cada linha sai como trechos com a posição x já resolvida. */
  function quebrarRico(trechos, largura, tamanho) {
    var palavras = [];
    trechos.forEach(function (t) {
      normalizar(t.texto).split(" ").forEach(function (p, i, todas) {
        if (p === "" && i < todas.length - 1) return;
        palavras.push({ texto: p, negrito: !!t.negrito, cor: t.cor });
      });
    });

    var linhas = [];
    var atual = [];
    var x = 0;
    var espaco = larguraDoTexto(" ", tamanho, false);

    function fechar() {
      if (atual.length) linhas.push(atual);
      atual = [];
      x = 0;
    }

    palavras.forEach(function (p) {
      if (p.texto === "") return;
      var w = larguraDoTexto(p.texto, tamanho, p.negrito);

      // Palavra maior que a linha: corta no caractere, para nada vazar da margem.
      if (w > largura) {
        fechar();
        var pedaco = "";
        for (var i = 0; i < p.texto.length; i++) {
          var tentativa = pedaco + p.texto.charAt(i);
          if (larguraDoTexto(tentativa, tamanho, p.negrito) > largura && pedaco) {
            linhas.push([{ texto: pedaco, negrito: p.negrito, cor: p.cor, x: 0 }]);
            pedaco = p.texto.charAt(i);
          } else {
            pedaco = tentativa;
          }
        }
        atual = [{ texto: pedaco, negrito: p.negrito, cor: p.cor, x: 0 }];
        x = larguraDoTexto(pedaco, tamanho, p.negrito);
        return;
      }

      var inicio = atual.length ? x + espaco : 0;
      if (atual.length && inicio + w > largura) {
        fechar();
        inicio = 0;
      }
      atual.push({ texto: p.texto, negrito: p.negrito, cor: p.cor, x: inicio });
      x = inicio + w;
    });
    fechar();

    return linhas.length ? linhas : [[]];
  }

  function quebrar(texto, largura, tamanho, negrito) {
    return quebrarRico([{ texto: texto, negrito: negrito }], largura, tamanho).map(function (linha) {
      return linha.map(function (t) { return t.texto; }).join(" ");
    });
  }

  /* ----- Documento ----- */

  function num(v) {
    return (Math.round(v * 100) / 100).toString();
  }

  function cor(rgb, preenchimento) {
    return rgb.map(function (c) { return num(c / 255); }).join(" ") + (preenchimento ? " rg" : " RG");
  }

  function criar(opcoes) {
    opcoes = opcoes || {};
    var paginas = [];
    var ops = null;
    var y = 0;

    function novaPagina() {
      ops = [];
      paginas.push(ops);
      y = TOPO;
    }

    function restante() {
      return ALTURA - BASE - y;
    }

    function garantir(altura) {
      if (!ops || altura > restante()) novaPagina();
    }

    function texto(t, x, yTopo, tamanho, negrito, rgb) {
      ops.push("BT " + cor(rgb || COR.texto, true) + " /" + (negrito ? "F2" : "F1") + " " + num(tamanho) +
        " Tf 1 0 0 1 " + num(x) + " " + num(ALTURA - yTopo - tamanho * 0.8) + " Tm " + literal(t) + " Tj ET");
    }

    function retangulo(x, yTopo, w, h, preenche, contorno, espessura) {
      var partes = ["q"];
      if (preenche) partes.push(cor(preenche, true));
      if (contorno) partes.push(cor(contorno, false), num(espessura || 0.6) + " w");
      partes.push(num(x) + " " + num(ALTURA - yTopo - h) + " " + num(w) + " " + num(h) + " re");
      partes.push(preenche && contorno ? "B" : (preenche ? "f" : "S"));
      partes.push("Q");
      ops.push(partes.join(" "));
    }

    function linha(x1, yTopo, x2, rgb, espessura) {
      ops.push("q " + cor(rgb, false) + " " + num(espessura || 0.5) + " w " +
        num(x1) + " " + num(ALTURA - yTopo) + " m " + num(x2) + " " + num(ALTURA - yTopo) + " l S Q");
    }

    function desenharLinhasRicas(linhas, x, tamanho, entrelinha, rgb) {
      linhas.forEach(function (l) {
        garantir(entrelinha);
        l.forEach(function (t) {
          texto(t.texto, x + t.x, y, tamanho, t.negrito, t.cor || rgb);
        });
        y += entrelinha;
      });
    }

    var doc = {
      novaPagina: function () { novaPagina(); return doc; },

      espaco: function (altura) {
        if (!ops) novaPagina();
        y += altura;
        return doc;
      },

      sobretitulo: function (t) {
        garantir(14);
        texto(normalizar(t).toUpperCase(), MARGEM_X, y, 7.5, true, COR.acento);
        y += 13;
        return doc;
      },

      titulo: function (t) {
        var linhas = quebrar(t, UTIL, 17, true);
        garantir(linhas.length * 21 + 4);
        linhas.forEach(function (l) { texto(l, MARGEM_X, y, 17, true); y += 21; });
        y += 4;
        return doc;
      },

      // Título de seção nunca fica sozinho no pé da página.
      secao: function (t, subtitulo) {
        garantir(90);
        y += 10;
        texto(t, MARGEM_X, y, 11.5, true);
        y += 16;
        if (subtitulo) {
          desenharLinhasRicas(quebrarRico([{ texto: subtitulo }], UTIL, 8.5), MARGEM_X, 8.5, 11.5, COR.suave);
        }
        y += 4;
        return doc;
      },

      /* `conteudo` é texto ou lista de trechos `{texto, negrito, cor}`. */
      paragrafo: function (conteudo, estilo) {
        estilo = estilo || {};
        var tamanho = estilo.tamanho || 9.5;
        var trechos = typeof conteudo === "string" ? [{ texto: conteudo, negrito: estilo.negrito }] : conteudo;
        if (!ops) novaPagina();
        desenharLinhasRicas(quebrarRico(trechos, UTIL, tamanho), MARGEM_X, tamanho, tamanho * 1.42, estilo.cor);
        y += estilo.depois === undefined ? 5 : estilo.depois;
        return doc;
      },

      /* Caixa de avisos. Cada item é lista de trechos; a caixa não se divide
         entre páginas, para o aviso nunca ficar separado do que ele enquadra. */
      aviso: function (itens, estilo) {
        estilo = estilo || {};
        var tamanho = 8.5;
        var entrelinha = 12;
        var pad = 9;
        var blocos = itens.map(function (trechos) {
          return quebrarRico(trechos, UTIL - 2 * pad - 9, tamanho);
        });
        var altura = 2 * pad + blocos.reduce(function (s, b) { return s + b.length * entrelinha; }, 0) +
          (blocos.length - 1) * 4;

        garantir(altura + 6);
        retangulo(MARGEM_X, y, UTIL, altura, estilo.fundo || COR.fundoAviso, estilo.borda || COR.borda, 0.6);
        if (estilo.barra) retangulo(MARGEM_X, y, 2.5, altura, estilo.barra, null);

        y += pad;
        blocos.forEach(function (linhas, i) {
          texto("•", MARGEM_X + pad, y, tamanho, false, COR.suave);
          linhas.forEach(function (l) {
            l.forEach(function (t) {
              texto(t.texto, MARGEM_X + pad + 9 + t.x, y, tamanho, t.negrito, t.cor || COR.suave);
            });
            y += entrelinha;
          });
          if (i < blocos.length - 1) y += 4;
        });
        y += pad + 8;
        return doc;
      },

      /* Tabela com cabeçalho repetido a cada página, como a tabela da tela.
         Coluna: `{ titulo, tipo: "texto" | "numero", valor(linha) }`. O valor
         sai já formatado, como a tela o exibe; pode ser `{ texto, sub, cor,
         negrito }` para a segunda linha da célula (o subsistema, na triagem).
         `estado(linha)` marca a linha acima do limite com a barra lateral. */
      tabela: function (definicao) {
        var colunas = definicao.colunas;
        var linhas = definicao.linhas;
        var tam = 8;
        var tamCab = 7.5;
        var tamSub = 7;
        var entre = 10;
        var entreSub = 9;
        var padX = 4.5;
        var padY = 4;

        function celulaDe(coluna, l) {
          var v = coluna.valor(l);
          if (v === null || v === undefined) return { texto: "" };
          return typeof v === "object" ? v : { texto: String(v) };
        }

        var celulas = linhas.map(function (l) {
          return colunas.map(function (c) { return celulaDe(c, l); });
        });

        // Largura natural pelo conteúdo mais longo; o que sobra ou falta é
        // dividido entre as colunas de texto, e número nunca quebra.
        var naturais = colunas.map(function (c, i) {
          var maior = larguraDoTexto(c.titulo, tamCab, true);
          celulas.forEach(function (linha) {
            var cel = linha[i];
            maior = Math.max(maior, larguraDoTexto(cel.texto, tam, cel.negrito),
              cel.sub ? larguraDoTexto(cel.sub, tamSub, false) : 0);
          });
          return maior + 2 * padX;
        });

        var ehNumero = colunas.map(function (c) { return c.tipo === "numero"; });
        // Cabeçalho de coluna numérica quebra, o número não.
        naturais = naturais.map(function (w, i) {
          if (!ehNumero[i]) return w;
          var maiorNumero = 0;
          celulas.forEach(function (linha) { maiorNumero = Math.max(maiorNumero, larguraDoTexto(linha[i].texto, tam, linha[i].negrito)); });
          return Math.max(maiorNumero + 2 * padX, Math.min(w, 62));
        });

        // Piso de cada coluna de texto: a palavra mais longa dela, para a
        // coluna estreita não ser espremida pela larga até partir palavra.
        var minimos = naturais.map(function (w, i) {
          if (ehNumero[i]) return w;
          var maior = 0;
          function medir(t, tamanho, negrito) {
            normalizar(t).split(" ").forEach(function (p) { maior = Math.max(maior, larguraDoTexto(p, tamanho, negrito)); });
          }
          medir(colunas[i].titulo, tamCab, true);
          celulas.forEach(function (linha) {
            medir(linha[i].texto, tam, linha[i].negrito);
            if (linha[i].sub) medir(linha[i].sub, tamSub, false);
          });
          return Math.min(w, maior + 2 * padX);
        });

        var fixas = 0;
        var flexiveis = 0;
        var pisos = 0;
        naturais.forEach(function (w, i) {
          if (ehNumero[i]) fixas += w; else { flexiveis += w; pisos += minimos[i]; }
        });

        var larguras;
        var folgaAlemDoPiso = UTIL - fixas - pisos;
        if (fixas + flexiveis <= UTIL || folgaAlemDoPiso < 0) {
          // Sobra espaço, ou nem o piso cabe: escala proporcional.
          var escala = flexiveis ? Math.max(0.1, (UTIL - fixas) / flexiveis) : 1;
          larguras = naturais.map(function (w, i) { return ehNumero[i] ? w : w * escala; });
        } else {
          // Falta espaço: cada coluna de texto fica com o piso e divide o
          // resto na proporção do que ainda queria.
          var desejo = flexiveis - pisos;
          larguras = naturais.map(function (w, i) {
            if (ehNumero[i]) return w;
            return minimos[i] + (desejo ? (w - minimos[i]) * folgaAlemDoPiso / desejo : 0);
          });
        }

        var xs = [];
        var acum = MARGEM_X;
        larguras.forEach(function (w) { xs.push(acum); acum += w; });

        var cabecalho = colunas.map(function (c, i) { return quebrar(c.titulo, larguras[i] - 2 * padX, tamCab, true); });
        var alturaCab = 2 * padY + Math.max.apply(null, cabecalho.map(function (l) { return l.length; })) * 9;

        function desenharCabecalho() {
          retangulo(MARGEM_X, y, UTIL, alturaCab, COR.fundoCabecalho, null);
          linha(MARGEM_X, y + alturaCab, MARGEM_X + UTIL, COR.bordaForte, 0.8);
          cabecalho.forEach(function (ls, i) {
            ls.forEach(function (l, k) {
              var x = ehNumero[i] ? xs[i] + larguras[i] - padX - larguraDoTexto(l, tamCab, true) : xs[i] + padX;
              texto(l, x, y + padY + k * 9, tamCab, true);
            });
          });
          y += alturaCab;
        }

        garantir(alturaCab + 3 * entre);
        desenharCabecalho();

        celulas.forEach(function (linhaCel, r) {
          var quebradas = linhaCel.map(function (cel, i) {
            return {
              linhas: ehNumero[i] ? [cel.texto] : quebrar(cel.texto, larguras[i] - 2 * padX, tam, cel.negrito),
              sub: cel.sub ? quebrar(cel.sub, larguras[i] - 2 * padX, tamSub, false) : []
            };
          });
          var altura = 2 * padY + Math.max.apply(null, quebradas.map(function (q) {
            return q.linhas.length * entre + q.sub.length * entreSub;
          }));

          if (altura > restante()) {
            novaPagina();
            desenharCabecalho();
          }

          var estado = definicao.estado ? definicao.estado(linhas[r]) : null;
          if (estado === "acima_do_limite") retangulo(MARGEM_X, y, 2.5, altura, COR.critico, null);

          quebradas.forEach(function (q, i) {
            var cel = linhaCel[i];
            var yy = y + padY;
            q.linhas.forEach(function (l) {
              var x = ehNumero[i] ? xs[i] + larguras[i] - padX - larguraDoTexto(l, tam, cel.negrito) : xs[i] + padX;
              texto(l, x, yy, tam, cel.negrito, cel.cor);
              yy += entre;
            });
            q.sub.forEach(function (l) {
              texto(l, xs[i] + padX, yy, tamSub, false, COR.suave);
              yy += entreSub;
            });
          });

          y += altura;
          linha(MARGEM_X, y, MARGEM_X + UTIL, COR.borda, 0.5);
        });

        if (definicao.nota) {
          y += 5;
          desenharLinhasRicas(quebrarRico([{ texto: definicao.nota }], UTIL, 7.5), MARGEM_X, 7.5, 10, COR.suave);
        }
        y += 8;
        return doc;
      },

      paginas: function () { return paginas.length; },

      bytes: function () { return montar(paginas, opcoes); },

      blob: function () {
        return new Blob([montar(paginas, opcoes)], { type: "application/pdf" });
      }
    };

    return doc;
  }

  /* ----- Arquivo ----- */

  /* Cabeçalho e rodapé entram no fim, quando o total de páginas é conhecido.
     O rodapé repete a natureza do documento em toda página: uma folha solta
     não pode ser lida como laudo. */
  function moldura(ops, indice, total, opcoes) {
    var saida = [];
    var yCab = 30;
    function t(txt, x, yTopo, tamanho, negrito, rgb) {
      saida.push("BT " + cor(rgb, true) + " /" + (negrito ? "F2" : "F1") + " " + num(tamanho) +
        " Tf 1 0 0 1 " + num(x) + " " + num(ALTURA - yTopo - tamanho * 0.8) + " Tm " + literal(txt) + " Tj ET");
    }

    if (opcoes.cabecalho) t(opcoes.cabecalho, MARGEM_X, yCab, 7.5, true, COR.acento);
    if (opcoes.cabecalhoDireita) {
      t(opcoes.cabecalhoDireita, LARGURA - MARGEM_X - larguraDoTexto(opcoes.cabecalhoDireita, 7.5, false), yCab, 7.5, false, COR.suave);
    }
    saida.push("q " + cor(COR.bordaForte, false) + " 0.6 w " + num(MARGEM_X) + " " + num(ALTURA - yCab - 13) +
      " m " + num(LARGURA - MARGEM_X) + " " + num(ALTURA - yCab - 13) + " l S Q");

    var yRod = ALTURA - 34;
    saida.push("q " + cor(COR.borda, false) + " 0.5 w " + num(MARGEM_X) + " " + num(ALTURA - yRod + 6) +
      " m " + num(LARGURA - MARGEM_X) + " " + num(ALTURA - yRod + 6) + " l S Q");
    if (opcoes.rodape) t(opcoes.rodape, MARGEM_X, yRod, 7, false, COR.suave);
    var pagina = "Página " + (indice + 1) + " de " + total;
    t(pagina, LARGURA - MARGEM_X - larguraDoTexto(pagina, 7, false), yRod, 7, false, COR.suave);

    return saida.concat(ops).join("\n");
  }

  function montar(paginas, opcoes) {
    if (!paginas.length) paginas = [[]];

    var objetos = [];
    function adicionar(conteudo) { objetos.push(conteudo); return objetos.length; }

    var catalogo = adicionar(null);
    var raiz = adicionar(null);
    var f1 = adicionar("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    var f2 = adicionar("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    var info = adicionar("<< /Title " + literal(opcoes.titulo || "Thermal Predictor") +
      " /Producer (Thermal Predictor) /Creator (Thermal Predictor) >>");

    var filhos = paginas.map(function (ops, i) {
      var fluxo = moldura(ops, i, paginas.length, opcoes);
      var conteudo = adicionar("<< /Length " + fluxo.length + " >>\nstream\n" + fluxo + "\nendstream");
      return adicionar("<< /Type /Page /Parent " + raiz + " 0 R /MediaBox [0 0 " + num(LARGURA) + " " + num(ALTURA) +
        "] /Resources << /Font << /F1 " + f1 + " 0 R /F2 " + f2 + " 0 R >> >> /Contents " + conteudo + " 0 R >>");
    });

    objetos[catalogo - 1] = "<< /Type /Catalog /Pages " + raiz + " 0 R >>";
    objetos[raiz - 1] = "<< /Type /Pages /Kids [" + filhos.map(function (n) { return n + " 0 R"; }).join(" ") +
      "] /Count " + filhos.length + " >>";

    var saida = "%PDF-1.4\n";
    var posicoes = [];
    objetos.forEach(function (conteudo, i) {
      posicoes.push(saida.length);
      saida += (i + 1) + " 0 obj\n" + conteudo + "\nendobj\n";
    });

    var inicioXref = saida.length;
    saida += "xref\n0 " + (objetos.length + 1) + "\n0000000000 65535 f \n";
    posicoes.forEach(function (p) { saida += ("0000000000" + p).slice(-10) + " 00000 n \n"; });
    saida += "trailer\n<< /Size " + (objetos.length + 1) + " /Root " + catalogo + " 0 R /Info " + info + " 0 R >>\n" +
      "startxref\n" + inicioXref + "\n%%EOF\n";

    var bytes = new Uint8Array(saida.length);
    for (var i = 0; i < saida.length; i++) bytes[i] = saida.charCodeAt(i) & 0xff;
    return bytes;
  }

  function baixar(nomeArquivo, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  return {
    COR: COR,
    criar: criar,
    baixar: baixar,
    larguraDoTexto: larguraDoTexto,
    quebrar: quebrar,
    literal: literal
  };
})();
