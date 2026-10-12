"""Função de inferência: mesmo pré-processamento do treino, modelo final e payload do painel.

Os modelos servidos são os que `sintetico/treinar_modelos.py` treina sobre a base sintética. A
paridade com o treino é conferida pelas colunas de entrada e pela composição declaradas pelo
script de treino.
"""

import json
import sys

import pytest

from api.predicao.catalogo_pontos import CatalogoPontos, PontoDeMedicao, carregar_catalogo_pontos
from api.predicao.inferencia import ORDEM_ESTADOS, classificar, inferir
from api.predicao.protocolo import CatalogoIndisponivel, ConfiguracaoInvalida, ModeloIndisponivel
from api.predicao.registro import construir_registro

from .apoio import (
    PASTA_MODELO_FINAL,
    RAIZ_REPOSITORIO,
    area_do_termopar,
    ler_fixture_do_painel,
    montar_configuracao,
)

CONFIGURACAO = {
    "blower_direction": "To Back",
    "housing": "Open",
    "board_position": "Right",
    "run_case": "Broil C1",
    "deflector_hole": "Open",
    "material_coil_support": "Plastic",
    "losses": {"present": "declared", "config": "Config M", "order": "Back Order"},
}

MEDIA = "Média de Random Forest e Gradient Boosting"
ALGORITMO_POR_SUBSISTEMA = {
    "Mainback": MEDIA, "Coil Temps": MEDIA, "Main Vent Sys": MEDIA,
    "HMI / Knobs / Console": MEDIA, "AC Blower Inlet": MEDIA,
    "IPC Comp": "SVR", "IPC Cooling": "Extra Trees",
}


def modulo_de_treino():
    sys.path.insert(0, str(RAIZ_REPOSITORIO / "sintetico"))
    import treinar_modelos

    return treinar_modelos


@pytest.fixture(scope="module")
def registro_final():
    """Registro como o serviço monta hoje: a família padrão do catálogo."""
    return construir_registro(montar_configuracao())


@pytest.fixture(scope="module")
def catalogo_sintetico(registro_final):
    """Limite fictício de 150 °C em todo ponto, e AC Blower Inlet sem limite, como na base.

    A área vem de `area_do_termopar`, e não do nome do modelo: na base real as duas
    coisas não coincidem (ver `apoio.AREA_REAL_DO_TERMOPAR`).
    """
    pontos = {}

    for subsistema, preditor in registro_final.preditores.items():
        sem_limite = subsistema == "AC Blower Inlet"
        for termopar in preditor.metadados.termopares:
            area = area_do_termopar(termopar, subsistema)
            pontos[termopar] = PontoDeMedicao(
                termopar=termopar,
                area=area,
                measurement_id=f"{termopar} | {area}",
                limite_c=None if sem_limite else 150.0,
                so_monitoramento=sem_limite,
            )

    return CatalogoPontos(pontos)


def test_inferencia_preve_todos_os_termopares_com_o_modelo_final(registro_final, catalogo_sintetico):
    payload = inferir(CONFIGURACAO, registro_final, catalogo_sintetico)
    esperados = sum(p.metadados.termopares_cobertos for p in registro_final.preditores.values())
    todos = payload["pontos"] + payload["monitoramento"]

    assert payload["total_pontos"] == len(todos) == esperados == 77
    assert payload["total_classificados"] == len(payload["pontos"])
    assert payload["total_monitoramento"] == len(payload["monitoramento"]) == 2
    assert all(isinstance(p["temperatura_prevista_c"], float) for p in todos)
    assert payload["preditor_e_stub"] is False
    assert {p.metadados.versao for p in registro_final.preditores.values()} == {
        payload["versao_modelo"]}
    assert payload["configuracao"] == CONFIGURACAO
    assert {m["familia"] for m in payload["modelos"]} == {"modelo_final"}
    assert len(payload["modelos"]) == 7


def test_payload_tem_o_formato_que_o_painel_consome(registro_final, catalogo_sintetico):
    fixture = ler_fixture_do_painel()
    payload = inferir(CONFIGURACAO, registro_final, catalogo_sintetico)

    # Contém tudo o que a fixture dos testes do painel tem, e pode conter mais. O
    # que o teste fixa é que nenhum campo lido pelas telas desapareça da resposta.
    assert set(fixture) <= set(payload)
    assert set(fixture["pontos"][0]) <= set(payload["pontos"][0])
    assert set(fixture["monitoramento"][0]) <= set(payload["monitoramento"][0])

    # E que o campo novo chegue em todos os pontos, não só no primeiro.
    todos = payload["pontos"] + payload["monitoramento"]
    assert all(p["subsistema_modelo"] for p in todos)
    assert {p["subsistema_modelo"] for p in todos} == {m["subsistema"] for m in payload["modelos"]}


def test_lista_principal_vem_ordenada_por_estado_e_folga(registro_final, catalogo_sintetico):
    pontos = inferir(CONFIGURACAO, registro_final, catalogo_sintetico)["pontos"]
    chaves = [(ORDEM_ESTADOS.index(p["estado"]), p["margem_c"]) for p in pontos]

    assert chaves == sorted(chaves)


def test_cada_subsistema_usa_o_algoritmo_do_modelo_final(registro_final):
    servidos = {nome: p.metadados.algoritmo for nome, p in registro_final.preditores.items()}

    assert servidos == ALGORITMO_POR_SUBSISTEMA
    # Nenhum modelo validado para os pontos de entrada do soprador: poucas rodadas com leitura.
    assert registro_final.preditor("AC Blower Inlet").metadados.validado is False
    assert all(p.metadados.validado for n, p in registro_final.preditores.items()
               if n != "AC Blower Inlet")


def test_metadados_do_modelo_final_batem_com_o_treino():
    treino = modulo_de_treino()
    metadados = [json.loads(c.read_text(encoding="utf-8")) for c in PASTA_MODELO_FINAL.glob("*.json")]

    assert len(metadados) == 7
    for meta in metadados:
        assert meta["colunas_entrada"] == treino.COLUNAS_CONFIGURACAO + ["codigo_termopar"]
        codigos = sorted(meta["codigo_por_termopar"].values())
        assert codigos == list(range(len(codigos))), meta["conjunto"]


@pytest.mark.parametrize(
    "alteracao",
    [
        {"run_case": "Broil Inexistente"},
        {"housing": None},
        {"losses": {"present": "none"}},
        {"losses": {"present": "declared", "order": "Side Order"}},
    ],
)
def test_configuracao_fora_do_vocabulario_e_recusada(alteracao, registro_final, catalogo_sintetico):
    with pytest.raises(ConfiguracaoInvalida):
        inferir({**CONFIGURACAO, **alteracao}, registro_final, catalogo_sintetico)


def test_sem_modelo_carregado_a_inferencia_e_interrompida(catalogo_sem_familia, catalogo_sintetico):
    registro = construir_registro(montar_configuracao(caminho_catalogo=catalogo_sem_familia))

    with pytest.raises(ModeloIndisponivel, match="7 de 7"):
        inferir(CONFIGURACAO, registro, catalogo_sintetico)


def test_sem_catalogo_de_pontos_a_inferencia_e_interrompida(registro_final, tmp_path):
    for catalogo in (carregar_catalogo_pontos(None), carregar_catalogo_pontos(tmp_path / "x.csv")):
        assert not catalogo.disponivel
        assert ".csv" not in catalogo.motivo

        with pytest.raises(CatalogoIndisponivel):
            inferir(CONFIGURACAO, registro_final, catalogo)


def test_termopar_fora_do_catalogo_interrompe_a_inferencia(registro_final, catalogo_sintetico):
    incompleto = CatalogoPontos(dict(list(catalogo_sintetico.pontos.items())[1:]))

    with pytest.raises(CatalogoIndisponivel, match="sem registro"):
        inferir(CONFIGURACAO, registro_final, incompleto)


@pytest.mark.parametrize(
    ("temperatura", "limite", "estado"),
    [
        (110.0, 100.0, "acima_do_limite"),
        (100.0, 100.0, "banda_de_incerteza"),
        (95.0, 100.0, "banda_de_incerteza"),
        (90.0, 100.0, "dentro_do_limite"),
        (20.0, 100.0, "dentro_do_limite"),
    ],
)
def test_classificacao_segue_rn01(temperatura, limite, estado):
    assert classificar(temperatura, limite)[0] == estado
    assert classificar(temperatura, limite)[1] == pytest.approx(limite - temperatura)


def test_catalogo_de_pontos_le_um_registro_por_termopar(tmp_path):
    caminho = tmp_path / "catalogo.csv"
    caminho.write_text(
        "TC_Name,Key_Area,measurement_id,limit_c,is_monitor_only\n"
        "Ponto A,Area 1,Ponto A | Area 1,120.0,False\n"
        "Ponto A,Area 9,Ponto A | Area 9,999.0,False\n"
        "Ponto B,Area 2,Ponto B | Area 2,,True\n",
        encoding="utf-8",
    )
    catalogo = carregar_catalogo_pontos(caminho)

    assert catalogo.disponivel
    assert len(catalogo.pontos) == 2
    assert catalogo.ponto("Ponto A").limite_c == 120.0
    assert catalogo.ponto("Ponto A").area == "Area 1"
    assert catalogo.ponto("Ponto B").limite_c is None
    assert catalogo.ponto("Ponto B").so_monitoramento is True
