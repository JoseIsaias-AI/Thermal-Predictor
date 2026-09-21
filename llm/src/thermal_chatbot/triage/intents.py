"""Reconhecimento conservador de comparações com vocabulário controlado.

Este módulo não tenta compreender linguagem livre em geral. Ele só cria uma
chamada rápida quando encontra intenção comparativa, um fator conhecido e dois
níveis válidos. Qualquer ambiguidade devolve ``None`` e mantém o roteamento pelo
LLM como fallback.
"""

import re
import unicodedata
from collections.abc import Mapping
from typing import Any

from thermal_chatbot.triage.factors import LEVELS

COMPARISON_MARKERS = (
    "compare",
    "comparar",
    "comparacao",
    "versus",
    " vs ",
    "mudar",
    "trocar",
    "aumenta",
    "diminui",
    "mais quente",
    "mais frio",
)

FACTOR_ALIASES: dict[str, tuple[str, ...]] = {
    "run_case": ("run case", "caso de ensaio"),
    "blower_direction": (
        "blower direction",
        "direcao do blower",
        "direcao do soprador",
    ),
    "housing": ("housing", "carenagem"),
    "board_position": ("board position", "posicao da placa"),
    "deflector_hole": ("deflector hole", "furo do defletor"),
    "material_coil_support": (
        "material coil support",
        "material do coil support",
        "material do suporte",
    ),
}

LEVEL_ALIASES: dict[str, dict[str, tuple[str, ...]]] = {
    "run_case": {
        "Broil Qualitative": ("broil qualitative",),
        "Broil C1": ("broil c1",),
        "Broil C2": ("broil c2",),
        "Pyro": ("pyro",),
    },
    "blower_direction": {
        "To Front": ("to front", "blower to front", "para frente"),
        "To Back": ("to back", "blower to back", "para tras"),
    },
    "housing": {
        "Closed": ("closed", "fechado", "fechada"),
        "Open": ("open", "aberto", "aberta"),
    },
    "board_position": {
        "Center": ("center", "central", "centro"),
        "Right": ("right", "direita"),
    },
    "deflector_hole": {
        "Closed": ("closed", "fechado", "fechada"),
        "Open": ("open", "aberto", "aberta"),
    },
    "material_coil_support": {
        "Aluminium": ("aluminium", "aluminum", "aluminio"),
        "Aluminium Plate": ("aluminium plate", "placa de aluminio"),
        "Plastic": ("plastic", "plastico"),
    },
}


def fast_comparison_arguments(
    message: str,
    configuration: Mapping[str, Any] | None = None,
    comparison: Mapping[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Cria argumentos da ferramenta sem LLM quando a intenção é inequívoca."""

    if comparison is not None:
        return {
            **dict(configuration or {}),
            "mode": "compare",
            "comparison": dict(comparison),
        }

    text = _normalize(message)
    if not any(marker in f" {text} " for marker in COMPARISON_MARKERS):
        return None

    candidates: list[tuple[str, list[str]]] = []
    for factor in LEVELS:
        if not _mentions_factor(text, factor):
            continue
        mentioned = _mentioned_levels(text, factor)
        if len(mentioned) == 2:
            candidates.append((factor, mentioned))

    if len(candidates) != 1:
        return None

    compared_factor, levels = candidates[0]
    arguments: dict[str, Any] = {
        "mode": "compare",
        "comparison": {"factor": compared_factor, "levels": levels},
    }
    for factor in LEVELS:
        if factor == compared_factor:
            continue
        value = _extract_labeled_level(text, factor)
        if value is not None:
            arguments[factor] = value

    losses = _extract_losses(text)
    if losses is not None:
        arguments["losses"] = losses
    return arguments


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    without_accents = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_accents).strip()


def _mentions_factor(text: str, factor: str) -> bool:
    return any(_contains(text, alias) for alias in FACTOR_ALIASES[factor])


def _mentioned_levels(text: str, factor: str) -> list[str]:
    found: list[tuple[int, str]] = []
    for level, aliases in LEVEL_ALIASES[factor].items():
        positions = [position for alias in aliases if (position := _position(text, alias)) >= 0]
        if positions:
            found.append((min(positions), level))
    ordered = [level for _, level in sorted(found)]
    if len(ordered) != 2:
        return ordered

    # "mudar de A para B" pergunta pelo efeito da mudança; o delta útil é
    # destino menos origem, portanto B - A.
    source, target = ordered
    for source_alias in LEVEL_ALIASES[factor][source]:
        for target_alias in LEVEL_ALIASES[factor][target]:
            pattern = (
                rf"(?<!\w)de\s+{re.escape(source_alias)}\s+para\s+"
                rf"{re.escape(target_alias)}(?!\w)"
            )
            if re.search(pattern, text):
                return [target, source]
    return ordered


def _extract_labeled_level(text: str, factor: str) -> str | None:
    for factor_alias in FACTOR_ALIASES[factor]:
        start = _position(text, factor_alias)
        if start < 0:
            continue
        # O valor deve estar junto do nome do fator. Isso impede que "Closed"
        # do Housing também seja atribuído ao Deflector Hole.
        remainder = text[start + len(factor_alias) :]
        boundaries = [
            position
            for separator in (",", ";", ".", " e ")
            if (position := remainder.find(separator)) >= 0
        ]
        for other_factor, aliases in FACTOR_ALIASES.items():
            if other_factor == factor:
                continue
            boundaries.extend(
                position
                for alias in aliases
                if (position := _position(remainder, alias)) >= 0
            )
        segment = remainder[: min(boundaries)] if boundaries else remainder[:45]
        found: list[tuple[int, str]] = []
        for level, aliases in LEVEL_ALIASES[factor].items():
            positions = [position for alias in aliases if (position := _position(segment, alias)) >= 0]
            if positions:
                found.append((min(positions), level))
        if found:
            return min(found)[1]
    return None


def _extract_losses(text: str) -> dict[str, str | None] | None:
    if "perda" not in text and "loss" not in text:
        return None

    if any(term in text for term in ("sem perda", "no loss", "losses none")):
        return {"present": "none", "config": None, "order": None}
    if any(term in text for term in ("nao declarad", "missing loss", "perda ausente")):
        return {"present": "missing", "config": None, "order": None}

    config = "Config M" if "config m" in text else "Config S" if "config s" in text else None
    order = (
        "Front Order"
        if "front order" in text
        else "Back Order"
        if "back order" in text
        else None
    )
    return {"present": "declared", "config": config, "order": order}


def _position(text: str, value: str) -> int:
    match = re.search(rf"(?<!\w){re.escape(value)}(?!\w)", text)
    return match.start() if match else -1


def _contains(text: str, value: str) -> bool:
    return _position(text, value) >= 0
