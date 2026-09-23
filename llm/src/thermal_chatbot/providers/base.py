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

    async def warmup(self, messages: list[dict[str, str]]) -> None:
        """Faz o provedor avaliar este prompt e guardar o resultado em cache.

        Medido com qwen3:4b em CPU: avaliar o prompt de sistema custa cerca de
        124 s na primeira chamada e 0,4 s nas seguintes, porque o Ollama
        reaproveita o prefixo já avaliado. Aquecer antes da pergunta tira essa
        espera do caminho de quem perguntou.

        É otimização, não funcionalidade: quem não tiver cache de prefixo
        simplesmente não implementa, e nada mais muda.
        """
