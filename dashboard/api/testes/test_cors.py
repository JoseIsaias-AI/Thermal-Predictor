"""CORS: sem ele o painel não fala com a API pelo navegador.

A página é servida por um servidor estático e a API responde em outra porta, o que o
navegador trata como origem diferente. Como a requisição de predição manda
`Content-Type: application/json`, ela deixa de ser simples e passa a exigir *preflight*:
o navegador faz um OPTIONS antes do POST e só segue se a resposta autorizar origem,
método e cabeçalho. Estes testes prendem esse contrato, que o `curl` não exercita.
"""

from api.configuracao import ORIGENS_PADRAO

from .test_predicao import EXEMPLO

ORIGEM = ORIGENS_PADRAO[0]


def test_preflight_do_post_predicao_e_autorizado(cliente_predicao):
    resposta = cliente_predicao.options(
        "/predicao",
        headers={
            "Origin": ORIGEM,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )

    assert resposta.status_code == 200
    assert resposta.headers["access-control-allow-origin"] == ORIGEM
    assert "POST" in resposta.headers["access-control-allow-methods"]
    assert "content-type" in resposta.headers["access-control-allow-headers"].lower()


def test_post_de_origem_conhecida_recebe_o_cabecalho(cliente_predicao):
    resposta = cliente_predicao.post("/predicao", json=EXEMPLO, headers={"Origin": ORIGEM})

    assert resposta.status_code == 200
    assert resposta.headers["access-control-allow-origin"] == ORIGEM


def test_origem_desconhecida_nao_recebe_autorizacao(cliente_predicao):
    """O serviço responde na máquina do usuário: página de fora não pode ler a resposta."""
    resposta = cliente_predicao.post(
        "/predicao", json=EXEMPLO, headers={"Origin": "https://exemplo-de-fora.invalid"}
    )

    assert "access-control-allow-origin" not in resposta.headers


def test_api_nao_aceita_credenciais(cliente_predicao):
    """Sem sessão nem cookie: liberar credenciais só ampliaria a superfície à toa."""
    resposta = cliente_predicao.post("/predicao", json=EXEMPLO, headers={"Origin": ORIGEM})

    assert "access-control-allow-credentials" not in resposta.headers


def test_origens_padrao_cobrem_o_servidor_estatico_do_painel():
    """As portas são as mesmas que o chatbot aceita, para os dois serviços não divergirem."""
    assert "http://127.0.0.1:5500" in ORIGENS_PADRAO
    assert "http://localhost:5500" in ORIGENS_PADRAO
