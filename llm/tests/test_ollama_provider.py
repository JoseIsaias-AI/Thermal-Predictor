import asyncio
import json

import httpx

from thermal_chatbot.providers.ollama import OllamaProvider
from thermal_chatbot.settings import Settings


def make_settings() -> Settings:
    return Settings(
        ollama_base_url="http://ollama.test:11434",
        ollama_model="qwen3:4b",
    )


def test_sends_structured_chat_request_to_ollama() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert request.url.path == "/api/chat"
        assert payload["model"] == "qwen3:4b"
        assert payload["stream"] is False
        assert payload["think"] is False
        assert payload["options"]["num_predict"] == 768
        assert payload["format"] == {"type": "object"}
        return httpx.Response(
            200,
            json={"message": {"role": "assistant", "content": '{"ok":true}'}},
        )

    async def scenario() -> str:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            base_url="http://ollama.test:11434",
        ) as client:
            provider = OllamaProvider(make_settings(), client=client)
            return await provider.complete(
                [{"role": "user", "content": "Olá"}],
                {"type": "object"},
            )

    assert asyncio.run(scenario()) == '{"ok":true}'


def test_healthcheck_detects_installed_model() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/tags"
        return httpx.Response(200, json={"models": [{"name": "qwen3:4b"}]})

    async def scenario() -> tuple[bool, str]:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            base_url="http://ollama.test:11434",
        ) as client:
            return await OllamaProvider(make_settings(), client).healthcheck()

    ready, detail = asyncio.run(scenario())
    assert ready is True
    assert "disponíveis" in detail


def test_mantem_o_modelo_residente_entre_perguntas() -> None:
    """Recarregar o modelo do disco custava ~25 s por pergunta em CPU."""

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["keep_alive"] == "45m"
        return httpx.Response(
            200,
            json={"message": {"role": "assistant", "content": '{"ok":true}'}},
        )

    async def scenario() -> str:
        settings = Settings(
            ollama_base_url="http://ollama.test:11434",
            ollama_model="qwen3:4b",
            ollama_keep_alive="45m",
        )
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            base_url="http://ollama.test:11434",
        ) as client:
            return await OllamaProvider(settings, client=client).complete(
                [{"role": "user", "content": "Olá"}], {"type": "object"}
            )

    assert asyncio.run(scenario()) == '{"ok":true}'
