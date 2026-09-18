"""Geração de embeddings no Ollama local.

O conteúdo indexado é confidencial, então a vetorização acontece na mesma
instância local que responde ao chatbot: nenhum trecho sai da máquina.
"""

from abc import ABC, abstractmethod
from typing import Any

import httpx

from thermal_chatbot.providers.base import (
    ProviderResponseError,
    ProviderUnavailableError,
)
from thermal_chatbot.settings import Settings

# O EmbeddingGemma foi treinado com prefixos por tarefa e perde qualidade sem
# eles. O template do modelo no Ollama é apenas "{{ .Prompt }}", ou seja, os
# prefixos precisam ser aplicados aqui.
DOCUMENT_PREFIX = "title: none | text: "
QUERY_PREFIX = "task: search result | query: "


class Embedder(ABC):
    """Interface usada pela ingestão e pela busca."""

    @property
    @abstractmethod
    def dimensions(self) -> int:
        """Tamanho do vetor produzido, usado para validar o esquema do banco."""

    @abstractmethod
    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Vetoriza trechos que serão armazenados."""

    @abstractmethod
    async def embed_query(self, text: str) -> list[float]:
        """Vetoriza uma pergunta para busca por similaridade."""


class OllamaEmbedder(Embedder):
    """Cliente do endpoint ``/api/embed`` do Ollama."""

    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.settings = settings
        self._client = client

    @property
    def dimensions(self) -> int:
        return self.settings.rag_embedding_dimensions

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return await self._embed([f"{DOCUMENT_PREFIX}{texto}" for texto in texts])

    async def embed_query(self, text: str) -> list[float]:
        vetores = await self._embed([f"{QUERY_PREFIX}{text}"])
        return vetores[0]

    async def healthcheck(self) -> tuple[bool, str]:
        """Confirma que o modelo de embeddings responde antes de prometer a busca."""

        try:
            await self.embed_query("verificação de disponibilidade")
        except (ProviderUnavailableError, ProviderResponseError) as exc:
            return False, str(exc)
        return True, f"Modelo de embeddings '{self.settings.ollama_embedding_model}' disponível."

    async def _embed(self, inputs: list[str]) -> list[list[float]]:
        payload = {
            "model": self.settings.ollama_embedding_model,
            "input": inputs,
        }

        try:
            response = await self._request("POST", "/api/embed", json=payload)
        except httpx.TimeoutException as exc:
            raise ProviderUnavailableError(
                "O Ollama não gerou os embeddings dentro do tempo limite."
            ) from exc
        except httpx.RequestError as exc:
            raise ProviderUnavailableError(
                "Não foi possível conectar ao Ollama para gerar embeddings."
            ) from exc

        if response.status_code >= 400:
            raise ProviderResponseError(
                f"Ollama recusou o pedido de embeddings (HTTP {response.status_code})."
            )

        try:
            vetores = response.json()["embeddings"]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderResponseError(
                "Ollama retornou uma resposta de embeddings sem conteúdo válido."
            ) from exc

        if not isinstance(vetores, list) or len(vetores) != len(inputs):
            raise ProviderResponseError(
                "Ollama devolveu uma quantidade de embeddings diferente da enviada."
            )

        esperado = self.dimensions
        for vetor in vetores:
            if not isinstance(vetor, list) or len(vetor) != esperado:
                raise ProviderResponseError(
                    f"O modelo de embeddings devolveu vetores fora de {esperado} dimensões."
                )
        return vetores

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        if self._client is not None:
            return await self._client.request(method, path, **kwargs)

        async with httpx.AsyncClient(
            base_url=str(self.settings.ollama_base_url).rstrip("/"),
            timeout=self.settings.ollama_timeout_seconds,
        ) as client:
            return await client.request(method, path, **kwargs)
