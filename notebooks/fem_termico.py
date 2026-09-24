"""Simulação térmica por elementos finitos e sua integração à tabela de modelagem.

O módulo implementa o fluxo projetado em `documents/extras/projeto-integracao-fem.md`: resolve a
condução de calor em regime permanente por elementos finitos, gera um lote de temperaturas para
configurações experimentais e grava o resultado no contrato de dados definido lá, que
`modelagem_comum.carregar_base` sabe ler.

**Ressalva que acompanha todo resultado deste módulo.** A geometria, as potências dissipadas e os
coeficientes de convecção **não** vêm da base do projeto, que não os contém, conforme a auditoria de
`documents/extras/relatorio_fem.md`. Eles são um **modelo substituto declarado**, com valores
arbitrados em `PARAMETROS_PADRAO`, cuja função é exercitar a canalização inteira enquanto a
engenharia do parceiro não fornece o modelo real do produto. O resolvedor, o contrato de dados, a
validação, a calibração e a integração são definitivos; a física representada não é. Por isso a
coluna `versao_modelo` carrega o prefixo `substituto`, e nenhuma decisão de modelagem deve ser tomada
sobre estes números antes da troca pelo modelo real.
"""
import copy
import os

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve

VERSAO_MODELO = "substituto-0.1"
ORIGEM_SIMULACAO = "simulacao"
ORIGEM_MEDICAO = "medicao"

COLUNAS_CONTRATO = [
    "simulacao_id", "TC_Name", "Key_Area", "Value", "origem", "peso", "h_aplicado", "potencia_w",
    "malha_elementos", "residuo_convergencia", "versao_modelo",
]

PARAMETROS_PADRAO = {
    "malha": {"elementos_x": 40, "elementos_y": 30},
    # Placa equivalente de cada área, em metros, e condutividade em W/(m·K). Valores arbitrados.
    "areas": {
        "Mainback": {"largura": 0.45, "altura": 0.30, "espessura": 0.0012, "condutividade": 50.0},
        "Coil Temps": {"largura": 0.25, "altura": 0.25, "espessura": 0.0030, "condutividade": 205.0},
        "Main Vent Sys": {"largura": 0.30, "altura": 0.20, "espessura": 0.0010,
                          "condutividade": 45.0},
        "IPC Cooling": {"largura": 0.20, "altura": 0.15, "espessura": 0.0015,
                        "condutividade": 120.0},
        "IPC Comp": {"largura": 0.25, "altura": 0.18, "espessura": 0.0016, "condutividade": 90.0},
        "HMI / Knobs / Console": {"largura": 0.35, "altura": 0.12, "espessura": 0.0020,
                                  "condutividade": 15.0},
    },
    # Potência dissipada, em watts, por área e por modo de ensaio. Valores arbitrados.
    "potencia_por_modo": {
        "Broil Qualitative": 22.0, "Broil C1": 26.0, "Broil C2": 30.0, "Pyro": 48.0,
    },
    "fracao_por_area": {
        "Mainback": 0.8, "Coil Temps": 1.4, "Main Vent Sys": 0.6, "IPC Cooling": 0.5,
        "IPC Comp": 1.0, "HMI / Knobs / Console": 0.4,
    },
    # Efeito das perdas declaradas sobre a potência, multiplicativo. Valores arbitrados.
    "fator_de_perdas": {
        "losses_present_missing": 1.00, "losses_config_m": 1.15,
        "losses_order_back_order": 1.05, "losses_order_front_order": 0.95,
    },
    # Convecção: base, multiplicadores e acréscimos por fator de projeto. Valores arbitrados.
    "conveccao": {
        "base": 15.0, "blower_para_tras": 1.30, "alojamento_aberto": 1.20,
        "defletor_aberto_acrescimo": 8.0, "minimo": 3.0,
    },
    # Efeito do escoamento, desligado por padrão. Com valores positivos, o ar desloca o ponto quente
    # para jusante e chega aquecido aos pontos mais distantes da entrada, conforme a direção do
    # soprador. É o mecanismo descrito na Seção 4.3(b.5) da documentação, arbitrado aqui.
    "escoamento": {"deslocamento_da_fonte": 0.0, "aquecimento_do_ar": 0.0},
    "temperatura_ambiente": 40.0,
    "peso_simulacao": 0.25,
    "tolerancia_residuo": 1e-6,
}

_COLUNA_MODO = {
    "Run_Case_Broil C1": "Broil C1", "Run_Case_Broil C2": "Broil C2", "Run_Case_Pyro": "Pyro",
}


class ErroDeContrato(ValueError):
    """Arquivo ou tabela de simulação fora do contrato de `projeto-integracao-fem.md`."""


class ErroDeSimulacao(RuntimeError):
    """Falha na montagem ou na solução do sistema de elementos finitos."""


# ------------------------------------------------------------------------------------------------
# Elementos finitos
# ------------------------------------------------------------------------------------------------

def malha_retangular(largura, altura, elementos_x, elementos_y):
    """Nós em grade e dois triângulos por célula, como no estudo do notebook 21."""
    if min(elementos_x, elementos_y) < 1:
        raise ErroDeSimulacao("malha: são necessários ao menos um elemento em cada direção.")

    x = np.linspace(0, largura, elementos_x + 1)
    y = np.linspace(0, altura, elementos_y + 1)
    grade_x, grade_y = np.meshgrid(x, y, indexing="ij")
    nos = np.column_stack([grade_x.ravel(), grade_y.ravel()])
    indice = lambda i, j: i * (elementos_y + 1) + j
    inferiores = [[indice(i, j), indice(i + 1, j), indice(i + 1, j + 1)]
                  for i in range(elementos_x) for j in range(elementos_y)]
    superiores = [[indice(i, j), indice(i + 1, j + 1), indice(i, j + 1)]
                  for i in range(elementos_x) for j in range(elementos_y)]

    return nos, np.array(inferiores + superiores)


def montar_matrizes(nos, elementos, condutividade):
    """Matriz de condução e matriz de massa, montadas de uma vez sobre todos os elementos."""
    coordenadas = nos[elementos]
    x, y = coordenadas[:, :, 0], coordenadas[:, :, 1]
    area = 0.5 * np.abs((x[:, 1] - x[:, 0]) * (y[:, 2] - y[:, 0])
                        - (x[:, 2] - x[:, 0]) * (y[:, 1] - y[:, 0]))

    if np.any(area <= 0):
        raise ErroDeSimulacao("malha: há elementos de área nula, a geometria está degenerada.")

    coef_b = np.stack([y[:, 1] - y[:, 2], y[:, 2] - y[:, 0], y[:, 0] - y[:, 1]], axis=1)
    coef_c = np.stack([x[:, 2] - x[:, 1], x[:, 0] - x[:, 2], x[:, 1] - x[:, 0]], axis=1)
    locais_k = condutividade * (coef_b[:, :, None] * coef_b[:, None, :]
                                + coef_c[:, :, None] * coef_c[:, None, :]) / (4 * area[:, None, None])
    locais_m = area[:, None, None] / 12 * (np.ones((3, 3)) + np.eye(3))
    linhas = np.repeat(elementos, 3, axis=1).ravel()
    colunas = np.tile(elementos, 3).ravel()
    forma = (len(nos), len(nos))
    K = coo_matrix((locais_k.reshape(-1), (linhas, colunas)), shape=forma).tocsr()
    M = coo_matrix((locais_m.reshape(-1), (linhas, colunas)), shape=forma).tocsr()

    return K, M, area


class ModeloDeArea:
    """Placa equivalente de uma área, com malha, matrizes e posição de cada ponto de medição.

    A geometria é montada uma única vez; cada configuração muda apenas a potência dissipada e o
    coeficiente de convecção, o que reduz a simulação de um lote a uma solução linear por caso.
    """

    def __init__(self, nome, pontos, parametros=None):
        parametros = parametros or PARAMETROS_PADRAO

        if nome not in parametros["areas"]:
            raise ErroDeContrato(f"área desconhecida: {nome}. Declare-a em `parametros['areas']`.")

        if len(pontos) == 0:
            raise ErroDeContrato(f"área {nome}: nenhum ponto de medição informado.")

        self.nome = nome
        self.parametros = parametros
        self.geometria = parametros["areas"][nome]
        self.pontos = list(pontos)
        geometria = parametros["areas"][nome]
        malha = parametros["malha"]
        self.nos, self.elementos = malha_retangular(
            geometria["largura"], geometria["altura"], malha["elementos_x"], malha["elementos_y"])
        self.K, self.M, _ = montar_matrizes(
            self.nos, self.elementos, geometria["condutividade"] * geometria["espessura"])
        self.unitario = np.ones(len(self.nos))
        self.integral = self.M @ self.unitario
        self.carga_unitaria = self._carga_da_fonte(geometria)
        self._cargas = {0.0: self.carga_unitaria}
        self.posicao_do_ponto = self._posicionar_pontos(geometria)
        self.interpolacao_do_ponto = {ponto: self._pesos_de_interpolacao(posicao)
                                      for ponto, posicao in self.posicao_do_ponto.items()}

    def _carga_da_fonte(self, geometria, deslocamento=0.0):
        # Fonte concentrada no centro da placa, com perfil gaussiano de desvio igual a 5% do menor
        # lado. O perfil é uma função suave, e não uma região recortada da malha, para que o refino
        # não mude a fonte: é o que faz a solução convergir. O vetor devolvido integra 1 W, e a
        # potência de cada configuração o multiplica.
        desvio = 0.05 * min(geometria["largura"], geometria["altura"])
        centro_x = geometria["largura"] * (0.5 + deslocamento)
        distancia2 = ((self.nos[:, 0] - centro_x) ** 2
                      + (self.nos[:, 1] - geometria["altura"] / 2) ** 2)
        perfil = np.exp(-distancia2 / (2 * desvio ** 2))
        carga = self.M @ perfil
        total = float(carga.sum())

        if total <= 0:
            raise ErroDeSimulacao(f"área {self.nome}: a malha não cobre a região da fonte; "
                                  f"aumente `elementos_x` e `elementos_y`.")

        return carga / total

    def _posicionar_pontos(self, geometria):
        # Os pontos são distribuídos em grade dentro da placa, em ordem alfabética, porque a base
        # não traz a posição real de nenhum termopar. É a hipótese mais visível do substituto.
        quantidade = len(self.pontos)
        colunas = int(np.ceil(np.sqrt(quantidade)))
        linhas = int(np.ceil(quantidade / colunas))
        posicoes = {}

        for ordem, ponto in enumerate(self.pontos):
            coluna, linha = ordem % colunas, ordem // colunas
            posicoes[ponto] = np.array([geometria["largura"] * (coluna + 0.5) / colunas,
                                        geometria["altura"] * (linha + 0.5) / linhas])

        return posicoes

    def _pesos_de_interpolacao(self, posicao):
        # Coordenadas baricêntricas no triângulo que contém o ponto. A leitura por interpolação, e
        # não pelo nó mais próximo, faz a temperatura do ponto não depender do refino da malha.
        coordenadas = self.nos[self.elementos]
        x1, y1 = coordenadas[:, 0, 0], coordenadas[:, 0, 1]
        x2, y2 = coordenadas[:, 1, 0], coordenadas[:, 1, 1]
        x3, y3 = coordenadas[:, 2, 0], coordenadas[:, 2, 1]
        determinante = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
        peso_1 = ((y2 - y3) * (posicao[0] - x3) + (x3 - x2) * (posicao[1] - y3)) / determinante
        peso_2 = ((y3 - y1) * (posicao[0] - x3) + (x1 - x3) * (posicao[1] - y3)) / determinante
        peso_3 = 1 - peso_1 - peso_2
        dentro = (peso_1 >= -1e-9) & (peso_2 >= -1e-9) & (peso_3 >= -1e-9)

        if not dentro.any():
            raise ErroDeSimulacao(f"área {self.nome}: o ponto em {posicao} caiu fora da malha.")

        elemento = int(np.argmax(dentro))

        return (self.elementos[elemento],
                np.array([peso_1[elemento], peso_2[elemento], peso_3[elemento]]))

    def temperatura_no_ponto(self, campo, ponto):
        """Temperatura interpolada na posição do ponto de medição."""
        nos, pesos = self.interpolacao_do_ponto[ponto]

        return float(campo[nos] @ pesos)

    def resolver(self, potencia, coeficiente_conveccao, temperatura_ambiente, sentido=0):
        """Campo de temperatura e resíduo relativo da solução.

        `sentido` é o sentido do escoamento ao longo da largura da placa: +1 com o soprador para
        trás, -1 para a frente e 0 sem efeito de escoamento. Só tem efeito quando os parâmetros de
        `escoamento` são positivos; com os padrões, o resultado independe dele.
        """
        if potencia < 0 or coeficiente_conveccao <= 0:
            raise ErroDeSimulacao(f"área {self.nome}: potência de {potencia} W e coeficiente de "
                                  f"{coeficiente_conveccao} exigem potência não negativa e "
                                  f"coeficiente positivo.")

        if sentido not in (-1, 0, 1):
            raise ErroDeSimulacao(f"área {self.nome}: sentido de escoamento {sentido} inválido; "
                                  f"use -1, 0 ou 1.")

        escoamento = self.parametros.get("escoamento", PARAMETROS_PADRAO["escoamento"])
        deslocamento = round(escoamento["deslocamento_da_fonte"] * sentido, 6)

        if deslocamento not in self._cargas:
            self._cargas[deslocamento] = self._carga_da_fonte(self.geometria, deslocamento)

        ar = np.full(len(self.nos), float(temperatura_ambiente))

        if escoamento["aquecimento_do_ar"] and sentido:
            fracao_a_jusante = self.nos[:, 0] / self.geometria["largura"]
            fracao_a_jusante = fracao_a_jusante if sentido > 0 else 1 - fracao_a_jusante
            ar = ar + escoamento["aquecimento_do_ar"] * fracao_a_jusante

        A = (self.K + 2 * coeficiente_conveccao * self.M).tocsr()
        b = self._cargas[deslocamento] * potencia + 2 * coeficiente_conveccao * (self.M @ ar)
        campo = spsolve(A, b)

        if not np.all(np.isfinite(campo)):
            raise ErroDeSimulacao(f"área {self.nome}: a solução divergiu; revise malha e parâmetros.")

        residuo = float(np.abs(A @ campo - b).max() / max(np.abs(b).max(), 1e-30))

        return campo, residuo


# ------------------------------------------------------------------------------------------------
# Da configuração experimental às condições físicas
# ------------------------------------------------------------------------------------------------

def modo_da_configuracao(configuracao):
    """Modo de ensaio de uma linha de configuração, com `Broil Qualitative` como referência."""
    for coluna, modo in _COLUNA_MODO.items():
        if float(configuracao.get(coluna, 0)) == 1:
            return modo

    return "Broil Qualitative"


def potencia_dissipada(configuracao, nome_area, parametros=None):
    """Potência atribuída à área, em watts, a partir do modo de ensaio e das perdas declaradas."""
    parametros = parametros or PARAMETROS_PADRAO
    potencia = (parametros["potencia_por_modo"][modo_da_configuracao(configuracao)]
                * parametros["fracao_por_area"][nome_area])

    for coluna, fator in parametros["fator_de_perdas"].items():
        if float(configuracao.get(coluna, 0)) == 1:
            potencia *= fator

    return float(potencia)


def sentido_do_escoamento(configuracao):
    """+1 com o soprador para trás e -1 para a frente."""
    return 1 if float(configuracao.get("Blower_Direction_To Back", 0)) == 1 else -1


def versao_do_modelo(parametros=None):
    """`substituto-0.1` com o escoamento desligado e `substituto-0.2` com ele ligado."""
    escoamento = (parametros or PARAMETROS_PADRAO).get("escoamento",
                                                        PARAMETROS_PADRAO["escoamento"])

    return VERSAO_MODELO if not any(escoamento.values()) else "substituto-0.2"


def coeficiente_de_conveccao(configuracao, parametros=None):
    """Coeficiente de convecção atribuído à configuração, em W/(m²·K)."""
    parametros = parametros or PARAMETROS_PADRAO
    conveccao = parametros["conveccao"]
    coeficiente = conveccao["base"]

    if float(configuracao.get("Blower_Direction_To Back", 0)) == 1:
        coeficiente *= conveccao["blower_para_tras"]

    if float(configuracao.get("Housing_Open", 0)) == 1:
        coeficiente *= conveccao["alojamento_aberto"]

    if float(configuracao.get("Deflector_Hole_Open", 0)) == 1:
        coeficiente += conveccao["defletor_aberto_acrescimo"]

    return float(max(coeficiente, conveccao["minimo"]))


# ------------------------------------------------------------------------------------------------
# Lote de simulação
# ------------------------------------------------------------------------------------------------

def _validar_entrada_do_lote(configuracoes, catalogo, colunas_configuracao):
    faltando = [c for c in colunas_configuracao if c not in configuracoes.columns]

    if faltando:
        raise ErroDeContrato(f"configurações: faltam as colunas {faltando}.")

    valores = configuracoes[colunas_configuracao].to_numpy()

    if not np.isin(valores, (0, 1)).all():
        raise ErroDeContrato("configurações: as colunas de configuração só aceitam 0 ou 1.")

    for coluna in ("TC_Name", "Key_Area", "Conjunto"):
        if coluna not in catalogo.columns:
            raise ErroDeContrato(f"catálogo de pontos: falta a coluna `{coluna}`.")

    if catalogo["TC_Name"].duplicated().any():
        raise ErroDeContrato("catálogo de pontos: há `TC_Name` repetido.")


def simular_lote(configuracoes, catalogo, colunas_configuracao, parametros=None, destino=None):
    """Simula cada configuração em cada área e devolve a tabela no contrato de dados.

    - `configuracoes`: uma linha por configuração, com as colunas binárias de configuração e, se
      houver, a coluna `simulacao_id`; sem ela, o identificador é gerado.
    - `catalogo`: um ponto de medição por linha, com `TC_Name`, `Key_Area` e `Conjunto`, que é a
      área usada pelos modelos.
    - `parametros`: cópia de `PARAMETROS_PADRAO` com as alterações desejadas.
    - `destino`: caminho do CSV a gravar; sem ele, nada é escrito em disco.
    """
    parametros = parametros or PARAMETROS_PADRAO
    configuracoes = configuracoes.reset_index(drop=True)
    _validar_entrada_do_lote(configuracoes, catalogo, colunas_configuracao)
    identificadores = (configuracoes["simulacao_id"] if "simulacao_id" in configuracoes.columns
                       else pd.Series([f"SIM {i + 1:03d}" for i in range(len(configuracoes))]))
    modelos = {nome: ModeloDeArea(nome, grupo["TC_Name"].tolist(), parametros)
               for nome, grupo in catalogo.groupby("Conjunto")}
    area_do_ponto = catalogo.set_index("TC_Name")["Key_Area"]
    linhas = []

    for posicao, configuracao in configuracoes.iterrows():
        coeficiente = coeficiente_de_conveccao(configuracao, parametros)

        for nome, modelo in modelos.items():
            potencia = potencia_dissipada(configuracao, nome, parametros)
            campo, residuo = modelo.resolver(potencia, coeficiente,
                                             parametros["temperatura_ambiente"],
                                             sentido_do_escoamento(configuracao))

            if residuo > parametros["tolerancia_residuo"]:
                raise ErroDeSimulacao(f"área {nome}: resíduo de {residuo:.2e} acima da tolerância "
                                      f"de {parametros['tolerancia_residuo']:.0e}.")

            for ponto in modelo.pontos:
                linhas.append({
                    "simulacao_id": identificadores[posicao],
                    **{c: int(configuracao[c]) for c in colunas_configuracao},
                    "TC_Name": ponto,
                    "Key_Area": area_do_ponto[ponto],
                    "Value": modelo.temperatura_no_ponto(campo, ponto),
                    "origem": ORIGEM_SIMULACAO,
                    "peso": float(parametros["peso_simulacao"]),
                    "h_aplicado": coeficiente,
                    "potencia_w": potencia,
                    "malha_elementos": int(len(modelo.elementos)),
                    "residuo_convergencia": residuo,
                    "versao_modelo": versao_do_modelo(parametros),
                })

    lote = pd.DataFrame(linhas)

    if destino:
        lote.to_csv(destino, index=False)

    return lote


# ------------------------------------------------------------------------------------------------
# Leitura, validação e calibração
# ------------------------------------------------------------------------------------------------

def carregar_simulacao(origem, pontos_validos, areas_validas, colunas_configuracao):
    """Lê o lote, confere o contrato e devolve a tabela pronta para entrar na modelagem.

    Falha com `ErroDeContrato` e a lista completa de problemas, em vez de deixar passar linha
    inválida: um rótulo de ponto desconhecido criaria um ponto inexistente na tabela de modelagem.
    """
    if isinstance(origem, pd.DataFrame):
        lote = origem.copy()
    elif not os.path.isfile(str(origem)):
        raise ErroDeContrato(f"arquivo de simulação não encontrado: {origem}.")
    else:
        lote = pd.read_csv(origem)

    problemas = []
    esperadas = COLUNAS_CONTRATO + list(colunas_configuracao)
    faltando = [c for c in esperadas if c not in lote.columns]

    if faltando:
        raise ErroDeContrato(f"colunas ausentes no contrato: {faltando}.")

    if lote.empty:
        raise ErroDeContrato("o lote de simulação está vazio.")

    vazios = lote[esperadas].isna().sum()

    if vazios.sum():
        problemas.append(f"valores vazios em {vazios[vazios > 0].to_dict()}")

    desconhecidos = sorted(set(lote["TC_Name"]) - set(pontos_validos))

    if desconhecidos:
        problemas.append(f"pontos fora do vocabulário: {desconhecidos[:5]}")

    areas_novas = sorted(set(lote["Key_Area"]) - set(areas_validas))

    if areas_novas:
        problemas.append(f"áreas fora do vocabulário: {areas_novas}")

    if not lote["origem"].eq(ORIGEM_SIMULACAO).all():
        problemas.append(f"a coluna `origem` deve valer `{ORIGEM_SIMULACAO}` em todas as linhas")

    if not np.isin(lote[list(colunas_configuracao)].to_numpy(), (0, 1)).all():
        problemas.append("colunas de configuração com valor diferente de 0 ou 1")

    for coluna in ("h_aplicado", "potencia_w", "peso"):
        if (lote[coluna] < 0).any():
            problemas.append(f"`{coluna}` com valor negativo")

    if (lote["Value"] < -273.15).any():
        problemas.append("temperatura abaixo do zero absoluto")

    if lote.duplicated(["simulacao_id", "TC_Name"]).any():
        problemas.append("há par de `simulacao_id` e `TC_Name` repetido")

    if problemas:
        raise ErroDeContrato("lote de simulação fora do contrato: " + "; ".join(problemas) + ".")

    return lote


def calibrar(simulado, medido, modo="viés por ponto"):
    """Corrige o viés da simulação contra as leituras reais e devolve o lote corrigido.

    A correção é estimada só nas configurações que foram ensaiadas, comparando a média simulada e a
    média medida de cada ponto ou de cada área, e é aplicada a todas as linhas do lote, inclusive às
    configurações novas. Com `modo="sem correção"`, o lote volta inalterado.
    """
    if modo == "sem correção":
        return simulado.copy()

    chave = {"viés por ponto": "TC_Name", "viés por área": "Key_Area"}.get(modo)

    if chave is None:
        raise ErroDeContrato(f"modo de calibração desconhecido: {modo}.")

    for tabela, nome in ((simulado, "simulado"), (medido, "medido")):
        if chave not in tabela.columns or "Value" not in tabela.columns:
            raise ErroDeContrato(f"calibração: a tabela {nome} precisa de `{chave}` e `Value`.")

    ajuste = (medido.groupby(chave)["Value"].mean() - simulado.groupby(chave)["Value"].mean())
    corrigido = simulado.copy()
    corrigido["correcao_aplicada"] = corrigido[chave].map(ajuste).fillna(float(ajuste.mean()))
    corrigido["Value"] = corrigido["Value"] + corrigido["correcao_aplicada"]

    return corrigido


def vizinhas_de_um_fator(configuracoes, colunas_configuracao, limite=None, semente=None):
    """Configurações novas, a um fator de distância das existentes, para simular.

    Troca um fator por vez entre os quatro binários independentes, soprador, alojamento, posição da
    placa e defletor, e entre os três níveis do suporte da bobina. O modo de ensaio e o estado das
    perdas ficam como estão, porque a combinação entre eles é fixada pelo desenho experimental e nem
    todo par existe: `Pyro` só ocorre sem perdas declaradas.
    """
    binarios = [c for c in ("Blower_Direction_To Back", "Housing_Open", "Board_Position_Right",
                            "Deflector_Hole_Open") if c in colunas_configuracao]
    suporte = [c for c in colunas_configuracao if c.startswith("Material_Coil_Support_")]
    conhecidas = {tuple(linha) for linha in
                  configuracoes[colunas_configuracao].astype(int).to_numpy()}
    novas, vistas = [], set(conhecidas)

    for _, linha in configuracoes[colunas_configuracao].astype(int).iterrows():
        candidatas = []

        for coluna in binarios:
            candidata = linha.copy()
            candidata[coluna] = 1 - candidata[coluna]
            candidatas.append(candidata)

        for coluna in suporte:
            for valor in (0, 1):
                candidata = linha.copy()
                candidata[suporte] = 0
                candidata[coluna] = valor
                candidatas.append(candidata)

        for candidata in candidatas:
            chave = tuple(candidata[colunas_configuracao].to_numpy())

            if chave not in vistas:
                vistas.add(chave)
                novas.append(candidata)

    tabela = pd.DataFrame(novas, columns=colunas_configuracao).reset_index(drop=True)

    if limite is not None and len(tabela) > limite:
        sorteio = np.random.default_rng(semente).choice(len(tabela), size=limite, replace=False)
        tabela = tabela.iloc[np.sort(sorteio)].reset_index(drop=True)

    return tabela


def parametros_personalizados(**alteracoes):
    """Cópia de `PARAMETROS_PADRAO` com as chaves de primeiro nível substituídas."""
    parametros = copy.deepcopy(PARAMETROS_PADRAO)

    for chave, valor in alteracoes.items():
        if chave not in parametros:
            raise ErroDeContrato(f"parâmetro desconhecido: {chave}. "
                                 f"Disponíveis: {sorted(parametros)}.")

        if isinstance(valor, dict) and isinstance(parametros[chave], dict):
            parametros[chave].update(valor)
        else:
            parametros[chave] = valor

    return parametros
