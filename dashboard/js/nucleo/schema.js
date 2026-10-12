/* Os sete fatores de configuração e seus níveis canônicos (Seção 4.2.2 da documentação),
 * o mesmo vocabulário de api/dominio/esquema_features.json.
 */

var SCHEMA = {
  schema_version: "1.0",
  measurement_point_key: "measurement_point",

  /* Os 77 pontos com leitura registrada, por subsistema. O 78º do catálogo,
   * IPC Cooling P05, não tem leitura na base. */
  measurement_point_groups: [
    {
      area: "CT Knobs",
      points: [
        { value: "Knobs P05 | CT Knobs", label: "Knobs P05" },
        { value: "Knobs P06 | CT Knobs", label: "Knobs P06" },
        { value: "Knobs P02 | CT Knobs", label: "Knobs P02" },
        { value: "Knobs P01 | CT Knobs", label: "Knobs P01" },
        { value: "Knobs P03 | CT Knobs", label: "Knobs P03" },
        { value: "Knobs P04 | CT Knobs", label: "Knobs P04" }
      ]
    },
    {
      area: "Coil Temps",
      points: [
        { value: "Suporte FL | Coil Temps", label: "Suporte FL" },
        { value: "Suporte FR | Coil Temps", label: "Suporte FR" },
        { value: "Suporte RL | Coil Temps", label: "Suporte RL" },
        { value: "Suporte RR | Coil Temps", label: "Suporte RR" },
        { value: "Bobina FL | Coil Temps", label: "Bobina FL" },
        { value: "Bobina FR | Coil Temps", label: "Bobina FR" },
        { value: "Bobina RL | Coil Temps", label: "Bobina RL" },
        { value: "Bobina RR | Coil Temps", label: "Bobina RR" }
      ]
    },
    {
      area: "IPC Comp",
      points: [
        { value: "IPC P01 | IPC Comp", label: "IPC P01" },
        { value: "IPC P02 | IPC Comp", label: "IPC P02" },
        { value: "IPC P03 | IPC Comp", label: "IPC P03" },
        { value: "IPC P04 | IPC Comp", label: "IPC P04" },
        { value: "IPC P05 | IPC Comp", label: "IPC P05" },
        { value: "IPC P06 | IPC Comp", label: "IPC P06" },
        { value: "IPC P07 | IPC Comp", label: "IPC P07" },
        { value: "IPC P08 | IPC Comp", label: "IPC P08" },
        { value: "IPC P09 | IPC Comp", label: "IPC P09" },
        { value: "IPC P10 | IPC Comp", label: "IPC P10" },
        { value: "IPC P11 | IPC Comp", label: "IPC P11" },
        { value: "IPC P20 | IPC Comp", label: "IPC P20" },
        { value: "IPC P21 | IPC Comp", label: "IPC P21" },
        { value: "IPC P22 | IPC Comp", label: "IPC P22" },
        { value: "IPC P23 | IPC Comp", label: "IPC P23" },
        { value: "IPC P24 | IPC Comp", label: "IPC P24" },
        { value: "IPC P25 | IPC Comp", label: "IPC P25" },
        { value: "IPC P26 | IPC Comp", label: "IPC P26" },
        { value: "IPC P12 | IPC Comp", label: "IPC P12" },
        { value: "IPC P13 | IPC Comp", label: "IPC P13" },
        { value: "IPC P14 | IPC Comp", label: "IPC P14" },
        { value: "IPC P15 | IPC Comp", label: "IPC P15" },
        { value: "IPC P16 | IPC Comp", label: "IPC P16" },
        { value: "IPC P17 | IPC Comp", label: "IPC P17" },
        { value: "IPC P18 | IPC Comp", label: "IPC P18" },
        { value: "IPC P19 | IPC Comp", label: "IPC P19" },
        { value: "IPC P27 | IPC Comp", label: "IPC P27" },
        { value: "IPC P28 | IPC Comp", label: "IPC P28" },
        { value: "IPC P29 | IPC Comp", label: "IPC P29" },
        { value: "IPC P30 | IPC Comp", label: "IPC P30" },
        { value: "IPC P31 | IPC Comp", label: "IPC P31" },
        { value: "IPC P32 | IPC Comp", label: "IPC P32" },
        { value: "IPC P33 | IPC Comp", label: "IPC P33" },
        { value: "IPC P34 | IPC Comp", label: "IPC P34" },
        { value: "IPC P35 | IPC Comp", label: "IPC P35" },
        { value: "IPC P36 | IPC Comp", label: "IPC P36" },
        { value: "IPC P37 | IPC Comp", label: "IPC P37" }
      ]
    },
    {
      area: "IPC Cooling",
      points: [
        { value: "IPC Cooling P02 | IPC Cooling", label: "IPC Cooling P02" },
        { value: "IPC Cooling P03 | IPC Cooling", label: "IPC Cooling P03" },
        { value: "IPC Cooling P01 | IPC Cooling", label: "IPC Cooling P01" },
        { value: "IPC Cooling P04 | IPC Cooling", label: "IPC Cooling P04" }
      ]
    },
    {
      area: "Main Vent Sys",
      points: [
        { value: "Soprador P01 | Main Vent Sys", label: "Soprador P01" },
        { value: "Soprador P02 | Main Vent Sys", label: "Soprador P02" },
        { value: "Entrada do soprador P01 | Main Vent Sys", label: "Entrada do soprador P01" },
        { value: "Entrada do soprador P02 | Main Vent Sys", label: "Entrada do soprador P02" },
        { value: "Soprador P03 | Main Vent Sys", label: "Soprador P03" },
        { value: "Duto P01 | Main Vent Sys", label: "Duto P01" },
        { value: "Duto P02 | Main Vent Sys", label: "Duto P02" }
      ]
    },
    {
      area: "Mainback",
      points: [
        { value: "Mainback P01 | Mainback", label: "Mainback P01" },
        { value: "Mainback P02 | Mainback", label: "Mainback P02" },
        { value: "Mainback P03 | Mainback", label: "Mainback P03" },
        { value: "Mainback P04 | Mainback", label: "Mainback P04" },
        { value: "Mainback P05 | Mainback", label: "Mainback P05" },
        { value: "Mainback P06 | Mainback", label: "Mainback P06" },
        { value: "Mainback P07 | Mainback", label: "Mainback P07" },
        { value: "Mainback P08 | Mainback", label: "Mainback P08" },
        { value: "Mainback P09 | Mainback", label: "Mainback P09" },
        { value: "Mainback P10 | Mainback", label: "Mainback P10" },
        { value: "Mainback P11 | Mainback", label: "Mainback P11" }
      ]
    },
    {
      area: "Oven HMI",
      points: [
        { value: "HMI P01 | Oven HMI", label: "HMI P01" },
        { value: "HMI P02 | Oven HMI", label: "HMI P02" },
        { value: "HMI P03 | Oven HMI", label: "HMI P03" },
        { value: "HMI P04 | Oven HMI", label: "HMI P04" }
      ]
    }
  ],

  factors: [
    {
      key: "blower_direction",
      label: "Direção do soprador",
      source_column: "Blower_Direction",
      help_text: "Sentido do fluxo de ar forçado.",
      levels: [
        { value: "To Front", label: "To Front (para a frente)" },
        { value: "To Back", label: "To Back (para trás)" }
      ]
    },
    {
      key: "housing",
      label: "Estado do alojamento",
      source_column: "Housing",
      help_text: "Estado da carcaça na rodada simulada.",
      // "Open - Updated" não consta do glossário; significado pendente com o parceiro.
      levels: [
        { value: "Closed", label: "Closed (fechado)" },
        { value: "Open", label: "Open (aberto)" },
        { value: "Open - Updated", label: "Open - Updated" }
      ]
    },
    {
      key: "board_position",
      label: "Posição da placa",
      source_column: "Board_Position",
      help_text: "Onde a placa eletrônica fica montada.",
      levels: [
        { value: "Center", label: "Center (centro)" },
        { value: "Right", label: "Right (direita)" }
      ]
    },
    {
      key: "run_case",
      label: "Caso de operação",
      source_column: "Run_Case",
      help_text: "Regime de ensaio simulado.",
      levels: [
        { value: "Broil Qualitative", label: "Broil Qualitative" },
        { value: "Broil C2", label: "Broil C2" },
        { value: "Broil C1", label: "Broil C1" },
        { value: "Pyro", label: "Pyro (pirólise)" }
      ]
    },
    {
      // Campo composto na planilha; decomposto em três variáveis na Seção 4.2.2(d).
      key: "losses",
      label: "Perdas consideradas",
      source_column: "Losses",
      help_text: "Perdas dissipadas na placa de indução.",
      levels: [],
      subfields: [
        {
          key: "present",
          label: "Perda declarada",
          source_column: "losses_present",
          help_text: "Se a rodada declarou perdas.",
          // "Sem perda" e "sem dado" são estados distintos na base.
          levels: [
            { value: "declared", label: "Com perda declarada" },
            { value: "none", label: "Sem perda" },
            { value: "missing", label: "Metadado não declarado" }
          ]
        },
        {
          // Config S / Config M: os dois arranjos de montagem das bobinas (RF-20).
          key: "config",
          label: "Configuração de montagem das bobinas",
          source_column: "losses_config",
          help_text: "Arranjo de montagem das bobinas.",
          optional: false,
          requires: { field: "present", value: "declared" },
          levels: [
            { value: "Config S", label: "Config S" },
            { value: "Config M", label: "Config M" }
          ]
        },
        {
          key: "order",
          label: "Ordem de montagem",
          source_column: "losses_order",
          help_text: "Ordem de montagem declarada na rodada.",
          // Parte das rodadas com perda declarada não traz ordem.
          optional: true,
          requires: { field: "present", value: "declared" },
          levels: [
            { value: "Front Order", label: "Front Order" },
            { value: "Back Order", label: "Back Order" }
          ]
        }
      ]
    },
    {
      key: "deflector_hole",
      label: "Abertura do defletor",
      source_column: "Deflector_Hole",
      help_text: "Furo do defletor, aberto ou fechado.",
      levels: [
        { value: "Closed", label: "Closed (fechado)" },
        { value: "Open", label: "Open (aberto)" }
      ]
    },
    {
      key: "material_coil_support",
      label: "Material do suporte da bobina",
      source_column: "Material_Coil_Support",
      help_text: "Material da peça que sustenta a bobina.",
      // Equivalência entre Aluminium e Aluminium Plate pendente com o parceiro.
      levels: [
        { value: "Aluminium", label: "Aluminium (alumínio)" },
        { value: "Aluminium Plate", label: "Aluminium Plate (placa de alumínio)" },
        { value: "Plastic", label: "Plastic (plástico)" }
      ]
    }
  ]
};
