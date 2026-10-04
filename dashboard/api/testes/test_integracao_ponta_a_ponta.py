"""A cadeia inteira: formulário do painel, endpoint de predição e tela de resultado.

Os testes de cada lado já cobrem o seu lado. Os da API montam o corpo da requisição à mão,
em Python; os do painel conferem o cliente contra um `fetch` falso. O que faltava era o
encontro dos dois, e é só ele que estes testes fazem: o corpo sai do JavaScript que o
formulário usa, entra na API de verdade, e a resposta volta para o validador que a tela
usa antes de exibir qualquer número.

Por que isso importa mais que parecer: a falha dessa junta é **silenciosa**. Se a API
deixar de mandar um campo, `respostaCompleta()` recusa a previsão, a tela volta aos valores
de demonstração e ninguém vê erro nenhum — o engenheiro leria número sintético achando que
é do modelo. Nenhum teste de um lado só pegaria isso.

Rodar:
    pytest dashboard/api/testes/test_integracao_ponta_a_ponta.py
"""

import pytest

from . import ponte_painel_js as painel
from .leitor_schema_js import ler_schema_js

pytestmark = painel.exige_node


@pytest.fixture(scope="module")
def exemplo(cliente_predicao):
    """A configuração que o próprio contrato publica, ponto de partida das variações."""
    return cliente_predicao.get("/schema").json()["exemplo_de_entrada"]


@pytest.fixture(scope="module")
def vocabulario(caminho_schema_js):
    """Fatores e níveis como o formulário os oferece ao usuário."""
    return ler_schema_js(caminho_schema_js)


# --------------------------------------------------------------- ida: painel → API

def test_corpo_montado_pelo_painel_e_aceito_pela_api(cliente_predicao, exemplo):
    """O JavaScript monta, a API aceita: é a junta que nenhum dos dois lados testava."""
    corpo = painel.montar_corpo(exemplo)

    assert corpo is not None, "o painel bloqueou um envio que deveria passar"

    resposta = cliente_predicao.post("/predicao", json=corpo)

    assert resposta.status_code == 200, resposta.text


def test_painel_nao_acrescenta_campo_que_a_api_recusa(cliente_predicao, exemplo):
    """A API recusa campo desconhecido; o painel não pode inventar nenhum pelo caminho."""
    entrada = dict(exemplo)
    entrada["measurement_point"] = "IPC P11 | IPC Comp"

    corpo = painel.montar_corpo(entrada)

    assert "measurement_point" not in corpo
    assert cliente_predicao.post("/predicao", json=corpo).status_code == 200


def test_subcampo_vazio_de_perdas_nao_viaja_e_a_api_aceita(cliente_predicao, exemplo):
    """Sem perda declarada não há arranjo nem ordem, e nulo explícito quebraria o contrato.

    O modo tem de ser Pyro: na base, "sem perda" e Pyro são a mesma condição, e a API
    recusa a combinação com qualquer outro modo (Seção 4.3b.7).
    """
    entrada = dict(exemplo, run_case="Pyro")
    entrada["losses"] = {"present": "none", "config": None, "order": ""}

    corpo = painel.montar_corpo(entrada)

    assert corpo["losses"] == {"present": "none"}
    assert cliente_predicao.post("/predicao", json=corpo).status_code == 200


def test_campo_obrigatorio_vazio_para_no_painel_sem_ir_a_api(exemplo):
    """Economia e clareza: o erro de preenchimento é do formulário, não do servidor."""
    for campo in ("blower_direction", "housing", "board_position", "run_case"):
        entrada = dict(exemplo)
        entrada[campo] = None

        assert painel.montar_corpo(entrada) is None, campo


# ------------------------------------------------------------- volta: API → painel

def test_resposta_da_api_passa_no_validador_do_painel(cliente_predicao, exemplo):
    """Se este teste cair, a tela volta ao stub em silêncio: é a falha mais cara da cadeia."""
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_predicao.post("/predicao", json=corpo).json()

    assert painel.resposta_completa(resposta) is True


def test_configuracao_devolvida_casa_com_a_que_o_painel_compara(cliente_predicao, exemplo):
    """A tela só exibe a previsão se ela for da configuração da URL; o eco tem de bater."""
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_predicao.post("/predicao", json=corpo).json()

    assert painel.mesma_configuracao(resposta["configuracao"], corpo) is True


def test_tela_exibe_a_previsao_e_nao_o_stub(cliente_predicao, exemplo):
    """O fluxo completo, do jeito que a tela o vive: query string, armazenamento e decisão."""
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_predicao.post("/predicao", json=corpo).json()
    stub = {"versao_modelo": "stub", "preditor_e_stub": True, "pontos": [], "monitoramento": []}

    escolha = painel.resolver(
        configuracao=corpo,
        resposta=resposta,
        busca=painel.para_query_string(corpo),
        stub=stub,
    )

    assert escolha["origem"] == "modelo"
    assert escolha["dados"]["preditor_e_stub"] is False
    assert escolha["dados"]["versao_modelo"] == resposta["versao_modelo"]


def test_configuracao_diferente_na_url_volta_ao_stub(cliente_predicao, exemplo):
    """Link antigo não pode mostrar a previsão de outra consulta sob a configuração atual."""
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_predicao.post("/predicao", json=corpo).json()
    outra = dict(corpo, housing="Open" if corpo["housing"] != "Open" else "Closed")

    escolha = painel.resolver(
        configuracao=corpo,
        resposta=resposta,
        busca=painel.para_query_string(outra),
        stub={"versao_modelo": "stub", "preditor_e_stub": True},
    )

    assert escolha["origem"] == "outra_configuracao"
    assert escolha["dados"]["preditor_e_stub"] is True


@pytest.mark.parametrize(
    "campo", ["pontos", "total_pontos", "configuracao", "tolerancia_fracao", "modelos"]
)
def test_resposta_sem_campo_do_contrato_e_recusada_pelo_painel(cliente_predicao, exemplo, campo):
    """Prende a direção da falha: resposta incompleta vira stub, não vira tela pela metade."""
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_predicao.post("/predicao", json=corpo).json()
    del resposta[campo]

    assert painel.resposta_completa(resposta) is False


# ------------------------------------------------------- consistência dos valores

def test_valores_exibidos_sao_os_que_o_modelo_devolveu(cliente_predicao, exemplo):
    """Critério de aceite do card: nada é convertido, arredondado ou reordenado no caminho."""
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_predicao.post("/predicao", json=corpo).json()

    escolha = painel.resolver(
        configuracao=corpo,
        resposta=resposta,
        busca=painel.para_query_string(corpo),
        stub={"versao_modelo": "stub", "preditor_e_stub": True},
    )

    assert escolha["dados"]["pontos"] == resposta["pontos"]
    assert escolha["dados"]["monitoramento"] == resposta["monitoramento"]
    assert escolha["dados"]["total_pontos"] == resposta["total_pontos"]


def test_duas_chamadas_iguais_devolvem_a_mesma_previsao(cliente_predicao, exemplo):
    """Sem isto, a mesma configuração mudaria de parecer entre duas consultas."""
    corpo = painel.montar_corpo(exemplo)

    primeira = cliente_predicao.post("/predicao", json=corpo).json()
    segunda = cliente_predicao.post("/predicao", json=corpo).json()

    assert primeira == segunda


def test_configuracoes_diferentes_devolvem_previsoes_diferentes(cliente_predicao, exemplo):
    """O contrário do teste acima: se o modo de ensaio não muda nada, o modelo não olha a entrada."""
    broil = painel.montar_corpo(dict(exemplo, run_case="Broil C2"))
    pyro = painel.montar_corpo(
        dict(exemplo, run_case="Pyro", losses={"present": "none"})
    )

    temperaturas_broil = [p["temperatura_prevista_c"] for p in
                          cliente_predicao.post("/predicao", json=broil).json()["pontos"]]
    temperaturas_pyro = [p["temperatura_prevista_c"] for p in
                         cliente_predicao.post("/predicao", json=pyro).json()["pontos"]]

    assert temperaturas_broil != temperaturas_pyro


# ----------------------------------------------- varredura do vocabulário do painel

def _coerente(configuracao):
    """Alinha `losses.present` ao modo de ensaio, como o formulário alinha na tela.

    `Pyro` e "sem perda declarada" são a mesma condição na base, nos dois sentidos, e
    `js/app.js` (`applyPyroEquivalence`) desabilita a opção que deixou de ser possível
    sempre que o modo muda. Variar um fator sem reaplicar esse acerto produziria uma
    configuração que a tela não deixa montar, e o 422 dela não diria nada sobre o nível
    em teste.
    """
    pyro = configuracao.get("run_case") == "Pyro"
    perdas = {"present": "none"} if pyro else {"present": "declared", "config": "Config S"}

    return dict(configuracao, losses=perdas)


def _variacoes(vocabulario, exemplo):
    """Uma configuração por nível de cada fator simples, como o formulário as permite."""
    for fator in vocabulario["factors"]:
        chave = fator["key"]

        if chave not in exemplo or fator.get("type") == "composite":
            continue

        for nivel in fator["levels"]:
            yield chave, nivel["value"], _coerente(dict(exemplo, **{chave: nivel["value"]}))


def test_todo_nivel_oferecido_pelo_formulario_produz_previsao_utilizavel(
    cliente_predicao, exemplo, vocabulario
):
    """Nenhuma opção que o usuário pode escolher na tela pode quebrar a previsão."""
    testados = 0

    for chave, valor, entrada in _variacoes(vocabulario, exemplo):
        corpo = painel.montar_corpo(entrada)

        assert corpo is not None, f"{chave}={valor} bloqueado no painel"

        resposta = cliente_predicao.post("/predicao", json=corpo)

        assert resposta.status_code == 200, f"{chave}={valor}: {resposta.text[:200]}"
        assert painel.resposta_completa(resposta.json()) is True, f"{chave}={valor}"

        testados += 1

    assert testados >= 10, f"a varredura cobriu só {testados} níveis; o schema encolheu?"


def test_nivel_fora_do_vocabulario_e_recusado_com_422(cliente_predicao, exemplo):
    """RN-04: o que o formulário não oferece, a API não aceita — nem por requisição direta."""
    corpo = painel.montar_corpo(dict(exemplo, housing="Alojamento Inexistente"))
    resposta = cliente_predicao.post("/predicao", json=corpo)

    assert resposta.status_code == 422
    assert resposta.json()["detail"]["mensagem"]


# ------------------------------- combinações que o formulário oferece e a base não tem

def test_sem_perda_fora_de_pyro_e_recusada_e_o_usuario_entende_por_que(cliente_predicao, exemplo):
    """Inconsistência conhecida entre o formulário e a base, com o comportamento fixado aqui.

    O formulário oferece "Sem perda" em qualquer modo de ensaio, mas na base as oito rodadas
    sem perda declarada são exatamente as oito de Pyro: as duas condições são a mesma coluna
    na codificação (Seção 4.3b.7). A API recusa a combinação, e é a recusa que vale.

    O que este teste prende é a qualidade da recusa. A mensagem exibida tem de ser a da API,
    que explica o caso, e não o texto genérico do cliente — foi assim que se descobriu que o
    painel lia o corpo de erro no campo errado e engolia a explicação.
    """
    corpo = painel.montar_corpo(dict(exemplo, run_case="Broil C2", losses={"present": "none"}))
    resposta = cliente_predicao.post("/predicao", json=corpo)

    assert resposta.status_code == 422

    visto = painel.classificar_erro(resposta.status_code, resposta.json())

    assert visto["ok"] is False
    assert visto["erro"]["tipo"] == "validacao"
    assert "Pyro" in visto["erro"]["mensagem"], "a explicação da API não chegou à tela"


def test_pyro_com_perda_declarada_e_recusada_do_outro_lado_da_equivalencia(
    cliente_predicao, exemplo
):
    """A recíproca da regra acima, que por um tempo passou calada.

    A equivalência vale nos dois sentidos: nas rodadas da base, as de `Pyro` são exatamente as
    rodadas sem perda declarada (Seção 4.2.2d). Recusar só "sem perda fora de Pyro" deixava passar
    `Pyro` com perda declarada — combinação que as colunas conseguem representar, mas que
    nenhuma rodada mediu. A previsão saía 200, extrapolando, sem nada na tela que avisasse.
    """
    for perdas in ({"present": "declared", "config": "Config S"}, {"present": "missing"}):
        corpo = painel.montar_corpo(dict(exemplo, run_case="Pyro", losses=perdas))
        resposta = cliente_predicao.post("/predicao", json=corpo)

        assert resposta.status_code == 422, f"Pyro com {perdas} deveria ser recusada"

        visto = painel.classificar_erro(resposta.status_code, resposta.json())

        assert visto["erro"]["tipo"] == "validacao"
        assert "Pyro" in visto["erro"]["mensagem"]


def test_pyro_sem_perda_declarada_segue_valendo(cliente_predicao, exemplo):
    """O lado da equivalência que existe na base não pode ter sido fechado por tabela."""
    corpo = painel.montar_corpo(dict(exemplo, run_case="Pyro", losses={"present": "none"}))
    resposta = cliente_predicao.post("/predicao", json=corpo)

    assert resposta.status_code == 200
    assert painel.resposta_completa(resposta.json()) is True


def test_mensagem_da_api_chega_a_tela_em_vez_do_texto_generico(cliente_predicao, exemplo):
    """Vale para qualquer 422: quem erra o preenchimento precisa saber o que corrigir."""
    corpo = painel.montar_corpo(dict(exemplo, housing="Alojamento Inexistente"))
    resposta = cliente_predicao.post("/predicao", json=corpo)

    visto = painel.classificar_erro(resposta.status_code, resposta.json())

    assert visto["erro"]["mensagem"] == resposta.json()["detail"]["mensagem"]
    assert "housing" in visto["erro"]["mensagem"]


def test_modelo_indisponivel_nao_para_a_consulta(cliente_sem_familia, exemplo):
    """503 é o caso de abrir o painel sem modelo: a tela segue com os valores de demonstração."""
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_sem_familia.post("/predicao", json=corpo)

    assert resposta.status_code == 503

    visto = painel.classificar_erro(resposta.status_code, resposta.json())

    assert visto["erro"]["tipo"] == "indisponivel"


# ------------------------------------------------- a mescla de modelos por área

# O modelo final não é um modelo: é um algoritmo escolhido por área e, em cinco
# delas, a média de dois. Estes testes cobrem o que isso exige da junta, que é uma
# coisa só: cada ponto precisa dizer qual modelo o previu, porque a área não diz.
# Se a tela casar ponto e modelo por `Key_Area`, erra em silêncio — e erra
# justamente nos dois pontos sem modelo validado.

def test_cada_ponto_diz_qual_modelo_o_previu(cliente_predicao, exemplo):
    """Sem isso a tela não tem como saber a procedência de número nenhum."""
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_predicao.post("/predicao", json=corpo).json()

    visto = painel.aferimento_dos_pontos(resposta)
    subsistemas = {m["subsistema"] for m in resposta["modelos"]}

    assert len(visto) == resposta["total_pontos"]
    assert all(p["subsistema_modelo"] in subsistemas for p in visto.values())

    # E o painel resolve o modelo de todos eles, não só de alguns.
    assert all(p["modelo"] == p["subsistema_modelo"] for p in visto.values())


def test_a_area_do_ponto_nao_identifica_o_modelo(cliente_predicao, exemplo):
    """O motivo de existir `subsistema_modelo`, preso em teste para não voltar.

    Duas assimetrias reais, e nenhuma é detalhe: uma área atendida por mais de um
    modelo, e um modelo que cobre mais de uma área.
    """
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_predicao.post("/predicao", json=corpo).json()

    visto = painel.aferimento_dos_pontos(resposta)

    modelos_por_area = {}
    areas_por_modelo = {}

    for ponto in visto.values():
        modelos_por_area.setdefault(ponto["area"], set()).add(ponto["subsistema_modelo"])
        areas_por_modelo.setdefault(ponto["subsistema_modelo"], set()).add(ponto["area"])

    divididas = {a for a, m in modelos_por_area.items() if len(m) > 1}
    espalhados = {m for m, a in areas_por_modelo.items() if len(a) > 1}

    assert divididas, "nenhuma área com dois modelos: a premissa do campo caiu, revise"
    assert espalhados, "nenhum modelo cobrindo duas áreas: a premissa do campo caiu, revise"

    # Em toda área dividida há ponto previsto por modelo de outro nome. É o que
    # torna o nome da área insuficiente: `Main Vent Sys` é ao mesmo tempo o nome de
    # uma área e o de um dos dois modelos que a atendem, e usar o nome como chave
    # atribuiria os pontos do outro ao modelo homônimo.
    for area in divididas:
        assert modelos_por_area[area] - {area}

    # E todo modelo espalhado cobre área que não tem o seu nome.
    for modelo in espalhados:
        assert areas_por_modelo[modelo] - {modelo}


def test_ponto_sem_modelo_validado_chega_marcado_a_tela(cliente_predicao, exemplo):
    """O caso que a marca existe para mostrar, com a armadilha ao lado.

    `AC Blower Inlet` não teve modelo validado, e os seus pontos ficam na área
    `Main Vent Sys`, cujo próprio modelo é validado. Casar por área daria os dois
    como aferidos — o erro que `subsistema_modelo` impede.
    """
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_predicao.post("/predicao", json=corpo).json()

    visto = painel.aferimento_dos_pontos(resposta)
    validado_por_modelo = {m["subsistema"]: m["validado"] for m in resposta["modelos"]}

    nao_aferidos = {nome for nome, p in visto.items() if not p["aferido"]}
    sem_validacao = {s for s, v in validado_por_modelo.items() if v is False}

    # A tela marca exatamente os pontos dos modelos sem validação, nem mais nem menos.
    esperados = {
        nome for nome, p in visto.items() if p["subsistema_modelo"] in sem_validacao
    }
    assert nao_aferidos == esperados

    if not sem_validacao:
        pytest.skip("todos os modelos exportados estão validados")

    # A armadilha: pela área, esses mesmos pontos passariam por validados.
    for nome in nao_aferidos:
        area = visto[nome]["area"]
        assert validado_por_modelo.get(area) is not False, (
            f"{nome}: a área {area} tem modelo validado, e o ponto não; "
            "casar por área esconderia isso"
        )


def test_resposta_sem_o_bloco_modelos_volta_ao_stub(cliente_predicao, exemplo):
    """O painel passou a depender da procedência: faltar é formato incompleto."""
    corpo = painel.montar_corpo(exemplo)
    resposta = cliente_predicao.post("/predicao", json=corpo).json()

    assert painel.resposta_completa(resposta) is True

    del resposta["modelos"]
    assert painel.resposta_completa(resposta) is False
