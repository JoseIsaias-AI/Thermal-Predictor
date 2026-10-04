"""POST /predicao: configuração válida, entradas inválidas e falhas durante a inferência."""

import pytest

from api.main import criar_app
from api.predicao.catalogo_pontos import carregar_catalogo_pontos
from api.predicao.inferencia import inferir

from .apoio import ler_stub_do_painel, montar_configuracao

EXEMPLO = {
    "blower_direction": "To Front",
    "housing": "Closed",
    "board_position": "Center",
    "run_case": "Broil C2",
    "deflector_hole": "Closed",
    "material_coil_support": "Aluminium",
    "losses": {"present": "declared", "config": "Config S", "order": "Front Order"},
}


def _cliente(configuracao):
    from fastapi.testclient import TestClient

    return TestClient(criar_app(configuracao))


def test_configuracao_valida_devolve_a_temperatura_de_cada_componente(cliente_predicao):
    resposta = cliente_predicao.post("/predicao", json=EXEMPLO)
    corpo = resposta.json()
    todos = corpo["pontos"] + corpo["monitoramento"]
    algoritmos = {modelo["subsistema"]: modelo["algoritmo"] for modelo in corpo["modelos"]}

    assert resposta.status_code == 200
    assert corpo["total_pontos"] == len(todos) == 77
    assert corpo["total_monitoramento"] == 2
    assert all(isinstance(ponto["temperatura_prevista_c"], float) for ponto in todos)
    assert corpo["configuracao"] == EXEMPLO
    assert corpo["preditor_e_stub"] is False
    assert (algoritmos["IPC Comp"], algoritmos["IPC Cooling"]) == ("SVR", "Extra Trees")


def test_exemplo_publicado_no_contrato_e_aceito(cliente_predicao):
    exemplo = cliente_predicao.get("/schema").json()["exemplo_de_entrada"]

    assert cliente_predicao.post("/predicao", json=exemplo).status_code == 200


def test_resposta_tem_o_formato_que_o_painel_consome(cliente_predicao):
    stub = ler_stub_do_painel()
    corpo = cliente_predicao.post("/predicao", json=stub["configuracao"]).json()

    # Contém o que o stub tem, e pode conter mais: `subsistema_modelo` é da
    # resposta, e não do dado de demonstração. Ver test_inferencia.py.
    assert set(stub) <= set(corpo)
    assert set(stub["pontos"][0]) <= set(corpo["pontos"][0])
    assert set(stub["monitoramento"][0]) <= set(corpo["monitoramento"][0])


def test_endpoint_devolve_o_mesmo_que_a_funcao_de_inferencia(cliente_predicao):
    estado = cliente_predicao.app.state
    configuracao = {
        **EXEMPLO,
        "run_case": "Pyro",
        "blower_direction": "To Back",
        "losses": {"present": "none"},
    }
    direto = inferir(configuracao, estado.registro, estado.catalogo_pontos)

    assert cliente_predicao.post("/predicao", json=configuracao).json() == direto


@pytest.mark.parametrize(
    ("alteracao", "campo"),
    [
        ({"run_case": "Broil X"}, "run_case"),
        ({"housing": ""}, "housing"),
        ({"losses": {"present": "declared", "order": "Front Order"}}, "losses.config"),
        ({"losses": {"present": "missing", "config": "Config S"}}, "losses.config"),
        ({"losses": {"present": "declared", "config": "Config S", "order": "Side"}}, "losses.order"),
        ({"losses": {"present": "talvez"}}, "losses.present"),
        ({"cor": "azul"}, "cor"),
        ({"losses": "declared"}, "losses"),
        ({"run_case": 3}, "run_case"),
    ],
)
def test_configuracao_fora_do_contrato_e_recusada_apontando_o_campo(
    cliente_predicao, alteracao, campo
):
    resposta = cliente_predicao.post("/predicao", json={**EXEMPLO, **alteracao})
    detalhe = resposta.json()["detail"]

    assert resposta.status_code == 422
    assert detalhe["erro"] == "configuracao_invalida"
    assert campo in {c["campo"] for c in detalhe["campos"]}
    assert detalhe["mensagem"]


def test_fator_ausente_e_recusado(cliente_predicao):
    sem_alojamento = {chave: valor for chave, valor in EXEMPLO.items() if chave != "housing"}
    detalhe = cliente_predicao.post("/predicao", json=sem_alojamento).json()["detail"]

    assert detalhe["erro"] == "configuracao_invalida"
    assert detalhe["campos"] == [{"campo": "housing", "mensagem": "campo obrigatório ausente."}]


def test_combinacao_sem_representacao_na_base_e_recusada(cliente_predicao):
    resposta = cliente_predicao.post("/predicao", json={**EXEMPLO, "losses": {"present": "none"}})

    assert resposta.status_code == 422
    assert resposta.json()["detail"]["erro"] == "configuracao_invalida"
    assert "Pyro" in resposta.json()["detail"]["mensagem"]


def test_corpo_que_nao_e_json_e_recusado(cliente_predicao):
    resposta = cliente_predicao.post(
        "/predicao", content="{nao é json", headers={"Content-Type": "application/json"}
    )

    assert resposta.status_code == 422
    assert resposta.json()["detail"]["campos"][0]["campo"] == "corpo"


def test_sem_modelo_carregado_responde_503(catalogo_sem_familia, catalogo_pontos_sintetico):
    configuracao = montar_configuracao(
        caminho_catalogo=catalogo_sem_familia, caminho_catalogo_pontos=catalogo_pontos_sintetico
    )

    with _cliente(configuracao) as cliente:
        resposta = cliente.post("/predicao", json=EXEMPLO)

    assert resposta.status_code == 503
    assert resposta.json()["detail"]["erro"] == "modelo_indisponivel"


def test_sem_catalogo_de_limites_responde_503_e_a_saude_avisa(cliente_predicao, monkeypatch, tmp_path):
    # O mesmo que a subida faz quando o arquivo não existe nesta máquina.
    ausente = carregar_catalogo_pontos(tmp_path / "ausente.csv")
    monkeypatch.setattr(cliente_predicao.app.state, "catalogo_pontos", ausente)
    monkeypatch.setattr(cliente_predicao.app.state.servico_de_predicao, "catalogo_pontos", ausente)

    resposta = cliente_predicao.post("/predicao", json=EXEMPLO)
    saude = cliente_predicao.get("/saude").json()

    assert resposta.status_code == 503
    assert resposta.json()["detail"]["erro"] == "catalogo_indisponivel"
    assert ".csv" not in resposta.text
    assert saude["catalogo_pontos"]["disponivel"] is False
    assert saude["catalogo_pontos"]["motivo"]


def test_saude_informa_o_catalogo_de_limites_carregado(cliente_predicao):
    catalogo = cliente_predicao.get("/saude").json()["catalogo_pontos"]

    assert catalogo == {"disponivel": True, "pontos": 77, "motivo": None}


class PreditorQuebrado:
    """Modelo carregado que falha na hora de prever, como um artefato corrompido."""

    estado = "carregado"
    motivo = None

    def __init__(self, original):
        self.metadados = original.metadados

    def prever(self, configuracao, termopares=None):
        raise RuntimeError("detalhe interno 42")


def test_falha_inesperada_na_inferencia_responde_500_sem_expor_o_detalhe(
    cliente_predicao, monkeypatch
):
    preditores = cliente_predicao.app.state.registro.preditores
    monkeypatch.setitem(preditores, "Coil Temps", PreditorQuebrado(preditores["Coil Temps"]))

    resposta = cliente_predicao.post("/predicao", json=EXEMPLO)

    assert resposta.status_code == 500
    assert resposta.json()["detail"]["erro"] == "falha_na_inferencia"
    assert "detalhe interno 42" not in resposta.text
