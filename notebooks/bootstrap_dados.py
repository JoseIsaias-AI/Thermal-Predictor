"""Geração de amostras bootstrap para as tabelas do projeto.

O módulo implementa a estratégia definida em `documents/extras/relatorio_aumento_de_dados.md`:
a reamostragem sorteia **configurações experimentais inteiras**, e não linhas isoladas, porque as
medições de uma mesma configuração não são independentes, e mantém a composição por modo de ensaio,
que o desenho experimental fixa. As duas regras são padrão, e qualquer uma delas pode ser desligada
pelos parâmetros.

Três funções bastam para usar o módulo:

- `amostra_bootstrap` devolve uma reamostragem;
- `amostras_bootstrap` devolve várias, com sementes independentes e reprodutíveis;
- `aplicar_em_amostras` calcula uma estatística em cada reamostragem, que é o uso final.

Nenhuma delas altera a tabela recebida: a saída é sempre uma cópia com as mesmas colunas e os mesmos
tipos, e o índice reiniciado.
"""
import numpy as np
import pandas as pd
from joblib import Parallel, delayed

SEMENTE = 42
UNIDADE_PADRAO = "configuracao"
ESTRATO_PADRAO = "modo"
REAMOSTRAGENS_PADRAO = 2000


def _rotulos(tabela, coluna, nome_do_parametro):
    """Aceita nome de coluna ou vetor de rótulos, e devolve o vetor correspondente."""
    if coluna is None:
        return None

    if isinstance(coluna, str):
        if coluna not in tabela.columns:
            raise KeyError(
                f"{nome_do_parametro}: a tabela não tem a coluna '{coluna}'. Passe o nome de uma "
                f"coluna existente, um vetor de rótulos ou None.")

        return tabela[coluna].to_numpy()

    rotulos = np.asarray(coluna)

    if len(rotulos) != len(tabela):
        raise ValueError(f"{nome_do_parametro}: o vetor tem {len(rotulos)} rótulos para "
                         f"{len(tabela)} linhas.")

    return rotulos


def _quantidades_por_estrato(contagem, tamanho):
    """Quantas unidades sortear em cada estrato.

    Sem `tamanho`, cada estrato entra com quantas unidades tem, o que preserva a composição da
    tabela. Com `tamanho`, a divisão é proporcional, e as sobras vão para os estratos de maior
    resto, de modo que a soma seja exatamente `tamanho`.
    """
    if tamanho is None:
        return contagem

    exato = tamanho * contagem / contagem.sum()
    quantidade = np.floor(exato).astype(int)
    sobra = tamanho - quantidade.sum()

    if sobra > 0:
        maiores_restos = np.argsort(exato - quantidade)[::-1][:sobra]
        quantidade[maiores_restos] += 1

    return quantidade


def _posicoes_sorteadas(tabela, unidade, estrato, tamanho, gerador):
    """Posições das linhas de uma reamostragem, na ordem em que as unidades foram sorteadas."""
    rotulo_unidade = _rotulos(tabela, unidade, "unidade")
    rotulo_estrato = _rotulos(tabela, estrato, "estrato")

    if rotulo_unidade is None:
        # Sem unidade, a reamostragem é linha a linha, e cada linha é a sua própria unidade.
        rotulo_unidade = np.arange(len(tabela))

    unidades, primeira = np.unique(rotulo_unidade, return_index=True)
    linhas_da_unidade = {u: np.flatnonzero(rotulo_unidade == u) for u in unidades}

    if rotulo_estrato is None:
        estrato_da_unidade = np.zeros(len(unidades), dtype=int)
    else:
        # Cada unidade precisa pertencer a um único estrato, senão a estratificação não faz sentido.
        estrato_por_unidade = pd.Series(rotulo_estrato).groupby(rotulo_unidade).nunique()

        if (estrato_por_unidade > 1).any():
            ambiguas = estrato_por_unidade.index[estrato_por_unidade > 1].tolist()[:3]
            raise ValueError(f"estrato: as unidades {ambiguas} aparecem em mais de um estrato.")

        _, estrato_da_unidade = np.unique(rotulo_estrato[primeira], return_inverse=True)

    quantidades = _quantidades_por_estrato(np.bincount(estrato_da_unidade), tamanho)
    partes = []

    for posicao, quantidade in enumerate(quantidades):
        candidatas = unidades[estrato_da_unidade == posicao]

        if quantidade > 0 and len(candidatas) > 0:
            sorteadas = gerador.choice(candidatas, size=int(quantidade), replace=True)
            partes.extend(linhas_da_unidade[u] for u in sorteadas)

    return np.concatenate(partes) if partes else np.empty(0, dtype=int)


def amostra_bootstrap(tabela, unidade=UNIDADE_PADRAO, estrato=ESTRATO_PADRAO, tamanho=None,
                      random_state=SEMENTE, guardar_origem=False):
    """Uma reamostragem com reposição da `tabela`.

    - `unidade`: coluna, vetor de rótulos ou None. Com unidade, o sorteio é de unidades inteiras, e
      todas as linhas da unidade sorteada entram juntas; com None, o sorteio é linha a linha.
    - `estrato`: coluna, vetor de rótulos ou None. Com estrato, cada estrato entra com o mesmo
      número de unidades que tem na tabela, o que preserva a composição do desenho experimental.
    - `tamanho`: quantas unidades sortear. O padrão é o número de unidades da tabela, que é o do
      bootstrap clássico; um valor diferente muda o tamanho da amostra, não a distribuição sorteada.
    - `random_state`: inteiro, `SeedSequence` ou `Generator` do numpy.
    - `guardar_origem`: acrescenta a coluna `indice_origem` com o índice da linha de origem. Fora
      isso, a saída tem exatamente as colunas e os tipos da entrada.

    A tabela recebida não é modificada.
    """
    gerador = (random_state if isinstance(random_state, np.random.Generator)
               else np.random.default_rng(random_state))
    posicoes = _posicoes_sorteadas(tabela, unidade, estrato, tamanho, gerador)
    amostra = tabela.iloc[posicoes].reset_index(drop=True)

    if guardar_origem:
        amostra["indice_origem"] = tabela.index.to_numpy()[posicoes]

    return amostra


def sementes_das_amostras(n_reamostragens, random_state=SEMENTE):
    """Sementes independentes e reprodutíveis, uma por reamostragem.

    Usa `SeedSequence`, que deriva fluxos independentes de uma semente única. Duas execuções com o
    mesmo `random_state` geram as mesmas amostras, e reamostragens diferentes nunca compartilham o
    mesmo fluxo de sorteio, o que aconteceria se a semente fosse apenas somada a um contador.
    """
    origem = (random_state if isinstance(random_state, np.random.SeedSequence)
              else np.random.SeedSequence(random_state))

    return origem.spawn(n_reamostragens)


def amostras_bootstrap(tabela, n_reamostragens=REAMOSTRAGENS_PADRAO, unidade=UNIDADE_PADRAO,
                       estrato=ESTRATO_PADRAO, tamanho=None, random_state=SEMENTE,
                       guardar_origem=False, como_lista=False):
    """Várias reamostragens, uma por semente derivada de `random_state`.

    Devolve um gerador, para não manter todas as tabelas na memória ao mesmo tempo; com
    `como_lista`, devolve a lista pronta.
    """
    sementes = sementes_das_amostras(n_reamostragens, random_state)
    saida = (amostra_bootstrap(tabela, unidade, estrato, tamanho, semente, guardar_origem)
             for semente in sementes)

    return list(saida) if como_lista else saida


def aplicar_em_amostras(tabela, estatistica, n_reamostragens=REAMOSTRAGENS_PADRAO,
                        unidade=UNIDADE_PADRAO, estrato=ESTRATO_PADRAO, tamanho=None,
                        random_state=SEMENTE, n_jobs=1):
    """Calcula `estatistica(amostra)` em cada reamostragem e devolve os valores empilhados.

    É o uso final do módulo: a distribuição dos valores devolvidos estima a incerteza amostral da
    estatística. Cada reamostragem é gerada dentro da sua própria tarefa, o que mantém o resultado
    igual com qualquer número de processos.
    """
    sementes = sementes_das_amostras(n_reamostragens, random_state)

    def uma(semente):
        return estatistica(amostra_bootstrap(tabela, unidade, estrato, tamanho, semente))

    if n_jobs == 1:
        return np.array([uma(s) for s in sementes])

    return np.array(Parallel(n_jobs=n_jobs)(delayed(uma)(s) for s in sementes))


def intervalo_percentil(valores, nivel=0.95):
    """Intervalo percentil de uma distribuição bootstrap (EFRON; TIBSHIRANI, 1993)."""
    return tuple(np.quantile(valores, [(1 - nivel) / 2, (1 + nivel) / 2], axis=0))
