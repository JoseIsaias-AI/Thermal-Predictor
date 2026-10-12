"""Estatísticas da base exibidas na tela de engenharia do painel.

São as estatísticas sem modelo que sustentam a avaliação:

- a referência que o modelo precisa superar, a média histórica de cada ponto;
- o desenho da validação, com as rodadas e as configurações que elas repetem;
- a procedência do dado, com as combinações de ponto e rodada sem leitura;
- as quatro hipóteses sobre o dado (HD1, HD2, HD3 e HN);
- os parâmetros do escalonamento em z.

`treinar_modelos.py` grava o resultado no campo `base` de `modelos/desempenho_modelo_final.json`,
que a API serve em `GET /desempenho`. Rodado sozinho, o script imprime o resultado sem treinar:

    python sintetico/estatisticas_da_base.py
"""

import json
import math
import sys

import numpy as np
import pandas as pd
from scipy import stats

ALFA = 0.05
TOLERANCIA_FRACAO = 0.10
PISO_COBERTURA_PCT = 90.0
SEMENTE = 42
REAMOSTRAGENS_HD1 = 2000
PERMUTACOES_HD2 = 10000
MODO_DE_PICO = "Pyro"
PONTOS_DE_MAIOR_RISCO = 10


def wilson(acertos, total, z=1.959963985):
    """Intervalo de Wilson a 95%, em porcentagem."""
    if not total:
        return [0.0, 0.0]
    p = acertos / total
    centro = (p + z * z / (2 * total)) / (1 + z * z / total)
    raio = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / (1 + z * z / total)
    return [round(100 * (centro - raio), 2), round(100 * (centro + raio), 2)]


def _observadas(base):
    return base[base["missing_class"] == "observed"]


def _com_limite(base):
    return _observadas(base).dropna(subset=["limit_c"])


def referencia(base):
    """A média histórica do ponto como previsão, deixando de fora a rodada avaliada.

    Calculada sobre as próprias linhas em que é avaliada, a média enxerga a rodada que está sendo
    prevista e erra menos do que erraria numa configuração nova. O valor na amostra vai junto, para
    mostrar o tamanho dessa vantagem indevida.
    """
    linhas = _observadas(base)[["TC_Name", "Value", "limit_c"]].copy()
    grupo = linhas.groupby("TC_Name")["Value"]
    soma, contagem = grupo.transform("sum"), grupo.transform("count")
    linhas = linhas[contagem > 1].copy()
    soma, contagem = soma[contagem > 1], contagem[contagem > 1]
    linhas["erro"] = ((soma - linhas["Value"]) / (contagem - 1) - linhas["Value"]).abs()
    linhas["erro_na_amostra"] = (soma / contagem - linhas["Value"]).abs()

    por_ponto = (linhas.dropna(subset=["limit_c"]).groupby("TC_Name")
                 .agg(mae=("erro", "mean"), limite=("limit_c", "first")))
    cobertos = int((por_ponto["mae"] <= TOLERANCIA_FRACAO * por_ponto["limite"]).sum())
    total = int(len(por_ponto))
    return {
        "estrategia": "Média histórica do ponto, deixando de fora a rodada avaliada.",
        "mae_c": linhas["erro"].mean(),
        "mae_na_amostra_c": linhas["erro_na_amostra"].mean(),
        "pontos_cobertos": cobertos,
        "pontos_com_limite": total,
        "cobertura_pct": 100 * cobertos / total if total else None,
        "cobertura_wilson_pct": wilson(cobertos, total),
        "cobertura_exigida_pct": PISO_COBERTURA_PCT,
    }


def validacao(configuracao_da_rodada, configuracoes_possiveis):
    """Quantas rodadas repetem a configuração de outra: o argumento da validação agrupada."""
    rodadas = pd.Series(configuracao_da_rodada)
    por_configuracao = rodadas.value_counts()
    distribuicao = por_configuracao.value_counts().sort_index()
    compartilhadas = int(por_configuracao[por_configuracao > 1].sum())
    return {
        "rodadas": int(len(rodadas)),
        "configuracoes": int(len(por_configuracao)),
        "configuracoes_possiveis": int(configuracoes_possiveis),
        "rodadas_em_configuracao_compartilhada": compartilhadas,
        "rodadas_em_configuracao_compartilhada_pct": 100 * compartilhadas / len(rodadas),
        "distribuicao": [
            {"rodadas_por_configuracao": int(rodadas_por), "configuracoes": int(configuracoes),
             "rodadas": int(rodadas_por * configuracoes)}
            for rodadas_por, configuracoes in distribuicao.items()
        ],
    }


def procedencia(base):
    """Combinações de ponto e rodada sem leitura, por classe de ausência."""
    combinacoes = len(base)
    sem_leitura = base[base["missing_class"] != "observed"]
    estrutural = sem_leitura["missing_class"].str.startswith("structural")
    return {
        "pontos": int(base["TC_Name"].nunique()),
        "rodadas": int(base["Run_ID"].nunique()),
        "combinacoes": int(combinacoes),
        "sem_leitura": int(len(sem_leitura)),
        "sem_leitura_pct": 100 * len(sem_leitura) / combinacoes,
        "estruturais": int(estrutural.sum()),
        "aleatorias": int((~estrutural).sum()),
        "observacoes": int(combinacoes - len(sem_leitura)),
        "por_classe": [
            {"classe": classe,
             "mecanismo": "Estrutural" if classe.startswith("structural") else "Aleatória",
             "ocorrencias": int(ocorrencias)}
            for classe, ocorrencias in sem_leitura["missing_class"].value_counts().items()
        ],
    }


def _tabela_de_violacoes(codigos, violou, pontos):
    violacoes = np.bincount(codigos, weights=violou, minlength=pontos)
    leituras = np.bincount(codigos, minlength=pontos)
    return np.column_stack([violacoes, leituras - violacoes])


def hd1(base, rng):
    """HD1: as violações de limite se concentram em poucos pontos (qui-quadrado de homogeneidade).

    Com muitas células de frequência esperada baixa, a aproximação assintótica perde validade, e a
    decisão é conferida por reamostragem: as violações são embaralhadas entre as leituras.
    """
    linhas = _com_limite(base)
    violou = (linhas["Value"] > linhas["limit_c"]).to_numpy(dtype=float)
    codigos, nomes = pd.factorize(linhas["TC_Name"])
    tabela = _tabela_de_violacoes(codigos, violou, len(nomes))
    violacoes = pd.Series(tabela[:, 0], index=nomes).sort_values(ascending=False)
    total = int(violacoes.sum())
    resultado = {
        "teste": "Qui-quadrado de homogeneidade",
        "pontos": int(len(nomes)),
        "leituras": int(len(linhas)),
        "violacoes": total,
        "pontos_com_violacao": int((violacoes > 0).sum()),
        "violacoes_dos_pontos_de_maior_risco": int(violacoes.head(PONTOS_DE_MAIOR_RISCO).sum()),
        "pontos_de_maior_risco": PONTOS_DE_MAIOR_RISCO,
        "reamostragens": REAMOSTRAGENS_HD1,
    }
    if total == 0 or total == len(linhas):
        resultado.update(estatistica=None, gl=None, p=None, celulas=int(tabela.size),
                         celulas_esperadas_abaixo_de_5=None, reamostragens_que_alcancaram=None,
                         p_reamostragem=None, rejeita_h0=False)
        return resultado

    qui = stats.chi2_contingency(tabela, correction=False)
    alcancaram = sum(
        stats.chi2_contingency(_tabela_de_violacoes(codigos, rng.permutation(violou), len(nomes)),
                               correction=False).statistic >= qui.statistic
        for _ in range(REAMOSTRAGENS_HD1))
    resultado.update(
        estatistica=qui.statistic,
        gl=int(qui.dof),
        p=qui.pvalue,
        celulas=int(tabela.size),
        celulas_esperadas_abaixo_de_5=int((qui.expected_freq < 5).sum()),
        reamostragens_que_alcancaram=int(alcancaram),
        p_reamostragem=(alcancaram + 1) / (REAMOSTRAGENS_HD1 + 1),
        rejeita_h0=bool(qui.pvalue < ALFA and (alcancaram + 1) / (REAMOSTRAGENS_HD1 + 1) < ALFA),
    )
    return resultado


def _permutacao(valores, grupo, rng):
    """Valor-p bilateral da diferença de médias, permutando o rótulo entre as rodadas."""
    observada = valores[grupo].mean() - valores[~grupo].mean()
    rotulos = rng.permuted(np.tile(grupo, (PERMUTACOES_HD2, 1)), axis=1)
    no_grupo = rotulos.sum(axis=1)
    diferencas = ((rotulos * valores).sum(axis=1) / no_grupo
                  - ((~rotulos) * valores).sum(axis=1) / (len(valores) - no_grupo))
    alcancaram = int((np.abs(diferencas) >= abs(observada) - 1e-12).sum())
    return (alcancaram + 1) / (PERMUTACOES_HD2 + 1)


def hd2(base, rng):
    """HD2: o modo de maior pico, Pyro, não é o mais arriscado para os pontos com limite.

    O modo é atributo da rodada, e não da leitura: a unidade de análise é a rodada. O teste sobre
    leituras vai junto para mostrar quanto tratá-las como independentes infla a significância.
    """
    linhas = _com_limite(base).copy()
    linhas["violou"] = linhas["Value"] > linhas["limit_c"]
    linhas["margem"] = linhas["limit_c"] - linhas["Value"]
    por_rodada = linhas.groupby("Run_ID").agg(
        proporcao=("violou", "mean"), margem=("margem", "mean"), modo=("Run_Case", "first"))
    pico = (por_rodada["modo"] == MODO_DE_PICO).to_numpy()
    proporcao = por_rodada["proporcao"].to_numpy()
    margem = por_rodada["margem"].to_numpy()

    mw_proporcao = stats.mannwhitneyu(proporcao[pico], proporcao[~pico], alternative="two-sided")
    mw_margem = stats.mannwhitneyu(margem[pico], margem[~pico], alternative="two-sided")
    p_proporcao = _permutacao(proporcao, pico, rng)
    p_margem = _permutacao(margem, pico, rng)

    # O mesmo contraste sobre leituras, como se fossem independentes.
    em_pico = (linhas["Run_Case"] == MODO_DE_PICO).to_numpy()
    violou = linhas["violou"].to_numpy()
    n1, n2 = int(em_pico.sum()), int((~em_pico).sum())
    p1, p2 = violou[em_pico].mean(), violou[~em_pico].mean()
    comum = violou.mean()
    z = (p1 - p2) / math.sqrt(comum * (1 - comum) * (1 / n1 + 1 / n2))

    # Direção do efeito em cada ponto: a temperatura média no modo contra a dos demais modos.
    medias = (linhas.assign(no_modo=em_pico).groupby(["TC_Name", "no_modo"])["Value"].mean()
              .unstack().dropna())

    return {
        "teste": "Permutação do rótulo de modo entre as rodadas e Mann-Whitney",
        "modo": MODO_DE_PICO,
        "rodadas": int(len(por_rodada)),
        "rodadas_no_modo": int(pico.sum()),
        "leituras": int(len(linhas)),
        "proporcao_no_modo_pct": 100 * proporcao[pico].mean(),
        "proporcao_nos_demais_pct": 100 * proporcao[~pico].mean(),
        "proporcao_p_permutacao": p_proporcao,
        "proporcao_u": float(mw_proporcao.statistic),
        "proporcao_p_mann_whitney": float(mw_proporcao.pvalue),
        "proporcao_rejeita_h0": bool(p_proporcao < ALFA),
        "margem_no_modo_c": margem[pico].mean(),
        "margem_nos_demais_c": margem[~pico].mean(),
        "margem_p_permutacao": p_margem,
        "margem_u": float(mw_margem.statistic),
        "margem_p_mann_whitney": float(mw_margem.pvalue),
        "margem_rejeita_h0": bool(p_margem < ALFA),
        "leituras_z": z,
        "leituras_p": 2 * stats.norm.sf(abs(z)),
        "pontos_que_esquentam_no_modo": int((medias[True] > medias[False]).sum()),
        "pontos_que_esfriam_no_modo": int((medias[True] < medias[False]).sum()),
    }


def hd3(base):
    """HD3: o limite declarado covaria com a variabilidade da temperatura do próprio ponto."""
    por_ponto = (_com_limite(base).groupby("TC_Name")
                 .agg(limite=("limit_c", "first"), desvio=("Value", "std"), leituras=("Value", "count")))
    por_ponto = por_ponto[por_ponto["leituras"] >= 3]
    pearson = stats.pearsonr(por_ponto["limite"], por_ponto["desvio"])
    spearman = stats.spearmanr(por_ponto["limite"], por_ponto["desvio"])
    limites = base["limit_c"].dropna()
    return {
        "teste": "Correlação de Pearson, com Spearman como verificação",
        "n": int(len(por_ponto)),
        "r": float(pearson.statistic),
        "p": float(pearson.pvalue),
        "rho": float(spearman.statistic),
        "p_spearman": float(spearman.pvalue),
        "rejeita_h0": bool(pearson.pvalue < ALFA),
        "limite_min_c": float(limites.min()),
        "limite_max_c": float(limites.max()),
    }


def _variaveis(base):
    """As três variáveis quantitativas: temperatura, limite do ponto e margem térmica."""
    observadas = _observadas(base)
    return {
        "Value": observadas["Value"],
        "limit_c": base["limit_c"],
        "margem_termica": (observadas["limit_c"] - observadas["Value"]).dropna(),
    }


def hn(base):
    """HN: as variáveis quantitativas seguem distribuição normal (Shapiro-Wilk)."""
    variaveis = _variaveis(base)
    # O limite é atributo do ponto: cada ponto entra uma vez.
    variaveis["limit_c"] = base.dropna(subset=["limit_c"]).drop_duplicates("TC_Name")["limit_c"]
    resultado = []
    for nome, serie in variaveis.items():
        shapiro = stats.shapiro(serie.dropna())
        resultado.append({"variavel": nome, "n": int(serie.notna().sum()),
                          "w": float(shapiro.statistic), "p": float(shapiro.pvalue),
                          "rejeita_h0": bool(shapiro.pvalue < ALFA)})
    return resultado


def escalonamento(base):
    """Média e desvio padrão populacional de cada variável padronizada em z."""
    return [{"variavel": nome, "n": int(serie.notna().sum()),
             "media_c": float(serie.mean()), "desvio_c": float(serie.std(ddof=0))}
            for nome, serie in _variaveis(base).items()]


CHAVES_DE_P = {"p", "p_reamostragem", "p_spearman", "proporcao_p_permutacao",
               "proporcao_p_mann_whitney", "margem_p_permutacao", "margem_p_mann_whitney",
               "leituras_p"}


def _limpar(valor, chave=None):
    """Tipos do JSON, com quatro casas; os valores-p ficam inteiros, para a notação científica."""
    if isinstance(valor, dict):
        return {k: _limpar(v, k) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_limpar(v, chave) for v in valor]
    if isinstance(valor, (bool, np.bool_)):
        return bool(valor)
    if isinstance(valor, (int, np.integer)):
        return int(valor)
    if isinstance(valor, (float, np.floating)):
        if math.isnan(valor):
            return None
        return float(valor) if chave in CHAVES_DE_P else round(float(valor), 4)
    return valor


def calcular(base, configuracao_da_rodada, configuracoes_possiveis, semente=SEMENTE):
    """Todas as estatísticas da tela, no formato do campo `base` de `GET /desempenho`."""
    rng = np.random.default_rng(semente)
    return _limpar({
        "referencia": referencia(base),
        "validacao": validacao(configuracao_da_rodada, configuracoes_possiveis),
        "procedencia": procedencia(base),
        "hipoteses": {"alfa": ALFA, "hd1": hd1(base, rng), "hd2": hd2(base, rng),
                      "hd3": hd3(base), "hn": hn(base)},
        "escalonamento": escalonamento(base),
    })


def main():
    import treinar_modelos

    base, _, _, configuracao_da_rodada = treinar_modelos.carregar_base(treinar_modelos.ARQUIVO_BASE)
    resultado = calcular(base, configuracao_da_rodada,
                         treinar_modelos.configuracoes_possiveis(base))
    json.dump(resultado, sys.stdout, ensure_ascii=False, indent=2)
    print()


if __name__ == "__main__":
    main()
