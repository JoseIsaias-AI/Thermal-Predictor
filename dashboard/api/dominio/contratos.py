"""Modelos de requisição e de resposta dos endpoints, que também geram o OpenAPI."""

from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from .esquema import carregar_esquema

# O exemplo do OpenAPI é o mesmo que /schema publica, para as duas documentações não divergirem.
EXEMPLO_DE_ENTRADA = carregar_esquema(str(Path(__file__).parent / "esquema_features.json"))[
    "exemplo_de_entrada"
]


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


class CatalogoPontosSaude(BaseModel):
    disponivel: bool = Field(description="Sem o catálogo, /predicao responde 503.")
    pontos: int = Field(description="Pontos de medição com área e limite carregados.")
    motivo: str | None = None


class RespostaSaude(BaseModel):
    status: str = Field(description="`ok`, `degradado` ou `sem_modelo`.")
    versao_api: str
    verificado_em: str = Field(description="Instante da verificação, em UTC ISO-8601.")
    esquema_features: dict
    modelos: ResumoModelosSaude
    subsistemas: list[SubsistemaSaude]
    catalogo_pontos: CatalogoPontosSaude


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


class ReferenciaDesempenho(BaseModel):
    estrategia: str = Field(description="A previsão sem modelo: a média histórica do ponto.")
    mae_teste_c: float
    mae_40_divisoes_c: float


class WilcoxonDesempenho(BaseModel):
    descricao: str
    pares: int
    estatistica: float
    p: float
    divisoes_em_que_o_modelo_erra_menos: int


class MetricasDesempenho(BaseModel):
    """Métricas de teste e das 40 divisões, de um dataset ou das seis áreas juntas."""

    mae_teste_c: float
    rmse_teste_c: float
    r2_teste: float
    pontos_aprovados: int
    pontos_com_limite: int
    aprovacao_teste_pct: float
    mae_40_divisoes_c: float
    aprovacao_mediana_40_divisoes_pct: float
    excedencias_teste: int
    sensibilidade_pct: float | None = Field(
        None, description="Sem excedência no teste isolado, a sensibilidade não é definida."
    )
    falsos_negativos: int
    falsos_positivos: int


class DesempenhoGlobal(MetricasDesempenho):
    aprovacao_teste_wilson_pct: list[float] = Field(description="Intervalo de Wilson a 95%.")
    divisoes: int
    divisoes_no_piso: int = Field(description="Divisões com aprovação de pelo menos o piso.")
    referencia: ReferenciaDesempenho
    wilcoxon: WilcoxonDesempenho


class DesempenhoDataset(BaseModel):
    dataset: str
    modelo_final: str | None = None
    validado: bool
    motivo: str | None = None
    mae_teste_c: float | None = None
    rmse_teste_c: float | None = None
    r2_teste: float | None = None
    pontos_aprovados: int | None = None
    pontos_com_limite: int | None = None
    aprovacao_teste_pct: float | None = None
    mae_40_divisoes_c: float | None = None
    aprovacao_mediana_40_divisoes_pct: float | None = None
    excedencias_teste: int | None = None
    sensibilidade_pct: float | None = None
    falsos_negativos: int | None = None
    falsos_positivos: int | None = None
    referencia_mae_teste_c: float | None = None
    referencia_mae_40_divisoes_c: float | None = None


class DesempenhoFaixa(BaseModel):
    faixa: str
    limite_min_c: float
    limite_max_c: float
    pontos: int
    aprovados: int
    aprovacao_pct: float | None = None
    mae_medio_c: float | None = None


class RespostaDesempenho(BaseModel):
    """Desempenho agregado do modelo final, sem nenhuma medição nem previsão por ponto."""

    versao_modelo: str
    origem: str
    observacao: str
    piso_aprovacao_pct: float
    tolerancia_fracao: float
    global_: DesempenhoGlobal = Field(alias="global")
    por_dataset: list[DesempenhoDataset]
    por_faixa_de_limite: list[DesempenhoFaixa]

    model_config = ConfigDict(populate_by_name=True)


class PerdasDaConfiguracao(BaseModel):
    """Bloco `losses`, decomposto em presença, arranjo e ordem das perdas (Seção 4.2.2d)."""

    model_config = ConfigDict(extra="forbid")

    present: str = Field(description="`declared`, `none` ou `missing`.")
    config: str | None = Field(
        default=None, description="Arranjo das bobinas; obrigatório com `present` = `declared`."
    )
    order: str | None = Field(
        default=None, description="Ordem de montagem; opcional, só com `present` = `declared`."
    )


class RequisicaoPredicao(BaseModel):
    """Configuração experimental a prever. Os níveis aceitos em cada campo estão em /schema."""

    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [EXEMPLO_DE_ENTRADA]})

    blower_direction: str = Field(description="Direção do soprador.")
    housing: str = Field(description="Estado do alojamento.")
    board_position: str = Field(description="Posição da placa.")
    run_case: str = Field(description="Caso de operação.")
    deflector_hole: str = Field(description="Abertura do defletor.")
    material_coil_support: str = Field(description="Material do suporte da bobina.")
    losses: PerdasDaConfiguracao


class PontoPrevisto(BaseModel):
    measurement_id: str
    TC_Name: str = Field(description="Termopar.")
    Key_Area: str = Field(description="Área do produto em que o termopar fica.")
    subsistema_modelo: str = Field(
        description=(
            "Subsistema cujo modelo previu este ponto, como em `modelos[].subsistema`. "
            "Não se deduz de `Key_Area`: a área `Main Vent Sys` é atendida por dois "
            "modelos (`Main Vent Sys` e `AC Blower Inlet`) e o modelo de "
            "`HMI / Knobs / Console` cobre duas áreas."
        )
    )
    temperatura_prevista_c: float
    limit_c: float | None = Field(description="Limite admissível; nulo sem limite declarado (RN-03).")
    is_monitor_only: bool
    margem_c: float | None = Field(description="Limite menos temperatura prevista, em °C.")
    margem_percentual: float | None = Field(description="Margem como fração do limite.")
    estado: str = Field(
        description=(
            "`acima_do_limite`, `banda_de_incerteza` ou `dentro_do_limite` (RN-01); "
            "`monitoramento` sem limite declarado (RN-03)."
        )
    )
    estado_rotulo: str


class ModeloUsado(BaseModel):
    subsistema: str
    familia: str | None = None
    algoritmo: str | None = None
    versao: str | None = None
    validado: bool | None = Field(
        default=None, description="Falso onde nenhum modelo foi validado, e o risco não é aferido."
    )
    termopares: int


class RespostaPredicao(BaseModel):
    """Temperatura prevista de cada componente, na forma que as telas do painel consomem."""

    versao_modelo: str
    preditor_e_stub: bool = Field(description="Sempre falso: os números saem do modelo treinado.")
    configuracao: dict = Field(description="Configuração avaliada, como foi recebida.")
    tolerancia_fracao: float = Field(description="Fração do limite que define a banda de incerteza.")
    total_pontos: int
    total_classificados: int
    total_monitoramento: int
    pontos: list[PontoPrevisto] = Field(
        description="Pontos com limite, do mais crítico ao menos: estado, depois folga."
    )
    monitoramento: list[PontoPrevisto] = Field(description="Pontos sem limite declarado.")
    modelos: list[ModeloUsado] = Field(description="Modelo que previu cada subsistema.")


class CampoInvalido(BaseModel):
    campo: str = Field(description="Caminho do campo, como `losses.config`.")
    mensagem: str


class DetalheDoErro(BaseModel):
    erro: str = Field(
        description=(
            "`configuracao_invalida`, `modelo_indisponivel`, `catalogo_indisponivel`, "
            "`desempenho_indisponivel` ou `falha_na_inferencia`."
        )
    )
    mensagem: str = Field(description="Explicação em português, pronta para exibir.")
    campos: list[CampoInvalido] = Field(default_factory=list)


class RespostaDeErro(BaseModel):
    detail: DetalheDoErro
