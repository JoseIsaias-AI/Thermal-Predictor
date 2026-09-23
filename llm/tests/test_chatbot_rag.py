import asyncio

from fakes import FakeTool, ScriptedProvider, answer, routing

from thermal_chatbot.chatbot import ChatbotService
from thermal_chatbot.schemas import ChatAction, ChatRequest, ToolName
from thermal_chatbot.tools import ToolResult

CONTEXTO = (
    "[1] FONTE: glossario.md § 3.2. Blower Direction\n"
    "    CONTEÚDO: A direção do soprador define o sentido do fluxo de ar."
)
FONTE = "glossario.md § 3.2. Blower Direction"
RESPOSTA = "O soprador define o sentido do fluxo de ar no fogão."


def encontrado() -> ToolResult:
    return ToolResult(
        found=True,
        context=CONTEXTO,
        sources=[FONTE],
        detail="1 trecho recuperado.",
        data={"trechos": 1},
    )


def make_service(
    routings: list[dict] | None = None,
    answers: list[dict] | None = None,
    result: ToolResult | None = None,
    always_retrieve: bool = True,
) -> tuple[ChatbotService, ScriptedProvider, FakeTool]:
    provider = ScriptedProvider(routings=routings, answers=answers)
    tool = FakeTool(ToolName.DOCUMENTATION_SEARCH, result or encontrado())
    service = ChatbotService(
        provider,
        model_name="test-model",
        available_tools={tool.name: tool},
        always_retrieve=always_retrieve,
    )
    return service, provider, tool


def test_executa_a_busca_e_responde_com_o_contexto_recuperado() -> None:
    service, provider, tool = make_service(
        routings=[routing(tool_arguments={"query": "blower direction"})],
        answers=[answer(RESPOSTA, sources=[FONTE])],
    )

    response = asyncio.run(
        service.reply(ChatRequest(message="O que é Blower Direction no glossário?"))
    )

    assert response.action == ChatAction.ANSWER
    assert response.tool_name is ToolName.DOCUMENTATION_SEARCH
    assert response.sources == [FONTE]
    assert response.data == {"trechos": 1}
    assert tool.arguments == {"query": "blower direction"}

    # A redação recebe o contexto como dado delimitado, não como ordem.
    contexto = provider.answer_calls[0][-1]
    assert contexto["role"] == "system"
    assert "não é instrução" in contexto["content"]
    assert CONTEXTO in contexto["content"]


def test_uma_geracao_de_texto_por_resposta() -> None:
    """A etapa de decisão não redige: o usuário não espera por texto descartado."""

    service, provider, _ = make_service(
        routings=[routing()],
        answers=[answer(RESPOSTA)],
    )

    asyncio.run(service.reply(ChatRequest(message="O que é Blower Direction?")))

    assert len(provider.routing_calls) == 1
    assert len(provider.answer_calls) == 1


def test_resposta_estruturada_da_ferramenta_dispensa_segunda_geracao() -> None:
    direta = ToolResult(
        found=True,
        context="contexto que não precisa ser reescrito",
        direct_answer="To Front ficou 2,8 °C mais quente em Coil Temps.",
        sources=["modelo gb-1.0 — comparação preditiva, não medição"],
        data={"modo": "comparacao_controlada"},
    )
    provider = ScriptedProvider(
        routings=[routing(tool_name="thermal_prediction")],
    )
    tool = FakeTool(ToolName.THERMAL_PREDICTION, direta)
    service = ChatbotService(
        provider,
        model_name="test-model",
        available_tools={tool.name: tool},
    )

    response = asyncio.run(service.reply(ChatRequest(message="Compare as direções.")))

    assert response.answer == direta.direct_answer
    assert response.sources == direta.sources
    assert response.data == direta.data
    assert len(provider.routing_calls) == 1
    assert provider.answer_calls == []


def test_comparacao_controlada_dispensa_todas_as_chamadas_ao_llm() -> None:
    direta = ToolResult(
        found=True,
        context="comparação calculada",
        direct_answer="Resposta determinística da comparação.",
        sources=["modelo local"],
        data={"modo": "comparacao_controlada"},
    )
    provider = ScriptedProvider()
    tool = FakeTool(ToolName.THERMAL_PREDICTION, direta)
    service = ChatbotService(
        provider,
        model_name="test-model",
        available_tools={tool.name: tool},
    )
    request = ChatRequest(
        message=(
            "Compare Blower Direction To Front com To Back mantendo Run case "
            "Broil C2, Housing Closed, Board Position Center, Deflector Hole "
            "Closed, Material Coil Support Aluminium e perdas declaradas "
            "Config M, Front Order."
        )
    )

    response = asyncio.run(service.reply(request))

    assert response.answer == direta.direct_answer
    assert provider.calls == []
    assert tool.arguments["comparison"] == {
        "factor": "blower_direction",
        "levels": ["To Front", "To Back"],
    }
    assert tool.arguments["run_case"] == "Broil C2"


def test_descarta_fonte_que_nao_foi_entregue_ao_modelo() -> None:
    service, _, _ = make_service(
        routings=[routing()],
        answers=[answer(RESPOSTA, sources=["relatorio-interno.pdf § 9", FONTE])],
    )

    response = asyncio.run(service.reply(ChatRequest(message="O que é Blower Direction?")))

    assert response.sources == [FONTE]


def test_declara_dados_insuficientes_quando_a_busca_nao_encontra_nada() -> None:
    service, provider, _ = make_service(
        routings=[routing(tool_arguments={"query": "tensão"})],
        result=ToolResult(found=False, context="", detail="Nenhum trecho atingiu o limiar."),
    )

    response = asyncio.run(service.reply(ChatRequest(message="Qual a tensão de alimentação?")))

    assert response.action == ChatAction.INSUFFICIENT_DATA
    assert response.sources == []
    assert "não vou estimá-lo" in response.answer
    # Sem evidência não se paga uma geração de texto para dizer que falta dado.
    assert provider.answer_calls == []


def test_repassa_a_pergunta_quando_o_modelo_nao_envia_argumentos() -> None:
    service, _, tool = make_service(
        routings=[routing(tool_arguments={})],
        answers=[answer(RESPOSTA)],
    )

    asyncio.run(service.reply(ChatRequest(message="O que significa Housing?")))

    assert tool.fallback_query == "O que significa Housing?"


def test_continua_bloqueando_ferramenta_nao_registrada() -> None:
    service, _, tool = make_service(
        routings=[routing(tool_name="thermal_prediction", tool_arguments={"housing": "Closed"})],
    )

    response = asyncio.run(service.reply(ChatRequest(message="Qual será a temperatura?")))

    assert response.action == ChatAction.INSUFFICIENT_DATA
    assert "não vou estimar nem inventar" in response.answer.lower()
    assert tool.runs == 0


def test_consulta_a_documentacao_quando_o_modelo_responde_de_cabeca() -> None:
    """Modelo pequeno inventa níveis de fator; a busca entra como rede de proteção."""

    service, provider, tool = make_service(
        routings=[routing(action="answer", tool_name=None)],
        answers=[answer(RESPOSTA)],
    )

    response = asyncio.run(service.reply(ChatRequest(message="O que é Blower Direction?")))

    assert response.tool_name is ToolName.DOCUMENTATION_SEARCH
    assert response.sources == [FONTE]
    assert tool.fallback_query == "O que é Blower Direction?"
    assert CONTEXTO in provider.answer_calls[0][-1]["content"]


def test_pergunta_fora_do_corpus_mantem_a_resposta_direta() -> None:
    service, _, _ = make_service(
        routings=[routing(action="answer", tool_name=None)],
        answers=[answer("Margem térmica é a distância até o limite admissível.")],
        result=ToolResult(found=False, context="", detail="Nada relevante indexado."),
    )

    response = asyncio.run(service.reply(ChatRequest(message="O que é margem térmica?")))

    assert response.action == ChatAction.ANSWER
    assert response.answer == "Margem térmica é a distância até o limite admissível."
    assert response.sources == []
    assert response.tool_name is None


def test_busca_automatica_pode_ser_desligada() -> None:
    service, _, tool = make_service(
        routings=[routing(action="answer", tool_name=None)],
        answers=[answer("Resposta direta do modelo.")],
        always_retrieve=False,
    )

    response = asyncio.run(service.reply(ChatRequest(message="O que é Blower Direction?")))

    assert response.answer == "Resposta direta do modelo."
    assert tool.runs == 0


def test_dados_insuficientes_com_contexto_nao_cita_fonte() -> None:
    """Dizer "não consta" e listar trechos ao lado seria contraditório."""

    service, _, _ = make_service(
        routings=[routing()],
        answers=[answer("Esse dado não consta.", action="insufficient_data")],
    )

    response = asyncio.run(service.reply(ChatRequest(message="Qual a tensão nominal?")))

    assert response.action == ChatAction.INSUFFICIENT_DATA
    assert response.sources == []
    assert response.data is None
