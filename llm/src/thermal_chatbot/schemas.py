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


class ComparisonInput(BaseModel):
    """Comparação estruturada enviada pelo frontend quando disponível."""

    model_config = ConfigDict(extra="forbid")

    factor: str = Field(min_length=1, max_length=100)
    levels: tuple[str, str]


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=8_000)
    history: list[ConversationMessage] = Field(default_factory=list, max_length=20)
    configuration: dict[str, Any] | None = None
    comparison: ComparisonInput | None = None


class RoutingDecision(BaseModel):
    """Primeira etapa: escolher a fonte, sem redigir resposta.

    O schema não tem campo de texto livre de propósito. O modelo roda em CPU a
    poucos tokens por segundo, e uma resposta escrita aqui seria descartada
    assim que a ferramenta fosse executada — o usuário pagaria por ela em
    tempo de espera sem nunca vê-la.

    Havia aqui um campo `reason`, para auditoria. Medido nesta máquina, ele
    custava 36 dos 55 tokens da etapa e 22 dos 27 segundos — e nada no código
    o lia. A decisão que interessa à auditoria (ação, ferramenta, argumentos)
    já está nos outros campos, sem gerar uma palavra a mais.
    """

    model_config = ConfigDict(extra="forbid")

    action: ChatAction
    tool_name: ToolName | None = None
    tool_arguments: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_action_fields(self) -> "RoutingDecision":
        if self.action == ChatAction.USE_TOOL and self.tool_name is None:
            raise ValueError("tool_name é obrigatório quando action=use_tool")
        return self


class AnswerDecision(BaseModel):
    """Segunda etapa: redigir a resposta, já com o contexto em mãos."""

    model_config = ConfigDict(extra="forbid")

    action: Literal[ChatAction.ANSWER, ChatAction.INSUFFICIENT_DATA]
    # Resposta vazia é inutilizável e precisa mesmo ser recusada. Já o excesso
    # de fontes é aparado depois, contra o que foi realmente entregue.
    answer: str = Field(min_length=1, max_length=12_000)
    sources: list[str] = Field(default_factory=list, max_length=50)


class ChatResponse(BaseModel):
    answer: str
    action: ChatAction
    model: str
    tool_name: ToolName | None = None
    sources: list[str] = Field(default_factory=list)
    # Resultado bruto da ferramenta, quando houver. O texto de `answer` passou
    # pelo modelo; este campo não. É por ele que o frontend deve exibir
    # temperatura medida ou prevista.
    data: dict[str, Any] | None = None


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
    # "cold" ainda não aqueceu, "warming" está avaliando o prompt de sistema,
    # "warm" já avaliou. Uma pergunta feita em "warming" espera na fila do
    # Ollama, e é isso que explica uma primeira resposta lenta.
    warm: Literal["cold", "warming", "warm"] = "cold"
