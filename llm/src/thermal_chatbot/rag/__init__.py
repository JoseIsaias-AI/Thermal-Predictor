"""Recuperação aumentada por geração (RAG) sobre documentos autorizados."""

from thermal_chatbot.rag.chunking import DocumentChunk, DocumentMetadata, chunk_file
from thermal_chatbot.rag.embeddings import Embedder, OllamaEmbedder
from thermal_chatbot.rag.retrieval import DocumentationSearchTool
from thermal_chatbot.rag.store import (
    InMemoryVectorStore,
    PgVectorStore,
    SearchResult,
    VectorStore,
)
from thermal_chatbot.settings import Settings

__all__ = [
    "DocumentChunk",
    "DocumentMetadata",
    "DocumentationSearchTool",
    "Embedder",
    "InMemoryVectorStore",
    "OllamaEmbedder",
    "PgVectorStore",
    "SearchResult",
    "VectorStore",
    "build_documentation_tool",
    "chunk_file",
]


def build_documentation_tool(settings: Settings) -> DocumentationSearchTool:
    """Monta a ferramenta de busca com o embedder e a base configurados."""

    return DocumentationSearchTool(
        embedder=OllamaEmbedder(settings),
        store=PgVectorStore(
            settings.rag_database_url,
            settings.rag_embedding_dimensions,
        ),
        top_k=settings.rag_top_k,
        min_similarity=settings.rag_min_similarity,
    )
