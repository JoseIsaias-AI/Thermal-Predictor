"""Acesso ao estado montado na subida do serviço."""

from fastapi import Request


def obter_registro(request: Request):
    """Registro de modelos carregado no lifespan."""
    return request.app.state.registro


def obter_configuracao(request: Request):
    return request.app.state.configuracao


def obter_esquema(request: Request):
    return request.app.state.esquema
