/* Tela de consulta do Thermal Predictor.
 *
 * Os valores exibidos são sintéticos. Nenhum modelo treinado participa desta
 * tela; o número vem de um hash da configuração, só para exercitar a
 * interface. O aviso no topo da página diz isso e sai quando houver modelo.
 */

(function () {
  "use strict";

  var MODEL_VERSION = "stub";
  var VALUE_RANGE = [27.69, 273.6]; // amplitude observada na base

  var form = document.getElementById("prediction-form");
  var fieldsContainer = document.getElementById("factor-fields");
  var resultSection = document.getElementById("result");
  var errorSection = document.getElementById("error");

  function buildSelect(name, factor) {
    var wrapper = document.createElement("label");
    wrapper.className = "field";

    var label = document.createElement("span");
    label.className = "field__label";
    label.textContent = factor.label;
    wrapper.appendChild(label);

    var select = document.createElement("select");
    select.name = name;

    if (factor.optional) {
      var blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "(não se aplica)";
      select.appendChild(blank);
    }

    factor.levels.forEach(function (level) {
      var option = document.createElement("option");
      option.value = level.value;
      option.textContent = level.label;
      select.appendChild(option);
    });
    wrapper.appendChild(select);

    if (factor.help_text) {
      var help = document.createElement("span");
      help.className = "field__help";
      help.textContent = factor.help_text;
      wrapper.appendChild(help);
    }

    return wrapper;
  }

  function buildFieldset(factor) {
    var fieldset = document.createElement("fieldset");
    fieldset.className = "fieldset";

    var legend = document.createElement("legend");
    legend.textContent = factor.label;
    fieldset.appendChild(legend);

    if (factor.help_text) {
      var help = document.createElement("p");
      help.className = "field__help";
      help.textContent = factor.help_text;
      fieldset.appendChild(help);
    }

    var grid = document.createElement("div");
    grid.className = "field-grid";

    // Nome com ponto ("losses.config") marca o aninhamento lido em collectInput.
    var controls = {};
    factor.subfields.forEach(function (sub) {
      var wrapper = buildSelect(factor.key + "." + sub.key, sub);
      grid.appendChild(wrapper);
      controls[sub.key] = { wrapper: wrapper, select: wrapper.querySelector("select") };
    });
    fieldset.appendChild(grid);

    applyDependencies(factor.subfields, controls);
    return fieldset;
  }

  // Desabilita o campo enquanto a condição declarada em `requires` não vale.
  function applyDependencies(subfields, controls) {
    subfields.forEach(function (sub) {
      if (!sub.requires) return;

      var gate = controls[sub.requires.field];
      var target = controls[sub.key];
      if (!gate || !target) return;

      var sync = function () {
        var aplicavel = gate.select.value === sub.requires.value;
        target.select.disabled = !aplicavel;
        target.wrapper.classList.toggle("field--inactive", !aplicavel);
      };

      gate.select.addEventListener("change", sync);
      sync();
    });
  }

  // Lista fechada, e não texto livre: só os 77 pontos com leitura registrada
  // em dataset_preprocessado.csv são consultáveis (RN-04), agrupados por
  // subsistema (Key_Area) para facilitar achar o ponto certo entre 77 opções.
  function buildMeasurementPointField(key, groups) {
    var wrapper = document.createElement("label");
    wrapper.className = "field";

    var label = document.createElement("span");
    label.className = "field__label";
    label.textContent = "Ponto de medição";
    wrapper.appendChild(label);

    var select = document.createElement("select");
    select.name = key;

    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "(selecione um ponto)";
    select.appendChild(blank);

    groups.forEach(function (group) {
      var optgroup = document.createElement("optgroup");
      optgroup.label = group.area;
      group.points.forEach(function (point) {
        var option = document.createElement("option");
        option.value = point.value;
        option.textContent = point.label;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });
    wrapper.appendChild(select);

    var help = document.createElement("span");
    help.className = "field__help";
    help.textContent = "Termopar consultado, entre os 77 pontos com leitura registrada na base.";
    wrapper.appendChild(help);

    return wrapper;
  }

  function buildForm() {
    SCHEMA.factors.forEach(function (factor) {
      if (factor.subfields && factor.subfields.length > 0) {
        fieldsContainer.appendChild(buildFieldset(factor));
      } else {
        fieldsContainer.appendChild(buildSelect(factor.key, factor));
      }
    });
    fieldsContainer.appendChild(
      buildMeasurementPointField(SCHEMA.measurement_point_key, SCHEMA.measurement_point_groups)
    );
  }

  function collectInput() {
    var input = {};

    Array.prototype.forEach.call(form.elements, function (element) {
      // Campo desabilitado não se aplica: fica de fora em vez de ir vazio.
      if (!element.name || element.disabled) return;

      var value = element.value === "" ? null : element.value;
      var parts = element.name.split(".");

      if (parts.length === 1) {
        input[parts[0]] = value;
      } else {
        if (!input[parts[0]]) input[parts[0]] = {};
        input[parts[0]][parts[1]] = value;
      }
    });

    return input;
  }

  // FNV-1a de 32 bits: a mesma configuração devolve sempre o mesmo número, para
  // que a tela não pareça instável a cada consulta.
  function hash(texto) {
    var h = 0x811c9dc5;
    for (var i = 0; i < texto.length; i++) {
      h ^= texto.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h;
  }

  function fakeTemperature(input) {
    var fraction = hash(JSON.stringify(input)) / 4294967296;
    return VALUE_RANGE[0] + fraction * (VALUE_RANGE[1] - VALUE_RANGE[0]);
  }

  // O valor do campo é o measurement_id técnico ("Nome | Área"); o resultado
  // mostra o nome amigável correspondente, não o identificador cru.
  function measurementPointLabel(value) {
    var found = null;
    SCHEMA.measurement_point_groups.forEach(function (group) {
      group.points.forEach(function (point) {
        if (point.value === value) found = point.label;
      });
    });
    return found || value;
  }

  function showError(message) {
    resultSection.hidden = true;
    document.getElementById("error-message").textContent = message;
    errorSection.hidden = false;
  }

  function showResult(input, temperatura) {
    errorSection.hidden = true;
    document.getElementById("result-temperature").textContent = temperatura.toFixed(2);
    document.getElementById("result-unit").textContent = " °C";
    document.getElementById("result-point").textContent =
      measurementPointLabel(input[SCHEMA.measurement_point_key]);
    document.getElementById("result-model-version").textContent = MODEL_VERSION;
    document.getElementById("result-schema-version").textContent = SCHEMA.schema_version;
    resultSection.hidden = false;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var input = collectInput();
    var ponto = input[SCHEMA.measurement_point_key];

    if (!ponto || !ponto.trim()) {
      showError("Informe o ponto de medição.");
      return;
    }

    showResult(input, fakeTemperature(input));
  });

  buildForm();
  document.getElementById("model-version").textContent = MODEL_VERSION;
})();
