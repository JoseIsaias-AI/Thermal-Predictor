"""Contrato das ferramentas que o chatbot pode executar.

Uma ferramenta só é oferecida ao modelo quando existe de fato e está pronta.
O registro é montado na inicialização da API; o que não estiver aqui é
declarado como INDISPONÍVEL no prompt e bloqueado em código.
"""

from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from thermal_chatbot.schemas import ToolName


@dataclass(frozen=True)
class ToolResult:
    """Resultado de uma execução: contexto verificável ou ausência dele."""

    found: bool
    context: str
    sources: list[str] = field(default_factory=list)
    detail: str = ""


class Tool(ABC):
    """Executor de uma fonte autorizada."""

    name: ToolName

    @abstractmethod
    async def run(self, arguments: Mapping[str, Any], fallback_query: str) -> ToolResult:
        """Executa a busca e devolve apenas conteúdo realmente recuperado.

        ``fallback_query`` é usada quando o modelo pede a ferramenta sem
        argumentos utilizáveis: perder a pergunta do usuário faria a chamada
        falhar por um detalhe de formatação, não por falta de fonte.
        """

    @abstractmethod
    async def status(self) -> tuple[bool, str]:
        """Diz se a ferramenta está operacional, para o endpoint de saúde."""


ToolRegistry = Mapping[ToolName, Tool]
