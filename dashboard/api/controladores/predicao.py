"""Controlador da predição: chama o serviço e traduz cada falha num status HTTP com motivo.

Toda resposta de erro tem a mesma forma, `{"detail": {"erro", "mensagem", "campos"}}`: o código em
`erro` é estável para o painel decidir o que fazer, e `mensagem` sai pronta para exibir.
"""

import logging

from fastapi import HTTPException, status
from fastapi.responses import JSONResponse

from ..predicao.protocolo import CatalogoIndisponivel, ConfiguracaoInvalida, ModeloIndisponivel

registro_de_log = logging.getLogger(__name__)

# O detalhe de uma falha inesperada vai para o log, e não para o cliente.
MENSAGEM_FALHA_INTERNA = (
    "A inferência falhou por um erro interno do serviço. O detalhe ficou registrado no log da API."
)

# Tipos de erro do pydantic mais comuns numa configuração mal formada, em português.
MENSAGENS_DE_FORMATO = {
    "missing": "campo obrigatório ausente.",
    "extra_forbidden": "campo fora do contrato de entrada.",
    "string_type": "precisa ser texto.",
    "model_type": "precisa ser um objeto.",
    "model_attributes_type": "precisa ser um objeto.",
    "dict_type": "precisa ser um objeto.",
    "json_invalid": "o corpo da requisição não é um JSON válido.",
}


def _detalhe(erro, mensagem, campos=()):
    return {
        "erro": erro,
        "mensagem": mensagem,
        "campos": [{"campo": campo, "mensagem": texto} for campo, texto in campos],
    }


def executar_predicao(requisicao, servico):
    """Previsão da configuração recebida, ou `HTTPException` com o código do problema."""
    try:
        return servico.prever(requisicao.model_dump(exclude_none=True))
    except ConfiguracaoInvalida as erro:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            _detalhe("configuracao_invalida", str(erro), getattr(erro, "campos", ())),
        ) from erro
    except ModeloIndisponivel as erro:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, _detalhe("modelo_indisponivel", str(erro))
        ) from erro
    except CatalogoIndisponivel as erro:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, _detalhe("catalogo_indisponivel", str(erro))
        ) from erro
    except Exception as erro:
        registro_de_log.exception("Falha inesperada durante a inferência.")
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            _detalhe("falha_na_inferencia", MENSAGEM_FALHA_INTERNA),
        ) from erro


async def tratar_entrada_mal_formada(request, erro):
    """Erro de formato detectado pelo FastAPI, na mesma forma dos erros do serviço."""
    campos = []

    for item in erro.errors():
        caminho = ".".join(str(parte) for parte in item["loc"] if parte != "body")
        # Posição numérica no corpo só aparece quando ele nem chega a ser JSON.
        campo = "corpo" if not caminho or caminho.isdigit() else caminho
        campos.append((campo, MENSAGENS_DE_FORMATO.get(item["type"], item["msg"])))

    mensagem = "Configuração fora do contrato de entrada. " + " ".join(
        f"'{campo}': {texto}" for campo, texto in campos
    )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": _detalhe("configuracao_invalida", mensagem, campos)},
    )
