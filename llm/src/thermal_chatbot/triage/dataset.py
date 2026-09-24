"""Ferramenta ``dataset_query``: consulta as leituras de ensaio já realizadas.

Devolve apenas o que foi medido. Linhas imputadas no pré-processamento ficam
de fora da estatística e são contadas à parte, porque apresentá-las como
medição ensinaria ao usuário um número que nenhum ensaio produziu.
"""

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from thermal_chatbot.schemas import ToolName
from thermal_chatbot.tools import Tool, ToolResult
from thermal_chatbot.triage.catalog import (
    Dataset,
    DatasetUnavailableError,
    Measurement,
)
from thermal_chatbot.triage.factors import LEVELS, SYNONYMS

MAX_POINTS_IN_CONTEXT = 12
MAX_RUNS_IN_CONTEXT = 8


@dataclass(frozen=True)
class PointSummary:
    """Resumo das leituras observadas de um termopar sob o filtro pedido."""

    tc_name: str
    key_area: str
    readings: int
    minimum_c: float
    mean_c: float
    maximum_c: float
    limit_c: float | None
    is_monitor_only: bool
    above_limit: int
    hottest_run: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "tc_name": self.tc_name,
            "key_area": self.key_area,
            "leituras": self.readings,
            "minimo_c": round(self.minimum_c, 2),
            "media_c": round(self.mean_c, 2),
            "maximo_c": round(self.maximum_c, 2),
            "limite_c": self.limit_c,
            "is_monitor_only": self.is_monitor_only,
            "leituras_acima_do_limite": self.above_limit,
            "rodada_mais_quente": self.hottest_run,
        }


class DatasetQueryTool(Tool):
    """Filtra o dataset auditado e resume as leituras correspondentes."""

    name = ToolName.DATASET_QUERY

    def __init__(self, dataset: Dataset) -> None:
        self.dataset = dataset

    async def run(self, arguments: Mapping[str, Any], fallback_query: str) -> ToolResult:
        return await asyncio.to_thread(self._run_sync, arguments)

    async def status(self) -> tuple[bool, str]:
        return await asyncio.to_thread(self.dataset.status)

    def _run_sync(self, arguments: Mapping[str, Any]) -> ToolResult:
        try:
            medicoes = self.dataset.measurements
        except DatasetUnavailableError as exc:
            return ToolResult(found=False, context="", detail=str(exc))
        except (OSError, ValueError) as exc:
            return ToolResult(found=False, context="", detail=f"Dataset ilegível: {exc}")

        filtros = _resolve_filters(_parse_filters(arguments), medicoes)
        selecionadas = [medicao for medicao in medicoes if _matches(medicao, filtros)]

        if not selecionadas:
            return ToolResult(
                found=False,
                context="",
                detail=(
                    "Nenhum registro do dataset corresponde a "
                    f"{_describe_filters(filtros)}."
                ),
            )

        observadas = [medicao for medicao in selecionadas if medicao.observed]
        if not observadas:
            return ToolResult(
                found=False,
                context="",
                detail=(
                    f"{len(selecionadas)} registro(s) correspondem a "
                    f"{_describe_filters(filtros)}, mas nenhum tem leitura "
                    "observada: todos foram imputados no pré-processamento."
                ),
            )

        resumos = _summarize(observadas)
        payload = {
            "filtros": filtros,
            "registros_correspondentes": len(selecionadas),
            "leituras_observadas": len(observadas),
            "leituras_imputadas_ignoradas": len(selecionadas) - len(observadas),
            "rodadas": sorted({medicao.run_id for medicao in observadas}),
            "termopares": [resumo.as_dict() for resumo in resumos],
        }

        return ToolResult(
            found=True,
            context=_format_context(filtros, payload, resumos),
            sources=[f"dataset auditado ({self.dataset.path.name})"],
            detail=(
                f"{len(observadas)} leitura(s) observada(s) em "
                f"{len(resumos)} termopar(es)."
            ),
            data=payload,
        )


def build_dataset_tool(dataset_path: Path) -> DatasetQueryTool:
    return DatasetQueryTool(Dataset(dataset_path))


def _parse_filters(arguments: Mapping[str, Any]) -> dict[str, str]:
    """Aceita os nomes de filtro que o modelo costuma produzir."""

    aliases = {
        "tc_name": ("tc_name", "termopar", "componente", "tc", "ponto"),
        "key_area": ("key_area", "area", "subsistema", "conjunto"),
        "run_id": ("run_id", "rodada", "run"),
    }
    filtros: dict[str, str] = {}

    for destino, chaves in aliases.items():
        for chave in chaves:
            valor = arguments.get(chave)
            if isinstance(valor, str) and valor.strip():
                filtros[destino] = valor.strip()
                break

    for fator, niveis in LEVELS.items():
        valor = arguments.get(fator)
        if not isinstance(valor, str) or not valor.strip():
            continue
        texto = SYNONYMS.get(valor.strip(), valor.strip())
        for nivel in niveis:
            if texto.casefold() == nivel.casefold():
                filtros[fator] = nivel
                break

    return filtros


def _resolve_filters(
    filtros: dict[str, str],
    medicoes: list[Measurement],
) -> dict[str, str]:
    """Corrige a troca entre nome de termopar e nome de área.

    O modelo frequentemente coloca "Soprador P02" em ``key_area``. Como
    nenhuma área tem esse nome, a consulta voltaria vazia e o usuário ouviria
    que não há leitura — quando na verdade há, sob o outro campo.
    """

    areas = {medicao.key_area.casefold() for medicao in medicoes}
    termopares = {medicao.tc_name.casefold() for medicao in medicoes}

    def existe(valor: str, vocabulario: set[str]) -> bool:
        alvo = valor.casefold()
        return any(alvo in item for item in vocabulario)

    area = filtros.get("key_area")
    if area and not existe(area, areas) and existe(area, termopares):
        filtros = {**filtros}
        filtros["tc_name"] = filtros.pop("key_area")

    termopar = filtros.get("tc_name")
    if termopar and not existe(termopar, termopares) and existe(termopar, areas):
        filtros = {**filtros}
        filtros["key_area"] = filtros.pop("tc_name")

    return filtros


def _matches(medicao: Measurement, filtros: Mapping[str, str]) -> bool:
    for fator in LEVELS:
        esperado = filtros.get(fator)
        if esperado is None:
            continue
        atual = SYNONYMS.get(medicao.factors.get(fator, ""), medicao.factors.get(fator, ""))
        if atual != esperado:
            return False

    if "run_id" in filtros and medicao.run_id.casefold() != filtros["run_id"].casefold():
        return False

    if "key_area" in filtros and filtros["key_area"].casefold() not in medicao.key_area.casefold():
        return False

    # Busca por parte do nome: o usuário raramente digita o identificador inteiro.
    if "tc_name" in filtros and filtros["tc_name"].casefold() not in medicao.tc_name.casefold():
        return False

    return True


def _summarize(observadas: list[Measurement]) -> list[PointSummary]:
    """Agrupa por termopar e ordena pelo mais quente, que é o que importa."""

    por_termopar: dict[str, list[Measurement]] = {}
    for medicao in observadas:
        por_termopar.setdefault(medicao.tc_name, []).append(medicao)

    resumos: list[PointSummary] = []
    for tc_name, grupo in por_termopar.items():
        valores = [medicao.value_c for medicao in grupo if medicao.value_c is not None]
        if not valores:
            continue
        limite = grupo[0].limit_c
        mais_quente = max(grupo, key=lambda medicao: medicao.value_c or float("-inf"))
        resumos.append(
            PointSummary(
                tc_name=tc_name,
                key_area=grupo[0].key_area,
                readings=len(valores),
                minimum_c=min(valores),
                mean_c=sum(valores) / len(valores),
                maximum_c=max(valores),
                limit_c=limite,
                is_monitor_only=grupo[0].is_monitor_only,
                above_limit=sum(1 for valor in valores if limite is not None and valor > limite),
                hottest_run=mais_quente.run_id,
            )
        )

    resumos.sort(key=lambda resumo: resumo.maximum_c, reverse=True)
    return resumos


def _format_context(
    filtros: Mapping[str, str],
    payload: Mapping[str, Any],
    resumos: list[PointSummary],
) -> str:
    linhas = [
        f"CONSULTA: {_describe_filters(filtros)}",
        f"LEITURAS OBSERVADAS: {payload['leituras_observadas']}",
    ]

    imputadas = payload["leituras_imputadas_ignoradas"]
    if imputadas:
        linhas.append(
            f"REGISTROS IMPUTADOS IGNORADOS: {imputadas} (não são medições)"
        )

    rodadas = payload["rodadas"]
    amostra = ", ".join(rodadas[:MAX_RUNS_IN_CONTEXT])
    if len(rodadas) > MAX_RUNS_IN_CONTEXT:
        amostra += f" (+{len(rodadas) - MAX_RUNS_IN_CONTEXT})"
    linhas.append(f"RODADAS: {len(rodadas)} — {amostra}")
    linhas.append("")
    linhas.append(
        "TERMOPAR | ÁREA | LEITURAS | MÍN °C | MÉDIA °C | MÁX °C | LIMITE °C | ACIMA DO LIMITE"
    )

    for resumo in resumos[:MAX_POINTS_IN_CONTEXT]:
        limite = "sem limite (monitoramento)" if resumo.limit_c is None else f"{resumo.limit_c:.0f}"
        linhas.append(
            f"{resumo.tc_name} | {resumo.key_area} | {resumo.readings} | "
            f"{resumo.minimum_c:.2f} | {resumo.mean_c:.2f} | {resumo.maximum_c:.2f} | "
            f"{limite} | {resumo.above_limit}"
        )

    if len(resumos) > MAX_POINTS_IN_CONTEXT:
        linhas.append(
            f"[+{len(resumos) - MAX_POINTS_IN_CONTEXT} termopar(es) não listado(s); "
            "refine a consulta para vê-los]"
        )

    return "\n".join(linhas)


def _describe_filters(filtros: Mapping[str, str]) -> str:
    if not filtros:
        return "todo o dataset (nenhum filtro informado)"
    return ", ".join(f"{chave}={valor}" for chave, valor in sorted(filtros.items()))
