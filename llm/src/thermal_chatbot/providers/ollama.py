"""Implementação local do provedor usando a API HTTP do Ollama."""

from typing import Any

import httpx

from thermal_chatbot.providers.base import (
    LLMProvider,
    ProviderResponseError,
    ProviderUnavailableError,
)
from thermal_chatbot.settings import Settings


class OllamaProvider(LLMProvider):
    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.settings = settings
        self._client = client

    async def complete(
        self,
        messages: list[dict[str, str]],
        response_schema: dict[str, Any],
    ) -> str:
        payload = {
            "model": self.settings.ollama_model,
            "messages": messages,
            "stream": False,
            "think": False,
            "format": response_schema,
            "options": {
                "temperature": self.settings.ollama_temperature,
                "num_predict": self.settings.ollama_max_output_tokens,
            },
        }

        try:
            response = await self._request("POST", "/api/chat", json=payload)
        except httpx.TimeoutException as exc:
            # Distinguir do erro de conexão: aqui o Ollama está no ar, mas o
            # modelo não concluiu dentro de OLLAMA_TIMEOUT_SECONDS.
            raise ProviderUnavailableError(
                "O Ollama não respondeu dentro do tempo limite "
                f"({self.settings.ollama_timeout_seconds:.0f}s)."
            ) from exc
        except httpx.RequestError as exc:
            raise ProviderUnavailableError(
                "Não foi possível conectar ao Ollama local."
            ) from exc

        if response.status_code >= 400:
            raise ProviderResponseError(
                f"Ollama recusou a requisição (HTTP {response.status_code})."
            )

        try:
            content = response.json()["message"]["content"]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderResponseError(
                "Ollama retornou uma resposta sem conteúdo válido."
            ) from exc

        if not isinstance(content, str) or not content.strip():
            raise ProviderResponseError("Ollama retornou conteúdo vazio.")
        return content

    async def healthcheck(self) -> tuple[bool, str]:
        try:
            response = await self._request("GET", "/api/tags")
        except httpx.RequestError:
            return False, "Ollama não está acessível."

        if response.status_code >= 400:
            return False, f"Ollama respondeu com HTTP {response.status_code}."

        try:
            installed = {
                model["name"] for model in response.json().get("models", [])
            }
        except (KeyError, TypeError, ValueError):
            return False, "Ollama retornou uma lista de modelos inválida."

        configured = self.settings.ollama_model
        if configured not in installed and f"{configured}:latest" not in installed:
            return False, f"O modelo local '{configured}' não está instalado."
        return True, "Ollama e o modelo configurado estão disponíveis."

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        if self._client is not None:
            return await self._client.request(method, path, **kwargs)

        async with httpx.AsyncClient(
            base_url=str(self.settings.ollama_base_url).rstrip("/"),
            timeout=self.settings.ollama_timeout_seconds,
        ) as client:
            return await client.request(method, path, **kwargs)
