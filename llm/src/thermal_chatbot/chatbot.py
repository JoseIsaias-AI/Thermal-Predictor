"""Orquestra o comportamento do chatbot sem acoplá-lo à API web."""

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from thermal_chatbot.prompts import build_context_message, build_system_prompt
from thermal_chatbot.providers.base import LLMProvider, ProviderResponseError
from thermal_chatbot.schemas import (
    ChatAction,
    ChatDecision,
    ChatRequest,
    ChatResponse,
    ToolName,
)
from thermal_chatbot.tools import Tool, ToolRegistry, ToolResult

SEM_FONTE_DISPONIVEL = (
    "Não possuo acesso à fonte necessária para responder com "
    "segurança. A integração correspondente ainda não está "
    "disponível; não vou estimar nem inventar esse resultado."
)


class ChatbotService:
    """Aplica prompt, executa fontes autorizadas e falha de forma segura."""

    def __init__(
        self,
        provider: LLMProvider,
        model_name: str,
        available_tools: ToolRegistry | None = None,
        always_retrieve: bool = True,
    ) -> None:
        self.provider = provider
        self.model_name = model_name
        self.available_tools: dict[ToolName, Tool] = dict(available_tools or {})
        # Um modelo pequeno costuma responder de cabeça sobre termos do projeto
        # em vez de pedir a busca. Com isto, a documentação é consultada mesmo
        # quando ele não pede — o que ancora a resposta em trecho citável.
        self.always_retrieve = always_retrieve

    async def reply(self, request: ChatRequest) -> ChatResponse:
        messages = self._build_messages(request)
        decision = await self._decide(messages)

        if decision.action == ChatAction.USE_TOOL:
            return await self._answer_with_tool(
                messages,
                tool_name=decision.tool_name,
                arguments=decision.tool_arguments,
                fallback_query=request.message,
            )

        grounded = await self._ground_direct_answer(messages, request.message)
        if grounded is not None:
            return grounded

        return ChatResponse(
            answer=decision.answer,
            action=decision.action,
            model=self.model_name,
            # Sem ferramenta executada não houve fonte entregue ao modelo;
            # qualquer citação produzida por ele seria não verificável.
            sources=[],
        )

    def _build_messages(self, request: ChatRequest) -> list[dict[str, str]]:
        return [
            {
                "role": "system",
                "content": build_system_prompt(self.available_tools.keys()),
            },
            *[message.model_dump() for message in request.history],
            {"role": "user", "content": request.message},
        ]

    async def _decide(self, messages: list[dict[str, str]]) -> ChatDecision:
        raw_decision = await self.provider.complete(
            messages=messages,
            response_schema=ChatDecision.model_json_schema(),
        )

        try:
            return ChatDecision.model_validate_json(raw_decision)
        except ValidationError as exc:
            raise ProviderResponseError(
                "O modelo não respeitou o contrato de resposta."
            ) from exc

    async def _ground_direct_answer(
        self,
        messages: list[dict[str, str]],
        user_message: str,
    ) -> ChatResponse | None:
        """Consulta a documentação mesmo sem pedido do modelo.

        Devolve ``None`` quando não há nada relevante indexado: nesse caso a
        pergunta não é sobre o projeto e a resposta direta segue valendo.
        """

        tool = self.available_tools.get(ToolName.DOCUMENTATION_SEARCH)
        if not self.always_retrieve or tool is None:
            return None

        result = await tool.run({"query": user_message}, fallback_query=user_message)
        if not result.found:
            return None
        return await self._answer_from_context(messages, tool, result)

    async def _answer_with_tool(
        self,
        messages: list[dict[str, str]],
        tool_name: ToolName | None,
        arguments: Mapping[str, Any],
        fallback_query: str,
    ) -> ChatResponse:
        """Executa a ferramenta pedida e responde só com o que ela devolveu."""

        tool = self.available_tools.get(tool_name)
        if tool is None:
            # Vale inclusive quando o prompt declarou a ferramenta: a barreira
            # de segurança é o código, não o texto do system prompt.
            return self._insufficient(SEM_FONTE_DISPONIVEL)

        result = await tool.run(arguments, fallback_query=fallback_query)
        if not result.found:
            return self._insufficient(_no_evidence_answer(result), tool_name=tool.name)

        return await self._answer_from_context(messages, tool, result)

    async def _answer_from_context(
        self,
        messages: list[dict[str, str]],
        tool: Tool,
        result: ToolResult,
    ) -> ChatResponse:
        """Segunda passada: o modelo responde preso ao contexto recuperado."""

        grounded = await self._decide(
            [
                *messages,
                {
                    "role": "system",
                    "content": build_context_message(tool.name, result.context),
                },
            ]
        )

        if grounded.action == ChatAction.USE_TOOL:
            # Segunda chamada à ferramenta não é permitida: evita laço e
            # mantém a resposta presa ao contexto já recuperado.
            return self._insufficient(
                "Não consegui concluir a resposta com os trechos recuperados "
                "dos documentos autorizados.",
                tool_name=tool.name,
            )

        if grounded.action != ChatAction.ANSWER:
            return self._insufficient(grounded.answer, tool_name=tool.name)

        return ChatResponse(
            answer=grounded.answer,
            action=grounded.action,
            model=self.model_name,
            tool_name=tool.name,
            sources=_validate_sources(grounded.sources, result.sources),
        )

    def _insufficient(self, answer: str, tool_name: ToolName | None = None) -> ChatResponse:
        return ChatResponse(
            answer=answer,
            action=ChatAction.INSUFFICIENT_DATA,
            model=self.model_name,
            tool_name=tool_name,
        )


def _no_evidence_answer(result: ToolResult) -> str:
    """Explica a ausência de evidência sem afirmar que o dado não existe."""

    detalhe = f" Motivo: {result.detail}" if result.detail else ""
    return (
        "Não encontrei esse dado nos documentos autorizados que tenho "
        "indexados, então não vou estimá-lo." + detalhe
    )


def _validate_sources(cited: list[str], provided: list[str]) -> list[str]:
    """Mantém apenas fontes que foram realmente entregues ao modelo."""

    disponiveis = {fonte.strip().lower(): fonte for fonte in provided}
    validadas: list[str] = []
    for fonte in cited:
        encontrada = disponiveis.get(fonte.strip().lower())
        if encontrada and encontrada not in validadas:
            validadas.append(encontrada)

    # O modelo pode responder a partir do contexto sem repetir as linhas FONTE.
    # Nesse caso devolvemos os trechos que de fato sustentaram a resposta, em
    # vez de deixar o usuário sem nenhuma referência verificável.
    return validadas or list(provided)
