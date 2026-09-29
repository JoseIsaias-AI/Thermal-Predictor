"""Caminhos e configuração usados pelos testes."""

import json
from pathlib import Path

from api.configuracao import Configuracao

PASTA_API = Path(__file__).resolve().parent.parent
PASTA_DASHBOARD = PASTA_API.parent
RAIZ_REPOSITORIO = PASTA_DASHBOARD.parent
CAMINHO_SCHEMA_JS = PASTA_DASHBOARD / "js" / "schema.js"
CAMINHO_CATALOGO = PASTA_API / "catalogo_modelos.json"


def montar_configuracao(familia=None, caminho_catalogo=CAMINHO_CATALOGO, caminho_catalogo_pontos=None):
    """Configuração apontada para os artefatos versionados no repositório."""
    return Configuracao(
        pasta_modelos=RAIZ_REPOSITORIO / "modelos",
        caminho_catalogo=caminho_catalogo,
        caminho_esquema=PASTA_API / "dominio" / "esquema_features.json",
        familia_padrao=familia,
        caminho_catalogo_pontos=caminho_catalogo_pontos,
    )


def gravar_catalogo_sem_familia(pasta):
    """Cópia do catálogo de modelos com `familia_padrao` nula: o serviço antes da escolha."""
    catalogo = json.loads(CAMINHO_CATALOGO.read_text(encoding="utf-8"))
    catalogo["familia_padrao"] = None
    caminho = Path(pasta) / "catalogo_sem_familia.json"
    caminho.write_text(json.dumps(catalogo), encoding="utf-8")
    return caminho
