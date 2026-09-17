"""Orquestra o comportamento do chatbot sem acoplá-lo à API web."""

from collections.abc import Mapping

from pydantic import ValidationError

from thermal_chatbot.prompts import build_system_prompt
from thermal_chatbot.providers.base import LLMProvider, ProviderResponseError
from thermal_chatbot.schemas import (
    ChatAction,
    ChatDecision,
    ChatRequest,
    ChatResponse,
    ToolName,
)


class ChatbotService:
    """Aplica prompt, valida a decisão do modelo e falha de forma segura."""

    def __init__(
        self,
        provider: LLMProvider,
        model_name: str,
        available_tools: Mapping[ToolName, object] | None = None,
    ) -> None:
        self.provider = provider
        self.model_name = model_name
        self.available_tools = dict(available_tools or {})

    async def reply(self, request: ChatRequest) -> ChatResponse:
        messages = [
            {
                "role": "system",
                "content": build_system_prompt(self.available_tools.keys()),
            },
            *[message.model_dump() for message in request.history],
            {"role": "user", "content": request.message},
        ]

        raw_decision = await self.provider.complete(
            messages=messages,
            response_schema=ChatDecision.model_json_schema(),
        )

        try:
            decision = ChatDecision.model_validate_json(raw_decision)
        except ValidationError as exc:
            raise ProviderResponseError(
                "O modelo não respeitou o contrato de resposta."
            ) from exc

        if decision.action == ChatAction.USE_TOOL:
            return self._handle_tool_request(decision)

        return ChatResponse(
            answer=decision.answer,
            action=decision.action,
            model=self.model_name,
            # Nesta etapa nenhuma fonte externa foi entregue ao modelo; logo,
            # qualquer citação produzida por ele seria não verificável.
            sources=[],
        )

    def _handle_tool_request(self, decision: ChatDecision) -> ChatResponse:
        """Bloqueia chamadas a fontes ainda não conectadas ao backend."""

        if decision.tool_name not in self.available_tools:
            return ChatResponse(
                answer=(
                    "Não possuo acesso à fonte necessária para responder com "
                    "segurança. A integração correspondente ainda não está "
                    "disponível; não vou estimar nem inventar esse resultado."
                ),
                action=ChatAction.INSUFFICIENT_DATA,
                model=self.model_name,
            )

        # Os executores serão implementados nas tarefas de RAG, dataset e
        # predição. Até lá, a presença indevida de uma ferramenta também fecha.
        return ChatResponse(
            answer=(
                "A fonte foi reconhecida, mas sua execução ainda não foi "
                "implementada. Não há dados suficientes para responder."
            ),
            action=ChatAction.INSUFFICIENT_DATA,
            model=self.model_name,
            tool_name=decision.tool_name,
        )
