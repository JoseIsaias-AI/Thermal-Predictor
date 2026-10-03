"""Configuração do serviço, lida do ambiente com padrões que valem no repositório."""

import os
from dataclasses import dataclass
from pathlib import Path

PASTA_API = Path(__file__).resolve().parent
RAIZ_REPOSITORIO = PASTA_API.parent.parent

# Dataset auditado de onde sai o limite de cada ponto. Não é versionado (dado do parceiro).
NOME_CATALOGO_PONTOS = "dataset_completo_com_flags_de_auditoria.csv"

# Origens que podem chamar a API pelo navegador. São as do servidor estático usado para
# abrir o painel em desenvolvimento, as mesmas que o chatbot aceita
# (`llm/src/thermal_chatbot/settings.py`). A lista é fechada de propósito: o serviço
# responde na máquina do usuário e não deve aceitar página de outra origem.
ORIGENS_PADRAO = (
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5501",
    "http://localhost:5501",
)


@dataclass(frozen=True)
class Configuracao:
    """Caminhos e escolhas de modelo do serviço."""

    pasta_modelos: Path
    caminho_catalogo: Path
    caminho_esquema: Path
    familia_padrao: str | None
    caminho_catalogo_pontos: Path | None = None
    origens_permitidas: tuple[str, ...] = ORIGENS_PADRAO

    @property
    def raiz_repositorio(self):
        return RAIZ_REPOSITORIO


def _texto_ou_nulo(valor):
    """Trata variável vazia como não declarada."""
    valor = (valor or "").strip()
    return valor or None


def catalogo_pontos_padrao():
    """Onde os notebooks deixam o dataset auditado: na raiz do repositório ou em `notebooks/`."""
    for pasta in (RAIZ_REPOSITORIO, RAIZ_REPOSITORIO / "notebooks"):
        if (pasta / NOME_CATALOGO_PONTOS).is_file():
            return pasta / NOME_CATALOGO_PONTOS

    return RAIZ_REPOSITORIO / NOME_CATALOGO_PONTOS


def carregar_configuracao():
    """Monta a configuração a partir das variáveis THERMAL_API_*."""
    pasta_modelos = _texto_ou_nulo(os.environ.get("THERMAL_API_PASTA_MODELOS"))
    caminho_catalogo = _texto_ou_nulo(os.environ.get("THERMAL_API_CATALOGO"))
    caminho_esquema = _texto_ou_nulo(os.environ.get("THERMAL_API_ESQUEMA"))
    caminho_pontos = _texto_ou_nulo(os.environ.get("THERMAL_API_CATALOGO_PONTOS"))
    origens = _texto_ou_nulo(os.environ.get("THERMAL_API_ORIGENS"))

    return Configuracao(
        pasta_modelos=Path(pasta_modelos) if pasta_modelos else RAIZ_REPOSITORIO / "modelos",
        caminho_catalogo=(
            Path(caminho_catalogo) if caminho_catalogo else PASTA_API / "catalogo_modelos.json"
        ),
        caminho_esquema=(
            Path(caminho_esquema)
            if caminho_esquema
            else PASTA_API / "dominio" / "esquema_features.json"
        ),
        # Sobrepõe a família do catálogo; sem nenhuma das duas, o serviço sobe sem preditor.
        familia_padrao=_texto_ou_nulo(os.environ.get("THERMAL_API_FAMILIA_MODELO")),
        caminho_catalogo_pontos=Path(caminho_pontos) if caminho_pontos else catalogo_pontos_padrao(),
        # Lista separada por vírgula, como no chatbot; vazio mantém o padrão do repositório.
        origens_permitidas=(
            tuple(o.strip() for o in origens.split(",") if o.strip())
            if origens
            else ORIGENS_PADRAO
        ),
    )
