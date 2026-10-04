"""Função de inferência: da configuração de ensaio à temperatura prevista de cada componente.

Porte de `prever_configuracao`, dos notebooks `5_implantacao/exportacao_*.ipynb`. Cada termopar é
previsto pelo modelo do seu subsistema a partir do mesmo vetor de configuração do treino
(`codificacao.montar_vetor_configuracao`) e recebe o estado de risco de RN-01 contra o limite do
catálogo de pontos. O resultado tem a forma de `dashboard/js/dados_triagem.js`, que as telas do
painel já consomem, para a troca do dado de demonstração pelo modelo não mexer nelas.
"""

from .protocolo import CatalogoIndisponivel, ModeloIndisponivel

# RN-01: abaixo de 10% do limite, o erro do modelo é da mesma ordem da folga que resta.
TOLERANCIA_FRACAO = 0.10

# Severidade que ordena a lista principal, como o painel espera receber: estado, depois folga.
ORDEM_ESTADOS = ("acima_do_limite", "banda_de_incerteza", "dentro_do_limite")

ROTULOS_ESTADO = {
    "acima_do_limite": "Acima do limite",
    "banda_de_incerteza": "Banda de incerteza",
    "dentro_do_limite": "Dentro do limite",
    "monitoramento": "Monitoramento",
}


def classificar(temperatura, limite, tolerancia_fracao=TOLERANCIA_FRACAO):
    """Regra RN-01: devolve o estado e a margem (limite menos temperatura), em °C."""
    margem = limite - temperatura

    if margem < 0:
        return "acima_do_limite", margem

    if margem < tolerancia_fracao * limite:
        return "banda_de_incerteza", margem

    return "dentro_do_limite", margem


def prever_temperaturas(configuracao, registro):
    """Temperatura prevista, em °C, de cada termopar coberto: {termopar: (subsistema, °C)}.

    Todos os subsistemas precisam de modelo carregado. Uma triagem parcial esconderia justamente
    os pontos que ninguém viu, então a falta de um modelo interrompe a previsão inteira.
    """
    if not registro.preditores:
        raise ModeloIndisponivel("Nenhum modelo exportado foi encontrado.")

    indisponiveis = {
        nome: preditor.motivo
        for nome, preditor in registro.preditores.items()
        if preditor.estado != "carregado"
    }

    if indisponiveis:
        nome, motivo = next(iter(indisponiveis.items()))
        raise ModeloIndisponivel(
            f"Sem modelo carregado para {len(indisponiveis)} de {len(registro.preditores)} "
            f"subsistemas ({', '.join(indisponiveis)}). {nome}: {motivo}"
        )

    temperaturas = {}

    for subsistema, preditor in registro.preditores.items():
        for termopar, temperatura in preditor.prever(configuracao).items():
            temperaturas[termopar] = (subsistema, temperatura)

    return temperaturas


def _ponto(termopar, temperatura, ponto_catalogo, tolerancia_fracao):
    registro = {
        "measurement_id": ponto_catalogo.measurement_id,
        "TC_Name": termopar,
        "Key_Area": ponto_catalogo.area,
        "temperatura_prevista_c": round(temperatura, 2),
        "limit_c": ponto_catalogo.limite_c,
        "is_monitor_only": ponto_catalogo.so_monitoramento,
    }

    if ponto_catalogo.limite_c is None:
        # RN-03: sem limite declarado, o ponto é acompanhado, e não aprovado nem reprovado.
        registro.update(
            margem_c=None,
            margem_percentual=None,
            estado="monitoramento",
            estado_rotulo=ROTULOS_ESTADO["monitoramento"],
        )
        return registro

    # O estado sai da temperatura sem arredondar, como no notebook; só a exibição arredonda.
    estado, margem = classificar(temperatura, ponto_catalogo.limite_c, tolerancia_fracao)
    registro.update(
        margem_c=round(margem, 2),
        margem_percentual=round(margem / ponto_catalogo.limite_c, 4),
        estado=estado,
        estado_rotulo=ROTULOS_ESTADO[estado],
    )
    return registro


def _modelos_usados(registro):
    return [
        {
            "subsistema": nome,
            "familia": preditor.metadados.familia,
            "algoritmo": preditor.metadados.algoritmo,
            "versao": preditor.metadados.versao,
            "validado": preditor.metadados.validado,
            "termopares": preditor.metadados.termopares_cobertos,
        }
        for nome, preditor in registro.preditores.items()
    ]


def _versao_modelo(modelos):
    versoes = sorted({modelo["versao"] or "?" for modelo in modelos})
    return versoes[0] if len(versoes) == 1 else ", ".join(versoes)


def inferir(configuracao, registro, catalogo_pontos, tolerancia_fracao=TOLERANCIA_FRACAO):
    """Prevê todos os componentes de uma configuração e devolve o payload da triagem.

    Levanta `ConfiguracaoInvalida` para entrada fora do vocabulário (RN-04),
    `ModeloIndisponivel` quando falta modelo e `CatalogoIndisponivel` quando falta o limite.
    """
    if not catalogo_pontos.disponivel:
        raise CatalogoIndisponivel(catalogo_pontos.motivo)

    temperaturas = prever_temperaturas(configuracao, registro)
    pontos, monitoramento = [], []

    for termopar, (_, temperatura) in temperaturas.items():
        ponto = _ponto(termopar, temperatura, catalogo_pontos.ponto(termopar), tolerancia_fracao)
        (monitoramento if ponto["estado"] == "monitoramento" else pontos).append(ponto)

    pontos.sort(key=lambda p: (ORDEM_ESTADOS.index(p["estado"]), p["margem_c"]))
    modelos = _modelos_usados(registro)

    return {
        "versao_modelo": _versao_modelo(modelos),
        "preditor_e_stub": False,
        "configuracao": configuracao,
        "tolerancia_fracao": tolerancia_fracao,
        "total_pontos": len(pontos) + len(monitoramento),
        "total_classificados": len(pontos),
        "total_monitoramento": len(monitoramento),
        "pontos": pontos,
        "monitoramento": monitoramento,
        "modelos": modelos,
    }
