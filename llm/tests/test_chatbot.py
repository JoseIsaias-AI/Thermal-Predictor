import asyncio
import json
from typing import Any

import pytest

from thermal_chatbot.chatbot import ChatbotService
from thermal_chatbot.providers.base import LLMProvider, ProviderResponseError
from thermal_chatbot.schemas import ChatAction, ChatRequest


class FakeProvider(LLMProvider):
    def __init__(self, decision: dict[str, Any]) -> None:
        self.decision = decision
        self.messages: list[dict[str, str]] = []

    async def complete(
        self,
        messages: list[dict[str, str]],
        response_schema: dict[str, Any],
    ) -> str:
        self.messages = messages
        assert response_schema["properties"]["action"]
        return json.dumps(self.decision)

    async def healthcheck(self) -> tuple[bool, str]:
        return True, "ok"


def test_returns_direct_answer_and_sends_system_prompt() -> None:
    provider = FakeProvider(
        {
            "action": "answer",
            "answer": "É uma etapa preliminar de análise.",
            "tool_name": "documentation_search",
            "tool_arguments": {},
            "sources": ["fonte-que-nao-foi-fornecida"],
            "reason": "A pergunta é conceitual.",
        }
    )
    service = ChatbotService(provider, model_name="test-model")

    response = asyncio.run(service.reply(ChatRequest(message="O que é triagem?")))

    assert response.action == ChatAction.ANSWER
    assert response.model == "test-model"
    assert response.tool_name is None
    assert response.sources == []
    assert "triagem" in provider.messages[0]["content"].lower()
    assert provider.messages[-1]["content"] == "O que é triagem?"


def test_fails_closed_when_model_requests_unavailable_tool() -> None:
    provider = FakeProvider(
        {
            "action": "use_tool",
            "answer": "",
            "tool_name": "thermal_prediction",
            "tool_arguments": {"housing": "metal"},
            "sources": [],
            "reason": "A pergunta exige uma previsão específica.",
        }
    )
    service = ChatbotService(provider, model_name="test-model")

    response = asyncio.run(
        service.reply(ChatRequest(message="Qual será a temperatura?"))
    )

    assert response.action == ChatAction.INSUFFICIENT_DATA
    assert "não vou estimar nem inventar" in response.answer.lower()


def test_keeps_history_between_system_prompt_and_current_message() -> None:
    provider = FakeProvider(
        {
            "action": "answer",
            "answer": "Resposta contextual.",
            "tool_name": None,
            "tool_arguments": {},
            "sources": [],
            "reason": "Há contexto suficiente.",
        }
    )
    service = ChatbotService(provider, model_name="test-model")
    request = ChatRequest(
        message="Pode explicar melhor?",
        history=[
            {"role": "user", "content": "O que é margem térmica?"},
            {"role": "assistant", "content": "É a distância até o limite."},
        ],
    )

    asyncio.run(service.reply(request))

    assert [message["role"] for message in provider.messages] == [
        "system",
        "user",
        "assistant",
        "user",
    ]


def test_rejects_model_response_outside_contract() -> None:
    provider = FakeProvider(
        {
            "action": "answer",
            "answer": "",
            "tool_name": None,
            "tool_arguments": {},
            "sources": [],
            "reason": "Resposta vazia inválida.",
        }
    )
    service = ChatbotService(provider, model_name="test-model")

    with pytest.raises(ProviderResponseError):
        asyncio.run(service.reply(ChatRequest(message="Responda sem conteúdo")))
