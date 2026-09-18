"""Paridade com o dicionário de features do painel e comportamento da camada de predição."""

import pytest

from api.predicao.codificacao import montar_vetor_configuracao, separar_colunas
from api.predicao.protocolo import ConfiguracaoInvalida, ModeloIndisponivel

from .apoio import montar_configuracao
from .leitor_schema_js import ler_schema_js

COLUNAS = [
    "losses_present_missing",
    "losses_config_m",
    "losses_order_back_order",
    "losses_order_front_order",
    "Run_Case_Broil C1",
    "Run_Case_Broil C2",
    "Run_Case_Pyro",
    "Blower_Direction_To Back",
    "Housing_Open",
    "Board_Position_Right",
    "Deflector_Hole_Open",
    "Material_Coil_Support_Aluminium Plate",
    "Material_Coil_Support_Plastic",
]

CONFIGURACAO_BASE = {
    "blower_direction": "To Front",
    "housing": "Closed",
    "board_position": "Center",
    "run_case": "Broil C2",
    "deflector_hole": "Closed",
    "material_coil_support": "Aluminium",
    "losses": {"present": "declared", "config": "Config S", "order": "Front Order"},
}


def test_schema_servido_tem_os_mesmos_fatores_e_niveis_do_painel(cliente, caminho_schema_js):
    do_painel = ler_schema_js(caminho_schema_js)
    servido = cliente.get("/schema").json()

    assert servido["versao"] == do_painel["schema_version"]

    niveis_painel = {
        fator["key"]: [n["value"] for n in fator["levels"]] for fator in do_painel["factors"]
    }
    niveis_api = {
        fator["chave"]: [n["valor"] for n in fator["niveis"]] for fator in servido["fatores"]
    }

    assert niveis_api == niveis_painel


def test_subcampos_de_perdas_iguais_aos_do_painel(cliente, caminho_schema_js):
    do_painel = ler_schema_js(caminho_schema_js)
    perdas_painel = next(f for f in do_painel["factors"] if f["key"] == "losses")
    perdas_api = next(f for f in cliente.get("/schema").json()["fatores"] if f["chave"] == "losses")

    esperado = {s["key"]: [n["value"] for n in s["levels"]] for s in perdas_painel["subfields"]}
    obtido = {s["chave"]: [n["valor"] for n in s["niveis"]] for s in perdas_api["subcampos"]}

    assert obtido == esperado


def test_codificacao_marca_apenas_as_colunas_da_configuracao():
    vetor = dict(zip(COLUNAS, montar_vetor_configuracao(CONFIGURACAO_BASE, COLUNAS)))

    assert vetor["Run_Case_Broil C2"] == 1.0
    assert vetor["losses_order_front_order"] == 1.0
    assert sum(vetor.values()) == 2.0


def test_codificacao_trata_o_sinonimo_do_alojamento():
    vetor = dict(
        zip(
            COLUNAS,
            montar_vetor_configuracao({**CONFIGURACAO_BASE, "housing": "Open - Updated"}, COLUNAS),
        )
    )

    assert vetor["Housing_Open"] == 1.0


@pytest.mark.parametrize(
    "alteracao",
    [
        {"run_case": "Broil Inexistente"},
        {"losses": {"present": "none"}},
        {"losses": {"present": "declared", "config": "Config X"}},
        {"housing": None},
    ],
)
def test_codificacao_recusa_entrada_fora_do_vocabulario(alteracao):
    with pytest.raises(ConfiguracaoInvalida):
        montar_vetor_configuracao({**CONFIGURACAO_BASE, **alteracao}, COLUNAS)


def test_separar_colunas_exige_a_coluna_do_termopar():
    assert separar_colunas(COLUNAS + ["codigo_termopar"]) == COLUNAS

    with pytest.raises(ValueError):
        separar_colunas(COLUNAS)


def test_preditor_indisponivel_recusa_prever():
    from api.predicao.registro import construir_registro

    registro = construir_registro(montar_configuracao())
    preditor = registro.preditor("Coil Temps")

    assert preditor.estado == "indisponivel"

    with pytest.raises(ModeloIndisponivel):
        preditor.prever(CONFIGURACAO_BASE)


def test_preditor_carregado_preve_todos_os_termopares_do_subsistema():
    from api.predicao.registro import construir_registro

    registro = construir_registro(montar_configuracao("random_forest"))
    preditor = registro.preditor("Coil Temps")
    previsao = preditor.prever(CONFIGURACAO_BASE)

    assert preditor.estado == "carregado"
    assert len(previsao) == preditor.metadados.termopares_cobertos == 8
    assert all(isinstance(v, float) for v in previsao.values())
