"""Configurações distintas das rodadas do dataset auditado, com identificador neutro.

O dataset não é versionado (dado do parceiro), como o catálogo de pontos. Daqui sai só o que a
comparação precisa: os níveis dos sete fatores no vocabulário de /schema e quantas rodadas tem
cada configuração. `Run_ID` e `Run_Reason` ficam de fora (RNF-05): eles nomeiam cada rodada pela
alteração de projeto testada, e lado a lado exporiam essa alteração por diferença.

As configurações são contadas de três formas: nos sete fatores, nas colunas codificadas que
o modelo recebe (lá `Open - Updated` equivale a `Open`) e nos seis fatores categóricos sem as
perdas.
"""

import csv
from dataclasses import dataclass, field
from pathlib import Path

from .catalogo_pontos import MOTIVO_SEM_ARQUIVO


@dataclass(frozen=True)
class ConfiguracaoHistorica:
    identificador: str
    fatores: dict
    rodadas: int


@dataclass(frozen=True)
class CatalogoConfiguracoes:
    configuracoes: tuple = field(default_factory=tuple)
    total_rodadas: int = 0
    motivo: str | None = None

    @property
    def disponivel(self):
        return self.motivo is None


def _perdas(linha):
    if linha["losses_present_declared"] == "1":
        perdas = {"present": "declared"}
    elif linha["losses_present_missing"] == "1":
        return {"present": "missing"}
    else:
        return {"present": "none"}

    if linha["losses_config_m"] == "1":
        perdas["config"] = "Config M"
    elif linha["losses_config_s"] == "1":
        perdas["config"] = "Config S"

    if linha["losses_order_back_order"] == "1":
        perdas["order"] = "Back Order"
    elif linha["losses_order_front_order"] == "1":
        perdas["order"] = "Front Order"

    return perdas


def fatores_da_rodada(linha):
    """Os sete fatores de uma linha do dataset, no vocabulário de /schema."""
    return {
        "blower_direction": linha["Blower_Direction"],
        "housing": linha["Housing"],
        "board_position": linha["Board_Position"],
        "run_case": linha["Run_Case"],
        "deflector_hole": linha["Deflector_Hole"],
        "material_coil_support": linha["Material_Coil_Support"],
        "losses": _perdas(linha),
    }


def _chave(fatores):
    perdas = fatores["losses"]
    return tuple(fatores[c] for c in ("run_case", "blower_direction", "housing", "board_position",
                                      "deflector_hole", "material_coil_support")) + (
        perdas["present"], perdas.get("config") or "", perdas.get("order") or "")


def carregar_catalogo_configuracoes(caminho):
    """Uma entrada por configuração, ordenadas pelos fatores e numeradas CFG-01, CFG-02…"""
    if caminho is None or not Path(caminho).is_file():
        return CatalogoConfiguracoes(motivo=MOTIVO_SEM_ARQUIVO)

    rodadas_por_configuracao = {}
    vistas = set()

    try:
        with open(caminho, encoding="utf-8", newline="") as arquivo:
            for linha in csv.DictReader(arquivo):
                rodada = linha["Run_ID"]
                if rodada in vistas:
                    continue
                vistas.add(rodada)
                fatores = fatores_da_rodada(linha)
                chave = _chave(fatores)
                anterior = rodadas_por_configuracao.get(chave, (fatores, 0))
                rodadas_por_configuracao[chave] = (anterior[0], anterior[1] + 1)
    except (OSError, KeyError, csv.Error) as erro:
        return CatalogoConfiguracoes(motivo=f"Dataset de configurações ilegível: {type(erro).__name__}.")

    configuracoes = tuple(
        ConfiguracaoHistorica(f"CFG-{i:02d}", fatores, rodadas)
        for i, (fatores, rodadas) in enumerate(
            (rodadas_por_configuracao[c] for c in sorted(rodadas_por_configuracao)), start=1)
    )

    return CatalogoConfiguracoes(configuracoes, total_rodadas=len(vistas))
