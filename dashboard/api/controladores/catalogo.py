"""Controlador do catálogo: monta a resposta uma vez e traduz as falhas em 503 com o motivo."""

from fastapi import HTTPException, status

from ..predicao.protocolo import CatalogoIndisponivel, ModeloIndisponivel
from ..servicos.catalogo import montar_catalogo
from .predicao import _detalhe


def executar_catalogo(estado):
    if getattr(estado, "catalogo_resposta", None) is None:
        try:
            estado.catalogo_resposta = montar_catalogo(
                estado.servico_de_predicao, estado.catalogo_configuracoes)
        except ModeloIndisponivel as erro:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, _detalhe("modelo_indisponivel", str(erro))
            ) from erro
        except CatalogoIndisponivel as erro:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, _detalhe("catalogo_indisponivel", str(erro))
            ) from erro

    return estado.catalogo_resposta
