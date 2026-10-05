"""Aplicação FastAPI do Thermal Predictor.

Sobe com `uvicorn api.main:app --reload` a partir de `dashboard/`. A documentação Swagger
fica em /docs e o OpenAPI em /openapi.json.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from . import VERSAO_API
from .configuracao import carregar_configuracao
from .controladores.predicao import tratar_entrada_mal_formada
from .dominio.esquema import carregar_esquema
from .predicao.catalogo_pontos import carregar_catalogo_pontos
from .predicao.registro import construir_registro
from .rotas import desempenho, esquema, modelos, predicao, saude
from .rotas.desempenho import carregar_desempenho
from .servicos.predicao import ServicoDePredicao

DESCRICAO = """
Serviço do Thermal Predictor. Publica o contrato de entrada da camada de predição, os
metadados dos modelos por subsistema, o desempenho agregado do modelo final (`GET /desempenho`)
e a previsão de temperatura de cada componente para uma configuração experimental
(`POST /predicao`).

Cada subsistema tem base e faixa de temperatura próprias e recebe seu próprio modelo. A
família ativa é definida em `api/catalogo_modelos.json` ou na variável de ambiente
`THERMAL_API_FAMILIA_MODELO`; enquanto nenhuma for escolhida, o serviço responde com os
subsistemas em `sem_modelo`.
"""


def montar_estado(app, configuracao=None):
    """Carrega o dicionário de features, os modelos e o catálogo de pontos uma vez, na subida."""
    configuracao = configuracao or carregar_configuracao()
    app.state.configuracao = configuracao
    app.state.esquema = carregar_esquema(str(configuracao.caminho_esquema))
    app.state.registro = construir_registro(configuracao)
    app.state.catalogo_pontos = carregar_catalogo_pontos(configuracao.caminho_catalogo_pontos)
    app.state.desempenho = carregar_desempenho(configuracao, app.state.registro.familia_ativa)
    app.state.servico_de_predicao = ServicoDePredicao(
        app.state.registro, app.state.catalogo_pontos, app.state.esquema
    )


def criar_app(configuracao=None):
    """Fábrica da aplicação; recebe a configuração pronta nos testes."""
    # O CORS é montado junto com o app, antes do ciclo de vida, então a configuração
    # precisa existir aqui. Ler o ambiente é barato e não depende dos arquivos de dados.
    origens = (configuracao or carregar_configuracao()).origens_permitidas

    @asynccontextmanager
    async def ciclo_de_vida(app):
        montar_estado(app, configuracao)
        yield

    app = FastAPI(
        title="Thermal Predictor API",
        version=VERSAO_API,
        summary="Contrato de entrada, catálogo de modelos e previsão do Thermal Predictor.",
        description=DESCRICAO,
        lifespan=ciclo_de_vida,
        openapi_tags=[
            {"name": "operação", "description": "Saúde do serviço."},
            {"name": "contrato", "description": "Dicionário de features aceito na predição."},
            {"name": "modelos", "description": "Metadados e desempenho dos modelos."},
            {"name": "predição", "description": "Temperatura prevista de cada componente."},
        ],
    )

    # Sem isto o navegador bloqueia a chamada do painel: a página é servida por um
    # servidor estático e a API responde em outra porta, o que é origem diferente.
    # Só `Content-Type` é liberado, e sem credenciais: a API não usa sessão nem cookie.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(origens),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    app.add_exception_handler(RequestValidationError, tratar_entrada_mal_formada)

    app.include_router(saude.roteador)
    app.include_router(esquema.roteador)
    app.include_router(modelos.roteador)
    app.include_router(desempenho.roteador)
    app.include_router(predicao.roteador)

    return app


app = criar_app()
