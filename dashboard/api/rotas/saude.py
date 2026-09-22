"""GET /saude: estado da aplicação e do carregamento dos modelos."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from .. import VERSAO_API
from ..dominio.contratos import RespostaSaude
from .dependencias import obter_esquema, obter_registro

roteador = APIRouter(tags=["operação"])


@roteador.get(
    "/saude",
    response_model=RespostaSaude,
    summary="Verificação de saúde do serviço",
    description=(
        "Confirma que a aplicação está no ar e informa, por subsistema, se o modelo foi "
        "carregado na inicialização. Responde 200 mesmo sem modelo ativo: o campo `status` "
        "distingue `ok`, `degradado` e `sem_modelo`."
    ),
)
def saude(registro=Depends(obter_registro), esquema=Depends(obter_esquema)):
    subsistemas = [
        {
            "subsistema": nome,
            "estado": preditor.estado,
            "familia": preditor.metadados.familia,
            "versao": preditor.metadados.versao,
            "motivo": preditor.motivo,
        }
        for nome, preditor in registro.preditores.items()
    ]

    return {
        "status": registro.estado_geral(),
        "versao_api": VERSAO_API,
        "verificado_em": datetime.now(timezone.utc).isoformat(),
        "esquema_features": {
            "versao": esquema["versao"],
            "fatores": len(esquema["fatores"]),
        },
        "modelos": {
            "familia_ativa": registro.familia_ativa,
            "esperados": len(registro.preditores),
            "carregados": len(registro.carregados()),
        },
        "subsistemas": subsistemas,
    }
