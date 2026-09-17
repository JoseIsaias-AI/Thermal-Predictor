"""API HTTP do chatbot, destinada ao frontend do Thermal Predictor."""

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from thermal_chatbot.chatbot import ChatbotService
from thermal_chatbot.providers import (
    LLMProvider,
    OllamaProvider,
    ProviderResponseError,
    ProviderUnavailableError,
)
from thermal_chatbot.schemas import ChatRequest, ChatResponse, HealthResponse
from thermal_chatbot.settings import Settings, get_settings


def create_app(
    settings: Settings | None = None,
    provider: LLMProvider | None = None,
) -> FastAPI:
    current_settings = settings or get_settings()
    current_provider = provider or OllamaProvider(current_settings)
    chatbot = ChatbotService(
        provider=current_provider,
        model_name=current_settings.ollama_model,
    )

    application = FastAPI(
        title="Thermal Predictor Chatbot API",
        version="0.1.0",
        description="Integração local e controlada com o Ollama.",
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
        return HealthResponse(
            status="ready" if ready else "degraded",
            model=current_settings.ollama_model,
            detail=detail,
        )

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
