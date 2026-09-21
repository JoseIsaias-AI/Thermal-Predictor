import asyncio
import csv
from pathlib import Path

from thermal_chatbot.schemas import ToolName
from thermal_chatbot.triage import build_dataset_tool

COLUNAS = [
    "Run_ID", "Run_Case", "Blower_Direction", "Housing", "Board_Position",
    "Losses", "Deflector_Hole", "Material_Coil_Support", "TC_Name", "Key_Area",
    "measurement_id", "limit_c", "is_monitor_only", "Value", "missing_class",
]


def linha(
    run_id: str,
    tc_name: str,
    value: str,
    *,
    key_area: str = "Main Vent Sys",
    limit_c: str = "150",
    missing_class: str = "observed",
    run_case: str = "Broil C2",
    blower_direction: str = "To Front",
    is_monitor_only: str = "False",
) -> dict[str, str]:
    return {
        "Run_ID": run_id,
        "Run_Case": run_case,
        "Blower_Direction": blower_direction,
        "Housing": "Closed",
        "Board_Position": "Center",
        "Losses": "Config S Losses",
        "Deflector_Hole": "Closed",
        "Material_Coil_Support": "Aluminium",
        "TC_Name": tc_name,
        "Key_Area": key_area,
        "measurement_id": f"{tc_name} | {key_area}",
        "limit_c": limit_c,
        "is_monitor_only": is_monitor_only,
        "Value": value,
        "missing_class": missing_class,
    }


LINHAS = [
    linha("Run 1", "Soprador P02", "120.5"),
    linha("Run 2", "Soprador P02", "160.0"),
    linha("Run 3", "Soprador P02", "130.0", blower_direction="To Back"),
    # Imputada: não é medição e não pode entrar na estatística.
    linha("Run 4", "Soprador P02", "999.0", missing_class="random_read_failure"),
    linha("Run 1", "Duto P01", "55.0", limit_c="", is_monitor_only="True"),
    linha("Run 1", "IPC P11", "88.0", key_area="IPC Comp", limit_c="110", run_case="Pyro"),
]


def escrever_csv(tmp_path: Path) -> Path:
    caminho = tmp_path / "dataset.csv"
    with caminho.open("w", encoding="utf-8", newline="") as arquivo:
        escritor = csv.DictWriter(arquivo, fieldnames=COLUNAS)
        escritor.writeheader()
        escritor.writerows(LINHAS)
    return caminho


def test_resume_leituras_observadas_do_termopar(tmp_path: Path) -> None:
    tool = build_dataset_tool(escrever_csv(tmp_path))

    resultado = asyncio.run(tool.run({"tc_name": "Soprador P02"}, fallback_query=""))

    assert tool.name is ToolName.DATASET_QUERY
    assert resultado.found is True

    termopar = resultado.data["termopares"][0]
    assert termopar["leituras"] == 3
    assert termopar["minimo_c"] == 120.5
    assert termopar["maximo_c"] == 160.0
    assert termopar["media_c"] == round((120.5 + 160.0 + 130.0) / 3, 2)
    assert termopar["leituras_acima_do_limite"] == 1
    assert termopar["rodada_mais_quente"] == "Run 2"


def test_ignora_valor_imputado_e_diz_quantos_foram(tmp_path: Path) -> None:
    """Valor imputado no pré-processamento não é medição de ensaio."""

    tool = build_dataset_tool(escrever_csv(tmp_path))

    resultado = asyncio.run(tool.run({"tc_name": "Soprador P02"}, fallback_query=""))

    assert resultado.data["leituras_observadas"] == 3
    assert resultado.data["leituras_imputadas_ignoradas"] == 1
    assert "999" not in resultado.context
    assert "IMPUTADOS IGNORADOS: 1" in resultado.context


def test_filtra_por_fator_de_projeto(tmp_path: Path) -> None:
    tool = build_dataset_tool(escrever_csv(tmp_path))

    resultado = asyncio.run(
        tool.run({"tc_name": "Soprador P02", "blower_direction": "To Back"}, fallback_query="")
    )

    assert resultado.data["leituras_observadas"] == 1
    assert resultado.data["rodadas"] == ["Run 3"]


def test_filtra_por_area_e_por_caso_de_ensaio(tmp_path: Path) -> None:
    tool = build_dataset_tool(escrever_csv(tmp_path))

    resultado = asyncio.run(tool.run({"key_area": "IPC", "run_case": "Pyro"}, fallback_query=""))

    assert [ponto["tc_name"] for ponto in resultado.data["termopares"]] == ["IPC P11"]


def test_marca_ponto_sem_limite_como_monitoramento(tmp_path: Path) -> None:
    tool = build_dataset_tool(escrever_csv(tmp_path))

    resultado = asyncio.run(tool.run({"tc_name": "Duto P01"}, fallback_query=""))

    termopar = resultado.data["termopares"][0]
    assert termopar["limite_c"] is None
    assert termopar["is_monitor_only"] is True
    assert termopar["leituras_acima_do_limite"] == 0
    assert "monitoramento" in resultado.context


def test_filtro_sem_correspondencia_nao_inventa_resposta(tmp_path: Path) -> None:
    tool = build_dataset_tool(escrever_csv(tmp_path))

    resultado = asyncio.run(tool.run({"tc_name": "Termopar Inexistente"}, fallback_query=""))

    assert resultado.found is False
    assert resultado.data is None
    assert "Nenhum registro" in resultado.detail


def test_dataset_ausente_e_reportado_como_indisponivel(tmp_path: Path) -> None:
    tool = build_dataset_tool(tmp_path / "nao_existe.csv")

    resultado = asyncio.run(tool.run({"tc_name": "IPC P11"}, fallback_query=""))
    pronto, detalhe = asyncio.run(tool.status())

    assert resultado.found is False
    assert pronto is False
    assert "não foi encontrado" in detalhe


def test_status_conta_leituras_rodadas_e_termopares(tmp_path: Path) -> None:
    tool = build_dataset_tool(escrever_csv(tmp_path))

    pronto, detalhe = asyncio.run(tool.status())

    assert pronto is True
    assert "5 leituras observadas de 6 registros" in detalhe
    assert "3 termopares" in detalhe


def test_corrige_termopar_informado_no_campo_de_area(tmp_path: Path) -> None:
    """Modelo pequeno troca os campos; a consulta não pode voltar vazia por isso."""

    tool = build_dataset_tool(escrever_csv(tmp_path))

    resultado = asyncio.run(tool.run({"key_area": "Soprador P02"}, fallback_query=""))

    assert resultado.found is True
    assert [ponto["tc_name"] for ponto in resultado.data["termopares"]] == ["Soprador P02"]


def test_corrige_area_informada_no_campo_de_termopar(tmp_path: Path) -> None:
    tool = build_dataset_tool(escrever_csv(tmp_path))

    resultado = asyncio.run(tool.run({"tc_name": "IPC Comp"}, fallback_query=""))

    assert resultado.found is True
    assert [ponto["tc_name"] for ponto in resultado.data["termopares"]] == ["IPC P11"]
