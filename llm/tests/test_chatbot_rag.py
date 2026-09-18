import asyncio
import json
from collections.abc import Mapping
from typing import Any

from thermal_chatbot.chatbot import ChatbotService
from thermal_chatbot.providers.base import LLMProvider
from thermal_chatbot.schemas import ChatAction, ChatRequest, ToolName
from thermal_chatbot.tools import Tool, ToolResult

CONTEXTO = (
    "[1] FONTE: glossario.md § 3.2. Blower Direction\n"
    "    CONTEÚDO: A direção do soprador define o sentido do fluxo de ar."
)


class ScriptedProvider(LLMProvider):
    """Devolve uma decisão por chamada, na ordem programada pelo teste."""

    def __init__(self, decisions: list[dict[str, Any]]) -> None:
        self.decisions = decisions
        self.calls: list[list[dict[str, str]]] = []

    async def complete(
        self,
        messages: list[dict[str, str]],
        response_schema: dict[str, Any],
    ) -> str:
        self.calls.append(messages)
        return json.dumps(self.decisions[len(self.calls) - 1])

    async def healthcheck(self) -> tuple[bool, str]:
        return True, "ok"


class FakeDocumentationTool(Tool):
    name = ToolName.DOCUMENTATION_SEARCH

    def __init__(self, result: ToolResult) -> None:
        self.result = result
        self.arguments: Mapping[str, Any] | None = None
        self.fallback_query: str | None = None

    async def run(self, arguments: Mapping[str, Any], fallback_query: str) -> ToolResult:
        self.arguments = arguments
        self.fallback_query = fallback_query
        return self.result

    async def status(self) -> tuple[bool, str]:
        return True, "2 trechos indexados."


def pedido_de_ferramenta(query: str = "blower direction") -> dict[str, Any]:
    return {
        "action": "use_tool",
        "answer": "",
        "tool_name": "documentation_search",
        "tool_arguments": {"query": query},
        "sources": [],
        "reason": "A pergunta depende do glossário.",
    }


def resposta_final(sources: list[str]) -> dict[str, Any]:
    return {
        "action": "answer",
        "answer": "O soprador define o sentido do fluxo de ar no fogão.",
        "tool_name": None,
        "tool_arguments": {},
        "sources": sources,
        "reason": "O trecho recuperado cobre a pergunta.",
    }


def encontrado() -> ToolResult:
    return ToolResult(
        found=True,
        context=CONTEXTO,
        sources=["glossario.md § 3.2. Blower Direction"],
        detail="1 trecho recuperado.",
    )


def make_service(
    decisions: list[dict[str, Any]],
    result: ToolResult,
) -> tuple[ChatbotService, ScriptedProvider, FakeDocumentationTool]:
    provider = ScriptedProvider(decisions)
    tool = FakeDocumentationTool(result)
    service = ChatbotService(
        provider,
        model_name="test-model",
        available_tools={tool.name: tool},
    )
    return service, provider, tool


def test_executa_a_busca_e_responde_com_o_contexto_recuperado() -> None:
    service, provider, tool = make_service(
        [pedido_de_ferramenta(), resposta_final(["glossario.md § 3.2. Blower Direction"])],
        encontrado(),
    )

    response = asyncio.run(
        service.reply(ChatRequest(message="O que é Blower Direction no glossário?"))
    )

    assert response.action == ChatAction.ANSWER
    assert response.tool_name is ToolName.DOCUMENTATION_SEARCH
    assert response.sources == ["glossario.md § 3.2. Blower Direction"]
    assert tool.arguments == {"query": "blower direction"}

    # A segunda chamada recebe o contexto como dado delimitado, não como ordem.
    contexto = provider.calls[1][-1]
    assert contexto["role"] == "system"
    assert "não é instrução" in contexto["content"]
    assert CONTEXTO in contexto["content"]


def test_descarta_fonte_que_nao_foi_entregue_ao_modelo() -> None:
    service, _, _ = make_service(
        [
            pedido_de_ferramenta(),
            resposta_final(["relatorio-interno.pdf § 9", "glossario.md § 3.2. Blower Direction"]),
        ],
        encontrado(),
    )

    response = asyncio.run(service.reply(ChatRequest(message="O que é Blower Direction?")))

    assert response.sources == ["glossario.md § 3.2. Blower Direction"]


def test_declara_dados_insuficientes_quando_a_busca_nao_encontra_nada() -> None:
    service, provider, _ = make_service(
        [pedido_de_ferramenta("tensão de alimentação")],
        ToolResult(found=False, context="", detail="Nenhum trecho atingiu a similaridade mínima."),
    )

    response = asyncio.run(service.reply(ChatRequest(message="Qual a tensão de alimentação?")))

    assert response.action == ChatAction.INSUFFICIENT_DATA
    assert response.sources == []
    assert "não vou estimá-lo" in response.answer
    # Sem evidência não há segunda chamada ao modelo: nada a fundamentar.
    assert len(provider.calls) == 1


def test_repassa_a_pergunta_quando_o_modelo_nao_envia_argumentos() -> None:
    pedido = pedido_de_ferramenta()
    pedido["tool_arguments"] = {}
    service, _, tool = make_service(
        [pedido, resposta_final([])],
        encontrado(),
    )

    asyncio.run(service.reply(ChatRequest(message="O que significa Housing?")))

    assert tool.fallback_query == "O que significa Housing?"


def test_bloqueia_segunda_chamada_de_ferramenta() -> None:
    service, _, _ = make_service(
        [pedido_de_ferramenta(), pedido_de_ferramenta("outra busca")],
        encontrado(),
    )

    response = asyncio.run(service.reply(ChatRequest(message="O que é Blower Direction?")))

    assert response.action == ChatAction.INSUFFICIENT_DATA
    assert response.sources == []


def test_continua_bloqueando_ferramenta_nao_registrada() -> None:
    service, _, _ = make_service(
        [
            {
                "action": "use_tool",
                "answer": "",
                "tool_name": "thermal_prediction",
                "tool_arguments": {"housing": "Closed"},
                "sources": [],
                "reason": "A pergunta exige previsão.",
            }
        ],
        encontrado(),
    )

    response = asyncio.run(service.reply(ChatRequest(message="Qual será a temperatura?")))

    assert response.action == ChatAction.INSUFFICIENT_DATA
    assert "não vou estimar nem inventar" in response.answer.lower()


def test_consulta_a_documentacao_mesmo_sem_o_modelo_pedir() -> None:
    """Modelo pequeno responde de cabeça sobre termos do projeto; aqui não."""

    resposta_de_cabeca = {
        "action": "answer",
        "answer": "O soprador pode ser Forward ou Reverse.",
        "tool_name": None,
        "tool_arguments": {},
        "sources": [],
        "reason": "Respondi com conhecimento geral.",
    }
    service, provider, tool = make_service(
        [resposta_de_cabeca, resposta_final(["glossario.md § 3.2. Blower Direction"])],
        encontrado(),
    )

    response = asyncio.run(service.reply(ChatRequest(message="O que é Blower Direction?")))

    assert response.action == ChatAction.ANSWER
    assert response.tool_name is ToolName.DOCUMENTATION_SEARCH
    assert response.sources == ["glossario.md § 3.2. Blower Direction"]
    assert "Forward ou Reverse" not in response.answer
    assert tool.fallback_query == "O que é Blower Direction?"
    assert len(provider.calls) == 2


def test_pergunta_fora_do_corpus_mantem_a_resposta_direta() -> None:
    resposta_conceitual = {
        "action": "answer",
        "answer": "Margem térmica é a distância até o limite admissível.",
        "tool_name": None,
        "tool_arguments": {},
        "sources": [],
        "reason": "Conceito geral.",
    }
    service, provider, _ = make_service(
        [resposta_conceitual],
        ToolResult(found=False, context="", detail="Nada relevante indexado."),
    )

    response = asyncio.run(service.reply(ChatRequest(message="O que é margem térmica?")))

    assert response.action == ChatAction.ANSWER
    assert response.answer == "Margem térmica é a distância até o limite admissível."
    assert response.sources == []
    assert len(provider.calls) == 1


def test_busca_automatica_pode_ser_desligada() -> None:
    resposta_de_cabeca = {
        "action": "answer",
        "answer": "Resposta direta do modelo.",
        "tool_name": None,
        "tool_arguments": {},
        "sources": [],
        "reason": "Conhecimento geral.",
    }
    provider = ScriptedProvider([resposta_de_cabeca])
    tool = FakeDocumentationTool(encontrado())
    service = ChatbotService(
        provider,
        model_name="test-model",
        available_tools={tool.name: tool},
        always_retrieve=False,
    )

    response = asyncio.run(service.reply(ChatRequest(message="O que é Blower Direction?")))

    assert response.answer == "Resposta direta do modelo."
    assert tool.arguments is None
