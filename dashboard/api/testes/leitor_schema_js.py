"""Leitor do dicionário de features do painel (`dashboard/js/nucleo/schema.js`).

Existe só para o teste de paridade: a API não depende do painel em tempo de execução.
"""

import json
import re
from pathlib import Path


def _remover_comentarios(texto):
    """Remove comentários de bloco e de linha preservando o que está entre aspas."""
    sem_bloco = re.sub(r"/\*.*?\*/", "", texto, flags=re.DOTALL)
    return re.sub(r'^\s*//.*$', "", sem_bloco, flags=re.MULTILINE)


def ler_schema_js(caminho):
    """Devolve o objeto SCHEMA de `dashboard/js/nucleo/schema.js` como dicionário."""
    texto = Path(caminho).read_text(encoding="utf-8")
    corpo = texto.split("var SCHEMA =", 1)[1].rsplit("};", 1)[0] + "}"
    corpo = _remover_comentarios(corpo)

    # Chaves sem aspas e vírgulas sobrando não são JSON válido; o resto já é.
    corpo = re.sub(r'(^|[{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', corpo)
    corpo = re.sub(r",(\s*[}\]])", r"\1", corpo)

    return json.loads(corpo)
