"""Ingestão do corpus: Markdown -> trechos -> embeddings -> base vetorial.

Uso:

    python -m thermal_chatbot.rag.ingest            # indexa o diretório padrão
    python -m thermal_chatbot.rag.ingest docs/x.md  # indexa arquivos específicos
"""

import argparse
import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path

from thermal_chatbot.rag.chunking import DocumentChunk, chunk_file
from thermal_chatbot.rag.embeddings import Embedder, OllamaEmbedder
from thermal_chatbot.rag.store import PgVectorStore, VectorStore
from thermal_chatbot.settings import Settings, get_settings

EMBEDDING_BATCH_SIZE = 16


@dataclass
class DocumentReport:
    """Resultado da indexação de um arquivo."""

    document_id: str
    chunks: int
    confidentiality: str


async def ingest_documents(
    paths: list[Path],
    embedder: Embedder,
    store: VectorStore,
) -> list[DocumentReport]:
    """Indexa cada arquivo por completo, substituindo a versão anterior."""

    await store.ensure_schema(embedder.dimensions)

    relatorio: list[DocumentReport] = []
    for path in paths:
        metadata, trechos = chunk_file(path)
        if not trechos:
            continue

        vetores = await _embed_in_batches(embedder, trechos)
        total = await store.replace_document(metadata.document_id, trechos, vetores)
        relatorio.append(
            DocumentReport(
                document_id=metadata.document_id,
                chunks=total,
                confidentiality=metadata.confidentiality,
            )
        )
    return relatorio


def collect_markdown_files(targets: list[Path]) -> list[Path]:
    """Expande diretórios em arquivos ``.md``, mantendo ordem previsível."""

    arquivos: list[Path] = []
    for alvo in targets:
        if alvo.is_dir():
            arquivos.extend(sorted(alvo.rglob("*.md")))
        elif alvo.is_file():
            arquivos.append(alvo)
        else:
            raise FileNotFoundError(f"Caminho não encontrado: {alvo}")
    return arquivos


async def _embed_in_batches(
    embedder: Embedder,
    chunks: list[DocumentChunk],
) -> list[list[float]]:
    vetores: list[list[float]] = []
    for inicio in range(0, len(chunks), EMBEDDING_BATCH_SIZE):
        lote = chunks[inicio : inicio + EMBEDDING_BATCH_SIZE]
        vetores.extend(await embedder.embed_documents([item.embedding_text for item in lote]))
    return vetores


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Indexa documentos autorizados no RAG local.")
    parser.add_argument(
        "targets",
        nargs="*",
        type=Path,
        help="Arquivos .md ou diretórios. Padrão: RAG_CORPUS_DIR.",
    )
    argumentos = parser.parse_args(argv)

    settings: Settings = get_settings()
    alvos = argumentos.targets or [Path(settings.rag_corpus_dir)]

    try:
        arquivos = collect_markdown_files(alvos)
    except FileNotFoundError as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 2

    if not arquivos:
        print("Nenhum arquivo .md encontrado para indexar.", file=sys.stderr)
        return 1

    embedder = OllamaEmbedder(settings)
    store = PgVectorStore(settings.rag_database_url, settings.rag_embedding_dimensions)

    try:
        relatorio = asyncio.run(ingest_documents(arquivos, embedder, store))
    except Exception as exc:  # falha de Ollama, banco ou arquivo ilegível
        print(f"erro durante a ingestão: {exc}", file=sys.stderr)
        return 1

    for item in relatorio:
        print(f"{item.document_id}: {item.chunks} trechos [{item.confidentiality}]")
    print(f"total: {sum(item.chunks for item in relatorio)} trechos indexados.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
