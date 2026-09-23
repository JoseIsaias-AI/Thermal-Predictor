"""Vocabulário dos fatores de projeto e codificação usada pelos modelos.

Esta é a mesma codificação do notebook de exportação (``notebooks/5_implantacao``):
cada bloco tem uma categoria de referência que, quando escolhida, deixa todas as
colunas do bloco em zero. Reproduzi-la aqui é obrigatório — um vetor montado em
ordem diferente produziria uma temperatura plausível e errada.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

# Categoria de referência de cada bloco: não tem coluna própria na codificação.
REFERENCE_LEVELS: dict[str, str] = {
    "run_case": "Broil Qualitative",
    "blower_direction": "To Front",
    "housing": "Closed",
    "board_position": "Center",
    "deflector_hole": "Closed",
    "material_coil_support": "Aluminium",
}

# Prefixo da coluna codificada correspondente a cada fator.
COLUMN_PREFIXES: dict[str, str] = {
    "run_case": "Run_Case_",
    "blower_direction": "Blower_Direction_",
    "housing": "Housing_",
    "board_position": "Board_Position_",
    "deflector_hole": "Deflector_Hole_",
    "material_coil_support": "Material_Coil_Support_",
}

# Coluna do dataset bruto que guarda o nível legível de cada fator.
DATASET_COLUMNS: dict[str, str] = {
    "run_case": "Run_Case",
    "blower_direction": "Blower_Direction",
    "housing": "Housing",
    "board_position": "Board_Position",
    "deflector_hole": "Deflector_Hole",
    "material_coil_support": "Material_Coil_Support",
}

LEVELS: dict[str, tuple[str, ...]] = {
    "run_case": ("Broil Qualitative", "Broil C1", "Broil C2", "Pyro"),
    "blower_direction": ("To Front", "To Back"),
    "housing": ("Closed", "Open"),
    "board_position": ("Center", "Right"),
    "deflector_hole": ("Closed", "Open"),
    "material_coil_support": ("Aluminium", "Aluminium Plate", "Plastic"),
}

# "Open - Updated" foi tratado como "Open" na construção das tabelas por área.
SYNONYMS: dict[str, str] = {"Open - Updated": "Open"}

LOSSES_PRESENCE = ("declared", "missing", "none")
LOSSES_CONFIG = ("Config S", "Config M")
LOSSES_ORDER = ("Front Order", "Back Order")

PYRO = "Pyro"


class ConfigurationError(ValueError):
    """Configuração incompleta ou fora do vocabulário dos modelos."""


@dataclass(frozen=True)
class Configuration:
    """Configuração validada, pronta para virar vetor e para ser exibida."""

    run_case: str
    blower_direction: str
    housing: str
    board_position: str
    deflector_hole: str
    material_coil_support: str
    losses_present: str
    losses_config: str | None
    losses_order: str | None

    def as_dict(self) -> dict[str, Any]:
        """Formato do formulário, para ecoar na resposta o que foi de fato usado."""

        return {
            "run_case": self.run_case,
            "blower_direction": self.blower_direction,
            "housing": self.housing,
            "board_position": self.board_position,
            "deflector_hole": self.deflector_hole,
            "material_coil_support": self.material_coil_support,
            "losses": {
                "present": self.losses_present,
                "config": self.losses_config,
                "order": self.losses_order,
            },
        }

    def describe(self) -> str:
        """Uma linha legível, usada no contexto entregue ao modelo."""

        perdas = {
            "declared": " · ".join(
                parte for parte in (self.losses_config, self.losses_order) if parte
            )
            or "declaradas",
            "missing": "não declaradas",
            "none": "sem perdas",
        }[self.losses_present]
        return (
            f"{self.run_case} · soprador {self.blower_direction} · "
            f"carenagem {self.housing} · placa {self.board_position} · "
            f"defletor {self.deflector_hole} · suporte {self.material_coil_support} · "
            f"perdas {perdas}"
        )


def parse_configuration(arguments: Mapping[str, Any]) -> Configuration:
    """Valida os argumentos recebidos do modelo e normaliza os níveis.

    Levanta ``ConfigurationError`` dizendo exatamente o que falta ou o que veio
    fora do vocabulário: essa mensagem vira a resposta de dados insuficientes,
    em vez de uma previsão inventada sobre uma configuração inexistente.
    """

    valores: dict[str, str] = {}
    faltando: list[str] = []

    for fator, niveis in LEVELS.items():
        bruto = arguments.get(fator)
        if bruto is None or (isinstance(bruto, str) and not bruto.strip()):
            faltando.append(fator)
            continue
        valores[fator] = _normalize_level(fator, str(bruto).strip(), niveis)

    if arguments.get("losses") is None:
        faltando.append("losses")

    if faltando:
        raise ConfigurationError(
            "Faltam fatores para a previsão: " + ", ".join(sorted(faltando)) + "."
        )

    presente, configuracao, ordem = _parse_losses(arguments.get("losses"))

    if presente == "none" and valores["run_case"] != PYRO:
        # Confundimento declarado pela documentação: "sem perda" e "Pyro" são a
        # mesma coluna na codificação, então a combinação não tem representação.
        raise ConfigurationError(
            "Combinação sem representação na base: 'sem perdas' só ocorre em "
            "rodadas Pyro. Escolha run_case='Pyro' ou outro valor em "
            "losses.present ('declared' ou 'missing')."
        )

    return Configuration(
        **valores,
        losses_present=presente,
        losses_config=configuracao,
        losses_order=ordem,
    )


def encode(configuration: Configuration, columns: list[str]) -> list[float]:
    """Monta o vetor na ordem de colunas declarada pelo modelo treinado."""

    vetor = dict.fromkeys(columns, 0.0)

    for fator, prefixo in COLUMN_PREFIXES.items():
        valor = getattr(configuration, fator)
        if valor == REFERENCE_LEVELS[fator]:
            continue
        coluna = f"{prefixo}{valor}"
        if coluna not in vetor:
            raise ConfigurationError(
                f"O modelo não possui a coluna '{coluna}' para o nível "
                f"'{valor}' de '{fator}'."
            )
        vetor[coluna] = 1.0

    if configuration.losses_present == "missing":
        vetor["losses_present_missing"] = 1.0

    if configuration.losses_present == "declared":
        if configuration.losses_config == "Config M":
            vetor["losses_config_m"] = 1.0
        if configuration.losses_order == "Front Order":
            vetor["losses_order_front_order"] = 1.0
        elif configuration.losses_order == "Back Order":
            vetor["losses_order_back_order"] = 1.0

    return [vetor[coluna] for coluna in columns]


def accepted_levels() -> dict[str, list[str]]:
    """Vocabulário completo, para explicar uma recusa sem o usuário adivinhar."""

    aceitos = {fator: list(niveis) for fator, niveis in LEVELS.items()}
    aceitos["losses.present"] = list(LOSSES_PRESENCE)
    aceitos["losses.config"] = list(LOSSES_CONFIG)
    aceitos["losses.order"] = list(LOSSES_ORDER)
    return aceitos


def _normalize_level(fator: str, valor: str, niveis: tuple[str, ...]) -> str:
    valor = SYNONYMS.get(valor, valor)

    for nivel in niveis:
        if valor.casefold() == nivel.casefold():
            return nivel

    raise ConfigurationError(
        f"Nível fora do vocabulário em '{fator}': '{valor}'. "
        f"Aceitos: {', '.join(niveis)}."
    )


def _parse_losses(bruto: Any) -> tuple[str, str | None, str | None]:
    if bruto is None:
        raise ConfigurationError(
            "Faltam as perdas (losses). Informe losses.present como "
            f"{', '.join(LOSSES_PRESENCE)}."
        )

    if isinstance(bruto, str):
        # Aceita a forma abreviada "losses": "declared" que o modelo às vezes usa.
        bruto = {"present": bruto}

    if not isinstance(bruto, Mapping):
        raise ConfigurationError("O campo 'losses' precisa ser um objeto com 'present'.")

    presente = str(bruto.get("present") or "").strip().casefold()
    if presente not in LOSSES_PRESENCE:
        # O usuário costuma descrever as perdas em uma frase ("declaradas,
        # Config S, Front Order") e o modelo a repassa inteira em 'present'.
        # Recusar isso puniria o usuário por um erro de formatação do modelo.
        interpretado = _interpret_losses_text(bruto)
        if interpretado is None:
            raise ConfigurationError(
                f"Nível fora do vocabulário em 'losses.present': "
                f"'{bruto.get('present')}'. Aceitos: {', '.join(LOSSES_PRESENCE)}."
            )
        return interpretado

    if presente != "declared":
        return presente, None, None

    configuracao = _optional_level("losses.config", bruto.get("config"), LOSSES_CONFIG)
    ordem = _optional_level("losses.order", bruto.get("order"), LOSSES_ORDER)
    return presente, configuracao, ordem


def _interpret_losses_text(bruto: Mapping[str, Any]) -> tuple[str, str | None, str | None] | None:
    """Lê presença, config e ordem de uma descrição livre das perdas.

    Devolve ``None`` quando o texto não contém nenhum termo reconhecível — aí a
    recusa é legítima, porque não há o que interpretar sem adivinhar.
    """

    texto = " ".join(str(valor) for valor in bruto.values() if valor).casefold()

    if any(marca in texto for marca in ("no loss", "sem perda", "none", "nenhuma perda")):
        return "none", None, None

    if any(marca in texto for marca in ("missing", "não declarad", "nao declarad", "ausente")):
        return "missing", None, None

    configuracao = (
        "Config M" if "config m" in texto
        else "Config S" if "config s" in texto
        else None
    )
    ordem = (
        "Front Order" if "front order" in texto
        else "Back Order" if "back order" in texto
        else None
    )

    if configuracao is None and ordem is None and "declar" not in texto:
        return None
    return "declared", configuracao, ordem


def _optional_level(nome: str, valor: Any, aceitos: tuple[str, ...]) -> str | None:
    if valor is None or (isinstance(valor, str) and not valor.strip()):
        return None

    texto = str(valor).strip()
    for aceito in aceitos:
        if texto.casefold() == aceito.casefold():
            return aceito

    raise ConfigurationError(
        f"Nível fora do vocabulário em '{nome}': '{texto}'. "
        f"Aceitos: {', '.join(aceitos)}."
    )
