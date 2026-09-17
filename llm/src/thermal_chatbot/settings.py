"""Configuração centralizada do backend e do provedor local."""

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class Settings(BaseModel):
    """Configurações validadas após leitura do ambiente ou de ``.env``."""

    ollama_base_url: HttpUrl = "http://127.0.0.1:11434"
    ollama_model: str = Field(default="qwen3:4b", min_length=1)
    ollama_timeout_seconds: float = Field(default=180.0, gt=0, le=600)
    ollama_temperature: float = Field(default=0.1, ge=0, le=2)
    ollama_max_output_tokens: int = Field(default=768, ge=128, le=4_096)
    chatbot_allowed_origins: str = (
        "http://127.0.0.1:5500,http://localhost:5500"
    )

    model_config = ConfigDict(extra="forbid", validate_default=True)

    @classmethod
    def from_env(cls, env_file: str | Path = ".env") -> "Settings":
        """Carrega ``.env`` sem sobrescrever variáveis definidas no sistema."""

        file_values = _read_env_file(Path(env_file))

        def value(name: str) -> str | None:
            return os.environ.get(name, file_values.get(name))

        configured = {
            "ollama_base_url": value("OLLAMA_BASE_URL"),
            "ollama_model": value("OLLAMA_MODEL"),
            "ollama_timeout_seconds": value("OLLAMA_TIMEOUT_SECONDS"),
            "ollama_temperature": value("OLLAMA_TEMPERATURE"),
            "ollama_max_output_tokens": value("OLLAMA_MAX_OUTPUT_TOKENS"),
            "chatbot_allowed_origins": value("CHATBOT_ALLOWED_ORIGINS"),
        }
        return cls(**{key: item for key, item in configured.items() if item is not None})

    @property
    def allowed_origins(self) -> list[str]:
        """Converte a lista textual de origens em valores válidos para CORS."""

        return [
            origin.strip()
            for origin in self.chatbot_allowed_origins.split(",")
            if origin.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    """Retorna uma única instância de configuração por processo."""

    return Settings.from_env()


def _read_env_file(path: Path) -> dict[str, str]:
    """Lê pares ``CHAVE=valor``; sintaxes de shell não são executadas."""

    if not path.is_file():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw_value = line.split("=", maxsplit=1)
        values[key.strip()] = raw_value.strip().strip('"').strip("'")
    return values
