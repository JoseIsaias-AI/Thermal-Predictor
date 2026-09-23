import asyncio

from thermal_chatbot.providers.base import ProviderUnavailableError
from thermal_chatbot.rag.chunking import DocumentChunk
from thermal_chatbot.rag.embeddings import Embedder
from thermal_chatbot.rag.retrieval import DocumentationSearchTool
from thermal_chatbot.rag.store import InMemoryVectorStore
from thermal_chatbot.schemas import ToolName


class FakeEmbedder(Embedder):
    """Vetores fixos: o teste verifica a busca, não a qualidade do modelo."""

    def __init__(self, vetores: dict[str, list[float]], falha: Exception | None = None) -> None:
        self.vetores = vetores
        self.falha = falha

    @property
    def dimensions(self) -> int:
        return 3

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self.vetores[texto] for texto in texts]

    async def embed_query(self, text: str) -> list[float]:
        if self.falha is not None:
            raise self.falha
        return self.vetores.get(text, [0.0, 0.0, 1.0])


def make_chunk(position: int, heading: str, content: str) -> DocumentChunk:
    return DocumentChunk(
        chunk_id=f"chunk-{position}",
        document_id="glossario.md",
        title="Glossário de teste",
        source="glossario.pdf",
        confidentiality="Confidencial",
        heading_path=heading,
        position=position,
        content=content,
    )


def make_tool(falha: Exception | None = None) -> tuple[DocumentationSearchTool, InMemoryVectorStore]:
    soprador = make_chunk(0, "3.2. Blower Direction", "A direção do soprador define o fluxo de ar.")
    perdas = make_chunk(1, "5. Losses", "As perdas são declaradas em watts por componente.")

    store = InMemoryVectorStore()
    embedder = FakeEmbedder(
        {
            soprador.embedding_text: [1.0, 0.0, 0.0],
            perdas.embedding_text: [0.0, 1.0, 0.0],
            "blower direction": [1.0, 0.0, 0.0],
            "perdas": [0.0, 1.0, 0.0],
        },
        falha=falha,
    )
    asyncio.run(
        store.replace_document(
            "glossario.md",
            [soprador, perdas],
            [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
        )
    )
    return DocumentationSearchTool(embedder, store, top_k=2, min_similarity=0.5), store


def test_recupera_trecho_relevante_com_fonte_citavel() -> None:
    tool, _ = make_tool()

    resultado = asyncio.run(tool.run({"query": "blower direction"}, fallback_query=""))

    assert tool.name is ToolName.DOCUMENTATION_SEARCH
    assert resultado.found is True
    assert resultado.sources == ["glossario.md § 3.2. Blower Direction"]
    assert "direção do soprador" in resultado.context
    assert "FONTE: glossario.md § 3.2. Blower Direction" in resultado.context
    assert "CLASSIFICAÇÃO: Confidencial" in resultado.context


def test_usa_a_pergunta_do_usuario_quando_faltam_argumentos() -> None:
    tool, _ = make_tool()

    resultado = asyncio.run(tool.run({}, fallback_query="perdas"))

    assert resultado.found is True
    assert resultado.sources == ["glossario.md § 5. Losses"]


def test_nao_retorna_nada_abaixo_do_limiar() -> None:
    tool, _ = make_tool()

    resultado = asyncio.run(tool.run({"query": "assunto sem relação"}, fallback_query=""))

    assert resultado.found is False
    assert resultado.sources == []
    assert "similaridade mínima" in resultado.detail


def test_falha_de_infraestrutura_nao_vira_resposta() -> None:
    tool, _ = make_tool(falha=ProviderUnavailableError("Ollama fora do ar."))

    resultado = asyncio.run(tool.run({"query": "blower direction"}, fallback_query=""))

    assert resultado.found is False
    assert "Ollama fora do ar." in resultado.detail


def test_status_reflete_base_vazia() -> None:
    tool, _ = make_tool()
    vazia = DocumentationSearchTool(tool.embedder, InMemoryVectorStore())

    assert asyncio.run(tool.status())[0] is True
    assert asyncio.run(vazia.status())[0] is False


def test_contexto_respeita_o_orcamento_de_caracteres() -> None:
    from thermal_chatbot.rag import retrieval

    grande = make_chunk(0, "5.4. Tabela de perdas", "linha de tabela. " * 900)
    pequeno = make_chunk(1, "5.1. Definição", "Perdas são o calor dissipado.")
    store = InMemoryVectorStore()
    embedder = FakeEmbedder(
        {
            grande.embedding_text: [1.0, 0.0, 0.0],
            pequeno.embedding_text: [0.9, 0.1, 0.0],
            "perdas": [1.0, 0.0, 0.0],
        }
    )
    asyncio.run(
        store.replace_document("glossario.md", [grande, pequeno], [[1.0, 0.0, 0.0], [0.9, 0.1, 0.0]])
    )
    tool = DocumentationSearchTool(embedder, store, top_k=2, min_similarity=0.5)

    resultado = asyncio.run(tool.run({"query": "perdas"}, fallback_query=""))

    assert resultado.found is True
    assert len(resultado.context) < retrieval.CONTEXT_CHAR_BUDGET + 1_000
    assert retrieval.TRUNCATION_MARK.strip() in resultado.context
    # O trecho que não coube não pode ser citado como fonte da resposta.
    assert resultado.sources == ["glossario.md § 5.4. Tabela de perdas"]
