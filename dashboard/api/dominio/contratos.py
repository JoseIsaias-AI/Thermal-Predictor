"""Modelos de resposta dos endpoints, que também geram o OpenAPI."""

from pydantic import BaseModel, Field


class NivelFator(BaseModel):
    valor: str = Field(description="Valor aceito na requisição.")
    rotulo: str = Field(description="Rótulo exibido ao usuário.")


class SubcampoFator(BaseModel):
    chave: str
    rotulo: str
    coluna_origem: str = Field(description="Coluna correspondente na base de treino.")
    ajuda: str
    tipo: str
    obrigatorio: bool
    depende_de: dict | None = Field(
        default=None, description="Campo e valor que tornam este subcampo aplicável."
    )
    niveis: list[NivelFator]


class Fator(BaseModel):
    chave: str
    rotulo: str
    coluna_origem: str
    ajuda: str
    tipo: str = Field(description="`categorico` ou `composto`.")
    obrigatorio: bool
    nivel_de_referencia: str | None = Field(
        default=None, description="Nível cujo bloco fica em zero na codificação."
    )
    niveis: list[NivelFator]
    subcampos: list[SubcampoFator] | None = None


class Regra(BaseModel):
    codigo: str
    descricao: str


class SubsistemaEsquema(BaseModel):
    area: str
    pontos_de_medicao: int


class RespostaSchema(BaseModel):
    """Contrato de entrada esperado pela camada de predição."""

    versao: str
    origem: str
    descricao: str
    fatores: list[Fator]
    sinonimos: dict[str, str] = Field(description="Valores tratados como equivalentes no treino.")
    regras: list[Regra]
    subsistemas: list[SubsistemaEsquema]
    exemplo_de_entrada: dict


class SubsistemaSaude(BaseModel):
    subsistema: str
    estado: str = Field(description="`carregado` ou `indisponivel`.")
    familia: str | None = None
    versao: str | None = None
    motivo: str | None = None


class ResumoModelosSaude(BaseModel):
    familia_ativa: str | None
    esperados: int
    carregados: int


class RespostaSaude(BaseModel):
    status: str = Field(description="`ok`, `degradado` ou `sem_modelo`.")
    versao_api: str
    verificado_em: str = Field(description="Instante da verificação, em UTC ISO-8601.")
    esquema_features: dict
    modelos: ResumoModelosSaude
    subsistemas: list[SubsistemaSaude]


class MetricasModelo(BaseModel):
    """Desempenho de validação já documentado, sem nada do artefato treinado."""

    mae_c: float | None = None
    rmse_c: float | None = None
    r2: float | None = None
    acerto_5c_pct: float | None = None
    acerto_10c_pct: float | None = None
    mae_sobre_amplitude_pct: float | None = None


class CandidatoModelo(BaseModel):
    familia: str
    rotulo: str
    algoritmo: str | None = None
    versao: str | None = None
    validado: bool | None = None
    artefato_disponivel: bool
    termopares_cobertos: int
    metricas: MetricasModelo | None = None


class ModeloPublicado(BaseModel):
    subsistema: str
    identificador: str
    estado: str
    motivo: str | None = None
    familia: str | None = None
    algoritmo: str | None = None
    versao: str | None = None
    commit_treino: str | None = None
    validado: bool | None = None
    observacao: str | None = None
    termopares_cobertos: int
    metricas: MetricasModelo | None = None
    candidatos: list[CandidatoModelo]


class RespostaModelos(BaseModel):
    familia_ativa: str | None
    familias_disponiveis: list[str]
    tipos_de_preditor_suportados: list[str]
    total_subsistemas: int
    modelos: list[ModeloPublicado]
