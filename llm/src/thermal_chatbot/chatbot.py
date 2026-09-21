"""Orquestra o comportamento do chatbot sem acoplá-lo à API web.

O fluxo tem duas etapas, e a divisão existe por causa do custo de geração: em
CPU o modelo produz poucos tokens por segundo, então cada token escrito à toa
vira espera para o usuário.

1. Roteamento — schema sem campo de texto. O modelo só escolhe a fonte.
2. Redação — schema sem campos de ferramenta. O modelo só escreve a resposta,
   já com o resultado da fonte em mãos.

Quando a documentação tem algo a dizer sobre a pergunta, o trecho entra na
etapa 2 mesmo que o modelo não tenha pedido: sem isso, ele responde de cabeça
sobre termos do projeto e inventa níveis de fator.

Antes das duas etapas há dois atalhos locais, ambos com resposta montada em
código: cortesia (saudação, agradecimento, despedida, "o que você faz") e
comparação com vocabulário controlado. Qualquer ambiguidade cai no fluxo
normal — nenhum dos dois adivinha o que o usuário quis dizer.
"""

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from thermal_chatbot.prompts import build_context_message, build_system_prompt
from thermal_chatbot.providers.base import LLMProvider, ProviderResponseError
from thermal_chatbot.schemas import (
    AnswerDecision,
    ChatAction,
    ChatRequest,
    ChatResponse,
    ConversationMessage,
    RoutingDecision,
    ToolName,
)
from thermal_chatbot.tools import Tool, ToolRegistry, ToolResult
from thermal_chatbot.triage.intents import fast_comparison_arguments
from thermal_chatbot.triage.smalltalk import smalltalk_answer

# Trechos do histórico mantidos no prompt. Seis mensagens cobrem o vaivém
# recente de uma conversa sem arrastar o contexto inteiro a cada pergunta.
HISTORY_MAX_MESSAGES = 6
HISTORY_CHAR_BUDGET = 4_000

SEM_FONTE_DISPONIVEL = (
    "Não possuo acesso à fonte necessária para responder com "
    "segurança. A integração correspondente ainda não está "
    "disponível; não vou estimar nem inventar esse resultado."
)

SEM_EVIDENCIA = {
    ToolName.DOCUMENTATION_SEARCH: (
        "Não encontrei esse dado nos documentos autorizados que tenho indexados, "
        "então não vou estimá-lo."
    ),
    ToolName.DATASET_QUERY: (
        "A consulta ao dataset de ensaios não retornou leitura observada para "
        "esses critérios, então não vou estimar um valor."
    ),
    ToolName.THERMAL_PREDICTION: (
        "Não consegui executar a previsão com o que foi informado, e não vou "
        "estimar temperaturas por conta própria."
    ),
}


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
        # Rede de proteção: consulta a documentação quando o modelo decide
        # responder de cabeça sobre algo que pode estar documentado.
        self.always_retrieve = always_retrieve

    async def reply(self, request: ChatRequest) -> ChatResponse:
        # Saudação e cortesia não dependem de fonte nenhuma: a resposta é
        # sempre a mesma, então escrevê-la em código poupa as duas gerações do
        # fluxo normal. Uma comparação estruturada tem intenção explícita e
        # nunca é tratada como cortesia.
        if request.comparison is None:
            cortesia = smalltalk_answer(request.message, self.available_tools.keys())
            if cortesia is not None:
                return ChatResponse(
                    answer=cortesia,
                    action=ChatAction.ANSWER,
                    model=self.model_name,
                    sources=[],
                )

        messages = self._build_messages(request)
        comparison_arguments = fast_comparison_arguments(
            request.message,
            configuration=request.configuration,
            comparison=(
                request.comparison.model_dump() if request.comparison is not None else None
            ),
        )
        if comparison_arguments is not None:
            return await self._answer_with_tool(
                messages,
                tool_name=ToolName.THERMAL_PREDICTION,
                arguments=comparison_arguments,
                fallback_query=request.message,
            )

        routing = await self._route(messages)

        if routing.action == ChatAction.USE_TOOL:
            return await self._answer_with_tool(
                messages,
                tool_name=routing.tool_name,
                arguments=routing.tool_arguments,
                fallback_query=request.message,
            )

        documentacao = await self._retrieve_documentation(request.message)
        if documentacao is not None:
            return await self._answer_from_context(
                messages,
                self.available_tools[ToolName.DOCUMENTATION_SEARCH],
                documentacao,
            )

        decision = await self._write_answer(messages)
        return ChatResponse(
            answer=decision.answer,
            action=decision.action,
            model=self.model_name,
            # Sem fonte entregue ao modelo, qualquer citação que ele produzisse
            # seria não verificável.
            sources=[],
        )

    def _build_messages(self, request: ChatRequest) -> list[dict[str, str]]:
        return [
            {
                "role": "system",
                "content": build_system_prompt(self.available_tools.keys()),
            },
            *_recent_history(request.history),
            {"role": "user", "content": request.message},
        ]

    async def _route(self, messages: list[dict[str, str]]) -> RoutingDecision:
        return await self._complete(messages, RoutingDecision)

    async def _write_answer(self, messages: list[dict[str, str]]) -> AnswerDecision:
        return await self._complete(messages, AnswerDecision)

    async def _complete(self, messages: list[dict[str, str]], schema: type) -> Any:
        raw = await self.provider.complete(
            messages=messages,
            response_schema=schema.model_json_schema(),
        )

        try:
            return schema.model_validate_json(raw)
        except ValidationError as exc:
            raise ProviderResponseError(
                "O modelo não respeitou o contrato de resposta."
            ) from exc

    async def _retrieve_documentation(self, user_message: str) -> ToolResult | None:
        """Busca na documentação quando o modelo optou por responder sozinho."""

        tool = self.available_tools.get(ToolName.DOCUMENTATION_SEARCH)
        if not self.always_retrieve or tool is None:
            return None

        result = await tool.run({"query": user_message}, fallback_query=user_message)
        return result if result.found else None

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
            return self._insufficient(
                _no_evidence_answer(tool.name, result), tool_name=tool.name
            )

        return await self._answer_from_context(messages, tool, result)

    async def _answer_from_context(
        self,
        messages: list[dict[str, str]],
        tool: Tool,
        result: ToolResult,
    ) -> ChatResponse:
        """Etapa de redação: o modelo responde preso ao que a fonte devolveu."""

        if result.direct_answer:
            return ChatResponse(
                answer=result.direct_answer,
                action=ChatAction.ANSWER,
                model=self.model_name,
                tool_name=tool.name,
                sources=list(result.sources),
                data=result.data,
            )

        decision = await self._write_answer(
            [
                *messages,
                {
                    "role": "system",
                    "content": build_context_message(tool.name, result.context),
                },
            ]
        )

        if decision.action != ChatAction.ANSWER:
            # Em insufficient_data não há fonte a citar: listar trechos ao lado
            # de "o dado não consta" diria duas coisas contrárias.
            return self._insufficient(decision.answer, tool_name=tool.name)

        return ChatResponse(
            answer=decision.answer,
            action=decision.action,
            model=self.model_name,
            tool_name=tool.name,
            sources=_validate_sources(decision.sources, result.sources),
            data=result.data,
        )

    def _insufficient(self, answer: str, tool_name: ToolName | None = None) -> ChatResponse:
        return ChatResponse(
            answer=answer,
            action=ChatAction.INSUFFICIENT_DATA,
            model=self.model_name,
            tool_name=tool_name,
        )


def _recent_history(history: list[ConversationMessage]) -> list[dict[str, str]]:
    """Mantém apenas as trocas recentes, das mais novas para as mais antigas.

    Duas razões. Um histórico longo empurra o prompt para além da janela de
    contexto, e o que é descartado ali é o começo — justamente o prompt de
    sistema, com as regras de escopo e confidencialidade. E cada token a mais
    custa tempo de processamento em CPU.
    """

    recentes: list[dict[str, str]] = []
    orcamento = HISTORY_CHAR_BUDGET

    for message in reversed(history[-HISTORY_MAX_MESSAGES:]):
        orcamento -= len(message.content)
        if orcamento < 0:
            break
        recentes.append(message.model_dump())

    recentes.reverse()
    return recentes


def _no_evidence_answer(tool_name: ToolName, result: ToolResult) -> str:
    """Explica a ausência de evidência sem afirmar que o dado não existe."""

    detalhe = f" Motivo: {result.detail}" if result.detail else ""
    return SEM_EVIDENCIA[tool_name] + detalhe


def _validate_sources(cited: list[str], provided: list[str]) -> list[str]:
    """Mantém apenas fontes que foram realmente entregues ao modelo."""

    disponiveis = {fonte.strip().lower(): fonte for fonte in provided}
    validadas: list[str] = []
    for fonte in cited:
        encontrada = disponiveis.get(fonte.strip().lower())
        if encontrada and encontrada not in validadas:
            validadas.append(encontrada)

    # O prompt pede que o modelo não copie as citações, para poupar tokens.
    # Então o normal é cair aqui: registramos os trechos que sustentaram a
    # resposta, em vez de deixar o usuário sem referência verificável.
    return validadas or list(provided)
