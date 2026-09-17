import json
from typing import Any

from fastapi.testclient import TestClient

from thermal_chatbot.api import create_app
from thermal_chatbot.providers.base import LLMProvider
from thermal_chatbot.settings import Settings


class ApiFakeProvider(LLMProvider):
    async def complete(
        self,
        messages: list[dict[str, str]],
        response_schema: dict[str, Any],
    ) -> str:
        return json.dumps(
            {
                "action": "answer",
                "answer": "Resposta local de teste.",
                "tool_name": None,
                "tool_arguments": {},
                "sources": [],
                "reason": "Pergunta geral.",
            }
        )

    async def healthcheck(self) -> tuple[bool, str]:
        return True, "Provedor de teste disponível."


def make_client() -> TestClient:
    settings = Settings(ollama_model="test-model")
    return TestClient(create_app(settings=settings, provider=ApiFakeProvider()))


def test_health_endpoint() -> None:
    response = make_client().get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_chat_endpoint() -> None:
    response = make_client().post("/api/chat", json={"message": "Olá"})

    assert response.status_code == 200
    assert response.json() == {
        "answer": "Resposta local de teste.",
        "action": "answer",
        "model": "test-model",
        "tool_name": None,
        "sources": [],
    }


def test_rejects_empty_message() -> None:
    response = make_client().post("/api/chat", json={"message": ""})

    assert response.status_code == 422
