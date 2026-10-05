"""A documentação gerada pelo FastAPI descreve os três endpoints."""

CAMINHOS = ("/saude", "/schema", "/modelos", "/desempenho")


def test_openapi_descreve_os_tres_endpoints(cliente):
    resposta = cliente.get("/openapi.json")
    documento = resposta.json()

    assert resposta.status_code == 200
    assert set(CAMINHOS) <= set(documento["paths"])

    for caminho in CAMINHOS:
        operacao = documento["paths"][caminho]["get"]
        assert operacao["summary"]
        assert operacao["description"]
        assert operacao["tags"]
        assert "200" in operacao["responses"]
        assert operacao["responses"]["200"]["content"]["application/json"]["schema"]


def test_openapi_descreve_a_rota_de_predicao(cliente):
    documento = cliente.get("/openapi.json").json()
    operacao = documento["paths"]["/predicao"]["post"]
    corpo = operacao["requestBody"]["content"]["application/json"]["schema"]

    assert operacao["summary"]
    assert operacao["description"]
    assert operacao["tags"] == ["predição"]
    assert corpo["$ref"].endswith("/RequisicaoPredicao")
    assert documento["components"]["schemas"]["RequisicaoPredicao"]["examples"]
    assert {"200", "422", "503", "500"} <= set(operacao["responses"])


def test_swagger_esta_no_ar(cliente):
    resposta = cliente.get("/docs")

    assert resposta.status_code == 200
    assert "swagger" in resposta.text.lower()


def test_documentacao_nao_cita_dado_do_parceiro(cliente):
    documento = cliente.get("/openapi.json").text.lower()

    assert "whirlpool" not in documento
    assert ".csv" not in documento
    assert ".joblib" not in documento
