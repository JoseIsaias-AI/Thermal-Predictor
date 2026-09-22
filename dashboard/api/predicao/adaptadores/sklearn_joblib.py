"""Preditor de um estimador scikit-learn serializado com joblib.

Cobre os artefatos de `modelos/<familia>/<subsistema>.joblib` exportados pelos notebooks da
fase de implantação.
"""

from ..codificacao import montar_vetor_configuracao, separar_colunas
from ..protocolo import ConfiguracaoInvalida
from .indisponivel import PreditorIndisponivel


class PreditorSklearnJoblib:
    def __init__(self, metadados, estimador, colunas_configuracao, codigo_por_termopar):
        self._metadados = metadados
        self._estimador = estimador
        self._colunas = colunas_configuracao
        self._codigos = codigo_por_termopar

    @property
    def metadados(self):
        return self._metadados

    @property
    def estado(self):
        return "carregado"

    @property
    def motivo(self):
        return None

    def prever(self, configuracao, termopares=None):
        import numpy as np

        alvos = list(termopares) if termopares else list(self._codigos)
        desconhecidos = [t for t in alvos if t not in self._codigos]

        if desconhecidos:
            raise ConfiguracaoInvalida(
                f"Termopar fora do subsistema {self._metadados.subsistema!r}: {desconhecidos}."
            )

        base = montar_vetor_configuracao(configuracao, self._colunas)
        entrada = np.array([base + [float(self._codigos[termopar])] for termopar in alvos])

        return dict(zip(alvos, (float(v) for v in self._estimador.predict(entrada))))


def criar_preditor_sklearn_joblib(metadados, caminho_artefato, metadados_brutos):
    """Carrega o artefato na subida do serviço; a falha vira preditor indisponível."""
    if caminho_artefato is None or not caminho_artefato.is_file():
        return PreditorIndisponivel(metadados, f"Artefato não encontrado: {caminho_artefato}.")

    try:
        import joblib

        colunas = separar_colunas(metadados_brutos.get("colunas_entrada") or [])
        codigos = {
            termopar: int(codigo)
            for termopar, codigo in (metadados_brutos.get("codigo_por_termopar") or {}).items()
        }

        if not codigos:
            raise ValueError("Metadados sem 'codigo_por_termopar'.")

        estimador = joblib.load(caminho_artefato)
    except Exception as erro:
        return PreditorIndisponivel(metadados, f"Falha ao carregar o artefato: {erro}")

    if not hasattr(estimador, "predict"):
        return PreditorIndisponivel(metadados, "Artefato carregado não expõe 'predict'.")

    return PreditorSklearnJoblib(metadados, estimador, colunas, codigos)
