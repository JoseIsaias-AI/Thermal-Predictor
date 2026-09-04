/* Os sete fatores de configuração e seus níveis canônicos.
 *
 * Níveis lidos de notebooks/dataset_preprocessado.csv, já com a fusão de
 * sinônimos confirmada pelo parceiro. Não alterar sem conferir a Seção 4.2.2
 * da documentação.
 */

var SCHEMA = {
  schema_version: "1.0",
  measurement_point_key: "measurement_point",

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
          // Config S / Config M substituem os rótulos originais (RF-20).
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
