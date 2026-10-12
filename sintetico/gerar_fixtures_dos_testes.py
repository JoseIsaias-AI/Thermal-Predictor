"""Regenera as fixtures dos testes do painel a partir da API sobre a base sintética.

As fixtures têm o formato exato das respostas da API (`POST /predicao` e `GET /catalogo`), para
que os testes do painel exercitem as telas sem subir o serviço. Este script sobe a API em memória
com os modelos de `modelos/` e a base sintética da raiz, e grava:

- `dashboard/testes/fixtures/dados_triagem.js`: a triagem da configuração de referência;
- `dashboard/testes/fixtures/dados_comparacao.js`: o catálogo das configurações da base, em que a
  configuração de referência reproduz a triagem ponto a ponto.

Uso, na raiz do repositório, depois de gerar a base e treinar os modelos:

    python sintetico/gerar_fixtures_dos_testes.py
"""

import argparse
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "dashboard"))

from fastapi.testclient import TestClient  # noqa: E402

from api.configuracao import Configuracao  # noqa: E402
from api.main import criar_app  # noqa: E402

PASTA_FIXTURES = RAIZ / "dashboard" / "testes" / "fixtures"
VERSAO_FIXTURE = "fixture-teste"

CABECALHO_TRIAGEM = """/* Fixture de teste no formato da resposta de `POST /predicao`.
 *
 * Gerada por sintetico/gerar_fixtures_dos_testes.py: é a resposta da API para a
 * configuração de referência ({referencia} em fixtures/dados_comparacao.js), com os
 * modelos treinados na base sintética. Nenhum valor vem da base do parceiro. Não é
 * carregada por nenhuma tela: o painel só mostra a resposta da API. Serve aos testes
 * que precisam de uma resposta completa sem subir o serviço.
 *
 * {total} pontos: {classificados} em `pontos`, com o estado de risco de RN-01 aplicado e
 * ordenados do mais crítico para o menos; {monitoramento} em `monitoramento`, sem limite
 * declarado e por isso sem estado nem folga (RN-03).
 */

"""

CABECALHO_COMPARACAO = """/* Fixture de teste no formato da resposta de `GET /catalogo`.
 *
 * Gerada por sintetico/gerar_fixtures_dos_testes.py a partir da base sintética: as
 * {rodadas} rodadas formam {configuracoes} configurações distintas nos sete fatores. Nenhum
 * valor vem da base do parceiro. Não é carregada por nenhuma tela: serve aos testes
 * das leituras que recebem um catálogo.
 *
 * Identificadores são neutros (CFG-xx), como na API.
 *
 * {referencia} é a configuração de fixtures/dados_triagem.js e reproduz aquele
 * payload ponto a ponto: é por ela que se confere que a tela de comparação e a de
 * triagem contam a mesma coisa.
 *
 * Arranjo dos vetores: `t`, `m` e `e` são paralelos a `pontos`, na mesma ordem.
 * `m` e `e` valem null e o índice de monitoramento nos pontos sem limite (RN-03).
 */

"""


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--referencia", default="CFG-19",
                        help="identificador da configuração de referência (padrão CFG-19)")
    args = parser.parse_args()

    configuracao = Configuracao(
        pasta_modelos=RAIZ / "modelos",
        caminho_catalogo=RAIZ / "dashboard" / "api" / "catalogo_modelos.json",
        caminho_esquema=RAIZ / "dashboard" / "api" / "dominio" / "esquema_features.json",
        familia_padrao=None,
        caminho_catalogo_pontos=RAIZ / "dataset_completo_com_flags_de_auditoria.csv",
    )
    with TestClient(criar_app(configuracao)) as cliente:
        catalogo = cliente.get("/catalogo")
        catalogo.raise_for_status()
        catalogo = catalogo.json()
        por_id = {c["id"]: c for c in catalogo["configuracoes"]}
        if args.referencia not in por_id:
            sys.exit(f"{args.referencia} não existe no catálogo ({len(por_id)} configurações).")
        triagem = cliente.post("/predicao", json=por_id[args.referencia]["fatores"])
        triagem.raise_for_status()
        triagem = triagem.json()

    triagem["versao_modelo"] = VERSAO_FIXTURE
    catalogo["versao_modelo"] = VERSAO_FIXTURE
    comparacao = {"versao_modelo": catalogo.pop("versao_modelo"),
                  "preditor_e_stub": catalogo.pop("preditor_e_stub"),
                  "tolerancia_fracao": catalogo.pop("tolerancia_fracao"),
                  "config_referencia_triagem": args.referencia}
    comparacao.update(catalogo)

    texto = CABECALHO_TRIAGEM.format(
        referencia=args.referencia, total=triagem["total_pontos"],
        classificados=triagem["total_classificados"], monitoramento=triagem["total_monitoramento"])
    texto += "var DADOS_TRIAGEM = " + json.dumps(triagem, ensure_ascii=False, indent=2) + ";\n"
    (PASTA_FIXTURES / "dados_triagem.js").write_text(texto, encoding="utf-8")

    texto = CABECALHO_COMPARACAO.format(
        rodadas=comparacao["total_rodadas"], configuracoes=comparacao["total_configuracoes"],
        referencia=args.referencia)
    texto += "var DADOS_COMPARACAO = " + json.dumps(comparacao, ensure_ascii=False, indent=2)
    texto += (";\n\n/* Os módulos leem o catálogo do modelo em `CATALOGO_MODELO`; nos testes, é\n"
              "   esta fixture que faz esse papel. */\nvar CATALOGO_MODELO = DADOS_COMPARACAO;\n")
    (PASTA_FIXTURES / "dados_comparacao.js").write_text(texto, encoding="utf-8")

    estados = {}
    for ponto in triagem["pontos"]:
        estados[ponto["estado"]] = estados.get(ponto["estado"], 0) + 1
    print(f"Fixtures gravadas em {PASTA_FIXTURES}")
    print(f"  Referência {args.referencia}: {estados}, "
          f"{triagem['total_monitoramento']} em monitoramento.")
    print(f"  Catálogo: {comparacao['total_rodadas']} rodadas, "
          f"{comparacao['total_configuracoes']} configurações.")


if __name__ == "__main__":
    main()
