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


def test_prompt_declares_arguments_of_each_source() -> None:
    prompt = build_system_prompt(list(ToolName))

    assert all(f"{ferramenta.value}: DISPONÍVEL" in prompt for ferramenta in ToolName)
    assert '"query"' in prompt
    assert '"tc_name"' in prompt
    assert '"losses"' in prompt


def test_prompt_forbids_the_model_from_producing_temperatures() -> None:
    prompt = build_system_prompt(list(ToolName))

    assert "Nunca calcule, estime ou complete uma temperatura" in prompt
    assert "dataset_query ou de thermal_prediction" in prompt


def test_prompt_routes_controlled_comparisons_to_predictor() -> None:
    prompt = build_system_prompt(list(ToolName))

    assert 'mode="compare"' in prompt
    assert '"levels": [nivel_a, nivel_b]' in prompt
    assert "Não use médias de rodadas" in prompt
    assert "não prova" in prompt
