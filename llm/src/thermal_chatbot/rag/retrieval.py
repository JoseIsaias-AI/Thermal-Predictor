"""Ferramenta ``documentation_search``: busca nos documentos autorizados."""

from collections.abc import Mapping
from dataclasses import replace
from typing import Any

from thermal_chatbot.providers.base import ProviderError
from thermal_chatbot.rag.embeddings import Embedder
from thermal_chatbot.rag.store import SearchResult, VectorStore
from thermal_chatbot.schemas import ToolName
from thermal_chatbot.tools import Tool, ToolResult

MAX_QUERY_CHARS = 1_000

# Um contexto grande demais faz o modelo local levar minutos para responder e
# ainda dilui a pergunta entre linhas de tabela. O orçamento corta o excesso
# mantendo os trechos mais próximos, que vêm primeiro.
CONTEXT_CHAR_BUDGET = 3_500
TRUNCATION_MARK = "\n[trecho truncado por limite de contexto]"


class DocumentationSearchTool(Tool):
    """Recupera trechos por similaridade e os entrega já prontos para citação."""

    name = ToolName.DOCUMENTATION_SEARCH

    def __init__(
        self,
        embedder: Embedder,
        store: VectorStore,
        top_k: int = 3,
        min_similarity: float = 0.45,
    ) -> None:
        self.embedder = embedder
        self.store = store
        self.top_k = top_k
        self.min_similarity = min_similarity

    async def run(self, arguments: Mapping[str, Any], fallback_query: str) -> ToolResult:
        consulta = _extract_query(arguments) or fallback_query.strip()
        if not consulta:
            return ToolResult(
                found=False,
                context="",
                detail="A busca não recebeu um termo de consulta.",
            )

        try:
            vetor = await self.embedder.embed_query(consulta[:MAX_QUERY_CHARS])
            resultados = await self.store.search(
                embedding=vetor,
                top_k=self.top_k,
                min_similarity=self.min_similarity,
            )
        except ProviderError as exc:
            # Falha de infraestrutura não pode virar resposta inventada.
            return ToolResult(found=False, context="", detail=str(exc))

        if not resultados:
            return ToolResult(
                found=False,
                context="",
                detail=(
                    "Nenhum trecho dos documentos autorizados atingiu a "
                    "similaridade mínima para esta pergunta."
                ),
            )

        usados = _fit_budget(resultados)
        return ToolResult(
            found=True,
            context=format_context(usados),
            # Uma seção longa vira vários trechos e repetiria a mesma citação.
            sources=list(dict.fromkeys(resultado.chunk.citation for resultado in usados)),
            detail=f"{len(usados)} trecho(s) recuperado(s) para '{consulta[:80]}'.",
        )

    async def status(self) -> tuple[bool, str]:
        return await self.store.status()


def format_context(resultados: list[SearchResult]) -> str:
    """Formata os trechos como dados numerados, com a fonte exata de cada um."""

    blocos = [
        "\n".join(
            [
                f"[{indice}] FONTE: {resultado.chunk.citation}",
                f"    DOCUMENTO: {resultado.chunk.title}",
                f"    ORIGEM: {resultado.chunk.source}",
                f"    CLASSIFICAÇÃO: {resultado.chunk.confidentiality}",
                f"    SIMILARIDADE: {resultado.score:.2f}",
                "    CONTEÚDO:",
                _indent(resultado.chunk.content),
            ]
        )
        for indice, resultado in enumerate(resultados, start=1)
    ]
    return "\n\n".join(blocos)


def _fit_budget(resultados: list[SearchResult]) -> list[SearchResult]:
    """Mantém os trechos mais próximos dentro do orçamento de caracteres."""

    usados: list[SearchResult] = []
    restante = CONTEXT_CHAR_BUDGET

    for resultado in resultados:
        if restante <= 0:
            break
        conteudo = resultado.chunk.content
        if len(conteudo) > restante:
            if not usados:
                # O primeiro trecho é o mais relevante: entra truncado, e o
                # corte é declarado para o modelo não tratá-lo como completo.
                conteudo = conteudo[:restante] + TRUNCATION_MARK
            else:
                break
        usados.append(
            SearchResult(
                chunk=replace(resultado.chunk, content=conteudo),
                score=resultado.score,
            )
        )
        restante -= len(conteudo)
    return usados


def _indent(texto: str) -> str:
    return "\n".join(f"    {linha}" for linha in texto.splitlines())


def _extract_query(arguments: Mapping[str, Any]) -> str:
    """Aceita as variações de nome que o modelo costuma produzir."""

    for chave in ("query", "consulta", "question", "pergunta", "termo", "q"):
        valor = arguments.get(chave)
        if isinstance(valor, str) and valor.strip():
            return valor.strip()
    return ""
