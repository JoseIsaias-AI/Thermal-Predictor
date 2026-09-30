"""POST /predicao: temperatura prevista de cada componente para uma configuração experimental."""

from fastapi import APIRouter, Depends

from ..controladores.predicao import executar_predicao
from ..dominio.contratos import RequisicaoPredicao, RespostaDeErro, RespostaPredicao
from .dependencias import obter_servico_de_predicao

roteador = APIRouter(tags=["predição"])


@roteador.post(
    "/predicao",
    response_model=RespostaPredicao,
    summary="Temperatura prevista de cada componente",
    description=(
        "Recebe uma configuração experimental no vocabulário de /schema, executa o modelo final "
        "de cada subsistema e devolve a temperatura prevista de cada termopar, com o estado de "
        "risco de RN-01 contra o limite do componente. Os pontos sem limite declarado saem em "
        "`monitoramento` (RN-03). A resposta tem a forma que as telas do painel consomem."
    ),
    responses={
        422: {
            "model": RespostaDeErro,
            "description": "Configuração fora do contrato publicado em /schema (RN-04).",
        },
        503: {
            "model": RespostaDeErro,
            "description": "Modelo ou catálogo de limites indisponível nesta execução.",
        },
        500: {"model": RespostaDeErro, "description": "Falha inesperada durante a inferência."},
    },
)
def predicao(requisicao: RequisicaoPredicao, servico=Depends(obter_servico_de_predicao)):
    return executar_predicao(requisicao, servico)
