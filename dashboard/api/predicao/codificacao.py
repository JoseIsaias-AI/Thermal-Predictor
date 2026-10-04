"""Converte a configuração do formulário nas colunas codificadas que os modelos esperam.

Porte da função `montar_vetor_configuracao` do notebook `5_implantacao/exportacao_*.ipynb`,
parametrizado pela lista de colunas gravada nos metadados de cada modelo: um modelo novo com
outra codificação continua funcionando sem mexer aqui.
"""

from .protocolo import ConfiguracaoInvalida

# Categoria de referência de cada bloco, removida na codificação: quando a configuração
# corresponde a ela, todas as colunas do bloco ficam em zero.
REFERENCIAS = {
    "Run_Case": "Broil Qualitative",
    "Blower_Direction": "To Front",
    "Housing": "Closed",
    "Board_Position": "Center",
    "Deflector_Hole": "Closed",
    "Material_Coil_Support": "Aluminium",
}

# "Open - Updated" foi tratado como "Open" na construção das tabelas (notebooks 06 a 11).
SINONIMOS = {"Open - Updated": "Open"}

COLUNA_TERMOPAR = "codigo_termopar"


def _valor_obrigatorio(configuracao, chave):
    if chave not in configuracao or configuracao[chave] in (None, ""):
        raise ConfiguracaoInvalida(f"Fator obrigatório ausente: {chave!r}.")

    return configuracao[chave]


def _codificar_perdas(configuracao, vetor):
    """Bloco `Losses`, decomposto em presença, configuração e ordem (Seção 4.2.2d)."""
    perdas = configuracao.get("losses") or {}

    if not isinstance(perdas, dict):
        raise ConfiguracaoInvalida("O fator 'losses' precisa ser um objeto.")

    presenca = perdas.get("present")

    if presenca not in ("declared", "missing", "none"):
        raise ConfiguracaoInvalida(f"Nível fora do vocabulário em 'losses.present': {presenca!r}.")

    if presenca == "missing" and "losses_present_missing" in vetor:
        vetor["losses_present_missing"] = 1.0

    # As duas condições são equivalentes na base, e a equivalência vale nos dois sentidos: na
    # base, todas as rodadas `Pyro` são exatamente as rodadas sem perda declarada, e `losses_present_none`
    # foi descartada na codificação por ser idêntica a `Run_Case_Pyro` (Seção 4.2.2d). Recusar
    # só um dos lados deixava passar `Pyro` com perda declarada: combinação representável nas
    # colunas, mas que nenhuma rodada mediu, e o modelo responderia extrapolando sem aviso.
    if (presenca == "none") != (configuracao.get("run_case") == "Pyro"):
        raise ConfiguracaoInvalida(
            "Combinação sem representação na base: as rodadas Pyro são exatamente as rodadas "
            "sem perda declarada, e as duas condições são a mesma coluna na codificação. "
            f"Recebido run_case={configuracao.get('run_case')!r} com "
            f"losses.present={presenca!r}."
        )

    if presenca != "declared":
        return

    arranjo = perdas.get("config")

    if arranjo == "Config M" and "losses_config_m" in vetor:
        vetor["losses_config_m"] = 1.0
    elif arranjo not in (None, "", "Config S", "Config M"):
        raise ConfiguracaoInvalida(f"Nível fora do vocabulário em 'losses.config': {arranjo!r}.")

    ordem = perdas.get("order")
    colunas_de_ordem = {
        "Front Order": "losses_order_front_order",
        "Back Order": "losses_order_back_order",
    }

    if ordem in colunas_de_ordem:
        coluna = colunas_de_ordem[ordem]
        if coluna in vetor:
            vetor[coluna] = 1.0
    elif ordem not in (None, ""):
        raise ConfiguracaoInvalida(f"Nível fora do vocabulário em 'losses.order': {ordem!r}.")


def montar_vetor_configuracao(configuracao, colunas):
    """Vetor de configuração na ordem de `colunas`, sem a coluna do termopar."""
    vetor = {coluna: 0.0 for coluna in colunas}

    for fator, referencia in REFERENCIAS.items():
        chave = fator.lower()
        bruto = _valor_obrigatorio(configuracao, chave)
        valor = SINONIMOS.get(bruto, bruto)
        coluna = f"{fator}_{valor}"
        niveis = [c for c in colunas if c.startswith(f"{fator}_")]

        if valor == referencia:
            continue

        if coluna not in niveis:
            aceitos = sorted([referencia] + [c[len(fator) + 1 :] for c in niveis])
            raise ConfiguracaoInvalida(
                f"Nível fora do vocabulário em {chave!r}: {bruto!r}. Aceitos: {aceitos}."
            )

        vetor[coluna] = 1.0

    _codificar_perdas(configuracao, vetor)

    return [vetor[coluna] for coluna in colunas]


def separar_colunas(colunas_entrada):
    """Separa as colunas de configuração da coluna do termopar."""
    colunas = list(colunas_entrada)

    if not colunas or colunas[-1] != COLUNA_TERMOPAR:
        raise ValueError(
            f"Metadados sem a coluna {COLUNA_TERMOPAR!r} na última posição de 'colunas_entrada'."
        )

    return colunas[:-1]
