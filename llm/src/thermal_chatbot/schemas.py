"""Contratos de entrada, decisão interna e resposta da API."""

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ChatAction(StrEnum):
    ANSWER = "answer"
    USE_TOOL = "use_tool"
    INSUFFICIENT_DATA = "insufficient_data"


class ToolName(StrEnum):
    DOCUMENTATION_SEARCH = "documentation_search"
    DATASET_QUERY = "dataset_query"
    THERMAL_PREDICTION = "thermal_prediction"


class ConversationMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8_000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=8_000)
    history: list[ConversationMessage] = Field(default_factory=list, max_length=20)


class ChatDecision(BaseModel):
    """Saída estruturada exigida do modelo antes de responder ao cliente."""

    model_config = ConfigDict(extra="forbid")

    action: ChatAction
    answer: str = Field(max_length=12_000)
    tool_name: ToolName | None
    tool_arguments: dict[str, Any]
    sources: list[str] = Field(max_length=10)
    reason: str = Field(min_length=1, max_length=1_000)

    @model_validator(mode="after")
    def validate_action_fields(self) -> "ChatDecision":
        if self.action == ChatAction.USE_TOOL and self.tool_name is None:
            raise ValueError("tool_name é obrigatório quando action=use_tool")
        if self.action != ChatAction.USE_TOOL and not self.answer.strip():
            raise ValueError("answer é obrigatório para a ação selecionada")
        return self


class ChatResponse(BaseModel):
    answer: str
    action: ChatAction
    model: str
    tool_name: ToolName | None = None
    sources: list[str] = Field(default_factory=list)


class SourceStatus(BaseModel):
    """Disponibilidade de uma fonte conectada, exposta no endpoint de saúde."""

    name: ToolName
    ready: bool
    detail: str


class HealthResponse(BaseModel):
    status: Literal["ready", "degraded"]
    provider: Literal["ollama"] = "ollama"
    model: str
    detail: str
    sources: list[SourceStatus] = Field(default_factory=list)
