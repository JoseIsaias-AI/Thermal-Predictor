"""Fábricas de preditor por tipo de artefato.

Ponto de extensão do serviço: um modelo de outra natureza (rede neural salva em outro
formato, serviço remoto) entra registrando uma fábrica nova, sem tocar nas rotas.
"""

from .indisponivel import PreditorIndisponivel
from .sklearn_joblib import criar_preditor_sklearn_joblib

FABRICAS = {
    "sklearn_joblib": criar_preditor_sklearn_joblib,
}


def registrar_fabrica(tipo, fabrica):
    """Associa um `tipo_preditor` do catálogo à função que constrói o preditor."""
    FABRICAS[tipo] = fabrica


def tipos_suportados():
    return sorted(FABRICAS)


def criar_preditor(tipo, metadados, caminho_artefato, metadados_brutos):
    """Constrói o preditor do tipo pedido, ou devolve um indisponível com o motivo."""
    fabrica = FABRICAS.get(tipo)

    if fabrica is None:
        return PreditorIndisponivel(
            metadados,
            f"Tipo de preditor não suportado: {tipo!r}. Suportados: {tipos_suportados()}.",
        )

    return fabrica(metadados, caminho_artefato, metadados_brutos)


__all__ = [
    "FABRICAS",
    "PreditorIndisponivel",
    "criar_preditor",
    "registrar_fabrica",
    "tipos_suportados",
]
