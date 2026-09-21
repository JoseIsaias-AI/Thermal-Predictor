"""Dublês compartilhados pelos testes: nenhum modelo real é chamado."""

import json
from collections.abc import Mapping
from typing import Any

from thermal_chatbot.providers.base import LLMProvider
from thermal_chatbot.schemas import ToolName
from thermal_chatbot.tools import Tool, ToolResult


def is_answer_schema(response_schema: Mapping[str, Any]) -> bool:
    """Distingue as duas etapas pelo formato pedido ao provedor."""

    return "answer" in response_schema.get("properties", {})


def routing(
    action: str = "use_tool",
    tool_name: str | None = "documentation_search",
    tool_arguments: dict[str, Any] | None = None,
    reason: str = "Decisão de teste.",
) -> dict[str, Any]:
    return {
        "action": action,
        "tool_name": tool_name,
        "tool_arguments": tool_arguments if tool_arguments is not None else {},
        "reason": reason,
    }


def answer(
    text: str = "Resposta local de teste.",
    sources: list[str] | None = None,
    action: str = "answer",
) -> dict[str, Any]:
    return {"action": action, "answer": text, "sources": sources or []}


class ScriptedProvider(LLMProvider):
    """Responde conforme a etapa: roteamento ou redação.

    Cada fila é consumida em ordem, então o teste declara o que o modelo faria
    em cada etapa sem depender de quantas chamadas o serviço faz.
    """

    def __init__(
        self,
        routings: list[dict[str, Any]] | None = None,
        answers: list[dict[str, Any]] | None = None,
    ) -> None:
        self.routings = list(routings or [])
        self.answers = list(answers or [])
        self.calls: list[list[dict[str, str]]] = []
        self.routing_calls: list[list[dict[str, str]]] = []
        self.answer_calls: list[list[dict[str, str]]] = []

    async def complete(
        self,
        messages: list[dict[str, str]],
        response_schema: dict[str, Any],
    ) -> str:
        self.calls.append(messages)

        if is_answer_schema(response_schema):
            self.answer_calls.append(messages)
            return json.dumps(self.answers.pop(0))

        # A etapa de roteamento não pode oferecer campo de texto ao modelo.
        assert "answer" not in response_schema["properties"]
        self.routing_calls.append(messages)
        return json.dumps(self.routings.pop(0))

    async def healthcheck(self) -> tuple[bool, str]:
        return True, "Provedor de teste disponível."


class FakeTool(Tool):
    """Ferramenta com resultado fixo, que registra como foi chamada."""

    def __init__(self, name: ToolName, result: ToolResult) -> None:
        self.name = name
        self.result = result
        self.arguments: Mapping[str, Any] | None = None
        self.fallback_query: str | None = None
        self.runs = 0

    async def run(self, arguments: Mapping[str, Any], fallback_query: str) -> ToolResult:
        self.runs += 1
        self.arguments = arguments
        self.fallback_query = fallback_query
        return self.result

    async def status(self) -> tuple[bool, str]:
        return True, "Ferramenta de teste disponível."
