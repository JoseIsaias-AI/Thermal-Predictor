"""GET /modelos: metadados dos modelos por subsistema.

Só metadados e métricas de validação. Hiperparâmetros, codificação dos termopares, arquivo
de origem e o artefato binário ficam fora da resposta.
"""

from dataclasses import asdict

from fastapi import APIRouter, Depends

from ..dominio.contratos import RespostaModelos
from ..predicao.registro import tipos_suportados
from .dependencias import obter_registro

roteador = APIRouter(tags=["modelos"])


def _metricas(metricas):
    return None if metricas is None else asdict(metricas)


def _candidato(candidato):
    dados = asdict(candidato)
    dados["metricas"] = _metricas(candidato.metricas)
    return dados


@roteador.get(
    "/modelos",
    response_model=RespostaModelos,
    summary="Metadados dos modelos disponíveis",
    description=(
        "Lista um modelo por subsistema, com família, versão, cobertura de termopares e as "
        "métricas de validação já documentadas (MAE, RMSE, R²). Não expõe o artefato "
        "treinado nem os hiperparâmetros. `candidatos` traz os modelos exportados no "
        "repositório para o mesmo subsistema, para apoiar a escolha da família ativa."
    ),
)
def modelos(registro=Depends(obter_registro)):
    publicados = []

    for nome, preditor in registro.preditores.items():
        metadados = preditor.metadados
        publicados.append(
            {
                "subsistema": metadados.subsistema,
                "identificador": metadados.identificador,
                "estado": preditor.estado,
                "motivo": preditor.motivo,
                "familia": metadados.familia,
                "algoritmo": metadados.algoritmo,
                "versao": metadados.versao,
                "commit_treino": metadados.commit_treino,
                "validado": metadados.validado,
                "observacao": metadados.observacao,
                "termopares_cobertos": metadados.termopares_cobertos,
                "metricas": _metricas(metadados.metricas),
                "candidatos": [_candidato(c) for c in registro.candidatos.get(nome, ())],
            }
        )

    return {
        "familia_ativa": registro.familia_ativa,
        "familias_disponiveis": list(registro.familias_disponiveis),
        "tipos_de_preditor_suportados": tipos_suportados(),
        "total_subsistemas": len(publicados),
        "modelos": publicados,
    }
