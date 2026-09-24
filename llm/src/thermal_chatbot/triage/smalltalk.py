"""Cortesia respondida localmente, sem gastar geração do modelo.

Uma saudação não depende de documentação, dataset nem previsão: a resposta é
sempre a mesma e pode ser escrita em código. Mandá-la ao Qwen custaria as duas
chamadas do fluxo normal — em CPU, dezenas de segundos para dizer "olá".

O reconhecimento é deliberadamente estreito. Só responde quando a mensagem
*inteira* é cortesia: basta uma palavra fora do vocabulário de saudação para
devolver ``None`` e manter o roteamento normal. Assim "Oi, o que é Blower
Direction?" continua indo para a documentação, em vez de virar um "olá" que
ignora a pergunta.
"""

import re
from collections.abc import Collection

from thermal_chatbot.schemas import ToolName
from thermal_chatbot.triage.text import normalize, tokens

# Mensagem longa não é cortesia pura. O corte evita varrer um texto grande só
# para descobrir que uma das quarenta palavras não está no vocabulário.
MAX_CHARS = 160

GREETING_WORDS = frozenset(
    {
        "oi",
        "oie",
        "ola",
        "opa",
        "eai",
        "ei",
        "hey",
        "hi",
        "hello",
        "alo",
        "salve",
    }
)

# Pares que só saúdam quando aparecem juntos: "bom" e "dia" isolados são
# palavras comuns de uma pergunta técnica.
GREETING_PHRASES = (
    ("bom", "dia"),
    ("boa", "tarde"),
    ("boa", "noite"),
    ("boa", "madrugada"),
    ("tudo", "bem"),
    ("tudo", "bom"),
    ("como", "vai"),
    ("e", "ai"),
)

# Palavras que acompanham a saudação sem acrescentar pergunta.
GREETING_FILLERS = frozenset(
    {
        "bom",
        "boa",
        "dia",
        "tarde",
        "noite",
        "madrugada",
        "tudo",
        "bem",
        "beleza",
        "blz",
        "td",
        "como",
        "vai",
        "voce",
        "vc",
        "esta",
        "ta",
        "tao",
        "e",
        "ai",
        "entao",
        "com",
        "contigo",
        "tranquilo",
        "certo",
        "por",
        "favor",
        "pessoal",
        "galera",
        "amigo",
        "assistente",
    }
)

THANKS_WORDS = frozenset(
    {
        "obrigado",
        "obrigada",
        "obrigadao",
        "obg",
        "brigado",
        "valeu",
        "vlw",
        "agradecido",
        "thanks",
    }
)

THANKS_FILLERS = frozenset(
    {
        "muito",
        "mto",
        "mt",
        "demais",
        "mesmo",
        "pela",
        "pelo",
        "pelas",
        "pelos",
        "de",
        "da",
        "do",
        "a",
        "o",
        "ajuda",
        "ajudar",
        "ajudou",
        "explicacao",
        "informacao",
        "informacoes",
        "resposta",
        "respostas",
        "nada",
        "ok",
        "okay",
        "otimo",
        "perfeito",
    }
)

FAREWELL_WORDS = frozenset(
    {
        "tchau",
        "adeus",
        "falou",
        "flw",
        "bye",
        "abraco",
        "abracos",
    }
)

FAREWELL_PHRASES = (
    ("ate", "mais"),
    ("ate", "logo"),
    ("ate", "breve"),
    ("ate", "amanha"),
    ("ate", "depois"),
)

FAREWELL_FILLERS = frozenset(
    {
        "ate",
        "mais",
        "logo",
        "breve",
        "depois",
        "amanha",
        "mesmo",
    }
)

# Perguntas sobre a própria ferramenta. A resposta é o que esta execução sabe
# fazer, não um dado do projeto: também cabe em código.
HELP_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"(?:o que|oq|que) (?:voce|vc|tu) (?:faz|fazes)",
        r"(?:o que|oq|que) (?:voce|vc) (?:pode|consegue|sabe|poderia) fazer",
        r"(?:voce|vc) (?:pode|consegue|poderia) (?:me )?ajudar(?: com (?:o )?que)?",
        r"(?:com |em |n)?o que (?:voce|vc) (?:pode |consegue )?(?:me )?ajudar?",
        r"como (?:voce|vc) (?:pode |consegue |poderia )?(?:me )?ajudar?",
        r"(?:para|pra) (?:o )?que (?:voce|vc) serve",
        r"(?:para|pra) que serve(?: (?:esse|este|o) (?:chat|chatbot|assistente|bot))?",
        r"quais (?:sao )?(?:as )?(?:suas )?(?:funcoes|funcionalidades|capacidades)",
        r"(?:me )?ajudar?",
        r"preciso de ajuda",
    )
)

# Quem pergunta o nome quer o nome, não a lista inteira de capacidades.
NAME_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"quem (?:e|eh) (?:voce|vc)",
        r"(?:qual|qual e|qual eh) (?:o )?(?:seu|teu) nome",
        r"como (?:voce|vc) se chama",
    )
)

# Só estes acompanham a saudação inicial de um pedido de ajuda. "como" e
# "voce" ficam de fora porque abrem o próprio pedido ("como você me ajuda?").
PREFIX_FILLERS = frozenset(
    {"bom", "boa", "dia", "tarde", "noite", "madrugada", "tudo", "bem", "blz", "beleza"}
)

GREETING_ANSWER = (
    "Olá! Eu sou o Robertão, assistente do Thermal Predictor, a ferramenta de "
    "triagem térmica. Posso explicar termos e fatores do projeto, consultar as "
    "temperaturas já medidas nos ensaios e comparar cenários com os modelos "
    "treinados. Qual é a sua dúvida?"
)

# O que dizer quando perguntam o que a ferramenta faz. A lista é montada com
# as fontes realmente registradas nesta execução: prometer uma consulta que o
# backend não tem conectada seria a mesma invenção que o prompt proíbe.
CAPABILITY_LINES: dict[ToolName, str] = {
    ToolName.DOCUMENTATION_SEARCH: (
        "- explicar termos, fatores e níveis do projeto a partir da "
        "documentação autorizada — por exemplo, o que é Blower Direction;"
    ),
    ToolName.DATASET_QUERY: (
        "- consultar as temperaturas já medidas em ensaio, filtrando por "
        "termopar, região ou configuração;"
    ),
    ToolName.THERMAL_PREDICTION: (
        "- prever e comparar cenários com os modelos treinados — por exemplo, "
        "o efeito de mudar Blower Direction de To Back para To Front, "
        "mantendo os demais fatores fixos."
    ),
}

NAME_ANSWER = (
    "Eu sou o Robertão, assistente do Thermal Predictor. Posso explicar os "
    "termos do projeto, consultar os ensaios já medidos e comparar cenários "
    "previstos. Qual é a sua dúvida?"
)

HELP_INTRO = "Sou o Robertão, assistente do Thermal Predictor. Posso ajudar com:"

HELP_CLOSING = (
    "Para uma previsão preciso dos seis fatores e das perdas; se faltar "
    "algum, eu digo o que falta em vez de supor um nível. O resultado é "
    "triagem preliminar e não substitui ensaio nem validação de engenharia. "
    "Qual é a sua dúvida?"
)

SEM_FONTES = (
    "Sou o Robertão, assistente do Thermal Predictor, mas nenhuma fonte "
    "autorizada está conectada nesta execução, então não vou responder dados "
    "do projeto de cabeça. Posso explicar conceitos gerais de análise térmica "
    "enquanto isso."
)


THANKS_ANSWER = (
    "Por nada! Se aparecer outra dúvida sobre os fatores, os ensaios ou uma "
    "comparação de cenários, é só perguntar."
)

FAREWELL_ANSWER = (
    "Até mais! Quando precisar de outra consulta ou comparação térmica, é só "
    "chamar."
)


def smalltalk_answer(
    message: str,
    available_tools: Collection[ToolName] = (),
) -> str | None:
    """Devolve a resposta de cortesia quando a mensagem é só cortesia."""

    text = normalize(message)
    if not text or len(text) > MAX_CHARS:
        return None

    words = tokens(text)
    if not words:
        return None

    # Antes da saudação: "oi, o que você faz?" pergunta alguma coisa, e um
    # "olá" isolado deixaria a pergunta sem resposta.
    if _matches(words, NAME_PATTERNS):
        return NAME_ANSWER
    if _is_help_request(words):
        return help_answer(available_tools)
    if _is_only(words, THANKS_WORDS, THANKS_WORDS | THANKS_FILLERS | GREETING_FILLERS):
        return THANKS_ANSWER
    if _is_farewell(words):
        return FAREWELL_ANSWER
    if _is_greeting(words):
        return GREETING_ANSWER
    return None


def _is_greeting(words: list[str]) -> bool:
    triggered = any(word in GREETING_WORDS for word in words) or _has_phrase(
        words, GREETING_PHRASES
    )
    return triggered and _all_within(words, GREETING_WORDS | GREETING_FILLERS)


def _is_farewell(words: list[str]) -> bool:
    triggered = any(word in FAREWELL_WORDS for word in words) or _has_phrase(
        words, FAREWELL_PHRASES
    )
    allowed = FAREWELL_WORDS | FAREWELL_FILLERS | GREETING_WORDS | GREETING_FILLERS
    return triggered and _all_within(words, allowed)


def _is_only(words: list[str], triggers: frozenset[str], allowed: frozenset[str]) -> bool:
    return any(word in triggers for word in words) and _all_within(words, allowed)


def _all_within(words: list[str], allowed: frozenset[str]) -> bool:
    return all(word in allowed for word in words)


def _has_phrase(words: list[str], phrases: tuple[tuple[str, ...], ...]) -> bool:
    return any(
        tuple(words[index : index + len(phrase)]) == phrase
        for phrase in phrases
        for index in range(len(words) - len(phrase) + 1)
    )


def _is_help_request(words: list[str]) -> bool:
    return _matches(words, HELP_PATTERNS)


def _matches(words: list[str], patterns: tuple[re.Pattern[str], ...]) -> bool:
    """Compara o pedido depois de descartar a saudação que o antecede."""

    core = list(words)
    while core and (core[0] in GREETING_WORDS or core[0] in PREFIX_FILLERS):
        core.pop(0)
    if not core:
        return False

    pedido = " ".join(core)
    return any(pattern.fullmatch(pedido) for pattern in patterns)


def help_answer(available_tools: Collection[ToolName]) -> str:
    """Descreve apenas as fontes que esta execução tem realmente conectadas."""

    linhas = [
        texto for fonte, texto in CAPABILITY_LINES.items() if fonte in available_tools
    ]
    if not linhas:
        return SEM_FONTES
    return "\n".join([HELP_INTRO, *linhas, "", HELP_CLOSING])
