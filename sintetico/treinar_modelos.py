"""Treina e avalia os modelos do Thermal Predictor sobre a base sintética.

Reproduz a arquitetura do modelo final do projeto, um algoritmo por subsistema do fogão, com os
mesmos hiperparâmetros escolhidos na comparação de modelos:

- média de Random Forest e Gradient Boosting em Mainback, Coil Temps, Main Vent Sys,
  HMI / Knobs / Console e AC Blower Inlet;
- SVR com o ponto codificado em indicadoras em IPC Comp;
- Extra Trees em IPC Cooling.

O treino usa a mesma codificação da API do painel (`api.predicao.codificacao`), então o vetor que
o modelo vê no treino é o mesmo que ele recebe em produção.

A avaliação segue o protocolo do projeto, aqui aplicado à base sintética:

- teste isolado: algumas configurações de ensaio ficam inteiramente fora do treino;
- 40 divisões sorteadas por configuração, para medir a variação do erro;
- referência sem modelo: a média histórica de cada ponto no treino;
- critério de aceite: erro médio do ponto dentro de 10% do limite em pelo menos 90% dos pontos;
- regra RN-01 de risco, para medir sensibilidade, falsos negativos e falsos positivos.

Grava em `modelos/modelo_final/` um `.joblib` e um `.json` por subsistema, e as métricas
agregadas em `modelos/desempenho_modelo_final.json`, os arquivos que a API e o Robertão leem. O
mesmo arquivo leva, no campo `base`, as estatísticas sem modelo da tela de engenharia, calculadas
por `estatisticas_da_base.py`.

Uso, na raiz do repositório e depois de `python sintetico/gerar_base_sintetica.py`:

    python sintetico/treinar_modelos.py
    python sintetico/treinar_modelos.py --divisoes 10   # avaliação mais rápida
"""

import argparse
import itertools
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from scipy import stats
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (ExtraTreesRegressor, GradientBoostingRegressor,
                              RandomForestRegressor, VotingRegressor)
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVR

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "dashboard"))

from api.predicao.codificacao import COLUNA_TERMOPAR, montar_vetor_configuracao  # noqa: E402
from estatisticas_da_base import calcular as estatisticas_da_base, wilson  # noqa: E402

ARQUIVO_BASE = RAIZ / "dataset_completo_com_flags_de_auditoria.csv"
PASTA_MODELOS = RAIZ / "modelos"
FAMILIA = "modelo_final"
VERSAO = "sintetico-1.0"
SEMENTE = 42
TOLERANCIA_FRACAO = 0.10
PISO_APROVACAO_PCT = 90.0
FRACAO_TESTE = 0.15

COLUNAS_CONFIGURACAO = [
    "losses_present_missing", "losses_config_m", "losses_order_back_order",
    "losses_order_front_order", "Run_Case_Broil C1", "Run_Case_Broil C2", "Run_Case_Pyro",
    "Blower_Direction_To Back", "Housing_Open", "Board_Position_Right", "Deflector_Hole_Open",
    "Material_Coil_Support_Aluminium Plate", "Material_Coil_Support_Plastic",
]

HP_MEDIA = {
    "Random Forest": {"n_estimators": 300, "min_samples_leaf": 1, "max_features": 1.0},
    "Gradient Boosting": {"n_estimators": 600, "learning_rate": 0.015, "max_depth": 6,
                          "subsample": 0.8},
}
HP_SVR = {"C": 1000.0, "epsilon": 1.0, "gamma": "scale"}
HP_EXTRA_TREES = {"n_estimators": 300, "max_depth": 16, "max_features": 0.66,
                  "min_samples_leaf": 1}

PONTOS_AC_BLOWER_INLET = ("Entrada do soprador P01", "Entrada do soprador P02")

# Um modelo por subsistema: quais pontos ele cobre e qual algoritmo usa.
SUBSISTEMAS = [
    {"conjunto": "Mainback", "id": "mainback", "areas": ("Mainback",), "algoritmo": "media"},
    {"conjunto": "Coil Temps", "id": "coil_temps", "areas": ("Coil Temps",), "algoritmo": "media"},
    {"conjunto": "Main Vent Sys", "id": "main_vent_sys", "areas": ("Main Vent Sys",),
     "excluir": PONTOS_AC_BLOWER_INLET, "algoritmo": "media"},
    {"conjunto": "IPC Cooling", "id": "ipc_cooling", "areas": ("IPC Cooling",),
     "algoritmo": "extra_trees"},
    {"conjunto": "IPC Comp", "id": "ipc_comp", "areas": ("IPC Comp",), "algoritmo": "svr"},
    {"conjunto": "HMI / Knobs / Console", "id": "hmi_knobs_console",
     "areas": ("CT Knobs", "Oven HMI"), "algoritmo": "media"},
    # Poucas rodadas com leitura: treinado com toda a base disponível, sem validação.
    {"conjunto": "AC Blower Inlet", "id": "ac_blower_inlet", "pontos": PONTOS_AC_BLOWER_INLET,
     "algoritmo": "media", "validado": False},
]

ROTULOS_ALGORITMO = {
    "media": "Média de Random Forest e Gradient Boosting",
    "svr": "SVR",
    "extra_trees": "Extra Trees",
}

FAIXAS_DE_LIMITE = [(0, 90, "até 90 °C"), (90, 110, "90 a 110 °C"),
                    (110, 130, "110 a 130 °C"), (130, 250, "acima de 130 °C")]


def construir_estimador(algoritmo):
    if algoritmo == "media":
        rf = RandomForestRegressor(**HP_MEDIA["Random Forest"], random_state=SEMENTE, n_jobs=-1)
        gb = GradientBoostingRegressor(**HP_MEDIA["Gradient Boosting"], random_state=SEMENTE)
        return VotingRegressor([("rf", rf), ("gb", gb)])
    if algoritmo == "svr":
        colunas = ColumnTransformer(
            [("ponto", OneHotEncoder(handle_unknown="ignore", sparse_output=False),
              [len(COLUNAS_CONFIGURACAO)])],
            remainder="passthrough")
        return Pipeline([("colunas", colunas), ("zscore", StandardScaler()),
                         ("modelo", SVR(**HP_SVR))])
    if algoritmo == "extra_trees":
        return ExtraTreesRegressor(**HP_EXTRA_TREES, random_state=SEMENTE, n_jobs=-1)
    raise ValueError(algoritmo)


def construir_alternativo(familia):
    """Famílias alternativas que a API também serve: um único algoritmo em todo subsistema."""
    if familia == "random_forest":
        return RandomForestRegressor(**HP_MEDIA["Random Forest"], random_state=SEMENTE, n_jobs=-1)
    return GradientBoostingRegressor(**HP_MEDIA["Gradient Boosting"], random_state=SEMENTE)


FAMILIAS_ALTERNATIVAS = {"random_forest": "Random Forest", "gradient_boosting": "Gradient Boosting"}


def metricas_de_teste(resumo, maes=None):
    metricas = {
        "MAE (C)": resumo["mae_c"],
        "RMSE (C)": resumo["rmse_c"],
        "R2": resumo["r2"],
        "Acerto +-5 C (%)": resumo["acerto_5c_pct"],
        "Acerto +-10 C (%)": resumo["acerto_10c_pct"],
        "MAE / amplitude (%)": (100 * resumo["mae_c"] / resumo["amplitude"]
                                if resumo["amplitude"] else None),
    }
    if maes:
        metricas[f"MAE médio, {len(maes)} divisões (C)"] = float(np.mean(maes))
    return metricas


def exportar(pasta, subsistema, modelo, rotulo, hp, validado, metricas, base_nome, codigos):
    """Grava o artefato e os metadados que a API e o Robertão leem."""
    pasta.mkdir(parents=True, exist_ok=True)
    joblib.dump(modelo, pasta / f"{subsistema['id']}.joblib", compress=3)
    if isinstance(modelo, Pipeline):
        composicao = [f"{n}: {type(e).__name__}" for n, e in modelo.steps]
    elif isinstance(modelo, VotingRegressor):
        composicao = [f"{n}: {type(e).__name__}" for n, e in modelo.estimators]
    else:
        composicao = [type(modelo).__name__]
    metadados = {
        "conjunto": subsistema["conjunto"],
        "algoritmo": rotulo,
        "versao": VERSAO,
        "base": "sintética",
        "arquivo_origem": base_nome,
        "colunas_entrada": COLUNAS_CONFIGURACAO + [COLUNA_TERMOPAR],
        "codigo_por_termopar": codigos,
        "hiperparametros": hp,
        "validado": validado,
        "observacao": ("Treinado sobre a base sintética gerada por "
                       "sintetico/gerar_base_sintetica.py. As métricas não têm significado "
                       "físico e não correspondem aos resultados do projeto."),
        "versao_scikit_learn": sklearn.__version__,
        "metricas_validacao": metricas,
        "composicao": composicao,
    }
    with open(pasta / f"{subsistema['id']}.json", "w", encoding="utf-8") as arquivo:
        json.dump(metadados, arquivo, ensure_ascii=False, indent=2)


def hiperparametros(algoritmo):
    return {"media": HP_MEDIA, "svr": HP_SVR, "extra_trees": HP_EXTRA_TREES}[algoritmo]


def configuracao_da_linha(linha):
    """Fatores de uma rodada no formato do formulário do painel (POST /predicao)."""
    if linha["losses_present_declared"] == 1:
        perdas = {"present": "declared",
                  "config": "Config M" if linha["losses_config_m"] == 1 else "Config S"}
        if linha["losses_order_back_order"] == 1:
            perdas["order"] = "Back Order"
        elif linha["losses_order_front_order"] == 1:
            perdas["order"] = "Front Order"
    elif linha["losses_present_missing"] == 1:
        perdas = {"present": "missing"}
    else:
        perdas = {"present": "none"}
    return {
        "blower_direction": linha["Blower_Direction"],
        "housing": linha["Housing"],
        "board_position": linha["Board_Position"],
        "run_case": linha["Run_Case"],
        "deflector_hole": linha["Deflector_Hole"],
        "material_coil_support": linha["Material_Coil_Support"],
        "losses": perdas,
    }


def carregar_base(caminho):
    if not caminho.is_file():
        sys.exit(f"Base não encontrada em {caminho}. Rode antes: "
                 "python sintetico/gerar_base_sintetica.py")
    base = pd.read_csv(caminho)
    rodadas = base.drop_duplicates("Run_ID").set_index("Run_ID")
    vetores = {rodada: montar_vetor_configuracao(configuracao_da_linha(linha), COLUNAS_CONFIGURACAO)
               for rodada, linha in rodadas.iterrows()}
    # Grupo = configuração codificada: réplicas da mesma configuração nunca se separam.
    grupos = {}
    configuracao_da_rodada = {}
    for rodada, vetor in vetores.items():
        configuracao_da_rodada[rodada] = grupos.setdefault(tuple(vetor), len(grupos))
    observadas = base[base["missing_class"] == "observed"].copy()
    observadas["grupo"] = observadas["Run_ID"].map(configuracao_da_rodada)
    return base, observadas, vetores, configuracao_da_rodada


# Perdas que uma rodada fora da limpeza pirolítica pode ter; a pirolítica é a única sem perda.
PERDAS_POSSIVEIS = [{"present": "missing"}] + [
    {"present": "declared", "config": arranjo, "order": ordem}
    for arranjo in ("Config S", "Config M") for ordem in ("Front Order", "Back Order")]


def configuracoes_possiveis(base):
    """Quantas configurações codificadas o plano admite com os níveis presentes na base."""
    fatores = {"blower_direction": "Blower_Direction", "housing": "Housing",
               "board_position": "Board_Position", "deflector_hole": "Deflector_Hole",
               "material_coil_support": "Material_Coil_Support"}
    niveis = [sorted(base[coluna].dropna().unique()) for coluna in fatores.values()]
    vetores = set()
    for caso in base["Run_Case"].dropna().unique():
        perdas = [{"present": "none"}] if caso == "Pyro" else PERDAS_POSSIVEIS
        for combinacao, perda in itertools.product(itertools.product(*niveis), perdas):
            configuracao = dict(zip(fatores, combinacao), run_case=caso, losses=perda)
            vetores.add(tuple(montar_vetor_configuracao(configuracao, COLUNAS_CONFIGURACAO)))
    return len(vetores)


def pontos_do_subsistema(base, subsistema):
    if "pontos" in subsistema:
        selecao = base["TC_Name"].isin(subsistema["pontos"])
    else:
        selecao = base["Key_Area"].isin(subsistema["areas"])
        selecao &= ~base["TC_Name"].isin(subsistema.get("excluir", ()))
    return selecao


def matriz(linhas, vetores, codigos):
    return np.array([vetores[r] + [float(codigos[t])]
                     for r, t in zip(linhas["Run_ID"], linhas["TC_Name"])])


def classificar(previsto, limite):
    """Regra RN-01 do painel."""
    margem = limite - previsto
    if margem < 0:
        return "acima_do_limite"
    if margem < TOLERANCIA_FRACAO * limite:
        return "banda_de_incerteza"
    return "dentro_do_limite"


def avaliar(treino, teste, subsistema, vetores, codigos):
    """Ajusta no treino e mede no teste: erros, aprovação por ponto e decisões da RN-01."""
    modelo = construir_estimador(subsistema["algoritmo"])
    modelo.fit(matriz(treino, vetores, codigos), treino["Value"].to_numpy())
    previsto = modelo.predict(matriz(teste, vetores, codigos))
    media_do_ponto = treino.groupby("TC_Name")["Value"].mean()
    referencia = teste["TC_Name"].map(media_do_ponto).fillna(treino["Value"].mean()).to_numpy()
    real = teste["Value"].to_numpy()

    resultado = teste[["TC_Name", "limit_c"]].copy()
    resultado["erro"] = np.abs(previsto - real)
    resultado["erro_ref"] = np.abs(referencia - real)
    resultado["real"] = real
    resultado["previsto"] = previsto
    return resultado


def resumir(resultado):
    """Métricas de um conjunto de previsões de teste (um subsistema ou vários)."""
    erro = resultado["erro"].to_numpy()
    real = resultado["real"].to_numpy()
    previsto = resultado["previsto"].to_numpy()
    soma_quadrados = float(((real - real.mean()) ** 2).sum())
    com_limite = resultado.dropna(subset=["limit_c"])
    por_ponto = com_limite.groupby("TC_Name").agg(mae=("erro", "mean"), limite=("limit_c", "first"))
    aprovados = int((por_ponto["mae"] <= TOLERANCIA_FRACAO * por_ponto["limite"]).sum())

    excedencias = falsos_negativos = falsos_positivos = detectadas = 0
    for linha in com_limite.itertuples():
        estado = classificar(linha.previsto, linha.limit_c)
        excedeu = linha.real > linha.limit_c
        if excedeu:
            excedencias += 1
            if estado == "dentro_do_limite":
                falsos_negativos += 1
            else:
                detectadas += 1
        elif estado == "acima_do_limite":
            falsos_positivos += 1

    return {
        "mae_c": float(erro.mean()),
        "rmse_c": float(np.sqrt((erro ** 2).mean())),
        "r2": (1 - float((erro ** 2).sum()) / soma_quadrados) if soma_quadrados else None,
        "acerto_5c_pct": float(100 * (erro <= 5).mean()),
        "acerto_10c_pct": float(100 * (erro <= 10).mean()),
        "amplitude": float(real.max() - real.min()) if len(real) else 0.0,
        "mae_ref_c": float(resultado["erro_ref"].mean()),
        "pontos_aprovados": aprovados,
        "pontos_com_limite": int(len(por_ponto)),
        "por_ponto": por_ponto,
        "excedencias": excedencias,
        "sensibilidade_pct": (100 * detectadas / excedencias) if excedencias else None,
        "falsos_negativos": falsos_negativos,
        "falsos_positivos": falsos_positivos,
    }


def aprovacao_pct(resumo):
    if not resumo["pontos_com_limite"]:
        return None
    return 100 * resumo["pontos_aprovados"] / resumo["pontos_com_limite"]


def arredondar(valor, casas=4):
    return None if valor is None else round(float(valor), casas)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", type=Path, default=ARQUIVO_BASE)
    parser.add_argument("--divisoes", type=int, default=40,
                        help="divisões sorteadas por configuração na avaliação (padrão 40)")
    args = parser.parse_args()

    inicio = time.time()
    base, observadas, vetores, configuracao_da_rodada = carregar_base(args.base)
    total_configuracoes = len(set(configuracao_da_rodada.values()))
    grupos = np.array(sorted(observadas["grupo"].unique()))
    rng = np.random.default_rng(SEMENTE)
    n_teste = max(5, round(FRACAO_TESTE * len(grupos)))
    grupos_teste = set(rng.choice(grupos, size=n_teste, replace=False).tolist())
    divisor = GroupShuffleSplit(n_splits=args.divisoes, test_size=0.2, random_state=SEMENTE)
    divisoes = list(divisor.split(grupos, groups=grupos))

    pasta = PASTA_MODELOS / FAMILIA
    pasta.mkdir(parents=True, exist_ok=True)
    por_dataset, testes_validados = [], []
    divisoes_por_indice = {i: [] for i in range(len(divisoes))}

    print(f"Base: {len(observadas)} leituras observadas, {total_configuracoes} configurações.")
    for subsistema in SUBSISTEMAS:
        validado = subsistema.get("validado", True)
        linhas = observadas[pontos_do_subsistema(observadas, subsistema)]
        nomes = sorted(base.loc[pontos_do_subsistema(base, subsistema), "TC_Name"].unique())
        nomes = [n for n in nomes if n in set(linhas["TC_Name"])]
        codigos = {nome: i for i, nome in enumerate(nomes)}
        rotulo = ROTULOS_ALGORITMO[subsistema["algoritmo"]]
        print(f"- {subsistema['conjunto']}: {len(nomes)} pontos, {len(linhas)} leituras, {rotulo}")

        metricas_modelo, resumo_teste = None, None
        if validado:
            no_teste = linhas["grupo"].isin(grupos_teste)
            resultado = avaliar(linhas[~no_teste], linhas[no_teste], subsistema, vetores, codigos)
            resumo_teste = resumir(resultado)
            testes_validados.append(resultado)

            maes, maes_ref, aprovacoes = [], [], []
            for i, (_, indices_teste) in enumerate(divisoes):
                grupos_da_divisao = set(grupos[indices_teste])
                em_teste = linhas["grupo"].isin(grupos_da_divisao)
                if not em_teste.any() or em_teste.all():
                    continue
                parcial = avaliar(linhas[~em_teste], linhas[em_teste], subsistema, vetores, codigos)
                divisoes_por_indice[i].append(parcial)
                resumo = resumir(parcial)
                maes.append(resumo["mae_c"])
                maes_ref.append(resumo["mae_ref_c"])
                if resumo["pontos_com_limite"]:
                    aprovacoes.append(aprovacao_pct(resumo))

            metricas_modelo = metricas_de_teste(resumo_teste, maes)
            por_dataset.append({
                "dataset": subsistema["conjunto"], "modelo_final": rotulo, "validado": True,
                "mae_teste_c": arredondar(resumo_teste["mae_c"]),
                "rmse_teste_c": arredondar(resumo_teste["rmse_c"]),
                "r2_teste": arredondar(resumo_teste["r2"]),
                "pontos_aprovados": resumo_teste["pontos_aprovados"],
                "pontos_com_limite": resumo_teste["pontos_com_limite"],
                "aprovacao_teste_pct": arredondar(aprovacao_pct(resumo_teste), 2),
                "mae_40_divisoes_c": arredondar(np.mean(maes)),
                "aprovacao_mediana_40_divisoes_pct": arredondar(
                    np.median(aprovacoes) if aprovacoes else None, 2),
                "excedencias_teste": resumo_teste["excedencias"],
                "sensibilidade_pct": arredondar(resumo_teste["sensibilidade_pct"], 2),
                "falsos_negativos": resumo_teste["falsos_negativos"],
                "falsos_positivos": resumo_teste["falsos_positivos"],
                "referencia_mae_teste_c": arredondar(resumo_teste["mae_ref_c"]),
                "referencia_mae_40_divisoes_c": arredondar(np.mean(maes_ref)),
            })
        else:
            por_dataset.append({
                "dataset": subsistema["conjunto"], "modelo_final": None, "validado": False,
                "motivo": "Poucas rodadas com leitura nesta área: o modelo foi treinado com toda "
                          "a base disponível e não tem validação.",
            })

        X, y = matriz(linhas, vetores, codigos), linhas["Value"].to_numpy()
        modelo = construir_estimador(subsistema["algoritmo"])
        modelo.fit(X, y)
        exportar(pasta, subsistema, modelo, rotulo, hiperparametros(subsistema["algoritmo"]),
                 validado, metricas_modelo, args.base.name, codigos)

        for familia, rotulo_familia in FAMILIAS_ALTERNATIVAS.items():
            metricas_alt = None
            if validado:
                no_teste = linhas["grupo"].isin(grupos_teste)
                treino, teste = linhas[~no_teste], linhas[no_teste]
                alternativo = construir_alternativo(familia)
                alternativo.fit(matriz(treino, vetores, codigos), treino["Value"].to_numpy())
                previsto = alternativo.predict(matriz(teste, vetores, codigos))
                media = treino.groupby("TC_Name")["Value"].mean()
                resultado = teste[["TC_Name", "limit_c"]].copy()
                resultado["real"] = teste["Value"].to_numpy()
                resultado["previsto"] = previsto
                resultado["erro"] = np.abs(previsto - resultado["real"].to_numpy())
                resultado["erro_ref"] = np.abs(
                    teste["TC_Name"].map(media).to_numpy() - resultado["real"].to_numpy())
                metricas_alt = metricas_de_teste(resumir(resultado))
            alternativo = construir_alternativo(familia)
            alternativo.fit(X, y)
            hp = HP_MEDIA[rotulo_familia]
            exportar(PASTA_MODELOS / familia, subsistema, alternativo, rotulo_familia, hp,
                     validado, metricas_alt, args.base.name, codigos)

    teste_global = resumir(pd.concat(testes_validados, ignore_index=True))
    maes, maes_ref, aprovacoes = [], [], []
    for partes in divisoes_por_indice.values():
        if not partes:
            continue
        resumo = resumir(pd.concat(partes, ignore_index=True))
        maes.append(resumo["mae_c"])
        maes_ref.append(resumo["mae_ref_c"])
        aprovacoes.append(aprovacao_pct(resumo))
    teste_wilcoxon = stats.wilcoxon(maes, maes_ref)

    por_faixa = []
    pontos_globais = teste_global["por_ponto"]
    for minimo, maximo, rotulo in FAIXAS_DE_LIMITE:
        faixa = pontos_globais[(pontos_globais["limite"] >= minimo) &
                               (pontos_globais["limite"] < maximo)]
        aprovados = int((faixa["mae"] <= TOLERANCIA_FRACAO * faixa["limite"]).sum())
        por_faixa.append({
            "faixa": rotulo, "limite_min_c": float(minimo), "limite_max_c": float(maximo),
            "pontos": int(len(faixa)), "aprovados": aprovados,
            "aprovacao_pct": arredondar(100 * aprovados / len(faixa), 2) if len(faixa) else None,
            "mae_medio_c": arredondar(faixa["mae"].mean()) if len(faixa) else None,
        })

    desempenho = {
        "versao_modelo": VERSAO,
        "origem": "sintetico/treinar_modelos.py",
        "observacao": ("Métricas calculadas sobre a base sintética, sem nenhuma medição real. "
                       "Demonstram o protocolo de avaliação do projeto, não o seu resultado."),
        "piso_aprovacao_pct": PISO_APROVACAO_PCT,
        "tolerancia_fracao": TOLERANCIA_FRACAO,
        "global": {
            "mae_teste_c": arredondar(teste_global["mae_c"]),
            "rmse_teste_c": arredondar(teste_global["rmse_c"]),
            "r2_teste": arredondar(teste_global["r2"]),
            "pontos_aprovados": teste_global["pontos_aprovados"],
            "pontos_com_limite": teste_global["pontos_com_limite"],
            "aprovacao_teste_pct": arredondar(aprovacao_pct(teste_global), 2),
            "mae_40_divisoes_c": arredondar(np.mean(maes)),
            "aprovacao_mediana_40_divisoes_pct": arredondar(np.median(aprovacoes), 2),
            "excedencias_teste": teste_global["excedencias"],
            "sensibilidade_pct": arredondar(teste_global["sensibilidade_pct"], 2),
            "falsos_negativos": teste_global["falsos_negativos"],
            "falsos_positivos": teste_global["falsos_positivos"],
            "aprovacao_teste_wilson_pct": wilson(teste_global["pontos_aprovados"],
                                                 teste_global["pontos_com_limite"]),
            "divisoes": len(maes),
            "divisoes_no_piso": int(sum(a >= PISO_APROVACAO_PCT for a in aprovacoes)),
            "referencia": {
                "estrategia": "Média histórica do ponto no treino, sem modelo.",
                "mae_teste_c": arredondar(teste_global["mae_ref_c"]),
                "mae_40_divisoes_c": arredondar(np.mean(maes_ref)),
            },
            "wilcoxon": {
                "descricao": ("Wilcoxon pareado entre o MAE do modelo e o da média histórica, "
                              "divisão a divisão."),
                "pares": len(maes),
                "estatistica": arredondar(teste_wilcoxon.statistic),
                "p": float(teste_wilcoxon.pvalue),
                "divisoes_em_que_o_modelo_erra_menos": int(sum(
                    m < r for m, r in zip(maes, maes_ref))),
            },
        },
        "por_dataset": por_dataset,
        "por_faixa_de_limite": por_faixa,
        "base": estatisticas_da_base(base, configuracao_da_rodada, configuracoes_possiveis(base)),
    }
    with open(PASTA_MODELOS / f"desempenho_{FAMILIA}.json", "w", encoding="utf-8") as arquivo:
        json.dump(desempenho, arquivo, ensure_ascii=False, indent=2)

    print(f"Modelos e métricas gravados em {PASTA_MODELOS} ({time.time() - inicio:.0f} s).")
    print(f"  Teste isolado: MAE {teste_global['mae_c']:.2f} °C contra "
          f"{teste_global['mae_ref_c']:.2f} °C da média histórica do ponto.")


if __name__ == "__main__":
    main()
