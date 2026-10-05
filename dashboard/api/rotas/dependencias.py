"""Acesso ao estado montado na subida do serviço."""

from fastapi import Request


def obter_registro(request: Request):
    """Registro de modelos carregado no lifespan."""
    return request.app.state.registro


def obter_configuracao(request: Request):
    return request.app.state.configuracao


def obter_esquema(request: Request):
    return request.app.state.esquema


def obter_catalogo_pontos(request: Request):
    return request.app.state.catalogo_pontos


def obter_desempenho(request: Request):
    """Métricas agregadas do modelo ativo, lidas na subida; `None` sem o arquivo."""
    return request.app.state.desempenho


def obter_servico_de_predicao(request: Request):
    return request.app.state.servico_de_predicao
