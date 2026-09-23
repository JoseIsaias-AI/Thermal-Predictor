/* Gerador de planilha .xlsx, sem biblioteca externa.
 *
 * O painel não usa gerenciador de pacotes e a premissa de licença aberta vale
 * também para a exportação, então o arquivo é montado aqui: um pacote ZIP com
 * entradas sem compressão e as partes XML mínimas que o Excel exige.
 *
 * O que a planilha entrega, e que um arquivo separado por ponto e vírgula não
 * entrega: cabeçalho em negrito, largura de coluna pelo conteúdo, número
 * alinhado à direita com casas decimais fixas, linha de título congelada e
 * filtro por coluna.
 *
 * Uso:
 *   PLANILHA.baixar("registro.xlsx", PLANILHA.gerar({
 *     aba: "Conformidade",
 *     colunas: [{ titulo: "Componente", tipo: "texto", valor: fn }, ...],
 *     linhas: [...]
 *   }));
 * Mais de uma aba: `{ abas: [{ aba, colunas, linhas }, ...] }`.
 */

var PLANILHA = (function () {
  "use strict";

  var LARGURA_MIN = 10;
  var LARGURA_MAX = 46;

  /* ----- Bytes ----- */

  function bytesDeTexto(texto) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(texto);

    // Navegador sem TextEncoder: codifica UTF-8 na mão.
    var saida = [];
    for (var i = 0; i < texto.length; i++) {
      var c = texto.charCodeAt(i);
      if (c < 0x80) { saida.push(c); continue; }
      if (c < 0x800) { saida.push(0xc0 | (c >> 6), 0x80 | (c & 63)); continue; }
      saida.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(saida);
  }

  var TABELA_CRC = (function () {
    var tabela = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabela[n] = c;
    }
    return tabela;
  })();

  function crc32(bytes) {
    var c = 0 ^ -1;
    for (var i = 0; i < bytes.length; i++) c = (c >>> 8) ^ TABELA_CRC[(c ^ bytes[i]) & 0xff];
    return (c ^ -1) >>> 0;
  }

  function escrever16(destino, valor) {
    destino.push(valor & 0xff, (valor >> 8) & 0xff);
  }

  function escrever32(destino, valor) {
    destino.push(valor & 0xff, (valor >>> 8) & 0xff, (valor >>> 16) & 0xff, (valor >>> 24) & 0xff);
  }

  function anexar(destino, bytes) {
    for (var i = 0; i < bytes.length; i++) destino.push(bytes[i]);
  }

  /* ----- Pacote ZIP -----
   *
   * Entradas sem compressão: evita escrever um deflate à mão, e o arquivo
   * inteiro fica na casa das dezenas de kilobytes. */

  function montarZip(arquivos) {
    var saida = [];
    var diretorio = [];
    var deslocamento = 0;

    arquivos.forEach(function (arquivo) {
      var nome = bytesDeTexto(arquivo.nome);
      var conteudo = bytesDeTexto(arquivo.conteudo);
      var crc = crc32(conteudo);

      var local = [];
      escrever32(local, 0x04034b50);
      escrever16(local, 20);      // versão necessária
      escrever16(local, 0x0800);  // nome do arquivo em UTF-8
      escrever16(local, 0);       // sem compressão
      escrever16(local, 0);       // hora
      escrever16(local, 0x2821);  // data fixa: o arquivo não guarda relógio
      escrever32(local, crc);
      escrever32(local, conteudo.length);
      escrever32(local, conteudo.length);
      escrever16(local, nome.length);
      escrever16(local, 0);
      anexar(local, nome);
      anexar(local, conteudo);

      escrever32(diretorio, 0x02014b50);
      escrever16(diretorio, 20);      // versão de origem
      escrever16(diretorio, 20);
      escrever16(diretorio, 0x0800);
      escrever16(diretorio, 0);
      escrever16(diretorio, 0);
      escrever16(diretorio, 0x2821);
      escrever32(diretorio, crc);
      escrever32(diretorio, conteudo.length);
      escrever32(diretorio, conteudo.length);
      escrever16(diretorio, nome.length);
      escrever16(diretorio, 0);       // extra
      escrever16(diretorio, 0);       // comentário
      escrever16(diretorio, 0);       // disco
      escrever16(diretorio, 0);       // atributos internos
      escrever32(diretorio, 0);       // atributos externos
      escrever32(diretorio, deslocamento);
      anexar(diretorio, nome);

      anexar(saida, local);
      deslocamento += local.length;
    });

    var inicioDiretorio = deslocamento;
    anexar(saida, diretorio);

    escrever32(saida, 0x06054b50);
    escrever16(saida, 0);
    escrever16(saida, 0);
    escrever16(saida, arquivos.length);
    escrever16(saida, arquivos.length);
    escrever32(saida, diretorio.length);
    escrever32(saida, inicioDiretorio);
    escrever16(saida, 0);

    return new Uint8Array(saida);
  }

  /* ----- Partes XML ----- */

  function escapar(texto) {
    return String(texto)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // A1, B1 … Z1, AA1: a coluna é base 26 com dígitos de A a Z.
  function referencia(indiceColuna, linha) {
    var letras = "";
    var n = indiceColuna;
    while (n >= 0) {
      letras = String.fromCharCode(65 + (n % 26)) + letras;
      n = Math.floor(n / 26) - 1;
    }
    return letras + linha;
  }

  var CABECALHO_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  var NS_PLANILHA = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  var NS_RELACAO = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  function tiposDeConteudo(totalDeAbas) {
    var abas = "";
    for (var i = 1; i <= totalDeAbas; i++) {
      abas += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    return CABECALHO_XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      abas +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';
  }

  function relacoesRaiz() {
    return CABECALHO_XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + NS_RELACAO + '/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
  }

  // Aba i tem sheetId i e relação rId i; o estilo fica com o rId seguinte.
  function pasta(nomes) {
    return CABECALHO_XML +
      '<workbook xmlns="' + NS_PLANILHA + '" xmlns:r="' + NS_RELACAO + '">' +
      '<sheets>' + nomes.map(function (nome, i) {
        return '<sheet name="' + escapar(nome) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join("") + '</sheets>' +
      '</workbook>';
  }

  function relacoesDaPasta(totalDeAbas) {
    var abas = "";
    for (var i = 1; i <= totalDeAbas; i++) {
      abas += '<Relationship Id="rId' + i + '" Type="' + NS_RELACAO + '/worksheet" Target="worksheets/sheet' + i + '.xml"/>';
    }
    return CABECALHO_XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      abas +
      '<Relationship Id="rId' + (totalDeAbas + 1) + '" Type="' + NS_RELACAO + '/styles" Target="styles.xml"/>' +
      '</Relationships>';
  }

  /* Cinco formatos, na ordem em que `estiloDaColuna` os referencia:
     0 texto, 1 cabeçalho, 2 número com duas casas, 3 número com uma casa,
     4 inteiro. */
  function estilos() {
    return CABECALHO_XML +
      '<styleSheet xmlns="' + NS_PLANILHA + '">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>' +
      '<fonts count="2">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF1B2230"/><name val="Calibri"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF4F6F9"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FFCFD5DD"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  function estiloDaColuna(coluna) {
    if (coluna.tipo === "numero") return 2;
    if (coluna.tipo === "numero1") return 3;
    if (coluna.tipo === "inteiro") return 4;
    return 0;
  }

  function ehNumerica(coluna) {
    return coluna.tipo === "numero" || coluna.tipo === "numero1" || coluna.tipo === "inteiro";
  }

  /* Largura pelo conteúdo mais longo da coluna, com piso e teto para nenhuma
     coluna sumir nem empurrar as outras para fora da tela. O número entra pelo
     tamanho que a célula exibe, e não pelo do ponto flutuante: -89,67 ocupa
     seis caracteres na tela e dezoito na representação bruta. */
  function larguraDaColuna(coluna, linhas) {
    var casas = { numero: 2, numero1: 1, inteiro: 0 }[coluna.tipo];
    if (casas === undefined) casas = null;
    var maior = String(coluna.titulo).length;

    linhas.forEach(function (linha) {
      var valor = coluna.valor(linha);
      if (valor === null || valor === undefined) return;

      var exibido = casas !== null && isFinite(valor) ? Number(valor).toFixed(casas) : String(valor);
      if (exibido.length > maior) maior = exibido.length;
    });

    return Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, maior + 3));
  }

  function celula(ref, estilo, valor, numerica) {
    if (valor === null || valor === undefined || valor === "") {
      return '<c r="' + ref + '" s="' + estilo + '"/>';
    }
    if (numerica && isFinite(valor)) {
      return '<c r="' + ref + '" s="' + estilo + '"><v>' + valor + '</v></c>';
    }
    return '<c r="' + ref + '" s="' + estilo + '" t="inlineStr"><is><t xml:space="preserve">' +
      escapar(valor) + '</t></is></c>';
  }

  function aba(colunas, linhas, selecionada) {
    var ultima = referencia(colunas.length - 1, linhas.length + 1);
    var partes = [];

    partes.push(CABECALHO_XML);
    partes.push('<worksheet xmlns="' + NS_PLANILHA + '">');
    partes.push('<dimension ref="A1:' + ultima + '"/>');
    // Título congelado: a tabela passa de trinta linhas e rolar não pode custar
    // o nome da coluna.
    partes.push('<sheetViews><sheetView' + (selecionada ? ' tabSelected="1"' : "") + ' workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>');
    partes.push('<sheetFormatPr defaultRowHeight="15"/>');

    partes.push("<cols>");
    colunas.forEach(function (coluna, i) {
      partes.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
        larguraDaColuna(coluna, linhas) + '" customWidth="1"/>');
    });
    partes.push("</cols>");

    partes.push("<sheetData>");

    partes.push('<row r="1" ht="22" customHeight="1">');
    colunas.forEach(function (coluna, i) {
      partes.push(celula(referencia(i, 1), 1, coluna.titulo, false));
    });
    partes.push("</row>");

    linhas.forEach(function (linha, indice) {
      var numeroDaLinha = indice + 2;
      partes.push('<row r="' + numeroDaLinha + '">');
      colunas.forEach(function (coluna, i) {
        partes.push(celula(referencia(i, numeroDaLinha), estiloDaColuna(coluna),
          coluna.valor(linha), ehNumerica(coluna)));
      });
      partes.push("</row>");
    });

    partes.push("</sheetData>");
    partes.push('<autoFilter ref="A1:' + ultima + '"/>');
    partes.push("</worksheet>");

    return partes.join("");
  }

  /* ----- Entrada pública ----- */

  // O Excel recusa aba com mais de 31 caracteres ou com nome repetido.
  function nomesDasAbas(abas) {
    var usados = {};
    return abas.map(function (a, i) {
      var nome = String(a.aba || "Planilha" + (i + 1)).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31);
      var base = nome;
      for (var n = 2; usados[nome.toLowerCase()]; n++) nome = base.slice(0, 28) + " " + n;
      usados[nome.toLowerCase()] = true;
      return nome;
    });
  }

  function gerarBytes(planilha) {
    var abas = planilha.abas || [planilha];
    var arquivos = [
      { nome: "[Content_Types].xml", conteudo: tiposDeConteudo(abas.length) },
      { nome: "_rels/.rels", conteudo: relacoesRaiz() },
      { nome: "xl/workbook.xml", conteudo: pasta(nomesDasAbas(abas)) },
      { nome: "xl/_rels/workbook.xml.rels", conteudo: relacoesDaPasta(abas.length) },
      { nome: "xl/styles.xml", conteudo: estilos() }
    ];

    abas.forEach(function (a, i) {
      arquivos.push({ nome: "xl/worksheets/sheet" + (i + 1) + ".xml", conteudo: aba(a.colunas, a.linhas, i === 0) });
    });

    return montarZip(arquivos);
  }

  function gerar(planilha) {
    return new Blob([gerarBytes(planilha)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  function baixar(nomeArquivo, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");

    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    gerarBytes: gerarBytes,
    gerar: gerar,
    baixar: baixar,
    referencia: referencia,
    escapar: escapar,
    crc32: crc32
  };
})();
