"""Serviço de predição: confere a configuração contra o contrato e executa o modelo preditivo.

A conferência usa o mesmo dicionário de features que /schema publica, então o que a API aceita é
exatamente o que ela anuncia (RN-04). As regras de combinação, como a do modo Pyro, ficam na
codificação do treino, que a inferência aplica logo em seguida.
"""

from ..predicao.inferencia import inferir
from ..predicao.protocolo import ConfiguracaoInvalida


class ConfiguracaoForaDoContrato(ConfiguracaoInvalida):
    """Configuração recusada na conferência, com cada campo e o motivo."""

    def __init__(self, campos):
        self.campos = campos
        super().__init__(" ".join(mensagem for _, mensagem in campos))


def _conferir(problemas, nome, valor, definicao, obrigatorio):
    aceitos = [nivel["valor"] for nivel in definicao["niveis"]]

    if valor in (None, ""):
        if obrigatorio:
            problemas.append((nome, f"Campo obrigatório ausente: '{nome}'. Aceitos: {aceitos}."))
        return

    if valor not in aceitos:
        problemas.append((nome, f"Nível fora do vocabulário em '{nome}': {valor!r}. Aceitos: {aceitos}."))


def problemas_da_configuracao(configuracao, esquema):
    """Campos fora do contrato publicado em /schema: [(campo, mensagem)], vazio se estiver certa."""
    problemas = []

    for fator in esquema["fatores"]:
        chave = fator["chave"]

        if fator["tipo"] != "composto":
            _conferir(problemas, chave, configuracao.get(chave), fator, fator["obrigatorio"])
            continue

        bloco = configuracao.get(chave) or {}

        for subcampo in fator.get("subcampos", []):
            nome = f"{chave}.{subcampo['chave']}"
            valor = bloco.get(subcampo["chave"])
            condicao = subcampo.get("depende_de")

            # Subcampo que não se aplica e veio preenchido seria ignorado em silêncio.
            if condicao and bloco.get(condicao["campo"]) != condicao["valor"]:
                if valor not in (None, ""):
                    problemas.append((
                        nome,
                        f"'{nome}' só se aplica com '{chave}.{condicao['campo']}' = "
                        f"{condicao['valor']!r}.",
                    ))
                continue

            _conferir(problemas, nome, valor, subcampo, subcampo["obrigatorio"])

    return problemas


class ServicoDePredicao:
    """Da configuração recebida à temperatura prevista de cada componente."""

    def __init__(self, registro, catalogo_pontos, esquema):
        self.registro = registro
        self.catalogo_pontos = catalogo_pontos
        self.esquema = esquema

    def prever(self, configuracao):
        """Payload da triagem; levanta os erros de `predicao.protocolo` com o motivo."""
        problemas = problemas_da_configuracao(configuracao, self.esquema)

        if problemas:
            raise ConfiguracaoForaDoContrato(problemas)

        return inferir(configuracao, self.registro, self.catalogo_pontos)
