from thermal_chatbot.triage.intents import fast_comparison_arguments


COMPLETE_MESSAGE = (
    "Compare Blower Direction To Front com To Back mantendo: Run case Broil C2, "
    "Housing Closed, Board Position Center, Deflector Hole Closed, Material Coil "
    "Support Aluminium e perdas declaradas Config M, Front Order."
)


def test_extracts_complete_controlled_comparison() -> None:
    arguments = fast_comparison_arguments(COMPLETE_MESSAGE)

    assert arguments == {
        "mode": "compare",
        "comparison": {
            "factor": "blower_direction",
            "levels": ["To Front", "To Back"],
        },
        "run_case": "Broil C2",
        "housing": "Closed",
        "board_position": "Center",
        "deflector_hole": "Closed",
        "material_coil_support": "Aluminium",
        "losses": {
            "present": "declared",
            "config": "Config M",
            "order": "Front Order",
        },
    }


def test_incomplete_comparison_is_returned_without_inventing_configuration() -> None:
    arguments = fast_comparison_arguments(
        "Se eu mudar Blower Direction de To Back para To Front, aumenta ou diminui?"
    )

    assert arguments == {
        "mode": "compare",
        "comparison": {
            "factor": "blower_direction",
            "levels": ["To Front", "To Back"],
        },
    }


def test_free_question_falls_back_to_llm() -> None:
    assert fast_comparison_arguments("Explique o que é margem térmica") is None


def test_ambiguous_comparison_falls_back_to_llm() -> None:
    assert fast_comparison_arguments("Qual direção do blower é melhor?") is None


def test_does_not_borrow_level_from_neighboring_factor() -> None:
    arguments = fast_comparison_arguments(
        "Compare Blower Direction To Front com To Back, Housing, "
        "Deflector Hole Closed."
    )

    assert "housing" not in arguments
    assert arguments["deflector_hole"] == "Closed"


def test_structured_frontend_request_has_priority() -> None:
    arguments = fast_comparison_arguments(
        "Compare os cenários selecionados",
        configuration={"run_case": "Pyro", "losses": {"present": "none"}},
        comparison={
            "factor": "blower_direction",
            "levels": ("To Front", "To Back"),
        },
    )

    assert arguments == {
        "run_case": "Pyro",
        "losses": {"present": "none"},
        "mode": "compare",
        "comparison": {
            "factor": "blower_direction",
            "levels": ("To Front", "To Back"),
        },
    }
