"""GET /catalogo: configurações históricas sem identificador de rodada, com a previsão do modelo.

O dataset auditado é dado do parceiro e não é versionado, então o teste grava um dataset fictício
com o mesmo formato: quatro rodadas, uma delas réplica, uma com `Open - Updated` (que o modelo trata
como `Open`) e uma Pyro. Os limites são os do catálogo sintético, iguais para todo ponto.
"""

import csv
import json
from pathlib import Path

import pytest

from api.main import criar_app
from api.predicao.catalogo_configuracoes import carregar_catalogo_configuracoes

from .apoio import PASTA_MODELO_FINAL, RAIZ_REPOSITORIO, area_do_termopar, montar_configuracao

CODIFICADAS = [
    "losses_present_declared", "losses_present_missing", "losses_present_none",
    "losses_config_m", "losses_config_s", "losses_order_back_order", "losses_order_front_order",
]

RODADAS = [
    # Run_ID, Run_Reason, fatores, perdas codificadas
    ("Run 1", "Troca do defletor X", ("Broil C2", "To Front", "Open", "Center", "Closed", "Aluminium"),
     {"losses_present_declared": 1, "losses_config_s": 1, "losses_order_front_order": 1}),
    ("Run 2", "Réplica da troca X", ("Broil C2", "To Front", "Open", "Center", "Closed", "Aluminium"),
     {"losses_present_declared": 1, "losses_config_s": 1, "losses_order_front_order": 1}),
    ("Run 3", "Alojamento revisado Y", ("Broil C2", "To Front", "Open - Updated", "Center", "Closed", "Aluminium"),
     {"losses_present_declared": 1, "losses_config_s": 1, "losses_order_front_order": 1}),
    ("Run 4", "Pirólise com placa Z", ("Pyro", "To Back", "Closed", "Right", "Open", "Plastic"),
     {"losses_present_none": 1}),
]


def gravar_dataset_sintetico(pasta, limite_c=150.0):
    caminho = Path(pasta) / "dataset_sintetico.csv"
    termopares = []
    for metadados in sorted(PASTA_MODELO_FINAL.glob("*.json")):
        modelo = json.loads(metadados.read_text(encoding="utf-8"))
        for termopar in modelo["codigo_por_termopar"]:
            termopares.append((termopar, modelo["conjunto"]))

    cabecalho = ["Run_ID", "Run_Reason", "Run_Case", "Blower_Direction", "Housing", "Board_Position",
                 "Deflector_Hole", "Material_Coil_Support", "TC_Name", "Key_Area", "measurement_id",
                 "limit_c", "is_monitor_only"] + CODIFICADAS

    with open(caminho, "w", encoding="utf-8", newline="") as arquivo:
        escritor = csv.writer(arquivo)
        escritor.writerow(cabecalho)
        for rodada, motivo, fatores, perdas in RODADAS:
            for termopar, subsistema in termopares:
                area = area_do_termopar(termopar, subsistema)
                sem_limite = subsistema == "AC Blower Inlet"
                escritor.writerow([rodada, motivo, *fatores, termopar, area, f"{termopar} | {area}",
                                   "" if sem_limite else limite_c, sem_limite]
                                  + [perdas.get(c, 0) for c in CODIFICADAS])
    return caminho


@pytest.fixture(scope="module")
def dataset_sintetico(tmp_path_factory):
    return gravar_dataset_sintetico(tmp_path_factory.mktemp("dataset"))


@pytest.fixture(scope="module")
def cliente_catalogo(dataset_sintetico):
    from fastapi.testclient import TestClient

    with TestClient(criar_app(montar_configuracao(caminho_catalogo_pontos=dataset_sintetico))) as c:
        yield c


@pytest.fixture(scope="module")
def corpo(cliente_catalogo):
    resposta = cliente_catalogo.get("/catalogo")
    assert resposta.status_code == 200
    return resposta.json()


def test_uma_entrada_por_configuracao_com_o_numero_de_rodadas(corpo):
    ids = [c["id"] for c in corpo["configuracoes"]]
    rodadas = {c["fatores"]["housing"] + "/" + c["fatores"]["run_case"]: c["rodadas"] for c in corpo["configuracoes"]}

    assert ids == ["CFG-01", "CFG-02", "CFG-03"]
    assert corpo["total_rodadas"] == 4
    assert rodadas == {"Open/Broil C2": 2, "Open - Updated/Broil C2": 1, "Closed/Pyro": 1}


def test_contagens_reconciliadas_sete_fatores_codificadas_e_seis_fatores(corpo):
    # `Open - Updated` é outra configuração nos sete fatores, e a mesma para o modelo.
    assert corpo["total_configuracoes"] == 3
    assert corpo["total_configuracoes_codificadas"] == 2
    assert corpo["total_configuracoes_seis_fatores"] == 3


def test_nenhum_identificador_nem_motivo_de_rodada(corpo):
    texto = json.dumps(corpo, ensure_ascii=False)

    assert "Run_ID" not in texto and "Run_Reason" not in texto
    for rodada, motivo, _, _ in RODADAS:
        assert rodada not in texto
        assert motivo not in texto


def test_previsao_de_cada_configuracao_e_a_de_post_predicao(cliente_catalogo, corpo):
    """Critério de aceite do card: a comparação mostra o mesmo número que a triagem."""
    ids = [p["id"] for p in corpo["pontos"]]

    for configuracao in corpo["configuracoes"]:
        previsao = cliente_catalogo.post("/predicao", json=configuracao["fatores"]).json()
        por_id = {p["measurement_id"]: p for p in previsao["pontos"] + previsao["monitoramento"]}

        assert configuracao["t"] == [por_id[i]["temperatura_prevista_c"] for i in ids]
        assert configuracao["m"] == [por_id[i]["margem_c"] for i in ids]
        assert [corpo["estados"][e][0] for e in configuracao["e"]] == [por_id[i]["estado"] for i in ids]


def test_vetores_paralelos_aos_pontos_e_resumo_coerente(corpo):
    n = len(corpo["pontos"])
    monitorados = sum(p["mono"] for p in corpo["pontos"])

    assert n == 77
    for c in corpo["configuracoes"]:
        assert len(c["t"]) == len(c["m"]) == len(c["e"]) == n
        assert sum(c["resumo"]) == n - monitorados
        assert c["severidade"] in [e[0] for e in corpo["estados"]]


def test_sem_o_dataset_responde_503_com_o_motivo(tmp_path):
    from fastapi.testclient import TestClient

    configuracao = montar_configuracao(caminho_catalogo_pontos=tmp_path / "nao_existe.csv")
    with TestClient(criar_app(configuracao)) as c:
        resposta = c.get("/catalogo")

    assert resposta.status_code == 503
    assert resposta.json()["detail"]["erro"] == "catalogo_indisponivel"


def test_documentado_no_openapi(cliente_catalogo):
    operacao = cliente_catalogo.get("/openapi.json").json()["paths"]["/catalogo"]["get"]

    assert "503" in operacao["responses"]
    assert "RNF-05" in operacao["description"]


REAL = RAIZ_REPOSITORIO / "notebooks" / "dataset_completo_com_flags_de_auditoria.csv"


@pytest.mark.skipif(not REAL.is_file(), reason="dataset do parceiro não versionado")
def test_contagens_do_dataset_real_batem_com_a_documentacao():
    catalogo = carregar_catalogo_configuracoes(REAL)

    assert catalogo.total_rodadas == 56
    assert len(catalogo.configuracoes) == 32
