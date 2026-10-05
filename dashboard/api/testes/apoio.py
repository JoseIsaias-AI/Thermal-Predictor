"""Caminhos e configuração usados pelos testes."""

import csv
import json
from pathlib import Path

from api.configuracao import Configuracao

PASTA_API = Path(__file__).resolve().parent.parent
PASTA_DASHBOARD = PASTA_API.parent
RAIZ_REPOSITORIO = PASTA_DASHBOARD.parent
CAMINHO_SCHEMA_JS = PASTA_DASHBOARD / "js" / "nucleo" / "schema.js"
CAMINHO_FIXTURE_PAINEL = PASTA_DASHBOARD / "testes" / "fixtures" / "dados_triagem.js"
CAMINHO_CATALOGO = PASTA_API / "catalogo_modelos.json"
PASTA_MODELO_FINAL = RAIZ_REPOSITORIO / "modelos" / "modelo_final"


# Onde a área do ponto não é o nome do modelo que o prevê. São as duas assimetrias
# do modelo final, que é uma mescla por área: `AC Blower Inlet` tem modelo próprio
# mas os seus pontos ficam na área `Main Vent Sys`, e o modelo de
# `HMI / Knobs / Console` cobre duas áreas. O catálogo real é dado do parceiro e não
# é versionado; o que fica aqui é só o recorte estrutural, sem nenhuma medição, para
# o catálogo sintético não apagar a assimetria e com ela a chance de pegar o erro de
# casar ponto e modelo por `Key_Area`.
AREA_REAL_DO_TERMOPAR = {
    "Entrada do soprador P01": "Main Vent Sys",
    "Entrada do soprador P02": "Main Vent Sys",
    "HMI P01": "Oven HMI",
    "HMI P02": "Oven HMI",
    "HMI P03": "Oven HMI",
    "HMI P04": "Oven HMI",
    "Knobs P05": "CT Knobs",
    "Knobs P06": "CT Knobs",
    "Knobs P02": "CT Knobs",
    "Knobs P01": "CT Knobs",
    "Knobs P03": "CT Knobs",
    "Knobs P04": "CT Knobs",
}


def area_do_termopar(termopar, subsistema):
    """Área do ponto no catálogo: a do modelo, menos onde a base real discorda."""
    return AREA_REAL_DO_TERMOPAR.get(termopar, subsistema)


def ler_fixture_do_painel():
    """`DADOS_TRIAGEM` da fixture dos testes do painel: o formato que as telas consomem.

    A fixture é sintética e nenhuma tela a carrega; serve para conferir que a resposta da
    API tem todos os campos que as telas leem.
    """
    texto = CAMINHO_FIXTURE_PAINEL.read_text(encoding="utf-8")
    return json.loads(texto.split("var DADOS_TRIAGEM =", 1)[1].rsplit(";", 1)[0])


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
    limite, e os de AC Blower Inlet sem limite, como na base.

    A `Key_Area` não é inventada igual ao nome do modelo: segue `area_do_termopar`, que
    reproduz as duas assimetrias da base real. Um catálogo em que área e modelo coincidem
    deixaria passar o erro de casar os dois por área — justamente nos pontos sem modelo
    validado, que são os de `AC Blower Inlet`.
    """
    caminho = Path(pasta) / "catalogo_pontos.csv"

    with open(caminho, "w", encoding="utf-8", newline="") as arquivo:
        escritor = csv.writer(arquivo)
        escritor.writerow(["TC_Name", "Key_Area", "measurement_id", "limit_c", "is_monitor_only"])

        for metadados in sorted(PASTA_MODELO_FINAL.glob("*.json")):
            modelo = json.loads(metadados.read_text(encoding="utf-8"))
            subsistema = modelo["conjunto"]
            # O limite segue o modelo, e não a área: quem não tem limite declarado é
            # AC Blower Inlet, cujos pontos moram na área Main Vent Sys.
            sem_limite = subsistema == "AC Blower Inlet"

            for termopar in modelo["codigo_por_termopar"]:
                area = area_do_termopar(termopar, subsistema)
                escritor.writerow([
                    termopar, area, f"{termopar} | {area}", "" if sem_limite else limite_c, sem_limite,
                ])

    return caminho
