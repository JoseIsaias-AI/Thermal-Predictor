"""Caminhos e configuração usados pelos testes."""

from pathlib import Path

from api.configuracao import Configuracao

PASTA_API = Path(__file__).resolve().parent.parent
PASTA_DASHBOARD = PASTA_API.parent
RAIZ_REPOSITORIO = PASTA_DASHBOARD.parent
CAMINHO_SCHEMA_JS = PASTA_DASHBOARD / "js" / "schema.js"


def montar_configuracao(familia=None):
    """Configuração apontada para os artefatos versionados no repositório."""
    return Configuracao(
        pasta_modelos=RAIZ_REPOSITORIO / "modelos",
        caminho_catalogo=PASTA_API / "catalogo_modelos.json",
        caminho_esquema=PASTA_API / "dominio" / "esquema_features.json",
        familia_padrao=familia,
    )
