"""Os três endpoints respondem 200 com o formato de payload esperado."""

import pytest

CAMPOS_PROIBIDOS = {
    "hiperparametros",
    "codigo_por_termopar",
    "arquivo_origem",
    "artefato",
    "caminho",
    "colunas_entrada",
}


def test_saude_responde_200_com_resumo_dos_modelos(cliente):
    resposta = cliente.get("/saude")
    corpo = resposta.json()

    assert resposta.status_code == 200
    assert corpo["status"] in ("ok", "degradado", "sem_modelo")
    assert corpo["versao_api"]
    assert corpo["esquema_features"]["fatores"] == 7
    assert corpo["modelos"]["esperados"] == len(corpo["subsistemas"])
    assert all({"subsistema", "estado"} <= set(s) for s in corpo["subsistemas"])


def test_saude_sem_familia_declara_o_motivo(cliente):
    corpo = cliente.get("/saude").json()

    assert corpo["status"] == "sem_modelo"
    assert corpo["modelos"]["familia_ativa"] is None
    assert all(s["estado"] == "indisponivel" and s["motivo"] for s in corpo["subsistemas"])


def test_saude_com_familia_plugada_carrega_todos_os_subsistemas(cliente_com_modelo):
    corpo = cliente_com_modelo.get("/saude").json()

    assert corpo["status"] == "ok"
    assert corpo["modelos"]["familia_ativa"] == "random_forest"
    assert corpo["modelos"]["carregados"] == corpo["modelos"]["esperados"] > 0
    assert all(s["estado"] == "carregado" for s in corpo["subsistemas"])


def test_schema_responde_200_com_os_sete_fatores(cliente):
    resposta = cliente.get("/schema")
    corpo = resposta.json()

    assert resposta.status_code == 200
    assert len(corpo["fatores"]) == 7
    assert {f["chave"] for f in corpo["fatores"]} == {
        "blower_direction",
        "housing",
        "board_position",
        "run_case",
        "losses",
        "deflector_hole",
        "material_coil_support",
    }
    assert corpo["exemplo_de_entrada"]["run_case"] == "Broil C2"
    assert corpo["sinonimos"]["Open - Updated"] == "Open"


def test_schema_descreve_niveis_e_subcampos(cliente):
    fatores = {f["chave"]: f for f in cliente.get("/schema").json()["fatores"]}
    perdas = fatores["losses"]

    assert fatores["run_case"]["tipo"] == "categorico"
    assert all({"valor", "rotulo"} <= set(n) for n in fatores["run_case"]["niveis"])
    assert fatores["blower_direction"]["nivel_de_referencia"] == "To Front"
    assert perdas["tipo"] == "composto"
    assert {s["chave"] for s in perdas["subcampos"]} == {"present", "config", "order"}
    assert perdas["subcampos"][2]["depende_de"] == {"campo": "present", "valor": "declared"}


@pytest.mark.parametrize("nome_cliente", ["cliente", "cliente_com_modelo"])
def test_modelos_responde_200_um_registro_por_subsistema(nome_cliente, request):
    resposta = request.getfixturevalue(nome_cliente).get("/modelos")
    corpo = resposta.json()

    assert resposta.status_code == 200
    assert corpo["total_subsistemas"] == len(corpo["modelos"]) == 7
    assert "random_forest" in corpo["familias_disponiveis"]
    assert "sklearn_joblib" in corpo["tipos_de_preditor_suportados"]
    assert all({"subsistema", "estado", "candidatos"} <= set(m) for m in corpo["modelos"])


def test_modelos_publica_metricas_documentadas(cliente_com_modelo):
    modelos = cliente_com_modelo.get("/modelos").json()["modelos"]
    coil = next(m for m in modelos if m["subsistema"] == "Coil Temps")

    assert coil["familia"] == "random_forest"
    assert coil["algoritmo"] == "Random Forest"
    assert coil["versao"]
    assert coil["termopares_cobertos"] == 8
    assert coil["metricas"]["mae_c"] > 0
    assert 0 <= coil["metricas"]["r2"] <= 1


def test_modelos_nao_expoe_o_artefato_nem_detalhe_de_treino(cliente_com_modelo):
    corpo = cliente_com_modelo.get("/modelos").json()

    def sem_campos_proibidos(registro):
        assert not CAMPOS_PROIBIDOS & set(registro)

    for modelo in corpo["modelos"]:
        sem_campos_proibidos(modelo)
        for candidato in modelo["candidatos"]:
            sem_campos_proibidos(candidato)

    bruto = cliente_com_modelo.get("/modelos").text

    assert ".joblib" not in bruto
    assert ".csv" not in bruto
