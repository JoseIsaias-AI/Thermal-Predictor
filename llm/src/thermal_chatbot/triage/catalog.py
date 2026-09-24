"""Leitura do dataset auditado e do catálogo de pontos de medição.

O arquivo é o `dataset_completo_com_flags_de_auditoria.csv` produzido pelos
notebooks. Ele não é versionado (acordo de proteção de dados do repositório),
então tudo aqui tolera a ausência do arquivo e reporta isso como indisponível,
em vez de falhar no meio de uma resposta.
"""

import csv
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

from thermal_chatbot.triage.factors import DATASET_COLUMNS

# Só estas linhas correspondem a uma leitura real de ensaio; o restante foi
# imputado no pré-processamento e não pode ser apresentado como medição.
OBSERVED = "observed"


class DatasetUnavailableError(RuntimeError):
    """O dataset auditado não está acessível nesta execução."""


@dataclass(frozen=True)
class Measurement:
    """Uma leitura de um termopar em uma rodada de ensaio."""

    run_id: str
    tc_name: str
    key_area: str
    measurement_id: str
    value_c: float | None
    limit_c: float | None
    is_monitor_only: bool
    observed: bool
    missing_class: str
    losses: str
    factors: dict[str, str]

    @property
    def margin_c(self) -> float | None:
        if self.value_c is None or self.limit_c is None:
            return None
        return self.limit_c - self.value_c


@dataclass(frozen=True)
class MeasurementPoint:
    """Metadados de um termopar, independentes da rodada."""

    tc_name: str
    key_area: str
    measurement_id: str
    limit_c: float | None
    is_monitor_only: bool


class Dataset:
    """Carrega o CSV uma vez e responde consultas em memória.

    São alguns milhares de linhas: manter tudo em memória evita uma dependência de banco e
    torna cada consulta uma varredura simples e previsível.
    """

    def __init__(self, path: Path) -> None:
        self.path = path

    @cached_property
    def measurements(self) -> list[Measurement]:
        if not self.path.is_file():
            raise DatasetUnavailableError(
                f"O dataset auditado não foi encontrado em '{self.path}'."
            )

        with self.path.open(encoding="utf-8", newline="") as arquivo:
            return [_build_measurement(linha) for linha in csv.DictReader(arquivo)]

    @cached_property
    def points(self) -> dict[str, MeasurementPoint]:
        """Catálogo por termopar, usado para classificar uma previsão."""

        catalogo: dict[str, MeasurementPoint] = {}
        for medicao in self.measurements:
            if medicao.tc_name in catalogo:
                continue
            catalogo[medicao.tc_name] = MeasurementPoint(
                tc_name=medicao.tc_name,
                key_area=medicao.key_area,
                measurement_id=medicao.measurement_id,
                limit_c=medicao.limit_c,
                is_monitor_only=medicao.is_monitor_only,
            )
        return catalogo

    def status(self) -> tuple[bool, str]:
        try:
            medicoes = self.measurements
        except DatasetUnavailableError as exc:
            return False, str(exc)
        except (OSError, ValueError) as exc:
            return False, f"Dataset ilegível: {exc}"

        observadas = sum(1 for medicao in medicoes if medicao.observed)
        rodadas = len({medicao.run_id for medicao in medicoes})
        return True, (
            f"{observadas} leituras observadas de {len(medicoes)} registros, "
            f"{rodadas} rodadas e {len(self.points)} termopares."
        )


def _build_measurement(linha: dict[str, str]) -> Measurement:
    classe = (linha.get("missing_class") or "").strip()
    observado = classe == OBSERVED
    return Measurement(
        run_id=linha["Run_ID"],
        tc_name=linha["TC_Name"],
        key_area=linha["Key_Area"],
        measurement_id=linha["measurement_id"],
        # Fora de "observed" o valor é imputação do pré-processamento: não é
        # medição e não pode ser devolvido como se fosse.
        value_c=_to_float(linha.get("Value")) if observado else None,
        limit_c=_to_float(linha.get("limit_c")),
        is_monitor_only=(linha.get("is_monitor_only") or "").strip().casefold() == "true",
        observed=observado,
        missing_class=classe,
        losses=(linha.get("Losses") or "").strip(),
        factors={
            fator: (linha.get(coluna) or "").strip()
            for fator, coluna in DATASET_COLUMNS.items()
        },
    )


def _to_float(valor: str | None) -> float | None:
    if valor is None or not str(valor).strip():
        return None
    try:
        return float(valor)
    except ValueError:
        return None
