"""Descoberta e carga dos modelos, um por subsistema.

Cada subsistema tem base e física próprias, então cada um pode receber um algoritmo
diferente: o catálogo define a família padrão e, quando preciso, a família de um subsistema
específico. Enquanto nenhuma for escolhida, o serviço sobe com todos os subsistemas
indisponíveis e o motivo declarado.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

from .adaptadores import PreditorIndisponivel, criar_preditor, tipos_suportados
from .protocolo import MetadadosModelo, Metricas, ModeloIndisponivel

TIPO_PREDITOR_PADRAO = "sklearn_joblib"
MOTIVO_SEM_FAMILIA = (
    "Família de modelos ainda não escolhida: defina 'familia_padrao' em catalogo_modelos.json "
    "ou a variável THERMAL_API_FAMILIA_MODELO."
)


@dataclass(frozen=True)
class Candidato:
    """Modelo treinado disponível no repositório para um subsistema, ativo ou não."""

    familia: str
    rotulo: str
    algoritmo: str | None
    versao: str | None
    validado: bool | None
    artefato_disponivel: bool
    termopares_cobertos: int
    metricas: Metricas | None


@dataclass(frozen=True)
class RegistroDeModelos:
    familia_ativa: str | None
    familias_disponiveis: tuple[str, ...]
    preditores: dict[str, object] = field(default_factory=dict)
    candidatos: dict[str, tuple[Candidato, ...]] = field(default_factory=dict)

    @property
    def subsistemas(self):
        return tuple(self.preditores)

    def preditor(self, subsistema):
        if subsistema not in self.preditores:
            raise ModeloIndisponivel(f"Subsistema desconhecido: {subsistema!r}.")

        return self.preditores[subsistema]

    def carregados(self):
        return tuple(nome for nome, p in self.preditores.items() if p.estado == "carregado")

    def estado_geral(self):
        """`ok` só quando todo subsistema conhecido tem modelo carregado."""
        if not self.preditores:
            return "sem_modelo"

        carregados = len(self.carregados())

        if carregados == len(self.preditores):
            return "ok"

        return "sem_modelo" if carregados == 0 else "degradado"


def _ler_json(caminho):
    with open(caminho, encoding="utf-8") as arquivo:
        return json.load(arquivo)


def _carregar_catalogo(caminho):
    """Catálogo de famílias; um arquivo ausente vale como catálogo vazio."""
    if not Path(caminho).is_file():
        return {"familia_padrao": None, "familias": {}, "por_subsistema": {}}

    catalogo = _ler_json(caminho)
    catalogo.setdefault("familia_padrao", None)
    catalogo.setdefault("familias", {})
    catalogo.setdefault("por_subsistema", {})

    return catalogo


def _descobrir_familias(pasta_modelos):
    """Lê os metadados de cada família presente no disco: {família: {subsistema: (meta, json)}}."""
    pasta = Path(pasta_modelos)

    if not pasta.is_dir():
        return {}

    familias = {}

    for subpasta in sorted(p for p in pasta.iterdir() if p.is_dir()):
        por_subsistema = {}

        for arquivo in sorted(subpasta.glob("*.json")):
            try:
                bruto = _ler_json(arquivo)
            except (OSError, ValueError):
                continue

            subsistema = bruto.get("conjunto") or arquivo.stem
            por_subsistema[subsistema] = (arquivo, bruto)

        if por_subsistema:
            familias[subpasta.name] = por_subsistema

    return familias


def _metadados(subsistema, identificador, familia, bruto):
    return MetadadosModelo(
        subsistema=subsistema,
        identificador=identificador,
        familia=familia,
        algoritmo=bruto.get("algoritmo"),
        versao=bruto.get("versao"),
        commit_treino=bruto.get("commit_treino"),
        validado=bruto.get("validado"),
        observacao=bruto.get("observacao"),
        termopares=tuple(sorted(bruto.get("codigo_por_termopar") or {})),
        metricas=Metricas.de_metadados(bruto.get("metricas_validacao")),
    )


def _identificador(familias, subsistema):
    """Nome de arquivo do subsistema, igual em todas as famílias que o exportam."""
    for por_subsistema in familias.values():
        if subsistema in por_subsistema:
            return por_subsistema[subsistema][0].stem

    return subsistema


def _candidatos(familias, subsistema, catalogo):
    lista = []

    for familia, por_subsistema in familias.items():
        if subsistema not in por_subsistema:
            continue

        arquivo, bruto = por_subsistema[subsistema]
        declarada = catalogo["familias"].get(familia, {})
        lista.append(
            Candidato(
                familia=familia,
                rotulo=declarada.get("rotulo") or bruto.get("algoritmo") or familia,
                algoritmo=bruto.get("algoritmo"),
                versao=bruto.get("versao"),
                validado=bruto.get("validado"),
                artefato_disponivel=arquivo.with_suffix(".joblib").is_file(),
                termopares_cobertos=len(bruto.get("codigo_por_termopar") or {}),
                metricas=Metricas.de_metadados(bruto.get("metricas_validacao")),
            )
        )

    return tuple(lista)


def construir_registro(configuracao):
    """Monta o registro carregando, para cada subsistema, o modelo da família escolhida."""
    catalogo = _carregar_catalogo(configuracao.caminho_catalogo)
    familias = _descobrir_familias(configuracao.pasta_modelos)
    familia_ativa = configuracao.familia_padrao or catalogo["familia_padrao"]

    subsistemas = sorted({s for por_subsistema in familias.values() for s in por_subsistema})
    preditores, candidatos = {}, {}

    for subsistema in subsistemas:
        candidatos[subsistema] = _candidatos(familias, subsistema, catalogo)
        escolhida = catalogo["por_subsistema"].get(subsistema) or familia_ativa
        identificador_base = _identificador(familias, subsistema)

        if not escolhida:
            preditores[subsistema] = PreditorIndisponivel(
                MetadadosModelo(subsistema=subsistema, identificador=identificador_base),
                MOTIVO_SEM_FAMILIA,
            )
            continue

        if escolhida not in familias or subsistema not in familias[escolhida]:
            preditores[subsistema] = PreditorIndisponivel(
                MetadadosModelo(
                    subsistema=subsistema,
                    identificador=identificador_base,
                    familia=escolhida,
                ),
                f"A família {escolhida!r} não tem modelo exportado para este subsistema.",
            )
            continue

        arquivo, bruto = familias[escolhida][subsistema]
        metadados = _metadados(subsistema, arquivo.stem, escolhida, bruto)
        tipo = catalogo["familias"].get(escolhida, {}).get("tipo_preditor", TIPO_PREDITOR_PADRAO)
        preditores[subsistema] = criar_preditor(
            tipo, metadados, arquivo.with_suffix(".joblib"), bruto
        )

    return RegistroDeModelos(
        familia_ativa=familia_ativa,
        familias_disponiveis=tuple(sorted(familias)),
        preditores=preditores,
        candidatos=candidatos,
    )


__all__ = ["Candidato", "RegistroDeModelos", "construir_registro", "tipos_suportados"]
