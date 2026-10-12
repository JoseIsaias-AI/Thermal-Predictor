"""GET /desempenho: métricas agregadas do modelo final.

Serve o arquivo que `sintetico/treinar_modelos.py` grava a partir do teste isolado, das divisões
sorteadas por configuração e do teste isolado agregado por faixa de limite, com as estatísticas
da base sem modelo no campo `base`.
Nenhuma medição, previsão por ponto ou limite de componente passa por aqui.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from ..configuracao import MODELO_DESEMPENHO
from ..dominio.contratos import RespostaDeErro, RespostaDesempenho
from .dependencias import obter_desempenho

registro_de_log = logging.getLogger(__name__)

roteador = APIRouter(tags=["modelos"])


def carregar_desempenho(configuracao, familia):
    """O desempenho da família ativa, ou `None` sem família ou sem o arquivo de métricas."""
    if not familia:
        return None

    caminho = configuracao.pasta_modelos / MODELO_DESEMPENHO.format(familia=familia)

    if not caminho.is_file():
        return None

    try:
        with caminho.open(encoding="utf-8") as arquivo:
            return RespostaDesempenho.model_validate(json.load(arquivo))
    except (OSError, ValueError) as erro:
        registro_de_log.warning("Desempenho ilegível em %s: %s", caminho, erro)
        return None


@roteador.get(
    "/desempenho",
    response_model=RespostaDesempenho,
    response_model_by_alias=True,
    summary="Desempenho agregado do modelo final",
    description=(
        "MAE, RMSE e R² do teste isolado, MAE médio e aprovação mediana nas 40 divisões, pontos "
        "aprovados no critério do parceiro, sensibilidade, falsos negativos e falsos positivos da "
        "RN-01, por dataset e nas seis áreas juntas, o teste de Wilcoxon pareado contra a média "
        "histórica do ponto e a aprovação e o erro por faixa de limite. No campo `base`, as "
        "estatísticas sem modelo da tela de engenharia: referência, validação, procedência, "
        "hipóteses e escalonamento. Gravado por `sintetico/treinar_modelos.py` só com agregados: "
        "nenhuma medição nem previsão por ponto."
    ),
    responses={
        503: {
            "model": RespostaDeErro,
            "description": "As métricas do modelo ativo não foram exportadas nesta execução.",
        },
    },
)
def desempenho(dados=Depends(obter_desempenho)):
    if dados is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {
                "erro": "desempenho_indisponivel",
                "mensagem": (
                    "As métricas agregadas do modelo ativo não estão disponíveis. Rode "
                    "`python sintetico/treinar_modelos.py`, que grava "
                    "modelos/desempenho_modelo_final.json."
                ),
                "campos": [],
            },
        )

    return dados
