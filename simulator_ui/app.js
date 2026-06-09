(function () {
  "use strict";

  var state = {
    context: { sessionId: "IO123abcd@simulate", syncId: "SIM_SYNC", ioid: "IO123abcd" },
    manifest: { samples: [] },
    activeSample: null,
    activeLocaleKey: "",
    activeLocale: null,
    activeConfig: null,
    activeHtmlPath: "",
    setupReady: false,
    generators: [],
    defaultFields: []
  };

  var els = {};
  var LAST_SELECTION_KEY = "rosa-simulator:last-template-v1";

  function $(id) { return document.getElementById(id); }

  function toast(message) {
    var node = $("toast");
    node.textContent = String(message || "");
    node.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(function () { node.hidden = true; }, 3000);
  }

  function request(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.text().then(function (text) {
        var data = text ? JSON.parse(text) : null;
        if (!response.ok) throw new Error((data && data.error) || response.statusText);
        return data;
      });
    });
  }

  function postJson(url, body) {
    return request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
  }

  function deleteJson(url) {
    return request(url, { method: "DELETE" });
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function icon(name) {
    var paths = {
      refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.8 9A7 7 0 0 0 7.2 5.2L4 8"/><path d="M5.2 15A7 7 0 0 0 16.8 18.8L20 16"/>',
      preview: '<path d="M5 12s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/><circle cx="12" cy="12" r="2.5"/>',
      settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.06.06-2.12 2.12-.06-.06a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V20h-3v-.09a1.8 1.8 0 0 0-1.1-1.65 1.8 1.8 0 0 0-2 .36l-.06.06-2.12-2.12.06-.06a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.65-1.1H5v-3h.09a1.8 1.8 0 0 0 1.65-1.1 1.8 1.8 0 0 0-.36-2l-.06-.06L8.44 5.1l.06.06a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 11.6 3.9V3h3v.9a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 2-.36l.06-.06 2.12 2.12-.06.06a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.65 1.1H22v3h-.9a1.8 1.8 0 0 0-1.7 1.6Z"/>',
      database: '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
      play: '<path d="M8 5v14l11-7Z"/>',
      pause: '<path d="M8 5h3v14H8Z"/><path d="M13 5h3v14h-3Z"/>',
      plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
      save: '<path d="M5 4h12l2 2v14H5Z"/><path d="M8 4v6h8"/><path d="M8 20v-6h8v6"/>',
      close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
      edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M14 7l3 3"/>',
      send: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4 18-7Z"/>',
      trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/>',
      copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
      check: '<path d="M20 6 9 17l-5-5"/>'
    };
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.preview) + '</svg>';
  }

  function decorateIconButtons(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll("[data-icon]"), function (button) {
      var label = button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent.trim();
      button.classList.add("icon-button");
      button.innerHTML = icon(button.getAttribute("data-icon")) + '<span class="sr-only">' + esc(label) + '</span>';
    });
  }

  function actionButton(action, iconName, label) {
    return '<button type="button" class="icon-button" data-action="' + esc(action) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">'
      + icon(iconName)
      + '<span class="sr-only">' + esc(label) + '</span>'
      + '</button>';
  }

  function localeEntries(sample) {
    var entries = [];
    var locales = sample && sample.locales && typeof sample.locales === "object" ? sample.locales : {};
    Object.keys(locales).forEach(function (key) {
      entries.push(Object.assign({ locale: key }, locales[key] || {}));
    });
    if (!entries.length) {
      entries.push({
        locale: sample.defaultLocale || "default",
        name: sample.name,
        label: sample.name,
        description: sample.description,
        html: sample.html,
        setup: sample.setup,
        sampleDatabase: sample.sampleDatabase
      });
    }
    return entries;
  }

  function activeLocaleFor(sample, requestedKey) {
    var entries = localeEntries(sample);
    return entries.find(function (entry) { return entry.locale === requestedKey; })
      || entries.find(function (entry) { return entry.locale === sample.defaultLocale; })
      || entries[0];
  }

  function readLastSelection() {
    try {
      var value = JSON.parse(window.localStorage.getItem(LAST_SELECTION_KEY) || "{}");
      return {
        templateId: String(value.templateId || "").trim(),
        locale: String(value.locale || "").trim()
      };
    } catch (error) {
      return { templateId: "", locale: "" };
    }
  }

  function persistLastSelection() {
    if (!state.activeSample || !state.activeLocaleKey) return;
    try {
      window.localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify({
        templateId: state.activeSample.id,
        locale: state.activeLocaleKey
      }));
    } catch (error) {
      /* localStorage can be unavailable in restricted browser contexts. */
    }
  }

  function activeSampleDatabase() {
    return state.activeLocale && state.activeLocale.sampleDatabase
      || state.activeSample && state.activeSample.sampleDatabase
      || "";
  }

  function randomGeneratorIntervalMs() {
    return String(2000 + Math.floor(Math.random() * 2001));
  }

  function macroExamplesFor(sample, localeEntry) {
    if (localeEntry && Object.prototype.hasOwnProperty.call(localeEntry, "macro-examples")) {
      return Array.isArray(localeEntry["macro-examples"]) ? localeEntry["macro-examples"] : [];
    }
    if (sample && Object.prototype.hasOwnProperty.call(sample, "macro-examples")) {
      return Array.isArray(sample["macro-examples"]) ? sample["macro-examples"] : [];
    }
    return [];
  }

  function activeMacroExamples() {
    return macroExamplesFor(state.activeSample, state.activeLocale);
  }

  function activeSetupPage() {
    return state.activeLocale && state.activeLocale.setup && state.activeLocale.setup.page
      || state.activeSample && state.activeSample.setup && state.activeSample.setup.page
      || "";
  }

  function activeUsesDatabase() {
    if (!state.activeSample) return false;
    if (activeSampleDatabase()) return true;
    if (activeMacroExamples().length) return true;
    var tags = []
      .concat(state.activeSample.tags || [])
      .concat(state.activeLocale && state.activeLocale.tags || [])
      .map(function (tag) { return String(tag || "").toLowerCase(); });
    return tags.indexOf("database") !== -1;
  }

  function prettyJson(value) {
    return JSON.stringify(value || {}, null, 2);
  }

  function fallbackMacroPayloadForActiveTemplate() {
    var id = state.activeSample && state.activeSample.id || "";
    if (id === "factory-production") return { macro: "factory-kpis" };
    if (id === "monitoring-aquaculture-ponds") return { macro: "pond-event-history", limit: 20, offset: 0 };
    if (id === "irrigation-timer-control") return { macro: "irrigation-control-history", limit: 20, offset: 0 };
    if (id === "biomass-burner-management") return { macro: "biomass-burner-summary", soon_days: 30, co2_kg_per_minute: 2.77 };
    return { macro: "" };
  }

  function applyMacroExample(index) {
    var examples = activeMacroExamples();
    var example = examples[Math.max(0, Number(index) || 0)];
    if (!example) {
      if (els.macroGatewayField) els.macroGatewayField.hidden = true;
      if (els.macroGatewayCommand) els.macroGatewayCommand.textContent = "";
      return;
    }
    if (els.macroPayload) els.macroPayload.value = prettyJson(example.payload || {});
    var gatewayCommand = String(example.gatewayCommand || "").trim();
    if (els.macroGatewayField) els.macroGatewayField.hidden = !gatewayCommand;
    if (els.macroGatewayCommand) els.macroGatewayCommand.textContent = gatewayCommand;
  }

  function renderMacroExamples(options) {
    if (!els.macroExampleField || !els.macroExampleSelect || !els.macroPayload) return;
    var examples = activeMacroExamples();
    els.macroExampleSelect.innerHTML = "";
    els.macroExampleField.hidden = !examples.length;
    if (!examples.length) {
      if (els.macroGatewayField) els.macroGatewayField.hidden = true;
      if (els.macroGatewayCommand) els.macroGatewayCommand.textContent = "";
      if (options && options.resetPayload) els.macroPayload.value = prettyJson(fallbackMacroPayloadForActiveTemplate());
      return;
    }
    examples.forEach(function (example, index) {
      var option = document.createElement("option");
      option.value = String(index);
      option.textContent = example.label || (example.payload && example.payload.macro) || ("Example " + (index + 1));
      els.macroExampleSelect.appendChild(option);
    });
    els.macroExampleSelect.value = "0";
    applyMacroExample(0);
  }

  function syncTemplateTools() {
    if (els.macroPanel) els.macroPanel.hidden = !activeUsesDatabase();
    if (els.loadDatabase) {
      var hasSampleDb = Boolean(activeSampleDatabase());
      els.loadDatabase.hidden = !hasSampleDb;
      els.loadDatabase.disabled = !hasSampleDb;
    }
    if (els.openSetup) els.openSetup.disabled = !activeSetupPage();
  }

  function renderTemplates() {
    els.templateSelect.innerHTML = "";
    (state.manifest.samples || []).forEach(function (sample) {
      var option = document.createElement("option");
      option.value = sample.id;
      option.textContent = sample.name || sample.id;
      option.selected = state.activeSample && state.activeSample.id === sample.id;
      els.templateSelect.appendChild(option);
    });
  }

  function renderLocaleSelect() {
    els.localeSelect.innerHTML = "";
    if (!state.activeSample) return;
    localeEntries(state.activeSample).forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry.locale;
      option.textContent = entry.label || entry.name || entry.locale;
      option.selected = entry.locale === state.activeLocaleKey;
      els.localeSelect.appendChild(option);
    });
  }

  function selectSample(sampleId, localeKey) {
    var sample = (state.manifest.samples || []).find(function (entry) { return entry.id === sampleId; });
    if (!sample) return;
    state.activeSample = sample;
    state.activeLocale = activeLocaleFor(sample, localeKey || sample.defaultLocale);
    state.activeLocaleKey = state.activeLocale.locale;
    state.activeConfig = null;
    state.activeHtmlPath = state.activeLocale.html || sample.html || "";
    persistLastSelection();
    els.templateStatus.textContent = "Selected: " + (state.activeLocale.name || sample.name || sample.id);
    renderTemplates();
    renderLocaleSelect();
    syncTemplateTools();
    renderMacroExamples({ resetPayload: true });
    refreshDefaultFields();
  }

  function renderDashboard() {
    if (!state.activeSample || !state.activeLocale) {
      toast("Select a template first.");
      return Promise.resolve();
    }
    state.activeHtmlPath = state.activeLocale.html || state.activeSample.html || "";
    els.previewState.textContent = "Rendering";
    return postJson("/sim/api/render", {
      htmlPath: state.activeHtmlPath,
      config: state.activeConfig === null ? undefined : state.activeConfig
    }).then(function (payload) {
      state.activeConfig = payload.config || state.activeConfig || {};
      els.dashboardFrame.srcdoc = payload.html;
      els.previewTitle.textContent = state.activeLocale.name || state.activeSample.name || "Preview";
      els.previewState.textContent = payload.parseError ? "Marker error: " + payload.parseError : "Ready";
      els.templateStatus.textContent = "Preview loaded.";
      refreshDefaultFields();
    }).catch(function (error) {
      els.previewState.textContent = "Error";
      toast(error.message);
    });
  }

  function openSetup() {
    if (!state.activeSample || !state.activeLocale) {
      toast("Select a template first.");
      return;
    }
    var setupPage = activeSetupPage();
    if (!setupPage) {
      toast("This template has no setup GUI.");
      return;
    }
    state.setupReady = false;
    els.setupFrame.src = setupPage;
    els.setupDialog.showModal();
  }

  function postSetupInit() {
    var target = els.setupFrame.contentWindow;
    if (!target) return;
    target.postMessage({
      type: "dashboardSetup:init",
      payload: {
        mode: state.activeConfig ? "edit" : "create",
        templateId: state.activeSample && state.activeSample.id,
        locale: state.activeLocaleKey,
        config: state.activeConfig || {},
        context: {
          sessionId: state.context.sessionId,
          syncId: state.context.syncId,
          locale: "vi"
        }
      }
    }, window.location.origin);
  }

  function saveSetup() {
    if (!els.setupFrame.contentWindow) return;
    els.setupFrame.contentWindow.postMessage({ type: "dashboardSetup:collect" }, window.location.origin);
  }

  function loadSampleDatabase() {
    if (!state.activeSample || !state.activeLocale) {
      toast("Select a template first.");
      return;
    }
    var sampleDatabase = activeSampleDatabase();
    if (!sampleDatabase) {
      toast("This template has no sample database.");
      return;
    }
    return postJson("/api/sample-dashboards/database", {
      templateId: state.activeSample.id,
      locale: state.activeLocaleKey,
      sessionId: state.context.sessionId,
      overwrite: true
    }).then(function (payload) {
      toast("Sample DB loaded: " + payload.ioid);
    }).catch(function (error) {
      toast(error.message);
    });
  }

  function fileNameFromDisposition(value) {
    var text = String(value || "");
    var match = text.match(/filename\*=UTF-8''([^;]+)/i);
    if (match) return decodeURIComponent(match[1]);
    match = text.match(/filename="?([^";]+)"?/i);
    return match ? match[1] : "";
  }

  function exportTemplate() {
    if (!state.activeSample) {
      toast("Select a template first.");
      return;
    }
    var templateId = String(state.activeSample.id || "").trim();
    if (!templateId) {
      toast("Selected template has no id.");
      return;
    }
    var url = "/sim/api/export-template?templateId=" + encodeURIComponent(templateId);
    fetch(url, { cache: "no-store" }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          var message = response.statusText;
          try {
            var payload = JSON.parse(text || "{}");
            message = payload.error || message;
          } catch (error) {
            message = text || message;
          }
          throw new Error(message);
        });
      }
      return response.blob().then(function (blob) {
        var fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"))
          || (templateId + ".zip");
        var objectUrl = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
        toast("Template package exported.");
      });
    }).catch(function (error) {
      toast(error.message || "Export failed.");
    });
  }

  function clearSimulatedDatabases() {
    if (!window.confirm("Clear all simulated IoData databases?")) return Promise.resolve();
    return deleteJson("/sim/api/iodata").then(function (payload) {
      toast("Simulated DB files cleared: " + (payload.deleted || 0));
      els.macroResult.textContent = "";
    }).catch(function (error) {
      toast(error.message);
    });
  }

  function normalizeGeneratorKind(kind) {
    var value = String(kind || "").trim().toLowerCase();
    return ["timeseries", "number", "text", "onoff"].indexOf(value) === -1 ? "timeseries" : value;
  }

  function generatorKindMeta(kind) {
    var value = normalizeGeneratorKind(kind);
    if (value === "timeseries") return { mode: "random-number", writeTimeseries: true, numeric: true, text: false };
    if (value === "number") return { mode: "random-number", writeTimeseries: false, numeric: true, text: false };
    if (value === "onoff") return { mode: "toggle", writeTimeseries: false, numeric: false, text: false };
    return { mode: "fixed", writeTimeseries: false, numeric: false, text: true };
  }

  function generatorKindFromRow(row) {
    var mode = String(row && row.mode || "").trim().toLowerCase();
    if (Number(row && row.writeTimeseries || 0) === 1) return "timeseries";
    if (mode === "toggle") return "onoff";
    if (mode === "random-number" || mode === "random-integer") return "number";
    return "text";
  }

  function generatorKindLabel(kind) {
    return {
      timeseries: "timeseries number",
      number: "telemetry number",
      text: "text",
      onoff: "ON/OFF"
    }[normalizeGeneratorKind(kind)];
  }

  function syncGeneratorKindFields() {
    if (!els.generatorKind) return;
    var meta = generatorKindMeta(els.generatorKind.value);
    if (els.generatorValueField) els.generatorValueField.hidden = !meta.text;
    if (els.generatorRangeFields) els.generatorRangeFields.hidden = !meta.numeric;
  }

  function resetGeneratorForm() {
    els.generatorId.value = "";
    els.generatorSession.value = state.context.sessionId;
    els.generatorField.value = "";
    els.generatorKind.value = "timeseries";
    els.generatorValue.value = "";
    els.generatorMin.value = "20";
    els.generatorMax.value = "35";
    els.generatorInterval.value = randomGeneratorIntervalMs();
    els.generatorEnabled.checked = true;
    syncGeneratorKindFields();
  }

  function showGeneratorForm() {
    resetGeneratorForm();
    els.generatorForm.hidden = false;
    window.setTimeout(function () { els.generatorField.focus(); }, 0);
  }

  function hideGeneratorForm() {
    els.generatorForm.hidden = true;
    resetGeneratorForm();
  }

  function generatorPayload() {
    var kind = normalizeGeneratorKind(els.generatorKind.value);
    var meta = generatorKindMeta(kind);
    return {
      id: Number(els.generatorId.value || 0),
      sessionId: els.generatorSession.value.trim() || state.context.sessionId,
      field: els.generatorField.value.trim(),
      mode: meta.mode,
      valueText: meta.text ? els.generatorValue.value : "",
      minValue: meta.numeric ? els.generatorMin.value : "",
      maxValue: meta.numeric ? els.generatorMax.value : "",
      digits: 1,
      intervalMs: els.generatorInterval.value,
      writeTimeseries: meta.writeTimeseries,
      enabled: els.generatorEnabled.checked
    };
  }

  function editGenerator(row) {
    els.generatorForm.hidden = false;
    els.generatorId.value = row.id || "";
    els.generatorSession.value = row.sessionId || state.context.sessionId;
    els.generatorField.value = row.field || "";
    els.generatorKind.value = generatorKindFromRow(row);
    els.generatorValue.value = row.valueText || "";
    els.generatorMin.value = row.minValue == null ? "" : row.minValue;
    els.generatorMax.value = row.maxValue == null ? "" : row.maxValue;
    els.generatorInterval.value = row.intervalMs == null ? randomGeneratorIntervalMs() : row.intervalMs;
    els.generatorEnabled.checked = Number(row.enabled || 0) === 1;
    syncGeneratorKindFields();
    window.setTimeout(function () { els.generatorField.focus(); }, 0);
  }

  function renderGenerators(rows) {
    state.generators = rows || [];
    els.generatorList.innerHTML = "";
    if (!rows.length) {
      els.generatorList.innerHTML = '<div class="status">No generators.</div>';
      renderDefaultFields();
      return;
    }
    rows.forEach(function (row) {
      var item = document.createElement("div");
      item.className = "generator-item";
      var kind = generatorKindFromRow(row);
      item.innerHTML = ""
        + '<div class="generator-copy">'
        + "<strong>" + esc(row.field) + "</strong>"
        + "<span>" + esc(generatorKindLabel(kind)) + " | " + esc(row.sessionId) + " | " + (row.enabled ? "auto" : "manual") + " | " + esc(row.intervalMs) + "ms</span>"
        + "</div>"
        + '<div class="generator-actions compact-actions">'
        + actionButton("edit", "edit", "Edit")
        + actionButton("tick", "send", "Send once")
        + actionButton("toggle", row.enabled ? "pause" : "play", row.enabled ? "Stop" : "Start")
        + actionButton("delete", "trash", "Delete")
        + '</div>';
      item.querySelector('[data-action="edit"]').addEventListener("click", function () { editGenerator(row); });
      item.querySelector('[data-action="tick"]').addEventListener("click", function () {
        postJson("/sim/api/generators/" + row.id + "/tick", {}).then(refreshGenerators);
      });
      item.querySelector('[data-action="toggle"]').addEventListener("click", function () {
        postJson("/sim/api/generators/" + row.id + "/toggle", { enabled: !row.enabled }).then(refreshGenerators);
      });
      item.querySelector('[data-action="delete"]').addEventListener("click", function () {
        deleteJson("/sim/api/generators/" + row.id).then(refreshGenerators);
      });
      els.generatorList.appendChild(item);
    });
    renderDefaultFields();
  }

  function refreshGenerators() {
    return request("/sim/api/generators").then(renderGenerators).catch(function (error) { toast(error.message); });
  }

  function clearGenerators() {
    if (!window.confirm("Clear all telemetry/timeseries generators and generated data?")) return Promise.resolve();
    return deleteJson("/sim/api/generators").then(function (payload) {
      toast("Telemetry/timeseries cleared: " + (payload.generators || 0) + " generators");
      state.generators = [];
      return refreshGenerators().then(refreshDefaultFields);
    }).catch(function (error) { toast(error.message); });
  }

  function generatorKey(sessionId, field) {
    return String(sessionId || "").trim() + "\n" + String(field || "").trim().toLowerCase();
  }

  function existingGeneratorLookup() {
    var lookup = {};
    (state.generators || []).forEach(function (row) {
      lookup[generatorKey(row.sessionId, row.field)] = true;
    });
    return lookup;
  }

  function renderDefaultFields() {
    if (!els.defaultFieldList || !els.defaultFieldsPanel) return;
    var rows = state.defaultFields || [];
    els.defaultFieldList.innerHTML = "";
    var existing = existingGeneratorLookup();
    var missing = [];
    rows.forEach(function (row, index) {
      var exists = row.exists || existing[generatorKey(row.sessionId, row.field)];
      if (!exists) missing.push({ row: row, index: index });
    });
    els.defaultFieldsPanel.hidden = missing.length === 0;
    if (!missing.length) return;
    missing.forEach(function (entry) {
      var row = entry.row;
      var item = document.createElement("div");
      item.className = "default-field-item";
      item.dataset.exists = "false";
      item.innerHTML = ""
        + "<div><strong>" + esc(row.field) + " | " + esc(generatorKindLabel(row.kind)) + "</strong>"
        + "<span>DeviceId: " + esc(row.sessionId) + " | missing</span></div>"
        + actionButton("add-default", "plus", "Add field");
      var button = item.querySelector('[data-action="add-default"]');
      button.addEventListener("click", function () { addDefaultFields([entry.index]); });
      els.defaultFieldList.appendChild(item);
    });
  }

  function refreshDefaultFields() {
    if (!state.activeSample || !state.activeLocale) {
      state.defaultFields = [];
      renderDefaultFields();
      return Promise.resolve();
    }
    return postJson("/sim/api/default-fields", {
      templateId: state.activeSample.id,
      locale: state.activeLocaleKey
    }).then(function (payload) {
      state.defaultFields = payload.fields || [];
      renderDefaultFields();
    }).catch(function (error) {
      state.defaultFields = [];
      renderDefaultFields();
      toast(error.message);
    });
  }

  function addDefaultFields(indexes) {
    var existing = existingGeneratorLookup();
    var selected = Array.isArray(indexes)
      ? indexes.map(function (index) { return state.defaultFields[index]; }).filter(Boolean)
      : state.defaultFields;
    var generators = selected
      .filter(function (row) { return row && !row.exists && !existing[generatorKey(row.sessionId, row.field)]; })
      .map(function (row) { return row.generator; });
    if (!generators.length) {
      toast("No missing default fields.");
      return Promise.resolve();
    }
    return postJson("/sim/api/generators/bulk", { generators: generators }).then(function (payload) {
      toast("Default fields added: " + (payload.inserted || []).length);
      return refreshGenerators().then(refreshDefaultFields);
    }).catch(function (error) { toast(error.message); });
  }

  function saveGenerator(event) {
    event.preventDefault();
    postJson("/sim/api/generators", generatorPayload()).then(function () {
      hideGeneratorForm();
      refreshGenerators();
      toast("Generator saved.");
    }).catch(function (error) { toast(error.message); });
  }

  function renderCommands(rows) {
    els.commandLog.innerHTML = "";
    if (!rows.length) {
      els.commandLog.innerHTML = '<div class="status">No commands.</div>';
      return;
    }
    rows.forEach(function (row) {
      var item = document.createElement("div");
      item.className = "command-item";
      item.innerHTML = "<strong>" + esc(row.command) + "</strong><span>" + esc(row.ioid) + " | " + new Date(row.created_at).toLocaleString() + "</span>";
      els.commandLog.appendChild(item);
    });
  }

  function refreshCommands() {
    return request("/sim/api/commands").then(renderCommands).catch(function (error) { toast(error.message); });
  }

  function clearCommands() {
    return deleteJson("/sim/api/commands").then(function (payload) {
      toast("Command log cleared: " + (payload.deleted || 0));
      return refreshCommands();
    }).catch(function (error) { toast(error.message); });
  }

  function runMacro() {
    var payload;
    try {
      payload = JSON.parse(els.macroPayload.value || "{}");
    } catch (error) {
      toast("Macro payload JSON is invalid.");
      return;
    }
    postJson("/api/" + encodeURIComponent(state.context.sessionId) + "/" + encodeURIComponent(state.context.syncId) + "/iodata", payload)
      .then(function (rows) {
        els.macroResult.textContent = JSON.stringify(rows, null, 2);
      })
      .catch(function (error) {
        els.macroResult.textContent = error.message;
      });
  }

  function copyMacroGatewayCommand() {
    var text = els.macroGatewayCommand && els.macroGatewayCommand.textContent || "";
    if (!text) return;
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      toast("Clipboard API is not available.");
      return;
    }
    navigator.clipboard.writeText(text)
      .then(function () { toast("Gateway command copied."); })
      .catch(function (error) { toast(error.message || "Copy failed."); });
  }

  function bind() {
    decorateIconButtons(document);
    els.templateSelect = $("template-select");
    els.localeSelect = $("locale-select");
    els.templateStatus = $("template-status");
    els.macroPanel = $("macro-panel");
    els.loadDatabase = $("load-database");
    els.openSetup = $("open-setup");
    els.exportTemplate = $("export-template");
    els.previewState = $("preview-state");
    els.previewTitle = $("preview-title");
    els.dashboardFrame = $("dashboard-frame");
    els.setupDialog = $("setup-dialog");
    els.setupFrame = $("setup-frame");
    els.generatorForm = $("generator-form");
    els.generatorList = $("generator-list");
    els.commandLog = $("command-log");
    els.macroPayload = $("macro-payload");
    els.macroResult = $("macro-result");
    els.macroExampleField = $("macro-example-field");
    els.macroExampleSelect = $("macro-example");
    els.macroGatewayField = $("macro-gateway-field");
    els.macroGatewayCommand = $("macro-gateway-command");
    els.generatorId = $("generator-id");
    els.generatorSession = $("generator-session");
    els.generatorField = $("generator-field");
    els.generatorKind = $("generator-kind");
    els.generatorValueField = $("generator-value-field");
    els.generatorRangeFields = $("generator-range-fields");
    els.generatorValue = $("generator-value");
    els.generatorMin = $("generator-min");
    els.generatorMax = $("generator-max");
    els.generatorInterval = $("generator-interval");
    els.generatorEnabled = $("generator-enabled");
    els.defaultFieldsPanel = $("default-fields-panel");
    els.defaultFieldList = $("default-field-list");

    $("refresh-manifest").addEventListener("click", loadManifest);
    $("load-template").addEventListener("click", renderDashboard);
    els.openSetup.addEventListener("click", openSetup);
    els.exportTemplate.addEventListener("click", exportTemplate);
    els.loadDatabase.addEventListener("click", loadSampleDatabase);
    $("clear-databases").addEventListener("click", clearSimulatedDatabases);
    $("close-setup").addEventListener("click", function () { els.setupDialog.close(); });
    $("save-setup").addEventListener("click", saveSetup);
    $("add-generator").addEventListener("click", showGeneratorForm);
    $("add-default-fields").addEventListener("click", function () { addDefaultFields(); });
    $("refresh-default-fields").addEventListener("click", refreshDefaultFields);
    $("refresh-generators").addEventListener("click", refreshGenerators);
    $("clear-generators").addEventListener("click", clearGenerators);
    $("refresh-commands").addEventListener("click", refreshCommands);
    $("clear-commands").addEventListener("click", clearCommands);
    $("run-macro").addEventListener("click", runMacro);
    $("copy-macro-gateway").addEventListener("click", copyMacroGatewayCommand);
    els.macroExampleSelect.addEventListener("change", function () {
      applyMacroExample(els.macroExampleSelect.value);
    });
    els.generatorForm.addEventListener("submit", saveGenerator);
    els.generatorKind.addEventListener("change", syncGeneratorKindFields);
    $("generator-reset").addEventListener("click", hideGeneratorForm);
    els.templateSelect.addEventListener("change", function () {
      selectSample(els.templateSelect.value);
    });
    els.localeSelect.addEventListener("change", function () {
      state.activeLocaleKey = els.localeSelect.value;
      state.activeLocale = activeLocaleFor(state.activeSample, state.activeLocaleKey);
      state.activeConfig = null;
      state.activeHtmlPath = state.activeLocale.html || state.activeSample.html || "";
      persistLastSelection();
      els.templateStatus.textContent = "Selected: " + (state.activeLocale.name || state.activeSample.name || state.activeSample.id);
      syncTemplateTools();
      renderMacroExamples({ resetPayload: true });
      refreshDefaultFields();
    });

    window.addEventListener("message", function (event) {
      if (event.origin !== window.location.origin) return;
      var data = event.data && typeof event.data === "object" ? event.data : null;
      if (!data || !data.type) return;
      if (data.type === "dashboardSetup:ready") {
        state.setupReady = true;
        postSetupInit();
      } else if (data.type === "dashboardSetup:resize") {
        var height = Math.max(420, Math.min(1000, Number(data.payload && data.payload.height) || 560));
        els.setupFrame.style.height = height + "px";
      } else if (data.type === "dashboardSetup:submit") {
        state.activeConfig = data.payload && data.payload.config || {};
        els.setupDialog.close();
        renderDashboard();
        refreshDefaultFields();
        toast("Setup config applied.");
      } else if (data.type === "dashboardSetup:error") {
        toast(data.payload && data.payload.message || "Setup error.");
      }
    });
  }

  function loadContext() {
    return request("/sim/api/context").then(function (context) {
      state.context = context;
      $("context-pill").textContent = "DeviceId: " + context.sessionId + " | SyncId: " + context.syncId;
      resetGeneratorForm();
    });
  }

  function loadManifest() {
    return request("/sim/api/manifest").then(function (manifest) {
      state.manifest = manifest;
      if (state.activeSample) {
        var refreshed = (manifest.samples || []).find(function (sample) { return sample.id === state.activeSample.id; });
        var currentLocale = state.activeLocaleKey;
        state.activeSample = null;
        if (refreshed) selectSample(refreshed.id, currentLocale);
      } else if (manifest.samples && manifest.samples.length) {
        var lastSelection = readLastSelection();
        var storedSample = (manifest.samples || []).find(function (sample) { return sample.id === lastSelection.templateId; });
        selectSample(storedSample ? storedSample.id : manifest.samples[0].id, storedSample ? lastSelection.locale : "");
      }
      renderTemplates();
      renderLocaleSelect();
      syncTemplateTools();
      refreshDefaultFields();
    }).catch(function (error) { toast(error.message); });
  }

  function init() {
    bind();
    loadContext()
      .then(loadManifest)
      .then(refreshGenerators)
      .then(refreshCommands)
      .then(renderDashboard)
      .catch(function (error) { toast(error.message); });
    window.setInterval(refreshCommands, 2500);
  }

  init();
})();
