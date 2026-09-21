import pytest

from thermal_chatbot.triage.factors import (
    ConfigurationError,
    accepted_levels,
    encode,
    parse_configuration,
)

# Ordem exata das 13 colunas exportadas com os modelos treinados.
COLUNAS = [
    "losses_present_missing",
    "losses_config_m",
    "losses_order_back_order",
    "losses_order_front_order",
    "Run_Case_Broil C1",
    "Run_Case_Broil C2",
    "Run_Case_Pyro",
    "Blower_Direction_To Back",
    "Housing_Open",
    "Board_Position_Right",
    "Deflector_Hole_Open",
    "Material_Coil_Support_Aluminium Plate",
    "Material_Coil_Support_Plastic",
]

BASE = {
    "run_case": "Broil C2",
    "blower_direction": "To Front",
    "housing": "Closed",
    "board_position": "Center",
    "deflector_hole": "Closed",
    "material_coil_support": "Aluminium",
    "losses": {"present": "declared", "config": "Config S", "order": "Front Order"},
}


def vetor(**alteracoes) -> list[float]:
    return encode(parse_configuration({**BASE, **alteracoes}), COLUNAS)


def test_categoria_de_referencia_fica_toda_em_zero() -> None:
    """Broil Qualitative, To Front, Closed, Center, Closed, Aluminium e Config S."""

    configuracao = {
        **BASE,
        "run_case": "Broil Qualitative",
        "losses": {"present": "declared", "config": "Config S", "order": None},
    }

    assert encode(parse_configuration(configuracao), COLUNAS) == [0.0] * 13


def test_cada_fator_ativa_apenas_a_propria_coluna() -> None:
    assert vetor(run_case="Pyro")[COLUNAS.index("Run_Case_Pyro")] == 1.0
    assert vetor(blower_direction="To Back")[COLUNAS.index("Blower_Direction_To Back")] == 1.0
    assert vetor(housing="Open")[COLUNAS.index("Housing_Open")] == 1.0
    assert vetor(board_position="Right")[COLUNAS.index("Board_Position_Right")] == 1.0
    assert vetor(deflector_hole="Open")[COLUNAS.index("Deflector_Hole_Open")] == 1.0
    assert vetor(material_coil_support="Plastic")[COLUNAS.index("Material_Coil_Support_Plastic")] == 1.0

    # Um fator alterado não pode acender coluna de outro bloco.
    assert sum(vetor(housing="Open")) == sum(vetor()) + 1


def test_open_updated_e_tratado_como_open() -> None:
    """As tabelas por área trataram "Open - Updated" como "Open"."""

    assert vetor(housing="Open - Updated") == vetor(housing="Open")


def test_perdas_declaradas_codificam_config_e_ordem() -> None:
    perdas = vetor(losses={"present": "declared", "config": "Config M", "order": "Back Order"})

    assert perdas[COLUNAS.index("losses_config_m")] == 1.0
    assert perdas[COLUNAS.index("losses_order_back_order")] == 1.0
    assert perdas[COLUNAS.index("losses_order_front_order")] == 0.0
    assert perdas[COLUNAS.index("losses_present_missing")] == 0.0


def test_perdas_nao_declaradas_acendem_a_coluna_missing() -> None:
    assert vetor(losses={"present": "missing"})[COLUNAS.index("losses_present_missing")] == 1.0


def test_sem_perdas_so_existe_em_pyro() -> None:
    """Confundimento declarado: 'sem perda' e Pyro são a mesma coluna."""

    with pytest.raises(ConfigurationError, match="só ocorre em"):
        parse_configuration({**BASE, "losses": {"present": "none"}})

    configuracao = parse_configuration(
        {**BASE, "run_case": "Pyro", "losses": {"present": "none"}}
    )
    assert configuracao.losses_present == "none"


def test_recusa_nivel_fora_do_vocabulario_dizendo_os_aceitos() -> None:
    with pytest.raises(ConfigurationError) as erro:
        parse_configuration({**BASE, "run_case": "Broil C3"})

    assert "run_case" in str(erro.value)
    assert "Broil Qualitative" in str(erro.value)


def test_recusa_configuracao_incompleta_nomeando_o_que_falta() -> None:
    with pytest.raises(ConfigurationError) as erro:
        parse_configuration({"run_case": "Pyro", "losses": {"present": "missing"}})

    mensagem = str(erro.value)
    assert "blower_direction" in mensagem
    assert "material_coil_support" in mensagem


def test_recusa_perdas_ausentes() -> None:
    incompleta = {chave: valor for chave, valor in BASE.items() if chave != "losses"}

    with pytest.raises(ConfigurationError, match="losses"):
        parse_configuration(incompleta)


def test_aceita_nivel_com_caixa_diferente() -> None:
    assert vetor(blower_direction="to back") == vetor(blower_direction="To Back")


def test_vocabulario_publicado_cobre_todos_os_fatores() -> None:
    aceitos = accepted_levels()

    assert aceitos["run_case"] == ["Broil Qualitative", "Broil C1", "Broil C2", "Pyro"]
    assert aceitos["losses.present"] == ["declared", "missing", "none"]
    assert "Config M" in aceitos["losses.config"]


def test_interpreta_perdas_descritas_em_texto_livre() -> None:
    """O modelo costuma repassar a frase inteira do usuário em losses.present."""

    configuracao = parse_configuration(
        {**BASE, "losses": {"present": "declaradas Config S Front Order"}}
    )

    assert configuracao.losses_present == "declared"
    assert configuracao.losses_config == "Config S"
    assert configuracao.losses_order == "Front Order"


def test_interpreta_perdas_como_texto_simples() -> None:
    configuracao = parse_configuration({**BASE, "losses": "Config M - Back Order"})

    assert (configuracao.losses_config, configuracao.losses_order) == ("Config M", "Back Order")


def test_interpreta_ausencia_de_perdas_em_texto() -> None:
    configuracao = parse_configuration(
        {**BASE, "run_case": "Pyro", "losses": {"present": "No losses"}}
    )

    assert configuracao.losses_present == "none"


def test_texto_sem_termo_reconhecivel_continua_recusado() -> None:
    with pytest.raises(ConfigurationError, match="losses.present"):
        parse_configuration({**BASE, "losses": {"present": "qualquer coisa"}})
