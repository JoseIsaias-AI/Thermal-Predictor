from pathlib import Path

from thermal_chatbot.settings import Settings


def test_loads_configuration_from_env_file(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "OLLAMA_MODEL=modelo-local\nOLLAMA_TIMEOUT_SECONDS=45\n",
        encoding="utf-8",
    )

    settings = Settings.from_env(env_file)

    assert settings.ollama_model == "modelo-local"
    assert settings.ollama_timeout_seconds == 45


def test_system_environment_overrides_env_file(
    tmp_path: Path,
    monkeypatch,
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("OLLAMA_MODEL=modelo-do-arquivo\n", encoding="utf-8")
    monkeypatch.setenv("OLLAMA_MODEL", "modelo-do-sistema")

    settings = Settings.from_env(env_file)

    assert settings.ollama_model == "modelo-do-sistema"
