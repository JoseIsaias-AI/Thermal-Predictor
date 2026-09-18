"""Contrato que qualquer modelo precisa cumprir para ser servido pela API.

Um subsistema por preditor: cada conjunto tem base, faixa de temperatura e termopares
próprios, então a escolha do algoritmo pode ser diferente em cada um.
"""

from dataclasses import dataclass, field
from typing import Mapping, Protocol, Sequence, runtime_checkable

# Chaves das métricas como o notebook de exportação as grava.
CHAVES_METRICAS = {
    "mae_c": "MAE (C)",
    "rmse_c": "RMSE (C)",
    "r2": "R2",
    "acerto_5c_pct": "Acerto +-5 C (%)",
    "acerto_10c_pct": "Acerto +-10 C (%)",
    "mae_sobre_amplitude_pct": "MAE / amplitude (%)",
}


class ErroDePredicao(Exception):
    """Falha da camada de predição."""


class ModeloIndisponivel(ErroDePredicao):
    """Nenhum artefato utilizável para o subsistema pedido."""


class ConfiguracaoInvalida(ErroDePredicao):
    """Entrada fora do vocabulário declarado em /schema (RN-04)."""


@dataclass(frozen=True)
class Metricas:
    """Desempenho de validação já documentado do modelo."""

    mae_c: float | None = None
    rmse_c: float | None = None
    r2: float | None = None
    acerto_5c_pct: float | None = None
    acerto_10c_pct: float | None = None
    mae_sobre_amplitude_pct: float | None = None

    @classmethod
    def de_metadados(cls, bruto):
        if not bruto:
            return None

        def numero(chave):
            valor = bruto.get(CHAVES_METRICAS[chave])
            return None if valor is None else float(valor)

        return cls(**{chave: numero(chave) for chave in CHAVES_METRICAS})


@dataclass(frozen=True)
class MetadadosModelo:
    """O que a API pode publicar de um modelo, sem nada que reconstrua o artefato."""

    subsistema: str
    identificador: str
    familia: str | None = None
    algoritmo: str | None = None
    versao: str | None = None
    commit_treino: str | None = None
    validado: bool | None = None
    observacao: str | None = None
    termopares: tuple[str, ...] = field(default_factory=tuple)
    metricas: Metricas | None = None

    @property
    def termopares_cobertos(self):
        return len(self.termopares)


@runtime_checkable
class Preditor(Protocol):
    """Modelo de um subsistema, pronto para prever ou declarando por que não está."""

    @property
    def metadados(self) -> MetadadosModelo: ...

    @property
    def estado(self) -> str:
        """`carregado` ou `indisponivel`."""

    @property
    def motivo(self) -> str | None:
        """Por que está indisponível, quando for o caso."""

    def prever(
        self,
        configuracao: Mapping,
        termopares: Sequence[str] | None = None,
    ) -> dict[str, float]:
        """Temperatura prevista em °C por termopar do subsistema."""
