import asyncio
import csv
import json
from pathlib import Path

from thermal_chatbot.schemas import ToolName
from thermal_chatbot.triage import Dataset, ThermalPredictionTool, ThermalPredictor
from thermal_chatbot.triage.prediction import classify

COLUNAS_ENTRADA = [
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
    "codigo_termopar",
]

CONFIGURACAO = {
    "run_case": "Broil C2",
    "blower_direction": "To Back",
    "housing": "Closed",
    "board_position": "Center",
    "deflector_hole": "Closed",
    "material_coil_support": "Aluminium",
    "losses": {"present": "declared", "config": "Config M", "order": "Front Order"},
}


class FakeEstimator:
    """Devolve uma temperatura fixa por termopar e guarda a entrada recebida."""

    def __init__(self, por_codigo: dict[int, float]) -> None:
        self.por_codigo = por_codigo
        self.entradas: list[list[float]] = []

    def predict(self, entrada):
        self.entradas = [list(linha) for linha in entrada]
        return [self.por_codigo[int(linha[-1])] for linha in entrada]


class DirectionalFakeEstimator:
    """Muda a previsão somente quando o nível To Back está codificado."""

    def __init__(self) -> None:
        self.calls = 0

    def predict(self, entrada):
        self.calls += 1
        direction_index = COLUNAS_ENTRADA.index("Blower_Direction_To Back")
        front = {0: 130.0, 1: 80.0, 2: 45.0}
        back = {0: 120.0, 1: 90.0, 2: 45.0}
        return [
            (back if linha[direction_index] == 1.0 else front)[int(linha[-1])]
            for linha in entrada
        ]


def escrever_dataset(tmp_path: Path) -> Path:
    colunas = [
        "Run_ID", "Run_Case", "Blower_Direction", "Housing", "Board_Position",
        "Losses", "Deflector_Hole", "Material_Coil_Support", "TC_Name", "Key_Area",
        "measurement_id", "limit_c", "is_monitor_only", "Value", "missing_class",
    ]
    pontos = [
        ("Soprador P02", "Main Vent Sys", "150", "False"),
        ("Soprador P03", "Main Vent Sys", "100", "False"),
        ("Duto P01", "Main Vent Sys", "", "True"),
    ]
    caminho = tmp_path / "dataset.csv"
    with caminho.open("w", encoding="utf-8", newline="") as arquivo:
        escritor = csv.DictWriter(arquivo, fieldnames=colunas)
        escritor.writeheader()
        for tc_name, key_area, limite, monitoramento in pontos:
            escritor.writerow({
                "Run_ID": "Run 1", "Run_Case": "Broil C2", "Blower_Direction": "To Front",
                "Housing": "Closed", "Board_Position": "Center", "Losses": "Config S Losses",
                "Deflector_Hole": "Closed", "Material_Coil_Support": "Aluminium",
                "TC_Name": tc_name, "Key_Area": key_area,
                "measurement_id": f"{tc_name} | {key_area}", "limit_c": limite,
                "is_monitor_only": monitoramento, "Value": "120.0",
                "missing_class": "observed",
            })
    return caminho


def escrever_modelo(tmp_path: Path, *, validado: bool = True) -> Path:
    modelos = tmp_path / "modelos"
    modelos.mkdir(exist_ok=True)
    (modelos / "main_vent_sys.json").write_text(
        json.dumps({
            "conjunto": "Main Vent Sys",
            "algoritmo": "Gradient Boosting",
            "versao": "gb-1.0",
            "colunas_entrada": COLUNAS_ENTRADA,
            "codigo_por_termopar": {
                "Soprador P02": 0,
                "Soprador P03": 1,
                "Duto P01": 2,
            },
            "metricas_validacao": {"MAE (C)": 4.2} if validado else {"MAE (C)": None},
            "validado": validado,
        }),
        encoding="utf-8",
    )
    (modelos / "main_vent_sys.joblib").write_bytes(b"")
    return modelos


def montar(tmp_path: Path, temperaturas: dict[int, float], *, validado: bool = True):
    estimador = FakeEstimator(temperaturas)
    preditor = ThermalPredictor(
        escrever_modelo(tmp_path, validado=validado),
        Dataset(escrever_dataset(tmp_path)),
        loader=lambda _: estimador,
    )
    return ThermalPredictionTool(preditor), estimador


def test_entrega_a_configuracao_codificada_ao_modelo(tmp_path: Path) -> None:
    tool, estimador = montar(tmp_path, {0: 120.0, 1: 80.0, 2: 45.0})

    asyncio.run(tool.run(CONFIGURACAO, fallback_query=""))

    esperado = dict.fromkeys(COLUNAS_ENTRADA[:-1], 0.0)
    esperado["Run_Case_Broil C2"] = 1.0
    esperado["Blower_Direction_To Back"] = 1.0
    esperado["losses_config_m"] = 1.0
    esperado["losses_order_front_order"] = 1.0

    # Uma linha por termopar: as 13 colunas mais o código do ponto no fim.
    assert len(estimador.entradas) == 3
    for linha, codigo in zip(estimador.entradas, (0, 1, 2), strict=True):
        assert linha[:-1] == list(esperado.values())
        assert linha[-1] == float(codigo)


def test_devolve_a_temperatura_que_o_modelo_calculou(tmp_path: Path) -> None:
    tool, _ = montar(tmp_path, {0: 143.75, 1: 80.0, 2: 45.0})

    resultado = asyncio.run(tool.run(CONFIGURACAO, fallback_query=""))

    assert tool.name is ToolName.THERMAL_PREDICTION
    assert resultado.found is True

    por_termopar = {
        ponto["tc_name"]: ponto
        for ponto in resultado.data["pontos"] + resultado.data["monitoramento"]
    }
    assert por_termopar["Soprador P02"]["temperatura_prevista_c"] == 143.75
    assert "143.75" in resultado.context


def test_compara_dois_niveis_mantendo_os_demais_fatores_fixos(tmp_path: Path) -> None:
    estimador = DirectionalFakeEstimator()
    preditor = ThermalPredictor(
        escrever_modelo(tmp_path),
        Dataset(escrever_dataset(tmp_path)),
        loader=lambda _: estimador,
    )
    tool = ThermalPredictionTool(preditor)
    argumentos = {
        **{key: value for key, value in CONFIGURACAO.items() if key != "blower_direction"},
        "mode": "compare",
        "comparison": {
            "factor": "blower_direction",
            "levels": ["To Front", "To Back"],
        },
    }

    resultado = asyncio.run(tool.run(argumentos, fallback_query=""))

    assert resultado.found is True
    assert estimador.calls == 2
    assert resultado.data["modo"] == "comparacao_controlada"
    assert resultado.data["interpretacao_delta"] == "delta = To Front - To Back"
    assert resultado.data["nivel_a_mais_quente"] == 1
    assert resultado.data["nivel_a_mais_frio"] == 1
    assert resultado.data["sem_mudanca_relevante"] == 0
    assert resultado.data["areas"] == [
        {
            "key_area": "Main Vent Sys",
            "pontos_validados": 2,
            "delta_medio_a_menos_b_c": 0.0,
        }
    ]
    assert "mesma configuração" in resultado.context
    assert "To Front - To Back" in resultado.context
    assert "comparação preditiva, não medição" in resultado.sources[0]
    assert "**To Front − To Back**" in resultado.direct_answer
    assert "validação de engenharia" in resultado.direct_answer


def test_comparacao_incompleta_pede_configuracao_sem_executar_modelo(
    tmp_path: Path,
) -> None:
    estimador = DirectionalFakeEstimator()
    preditor = ThermalPredictor(
        escrever_modelo(tmp_path),
        Dataset(escrever_dataset(tmp_path)),
        loader=lambda _: estimador,
    )
    tool = ThermalPredictionTool(preditor)

    resultado = asyncio.run(
        tool.run(
            {
                "mode": "compare",
                "comparison": {"factor": "blower_direction"},
                "run_case": "Broil C2",
            },
            fallback_query="",
        )
    )

    assert resultado.found is False
    assert "Faltam fatores" in resultado.detail
    assert "housing" in resultado.detail
    assert estimador.calls == 0


def test_comparacao_aceita_nome_humano_do_fator(tmp_path: Path) -> None:
    estimador = DirectionalFakeEstimator()
    preditor = ThermalPredictor(
        escrever_modelo(tmp_path),
        Dataset(escrever_dataset(tmp_path)),
        loader=lambda _: estimador,
    )
    tool = ThermalPredictionTool(preditor)
    argumentos = {
        **{key: value for key, value in CONFIGURACAO.items() if key != "blower_direction"},
        "mode": "compare",
        "comparison": {
            "factor": "Blower Direction",
            "values": ["To Front", "To Back"],
        },
    }

    resultado = asyncio.run(tool.run(argumentos, fallback_query=""))

    assert resultado.found is True
    assert resultado.data["fator_comparado"] == "blower_direction"
    assert estimador.calls == 2


def test_comparacao_descarta_perdas_inventadas_pelo_roteador(tmp_path: Path) -> None:
    tool, estimador = montar(tmp_path, {0: 100.0, 1: 50.0, 2: 45.0})
    argumentos = {
        "mode": "compare",
        "comparison": {"factor": "Blower Direction"},
        # Simula um valor que o LLM acrescentou sem aparecer na pergunta.
        "losses": {"present": "declared", "config": "Config M"},
    }

    resultado = asyncio.run(
        tool.run(
            argumentos,
            fallback_query="Blower To Front aumenta ou diminui a temperatura?",
        )
    )

    assert resultado.found is False
    assert "losses" in resultado.detail
    assert estimador.entradas == []


def test_classifica_por_margem_conforme_rn01(tmp_path: Path) -> None:
    # Limites do catálogo: 150 (housing) e 100 (windings).
    tool, _ = montar(tmp_path, {0: 160.0, 1: 95.0, 2: 45.0})

    resultado = asyncio.run(tool.run(CONFIGURACAO, fallback_query=""))
    por_termopar = {ponto["tc_name"]: ponto for ponto in resultado.data["pontos"]}

    acima = por_termopar["Soprador P02"]
    assert acima["estado"] == "acima_do_limite"
    assert acima["margem_c"] == -10.0

    banda = por_termopar["Soprador P03"]
    assert banda["estado"] == "banda_de_incerteza"
    assert banda["margem_c"] == 5.0

    # Menor margem primeiro: é o ponto que decide a triagem.
    assert resultado.data["pontos"][0]["tc_name"] == "Soprador P02"


def test_ponto_sem_limite_vai_para_monitoramento(tmp_path: Path) -> None:
    tool, _ = montar(tmp_path, {0: 100.0, 1: 50.0, 2: 45.0})

    resultado = asyncio.run(tool.run(CONFIGURACAO, fallback_query=""))

    monitoramento = resultado.data["monitoramento"]
    assert [ponto["tc_name"] for ponto in monitoramento] == ["Duto P01"]
    assert monitoramento[0]["estado"] == "monitoramento"
    assert monitoramento[0]["margem_c"] is None
    assert resultado.data["total_classificados"] == 2


def test_classificacao_rn01_nos_limites_da_faixa() -> None:
    """A margem de exatamente 10% ainda conta como dentro do limite."""

    assert classify(90.0, 100.0) == ("dentro_do_limite", 10.0)
    assert classify(90.1, 100.0)[0] == "banda_de_incerteza"
    assert classify(100.0, 100.0)[0] == "banda_de_incerteza"
    assert classify(100.1, 100.0)[0] == "acima_do_limite"


def test_modelo_sem_validacao_cruzada_e_declarado(tmp_path: Path) -> None:
    tool, _ = montar(tmp_path, {0: 100.0, 1: 50.0, 2: 45.0}, validado=False)

    resultado = asyncio.run(tool.run(CONFIGURACAO, fallback_query=""))

    assert resultado.data["conjuntos_sem_validacao"] == ["Main Vent Sys"]
    assert resultado.data["pontos"][0]["mae_validacao_c"] is None
    assert "sem validação cruzada" in resultado.context


def test_configuracao_incompleta_nao_vira_previsao(tmp_path: Path) -> None:
    tool, estimador = montar(tmp_path, {0: 100.0, 1: 50.0, 2: 45.0})

    resultado = asyncio.run(tool.run({"run_case": "Pyro"}, fallback_query=""))

    assert resultado.found is False
    assert "Faltam fatores" in resultado.detail
    assert "blower_direction" in resultado.detail
    # O modelo nem chegou a ser executado.
    assert estimador.entradas == []


def test_nivel_invalido_lista_os_aceitos(tmp_path: Path) -> None:
    tool, _ = montar(tmp_path, {0: 100.0, 1: 50.0, 2: 45.0})

    resultado = asyncio.run(
        tool.run({**CONFIGURACAO, "housing": "Semiaberto"}, fallback_query="")
    )

    assert resultado.found is False
    assert "housing" in resultado.detail
    assert resultado.data["niveis_aceitos"]["housing"] == ["Closed", "Open"]


def test_modelos_ausentes_sao_reportados_como_indisponiveis(tmp_path: Path) -> None:
    preditor = ThermalPredictor(
        tmp_path / "sem_modelos",
        Dataset(escrever_dataset(tmp_path)),
        loader=lambda _: None,
    )
    tool = ThermalPredictionTool(preditor)

    resultado = asyncio.run(tool.run(CONFIGURACAO, fallback_query=""))
    pronto, detalhe = asyncio.run(tool.status())

    assert resultado.found is False
    assert pronto is False
    assert "não encontrado" in detalhe


def test_status_relata_modelos_e_termopares(tmp_path: Path) -> None:
    tool, _ = montar(tmp_path, {0: 100.0, 1: 50.0, 2: 45.0})

    pronto, detalhe = asyncio.run(tool.status())

    assert pronto is True
    assert "1 modelos (gb-1.0) cobrindo 3 termopares" in detalhe


def test_carrega_o_modelo_final_com_algoritmo_por_conjunto(tmp_path: Path) -> None:
    modelos = escrever_modelo(tmp_path)
    # O modelo final grava `null` nas métricas do conjunto sem modelo validado.
    (modelos / "ac_blower_inlet.json").write_text(
        json.dumps({
            "conjunto": "AC Blower Inlet",
            "algoritmo": "Média RF e GB adotada",
            "versao": "gb-1.0",
            "colunas_entrada": COLUNAS_ENTRADA,
            "codigo_por_termopar": {},
            "metricas_validacao": None,
            "validado": False,
        }),
        encoding="utf-8",
    )
    (modelos / "ac_blower_inlet.joblib").write_bytes(b"")
    preditor = ThermalPredictor(
        modelos,
        Dataset(escrever_dataset(tmp_path)),
        loader=lambda _: FakeEstimator({0: 120.0, 1: 80.0, 2: 45.0}),
    )

    resultado = asyncio.run(ThermalPredictionTool(preditor).run(CONFIGURACAO, fallback_query=""))

    assert resultado.found is True
    assert resultado.data["conjuntos_sem_validacao"] == ["AC Blower Inlet"]
    assert resultado.data["algoritmo"] == (
        "AC Blower Inlet: Média RF e GB adotada; Main Vent Sys: Gradient Boosting"
    )
