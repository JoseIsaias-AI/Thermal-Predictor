"""Ferramenta ``thermal_prediction``: executa os modelos treinados.

Sete modelos cobrem os termopares, um por conjunto. Cada um recebe as 13
colunas da configuração mais o código do termopar, exatamente na ordem
declarada no JSON exportado junto com o modelo.

Toda temperatura desta resposta sai de ``model.predict``. O LLM apenas
descreve o que a ferramenta devolveu.
"""

import asyncio
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import Any

from thermal_chatbot.schemas import ToolName
from thermal_chatbot.tools import Tool, ToolResult
from thermal_chatbot.triage.catalog import Dataset, DatasetUnavailableError
from thermal_chatbot.triage.factors import (
    Configuration,
    ConfigurationError,
    LEVELS,
    accepted_levels,
    encode,
    parse_configuration,
)

# RN-01: abaixo de 10% do limite a previsão entra em banda de incerteza, porque
# o erro do modelo é da mesma ordem da folga restante.
TOLERANCE_FRACTION = 0.10
MAX_POINTS_IN_CONTEXT = 10
COMPARISON_TOLERANCE_C = 0.01

STATE_LABELS = {
    "acima_do_limite": "Acima do limite",
    "banda_de_incerteza": "Banda de incerteza",
    "dentro_do_limite": "Dentro do limite",
    "monitoramento": "Monitoramento",
}


class ModelsUnavailableError(RuntimeError):
    """Os modelos treinados não estão acessíveis nesta execução."""


@dataclass(frozen=True)
class ModelBundle:
    """Um modelo treinado e o vocabulário que ele espera na entrada."""

    set_name: str
    version: str
    algorithm: str
    estimator: Any
    input_columns: list[str]
    code_by_thermocouple: dict[str, int]
    validation_metrics: dict[str, float]
    validated: bool
    note: str

    @property
    def mae_c(self) -> float | None:
        """Erro médio de validação, ou ``None`` quando o modelo não foi validado."""

        mae = self.validation_metrics.get("MAE (C)")
        return round(float(mae), 2) if isinstance(mae, (int, float)) else None


class ThermalPredictor:
    """Carrega os modelos exportados e prevê a temperatura de cada termopar."""

    def __init__(
        self,
        models_dir: Path,
        dataset: Dataset,
        loader: Callable[[Path], Any] | None = None,
    ) -> None:
        self.models_dir = models_dir
        self.dataset = dataset
        # O carregador é injetável para os testes rodarem sem sklearn instalado
        # e sem depender dos .joblib, que não são versionados.
        self._loader = loader

    @cached_property
    def bundles(self) -> list[ModelBundle]:
        if not self.models_dir.is_dir():
            raise ModelsUnavailableError(
                f"Diretório de modelos não encontrado: '{self.models_dir}'."
            )

        metadados = sorted(self.models_dir.glob("*.json"))
        if not metadados:
            raise ModelsUnavailableError(
                f"Nenhum modelo exportado em '{self.models_dir}'."
            )

        return [self._load_bundle(caminho) for caminho in metadados]

    @property
    def version(self) -> str:
        return self.bundles[0].version

    @property
    def algorithm(self) -> str:
        """Algoritmo único da família ou, no modelo final, o de cada conjunto."""

        algoritmos = {pacote.algorithm for pacote in self.bundles}
        if len(algoritmos) == 1:
            return algoritmos.pop()
        return "; ".join(f"{pacote.set_name}: {pacote.algorithm}" for pacote in self.bundles)

    def predict(self, configuration: Configuration) -> dict[str, Any]:
        """Prevê todos os termopares cobertos e classifica cada um por RN-01."""

        catalogo = self.dataset.points
        pontos: list[dict[str, Any]] = []
        monitoramento: list[dict[str, Any]] = []

        for bundle in self.bundles:
            base = encode(configuration, bundle.input_columns[:-1])
            termopares = list(bundle.code_by_thermocouple)
            entrada = [
                [*base, float(bundle.code_by_thermocouple[termopar])]
                for termopar in termopares
            ]
            temperaturas = bundle.estimator.predict(entrada)

            for termopar, temperatura in zip(termopares, temperaturas, strict=True):
                registro = _build_record(
                    termopar, float(temperatura), catalogo.get(termopar), bundle
                )
                destino = monitoramento if registro["estado"] == "monitoramento" else pontos
                destino.append(registro)

        pontos.sort(key=lambda registro: registro["margem_c"])

        return {
            "versao_modelo": self.version,
            "algoritmo": self.algorithm,
            "conjuntos_sem_validacao": sorted(
                pacote.set_name for pacote in self.bundles if not pacote.validated
            ),
            "configuracao": configuration.as_dict(),
            "tolerancia_fracao": TOLERANCE_FRACTION,
            "total_pontos": len(pontos) + len(monitoramento),
            "total_classificados": len(pontos),
            "total_monitoramento": len(monitoramento),
            "pontos": pontos,
            "monitoramento": monitoramento,
        }

    def status(self) -> tuple[bool, str]:
        try:
            pacotes = self.bundles
        except (ModelsUnavailableError, OSError, ValueError) as exc:
            return False, str(exc)
        except ImportError as exc:
            return False, (
                "Os modelos exigem scikit-learn compatível com a versão de "
                f"treino: {exc}"
            )

        pronto, detalhe = self.dataset.status()
        if not pronto:
            # Sem o catálogo não há limite para classificar a previsão.
            return False, f"Modelos carregados, mas o catálogo de limites falta: {detalhe}"

        termopares = sum(len(pacote.code_by_thermocouple) for pacote in pacotes)
        return True, (
            f"{len(pacotes)} modelos ({self.version}) cobrindo {termopares} termopares."
        )

    def _load_bundle(self, metadata_path: Path) -> ModelBundle:
        metadados = json.loads(metadata_path.read_text(encoding="utf-8"))
        caminho_modelo = metadata_path.with_suffix(".joblib")
        if not caminho_modelo.is_file():
            raise ModelsUnavailableError(
                f"Modelo ausente para '{metadata_path.name}': {caminho_modelo.name}."
            )

        return ModelBundle(
            set_name=metadados["conjunto"],
            version=metadados["versao"],
            algorithm=metadados["algoritmo"],
            estimator=self._load_estimator(caminho_modelo),
            input_columns=list(metadados["colunas_entrada"]),
            code_by_thermocouple=dict(metadados["codigo_por_termopar"]),
            validation_metrics=dict(metadados.get("metricas_validacao") or {}),
            validated=bool(metadados.get("validado", False)),
            note=str(metadados.get("observacao", "")),
        )

    def _load_estimator(self, path: Path) -> Any:
        if self._loader is not None:
            return self._loader(path)

        import joblib  # importado sob demanda: sklearn só é exigido em execução real

        return joblib.load(path)


class ThermalPredictionTool(Tool):
    """Valida a configuração, executa os modelos e devolve números verificáveis."""

    name = ToolName.THERMAL_PREDICTION

    def __init__(self, predictor: ThermalPredictor) -> None:
        self.predictor = predictor

    async def run(self, arguments: Mapping[str, Any], fallback_query: str) -> ToolResult:
        return await asyncio.to_thread(self._run_sync, arguments, fallback_query)

    async def status(self) -> tuple[bool, str]:
        return await asyncio.to_thread(self.predictor.status)

    def _run_sync(
        self,
        arguments: Mapping[str, Any],
        fallback_query: str = "",
    ) -> ToolResult:
        arguments = _discard_unstated_comparison_losses(arguments, fallback_query)
        if _is_comparison(arguments):
            return self._run_comparison(arguments)

        try:
            configuracao = parse_configuration(arguments)
        except ConfigurationError as exc:
            # Parâmetro faltando ou inválido não vira previsão aproximada.
            return ToolResult(
                found=False,
                context="",
                detail=str(exc),
                data={"erro": str(exc), "niveis_aceitos": accepted_levels()},
            )

        try:
            resultado = self.predictor.predict(configuracao)
        except (ModelsUnavailableError, DatasetUnavailableError) as exc:
            return ToolResult(found=False, context="", detail=str(exc))
        except (ConfigurationError, ValueError) as exc:
            return ToolResult(found=False, context="", detail=str(exc))

        return ToolResult(
            found=True,
            context=_format_context(resultado),
            sources=[
                f"modelo {resultado['versao_modelo']} "
                f"({resultado['algoritmo']}) — previsão, não medição"
            ],
            detail=(
                f"{resultado['total_pontos']} termopares previstos para "
                f"{configuracao.describe()}."
            ),
            data=resultado,
        )

    def _run_comparison(self, arguments: Mapping[str, Any]) -> ToolResult:
        """Compara dois cenários alterando um único fator por vez."""

        try:
            fator, nivel_a, nivel_b = _parse_comparison(arguments)
            argumentos_a = _scenario_arguments(arguments, fator, nivel_a)
            argumentos_b = _scenario_arguments(arguments, fator, nivel_b)
            configuracao_a = parse_configuration(argumentos_a)
            configuracao_b = parse_configuration(argumentos_b)
        except ConfigurationError as exc:
            return ToolResult(
                found=False,
                context="",
                detail=str(exc),
                data={"erro": str(exc), "niveis_aceitos": accepted_levels()},
            )

        try:
            previsao_a = self.predictor.predict(configuracao_a)
            previsao_b = self.predictor.predict(configuracao_b)
            comparacao = _compare_predictions(
                fator,
                nivel_a,
                nivel_b,
                previsao_a,
                previsao_b,
            )
        except (ModelsUnavailableError, DatasetUnavailableError) as exc:
            return ToolResult(found=False, context="", detail=str(exc))
        except (ConfigurationError, ValueError) as exc:
            return ToolResult(found=False, context="", detail=str(exc))

        return ToolResult(
            found=True,
            context=_format_comparison_context(comparacao),
            direct_answer=_format_comparison_answer(comparacao),
            sources=[
                f"modelo {comparacao['versao_modelo']} "
                f"({comparacao['algoritmo']}) — comparação preditiva, não medição"
            ],
            detail=(
                f"Comparação controlada de {fator}: {nivel_a} versus {nivel_b}, "
                f"mantendo os demais fatores constantes."
            ),
            data=comparacao,
        )


def _is_comparison(arguments: Mapping[str, Any]) -> bool:
    modo = str(arguments.get("mode") or arguments.get("modo") or "").casefold()
    return modo in {"compare", "comparison", "comparar", "comparacao", "comparação"} or any(
        chave in arguments for chave in ("comparison", "compare", "comparacao", "comparação")
    )


def _discard_unstated_comparison_losses(
    arguments: Mapping[str, Any],
    user_message: str,
) -> Mapping[str, Any]:
    """Não aceita perdas que o roteador tenha completado sem o usuário dizer.

    Em comparação, escolher um nível de perdas muda os dois cenários e pode
    alterar a conclusão. A ausência precisa virar pergunta, nunca default.
    """

    if not user_message or not _is_comparison(arguments):
        return arguments
    texto = user_message.casefold()
    if "perda" in texto or "loss" in texto:
        return arguments
    return {key: value for key, value in arguments.items() if key != "losses"}


def _parse_comparison(arguments: Mapping[str, Any]) -> tuple[str, str, str]:
    bruto = next(
        (
            arguments[chave]
            for chave in ("comparison", "compare", "comparacao", "comparação")
            if chave in arguments
        ),
        None,
    )
    if not isinstance(bruto, Mapping):
        raise ConfigurationError(
            "Para comparar previsões, informe comparison como objeto com "
            "factor e levels."
        )

    fator_bruto = (
        bruto.get("factor")
        or bruto.get("fator")
        or bruto.get("field")
        or bruto.get("variable")
        or arguments.get("factor")
        or arguments.get("fator")
        or ""
    )
    fator = _normalize_factor_name(str(fator_bruto))
    if not fator:
        # Alguns modelos usam o próprio fator como chave do objeto, por
        # exemplo {"Blower Direction": ["To Front", "To Back"]}.
        fator = next(
            (
                normalizado
                for chave in bruto
                if (normalizado := _normalize_factor_name(str(chave)))
            ),
            "",
        )
    if fator not in LEVELS:
        raise ConfigurationError(
            "Fator de comparação ausente ou inválido. Aceitos: "
            + ", ".join(LEVELS)
            + "."
        )

    niveis_brutos = (
        bruto.get("levels")
        or bruto.get("niveis")
        or bruto.get("values")
        or bruto.get("valores")
    )
    if niveis_brutos is None:
        niveis_brutos = next(
            (
                valor
                for chave, valor in bruto.items()
                if _normalize_factor_name(str(chave)) == fator
            ),
            None,
        )
    if isinstance(niveis_brutos, (list, tuple)) and len(niveis_brutos) == 2:
        nivel_a, nivel_b = (str(item).strip() for item in niveis_brutos)
    else:
        nivel_a = str(
            bruto.get("level_a") or bruto.get("nivel_a") or bruto.get("from") or ""
        ).strip()
        nivel_b = str(
            bruto.get("level_b") or bruto.get("nivel_b") or bruto.get("to") or ""
        ).strip()

    if not nivel_a and not nivel_b and len(LEVELS[fator]) == 2:
        nivel_a, nivel_b = LEVELS[fator]
    if not nivel_a or not nivel_b:
        raise ConfigurationError(
            f"Informe exatamente dois níveis para comparar em '{fator}'. "
            f"Aceitos: {', '.join(LEVELS[fator])}."
        )
    if nivel_a.casefold() == nivel_b.casefold():
        raise ConfigurationError("Os dois níveis da comparação precisam ser diferentes.")
    return fator, nivel_a, nivel_b


def _normalize_factor_name(value: str) -> str:
    compact = "".join(character for character in value.casefold() if character.isalnum())
    return next(
        (
            factor
            for factor in LEVELS
            if "".join(character for character in factor if character.isalnum())
            == compact
        ),
        "",
    )


def _scenario_arguments(
    arguments: Mapping[str, Any],
    factor: str,
    level: str,
) -> dict[str, Any]:
    scenario = {
        chave: valor
        for chave, valor in arguments.items()
        if chave
        not in {"mode", "modo", "comparison", "compare", "comparacao", "comparação"}
    }
    scenario[factor] = level
    return scenario


def _compare_predictions(
    factor: str,
    level_a: str,
    level_b: str,
    prediction_a: Mapping[str, Any],
    prediction_b: Mapping[str, Any],
) -> dict[str, Any]:
    """Calcula A - B somente entre pontos equivalentes dos dois cenários."""

    pontos_a = {item["measurement_id"]: item for item in prediction_a["pontos"]}
    pontos_b = {item["measurement_id"]: item for item in prediction_b["pontos"]}
    if pontos_a.keys() != pontos_b.keys():
        raise ValueError("Os cenários não cobrem os mesmos termopares classificados.")

    pontos: list[dict[str, Any]] = []
    por_area: dict[str, list[float]] = {}
    for measurement_id, ponto_a in pontos_a.items():
        ponto_b = pontos_b[measurement_id]
        delta = round(
            ponto_a["temperatura_prevista_c"] - ponto_b["temperatura_prevista_c"],
            2,
        )
        registro = {
            "measurement_id": measurement_id,
            "tc_name": ponto_a["tc_name"],
            "key_area": ponto_a["key_area"],
            "temperatura_nivel_a_c": ponto_a["temperatura_prevista_c"],
            "temperatura_nivel_b_c": ponto_b["temperatura_prevista_c"],
            "delta_a_menos_b_c": delta,
            "validado": bool(ponto_a["validado"] and ponto_b["validado"]),
            "mae_validacao_c": ponto_a["mae_validacao_c"],
        }
        pontos.append(registro)
        if registro["validado"]:
            por_area.setdefault(ponto_a["key_area"], []).append(delta)

    validados = [ponto for ponto in pontos if ponto["validado"]]
    areas = [
        {
            "key_area": area,
            "pontos_validados": len(deltas),
            "delta_medio_a_menos_b_c": round(sum(deltas) / len(deltas), 2),
        }
        for area, deltas in sorted(por_area.items())
    ]
    pontos.sort(key=lambda item: item["delta_a_menos_b_c"], reverse=True)

    return {
        "modo": "comparacao_controlada",
        "versao_modelo": prediction_a["versao_modelo"],
        "algoritmo": prediction_a["algoritmo"],
        "fator_comparado": factor,
        "nivel_a": level_a,
        "nivel_b": level_b,
        "interpretacao_delta": f"delta = {level_a} - {level_b}",
        "configuracao_fixa": {
            chave: valor
            for chave, valor in prediction_a["configuracao"].items()
            if chave != factor
        },
        "pontos_validados": len(validados),
        "nivel_a_mais_quente": sum(
            ponto["delta_a_menos_b_c"] > COMPARISON_TOLERANCE_C
            for ponto in validados
        ),
        "nivel_a_mais_frio": sum(
            ponto["delta_a_menos_b_c"] < -COMPARISON_TOLERANCE_C
            for ponto in validados
        ),
        "sem_mudanca_relevante": sum(
            abs(ponto["delta_a_menos_b_c"]) <= COMPARISON_TOLERANCE_C
            for ponto in validados
        ),
        "areas": areas,
        "pontos": pontos,
    }


def _format_comparison_context(comparison: Mapping[str, Any]) -> str:
    level_a = comparison["nivel_a"]
    level_b = comparison["nivel_b"]
    points = comparison["pontos"]
    validated = [point for point in points if point["validado"]]
    increases = validated[:5]
    decreases = sorted(validated, key=lambda item: item["delta_a_menos_b_c"])[:5]

    lines = [
        f"COMPARAÇÃO CONTROLADA DO MODELO {comparison['versao_modelo']} "
        f"({comparison['algoritmo']})",
        "Estes valores são previsões, não medições. Os dois cenários usam a",
        "mesma configuração e diferem somente no fator declarado abaixo.",
        f"FATOR: {comparison['fator_comparado']}",
        f"CENÁRIO A: {level_a}",
        f"CENÁRIO B: {level_b}",
        f"DELTA: temperatura de {level_a} menos temperatura de {level_b}",
        f"CONFIGURAÇÃO FIXA: {_describe_fixed(comparison['configuracao_fixa'])}",
        "RESUMO DOS PONTOS VALIDADOS: "
        f"{comparison['pontos_validados']} pontos; "
        f"{comparison['nivel_a_mais_quente']} mais quentes em {level_a}; "
        f"{comparison['nivel_a_mais_frio']} mais frios; "
        f"{comparison['sem_mudanca_relevante']} sem mudança acima de "
        f"{COMPARISON_TOLERANCE_C:.2f} °C.",
        "",
        f"DIFERENÇA MÉDIA POR ÁREA ({level_a} - {level_b})",
    ]
    lines.extend(
        f"{area['key_area']} | {area['delta_medio_a_menos_b_c']:+.2f} °C | "
        f"{area['pontos_validados']} ponto(s) validado(s)"
        for area in comparison["areas"]
    )
    lines.extend(["", f"MAIORES AUMENTOS EM {level_a}"])
    lines.extend(
        f"{point['tc_name']} | {point['key_area']} | "
        f"{point['delta_a_menos_b_c']:+.2f} °C"
        for point in increases
    )
    lines.extend(["", f"MAIORES REDUÇÕES EM {level_a}"])
    lines.extend(
        f"{point['tc_name']} | {point['key_area']} | "
        f"{point['delta_a_menos_b_c']:+.2f} °C"
        for point in decreases
    )
    lines.extend(
        [
            "",
            "Não generalize esta direção como melhor ou pior: o efeito depende da",
            "região e desta configuração fixa. Validação de engenharia continua obrigatória.",
        ]
    )
    return "\n".join(lines)


def _format_comparison_answer(comparison: Mapping[str, Any]) -> str:
    """Resposta final derivada só dos números calculados pelo preditor."""

    level_a = comparison["nivel_a"]
    level_b = comparison["nivel_b"]
    areas = "\n".join(
        f"- **{area['key_area']}**: "
        f"{area['delta_medio_a_menos_b_c']:+.2f} °C "
        f"({area['pontos_validados']} ponto(s) validado(s))"
        for area in comparison["areas"]
    )
    return "\n".join(
        [
            f"Comparação preditiva de **{level_a}** com **{level_b}**, "
            f"mantendo fixos: {_describe_fixed(comparison['configuracao_fixa'])}.",
            f"O delta abaixo é **{level_a} − {level_b}**: valor positivo significa "
            f"que {level_a} ficou mais quente; valor negativo, mais frio.",
            "",
            areas,
            "",
            f"Nos {comparison['pontos_validados']} pontos validados, {level_a} ficou "
            f"mais quente em {comparison['nivel_a_mais_quente']}, mais frio em "
            f"{comparison['nivel_a_mais_frio']} e sem mudança relevante em "
            f"{comparison['sem_mudanca_relevante']}.",
            "Estes valores são previsões do modelo para esta configuração, não "
            "medições nem uma regra geral. A validação de engenharia continua obrigatória.",
        ]
    )


def _describe_fixed(configuration: Mapping[str, Any]) -> str:
    losses = configuration.get("losses", {})
    parts = [
        str(configuration[factor])
        for factor in (
            "run_case",
            "blower_direction",
            "housing",
            "board_position",
            "deflector_hole",
            "material_coil_support",
        )
        if factor in configuration
    ]
    detail = " · ".join(
        str(part) for part in (losses.get("config"), losses.get("order")) if part
    )
    if losses:
        parts.append(
            f"perdas {losses.get('present')}"
            f"{f' ({detail})' if detail else ''}"
        )
    return " · ".join(parts)


def build_prediction_tool(models_dir: Path, dataset_path: Path) -> ThermalPredictionTool:
    return ThermalPredictionTool(ThermalPredictor(models_dir, Dataset(dataset_path)))


def classify(temperature_c: float, limit_c: float) -> tuple[str, float]:
    """Regra RN-01: acima do limite, banda de incerteza ou dentro do limite."""

    margem = limit_c - temperature_c
    if margem < 0:
        return "acima_do_limite", margem
    if margem < TOLERANCE_FRACTION * limit_c:
        return "banda_de_incerteza", margem
    return "dentro_do_limite", margem


def _build_record(
    termopar: str,
    temperatura: float,
    ponto: Any,
    bundle: ModelBundle,
) -> dict[str, Any]:
    registro: dict[str, Any] = {
        "tc_name": termopar,
        "key_area": ponto.key_area if ponto else bundle.set_name,
        "measurement_id": ponto.measurement_id if ponto else termopar,
        "conjunto": bundle.set_name,
        "temperatura_prevista_c": round(temperatura, 2),
        "limit_c": ponto.limit_c if ponto else None,
        "is_monitor_only": bool(ponto.is_monitor_only) if ponto else False,
        "mae_validacao_c": bundle.mae_c,
        # O conjunto AC Blower Inlet foi treinado sem validação cruzada (quatro
        # leituras por termopar). Sem essa marca, sua previsão apareceria com o
        # mesmo peso das demais.
        "validado": bundle.validated,
    }

    limite = registro["limit_c"]
    if limite is None:
        # RN-03: ponto sem limite declarado é acompanhamento, não aprovação.
        registro.update(
            {
                "margem_c": None,
                "margem_percentual": None,
                "estado": "monitoramento",
                "estado_rotulo": STATE_LABELS["monitoramento"],
            }
        )
        return registro

    estado, margem = classify(temperatura, float(limite))
    registro.update(
        {
            "margem_c": round(margem, 2),
            "margem_percentual": round(margem / float(limite), 4),
            "estado": estado,
            "estado_rotulo": STATE_LABELS[estado],
        }
    )
    return registro


def _format_context(resultado: Mapping[str, Any]) -> str:
    pontos = resultado["pontos"]
    contagem: dict[str, int] = {}
    for ponto in pontos:
        contagem[ponto["estado"]] = contagem.get(ponto["estado"], 0) + 1

    linhas = [
        f"PREVISÃO DO MODELO {resultado['versao_modelo']} ({resultado['algoritmo']})",
        "Estes valores vêm da execução dos modelos treinados. Copie-os como",
        "estão; não recalcule, não arredonde para outro valor e não estime",
        "nenhum ponto que não esteja listado aqui.",
        "",
        f"CONFIGURAÇÃO: {_describe(resultado['configuracao'])}",
        f"PONTOS: {resultado['total_pontos']} "
        f"({resultado['total_classificados']} com limite, "
        f"{resultado['total_monitoramento']} só de monitoramento)",
        "RESUMO: "
        + ", ".join(
            f"{contagem.get(estado, 0)} {STATE_LABELS[estado].lower()}"
            for estado in ("acima_do_limite", "banda_de_incerteza", "dentro_do_limite")
        ),
        "",
        "PONTOS MAIS CRÍTICOS (menor margem primeiro)",
        "TERMOPAR | ÁREA | PREVISTO °C | LIMITE °C | MARGEM °C | ESTADO | MAE DO MODELO °C",
    ]

    for ponto in pontos[:MAX_POINTS_IN_CONTEXT]:
        mae = (
            "sem validação cruzada"
            if ponto["mae_validacao_c"] is None
            else f"{ponto['mae_validacao_c']:.2f}"
        )
        linhas.append(
            f"{ponto['tc_name']} | {ponto['key_area']} | "
            f"{ponto['temperatura_prevista_c']:.2f} | {ponto['limit_c']:.0f} | "
            f"{ponto['margem_c']:.2f} | {ponto['estado_rotulo']} | {mae}"
        )

    restantes = len(pontos) - MAX_POINTS_IN_CONTEXT
    if restantes > 0:
        linhas.append(f"[+{restantes} ponto(s) com margem maior, não listados]")

    linhas.extend(
        [
            "",
            "A margem é limite menos temperatura prevista. 'Banda de incerteza'",
            f"significa margem abaixo de {TOLERANCE_FRACTION:.0%} do limite, onde o erro do",
            "modelo é da mesma ordem da folga restante.",
        ]
    )

    sem_validacao = resultado.get("conjuntos_sem_validacao") or []
    if sem_validacao:
        linhas.append(
            "ATENÇÃO: o(s) conjunto(s) "
            + ", ".join(sem_validacao)
            + " foram treinados sem validação cruzada, por terem poucas leituras "
            "reais. Suas previsões não têm erro estimado e devem ser tratadas "
            "com mais reserva que as demais. Diga isso se citar um ponto deles."
        )
    return "\n".join(linhas)


def _describe(configuracao: Mapping[str, Any]) -> str:
    perdas = configuracao.get("losses", {})
    partes = [
        str(configuracao.get(fator))
        for fator in (
            "run_case",
            "blower_direction",
            "housing",
            "board_position",
            "deflector_hole",
            "material_coil_support",
        )
    ]
    detalhe = " · ".join(
        str(parte) for parte in (perdas.get("config"), perdas.get("order")) if parte
    )
    partes.append(f"perdas {perdas.get('present')}{f' ({detalhe})' if detalhe else ''}")
    return " · ".join(partes)
