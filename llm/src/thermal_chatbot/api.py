"""API HTTP do chatbot, destinada ao frontend do Thermal Predictor."""

import asyncio
import contextlib
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from thermal_chatbot.chatbot import ChatbotService
from thermal_chatbot.providers import (
    LLMProvider,
    OllamaProvider,
    ProviderResponseError,
    ProviderUnavailableError,
)
from thermal_chatbot.rag import build_documentation_tool
from thermal_chatbot.schemas import (
    ChatRequest,
    ChatResponse,
    HealthResponse,
    SourceStatus,
    ToolName,
)
from thermal_chatbot.settings import Settings, get_settings
from thermal_chatbot.tools import Tool, ToolRegistry
from thermal_chatbot.triage import build_dataset_tool, build_prediction_tool


def build_tool_registry(settings: Settings) -> dict[ToolName, Tool]:
    """Registra apenas ferramentas realmente configuradas nesta execução."""

    tools: dict[ToolName, Tool] = {}

    if settings.rag_enabled:
        documentacao = build_documentation_tool(settings)
        tools[documentacao.name] = documentacao

    if settings.dataset_enabled:
        consulta = build_dataset_tool(Path(settings.dataset_path))
        tools[consulta.name] = consulta

    if settings.prediction_enabled:
        previsao = build_prediction_tool(
            Path(settings.models_dir),
            Path(settings.dataset_path),
        )
        tools[previsao.name] = previsao

    return tools


def create_app(
    settings: Settings | None = None,
    provider: LLMProvider | None = None,
    tools: ToolRegistry | None = None,
) -> FastAPI:
    current_settings = settings or get_settings()
    current_provider = provider or OllamaProvider(current_settings)
    current_tools: dict[ToolName, Tool] = (
        dict(tools) if tools is not None else build_tool_registry(current_settings)
    )
    chatbot = ChatbotService(
        provider=current_provider,
        model_name=current_settings.ollama_model,
        available_tools=current_tools,
        always_retrieve=current_settings.rag_always_retrieve,
    )

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # Em segundo plano: aquecer custa o mesmo tempo da primeira pergunta,
        # e bloquear a subida faria a API demorar minutos para aceitar até o
        # /api/health. O cancelamento no fim evita tarefa órfã no reload.
        tarefa = asyncio.create_task(chatbot.warmup())
        try:
            yield
        finally:
            tarefa.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await tarefa

    application = FastAPI(
        title="Thermal Predictor Chatbot API",
        version="0.2.0",
        description="Integração local e controlada com o Ollama, com RAG local.",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=current_settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @application.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        ready, detail = await current_provider.healthcheck()

        fontes: list[SourceStatus] = []
        for nome, ferramenta in current_tools.items():
            pronta, explicacao = await ferramenta.status()
            fontes.append(SourceStatus(name=nome, ready=pronta, detail=explicacao))

        return HealthResponse(
            status="ready" if ready else "degraded",
            model=current_settings.ollama_model,
            detail=detail,
            sources=fontes,
            warm=chatbot.warm_state,
        )

    @application.post("/api/warmup", status_code=status.HTTP_202_ACCEPTED)
    async def warmup() -> dict[str, str]:
        """Pede o aquecimento e responde na hora, sem esperar o modelo.

        O painel chama isto ao ser aberto. Se o modelo tiver saído da memória
        depois de ocioso, a avaliação do prompt acontece enquanto a pessoa
        ainda está escrevendo, e não depois de ela apertar enviar.
        """

        asyncio.create_task(chatbot.warmup())
        return {"detail": "Aquecimento iniciado."}

    @application.post("/api/chat", response_model=ChatResponse)
    async def chat(request: ChatRequest) -> ChatResponse:
        try:
            return await chatbot.reply(request)
        except ProviderUnavailableError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc
        except ProviderResponseError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

    return application


app = create_app()

