"""Catálogo das configurações históricas com a previsão do modelo para cada uma.

Cada configuração passa pela mesma inferência de `POST /predicao`, então a comparação mostra
exatamente o que a triagem mostraria para ela. A resposta é montada uma vez e guardada: as
configurações e o modelo não mudam enquanto o serviço está no ar.
"""

from ..predicao.codificacao import SINONIMOS
from ..predicao.protocolo import CatalogoIndisponivel

ESTADOS = (
    ("acima_do_limite", "Acima do limite"),
    ("banda_de_incerteza", "Banda de incerteza"),
    ("dentro_do_limite", "Dentro do limite"),
    ("monitoramento", "Monitoramento"),
)
INDICE_ESTADO = {codigo: i for i, (codigo, _) in enumerate(ESTADOS)}


def _contagem_codificada(configuracoes):
    """Configurações distintas nas colunas que o modelo recebe, onde os sinônimos colapsam."""
    vistas = set()
    for c in configuracoes:
        f = dict(c.fatores, housing=SINONIMOS.get(c.fatores["housing"], c.fatores["housing"]))
        vistas.add((f["run_case"], f["blower_direction"], f["housing"], f["board_position"],
                    f["deflector_hole"], f["material_coil_support"], tuple(sorted(f["losses"].items()))))
    return len(vistas)


def _contagem_seis_fatores(configuracoes):
    return len({tuple(c.fatores[k] for k in ("run_case", "blower_direction", "housing",
                                               "board_position", "deflector_hole",
                                               "material_coil_support")) for c in configuracoes})


def montar_catalogo(servico, catalogo_configuracoes):
    """Resposta de `GET /catalogo`; levanta os erros de `predicao.protocolo` com o motivo."""
    if not catalogo_configuracoes.disponivel:
        raise CatalogoIndisponivel(catalogo_configuracoes.motivo)

    previsoes = [(c, servico.prever(c.fatores)) for c in catalogo_configuracoes.configuracoes]

    if not previsoes:
        raise CatalogoIndisponivel("O dataset não tem nenhuma rodada.")

    # Ordem canônica dos pontos: área, depois nome. Vale para todas as configurações.
    primeira = previsoes[0][1]
    pontos = sorted(primeira["pontos"] + primeira["monitoramento"],
                    key=lambda p: (p["Key_Area"], p["TC_Name"]))
    ids = [p["measurement_id"] for p in pontos]

    configuracoes = []
    for configuracao, previsao in previsoes:
        por_id = {p["measurement_id"]: p for p in previsao["pontos"] + previsao["monitoramento"]}
        estados = [INDICE_ESTADO[por_id[i]["estado"]] for i in ids]
        classificados = [e for e in estados if e != INDICE_ESTADO["monitoramento"]]
        configuracoes.append({
            "id": configuracao.identificador,
            "rodadas": configuracao.rodadas,
            "fatores": configuracao.fatores,
            "severidade": ESTADOS[min(classificados)][0] if classificados else "monitoramento",
            "resumo": [classificados.count(k) for k in range(3)],
            "t": [por_id[i]["temperatura_prevista_c"] for i in ids],
            "m": [por_id[i]["margem_c"] for i in ids],
            "e": estados,
        })

    return {
        "versao_modelo": primeira["versao_modelo"],
        "preditor_e_stub": False,
        "tolerancia_fracao": primeira["tolerancia_fracao"],
        "total_rodadas": catalogo_configuracoes.total_rodadas,
        "total_configuracoes": len(configuracoes),
        "total_configuracoes_codificadas": _contagem_codificada(catalogo_configuracoes.configuracoes),
        "total_configuracoes_seis_fatores": _contagem_seis_fatores(catalogo_configuracoes.configuracoes),
        "estados": [list(e) for e in ESTADOS],
        "pontos": [
            {
                "id": p["measurement_id"],
                "nome": p["TC_Name"],
                "area": p["Key_Area"],
                "subsistema_modelo": p["subsistema_modelo"],
                "limite": p["limit_c"],
                "mono": p["is_monitor_only"],
            }
            for p in pontos
        ],
        "configuracoes": configuracoes,
    }
