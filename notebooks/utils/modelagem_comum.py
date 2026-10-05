"""Definições comuns aos notebooks de modelagem, avaliação e implantação (3.1 em diante).

A comparação entre algoritmos só é justa se todos usarem a mesma base, a mesma divisão entre treino
e teste, as mesmas métricas e os mesmos modelos. Este módulo concentra essas definições; cada
notebook importa daqui e fica apenas com o que é próprio do algoritmo que apresenta.
"""
import copy
import os
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import confusion_matrix, mean_squared_error, r2_score

SEMENTE = 42

AZUL = "#2e75b6"
AZUL_ESCURO = "#1f4e79"
AZUL_CLARO = "#9dc3e6"
VERMELHO = "#c00000"
AMBAR = "#d98c00"
VERDE = "#3f9e7c"
CINZA = "#7f7f7f"
CINZA_CLARO = "#bfbfbf"
ROXO = "#7030a0"

CORES_MODELO = {
    "Média do termopar": CINZA,
    "Ridge": AZUL_CLARO,
    "Random Forest": AZUL,
    "Gradient Boosting": AMBAR,
    "Rede neural": VERDE,
    "Mesclagem por área": ROXO,
    "Média RF e GB": VERMELHO,
}

TABELAS_POR_AREA = {
    "Mainback": "mainback_components.csv",
    "Coil Temps": "coil_temperatures.csv",
    "Main Vent Sys": "main_ventilation_system.csv",
    "IPC Cooling": "ipc_cooling.csv",
    "IPC Comp": "ipc_components.csv",
    "HMI / Knobs / Console": "hmi_knobs_console.csv",
}
CONJUNTOS = list(TABELAS_POR_AREA)
PREFIXOS_CONFIGURACAO = (
    "Run_Case_", "Blower_Direction_", "Housing_", "Board_Position_",
    "Deflector_Hole_", "Material_Coil_Support_", "losses_",
)

# Configurações de teste sorteadas em cada modo de ensaio. Broil C1 tem só duas configurações e
# fica inteiro no treino: com uma delas no teste, o modelo veria esse modo uma única vez.
COTAS_TESTE = {"Broil Qualitative": 3, "Broil C2": 2, "Pyro": 1, "Broil C1": 0}
PARTICOES_VALIDACAO = 5
FRACAO_TOLERANCIA = 0.10
PISO_APROVACAO = 0.90

# Tolerâncias para conferir um modelo reconstruído contra o erro registrado. Até 0,005 °C, a
# reprodução é exata (o registro guarda o MAE com dez casas, e a documentação o publica com duas).
# Os registros e os modelos versionados foram gerados em processador x86-64; em outra arquitetura,
# como a ARM dos Macs com Apple Silicon, a ordem das operações de ponto flutuante muda e pode
# desfazer de outro jeito um empate entre cortes de uma árvore. Medido nos seis modelos finais, o
# efeito chega a 0,04 °C no MAE de teste, sem mudar nenhuma contagem do critério do parceiro; até
# 0,05 °C, a diferença é tratada como alerta de plataforma, e não como erro.
TOLERANCIA_EXATA_C = 0.005
TOLERANCIA_PLATAFORMA_C = 0.05


def configurar_graficos():
    plt.rcParams.update({
        "figure.dpi": 110, "font.size": 9, "axes.grid": True, "grid.alpha": 0.25,
        "axes.spines.top": False, "axes.spines.right": False,
    })


def raiz_do_projeto():
    """Pasta do projeto: a mais próxima, subindo a partir do diretório de trabalho, com `notebooks/utils/`.

    Vale para a execução a partir de qualquer subpasta de `notebooks/`, da própria `notebooks/` ou
    da raiz, e também para a cópia `ambiente_sintetico/`, que tem a sua própria `notebooks/utils/` e
    por isso é encontrada antes do repositório. Fora do projeto, como no Colab, devolve `None`.
    """
    for pasta in (Path.cwd(), *Path.cwd().parents):
        if (pasta / "notebooks" / "utils").is_dir():
            return pasta

    return None


def caminho_projeto(*partes):
    """Caminho de um arquivo do projeto (modelos, resultados, documentação) a partir da raiz."""
    raiz = raiz_do_projeto()
    return os.path.join(raiz if raiz is not None else ".", *partes)


def caminho_dado(nome):
    """Procura um arquivo de dados no diretório de trabalho e na pasta `notebooks/` do projeto.

    A planilha do parceiro e os CSVs gerados a partir dela ficam em `notebooks/`, fora do Git. No
    Colab, os arquivos enviados ficam no diretório de trabalho ou ao lado deste módulo.
    """
    raiz = raiz_do_projeto()
    aqui = Path(__file__).resolve().parent
    pastas = [Path.cwd()] + ([raiz / "notebooks"] if raiz is not None else []) + [aqui, aqui.parent]

    for pasta in pastas:
        if (pasta / nome).is_file():
            return str(pasta / nome)

    raise FileNotFoundError(f"Arquivo não encontrado: {nome}. Veja em notebooks/README.md como "
                            "fornecer a base de dados.")


def salvar_figura(fig, nome):
    """Grava a figura em `assets/`, a pasta de imagens da documentação, ou em `figuras/` no Colab."""
    raiz = raiz_do_projeto()
    destino = raiz / "assets" if raiz is not None and (raiz / "assets").is_dir() else Path("figuras")
    destino.mkdir(parents=True, exist_ok=True)
    fig.savefig(destino / nome, dpi=150, bbox_inches="tight")


# ------------------------------------------------------------------------------------------------
# Base
# ------------------------------------------------------------------------------------------------

def carregar_base(incluir_simulacao=False, caminho_simulacao="simulacao_fem.csv"):
    """Leituras observadas das seis áreas, uma linha por medição.

    Só entram pares rodada e termopar presentes em `dataset_preprocessado.csv`, que guarda apenas o
    que foi medido: valores imputados nas tabelas por área ficam fora, conforme a Seção 4.2.2 da
    documentação.

    Com `incluir_simulacao`, as linhas simuladas por `fem_termico.py` são acrescentadas às medidas, e
    a tabela ganha as colunas `origem` e `peso`, conforme o contrato de
    `documents/extras/projeto-integracao-fem.md`. O padrão é desligado, e nesse caso a tabela
    devolvida é exatamente a mesma de antes desta extensão, o que mantém intactos os notebooks de modelagem e de aumento de dados.
    """
    catalogo = (
        pd.read_csv(caminho_dado("dataset_completo_com_flags_de_auditoria.csv"))
        [["TC_Name", "Key_Area", "limit_c"]]
        .drop_duplicates(subset=["TC_Name"])
    )
    preprocessado = pd.read_csv(caminho_dado("dataset_preprocessado.csv"))
    observados = set(zip(preprocessado["Run_ID"], preprocessado["TC_Name"]))
    partes = []

    for nome, arquivo in TABELAS_POR_AREA.items():
        tabela = pd.read_csv(caminho_dado(arquivo))
        configuracao = [c for c in tabela.columns if c.startswith(PREFIXOS_CONFIGURACAO)]
        componentes = [c for c in tabela.columns
                       if c not in configuracao and c not in ("Run_ID", "valores_imputados")]
        longa = tabela.melt(id_vars=["Run_ID"] + configuracao, value_vars=componentes,
                            var_name="TC_Name", value_name="Value")
        longa = longa[[(r, t) in observados for r, t in zip(longa["Run_ID"], longa["TC_Name"])]]
        longa = longa.merge(catalogo, on="TC_Name", how="left", validate="many_to_one")
        longa["Conjunto"] = nome
        partes.append(longa)

    base = pd.concat(partes, ignore_index=True)
    colunas = colunas_configuracao(base)
    base["configuracao"] = base[colunas].astype(int).astype(str).agg("".join, axis=1)
    base["modo"] = np.select(
        [base["Run_Case_Broil C1"] == 1, base["Run_Case_Broil C2"] == 1,
         base["Run_Case_Pyro"] == 1],
        ["Broil C1", "Broil C2", "Pyro"], default="Broil Qualitative",
    )
    # Numeração do termopar dentro da área, em ordem alfabética, como no modelo de produção; e uma
    # numeração comum às seis áreas, para o embedding da rede neural.
    base["codigo_na_area"] = 0

    for nome in CONJUNTOS:
        na_area = base["Conjunto"] == nome
        base.loc[na_area, "codigo_na_area"] = pd.Categorical(base.loc[na_area, "TC_Name"]).codes

    termopares = sorted(base["TC_Name"].unique())
    base["indice_termopar"] = base["TC_Name"].map({t: i for i, t in enumerate(termopares)})

    if not incluir_simulacao:
        return base

    return _acrescentar_simulacao(base, catalogo, caminho_simulacao)


def _acrescentar_simulacao(base, catalogo, caminho_simulacao):
    """Concatena as linhas simuladas às medidas, no mesmo formato da tabela de modelagem."""
    import fem_termico as ft

    colunas = colunas_configuracao(base)
    simulada = ft.carregar_simulacao(caminho_dado(caminho_simulacao),
                                     pontos_validos=set(base["TC_Name"]),
                                     areas_validas=set(base["Key_Area"]), colunas_configuracao=colunas)
    area_do_ponto = base.drop_duplicates("TC_Name").set_index("TC_Name")
    simulada = simulada.assign(
        Run_ID=simulada["simulacao_id"],
        Conjunto=simulada["TC_Name"].map(area_do_ponto["Conjunto"]),
        limit_c=simulada["TC_Name"].map(area_do_ponto["limit_c"]),
        codigo_na_area=simulada["TC_Name"].map(area_do_ponto["codigo_na_area"]),
        indice_termopar=simulada["TC_Name"].map(area_do_ponto["indice_termopar"]),
        configuracao=simulada[colunas].astype(int).astype(str).agg("".join, axis=1),
    )
    simulada["modo"] = np.select(
        [simulada["Run_Case_Broil C1"] == 1, simulada["Run_Case_Broil C2"] == 1,
         simulada["Run_Case_Pyro"] == 1],
        ["Broil C1", "Broil C2", "Pyro"], default="Broil Qualitative",
    )
    base = base.assign(origem=ft.ORIGEM_MEDICAO, peso=1.0)

    return pd.concat([base, simulada[base.columns]], ignore_index=True)


def colunas_configuracao(base):
    return [c for c in base.columns if c.startswith(PREFIXOS_CONFIGURACAO)]


# ------------------------------------------------------------------------------------------------
# Divisão entre treino e teste, e partições de validação
# ------------------------------------------------------------------------------------------------

def sortear_configuracoes_de_teste(base, semente=SEMENTE):
    """Configurações de teste, sorteadas dentro de cada modo de ensaio conforme `COTAS_TESTE`.

    O sorteio considera apenas configurações realmente ensaiadas: linha simulada nunca define nem
    ocupa o conjunto de teste.
    """
    medidas = base[base["origem"] == "medicao"] if "origem" in base.columns else base
    gerador = np.random.default_rng(semente)
    modo_da_configuracao = medidas.drop_duplicates("configuracao").set_index("configuracao")["modo"]
    teste = []

    for modo, cota in COTAS_TESTE.items():
        candidatas = np.sort(modo_da_configuracao.index[modo_da_configuracao == modo].to_numpy())
        teste.extend(gerador.choice(candidatas, size=cota, replace=False))

    return set(teste)


def dividir_treino_teste(base, semente=SEMENTE):
    """Índices de treino e de teste. Todas as medições de uma configuração ficam do mesmo lado.

    Com linhas simuladas na tabela, valem duas regras adicionais do projeto de integração: o teste é
    formado só por medições, e as linhas simuladas de uma configuração sorteada para o teste são
    descartadas dos dois lados, para que o modelo não treine na simulação daquilo que será avaliado.
    """
    configuracoes_de_teste = sortear_configuracoes_de_teste(base, semente)
    da_configuracao_de_teste = base["configuracao"].isin(configuracoes_de_teste).to_numpy()

    if "origem" not in base.columns:
        return np.where(~da_configuracao_de_teste)[0], np.where(da_configuracao_de_teste)[0]

    simulada = (base["origem"] == "simulacao").to_numpy()
    teste = np.where(da_configuracao_de_teste & ~simulada)[0]
    treino = np.where(~da_configuracao_de_teste)[0]

    return treino, teste


def resumo_divisao(base, treino, teste):
    linhas = []

    for nome, indices in (("Treino", treino), ("Teste", teste)):
        parte = base.iloc[indices]
        linhas.append({
            "Conjunto": nome,
            "Configurações": parte["configuracao"].nunique(),
            "Rodadas": parte["Run_ID"].nunique(),
            "Medições": len(parte),
            "Excedências": int((parte["Value"] > parte["limit_c"]).sum()),
            **{f"Modo {m}": parte.loc[parte["modo"] == m, "configuracao"].nunique()
               for m in COTAS_TESTE},
        })

    return pd.DataFrame(linhas).set_index("Conjunto")


def particoes_de_validacao(base, indices, n_particoes=PARTICOES_VALIDACAO):
    """Validação cruzada dentro de `indices`, agrupada por configuração, em índices globais.

    Segue a regra do `GroupKFold` do scikit-learn: as configurações entram da maior para a menor, e
    cada uma vai para a partição com menos medições até ali. A regra fica escrita aqui porque as
    versões recentes do scikit-learn trocaram a ordem de desempate entre configurações com o mesmo
    número de medições, que são comuns nesta base, e passaram a montar outras partições, com outras
    métricas de validação. O desempate abaixo é o da versão em que os notebooks foram executados, e
    mantém as partições iguais em qualquer versão instalada. Com as mesmas partições, Ridge e média do
    termopar reproduzem as métricas publicadas; Random Forest e Gradient Boosting, que sorteiam
    amostras internamente, ainda podem variar em milésimos a centésimos de grau entre versões do
    scikit-learn.
    """
    grupos = base["configuracao"].to_numpy()[indices]
    configuracoes, grupo_de = np.unique(grupos, return_inverse=True)
    tamanhos = np.bincount(grupo_de)
    carga = np.zeros(n_particoes)
    particao_da_configuracao = np.zeros(len(configuracoes), dtype=int)

    for configuracao in np.argsort(tamanhos, kind="quicksort")[::-1]:
        destino = int(np.argmin(carga))
        carga[destino] += tamanhos[configuracao]
        particao_da_configuracao[configuracao] = destino

    particao = particao_da_configuracao[grupo_de]

    return [(indices[particao != p], indices[particao == p]) for p in range(n_particoes)]


# ------------------------------------------------------------------------------------------------
# Métricas
# ------------------------------------------------------------------------------------------------

def metricas_regressao(y, previsto, referencia=None):
    """Erro em graus, variação explicada e acerto dentro de tolerância.

    `referencia` é a previsão da média do termopar; com ela, o R² é recalculado contra essa
    referência, que é a de HM, em vez da média global.
    """
    erro = np.abs(previsto - y)
    metricas = {
        "MAE (C)": float(erro.mean()),
        "MSE (C2)": float(mean_squared_error(y, previsto)),
        "RMSE (C)": float(np.sqrt(mean_squared_error(y, previsto))),
        "R2": float(r2_score(y, previsto)),
        "Acerto ±5 C (%)": float(100 * (erro <= 5).mean()),
        "Acerto ±10 C (%)": float(100 * (erro <= 10).mean()),
    }

    if referencia is not None:
        metricas["R2 sobre a média do termopar (%)"] = float(
            100 * (1 - ((y - previsto) ** 2).sum() / ((y - referencia) ** 2).sum()))

    return metricas


def criterio_do_parceiro(base, indices, previsto):
    """Critério de aceite: MAE de cada ponto com limite até 10% do limite do ponto."""
    parte = base.iloc[indices]
    com_limite = parte["limit_c"].notna().to_numpy()
    por_ponto = (
        pd.DataFrame({"Termopar": parte["TC_Name"].to_numpy()[com_limite],
                      "Conjunto": parte["Conjunto"].to_numpy()[com_limite],
                      "limite": parte["limit_c"].to_numpy()[com_limite],
                      "erro": np.abs(previsto - parte["Value"].to_numpy())[com_limite]})
        .groupby(["Termopar", "Conjunto"])
        .agg(limite=("limite", "first"), MAE=("erro", "mean"), medicoes=("erro", "size"))
        .reset_index()
    )
    por_ponto["tolerancia"] = FRACAO_TOLERANCIA * por_ponto["limite"]
    por_ponto["folga"] = por_ponto["tolerancia"] - por_ponto["MAE"]
    por_ponto["aprovado"] = por_ponto["folga"] >= 0

    return por_ponto


def decisao_rn01(base, indices, previsto, banda=FRACAO_TOLERANCIA):
    """Decisão de excedência: alarme quando a previsão passa de (1 - banda) do limite."""
    parte = base.iloc[indices]
    com_limite = parte["limit_c"].notna().to_numpy()
    limite = parte["limit_c"].to_numpy()[com_limite]
    real = parte["Value"].to_numpy()[com_limite] > limite
    alarme = previsto[com_limite] > (1 - banda) * limite
    matriz = confusion_matrix(real, alarme, labels=[False, True])
    vn, fp, fn, vp = matriz.ravel()
    precisao = vp / max(vp + fp, 1)
    sensibilidade = vp / max(vp + fn, 1)

    return {
        "Acurácia (%)": 100 * (vp + vn) / matriz.sum(),
        "Precisão (%)": 100 * precisao,
        "Sensibilidade (%)": 100 * sensibilidade,
        "Especificidade (%)": 100 * vn / max(vn + fp, 1),
        "F1 (%)": 200 * precisao * sensibilidade / max(precisao + sensibilidade, 1e-12),
        "Falsos negativos": int(fn),
        "Falsos positivos": int(fp),
    }, matriz


def avaliar(base, indices, previsto, referencia=None):
    """As três leituras de uma previsão: erro, critério do parceiro e decisão de RN-01."""
    y = base["Value"].to_numpy()[indices]
    criterio = criterio_do_parceiro(base, indices, previsto)
    decisao, _ = decisao_rn01(base, indices, previsto)

    return {
        **metricas_regressao(y, previsto, referencia),
        "Pontos aprovados": f"{int(criterio['aprovado'].sum())} de {len(criterio)}",
        "Aprovação (%)": float(100 * criterio["aprovado"].mean()),
        **decisao,
    }


# ------------------------------------------------------------------------------------------------
# Modelos
# ------------------------------------------------------------------------------------------------

GRADES = {
    "Ridge": [{"alpha": a} for a in (0.1, 1.0, 10.0)],
    "Random Forest": [
        {"n_estimators": 300, "min_samples_leaf": folha, "max_features": fracao}
        for folha in (1, 2, 4) for fracao in (0.5, 1.0)
    ],
    "Gradient Boosting": [
        {"n_estimators": n, "learning_rate": taxa, "max_depth": profundidade, "subsample": 0.8}
        for profundidade in (3, 4, 5, 6)
        for taxa in (0.015, 0.03, 0.05)
        for n in (300, 600, 1200)
    ],
}

REDE_REFERENCIA = {
    "camadas": (64, 32), "ativacao": "ReLU", "dropout": 0.2, "normalizacao_em_lote": True,
    "decaimento_de_peso": 1e-4, "alvo": "relativo ao termopar", "dimensao_embedding": 8,
    "taxa_de_aprendizado": 1e-3, "tamanho_do_lote": 128, "epocas_maximas": 400,
    "paciencia": 30,
}
GRADES["Rede neural"] = [
    {**REDE_REFERENCIA, "ativacao": ativacao, "dropout": dropout, "camadas": camadas,
     "taxa_de_aprendizado": taxa}
    for ativacao in ("ReLU", "GELU") for dropout in (0.2, 0.3)
    for camadas in ((64, 32), (256, 128, 64)) for taxa in (1e-3, 1e-2)
]
SEMENTES_REDE = (10, 11, 12, 13, 14)


def media_do_termopar(base, treino, alvo):
    """A referência de HM: a média histórica de cada termopar, estimada só no treino."""
    y = base["Value"].to_numpy()
    media = pd.Series(y[treino]).groupby(base["TC_Name"].to_numpy()[treino]).mean()

    return base["TC_Name"].iloc[alvo].map(media).fillna(y[treino].mean()).to_numpy()


def _prever_area(algoritmo, hiperparametros, base, area, treino, alvo):
    """Ajusta um modelo em uma área e prevê as linhas de `alvo` dessa área."""
    area_de = base["Conjunto"].to_numpy()
    treino = treino[area_de[treino] == area]
    alvo = alvo[area_de[alvo] == area]
    configuracao = base[colunas_configuracao(base)].to_numpy(dtype=float)
    y = base["Value"].to_numpy()

    if algoritmo == "Ridge":
        indicadoras = pd.get_dummies(base["TC_Name"]).to_numpy(dtype=float)
        X = np.column_stack([configuracao, indicadoras])
        modelo = Ridge(**hiperparametros)
    else:
        X = np.column_stack([configuracao, base["codigo_na_area"].to_numpy()])
        classe = RandomForestRegressor if algoritmo == "Random Forest" else GradientBoostingRegressor
        extra = {"n_jobs": 1} if algoritmo == "Random Forest" else {}
        modelo = classe(random_state=SEMENTE, **extra, **hiperparametros)

    return alvo, modelo.fit(X[treino], y[treino]).predict(X[alvo])


def prever_por_area(algoritmo, hiperparametros, base, treino, alvo):
    """Um modelo por área, como nos notebooks 3.1 e 3.2; devolve a previsão na ordem de `alvo`."""
    saidas = Parallel(n_jobs=-1)(
        delayed(_prever_area)(algoritmo, hiperparametros, base, area, treino, alvo)
        for area in CONJUNTOS
    )

    return _reordenar(saidas, alvo)


def _reordenar(saidas, alvo):
    previsto = pd.Series(np.nan, index=alvo)

    for indices, valores in saidas:
        previsto.loc[indices] = valores

    return previsto.to_numpy()


def _rede_modulos():
    import torch
    import torch.nn as nn

    ativacoes = {"ReLU": nn.ReLU, "GELU": nn.GELU, "LeakyReLU": lambda: nn.LeakyReLU(0.01),
                 "tanh": nn.Tanh, "sigmoide": nn.Sigmoid}

    class RedeTermica(nn.Module):
        """Perceptron com embedding do termopar, blocos linear, normalização, ativação e dropout."""

        def __init__(self, n_termopares, n_configuracao, c):
            super().__init__()
            self.embedding = nn.Embedding(n_termopares, c["dimensao_embedding"])
            blocos, entrada = [], n_configuracao + c["dimensao_embedding"]

            for largura in c["camadas"]:
                linear = nn.Linear(entrada, largura)

                if c["ativacao"] in ("tanh", "sigmoide"):
                    ganho = nn.init.calculate_gain("tanh" if c["ativacao"] == "tanh" else "sigmoid")
                    nn.init.xavier_normal_(linear.weight, gain=ganho)
                else:
                    nn.init.kaiming_normal_(linear.weight, nonlinearity="relu")

                nn.init.zeros_(linear.bias)
                blocos.append(linear)

                if c["normalizacao_em_lote"]:
                    blocos.append(nn.BatchNorm1d(largura))

                blocos.append(ativacoes[c["ativacao"]]())

                if c["dropout"] > 0:
                    blocos.append(nn.Dropout(c["dropout"]))

                entrada = largura

            blocos.append(nn.Linear(entrada, 1))
            self.corpo = nn.Sequential(*blocos)

        def forward(self, x, termopar):
            return self.corpo(torch.cat([x, self.embedding(termopar)], dim=1)).squeeze(1)

    return torch, nn, RedeTermica


def treinar_rede(base, treino, alvo, c, semente, registrar_curva=False, adicionais=None):
    """Treina uma rede em `treino` e prevê `alvo`.

    Cuidados: cerca de 20% das configurações de cada modo de ensaio decidem a parada antecipada, sem
    retirar do ajuste todas as configurações de um modo, e os pesos da melhor época são restaurados;
    o alvo é o desvio em relação à média do termopar; o erro de treino é medido com o dropout
    desligado e só nas configurações que ajustaram os pesos. `alvo` só é consultado durante o treino
    quando `registrar_curva` pede o erro nele para desenhar a curva, e nunca decide nada.

    `adicionais` recebe linhas sintéticas, um DataFrame com as colunas de configuração,
    `indice_termopar` e `Value`, usado em `1_aumento_de_dados_sinteticos.ipynb`. Elas entram só nos
    lotes de ajuste dos pesos, sorteadas a cada época: a parada antecipada, a padronização e a média
    de referência de cada termopar continuam estimadas apenas nas leituras reais.
    """
    torch, nn, RedeTermica = _rede_modulos()
    torch.set_num_threads(1)
    torch.manual_seed(semente)
    gerador = np.random.default_rng(semente)

    # Sorteio dentro de cada modo: um modo com todas as configurações na parada antecipada ficaria
    # com a coluna constante no ajuste, e a rede preveria esse modo com pesos que nunca treinaram.
    configuracao = base["configuracao"].to_numpy()
    configuracoes_treino, primeira = np.unique(configuracao[treino], return_index=True)
    modo_da_configuracao = base["modo"].to_numpy()[treino][primeira]
    reservadas = []

    for modo in np.unique(modo_da_configuracao):
        do_modo = configuracoes_treino[modo_da_configuracao == modo]
        quantas = min(len(do_modo) - 1, round(0.2 * len(do_modo)))

        if quantas > 0:
            reservadas.extend(gerador.choice(do_modo, size=quantas, replace=False))

    em_parada = np.isin(configuracao[treino], reservadas)
    ajuste, parada = treino[~em_parada], treino[em_parada]

    X = base[colunas_configuracao(base)].to_numpy(dtype=np.float32)
    termopar = base["indice_termopar"].to_numpy()
    y = base["Value"].to_numpy()
    media_x, desvio_x = X[ajuste].mean(axis=0), X[ajuste].std(axis=0)
    desvio_x[desvio_x == 0] = 1.0

    if c["alvo"] == "relativo ao termopar":
        media = pd.Series(y[ajuste]).groupby(termopar[ajuste]).mean()
        referencia = np.array([media.get(t, y[ajuste].mean()) for t in range(termopar.max() + 1)])
    else:
        referencia = np.full(termopar.max() + 1, y[ajuste].mean())

    escala = float(np.std(y[ajuste] - referencia[termopar[ajuste]]))

    def tensores(indices):
        return (torch.tensor((X[indices] - media_x) / desvio_x),
                torch.tensor(termopar[indices]),
                torch.tensor(((y[indices] - referencia[termopar[indices]]) / escala)
                             .astype(np.float32)))

    def em_graus(saida, indices):
        return saida.numpy() * escala + referencia[termopar[indices]]

    rede = RedeTermica(termopar.max() + 1, X.shape[1], c)
    pesos = [p for n, p in rede.named_parameters() if n.endswith("weight") and p.dim() > 1]
    outros = [p for n, p in rede.named_parameters() if not (n.endswith("weight") and p.dim() > 1)]
    otimizador = torch.optim.AdamW([{"params": pesos, "weight_decay": c["decaimento_de_peso"]},
                                    {"params": outros, "weight_decay": 0.0}],
                                   lr=c["taxa_de_aprendizado"])
    agenda = torch.optim.lr_scheduler.ReduceLROnPlateau(otimizador, factor=0.5, patience=10)
    perda = nn.MSELoss()

    xa, ta, ya = tensores(ajuste)
    xp, tp, yp = tensores(parada)
    xv, tv, _ = tensores(alvo)
    x_lotes, t_lotes, y_lotes = xa, ta, ya
    sinteticas = 0 if adicionais is None else len(adicionais)

    if sinteticas > 0:
        termopar_sintetico = adicionais["indice_termopar"].to_numpy(dtype=np.int64)
        xs = torch.tensor(
            (adicionais[colunas_configuracao(base)].to_numpy(dtype=np.float32) - media_x) / desvio_x)
        ts = torch.tensor(termopar_sintetico)
        ys = torch.tensor(((adicionais["Value"].to_numpy() - referencia[termopar_sintetico]) / escala)
                          .astype(np.float32))

    melhor, melhor_estado, melhor_epoca, sem_melhora = np.inf, None, 0, 0
    curva = {"treino": [], "validação": [], "teste": []}

    for epoca in range(c["epocas_maximas"]):
        rede.train()

        if sinteticas > 0:
            # A cada época, todas as leituras reais e um sorteio de no máximo o mesmo número de
            # linhas sintéticas: o custo da época fica no dobro, e não na razão entre as duas.
            sorteio = torch.randperm(sinteticas)[:len(ajuste)]
            x_lotes = torch.cat([xa, xs[sorteio]])
            t_lotes = torch.cat([ta, ts[sorteio]])
            y_lotes = torch.cat([ya, ys[sorteio]])

        ordem = torch.randperm(len(y_lotes))

        for inicio in range(0, len(y_lotes), c["tamanho_do_lote"]):
            lote = ordem[inicio:inicio + c["tamanho_do_lote"]]

            if len(lote) > 1:
                otimizador.zero_grad()
                perda(rede(x_lotes[lote], t_lotes[lote]), y_lotes[lote]).backward()
                otimizador.step()

        rede.eval()

        with torch.no_grad():
            perda_parada = perda(rede(xp, tp), yp).item()

            if registrar_curva:
                for chave, (xs, ts, indices) in (("treino", (xa, ta, ajuste)),
                                                 ("validação", (xp, tp, parada)),
                                                 ("teste", (xv, tv, alvo))):
                    curva[chave].append(float(np.mean(np.abs(
                        em_graus(rede(xs, ts), indices) - y[indices]))))

        agenda.step(perda_parada)

        if perda_parada < melhor - 1e-6:
            melhor, melhor_epoca, sem_melhora = perda_parada, epoca, 0
            melhor_estado = copy.deepcopy(rede.state_dict())
        else:
            sem_melhora += 1

            if sem_melhora >= c["paciencia"]:
                break

    rede.load_state_dict(melhor_estado)
    rede.eval()

    with torch.no_grad():
        return {
            "previsao": em_graus(rede(xv, tv), alvo),
            "previsao_ajuste": em_graus(rede(xa, ta), ajuste),
            "indices_ajuste": ajuste,
            "melhor_epoca": melhor_epoca + 1,
            "epocas": epoca + 1,
            "curva": {k: np.array(v) for k, v in curva.items()} if registrar_curva else None,
        }


def prever_rede(base, treino, alvo, c, sementes=SEMENTES_REDE):
    """Média das redes treinadas com cada semente: uma rede isolada varia demais com a semente."""
    saidas = Parallel(n_jobs=-1)(
        delayed(treinar_rede)(base, treino, alvo, c, s) for s in sementes)

    return np.mean([s["previsao"] for s in saidas], axis=0)


def prever(algoritmo, hiperparametros, base, treino, alvo):
    """Interface única dos cinco candidatos."""
    if algoritmo == "Média do termopar":
        return media_do_termopar(base, treino, alvo)

    if algoritmo == "Rede neural":
        return prever_rede(base, treino, alvo, hiperparametros)

    return prever_por_area(algoritmo, hiperparametros, base, treino, alvo)


def _previsoes_de_validacao(algoritmo, combinacoes, base, particoes, sementes):
    """Previsão de validação de cada combinação em cada partição, numa única rodada paralela.

    Devolve uma lista por combinação, com uma previsão por partição. A rede, que é uma só para as
    seis áreas, paraleliza sobre partições e sementes; os demais, sobre partições e áreas.
    """
    if algoritmo == "Rede neural":
        saidas = Parallel(n_jobs=-1)(
            delayed(treinar_rede)(base, a, v, c, s)
            for c in combinacoes for a, v in particoes for s in sementes)
        medias = [np.mean([saidas[i + k]["previsao"] for k in range(len(sementes))], axis=0)
                  for i in range(0, len(saidas), len(sementes))]
    else:
        saidas = Parallel(n_jobs=-1)(
            delayed(_prever_area)(algoritmo, c, base, area, a, v)
            for c in combinacoes for a, v in particoes for area in CONJUNTOS)
        n = len(CONJUNTOS)
        alvos = [v for _ in combinacoes for _, v in particoes]
        medias = [_reordenar(saidas[i * n:(i + 1) * n], alvo) for i, alvo in enumerate(alvos)]

    return [medias[i * len(particoes):(i + 1) * len(particoes)] for i in range(len(combinacoes))]


def previsoes_fora_da_amostra(algoritmo, hiperparametros, base, treino, sementes=SEMENTES_REDE):
    """Previsão de cada medição do treino por um modelo que não viu a configuração dela."""
    if algoritmo == "Média do termopar":
        fora = pd.Series(np.nan, index=treino)

        for ajuste, validacao in particoes_de_validacao(base, treino):
            fora.loc[validacao] = media_do_termopar(base, ajuste, validacao)

        return fora.to_numpy()

    particoes = particoes_de_validacao(base, treino)
    [por_particao] = _previsoes_de_validacao(algoritmo, [hiperparametros], base, particoes,
                                             sementes)
    fora = pd.Series(np.nan, index=treino)

    for (_, validacao), previsao in zip(particoes, por_particao):
        fora.loc[validacao] = previsao

    return fora.to_numpy()


def escolher_hiperparametros(algoritmo, base, treino, devolver_fora=False):
    """Avalia a grade do algoritmo por validação cruzada no treino; o teste não participa.

    Cada combinação é medida por MAE, MSE, RMSE e R² de validação, e a escolha é pela de menor MAE.
    A rede é avaliada com uma semente por combinação, para caber no tempo de execução; o modelo
    final dela é a média de cinco sementes. Com `devolver_fora`, devolve também a previsão fora da
    amostra da combinação escolhida, na ordem de `treino`, a mesma de `previsoes_fora_da_amostra`
    para os modelos que não dependem de semente.
    """
    grade = GRADES[algoritmo]
    particoes = particoes_de_validacao(base, treino)
    y = base["Value"].to_numpy()
    previsoes = _previsoes_de_validacao(algoritmo, grade, base, particoes, (SEMENTE,))
    validacao = np.concatenate([v for _, v in particoes])
    linhas = []

    for combinacao, por_particao in zip(grade, previsoes):
        metricas = metricas_regressao(y[validacao], np.concatenate(por_particao))
        linhas.append({
            **{k: str(v) for k, v in combinacao.items() if k in _CHAVES_VARIAVEIS[algoritmo]},
            **{f"{k} validação": metricas[k] for k in ("MAE (C)", "MSE (C2)", "RMSE (C)", "R2")},
        })

    posicao = int(np.argmin([linha["MAE (C) validação"] for linha in linhas]))
    tabela = pd.DataFrame(linhas).sort_values("MAE (C) validação").reset_index(drop=True)

    if not devolver_fora:
        return grade[posicao], tabela

    fora = pd.Series(np.nan, index=treino)

    for (_, indices), previsao in zip(particoes, previsoes[posicao]):
        fora.loc[indices] = previsao

    return grade[posicao], tabela, fora.to_numpy()


def tabela_da_busca(algoritmo, combinacoes, base, treino):
    """Métricas de validação de cada combinação, com a variação do MAE entre as partições.

    Usa as mesmas partições e as mesmas previsões de `escolher_hiperparametros`, e por isso a
    combinação de menor MAE é a mesma que ela escolhe. O MAE junta as cinco partições, como na
    escolha. O desvio-padrão do MAE entre as partições mostra se o resultado é estável ou depende de
    qual configuração caiu em qual partição, e a lista `MAE por partição` permite comparar duas
    combinações partição a partição. Só aparecem como colunas os hiperparâmetros que variam.
    """
    particoes = particoes_de_validacao(base, treino)
    y = base["Value"].to_numpy()
    validacao = np.concatenate([v for _, v in particoes])
    previsoes = _previsoes_de_validacao(algoritmo, combinacoes, base, particoes, (SEMENTE,))
    chaves = list(dict.fromkeys(k for c in combinacoes for k in c))
    variaveis = [k for k in chaves if len({str(c.get(k)) for c in combinacoes}) > 1]
    linhas = []

    for combinacao, por_particao in zip(combinacoes, previsoes):
        metricas = metricas_regressao(y[validacao], np.concatenate(por_particao))
        mae_particao = [float(np.abs(p - y[v]).mean()) for p, (_, v) in zip(por_particao, particoes)]
        linhas.append({
            **{k: "sem limite" if combinacao.get(k) is None else combinacao.get(k) for k in variaveis},
            "MAE (C) validação": metricas["MAE (C)"],
            "Desvio do MAE entre partições (C)": float(np.std(mae_particao)),
            "MSE (C2) validação": metricas["MSE (C2)"],
            "RMSE (C) validação": metricas["RMSE (C)"],
            "R2 validação": metricas["R2"],
            "MAE por partição": mae_particao,
        })

    return pd.DataFrame(linhas).sort_values("MAE (C) validação").reset_index(drop=True)


def tabela_de_ajuste(conjuntos):
    """MAE, MSE, RMSE e R² em cada conjunto, com a razão entre RMSE e MAE.

    `conjuntos` associa um nome, como treino, validação ou teste, ao par (medido, previsto). A
    razão RMSE/MAE fica perto de 1,25 quando o erro é aproximadamente normal, e acima disso quando
    ele se concentra em poucas medições.
    """
    linhas = {}

    for nome, (medido, previsto) in conjuntos.items():
        m = metricas_regressao(medido, previsto)
        linhas[nome] = {"MAE (C)": m["MAE (C)"], "MSE (C2)": m["MSE (C2)"],
                        "RMSE (C)": m["RMSE (C)"], "R2": m["R2"],
                        "RMSE / MAE": m["RMSE (C)"] / m["MAE (C)"]}

    return pd.DataFrame(linhas).T


def formatar_tabela(tabela, casas=3):
    """Arredonda números, mostra contagens como inteiros e preserva textos, para exibição.

    As colunas ficam com tipo objeto: se voltassem a ser numéricas, o pandas converteria as
    contagens de novo em números decimais.
    """
    def formatar(valor):
        if isinstance(valor, (float, np.floating)):
            return int(valor) if float(valor).is_integer() else round(float(valor), casas)

        return valor

    formatada = tabela.astype(object).copy()

    for posicao in range(formatada.shape[1]):
        formatada.iloc[:, posicao] = pd.Series(
            [formatar(v) for v in formatada.iloc[:, posicao]], index=formatada.index, dtype=object)

    return formatada


_CHAVES_VARIAVEIS = {
    "Ridge": ("alpha",),
    "Random Forest": ("min_samples_leaf", "max_features"),
    "Gradient Boosting": ("max_depth", "learning_rate", "n_estimators"),
    "Rede neural": ("ativacao", "dropout", "camadas", "taxa_de_aprendizado"),
}


# ------------------------------------------------------------------------------------------------
# Figuras
# ------------------------------------------------------------------------------------------------

def figura_previsto_medido(painel, y, previsto, titulo, cor=AZUL):
    extremos = np.array([min(y.min(), previsto.min()), max(y.max(), previsto.max())])
    painel.fill_between(extremos, extremos - 10, extremos + 10, color=AZUL_CLARO, alpha=0.3,
                        label="±10 °C")
    painel.plot(extremos, extremos, color=CINZA, linewidth=1, label="acerto perfeito")
    painel.scatter(y, previsto, s=9, color=cor, alpha=0.5, edgecolor="none")
    painel.set_xlabel("temperatura medida (°C)")
    painel.set_ylabel("temperatura prevista (°C)")
    painel.set_title(titulo, fontsize=9)
    painel.legend(fontsize=7, loc="upper left")


def figura_matriz_confusao(painel, matriz, titulo):
    rotulos = ["não excede", "excede"]
    painel.imshow(matriz / matriz.sum(axis=1, keepdims=True), cmap="Blues", vmin=0, vmax=1)

    for i in range(2):
        for j in range(2):
            proporcao = matriz[i, j] / max(matriz[i].sum(), 1)
            painel.text(j, i, f"{matriz[i, j]}\n{100 * proporcao:.1f}%", ha="center",
                        va="center", fontsize=9, color="white" if proporcao > 0.5 else "black")

    painel.set_xticks([0, 1], labels=[f"previsto: {r}" for r in rotulos], fontsize=7.5)
    painel.set_yticks([0, 1], labels=[f"real: {r}" for r in rotulos], fontsize=7.5)
    painel.set_title(titulo, fontsize=9)
    painel.grid(visible=False)
