"""Contrato comum para qualquer provedor de LLM."""

from abc import ABC, abstractmethod
from typing import Any


class ProviderError(RuntimeError):
    """Erro base de integração com o provedor."""


class ProviderUnavailableError(ProviderError):
    """O provedor não pôde ser alcançado."""


class ProviderResponseError(ProviderError):
    """O provedor respondeu em formato inválido ou recusou a chamada."""


class LLMProvider(ABC):
    """Interface que mantém o chatbot independente do executor do modelo."""

    @abstractmethod
    async def complete(
        self,
        messages: list[dict[str, str]],
        response_schema: dict[str, Any],
    ) -> str:
        """Gera uma resposta textual que respeite ``response_schema``."""

    @abstractmethod
    async def healthcheck(self) -> tuple[bool, str]:
        """Informa se o provedor e o modelo configurado estão disponíveis."""
