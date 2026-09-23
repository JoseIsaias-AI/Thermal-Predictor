from pathlib import Path

from thermal_chatbot.rag.chunking import (
    MAX_CHUNK_CHARS,
    build_metadata,
    chunk_file,
    chunk_markdown,
    parse_front_matter,
)

DOCUMENTO = """---
titulo: "Glossário de teste"
fonte_primaria: "glossario.pdf"
fonte_url: "https://exemplo.invalid/doc"
confidencialidade: "Confidencial — uso interno"
---

# Glossário de teste

## 3. Blower Position

Texto introdutório da seção 3.

### 3.2. Blower Direction

A direção do soprador define o sentido do fluxo de ar no fogão.
"""


def metadata_de_teste():
    front_matter, corpo = parse_front_matter(DOCUMENTO)
    return build_metadata(Path("glossario.md"), front_matter), corpo


def test_extrai_front_matter_como_metadado() -> None:
    metadata, corpo = metadata_de_teste()

    assert metadata.title == "Glossário de teste"
    assert metadata.source == "glossario.pdf (https://exemplo.invalid/doc)"
    assert metadata.confidentiality == "Confidencial — uso interno"
    assert corpo.lstrip().startswith("# Glossário de teste")


def test_separa_trechos_por_secao_com_caminho_de_titulos() -> None:
    metadata, corpo = metadata_de_teste()

    trechos = chunk_markdown(corpo, metadata)

    caminhos = [trecho.heading_path for trecho in trechos]
    assert "Glossário de teste > 3. Blower Position" in caminhos
    assert (
        "Glossário de teste > 3. Blower Position > 3.2. Blower Direction" in caminhos
    )

    direcao = next(t for t in trechos if t.heading_path.endswith("3.2. Blower Direction"))
    assert "sentido do fluxo de ar" in direcao.content
    assert "Texto introdutório" not in direcao.content


def test_citacao_aponta_documento_e_secao() -> None:
    metadata, corpo = metadata_de_teste()

    trecho = chunk_markdown(corpo, metadata)[-1]

    # A citação carrega apenas a seção mais profunda, que já é numerada.
    assert trecho.citation == "glossario.md § 3.2. Blower Direction"
    # O texto vetorizado repete a hierarquia: o trecho não pode depender do vizinho.
    assert trecho.embedding_text.startswith("Glossário de teste")


def test_secao_longa_vira_varios_trechos_dentro_do_limite() -> None:
    metadata, _ = metadata_de_teste()
    paragrafo = "Perdas medidas em watts para cada componente do conjunto. "
    corpo = "## 5. Losses\n\n" + "\n\n".join([paragrafo * 8] * 12)

    trechos = chunk_markdown(corpo, metadata)

    assert len(trechos) > 1
    assert all(len(trecho.content) <= MAX_CHUNK_CHARS for trecho in trechos)
    assert {trecho.heading_path for trecho in trechos} == {"5. Losses"}
    assert len({trecho.chunk_id for trecho in trechos}) == len(trechos)


def test_tabela_longa_repete_o_cabecalho_em_cada_parte() -> None:
    metadata, _ = metadata_de_teste()
    linhas = [f"| Componente {i} | {i * 3},5 W | Cenário C1 | observação longa |" for i in range(90)]
    corpo = "## 5.4. Tabela de perdas\n\n| Componente | Perda | Cenário | Nota |\n|---|---|---|---|\n" + "\n".join(linhas)

    trechos = chunk_markdown(corpo, metadata)

    assert len(trechos) > 1
    assert all(trecho.content.startswith("| Componente | Perda |") for trecho in trechos)


def test_le_arquivo_do_disco(tmp_path: Path) -> None:
    caminho = tmp_path / "glossario.md"
    caminho.write_text(DOCUMENTO, encoding="utf-8")

    metadata, trechos = chunk_file(caminho)

    assert metadata.document_id == "glossario.md"
    assert trechos
    assert all(trecho.confidentiality == "Confidencial — uso interno" for trecho in trechos)
