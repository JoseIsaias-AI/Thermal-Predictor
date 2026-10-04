"""Catálogo dos pontos de medição: área, limite admissível e marcação de monitoramento.

Vem de `dataset_completo_com_flags_de_auditoria.csv`, o mesmo arquivo de onde os notebooks de
exportação tiram o limite de cada termopar. Ele contém dado de ensaio do parceiro e por isso não é
versionado: cada máquina mantém a própria cópia, e a ausência do arquivo vira catálogo indisponível
com o motivo, em vez de derrubar a subida do serviço.
"""

import csv
from dataclasses import dataclass, field
from pathlib import Path

from .protocolo import CatalogoIndisponivel

# O motivo chega ao cliente da API: diz como resolver sem citar arquivo nem caminho do parceiro.
MOTIVO_SEM_ARQUIVO = (
    "Catálogo de pontos não encontrado nesta máquina. Gere o dataset auditado pelo notebook "
    "02_pre_processamento ou aponte a variável THERMAL_API_CATALOGO_PONTOS para ele."
)


@dataclass(frozen=True)
class PontoDeMedicao:
    termopar: str
    area: str
    measurement_id: str
    limite_c: float | None
    so_monitoramento: bool


@dataclass(frozen=True)
class CatalogoPontos:
    pontos: dict[str, PontoDeMedicao] = field(default_factory=dict)
    motivo: str | None = None

    @property
    def disponivel(self):
        return self.motivo is None

    def ponto(self, termopar):
        if not self.disponivel:
            raise CatalogoIndisponivel(self.motivo)

        if termopar not in self.pontos:
            raise CatalogoIndisponivel(f"Termopar sem registro no catálogo de pontos: {termopar!r}.")

        return self.pontos[termopar]


def _numero_ou_nulo(valor):
    valor = (valor or "").strip()
    return float(valor) if valor else None


def carregar_catalogo_pontos(caminho):
    """Um registro por termopar; vale a primeira linha de cada um, como nos notebooks."""
    if caminho is None or not Path(caminho).is_file():
        return CatalogoPontos(motivo=MOTIVO_SEM_ARQUIVO)

    pontos = {}

    try:
        with open(caminho, encoding="utf-8", newline="") as arquivo:
            for linha in csv.DictReader(arquivo):
                termopar = linha["TC_Name"]

                if termopar in pontos:
                    continue

                pontos[termopar] = PontoDeMedicao(
                    termopar=termopar,
                    area=linha["Key_Area"],
                    measurement_id=linha.get("measurement_id") or f"{termopar} | {linha['Key_Area']}",
                    limite_c=_numero_ou_nulo(linha.get("limit_c")),
                    so_monitoramento=(linha.get("is_monitor_only") or "").strip().lower() == "true",
                )
    except (OSError, KeyError, ValueError, csv.Error) as erro:
        return CatalogoPontos(motivo=f"Catálogo de pontos ilegível: {type(erro).__name__}.")

    return CatalogoPontos(pontos)
