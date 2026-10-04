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


@pytest.mark.parametrize("campo", ["pontos", "total_pontos", "configuracao", "tolerancia_fracao"])
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

def _variacoes(vocabulario, exemplo):
    """Uma configuração por nível de cada fator simples, como o formulário as permite."""
    for fator in vocabulario["factors"]:
        chave = fator["key"]

        if chave not in exemplo or fator.get("type") == "composite":
            continue

        for nivel in fator["levels"]:
            yield chave, nivel["value"], dict(exemplo, **{chave: nivel["value"]})


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
