import json
from typing import Any

from fastapi.testclient import TestClient

from thermal_chatbot.api import create_app
from thermal_chatbot.providers.base import LLMProvider
from thermal_chatbot.schemas import ToolName
from thermal_chatbot.settings import Settings
from thermal_chatbot.tools import Tool, ToolResult


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


class ApiFakeTool(Tool):
    name = ToolName.DOCUMENTATION_SEARCH

    async def run(self, arguments, fallback_query: str) -> ToolResult:
        return ToolResult(found=False, context="", detail="sem uso neste teste")

    async def status(self) -> tuple[bool, str]:
        return True, "4 trechos indexados."


def make_client(with_tools: bool = False) -> TestClient:
    # Os testes injetam as ferramentas: nenhum deles depende de banco no ar.
    settings = Settings(ollama_model="test-model")
    tools = {ToolName.DOCUMENTATION_SEARCH: ApiFakeTool()} if with_tools else {}
    return TestClient(
        create_app(settings=settings, provider=ApiFakeProvider(), tools=tools)
    )


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


def test_health_reports_connected_sources() -> None:
    response = make_client(with_tools=True).get("/api/health")

    assert response.status_code == 200
    assert response.json()["sources"] == [
        {
            "name": "documentation_search",
            "ready": True,
            "detail": "4 trechos indexados.",
        }
    ]


def test_health_without_sources_lists_none() -> None:
    assert make_client().get("/api/health").json()["sources"] == []
