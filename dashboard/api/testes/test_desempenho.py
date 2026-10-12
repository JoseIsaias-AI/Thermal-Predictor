"""GET /desempenho: métricas agregadas do modelo final.

O arquivo servido é gravado por `sintetico/treinar_modelos.py`. Os testes não fixam valores, que
dependem da base sintética: conferem a coerência interna das métricas (contagens, percentuais,
intervalos e somas por faixa), das estatísticas da base no campo `base` e que o arquivo só tenha
agregados.
"""

import json

import pytest

from api.configuracao import MODELO_DESEMPENHO

from .apoio import RAIZ_REPOSITORIO

CAMINHO = RAIZ_REPOSITORIO / "modelos" / MODELO_DESEMPENHO.format(familia="modelo_final")

# Nenhum campo que identifique ponto, medição, limite de componente ou rodada.
CAMPOS_PROIBIDOS = {
    "TC_Name", "measurement_id", "Run_ID", "Run_Reason", "limit_c", "limite_c", "temperatura",
    "temperatura_prevista_c", "Value", "Value_final", "tolerancia_media_c", "termopar",
}


def _chaves(objeto):
    if isinstance(objeto, dict):
        for chave, valor in objeto.items():
            yield chave
            yield from _chaves(valor)
    elif isinstance(objeto, list):
        for item in objeto:
            yield from _chaves(item)


@pytest.fixture(scope="module")
def corpo(cliente):
    resposta = cliente.get("/desempenho")
    assert resposta.status_code == 200
    return resposta.json()


def test_global_e_coerente(corpo):
    g = corpo["global"]

    assert corpo["versao_modelo"]
    assert g["mae_teste_c"] > 0 and g["rmse_teste_c"] >= g["mae_teste_c"]
    assert 0 <= g["pontos_aprovados"] <= g["pontos_com_limite"]
    assert g["aprovacao_teste_pct"] == pytest.approx(
        100 * g["pontos_aprovados"] / g["pontos_com_limite"], abs=0.01)
    assert 0 <= g["aprovacao_mediana_40_divisoes_pct"] <= 100
    if g["sensibilidade_pct"] is not None:
        assert 0 <= g["sensibilidade_pct"] <= 100
    assert g["falsos_negativos"] <= g["excedencias_teste"]


def test_referencia_e_wilcoxon(corpo):
    g = corpo["global"]

    assert g["referencia"]["mae_teste_c"] > 0
    assert g["wilcoxon"]["pares"] == g["divisoes"]
    assert 0 <= g["wilcoxon"]["p"] <= 1
    assert 0 <= g["wilcoxon"]["divisoes_em_que_o_modelo_erra_menos"] <= g["divisoes"]
    baixo, alto = g["aprovacao_teste_wilson_pct"]
    assert baixo <= g["aprovacao_teste_pct"] <= alto


def test_por_dataset(corpo):
    por_nome = {d["dataset"]: d for d in corpo["por_dataset"]}

    for dataset in ("Mainback", "Coil Temps", "Main Vent Sys", "IPC Cooling", "IPC Comp",
                    "HMI / Knobs / Console"):
        assert por_nome[dataset]["validado"] is True, dataset
        assert por_nome[dataset]["mae_teste_c"] > 0, dataset
        assert 0 <= por_nome[dataset]["aprovacao_mediana_40_divisoes_pct"] <= 100, dataset

    inlet = por_nome["AC Blower Inlet"]
    assert inlet["validado"] is False and inlet["modelo_final"] is None and inlet["mae_teste_c"] is None


def test_por_faixa_de_limite_soma_o_global(corpo):
    faixas = corpo["por_faixa_de_limite"]
    g = corpo["global"]

    assert sum(f["pontos"] for f in faixas) == g["pontos_com_limite"]
    assert sum(f["aprovados"] for f in faixas) == g["pontos_aprovados"]


def test_procedencia_e_validacao_fecham_as_contas(corpo):
    procedencia = corpo["base"]["procedencia"]
    validacao = corpo["base"]["validacao"]

    assert procedencia["combinacoes"] == procedencia["pontos"] * procedencia["rodadas"]
    assert procedencia["sem_leitura"] + procedencia["observacoes"] == procedencia["combinacoes"]
    assert procedencia["estruturais"] + procedencia["aleatorias"] == procedencia["sem_leitura"]
    assert sum(c["ocorrencias"] for c in procedencia["por_classe"]) == procedencia["sem_leitura"]

    distribuicao = validacao["distribuicao"]
    assert validacao["rodadas"] == procedencia["rodadas"] == sum(d["rodadas"] for d in distribuicao)
    assert validacao["configuracoes"] == sum(d["configuracoes"] for d in distribuicao)
    assert validacao["configuracoes"] <= validacao["configuracoes_possiveis"]
    assert validacao["rodadas_em_configuracao_compartilhada"] == sum(
        d["rodadas"] for d in distribuicao if d["rodadas_por_configuracao"] > 1)


def test_referencia_da_base(corpo):
    referencia = corpo["base"]["referencia"]

    assert referencia["cobertura_pct"] == pytest.approx(
        100 * referencia["pontos_cobertos"] / referencia["pontos_com_limite"], abs=0.01)
    baixo, alto = referencia["cobertura_wilson_pct"]
    assert baixo <= referencia["cobertura_pct"] <= alto
    # Deixar a rodada de fora multiplica o erro de cada leitura por n/(n-1): nunca diminui.
    assert referencia["mae_c"] >= referencia["mae_na_amostra_c"] > 0


def test_hipoteses_e_escalonamento(corpo):
    hipoteses = corpo["base"]["hipoteses"]
    hd1, hd2, hd3 = hipoteses["hd1"], hipoteses["hd2"], hipoteses["hd3"]

    assert hd1["pontos_com_violacao"] <= hd1["pontos"]
    assert hd1["violacoes_dos_pontos_de_maior_risco"] <= hd1["violacoes"] <= hd1["leituras"]
    assert hd1["celulas"] == 2 * hd1["pontos"]
    if hd1["gl"] is not None:
        assert hd1["gl"] == hd1["pontos"] - 1
    assert 0 < hd2["rodadas_no_modo"] < hd2["rodadas"]
    for chave in ("proporcao_p_permutacao", "proporcao_p_mann_whitney", "margem_p_permutacao",
                  "margem_p_mann_whitney", "leituras_p"):
        assert 0 <= hd2[chave] <= 1, chave
    assert hd2["pontos_que_esquentam_no_modo"] + hd2["pontos_que_esfriam_no_modo"] <= hd1["pontos"]
    assert -1 <= hd3["r"] <= 1 and -1 <= hd3["rho"] <= 1
    assert 0 < hd3["limite_min_c"] <= hd3["limite_max_c"]
    assert [v["variavel"] for v in hipoteses["hn"]] == ["Value", "limit_c", "margem_termica"]
    assert all(0 < v["w"] <= 1 for v in hipoteses["hn"])
    assert all(v["desvio_c"] > 0 for v in corpo["base"]["escalonamento"])


def test_arquivo_so_tem_agregados():
    with CAMINHO.open(encoding="utf-8") as arquivo:
        dados = json.load(arquivo)

    assert not (set(_chaves(dados)) & CAMPOS_PROIBIDOS)
    # Pequeno de propósito: agregados cabem em poucos KB, medições não.
    assert CAMINHO.stat().st_size < 16_000
