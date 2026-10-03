import pytest

from thermal_chatbot.schemas import ToolName
from thermal_chatbot.triage.smalltalk import (
    COMPLIMENT_ANSWER,
    FAREWELL_ANSWER,
    GREETING_ANSWER,
    NAME_ANSWER,
    SEM_FONTES,
    THANKS_ANSWER,
    help_answer,
    smalltalk_answer,
)

TODAS_AS_FONTES = (
    ToolName.DOCUMENTATION_SEARCH,
    ToolName.DATASET_QUERY,
    ToolName.THERMAL_PREDICTION,
)


@pytest.mark.parametrize(
    "mensagem",
    [
        "Oi",
        "Oi, tudo bem?",
        "Olá!",
        "Bom dia",
        "Boa tarde, tudo bem?",
        "OLÁ, TUDO BEM ?",
        "e aí, beleza?",
        "Oi, tudo bem com você?",
    ],
)
def test_greeting_is_answered_locally(mensagem: str) -> None:
    assert smalltalk_answer(mensagem) == GREETING_ANSWER


def test_greeting_invites_the_question() -> None:
    assert GREETING_ANSWER.rstrip().endswith("Qual é a sua dúvida?")


@pytest.mark.parametrize(
    "mensagem",
    [
        "Obrigado!",
        "muito obrigado pela ajuda",
        "valeu",
        "vlw, obrigado mesmo",
    ],
)
def test_thanks_is_answered_locally(mensagem: str) -> None:
    assert smalltalk_answer(mensagem) == THANKS_ANSWER


@pytest.mark.parametrize(
    "mensagem",
    [
        "Oi, lindão!",
        "Olá, Robertão, você é muito inteligente",
        "Você é incrível!",
    ],
)
def test_compliment_is_answered_locally(mensagem: str) -> None:
    assert smalltalk_answer(mensagem) == COMPLIMENT_ANSWER


@pytest.mark.parametrize(
    "mensagem",
    ["Tchau", "até mais", "falou, até logo", "Até amanhã!"],
)
def test_farewell_is_answered_locally(mensagem: str) -> None:
    assert smalltalk_answer(mensagem) == FAREWELL_ANSWER


@pytest.mark.parametrize(
    "mensagem",
    [
        "O que você faz?",
        "o que vc pode fazer",
        "Oi, o que você faz?",
        "Bom dia, como você pode me ajudar?",
        "para que você serve",
        "me ajuda",
    ],
)
def test_capability_question_is_answered_locally(mensagem: str) -> None:
    assert smalltalk_answer(mensagem, TODAS_AS_FONTES) == help_answer(TODAS_AS_FONTES)


@pytest.mark.parametrize(
    "mensagem",
    [
        "Oi, o que é Blower Direction?",
        "Bom dia, qual a temperatura medida no TC1?",
        "Olá, compare Blower Direction To Front com To Back",
        "tudo bem com a margem térmica desse ponto?",
        "Obrigado, e sobre o Housing Closed?",
        "Explique o que é margem térmica",
        "até que temperatura o ponto é aprovado?",
        "como funciona o preditor?",
        "Oi, lindão, o que é Blower Direction?",
    ],
)
def test_question_with_content_is_not_treated_as_courtesy(mensagem: str) -> None:
    assert smalltalk_answer(mensagem, TODAS_AS_FONTES) is None


def test_long_message_is_not_courtesy() -> None:
    mensagem = "oi " * 100
    assert smalltalk_answer(mensagem) is None


def test_help_lists_only_connected_sources() -> None:
    resposta = help_answer((ToolName.DOCUMENTATION_SEARCH,))

    assert "documentação autorizada" in resposta
    assert "medidas em ensaio" not in resposta
    assert "modelos treinados" not in resposta


def test_help_without_sources_does_not_promise_project_data() -> None:
    assert help_answer(()) == SEM_FONTES


def test_help_keeps_the_preliminary_screening_caveat() -> None:
    resposta = help_answer(TODAS_AS_FONTES)

    assert "triagem preliminar" in resposta
    assert "validação de engenharia" in resposta


def test_o_agente_se_apresenta_pelo_nome() -> None:
    assert "Robertão" in GREETING_ANSWER
    assert "Robertão" in NAME_ANSWER
    assert "Robertão" in help_answer(TODAS_AS_FONTES)
    assert "Robertão" in help_answer(())


@pytest.mark.parametrize(
    "mensagem",
    [
        "qual é o seu nome?",
        "como você se chama?",
        "quem é você?",
        "Oi, qual o seu nome?",
    ],
)
def test_pergunta_de_identidade_responde_o_nome_sem_a_lista_inteira(
    mensagem: str,
) -> None:
    """Quem pergunta o nome quer o nome, não o catálogo de capacidades."""

    assert smalltalk_answer(mensagem, TODAS_AS_FONTES) == NAME_ANSWER
