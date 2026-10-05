"""Dicionário de features servido em /schema e usado para validar a entrada.

Fonte única do lado da API: `esquema_features.json`, derivado de `dashboard/js/nucleo/schema.js`
(Seção 4.2.2 da documentação). O teste de paridade impede que os dois divirjam.
"""

import json
from functools import lru_cache


@lru_cache(maxsize=4)
def carregar_esquema(caminho):
    """Lê o dicionário de features do disco, uma vez por caminho."""
    with open(caminho, encoding="utf-8") as arquivo:
        return json.load(arquivo)


def niveis_validos(esquema):
    """Níveis aceitos por fator simples, incluindo o nível de referência e os sinônimos."""
    aceitos = {}

    for fator in esquema["fatores"]:
        if fator["tipo"] == "composto":
            for subcampo in fator.get("subcampos", []):
                chave = f"{fator['chave']}.{subcampo['chave']}"
                aceitos[chave] = [nivel["valor"] for nivel in subcampo["niveis"]]
            continue

        aceitos[fator["chave"]] = [nivel["valor"] for nivel in fator["niveis"]]

    return aceitos


def exemplo_de_entrada(esquema):
    """Configuração de exemplo publicada no contrato."""
    return esquema["exemplo_de_entrada"]
