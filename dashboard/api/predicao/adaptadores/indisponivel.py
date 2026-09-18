"""Preditor que ocupa o lugar de um modelo ausente ou que falhou ao carregar.

Mantém o subsistema visível em /saude e /modelos com o motivo, em vez de sumir do catálogo.
"""

from ..protocolo import ModeloIndisponivel


class PreditorIndisponivel:
    def __init__(self, metadados, motivo):
        self._metadados = metadados
        self._motivo = motivo

    @property
    def metadados(self):
        return self._metadados

    @property
    def estado(self):
        return "indisponivel"

    @property
    def motivo(self):
        return self._motivo

    def prever(self, configuracao, termopares=None):
        raise ModeloIndisponivel(
            f"Sem modelo para o subsistema {self._metadados.subsistema!r}: {self._motivo}"
        )
