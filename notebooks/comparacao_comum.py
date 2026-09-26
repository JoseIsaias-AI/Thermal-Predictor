"""Comparação de modelos por dataset (Seção 4.4 da documentação).

Os notebooks de `4_avaliacao/comparacao_de_modelos/` repetem o mesmo roteiro em cada subsistema:
busca de hiperparâmetros, comparação no teste e em 40 divisões e explicação do modelo final. Este
módulo concentra esse roteiro para que os sete notebooks usem exatamente o mesmo procedimento. A
base, a divisão, as partições e as métricas vêm de `modelagem_comum.py`, como nas Seções 4.3 e 4.4.
"""
import threading
import time
import warnings

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from joblib import Parallel, delayed, parallel_config
from scipy.stats import loguniform, randint, uniform, wilcoxon
from sklearn.base import BaseEstimator, RegressorMixin, clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (ExtraTreesRegressor, GradientBoostingRegressor,
                              RandomForestRegressor, VotingRegressor)
from sklearn.linear_model import Ridge
from sklearn.model_selection import GridSearchCV, RandomizedSearchCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVR

import modelagem_comum as mc

warnings.filterwarnings("ignore")

SEMENTE = mc.SEMENTE
N_DIVISOES = 40
CONFIRMACAO = range(20, 40)
ITERACOES_RANDOM_SEARCH = 20
ALFA = 0.05

# Hiperparâmetros do modelo final adotado na Seção 4.3(d), comuns às seis áreas: os escolhidos pela
# grade de `modelagem_comum.GRADES` na divisão fixa, nos notebooks 12 e 13.
ADOTADOS = {
    "Random Forest": {"n_estimators": 300, "min_samples_leaf": 1, "max_features": 1.0},
    "Gradient Boosting": {"n_estimators": 600, "learning_rate": 0.015, "max_depth": 6,
                          "subsample": 0.8},
}

FATORES = {
    "Modo de ensaio": ["Run_Case_Broil C1", "Run_Case_Broil C2", "Run_Case_Pyro"],
    "Direção do soprador": ["Blower_Direction_To Back"],
    "Alojamento aberto": ["Housing_Open"],
    "Placa à direita": ["Board_Position_Right"],
    "Defletor aberto": ["Deflector_Hole_Open"],
    "Suporte da bobina": ["Material_Coil_Support_Aluminium Plate", "Material_Coil_Support_Plastic"],
    "Perdas declaradas": ["losses_present_missing", "losses_config_m", "losses_order_back_order",
                          "losses_order_front_order"],
    "Ponto de medição": ["codigo_na_area"],
}
NOMES_CURTOS = {
    "Run_Case_Broil C1": "modo Broil C1", "Run_Case_Broil C2": "modo Broil C2",
    "Run_Case_Pyro": "modo Pyro", "Blower_Direction_To Back": "soprador para trás",
    "Housing_Open": "alojamento aberto", "Board_Position_Right": "placa à direita",
    "Deflector_Hole_Open": "defletor aberto",
    "Material_Coil_Support_Aluminium Plate": "suporte placa de alumínio",
    "Material_Coil_Support_Plastic": "suporte plástico",
    "losses_present_missing": "perda sem metadado", "losses_config_m": "perda Config M",
    "losses_order_back_order": "perda ordem traseira",
    "losses_order_front_order": "perda ordem dianteira", "codigo_na_area": "ponto de medição",
}
CORES = {"Média do ponto": mc.CINZA, "Ridge": mc.AZUL_CLARO, "SVR": mc.ROXO,
         "Random Forest": mc.AZUL, "Extra Trees": mc.VERDE, "Gradient Boosting": mc.AMBAR,
         "Média RF e GB": mc.VERMELHO}


# ------------------------------------------------------------------------------------------------
# Experimento de uma área
# ------------------------------------------------------------------------------------------------

class Experimento:
    """Dados de um subsistema, com a divisão e as partições do projeto restritas a ele.

    A divisão entre treino e teste e as cinco partições de validação são as da base inteira,
    filtradas para a área. Assim cada configuração cai do mesmo lado que na Seção 4.3(a), e os
    resultados por área somam os resultados globais.
    """

    def __init__(self, area, base=None):
        self.area = area
        self.base_global = mc.carregar_base() if base is None else base
        self.colunas = mc.colunas_configuracao(self.base_global)
        self.entradas = self.colunas + ["codigo_na_area"]
        na_area = (self.base_global["Conjunto"] == area).to_numpy()
        self.global_da_linha = np.flatnonzero(na_area)
        self.local_de = pd.Series(np.arange(na_area.sum()), index=self.global_da_linha)
        self.dados = self.base_global.iloc[self.global_da_linha].reset_index(drop=True)
        self.X = self.dados[self.entradas].astype(float)
        self.y = self.dados["Value"].to_numpy()
        treino, teste = mc.dividir_treino_teste(self.base_global)
        self.treino, self.teste = self._local(treino), self._local(teste)
        # Partições em posições relativas ao treino da área, o formato do GridSearchCV.
        self.particoes = []

        for ajuste, validacao in mc.particoes_de_validacao(self.base_global, treino):
            a, v = self._local(ajuste), self._local(validacao)
            self.particoes.append((np.searchsorted(self.treino, a), np.searchsorted(self.treino, v)))

    def _local(self, indices_globais):
        return np.sort(self.local_de.reindex(indices_globais).dropna().astype(int).to_numpy())

    def divisao(self, semente):
        """Treino, teste e partições de validação da área em uma das 40 divisões sorteadas."""
        treino_global, teste_global = mc.dividir_treino_teste(self.base_global, semente)
        treino = self._local(treino_global)
        particoes = []

        for ajuste, validacao in mc.particoes_de_validacao(self.base_global, treino_global):
            a, v = self._local(ajuste), self._local(validacao)

            if len(a) and len(v):
                particoes.append((np.searchsorted(treino, a), np.searchsorted(treino, v)))

        return treino, self._local(teste_global), particoes

    def resumo(self):
        linhas = []

        for nome, indices in (("Treino", self.treino), ("Teste", self.teste)):
            parte = self.dados.iloc[indices]
            com_limite = parte["limit_c"].notna()
            linhas.append({
                "Conjunto": nome, "Configurações": parte["configuracao"].nunique(),
                "Rodadas": parte["Run_ID"].nunique(), "Medições": len(parte),
                "Pontos de medição": parte["TC_Name"].nunique(),
                "Pontos com limite": parte.loc[com_limite, "TC_Name"].nunique(),
                "Excedências": int((parte["Value"] > parte["limit_c"]).sum()),
            })

        return pd.DataFrame(linhas).set_index("Conjunto")


# ------------------------------------------------------------------------------------------------
# Candidatos e espaços de busca
# ------------------------------------------------------------------------------------------------

class MediaDoPonto(RegressorMixin, BaseEstimator):
    """Referência da hipótese HM: a média histórica de cada ponto, sem olhar a configuração."""

    def fit(self, X, y):
        self.media_ = pd.Series(np.asarray(y, dtype=float)).groupby(
            np.asarray(X["codigo_na_area"])).mean()
        self.geral_ = float(np.mean(y))
        return self

    def predict(self, X):
        return pd.Series(np.asarray(X["codigo_na_area"])).map(self.media_).fillna(
            self.geral_).to_numpy()


def com_indicadoras(modelo, padronizar=False):
    # Modelos que não são árvores recebem o ponto como indicadoras, porque o código inteiro
    # imporia uma ordem sem significado; o SVR, que usa distância, recebe também z-score.
    passos = [("colunas", ColumnTransformer(
        [("ponto", OneHotEncoder(handle_unknown="ignore"), ["codigo_na_area"])],
        remainder="passthrough", sparse_threshold=0))]

    if padronizar:
        passos.append(("zscore", StandardScaler()))

    return Pipeline(passos + [("modelo", modelo)])


def candidatos():
    """Os cinco algoritmos comparados, com a grade do Grid Search e o espaço do Random Search."""
    arvores_grade = {"n_estimators": [300], "min_samples_leaf": [1, 2, 4],
                     "max_features": [0.5, 1.0]}
    arvores_espaco = {"n_estimators": [300], "min_samples_leaf": randint(1, 6),
                      "max_features": uniform(0.3, 0.7), "max_depth": [None, 8, 12, 16, 24]}

    return {
        "Ridge": {
            "estimador": com_indicadoras(Ridge()),
            "grade": {"modelo__alpha": [0.01, 0.1, 1.0, 10.0, 100.0]},
            "espaco": {"modelo__alpha": loguniform(1e-3, 1e3)},
        },
        "SVR": {
            "estimador": com_indicadoras(SVR(), padronizar=True),
            "grade": {"modelo__C": [10.0, 100.0, 1000.0], "modelo__epsilon": [0.1, 1.0],
                      "modelo__gamma": ["scale"]},
            "espaco": {"modelo__C": loguniform(1.0, 3000.0), "modelo__epsilon": loguniform(0.01, 3.0),
                       "modelo__gamma": ["scale", "auto"]},
        },
        "Random Forest": {
            "estimador": RandomForestRegressor(random_state=SEMENTE, n_jobs=1),
            "grade": arvores_grade, "espaco": arvores_espaco,
        },
        "Extra Trees": {
            "estimador": ExtraTreesRegressor(random_state=SEMENTE, n_jobs=1),
            "grade": arvores_grade, "espaco": arvores_espaco,
        },
        "Gradient Boosting": {
            "estimador": GradientBoostingRegressor(random_state=SEMENTE),
            "grade": {"max_depth": [2, 3, 4, 6], "learning_rate": [0.03, 0.1],
                      "n_estimators": [400], "subsample": [0.8]},
            "espaco": {"max_depth": randint(2, 7), "learning_rate": loguniform(0.01, 0.2),
                       "n_estimators": randint(200, 1201), "subsample": uniform(0.6, 0.4)},
        },
    }


def media_rf_gb(rf, gb):
    """Modelo final do projeto: média simples das previsões de Random Forest e Gradient Boosting."""
    return VotingRegressor([("rf", clone(rf)), ("gb", clone(gb))])


def media_adotada():
    return media_rf_gb(RandomForestRegressor(random_state=SEMENTE, n_jobs=1, **ADOTADOS["Random Forest"]),
                       GradientBoostingRegressor(random_state=SEMENTE, **ADOTADOS["Gradient Boosting"]))


# ------------------------------------------------------------------------------------------------
# Busca de hiperparâmetros
# ------------------------------------------------------------------------------------------------

def _texto(valor):
    if isinstance(valor, (float, np.floating)):
        return f"{valor:.3g}"

    return "sem limite" if valor is None else str(valor)


def buscar(exp, nome, candidato):
    """Grid Search e Random Search nas mesmas cinco partições agrupadas, com o MAE como critério.

    Devolve as duas buscas ajustadas e a tabela de todas as combinações avaliadas. A vencedora do
    algoritmo é a busca de menor MAE médio de validação; o teste não participa.
    """
    X, y = exp.X.iloc[exp.treino], exp.y[exp.treino]
    # O SVR busca sem paralelismo, pelo mesmo motivo de `_TRAVA_SVR`; os ajustes dele são rápidos.
    comum = {"cv": exp.particoes, "scoring": "neg_mean_absolute_error",
             "n_jobs": 1 if nome == "SVR" else -1}
    buscas = {
        "Grid Search": GridSearchCV(candidato["estimador"], candidato["grade"], **comum),
        "Random Search": RandomizedSearchCV(candidato["estimador"], candidato["espaco"],
                                            n_iter=ITERACOES_RANDOM_SEARCH, random_state=SEMENTE,
                                            **comum),
    }
    linhas = []

    for metodo, busca in buscas.items():
        inicio = time.time()

        # Threads, e não processos: evitam a criação de processos filhos, que falha em alguns
        # ambientes Windows; as árvores do scikit-learn liberam o GIL durante o treino.
        with parallel_config(backend="threading"):
            busca.fit(X, y)
        duracao = time.time() - inicio
        resultados = busca.cv_results_

        for i, parametros in enumerate(resultados["params"]):
            linhas.append({
                "Algoritmo": nome, "Busca": metodo,
                "Hiperparâmetros": ", ".join(f"{k.replace('modelo__', '')} = {_texto(v)}"
                                             for k, v in sorted(parametros.items())),
                "MAE de validação (C)": -resultados["mean_test_score"][i],
                "Desvio entre partições (C)": resultados["std_test_score"][i],
                "Tempo da busca (s)": duracao,
            })

    tabela = pd.DataFrame(linhas).sort_values("MAE de validação (C)").reset_index(drop=True)
    vencedora = min(buscas, key=lambda m: -buscas[m].best_score_)

    return buscas, vencedora, tabela


def resumo_das_buscas(exp, buscas_por_algoritmo):
    """Uma linha por algoritmo e busca: combinações, MAE padrão, MAE otimizado e ganho."""
    X, y = exp.X.iloc[exp.treino], exp.y[exp.treino]
    padrao = {}

    for nome, candidato in candidatos().items():
        erros = []

        for ajuste, validacao in exp.particoes:
            modelo = clone(candidato["estimador"]).fit(X.iloc[ajuste], y[ajuste])
            erros.append(np.abs(modelo.predict(X.iloc[validacao]) - y[validacao]).mean())

        padrao[nome] = float(np.mean(erros))

    linhas = []

    for nome, (buscas, vencedora, _) in buscas_por_algoritmo.items():
        for metodo, busca in buscas.items():
            linhas.append({
                "Algoritmo": nome, "Busca": metodo,
                "Combinações": len(busca.cv_results_["params"]),
                "MAE padrão (C)": padrao[nome], "MAE otimizado (C)": -busca.best_score_,
                "Ganho (C)": padrao[nome] + busca.best_score_,
                "Vencedora": "sim" if metodo == vencedora else "",
                "Hiperparâmetros escolhidos": ", ".join(
                    f"{k.replace('modelo__', '')} = {_texto(v)}"
                    for k, v in sorted(busca.best_params_.items())),
            })

    return pd.DataFrame(linhas).set_index(["Algoritmo", "Busca"])


# ------------------------------------------------------------------------------------------------
# Avaliação no teste isolado e nas 40 divisões
# ------------------------------------------------------------------------------------------------

def _indices_globais(exp, locais):
    return exp.global_da_linha[locais]


def avaliar_no_teste(exp, modelos):
    """Treina cada modelo nas configurações de treino da área e mede uma vez no teste isolado."""
    X, y = exp.X, exp.y
    referencia = MediaDoPonto().fit(X.iloc[exp.treino], y[exp.treino]).predict(X.iloc[exp.teste])
    previsoes, linhas = {}, {}

    for nome, modelo in modelos.items():
        previsto = clone(modelo).fit(X.iloc[exp.treino], y[exp.treino]).predict(X.iloc[exp.teste])
        previsoes[nome] = previsto
        linhas[nome] = mc.avaliar(exp.base_global, _indices_globais(exp, exp.teste), previsto,
                                  referencia)

    colunas = ["MAE (C)", "RMSE (C)", "R2", "R2 sobre a média do termopar (%)",
               "Pontos aprovados", "Sensibilidade (%)", "Falsos negativos", "Falsos positivos"]
    tabela = pd.DataFrame(linhas).T[colunas].rename(
        columns={"R2 sobre a média do termopar (%)": "R2 sobre a média do ponto (%)"})

    return tabela.sort_values("MAE (C)"), previsoes


ADOTADO = "Média RF e GB adotada"
OTIMIZADA = "Média RF e GB otimizada"


def _registro(exp, semente, nome, teste, previsto):
    indices = _indices_globais(exp, teste)
    criterio = mc.criterio_do_parceiro(exp.base_global, indices, previsto)
    erro = np.abs(previsto - exp.y[teste])

    return {"Divisão": semente, "Modelo": nome, "MAE": float(erro.mean()),
            "Soma dos erros": float(erro.sum()), "Medições": int(len(erro)),
            "Pontos aprovados": int(criterio["aprovado"].sum()), "Pontos com limite": int(len(criterio)),
            "Aprovação": float(100 * criterio["aprovado"].mean()) if len(criterio) else np.nan}


# A libsvm, usada pelo SVR, não é segura para threads: os ajustes dele passam um de cada vez.
_TRAVA_SVR = threading.Lock()


def _ajustar_e_prever(modelo, X_treino, y_treino, X_alvo):
    if "SVR" in str(modelo):
        with _TRAVA_SVR:
            return clone(modelo).fit(X_treino, y_treino).predict(X_alvo)

    return clone(modelo).fit(X_treino, y_treino).predict(X_alvo)


def _prever_divisao(exp, modelos, semente):
    treino, teste, _ = exp.divisao(semente)
    X, y = exp.X, exp.y

    return [_registro(exp, semente, nome, teste,
                      _ajustar_e_prever(modelo, X.iloc[treino], y[treino], X.iloc[teste]))
            for nome, modelo in modelos.items()]


def avaliar_em_divisoes(exp, modelos):
    """Treina e testa cada modelo nas 40 divisões sorteadas da Seção 4.3(a).

    Os hiperparâmetros são os escolhidos na divisão fixa. Como as configurações de treino dela caem
    no teste de outras divisões, a leitura favorece levemente os modelos otimizados; o modelo adotado
    não tem essa vantagem, o que torna conservadora a decisão de mantê-lo.
    """
    saidas = Parallel(n_jobs=-1, prefer="threads")(
        delayed(_prever_divisao)(exp, modelos, s) for s in range(N_DIVISOES))

    return pd.DataFrame([linha for saida in saidas for linha in saida])


def decidir(por_divisao):
    """Critério da Seção 4.3(d), aplicado por dataset e fixado antes da execução.

    O desafiante é o modelo de menor MAE médio nas divisões de exploração (0 a 19). Ele substitui o
    modelo adotado só se errar menos nas divisões de confirmação (20 a 39), pelo teste de Wilcoxon
    pareado unilateral a 5%; sem isso, o modelo adotado é mantido.
    """
    mae = por_divisao.pivot(index="Divisão", columns="Modelo", values="MAE")
    aprovacao = por_divisao.pivot(index="Divisão", columns="Modelo", values="Aprovação")
    exploracao, confirmacao = ~mae.index.isin(CONFIRMACAO), mae.index.isin(CONFIRMACAO)
    disputam = [m for m in mae.columns if m not in (ADOTADO, "Média do ponto")]
    desafiante = mae.loc[exploracao, disputam].mean().idxmin()
    linhas = []

    for nome in mae.columns:
        diferenca = (mae[nome] - mae[ADOTADO])[confirmacao]
        linhas.append({
            "Modelo": nome,
            "MAE médio, exploração (C)": mae.loc[exploracao, nome].mean(),
            "MAE médio, confirmação (C)": mae.loc[confirmacao, nome].mean(),
            "MAE médio, 40 divisões (C)": mae[nome].mean(),
            "Aprovação mediana (%)": aprovacao[nome].median(),
            "Vence o adotado (confirmação)": ("—" if nome == ADOTADO
                                              else f"{int((diferenca < 0).sum())} de {len(diferenca)}"),
            "p": (np.nan if nome == ADOTADO or not (diferenca != 0).any()
                  else float(wilcoxon(diferenca, alternative="less").pvalue)),
        })

    resumo = pd.DataFrame(linhas).set_index("Modelo").sort_values("MAE médio, exploração (C)")
    p = resumo.loc[desafiante, "p"]
    final = desafiante if p < ALFA else ADOTADO

    return resumo, desafiante, final


# ------------------------------------------------------------------------------------------------
# Explicabilidade
# ------------------------------------------------------------------------------------------------

def importancia_por_fator(exp, modelo, repeticoes=10):
    """Aumento do MAE no teste quando as colunas de um fator são embaralhadas juntas."""
    X, y = exp.X.iloc[exp.teste].reset_index(drop=True), exp.y[exp.teste]
    base = float(np.abs(modelo.predict(X) - y).mean())
    gerador = np.random.default_rng(SEMENTE)
    linhas = []

    for fator, colunas in FATORES.items():
        if all(X[c].nunique() <= 1 for c in colunas):
            continue

        aumentos = []

        for _ in range(repeticoes):
            embaralhado = X.copy()
            embaralhado[colunas] = embaralhado[colunas].to_numpy()[gerador.permutation(len(X))]
            aumentos.append(float(np.abs(modelo.predict(embaralhado) - y).mean()) - base)

        linhas.append({"Fator": fator, "Aumento do MAE (C)": float(np.mean(aumentos)),
                       "Desvio entre repetições (C)": float(np.std(aumentos, ddof=1))})

    return pd.DataFrame(linhas).set_index("Fator").sort_values("Aumento do MAE (C)", ascending=False)


def explicar_shap(modelo, X):
    """SHAP do modelo final, em °C por variável: exato nas árvores, por permutação nos demais.

    Para a média de dois modelos, o SHAP é a média dos SHAP de cada um, porque a explicação é
    aditiva. A referência mais a soma das contribuições reproduz a previsão, o que o notebook confere.
    """
    import shap

    if isinstance(modelo, Pipeline):
        # Modelo que não é de árvores, como o SVR: SHAP por permutação, também aditivo, com uma
        # permutação por medição e 30 medições como referência, para caber no tempo de execução.
        fundo = shap.maskers.Independent(X, max_samples=30)
        explicacao = shap.PermutationExplainer(modelo.predict, fundo, seed=SEMENTE)(
            X, max_evals=2 * X.shape[1] + 1)
        return shap.Explanation(values=explicacao.values, base_values=explicacao.base_values,
                                data=X.to_numpy(), feature_names=[NOMES_CURTOS[c] for c in X.columns])

    membros = modelo.estimators_ if isinstance(modelo, VotingRegressor) else [modelo]
    explicacoes = [shap.TreeExplainer(m)(X) for m in membros]
    valores = np.mean([e.values for e in explicacoes], axis=0)
    referencia = float(np.mean([np.ravel(e.base_values)[0] for e in explicacoes]))

    return shap.Explanation(values=valores, base_values=np.full(len(X), referencia),
                            data=X.to_numpy(), feature_names=[NOMES_CURTOS[c] for c in X.columns])


def shap_por_fator(explicacao, colunas):
    """Média do |SHAP| de cada fator, somando as colunas do fator antes do valor absoluto."""
    valores = pd.DataFrame(explicacao.values, columns=colunas)

    return pd.Series({fator: float(valores[cols].sum(axis=1).abs().mean())
                      for fator, cols in FATORES.items() if set(cols) <= set(colunas)}
                     ).sort_values(ascending=False)


def ponto_critico(exp, previsto_teste):
    """Medição de teste do ponto com pior folga no critério do parceiro, na maior previsão dele."""
    indices = _indices_globais(exp, exp.teste)
    criterio = mc.criterio_do_parceiro(exp.base_global, indices, previsto_teste)

    if criterio.empty:
        return None, None

    pior = criterio.sort_values("folga").iloc[0]
    linhas = np.flatnonzero(exp.dados["TC_Name"].iloc[exp.teste].to_numpy() == pior["Termopar"])

    return pior, int(linhas[np.argmax(previsto_teste[linhas])])


# ------------------------------------------------------------------------------------------------
# Figuras
# ------------------------------------------------------------------------------------------------

def figura_busca(tabela, resumo, titulo):
    """MAE de validação de cada combinação avaliada, por algoritmo, com o padrão marcado."""
    fig, painel = plt.subplots(figsize=(9, 3.8))
    nomes = list(dict.fromkeys(tabela["Algoritmo"]))

    for i, nome in enumerate(nomes):
        for metodo, deslocamento, marcador in (("Grid Search", -0.12, "o"), ("Random Search", 0.12, "^")):
            valores = tabela.loc[(tabela["Algoritmo"] == nome) & (tabela["Busca"] == metodo),
                                 "MAE de validação (C)"]
            painel.scatter(valores, np.full(len(valores), i + deslocamento), s=14, alpha=0.6,
                           marker=marcador, color=CORES[nome],
                           label=metodo if i == 0 else None)

        painel.scatter(resumo.loc[(nome, "Grid Search"), "MAE padrão (C)"], i, marker="|", s=250,
                       color="black", label="hiperparâmetros padrão" if i == 0 else None)

    painel.set_yticks(range(len(nomes)))
    painel.set_yticklabels(nomes)
    painel.invert_yaxis()
    painel.set_xlabel("MAE de validação agrupada (°C)")
    painel.set_title(titulo, fontsize=9)
    painel.legend(fontsize=7, loc="lower right")
    fig.tight_layout()

    return fig


def _cor(nome):
    if nome == ADOTADO:
        return mc.CINZA_CLARO

    return CORES.get(nome.replace(" otimizada", ""), mc.VERMELHO)


def figura_comparacao(teste, por_divisao, final, titulo):
    """MAE no teste isolado e distribuição do MAE nas 40 divisões, com o modelo final destacado."""
    mae = por_divisao.pivot(index="Divisão", columns="Modelo", values="MAE")
    ordem = list(mae.mean().sort_values().index)
    rotulos = [f"{n}  ◀ final" if n == final else n for n in ordem]
    fig, (esquerda, direita) = plt.subplots(1, 2, figsize=(11, 3.8), sharey=True)
    esquerda.barh(range(len(ordem)), teste.loc[ordem, "MAE (C)"].astype(float),
                  color=[_cor(n) for n in ordem])
    esquerda.set_yticks(range(len(ordem)))
    esquerda.set_yticklabels(rotulos)
    esquerda.invert_yaxis()
    esquerda.set_xlabel("MAE no teste isolado (°C)")
    esquerda.set_title("Divisão fixa: 6 configurações de teste", fontsize=9)
    caixas = direita.boxplot([mae[n] for n in ordem], positions=range(len(ordem)), vert=False,
                             patch_artist=True, widths=0.6)

    for caixa, nome in zip(caixas["boxes"], ordem):
        caixa.set_facecolor(_cor(nome))

    direita.set_xlabel("MAE de teste em cada divisão (°C)")
    direita.set_title("40 divisões sorteadas", fontsize=9)
    fig.suptitle(titulo, fontsize=10)
    fig.tight_layout()

    return fig


# ------------------------------------------------------------------------------------------------
# Modelo final e registro dos resultados
# ------------------------------------------------------------------------------------------------

def modelo_final(nome, otimizados):
    """Estimador correspondente ao nome devolvido por `decidir`."""
    if nome == ADOTADO:
        return media_adotada()

    if nome == OTIMIZADA:
        return media_rf_gb(otimizados["Random Forest"], otimizados["Gradient Boosting"])

    return clone(otimizados[nome])


def _contagens(exp, indices_locais, previsto):
    """Somas que permitem agregar as métricas das áreas sem guardar nenhuma medição."""
    y = exp.y[indices_locais]
    globais = _indices_globais(exp, indices_locais)
    criterio = mc.criterio_do_parceiro(exp.base_global, globais, previsto)
    _, matriz = mc.decisao_rn01(exp.base_global, globais, previsto)
    vn, fp, fn, vp = (int(v) for v in matriz.ravel())

    return {"n": int(len(y)), "soma_erro": float(np.abs(previsto - y).sum()),
            "soma_erro2": float(((previsto - y) ** 2).sum()), "soma_y": float(y.sum()),
            "soma_y2": float((y ** 2).sum()), "aprovados": int(criterio["aprovado"].sum()),
            "pontos": int(len(criterio)), "vn": vn, "fp": fp, "fn": fn, "vp": vp}


def salvar_resultados(caminho, exp, resumo_buscas, teste, previsoes_teste, por_divisao, decisao,
                      desafiante, final, importancia, shap_fator):
    """Grava em JSON só métricas agregadas da área; nenhuma temperatura medida ou prevista."""
    import json
    import os

    def limpar(tabela):
        return json.loads(tabela.reset_index().to_json(orient="records", force_ascii=False))

    registro = {
        "area": exp.area, "resumo": limpar(exp.resumo()), "buscas": limpar(resumo_buscas),
        "teste": limpar(teste), "decisao": limpar(decisao), "desafiante": desafiante,
        "final": final,
        "contagens_teste": {n: _contagens(exp, exp.teste, p) for n, p in previsoes_teste.items()},
        "divisoes": limpar(por_divisao.drop(columns=["Aprovação"])),
        "importancia": limpar(importancia), "shap_por_fator": shap_fator.to_dict(),
    }
    os.makedirs(os.path.dirname(caminho), exist_ok=True)

    with open(caminho, "w", encoding="utf-8") as arquivo:
        json.dump(registro, arquivo, ensure_ascii=False, indent=1)
