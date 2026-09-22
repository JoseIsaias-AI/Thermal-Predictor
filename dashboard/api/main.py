"""Aplicação FastAPI do Thermal Predictor.

Sobe com `uvicorn api.main:app --reload` a partir de `dashboard/`. A documentação Swagger
fica em /docs e o OpenAPI em /openapi.json.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import VERSAO_API
from .configuracao import carregar_configuracao
from .dominio.esquema import carregar_esquema
from .predicao.registro import construir_registro
from .rotas import esquema, modelos, saude

DESCRICAO = """
Serviço de leitura do Thermal Predictor. Publica o contrato de entrada da camada de
predição e os metadados dos modelos por subsistema.

Cada subsistema tem base e faixa de temperatura próprias e recebe seu próprio modelo. A
família ativa é definida em `api/catalogo_modelos.json` ou na variável de ambiente
`THERMAL_API_FAMILIA_MODELO`; enquanto nenhuma for escolhida, o serviço responde com os
subsistemas em `sem_modelo`.
"""


def montar_estado(app, configuracao=None):
    """Carrega o dicionário de features e os modelos uma vez, na subida."""
    configuracao = configuracao or carregar_configuracao()
    app.state.configuracao = configuracao
    app.state.esquema = carregar_esquema(str(configuracao.caminho_esquema))
    app.state.registro = construir_registro(configuracao)


def criar_app(configuracao=None):
    """Fábrica da aplicação; recebe a configuração pronta nos testes."""

    @asynccontextmanager
    async def ciclo_de_vida(app):
        montar_estado(app, configuracao)
        yield

    app = FastAPI(
        title="Thermal Predictor API",
        version=VERSAO_API,
        summary="Contrato de entrada e catálogo de modelos do Thermal Predictor.",
        description=DESCRICAO,
        lifespan=ciclo_de_vida,
        openapi_tags=[
            {"name": "operação", "description": "Saúde do serviço."},
            {"name": "contrato", "description": "Dicionário de features aceito na predição."},
            {"name": "modelos", "description": "Metadados dos modelos por subsistema."},
        ],
    )

    app.include_router(saude.roteador)
    app.include_router(esquema.roteador)
    app.include_router(modelos.roteador)

    return app


app = criar_app()
