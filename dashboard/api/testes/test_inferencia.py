"""Função de inferência: mesmo pré-processamento do treino, modelo final e payload do painel.

A paridade com o treino é conferida contra o que os próprios notebooks de exportação imprimiram
para a configuração de exemplo, e o modelo servido, contra a decisão gravada pelos notebooks de
comparação da Seção 4.4. Os números são lidos dos notebooks na hora do teste, e não copiados para
cá: são temperaturas derivadas do dado do parceiro, que o repositório não replica.
"""

import ast
import json
import re

import pytest

from api.configuracao import catalogo_pontos_padrao
from api.predicao.catalogo_pontos import CatalogoPontos, PontoDeMedicao, carregar_catalogo_pontos
from api.predicao.inferencia import ORDEM_ESTADOS, classificar, inferir, prever_temperaturas
from api.predicao.protocolo import CatalogoIndisponivel, ConfiguracaoInvalida, ModeloIndisponivel
from api.predicao.registro import construir_registro

from .apoio import PASTA_MODELO_FINAL, RAIZ_REPOSITORIO, ler_stub_do_painel, montar_configuracao

PASTA_EXPORTACAO = RAIZ_REPOSITORIO / "notebooks" / "5_implantacao" / "familias_alternativas"
NOTEBOOK_DE_EXPORTACAO = {
    "random_forest": "1_exportacao_random_forest.ipynb",
    "gradient_boosting": "2_exportacao_gradient_boosting.ipynb",
}
PASTA_RESULTADOS = RAIZ_REPOSITORIO / "notebooks" / "4_avaliacao" / "4.1_comparacao_de_modelos" / "resultados"
CAMINHO_PONTOS_REAL = catalogo_pontos_padrao()

exige_catalogo_real = pytest.mark.skipif(
    not CAMINHO_PONTOS_REAL.is_file(),
    reason="dataset auditado do parceiro ausente nesta máquina (não é versionado)",
)

# Os pesos versionados do Gradient Boosting reproduzem todos os valores que o notebook de
# exportação imprimiu. Os do Random Forest de Mainback e IPC Cooling diferem deles em até 0,2 °C,
# o que é assunto dos pesos, não do pré-processamento: a codificação é a mesma nas duas famílias.
FAMILIA_DE_REFERENCIA = "gradient_boosting"

CONFIGURACAO = {
    "blower_direction": "To Back",
    "housing": "Open",
    "board_position": "Right",
    "run_case": "Broil C1",
    "deflector_hole": "Open",
    "material_coil_support": "Plastic",
    "losses": {"present": "declared", "config": "Config M", "order": "Back Order"},
}


def referencia_do_notebook(familia):
    """Configuração de exemplo e resultados impressos pelo notebook de exportação da família."""
    caderno = json.loads(
        (PASTA_EXPORTACAO / NOTEBOOK_DE_EXPORTACAO[familia]).read_text(encoding="utf-8")
    )
    celulas = [c for c in caderno["cells"] if c["cell_type"] == "code"]
    codigo = "\n".join("".join(c["source"]) for c in celulas)
    # `print` sai como texto; a tabela, última expressão da célula, sai como `text/plain`.
    impresso = "\n".join(
        "".join(saida.get("text") or saida.get("data", {}).get("text/plain") or [])
        for c in celulas
        for saida in c.get("outputs", [])
    )

    def extremo(rotulo):
        valor, termopar = re.search(rf"{rotulo} previsão: ([\d.]+) °C em (.+)", impresso).groups()
        return termopar.strip(), valor

    def total(rotulo):
        return int(re.search(rf"{rotulo}: (\d+)", impresso).group(1))

    # O repositório guarda os notebooks sem saídas (critérios de publicação e NDA): a referência só
    # existe depois de o notebook ser executado com a base real.
    if "Maior previsão:" not in impresso:
        pytest.skip("notebook de exportação salvo sem saídas; execute-o com a base real para comparar")

    estados = re.findall(
        r"^(acima_do_limite|banda_de_incerteza|dentro_do_limite)\s+(\d+)$", impresso, re.MULTILINE
    )

    return {
        "configuracao": ast.literal_eval(
            re.search(r"configuracao_exemplo = (\{.*?\n\})", codigo, re.DOTALL).group(1)
        ),
        "maior": extremo("Maior"),
        "menor": extremo("Menor"),
        "tabela": _tabela_impressa(impresso),
        "totais": (
            total("Termopares previstos"),
            total("Com estado de risco"),
            total("Em monitoramento"),
        ),
        "estados": {estado: int(n) for estado, n in estados},
    }


def _tabela_impressa(impresso):
    """Linhas visíveis da tabela da Seção 12.3 do notebook: {termopar: °C com duas casas}.

    O pandas quebra a tabela em dois blocos com o mesmo índice: o dos nomes e o dos números.
    """
    linhas = impresso.splitlines()
    inicio = next(i for i, linha in enumerate(linhas) if "Termopar Subsistema" in linha)
    nomes, valores, bloco_dos_numeros = {}, {}, False

    for linha in linhas[inicio + 1 :]:
        if re.match(r"\[\d+ rows x \d+ columns\]", linha):
            break

        if "Prevista (C)" in linha:
            bloco_dos_numeros = True
            continue

        partes = re.split(r"\s{2,}", linha.strip())

        if partes[0].isdigit():
            (valores if bloco_dos_numeros else nomes)[partes[0]] = partes[1]

    return {nomes[indice]: float(valores[indice]) for indice in nomes}


@pytest.fixture(scope="module")
def registro_final():
    """Registro como o serviço monta hoje: a família padrão do catálogo."""
    return construir_registro(montar_configuracao())


@pytest.fixture(scope="module")
def registros_por_familia():
    return {
        familia: construir_registro(montar_configuracao(familia))
        for familia in ("random_forest", "gradient_boosting")
    }


@pytest.fixture(scope="module")
def catalogo_sintetico(registro_final):
    """Limite fictício de 150 °C em todo ponto, e AC Blower Inlet sem limite, como na base."""
    pontos = {}

    for subsistema, preditor in registro_final.preditores.items():
        sem_limite = subsistema == "AC Blower Inlet"
        for termopar in preditor.metadados.termopares:
            pontos[termopar] = PontoDeMedicao(
                termopar=termopar,
                area=subsistema,
                measurement_id=f"{termopar} | {subsistema}",
                limite_c=None if sem_limite else 150.0,
                so_monitoramento=sem_limite,
            )

    return CatalogoPontos(pontos)


def test_inferencia_preve_todos_os_termopares_com_o_modelo_final(registro_final, catalogo_sintetico):
    payload = inferir(CONFIGURACAO, registro_final, catalogo_sintetico)
    esperados = sum(p.metadados.termopares_cobertos for p in registro_final.preditores.values())
    todos = payload["pontos"] + payload["monitoramento"]

    assert payload["total_pontos"] == len(todos) == esperados == 77
    assert payload["total_classificados"] == len(payload["pontos"])
    assert payload["total_monitoramento"] == len(payload["monitoramento"]) == 2
    assert all(isinstance(p["temperatura_prevista_c"], float) for p in todos)
    assert payload["preditor_e_stub"] is False
    assert payload["versao_modelo"] == "final-1.0"
    assert payload["configuracao"] == CONFIGURACAO
    assert {m["familia"] for m in payload["modelos"]} == {"modelo_final"}
    assert len(payload["modelos"]) == 7


def test_payload_tem_o_formato_que_o_painel_consome(registro_final, catalogo_sintetico):
    stub = ler_stub_do_painel()
    payload = inferir(CONFIGURACAO, registro_final, catalogo_sintetico)

    assert set(stub) <= set(payload)
    assert set(payload["pontos"][0]) == set(stub["pontos"][0])
    assert set(payload["monitoramento"][0]) == set(stub["monitoramento"][0])


def test_lista_principal_vem_ordenada_por_estado_e_folga(registro_final, catalogo_sintetico):
    pontos = inferir(CONFIGURACAO, registro_final, catalogo_sintetico)["pontos"]
    chaves = [(ORDEM_ESTADOS.index(p["estado"]), p["margem_c"]) for p in pontos]

    assert chaves == sorted(chaves)


def test_cada_subsistema_usa_o_modelo_final_decidido_na_secao_4_4(registro_final):
    decididos = {}

    # Os registros 01 a 06 são os seis datasets validados; o 07, de AC Blower Inlet, não tem decisão.
    for caminho in PASTA_RESULTADOS.glob("0[1-6]_*.json"):
        registro = json.loads(caminho.read_text(encoding="utf-8"))
        decididos[registro["area"]] = registro["final"]

    servidos = {nome: p.metadados.algoritmo for nome, p in registro_final.preditores.items()}

    assert len(decididos) == 6
    assert {nome: servidos[nome] for nome in decididos} == decididos
    assert (servidos["IPC Comp"], servidos["IPC Cooling"]) == ("SVR", "Extra Trees")
    # Seção 4.4(e): nenhum modelo validado para os pontos de entrada do soprador.
    assert registro_final.preditor("AC Blower Inlet").metadados.validado is False


def test_artefatos_do_modelo_final_reproduzem_o_erro_registrado_na_comparacao():
    metadados = [json.loads(c.read_text(encoding="utf-8")) for c in PASTA_MODELO_FINAL.glob("*.json")]

    assert len(metadados) == 7

    for meta in metadados:
        registrado, reproduzido = meta["reproducao"].values()
        assert reproduzido == pytest.approx(registrado, abs=0.005), meta["conjunto"]


def test_inferencia_reproduz_a_previsao_do_notebook_de_exportacao(registros_por_familia):
    referencia = referencia_do_notebook(FAMILIA_DE_REFERENCIA)
    temperaturas = prever_temperaturas(
        referencia["configuracao"], registros_por_familia[FAMILIA_DE_REFERENCIA]
    )
    duas_casas = {termopar: round(c, 2) for termopar, (_, c) in temperaturas.items()}
    maior = max(duas_casas, key=duas_casas.get)
    menor = min(duas_casas, key=duas_casas.get)

    assert len(referencia["tabela"]) == 10
    assert {t: duas_casas[t] for t in referencia["tabela"]} == referencia["tabela"]
    # Os extremos saem impressos com uma casa, a partir do valor já arredondado para duas.
    assert (maior, "%.1f" % duas_casas[maior]) == referencia["maior"]
    assert (menor, "%.1f" % duas_casas[menor]) == referencia["menor"]


@exige_catalogo_real
def test_estados_batem_com_o_notebook_de_exportacao(registros_por_familia):
    referencia = referencia_do_notebook(FAMILIA_DE_REFERENCIA)
    payload = inferir(
        referencia["configuracao"],
        registros_por_familia[FAMILIA_DE_REFERENCIA],
        carregar_catalogo_pontos(CAMINHO_PONTOS_REAL),
    )
    contagem = {}

    for ponto in payload["pontos"]:
        contagem[ponto["estado"]] = contagem.get(ponto["estado"], 0) + 1

    totais = (payload["total_pontos"], payload["total_classificados"], payload["total_monitoramento"])

    assert totais == referencia["totais"]
    assert contagem == referencia["estados"]


@pytest.mark.parametrize(
    "alteracao",
    [
        {"run_case": "Broil Inexistente"},
        {"housing": None},
        {"losses": {"present": "none"}},
        {"losses": {"present": "declared", "order": "Side Order"}},
    ],
)
def test_configuracao_fora_do_vocabulario_e_recusada(alteracao, registro_final, catalogo_sintetico):
    with pytest.raises(ConfiguracaoInvalida):
        inferir({**CONFIGURACAO, **alteracao}, registro_final, catalogo_sintetico)


def test_sem_modelo_carregado_a_inferencia_e_interrompida(catalogo_sem_familia, catalogo_sintetico):
    registro = construir_registro(montar_configuracao(caminho_catalogo=catalogo_sem_familia))

    with pytest.raises(ModeloIndisponivel, match="7 de 7"):
        inferir(CONFIGURACAO, registro, catalogo_sintetico)


def test_sem_catalogo_de_pontos_a_inferencia_e_interrompida(registro_final, tmp_path):
    for catalogo in (carregar_catalogo_pontos(None), carregar_catalogo_pontos(tmp_path / "x.csv")):
        assert not catalogo.disponivel
        assert ".csv" not in catalogo.motivo

        with pytest.raises(CatalogoIndisponivel):
            inferir(CONFIGURACAO, registro_final, catalogo)


def test_termopar_fora_do_catalogo_interrompe_a_inferencia(registro_final, catalogo_sintetico):
    incompleto = CatalogoPontos(dict(list(catalogo_sintetico.pontos.items())[1:]))

    with pytest.raises(CatalogoIndisponivel, match="sem registro"):
        inferir(CONFIGURACAO, registro_final, incompleto)


@pytest.mark.parametrize(
    ("temperatura", "limite", "estado"),
    [
        (110.0, 100.0, "acima_do_limite"),
        (100.0, 100.0, "banda_de_incerteza"),
        (95.0, 100.0, "banda_de_incerteza"),
        (90.0, 100.0, "dentro_do_limite"),
        (20.0, 100.0, "dentro_do_limite"),
    ],
)
def test_classificacao_segue_rn01(temperatura, limite, estado):
    assert classificar(temperatura, limite)[0] == estado
    assert classificar(temperatura, limite)[1] == pytest.approx(limite - temperatura)


def test_catalogo_de_pontos_le_um_registro_por_termopar(tmp_path):
    caminho = tmp_path / "catalogo.csv"
    caminho.write_text(
        "TC_Name,Key_Area,measurement_id,limit_c,is_monitor_only\n"
        "Ponto A,Area 1,Ponto A | Area 1,120.0,False\n"
        "Ponto A,Area 9,Ponto A | Area 9,999.0,False\n"
        "Ponto B,Area 2,Ponto B | Area 2,,True\n",
        encoding="utf-8",
    )
    catalogo = carregar_catalogo_pontos(caminho)

    assert catalogo.disponivel
    assert len(catalogo.pontos) == 2
    assert catalogo.ponto("Ponto A").limite_c == 120.0
    assert catalogo.ponto("Ponto A").area == "Area 1"
    assert catalogo.ponto("Ponto B").limite_c is None
    assert catalogo.ponto("Ponto B").so_monitoramento is True
