"""GET /schema: contrato de entrada esperado pela camada de predição."""

from fastapi import APIRouter, Depends

from ..dominio.contratos import RespostaSchema
from .dependencias import obter_esquema

roteador = APIRouter(tags=["contrato"])


@roteador.get(
    "/schema",
    response_model=RespostaSchema,
    summary="Contrato de entrada da predição",
    description=(
        "Publica os fatores de configuração aceitos, seus níveis válidos e as regras de "
        "combinação, a partir do dicionário de features do projeto. Qualquer valor fora "
        "desta lista é recusado pela camada de predição (RN-04)."
    ),
)
def schema(esquema=Depends(obter_esquema)):
    return esquema
