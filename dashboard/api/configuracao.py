"""Configuração do serviço, lida do ambiente com padrões que valem no repositório."""

import os
from dataclasses import dataclass
from pathlib import Path

PASTA_API = Path(__file__).resolve().parent
RAIZ_REPOSITORIO = PASTA_API.parent.parent


@dataclass(frozen=True)
class Configuracao:
    """Caminhos e escolhas de modelo do serviço."""

    pasta_modelos: Path
    caminho_catalogo: Path
    caminho_esquema: Path
    familia_padrao: str | None

    @property
    def raiz_repositorio(self):
        return RAIZ_REPOSITORIO


def _texto_ou_nulo(valor):
    """Trata variável vazia como não declarada."""
    valor = (valor or "").strip()
    return valor or None


def carregar_configuracao():
    """Monta a configuração a partir das variáveis THERMAL_API_*."""
    pasta_modelos = _texto_ou_nulo(os.environ.get("THERMAL_API_PASTA_MODELOS"))
    caminho_catalogo = _texto_ou_nulo(os.environ.get("THERMAL_API_CATALOGO"))
    caminho_esquema = _texto_ou_nulo(os.environ.get("THERMAL_API_ESQUEMA"))

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
        # Enquanto a família não for escolhida, o serviço sobe sem preditor carregado.
        familia_padrao=_texto_ou_nulo(os.environ.get("THERMAL_API_FAMILIA_MODELO")),
    )
