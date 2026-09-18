"""Fragmenta documentos Markdown preservando a hierarquia de títulos.

O corte segue os títulos porque cada seção do glossário já é autocontida. O
caminho de títulos vira metadado e, depois, a citação mostrada ao usuário: sem
ele a resposta citaria um arquivo inteiro, o que não é verificável.
"""

import hashlib
import re
from dataclasses import dataclass, field, replace
from pathlib import Path

HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
FRONT_MATTER_FIELD = re.compile(r"^([A-Za-z_][\w]*)\s*:\s*(.*)$")
TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")

MAX_CHUNK_CHARS = 1_800
MIN_CHUNK_CHARS = 40


@dataclass(frozen=True)
class DocumentMetadata:
    """Cabeçalho do documento: identidade, origem e classificação."""

    document_id: str
    title: str
    source: str
    confidentiality: str
    extra: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class DocumentChunk:
    """Trecho pronto para embedding, com o que é preciso para citá-lo."""

    chunk_id: str
    document_id: str
    title: str
    source: str
    confidentiality: str
    heading_path: str
    position: int
    content: str

    @property
    def citation(self) -> str:
        """Texto exibido ao usuário como fonte.

        Usa só a seção mais profunda: o caminho completo repete o título do
        documento e deixa a citação longa demais para a resposta do chatbot.
        As seções são numeradas, então a seção sozinha ainda localiza o trecho.
        """

        if not self.heading_path:
            return self.document_id
        return f"{self.document_id} § {self.heading_path.split(' > ')[-1]}"

    @property
    def embedding_text(self) -> str:
        """Repete título e seção para o trecho não depender do contexto vizinho."""

        cabecalho = " > ".join(part for part in (self.title, self.heading_path) if part)
        return f"{cabecalho}\n\n{self.content}" if cabecalho else self.content


def parse_front_matter(text: str) -> tuple[dict[str, str], str]:
    """Separa o front matter simples (``chave: valor``) do corpo do documento."""

    linhas = text.lstrip("\ufeff").splitlines()
    if not linhas or linhas[0].strip() != "---":
        return {}, text

    valores: dict[str, str] = {}
    for indice, linha in enumerate(linhas[1:], start=1):
        if linha.strip() == "---":
            return valores, "\n".join(linhas[indice + 1 :])
        encontrado = FRONT_MATTER_FIELD.match(linha)
        if encontrado:
            valores[encontrado.group(1)] = encontrado.group(2).strip().strip('"').strip("'")

    # Sem delimitador de fechamento não há front matter válido; trata tudo como corpo.
    return {}, text


def build_metadata(path: Path, front_matter: dict[str, str]) -> DocumentMetadata:
    """Monta os metadados exigidos, sem inventar classificação ausente."""

    fonte = front_matter.get("fonte_primaria") or front_matter.get("fonte") or path.name
    url = front_matter.get("fonte_url")
    return DocumentMetadata(
        document_id=path.name,
        title=front_matter.get("titulo") or path.stem,
        source=f"{fonte} ({url})" if url else fonte,
        confidentiality=front_matter.get("confidencialidade") or "não classificado",
        extra={
            chave: valor
            for chave, valor in front_matter.items()
            if chave not in {"titulo", "fonte_primaria", "fonte", "fonte_url", "confidencialidade"}
        },
    )


def chunk_markdown(text: str, metadata: DocumentMetadata) -> list[DocumentChunk]:
    """Divide o Markdown em trechos por seção, respeitando o tamanho máximo."""

    trechos: list[DocumentChunk] = []
    pilha: list[str] = []
    corpo: list[str] = []

    def fechar() -> None:
        conteudo = "\n".join(corpo).strip()
        corpo.clear()
        if not conteudo:
            return
        # Níveis vazios vêm de saltos de título (## direto para ####) e não
        # devem aparecer na citação mostrada ao usuário.
        caminho = " > ".join(parte for parte in pilha if parte)
        for parte in _split_long_block(conteudo):
            if len(parte) < MIN_CHUNK_CHARS and trechos and trechos[-1].heading_path == caminho:
                # Sobra curta de uma seção dividida: junta ao trecho anterior
                # em vez de virar um trecho solto — ou de se perder.
                anterior = trechos[-1]
                trechos[-1] = replace(anterior, content=f"{anterior.content}\n{parte}")
                continue
            trechos.append(_make_chunk(metadata, caminho, len(trechos), parte))

    for linha in text.splitlines():
        titulo = HEADING.match(linha)
        if titulo is None:
            corpo.append(linha)
            continue

        fechar()
        nivel = len(titulo.group(1))
        del pilha[nivel - 1 :]
        while len(pilha) < nivel - 1:
            # Salto de nível (## seguido de ####): mantém a profundidade coerente.
            pilha.append("")
        pilha.append(titulo.group(2))

    fechar()
    return [trecho for trecho in trechos if trecho.content.strip()]


def chunk_file(path: Path) -> tuple[DocumentMetadata, list[DocumentChunk]]:
    """Lê um arquivo Markdown e devolve seus metadados e trechos."""

    front_matter, corpo = parse_front_matter(path.read_text(encoding="utf-8"))
    metadata = build_metadata(path, front_matter)
    return metadata, chunk_markdown(corpo, metadata)


def _make_chunk(
    metadata: DocumentMetadata,
    heading_path: str,
    position: int,
    content: str,
) -> DocumentChunk:
    identidade = f"{metadata.document_id}|{heading_path}|{position}"
    return DocumentChunk(
        chunk_id=hashlib.sha256(identidade.encode("utf-8")).hexdigest()[:32],
        document_id=metadata.document_id,
        title=metadata.title,
        source=metadata.source,
        confidentiality=metadata.confidentiality,
        heading_path=heading_path,
        position=position,
        content=content.strip(),
    )


def _split_long_block(content: str) -> list[str]:
    """Quebra seções acima do limite em blocos, sem partir parágrafos ao meio."""

    if len(content) <= MAX_CHUNK_CHARS:
        return [content]

    partes: list[str] = []
    atual: list[str] = []
    tamanho = 0

    for bloco in _paragraphs(content):
        if tamanho and tamanho + len(bloco) > MAX_CHUNK_CHARS:
            partes.append("\n\n".join(atual))
            atual, tamanho = [], 0
        if len(bloco) > MAX_CHUNK_CHARS:
            partes.extend(_split_table(bloco))
            continue
        atual.append(bloco)
        tamanho += len(bloco) + 2

    if atual:
        partes.append("\n\n".join(atual))
    return [parte.strip() for parte in partes if parte.strip()]


def _paragraphs(content: str) -> list[str]:
    return [bloco.strip() for bloco in re.split(r"\n\s*\n", content) if bloco.strip()]


def _split_table(bloco: str) -> list[str]:
    """Divide uma tabela longa repetindo o cabeçalho em cada parte."""

    linhas = bloco.splitlines()
    if not (len(linhas) > 2 and TABLE_ROW.match(linhas[0])):
        # Não é tabela: corta por linhas para não estourar o contexto do embedder.
        return ["\n".join(linhas[i : i + 20]) for i in range(0, len(linhas), 20)]

    cabecalho = linhas[:2]
    partes: list[str] = []
    atual: list[str] = []
    tamanho = sum(len(linha) for linha in cabecalho)

    for linha in linhas[2:]:
        if atual and tamanho + len(linha) > MAX_CHUNK_CHARS:
            partes.append("\n".join(cabecalho + atual))
            atual, tamanho = [], sum(len(item) for item in cabecalho)
        atual.append(linha)
        tamanho += len(linha) + 1

    if atual:
        partes.append("\n".join(cabecalho + atual))
    return partes
