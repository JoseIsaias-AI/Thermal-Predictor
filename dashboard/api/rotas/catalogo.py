"""GET /catalogo: configurações históricas com a previsão do modelo para cada uma."""

from fastapi import APIRouter, Depends

from ..controladores.catalogo import executar_catalogo
from ..dominio.contratos import RespostaCatalogo, RespostaDeErro
from .dependencias import obter_estado_do_app

roteador = APIRouter(tags=["predição"])


@roteador.get(
    "/catalogo",
    response_model=RespostaCatalogo,
    summary="Configurações históricas e a previsão de cada uma",
    description=(
        "As configurações distintas das rodadas do dataset auditado, com identificador neutro "
        "(CFG-xx), os níveis dos sete fatores, o número de rodadas e a previsão do modelo final "
        "para cada uma, pela mesma inferência de `POST /predicao`. Sem `Run_ID` nem `Run_Reason` "
        "(RNF-05). Os vetores `t` (temperatura prevista), `m` (folga) e `e` (índice em `estados`) "
        "seguem a ordem de `pontos`."
    ),
    responses={
        503: {
            "model": RespostaDeErro,
            "description": "Dataset, catálogo de limites ou modelo indisponível nesta execução.",
        },
    },
)
def catalogo(estado=Depends(obter_estado_do_app)):
    return executar_catalogo(estado)
