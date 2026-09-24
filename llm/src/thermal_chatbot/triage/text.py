"""Normalização de texto compartilhada pelos reconhecedores locais.

Os reconhecedores comparam a mensagem com vocabulário controlado. Para que
"Direção", "direcao" e "DIREÇÃO" caiam na mesma comparação, todos partem da
mesma forma normalizada.
"""

import re
import unicodedata

_TOKEN = re.compile(r"[a-z0-9]+")


def normalize(value: str) -> str:
    """Devolve o texto em minúsculas, sem acentos e com espaços colapsados."""

    decomposed = unicodedata.normalize("NFKD", value.casefold())
    without_accents = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_accents).strip()


def tokens(value: str) -> list[str]:
    """Separa o texto normalizado em palavras, descartando pontuação."""

    return _TOKEN.findall(normalize(value))
