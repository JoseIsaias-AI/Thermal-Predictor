"""Executa os módulos JavaScript do painel a partir do pytest, via `node`.

Existe para fechar o único vão que os testes dos dois lados deixavam. Os testes da API
montam o corpo da requisição à mão, em Python; os testes do painel conferem o cliente
contra um `fetch` falso. Nenhum dos dois prova que **o corpo que o JavaScript realmente
monta é o que a API realmente aceita**, nem que **a resposta que a API realmente devolve
passa no validador do painel**.

Esse vão é silencioso e caro: se a API deixar de mandar um campo, `respostaCompleta()` em
`js/previsao_sessao.js` recusa a previsão e a tela volta aos valores de demonstração, sem
erro e sem aviso. O usuário veria números sintéticos achando que são do modelo.

A ponte não roda navegador: carrega os mesmos arquivos `.js` que as páginas carregam, pelo
`require` do Node, e troca JSON pela linha de comando e pela saída padrão.
"""

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote

import pytest

PASTA_JS = Path(__file__).resolve().parents[2] / "js"

NODE = shutil.which("node")

exige_node = pytest.mark.skipif(
    NODE is None, reason="`node` não está no PATH; a ponte com o JavaScript do painel não roda"
)

# Configuração completa, para o cliente não barrar o envio antes de chegar ao `fetch`.
_ENTRADA_VALIDA = {
    "blower_direction": "To Front",
    "housing": "Closed",
    "board_position": "Center",
    "run_case": "Broil C2",
    "deflector_hole": "Closed",
    "material_coil_support": "Aluminium",
    "losses": {"present": "declared", "config": "Config S"},
}


def _executar(corpo_js, entrada):
    """Roda um trecho de JS com `entrada` como `dados` e devolve o que ele imprimir.

    O script vai para um arquivo `.cjs` temporário, e não para `node -e`: com `-e`, o Node
    recusa um script que tenha `require` e `await` juntos, porque não consegue decidir o
    formato do módulo. A extensão resolve isso declarando CommonJS.
    """
    linhas = [
        "const API = require(process.argv[2]);",
        "const PS = require(process.argv[3]);",
        "const dados = JSON.parse(process.argv[4]);",
        "(async () => {",
        "  let saida;",
        "  " + corpo_js,
        "  process.stdout.write(JSON.stringify(saida));",
        "})();",
    ]

    with tempfile.TemporaryDirectory() as pasta:
        caminho = Path(pasta) / "ponte.cjs"
        caminho.write_text("\n".join(linhas), encoding="utf-8")

        resultado = subprocess.run(
            [
                NODE,
                str(caminho),
                str(PASTA_JS / "api_predicao.js"),
                str(PASTA_JS / "previsao_sessao.js"),
                json.dumps(entrada),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
        )

    if resultado.returncode != 0:
        raise AssertionError(f"node falhou: {resultado.stderr.strip()[:500]}")

    return json.loads(resultado.stdout)


def montar_corpo(entrada):
    """O corpo que `api_predicao.montarCorpo` constrói, como o formulário o constrói.

    Devolve `None` quando o painel bloqueia o envio por campo obrigatório ausente.
    """
    return _executar("saida = API.montarCorpo(dados);", entrada)


def resposta_completa(resposta):
    """Se `previsao_sessao.respostaCompleta` aceita a resposta; falso manda a tela ao stub."""
    return _executar("saida = PS.respostaCompleta(dados);", resposta)


def aferimento_dos_pontos(resposta):
    """Como o painel casa cada ponto com o modelo que o previu, em uma passada.

    Devolve `{TC_Name: {area, subsistema_modelo, modelo, validado, aferido}}`, com
    `modelo` e `validado` saindo de `previsao_sessao.modeloDoPonto` e `aferido` de
    `pontoAferido`. É aqui que se vê se a mescla por área chegou inteira: o modelo
    final não é um só, e `AC Blower Inlet` prevê pontos da área `Main Vent Sys`
    sem ter sido validado.

    Uma chamada e não duas por ponto: a resposta inteira viaja pela linha de
    comando, e mandá-la 77 vezes estouraria o limite do Windows.
    """
    return _executar(
        "saida = {};"
        " dados.pontos.concat(dados.monitoramento).forEach(function (p) {"
        "   var m = PS.modeloDoPonto(dados, p);"
        "   saida[p.TC_Name] = {"
        "     area: p.Key_Area,"
        "     subsistema_modelo: p.subsistema_modelo,"
        "     modelo: m ? m.subsistema : null,"
        "     validado: m ? m.validado : null,"
        "     aferido: PS.pontoAferido(dados, p)"
        "   };"
        " });",
        resposta,
    )


def mesma_configuracao(a, b):
    """Se o painel considera as duas configurações a mesma, para casar previsão e tela."""
    return _executar("saida = PS.mesmaConfiguracao(dados[0], dados[1]);", [a, b])


def resolver(configuracao, resposta, busca, stub):
    """O que a tela exibiria: a previsão ou o stub, e por quê."""
    return _executar(
        "saida = PS.resolver({ stub: dados.stub, busca: dados.busca, armazenamento: {"
        " getItem: function (chave) {"
        " return chave === PS.CHAVE ? JSON.stringify(dados.guardado) : null; } } });",
        {
            "stub": stub,
            "busca": busca,
            "guardado": {"configuracao": configuracao, "resposta": resposta},
        },
    )


def classificar_erro(status, corpo):
    """O que o painel diz ao usuário diante de uma resposta de erro real da API.

    Alimenta `api_predicao.prever` com um `fetch` falso que devolve exatamente o corpo que a
    API devolveu, para conferir que a mensagem explicativa do servidor chega à tela em vez
    do texto genérico do cliente.
    """
    return _executar(
        "const resposta = { ok: false, status: dados.status,"
        " json: function () { return Promise.resolve(dados.corpo); } };"
        " saida = await API.prever(dados.entrada, {"
        " fetch: function () { return Promise.resolve(resposta); },"
        " base: 'http://127.0.0.1:0' });",
        {"status": status, "corpo": corpo, "entrada": _ENTRADA_VALIDA},
    )


def para_query_string(configuracao):
    """Mesma serialização de `paraQueryString` em `js/app.js`, que leva a configuração à tela."""
    partes = []

    for chave, valor in configuracao.items():
        if valor is None:
            continue

        if isinstance(valor, dict):
            for sub, valor_do_sub in valor.items():
                if valor_do_sub is None:
                    continue
                partes.append((f"{chave}.{sub}", valor_do_sub))
            continue

        partes.append((chave, valor))

    return "?" + "&".join(quote(c, safe=".") + "=" + quote(str(v), safe="") for c, v in partes)
