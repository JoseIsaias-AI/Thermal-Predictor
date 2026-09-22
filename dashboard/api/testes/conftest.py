"""Fixtures dos testes da API."""

import sys
from pathlib import Path

import pytest

# Garante o pacote `api` importável mesmo quando o pytest roda fora de `dashboard/api`.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from api.main import criar_app  # noqa: E402

from .apoio import CAMINHO_SCHEMA_JS, montar_configuracao  # noqa: E402


@pytest.fixture(scope="session")
def caminho_schema_js():
    return CAMINHO_SCHEMA_JS


@pytest.fixture(scope="session")
def cliente():
    """Serviço como ele sobe hoje: sem família de modelos escolhida."""
    from fastapi.testclient import TestClient

    with TestClient(criar_app(montar_configuracao())) as cliente_http:
        yield cliente_http


@pytest.fixture(scope="session")
def cliente_com_modelo():
    """Serviço com uma família plugada, para exercitar o caminho de carga real."""
    from fastapi.testclient import TestClient

    with TestClient(criar_app(montar_configuracao("random_forest"))) as cliente_http:
        yield cliente_http
