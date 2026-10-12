"""Gera a base sintética do Thermal Predictor.

A base de ensaios térmicos do projeto pertence à Whirlpool, é confidencial e não faz parte deste
repositório. Este script cria, do zero, uma base fictícia com o mesmo formato do dataset auditado
que a API do painel e o assistente Robertão leem (`dataset_completo_com_flags_de_auditoria.csv`).

Nada aqui vem da base do parceiro:

- os pontos de medição têm nomes genéricos por subsistema ("IPC P01", "Mainback P07"...);
- os limites são valores redondos inventados;
- o plano de ensaios (os sete fatores de cada rodada) é sorteado;
- as temperaturas saem de um modelo simples (base por ponto, efeito dos fatores e ruído);
- as leituras ausentes são sorteadas.

Os números obtidos com esta base não têm significado físico: servem para demonstrar que o código
funciona de ponta a ponta.

Uso, na raiz do repositório:

    python sintetico/gerar_base_sintetica.py            # grava na raiz do repositório
    python sintetico/gerar_base_sintetica.py --semente 7
"""

import argparse
import csv
import string
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
NOME_ARQUIVO = "dataset_completo_com_flags_de_auditoria.csv"
SEMENTE_PADRAO = 42
TOTAL_RODADAS = 48

# Catálogo de pontos: nomes genéricos por subsistema (Key_Area). Os limites são sorteados, por
# ponto, de uma faixa plausível de cada subsistema, com semente própria: o catálogo é o mesmo em
# qualquer base gerada. Pontos de MONITORAMENTO não têm limite: são só acompanhados (RN-03).
SEMENTE_CATALOGO = 2026
NOMES = {
    "Mainback": [f"Mainback P{i:02d}" for i in range(1, 12)],
    "Coil Temps": [f"Bobina {p}" for p in ("FL", "FR", "RL", "RR")]
                  + [f"Suporte {p}" for p in ("FL", "FR", "RL", "RR")],
    "Main Vent Sys": ["Soprador P01", "Soprador P02", "Soprador P03",
                      "Entrada do soprador P01", "Entrada do soprador P02", "Duto P01", "Duto P02"],
    "IPC Cooling": [f"IPC Cooling P{i:02d}" for i in range(1, 6)],
    "IPC Comp": [f"IPC P{i:02d}" for i in range(1, 38)],
    "CT Knobs": [f"Knobs P{i:02d}" for i in range(1, 7)],
    "Oven HMI": [f"HMI P{i:02d}" for i in range(1, 5)],
}
FAIXAS_DE_LIMITE = {
    "Mainback": (100, 110, 120, 130, 140, 150),
    "Coil Temps": (140, 150, 160, 170, 180, 190, 200),
    "Main Vent Sys": (85, 95, 105, 115),
    "IPC Cooling": (75, 85, 95),
    "IPC Comp": (60, 65, 70, 75, 80, 85),
    "CT Knobs": (55, 60, 65, 70),
    "Oven HMI": (55, 60, 65, 70),
}
MONITORAMENTO = {"Entrada do soprador P01", "Entrada do soprador P02", "Duto P01", "Duto P02",
                 "IPC Cooling P01", "IPC Cooling P02", "IPC Cooling P04", "IPC Cooling P05",
                 "IPC P01", "IPC P12", "IPC P33"}


def _catalogo():
    rng = np.random.default_rng(SEMENTE_CATALOGO)
    return {
        area: [(nome, None if nome in MONITORAMENTO else float(rng.choice(FAIXAS_DE_LIMITE[area])))
               for nome in nomes]
        for area, nomes in NOMES.items()
    }


PONTOS = _catalogo()

# Ponto do catálogo que nenhuma rodada mede (catálogo com mais pontos do que leituras).
NUNCA_MEDIDO = "IPC Cooling P05"
# Pontos medidos só em parte das rodadas: o subsistema "AC Blower Inlet" fica com pouca base e
# sai como modelo não validado, o caso que o painel sinaliza.
POUCO_MEDIDOS = ("Entrada do soprador P01", "Entrada do soprador P02")
RODADAS_DOS_POUCO_MEDIDOS = 7
TAXA_FALHA_ALEATORIA = 0.02
# Variação que os fatores não explicam: condições de cada rodada (comum ao subsistema), efeito
# próprio de cada ponto para cada fator e ruído de medição, todos como fração da base do ponto.
DESVIO_DA_RODADA = 0.06
DESVIO_DO_PONTO = 0.07
RUIDO_DE_MEDICAO = 0.05

NIVEIS = {
    "Run_Case": (["Broil Qualitative", "Broil C2", "Broil C1", "Pyro"], [0.38, 0.30, 0.12, 0.20]),
    "Blower_Direction": (["To Front", "To Back"], [0.65, 0.35]),
    "Housing": (["Closed", "Open", "Open - Updated"], [0.55, 0.30, 0.15]),
    "Board_Position": (["Center", "Right"], [0.85, 0.15]),
    "Deflector_Hole": (["Closed", "Open"], [0.6, 0.4]),
    "Material_Coil_Support": (["Aluminium", "Aluminium Plate", "Plastic"], [0.65, 0.12, 0.23]),
}

# Efeito relativo de cada nível sobre a temperatura de cada subsistema (fração da base).
EFEITO_PYRO = {"Mainback": 0.25, "Main Vent Sys": 0.20, "IPC Cooling": 0.08, "IPC Comp": 0.06,
               "CT Knobs": 0.15, "Oven HMI": 0.18, "Coil Temps": -0.35}

COLUNAS = [
    "Run_ID", "Run_col_letter", "run_pos", "is_config_replicate", "Run_Reason", "Run_Case",
    "Blower_Direction", "Housing", "Board_Position", "Losses", "Deflector_Hole",
    "Material_Coil_Support", "TC_Number", "TC_Name", "Key_Area", "measurement_id", "limit_c",
    "is_monitor_only", "Value", "missing_class", "is_structural_missing", "is_random_missing",
    "Value_imputed", "is_iqr_eligible", "is_statistical_outlier", "is_measurement_error",
    "outlier_class", "run_family", "key_area_ct_knobs", "key_area_coil_temps",
    "key_area_ipc_comp", "key_area_ipc_cooling", "key_area_main_vent_sys", "key_area_mainback",
    "key_area_oven_hmi", "deflector_hole_open", "blower_direction_to_back", "housing_closed",
    "housing_open", "housing_open_updated", "board_position_center", "board_position_right",
    "material_coil_support_aluminium", "material_coil_support_aluminium_plate",
    "material_coil_support_plastic", "run_case_broil_c1", "run_case_broil_c2",
    "run_case_broil_qualitative", "run_case_pyro", "losses_present_declared",
    "losses_present_missing", "losses_present_none", "losses_config_m", "losses_config_s",
    "losses_order_back_order", "losses_order_front_order", "limit_c_scaled",
]


def _letra_da_coluna(indice):
    """Rótulo de coluna de planilha a partir de E: 0 -> E, 22 -> AA."""
    numero, rotulo = indice + 5, ""
    while numero:
        numero, resto = divmod(numero - 1, 26)
        rotulo = string.ascii_uppercase[resto] + rotulo
    return rotulo


def sortear_rodadas(rng):
    """Plano de ensaios fictício: sete fatores por rodada, com algumas réplicas."""
    rodadas = []
    while len(rodadas) < TOTAL_RODADAS:
        if rodadas and rng.random() < 0.12:
            # Réplica: repete os fatores de uma rodada anterior.
            fatores = dict(rodadas[int(rng.integers(len(rodadas)))])
        else:
            fatores = {coluna: str(rng.choice(niveis, p=pesos))
                       for coluna, (niveis, pesos) in NIVEIS.items()}
            # Regra do domínio: limpeza pirolítica não tem perda declarada, e só ela.
            if fatores["Run_Case"] == "Pyro":
                fatores["perdas"] = ("none", None, None)
            elif rng.random() < 0.18:
                fatores["perdas"] = ("missing", None, None)
            else:
                fatores["perdas"] = ("declared", str(rng.choice(["Config S", "Config M"])),
                                     str(rng.choice(["Front Order", "Back Order"], p=[0.6, 0.4])))
        rodadas.append(fatores)
    return rodadas


def _texto_perdas(perdas):
    presenca, arranjo, ordem = perdas
    if presenca == "none":
        return "No Losses"
    if presenca == "missing":
        return ""
    return f"{arranjo} - {ordem}"


def _efeitos(rng):
    """Efeito sorteado de cada nível em cada subsistema, mais os efeitos fixos de domínio."""
    efeitos = {}
    for area in PONTOS:
        for coluna, (niveis, _) in NIVEIS.items():
            for nivel in niveis[1:]:
                efeitos[(area, coluna, nivel)] = float(rng.normal(0, 0.05))
        efeitos[(area, "Run_Case", "Pyro")] = EFEITO_PYRO[area]
        efeitos[(area, "perdas", "declared")] = float(rng.normal(0.04, 0.02))
        efeitos[(area, "perdas", "Config M")] = float(rng.normal(0.03, 0.01))
        efeitos[(area, "perdas", "Back Order")] = float(rng.normal(-0.02, 0.01))
    return efeitos


def _soma_dos_efeitos(area, fatores, efeitos):
    soma = 0.0
    for coluna in NIVEIS:
        soma += efeitos.get((area, coluna, fatores[coluna]), 0.0)
    presenca, arranjo, ordem = fatores["perdas"]
    soma += efeitos.get((area, "perdas", presenca), 0.0)
    soma += efeitos.get((area, "perdas", arranjo), 0.0)
    soma += efeitos.get((area, "perdas", ordem), 0.0)
    return soma


def _indicadoras(fatores, area):
    presenca, arranjo, ordem = fatores["perdas"]
    uma = lambda condicao: 1 if condicao else 0  # noqa: E731
    return {
        "key_area_ct_knobs": uma(area == "CT Knobs"),
        "key_area_coil_temps": uma(area == "Coil Temps"),
        "key_area_ipc_comp": uma(area == "IPC Comp"),
        "key_area_ipc_cooling": uma(area == "IPC Cooling"),
        "key_area_main_vent_sys": uma(area == "Main Vent Sys"),
        "key_area_mainback": uma(area == "Mainback"),
        "key_area_oven_hmi": uma(area == "Oven HMI"),
        "deflector_hole_open": uma(fatores["Deflector_Hole"] == "Open"),
        "blower_direction_to_back": uma(fatores["Blower_Direction"] == "To Back"),
        "housing_closed": uma(fatores["Housing"] == "Closed"),
        "housing_open": uma(fatores["Housing"] == "Open"),
        "housing_open_updated": uma(fatores["Housing"] == "Open - Updated"),
        "board_position_center": uma(fatores["Board_Position"] == "Center"),
        "board_position_right": uma(fatores["Board_Position"] == "Right"),
        "material_coil_support_aluminium": uma(fatores["Material_Coil_Support"] == "Aluminium"),
        "material_coil_support_aluminium_plate": uma(
            fatores["Material_Coil_Support"] == "Aluminium Plate"),
        "material_coil_support_plastic": uma(fatores["Material_Coil_Support"] == "Plastic"),
        "run_case_broil_c1": uma(fatores["Run_Case"] == "Broil C1"),
        "run_case_broil_c2": uma(fatores["Run_Case"] == "Broil C2"),
        "run_case_broil_qualitative": uma(fatores["Run_Case"] == "Broil Qualitative"),
        "run_case_pyro": uma(fatores["Run_Case"] == "Pyro"),
        "losses_present_declared": uma(presenca == "declared"),
        "losses_present_missing": uma(presenca == "missing"),
        "losses_present_none": uma(presenca == "none"),
        "losses_config_m": uma(arranjo == "Config M"),
        "losses_config_s": uma(arranjo == "Config S"),
        "losses_order_back_order": uma(ordem == "Back Order"),
        "losses_order_front_order": uma(ordem == "Front Order"),
    }


def gerar_linhas(semente=SEMENTE_PADRAO):
    """Devolve as linhas do dataset auditado sintético, uma por ponto e rodada."""
    rng = np.random.default_rng(semente)
    rodadas = sortear_rodadas(rng)
    efeitos = _efeitos(rng)
    efeito_da_rodada = {(area, i): float(rng.normal(0, DESVIO_DA_RODADA))
                        for area in PONTOS for i in range(TOTAL_RODADAS)}

    limites = [lim for pontos in PONTOS.values() for _, lim in pontos if lim is not None]
    menor, maior = min(limites), max(limites)
    vistas = set()
    replica = []
    for fatores in rodadas:
        chave = tuple(sorted((k, str(v)) for k, v in fatores.items()))
        replica.append(chave in vistas)
        vistas.add(chave)

    medidas_pelos_pouco_medidos = set(
        rng.choice(TOTAL_RODADAS, size=RODADAS_DOS_POUCO_MEDIDOS, replace=False).tolist())

    linhas = []
    for area, pontos in PONTOS.items():
        for nome, limite in pontos:
            # A base do ponto fica entre 68% e 95% do limite: com o efeito dos fatores, as rodadas
            # mais quentes passam do limite em parte dos pontos, e a triagem tem o que ordenar.
            if limite is not None:
                base = limite * rng.uniform(0.68, 0.95)
            else:
                base = rng.uniform(45, 120)
            sensibilidade = rng.uniform(0.6, 1.4)
            # Efeito próprio do ponto para cada nível de cada fator.
            proprio = {(coluna, nivel): float(rng.normal(0, DESVIO_DO_PONTO))
                       for coluna, (niveis, _) in NIVEIS.items() for nivel in niveis[1:]}
            valores = {}
            for indice, fatores in enumerate(rodadas):
                if nome == NUNCA_MEDIDO:
                    classe = "structural_absence"
                elif nome in POUCO_MEDIDOS and indice not in medidas_pelos_pouco_medidos:
                    classe = "structural_absence"
                elif rng.random() < TAXA_FALHA_ALEATORIA:
                    classe = "random_read_failure"
                else:
                    classe = "observed"
                valor = None
                if classe == "observed":
                    soma = _soma_dos_efeitos(area, fatores, efeitos)
                    soma += sum(proprio.get((coluna, fatores[coluna]), 0.0) for coluna in NIVEIS)
                    soma += efeito_da_rodada[(area, indice)]
                    valor = base * (1 + sensibilidade * soma) + rng.normal(0, RUIDO_DE_MEDICAO * base)
                    valor = round(max(valor, 20.0), 2)
                valores[indice] = (classe, valor)

            observados = [v for c, v in valores.values() if c == "observed"]
            mediana = float(np.median(observados)) if observados else None
            q1, q3 = (np.percentile(observados, [25, 75]) if len(observados) >= 8 else (None, None))

            for indice, fatores in enumerate(rodadas):
                classe, valor = valores[indice]
                eh_outlier = (q1 is not None and valor is not None
                              and not (q1 - 1.5 * (q3 - q1) <= valor <= q3 + 1.5 * (q3 - q1)))
                imputado = valor if valor is not None else (
                    round(mediana, 2) if mediana is not None else None)
                linha = {
                    "Run_ID": f"Rodada {indice + 1:02d}",
                    "Run_col_letter": _letra_da_coluna(indice),
                    "run_pos": indice,
                    "is_config_replicate": replica[indice],
                    "Run_Reason": f"Ensaio sintético {indice // 4 + 1:02d}",
                    "Run_Case": fatores["Run_Case"],
                    "Blower_Direction": fatores["Blower_Direction"],
                    "Housing": fatores["Housing"],
                    "Board_Position": fatores["Board_Position"],
                    "Losses": _texto_perdas(fatores["perdas"]),
                    "Deflector_Hole": fatores["Deflector_Hole"],
                    "Material_Coil_Support": fatores["Material_Coil_Support"],
                    "TC_Number": "",
                    "TC_Name": nome,
                    "Key_Area": area,
                    "measurement_id": f"{nome} | {area}",
                    "limit_c": "" if limite is None else float(limite),
                    "is_monitor_only": limite is None,
                    "Value": "" if valor is None else valor,
                    "missing_class": classe,
                    "is_structural_missing": classe == "structural_absence",
                    "is_random_missing": classe == "random_read_failure",
                    "Value_imputed": "" if imputado is None else imputado,
                    "is_iqr_eligible": q1 is not None,
                    "is_statistical_outlier": bool(eh_outlier),
                    "is_measurement_error": False,
                    "outlier_class": "statistical" if eh_outlier else "none",
                    "run_family": "pyro" if fatores["Run_Case"] == "Pyro" else "broil",
                    "limit_c_scaled": "" if limite is None else round(
                        (limite - menor) / (maior - menor), 6),
                }
                linha.update(_indicadoras(fatores, area))
                linhas.append(linha)
    return linhas


def gravar(destino, semente=SEMENTE_PADRAO):
    linhas = gerar_linhas(semente)
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
    with open(destino, "w", encoding="utf-8", newline="") as arquivo:
        escritor = csv.DictWriter(arquivo, fieldnames=COLUNAS)
        escritor.writeheader()
        escritor.writerows(linhas)
    return linhas


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--semente", type=int, default=SEMENTE_PADRAO,
                        help="semente do sorteio (a mesma semente gera a mesma base)")
    parser.add_argument("--destino", type=Path, default=RAIZ / NOME_ARQUIVO,
                        help="onde gravar o CSV (padrão: raiz do repositório)")
    args = parser.parse_args()

    linhas = gravar(args.destino, args.semente)
    observadas = sum(1 for linha in linhas if linha["missing_class"] == "observed")
    pontos = len({linha["TC_Name"] for linha in linhas})
    print(f"Base sintética gravada em {args.destino}")
    print(f"  {TOTAL_RODADAS} rodadas, {pontos} pontos, {observadas} leituras observadas.")


if __name__ == "__main__":
    main()
