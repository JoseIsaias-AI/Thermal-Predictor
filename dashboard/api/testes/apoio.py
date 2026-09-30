"""Caminhos e configuração usados pelos testes."""

import csv
import json
from pathlib import Path

from api.configuracao import Configuracao

PASTA_API = Path(__file__).resolve().parent.parent
PASTA_DASHBOARD = PASTA_API.parent
RAIZ_REPOSITORIO = PASTA_DASHBOARD.parent
CAMINHO_SCHEMA_JS = PASTA_DASHBOARD / "js" / "schema.js"
CAMINHO_STUB = PASTA_DASHBOARD / "js" / "dados_triagem.js"
CAMINHO_CATALOGO = PASTA_API / "catalogo_modelos.json"
PASTA_MODELO_FINAL = RAIZ_REPOSITORIO / "modelos" / "modelo_final"


def ler_stub_do_painel():
    """`DADOS_TRIAGEM` de `dashboard/js/dados_triagem.js`: o formato que as telas consomem."""
    texto = CAMINHO_STUB.read_text(encoding="utf-8")
    return json.loads(texto.split("=", 1)[1].rsplit(";", 1)[0])


def montar_configuracao(familia=None, caminho_catalogo=CAMINHO_CATALOGO, caminho_catalogo_pontos=None):
    """Configuração apontada para os artefatos versionados no repositório."""
    return Configuracao(
        pasta_modelos=RAIZ_REPOSITORIO / "modelos",
        caminho_catalogo=caminho_catalogo,
        caminho_esquema=PASTA_API / "dominio" / "esquema_features.json",
        familia_padrao=familia,
        caminho_catalogo_pontos=caminho_catalogo_pontos,
    )


def gravar_catalogo_sem_familia(pasta):
    """Cópia do catálogo de modelos com `familia_padrao` nula: o serviço antes da escolha."""
    catalogo = json.loads(CAMINHO_CATALOGO.read_text(encoding="utf-8"))
    catalogo["familia_padrao"] = None
    caminho = Path(pasta) / "catalogo_sem_familia.json"
    caminho.write_text(json.dumps(catalogo), encoding="utf-8")
    return caminho


def gravar_catalogo_pontos_sintetico(pasta, limite_c=150.0):
    """Catálogo de pontos fictício, sem dado do parceiro: todo termopar modelado com o mesmo
    limite, e os de AC Blower Inlet sem limite, como na base."""
    caminho = Path(pasta) / "catalogo_pontos.csv"

    with open(caminho, "w", encoding="utf-8", newline="") as arquivo:
        escritor = csv.writer(arquivo)
        escritor.writerow(["TC_Name", "Key_Area", "measurement_id", "limit_c", "is_monitor_only"])

        for metadados in sorted(PASTA_MODELO_FINAL.glob("*.json")):
            modelo = json.loads(metadados.read_text(encoding="utf-8"))
            area = modelo["conjunto"]
            sem_limite = area == "AC Blower Inlet"

            for termopar in modelo["codigo_por_termopar"]:
                escritor.writerow([
                    termopar, area, f"{termopar} | {area}", "" if sem_limite else limite_c, sem_limite,
                ])

    return caminho
