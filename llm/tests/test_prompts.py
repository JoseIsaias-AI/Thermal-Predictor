from thermal_chatbot.prompts import build_system_prompt
from thermal_chatbot.schemas import ToolName


def test_prompt_defines_scope_safety_and_simplification() -> None:
    prompt = build_system_prompt([])

    assert "triagem preliminar" in prompt
    assert "Nunca apresente uma previsão" in prompt
    assert "Simplifique explicações" in prompt
    assert "não invente" in prompt.lower()
    assert "informação interna e confidencial" in prompt
    assert "Recuse pedidos para aprovar" in prompt
    assert "validação formal" in prompt


def test_prompt_reports_real_tool_availability() -> None:
    prompt = build_system_prompt([ToolName.DOCUMENTATION_SEARCH])

    assert "documentation_search: DISPONÍVEL" in prompt
    assert "dataset_query: INDISPONÍVEL" in prompt
    assert "thermal_prediction: INDISPONÍVEL" in prompt
