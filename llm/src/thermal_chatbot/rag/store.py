"""Persistência dos trechos e busca por similaridade.

A implementação de produção usa PostgreSQL com pgvector em container local. A
implementação em memória existe para os testes rodarem sem banco e sem Ollama.
"""

import asyncio
import math
from abc import ABC, abstractmethod
from dataclasses import dataclass

from thermal_chatbot.rag.chunking import DocumentChunk

SCHEMA_STATEMENTS = (
    "CREATE EXTENSION IF NOT EXISTS vector",
    """
    CREATE TABLE IF NOT EXISTS document_chunks (
        chunk_id          TEXT PRIMARY KEY,
        document_id       TEXT NOT NULL,
        title             TEXT NOT NULL,
        source            TEXT NOT NULL,
        confidentiality   TEXT NOT NULL,
        heading_path      TEXT NOT NULL,
        position          INTEGER NOT NULL,
        content           TEXT NOT NULL,
        embedding         VECTOR(%(dimensions)s) NOT NULL,
        indexed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS document_chunks_document_idx ON document_chunks (document_id)",
    """
    CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
        ON document_chunks USING hnsw (embedding vector_cosine_ops)
    """,
)


@dataclass(frozen=True)
class SearchResult:
    """Trecho recuperado e sua similaridade com a pergunta."""

    chunk: DocumentChunk
    score: float


class VectorStore(ABC):
    """Contrato mínimo exigido pela ingestão e pela busca."""

    @abstractmethod
    async def ensure_schema(self, dimensions: int) -> None:
        """Cria extensão, tabela e índices, se ainda não existirem."""

    @abstractmethod
    async def replace_document(
        self,
        document_id: str,
        chunks: list[DocumentChunk],
        embeddings: list[list[float]],
    ) -> int:
        """Substitui todos os trechos de um documento em uma única transação."""

    @abstractmethod
    async def search(
        self,
        embedding: list[float],
        top_k: int,
        min_similarity: float,
    ) -> list[SearchResult]:
        """Retorna os trechos mais próximos acima do limiar de similaridade."""

    @abstractmethod
    async def status(self) -> tuple[bool, str]:
        """Informa se a base está acessível e contém conteúdo indexado."""


class InMemoryVectorStore(VectorStore):
    """Base vetorial em memória, usada nos testes e em execuções isoladas."""

    def __init__(self) -> None:
        self._items: dict[str, list[tuple[DocumentChunk, list[float]]]] = {}

    async def ensure_schema(self, dimensions: int) -> None:
        return None

    async def replace_document(
        self,
        document_id: str,
        chunks: list[DocumentChunk],
        embeddings: list[list[float]],
    ) -> int:
        self._items[document_id] = list(zip(chunks, embeddings, strict=True))
        return len(chunks)

    async def search(
        self,
        embedding: list[float],
        top_k: int,
        min_similarity: float,
    ) -> list[SearchResult]:
        resultados = [
            SearchResult(chunk=chunk, score=_cosine_similarity(embedding, vetor))
            for grupo in self._items.values()
            for chunk, vetor in grupo
        ]
        resultados.sort(key=lambda item: item.score, reverse=True)
        return [item for item in resultados if item.score >= min_similarity][:top_k]

    async def status(self) -> tuple[bool, str]:
        total = sum(len(grupo) for grupo in self._items.values())
        if total == 0:
            return False, "Nenhum documento indexado na base em memória."
        return True, f"{total} trechos indexados em memória."


class PgVectorStore(VectorStore):
    """Base vetorial em PostgreSQL/pgvector, executada localmente."""

    def __init__(self, database_url: str, dimensions: int) -> None:
        self.database_url = database_url
        self.dimensions = dimensions

    async def ensure_schema(self, dimensions: int) -> None:
        await asyncio.to_thread(self._ensure_schema_sync, dimensions)

    async def replace_document(
        self,
        document_id: str,
        chunks: list[DocumentChunk],
        embeddings: list[list[float]],
    ) -> int:
        return await asyncio.to_thread(
            self._replace_document_sync, document_id, chunks, embeddings
        )

    async def search(
        self,
        embedding: list[float],
        top_k: int,
        min_similarity: float,
    ) -> list[SearchResult]:
        return await asyncio.to_thread(
            self._search_sync, embedding, top_k, min_similarity
        )

    async def status(self) -> tuple[bool, str]:
        return await asyncio.to_thread(self._status_sync)

    # -- execução síncrona -------------------------------------------------
    # psycopg é síncrono aqui de propósito: a ingestão é um script e a busca
    # roda em thread separada, o que evita uma dependência extra de driver.

    def _connect(self):
        import psycopg  # importado sob demanda para não exigir o driver nos testes

        return psycopg.connect(self.database_url, connect_timeout=5)

    def _ensure_schema_sync(self, dimensions: int) -> None:
        with self._connect() as conexao, conexao.cursor() as cursor:
            for comando in SCHEMA_STATEMENTS:
                cursor.execute(comando % {"dimensions": dimensions})
            conexao.commit()

    def _replace_document_sync(
        self,
        document_id: str,
        chunks: list[DocumentChunk],
        embeddings: list[list[float]],
    ) -> int:
        linhas = [
            (
                chunk.chunk_id,
                chunk.document_id,
                chunk.title,
                chunk.source,
                chunk.confidentiality,
                chunk.heading_path,
                chunk.position,
                chunk.content,
                _to_vector_literal(vetor),
            )
            for chunk, vetor in zip(chunks, embeddings, strict=True)
        ]

        with self._connect() as conexao, conexao.cursor() as cursor:
            cursor.execute(
                "DELETE FROM document_chunks WHERE document_id = %s", (document_id,)
            )
            cursor.executemany(
                """
                INSERT INTO document_chunks (
                    chunk_id, document_id, title, source, confidentiality,
                    heading_path, position, content, embedding
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                linhas,
            )
            conexao.commit()
        return len(linhas)

    def _search_sync(
        self,
        embedding: list[float],
        top_k: int,
        min_similarity: float,
    ) -> list[SearchResult]:
        vetor = _to_vector_literal(embedding)
        with self._connect() as conexao, conexao.cursor() as cursor:
            cursor.execute(
                """
                SELECT chunk_id, document_id, title, source, confidentiality,
                       heading_path, position, content,
                       1 - (embedding <=> %s::vector) AS similarity
                  FROM document_chunks
                 WHERE 1 - (embedding <=> %s::vector) >= %s
                 ORDER BY embedding <=> %s::vector
                 LIMIT %s
                """,
                (vetor, vetor, min_similarity, vetor, top_k),
            )
            return [
                SearchResult(
                    chunk=DocumentChunk(
                        chunk_id=linha[0],
                        document_id=linha[1],
                        title=linha[2],
                        source=linha[3],
                        confidentiality=linha[4],
                        heading_path=linha[5],
                        position=linha[6],
                        content=linha[7],
                    ),
                    score=float(linha[8]),
                )
                for linha in cursor.fetchall()
            ]

    def _status_sync(self) -> tuple[bool, str]:
        try:
            with self._connect() as conexao, conexao.cursor() as cursor:
                cursor.execute("SELECT to_regclass('public.document_chunks')")
                if cursor.fetchone()[0] is None:
                    return False, "A tabela de trechos ainda não existe; execute a ingestão."
                cursor.execute(
                    "SELECT count(*), count(DISTINCT document_id) FROM document_chunks"
                )
                trechos, documentos = cursor.fetchone()
        except Exception as exc:  # driver ausente, banco fora do ar ou credenciais
            return False, f"Base vetorial indisponível: {exc}"

        if not trechos:
            return False, "A base vetorial está vazia; execute a ingestão."
        return True, f"{trechos} trechos de {documentos} documento(s) indexados."


def _to_vector_literal(embedding: list[float]) -> str:
    """Formata o vetor como literal aceito pelo pgvector."""

    return "[" + ",".join(f"{valor:.8f}" for valor in embedding) + "]"


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    produto = sum(x * y for x, y in zip(a, b, strict=True))
    norma = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return produto / norma if norma else 0.0
