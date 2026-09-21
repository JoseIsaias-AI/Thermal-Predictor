import asyncio

import pytest
from fakes import ScriptedProvider, answer, routing

from thermal_chatbot.chatbot import ChatbotService
from thermal_chatbot.providers.base import ProviderResponseError
from thermal_chatbot.schemas import ChatAction, ChatRequest


def test_returns_direct_answer_and_sends_system_prompt() -> None:
    provider = ScriptedProvider(
        routings=[routing(action="answer", tool_name=None)],
        answers=[answer("É uma etapa preliminar de análise.", sources=["fonte-inventada"])],
    )
    service = ChatbotService(provider, model_name="test-model")

    response = asyncio.run(service.reply(ChatRequest(message="O que é triagem?")))

    assert response.action == ChatAction.ANSWER
    assert response.model == "test-model"
    assert response.tool_name is None
    # Nenhuma fonte foi entregue ao modelo: a citação dele não é verificável.
    assert response.sources == []
    assert "triagem" in provider.calls[0][0]["content"].lower()
    assert provider.calls[0][-1]["content"] == "O que é triagem?"


def test_fails_closed_when_model_requests_unavailable_tool() -> None:
    provider = ScriptedProvider(
        routings=[routing(tool_name="thermal_prediction", tool_arguments={"housing": "metal"})]
    )
    service = ChatbotService(provider, model_name="test-model")

    response = asyncio.run(
        service.reply(ChatRequest(message="Qual será a temperatura?"))
    )

    assert response.action == ChatAction.INSUFFICIENT_DATA
    assert "não vou estimar nem inventar" in response.answer.lower()
    # A recusa é decidida em código: não custa uma geração de texto.
    assert provider.answer_calls == []


def test_keeps_history_between_system_prompt_and_current_message() -> None:
    provider = ScriptedProvider(
        routings=[routing(action="answer", tool_name=None)],
        answers=[answer("Resposta contextual.")],
    )
    service = ChatbotService(provider, model_name="test-model")
    request = ChatRequest(
        message="Pode explicar melhor?",
        history=[
            {"role": "user", "content": "O que é margem térmica?"},
            {"role": "assistant", "content": "É a distância até o limite."},
        ],
    )

    asyncio.run(service.reply(request))

    assert [message["role"] for message in provider.calls[0]] == [
        "system",
        "user",
        "assistant",
        "user",
    ]


def test_rejects_model_response_outside_contract() -> None:
    provider = ScriptedProvider(
        routings=[routing(action="answer", tool_name=None)],
        answers=[answer("")],
    )
    service = ChatbotService(provider, model_name="test-model")

    with pytest.raises(ProviderResponseError):
        asyncio.run(service.reply(ChatRequest(message="Responda sem conteúdo")))


def test_routing_stage_never_offers_a_text_field() -> None:
    """Redigir na etapa de decisão gastaria tokens que seriam descartados."""

    provider = ScriptedProvider(
        routings=[routing(action="answer", tool_name=None)],
        answers=[answer("Resposta.")],
    )
    service = ChatbotService(provider, model_name="test-model")

    asyncio.run(service.reply(ChatRequest(message="Olá")))

    assert len(provider.routing_calls) == 1
    assert len(provider.answer_calls) == 1


def test_motivo_longo_nao_invalida_a_decisao() -> None:
    """A gramática do Ollama não limita tamanho de string; o contrato também não
    pode derrubar uma decisão boa por causa de um campo de auditoria prolixo."""

    provider = ScriptedProvider(
        routings=[routing(action="answer", tool_name=None, reason="motivo " * 200)],
        answers=[answer("Resposta.")],
    )
    service = ChatbotService(provider, model_name="test-model")

    response = asyncio.run(service.reply(ChatRequest(message="Olá")))

    assert response.action == ChatAction.ANSWER


def test_decisao_sem_motivo_continua_valida() -> None:
    provider = ScriptedProvider(
        routings=[{"action": "answer", "tool_name": None, "tool_arguments": {}}],
        answers=[answer("Resposta.")],
    )
    service = ChatbotService(provider, model_name="test-model")

    assert asyncio.run(service.reply(ChatRequest(message="Olá"))).action == ChatAction.ANSWER


def test_recorta_historico_longo_preservando_o_prompt_de_sistema() -> None:
    """Histórico grande empurraria o prompt de sistema para fora do contexto."""

    provider = ScriptedProvider(
        routings=[routing(action="answer", tool_name=None)],
        answers=[answer("Resposta.")],
    )
    service = ChatbotService(provider, model_name="test-model")
    request = ChatRequest(
        message="E agora?",
        history=[
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"mensagem {i} " * 100}
            for i in range(20)
        ],
    )

    asyncio.run(service.reply(request))

    enviadas = provider.calls[0]
    assert enviadas[0]["role"] == "system"
    assert "ESCOPO" in enviadas[0]["content"]
    assert enviadas[-1]["content"] == "E agora?"
    # Sobram poucas trocas, e são as mais recentes.
    historico = enviadas[1:-1]
    assert len(historico) < 20
    assert "mensagem 19" in historico[-1]["content"]
