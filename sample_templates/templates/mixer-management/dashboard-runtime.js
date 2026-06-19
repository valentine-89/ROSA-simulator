(function () {
  "use strict";

  var configNode = document.getElementById("mixer-config");
  var config = readJson(configNode && configNode.textContent) || {};
  var nodes = {
    eyebrow: document.getElementById("mixer-eyebrow"),
    title: document.getElementById("mixer-title"),
    subtitle: document.getElementById("mixer-subtitle"),
    refresh: document.getElementById("mixer-refresh"),
    live: document.getElementById("mixer-live"),
    kpis: document.getElementById("mixer-kpis"),
    machineCount: document.getElementById("mixer-machine-count"),
    machineList: document.getElementById("mixer-machine-list"),
    filterDistributor: document.getElementById("mixer-filter-distributor"),
    filterEntity: document.getElementById("mixer-filter-entity"),
    filterSearch: document.getElementById("mixer-filter-search"),
    filterClear: document.getElementById("mixer-filter-clear"),
    warningList: document.getElementById("mixer-warning-list"),
    warningCount: document.getElementById("mixer-warning-count"),
    adminForms: document.getElementById("mixer-admin-forms"),
    adminTables: document.getElementById("mixer-admin-tables"),
    adminTableState: document.getElementById("mixer-admin-table-state"),
    exportConfig: document.getElementById("mixer-export-config"),
    importConfig: document.getElementById("mixer-import-config"),
    importFile: document.getElementById("mixer-import-file"),
    distributorOptions: document.getElementById("mixer-distributor-options"),
    machineOptions: document.getElementById("mixer-machine-options"),
    staffOptions: document.getElementById("mixer-staff-options"),
    stageOptions: document.getElementById("mixer-stage-options"),
    menuOptions: document.getElementById("mixer-menu-options"),
    positionIoid: document.getElementById("mixer-position-ioid"),
    positionOffset: document.getElementById("mixer-position-offset"),
    loadPositions: document.getElementById("mixer-load-positions"),
    positionsResult: document.getElementById("mixer-positions-result"),
    stageIoid: document.getElementById("mixer-stage-ioid"),
    stageOffset: document.getElementById("mixer-stage-offset"),
    loadStages: document.getElementById("mixer-load-stages"),
    stagesResult: document.getElementById("mixer-stages-result"),
    menuIoid: document.getElementById("mixer-menu-ioid"),
    menuIndex: document.getElementById("mixer-menu-index"),
    loadMenu: document.getElementById("mixer-load-menu"),
    menuResult: document.getElementById("mixer-menu-result"),
    eventDataset: document.getElementById("mixer-event-dataset"),
    eventMachine: document.getElementById("mixer-event-machine"),
    eventType: document.getElementById("mixer-event-type"),
    eventLimit: document.getElementById("mixer-event-limit"),
    eventOffset: document.getElementById("mixer-event-offset"),
    eventLoad: document.getElementById("mixer-event-load"),
    eventPrev: document.getElementById("mixer-event-prev"),
    eventNext: document.getElementById("mixer-event-next"),
    eventBody: document.getElementById("mixer-event-body"),
    eventCount: document.getElementById("mixer-event-count"),
    contractBody: document.getElementById("mixer-contract-body"),
    toastStack: document.getElementById("mixer-toast-stack")
  };

  var stateRows = [];
  var byType = {};
  var warningRows = [];
  var displayLimits = {};
  var activeFilters = {
    distributor_id: "",
    entity: "all",
    search: ""
  };

  var contractRows = [
    ["mixer-io-get-positions", "Thiết bị đọc tổng vị trí, danh sách id nguyên liệu, vị trí và chi tiết 1 vị trí.", "Thiết bị"],
    ["mixer-io-get-positions-8", "Thiết bị đọc vị trí nguyên liệu theo tối đa 8 offset/vị trí một lần.", "Thiết bị"],
    ["mixer-io-get-allstages-8", "Thiết bị kiểm tra nguyên liệu theo tối đa 8 id một lần.", "Thiết bị"],
    ["mixer-io-query-menu", "Tra công thức theo tên gần đúng.", "Thiết bị"],
    ["mixer-io-query-menu-bynum", "Tra công thức theo index số.", "Thiết bị"],
    ["mixer-io-done", "Thiết bị báo xong đơn có order.", "Thiết bị"],
    ["mixer-io-done-noorder", "Thiết bị báo xong món chọn tại máy.", "Thiết bị"],
    ["mixer-io-cancel", "Thiết bị hủy đơn và lấy đơn chờ kế tiếp.", "Thiết bị"],
    ["mixer-io-update-consume", "Thiết bị cập nhật mảng tiêu hao nguyên liệu.", "Thiết bị"],
    ["mixer-admin-event-list", "Phân trang work, transaction và event.", "Admin"],
    ["mixer-admin-warning-list", "Kiểm tra cấu hình thiếu vị trí, trùng index hoặc thiếu định lượng.", "Admin"],
    ["mixer-admin-save-*", "CRUD admin cho máy, nhân viên, nguyên liệu, công thức, vị trí và link.", "Admin"],
    ["mixer-link-state", "Public /mixer đọc catalog, stack đơn và lịch sử theo context link.", "Public"],
    ["mixer-link-create-order", "Public /mixer tạo order, chống thao tác nhanh và trả payload secure command.", "Public"]
  ];

  var entityDefs = {
    distributor: {
      title: "Distributor",
      rowType: "distributor",
      saveMacro: "mixer-admin-save-distributor",
      keyFields: ["distributor_id"],
      fields: [
        { key: "distributor_id", label: "Distributor ID", required: true },
        { key: "name", label: "Tên", required: true },
        { key: "note", label: "Ghi chú", wide: true }
      ]
    },
    machine: {
      title: "Máy",
      rowType: "machine",
      saveMacro: "mixer-admin-save-machine",
      deleteMacro: "mixer-admin-delete-machine",
      deleteLabel: "Tắt",
      keyFields: ["machine_id"],
      fields: [
        { key: "machine_id", label: "Machine ID", required: true },
        { key: "distributor_id", label: "Distributor", list: "mixer-distributor-options", required: true },
        { key: "name", label: "Tên máy", required: true },
        { key: "ioid", label: "IoID", required: true },
        { key: "io_key", label: "Io key legacy" },
        { key: "realtime_url", label: "Realtime URL" },
        { key: "last_order_no", label: "Order cuối", type: "number" },
        { key: "enabled", label: "Bật", type: "checkbox" }
      ]
    },
    staff: {
      title: "Nhân viên",
      rowType: "staff",
      saveMacro: "mixer-admin-save-staff",
      deleteMacro: "mixer-admin-delete-staff",
      deleteLabel: "Tắt",
      keyFields: ["staff_id"],
      fields: [
        { key: "staff_id", label: "Staff ID", required: true },
        { key: "distributor_id", label: "Distributor", list: "mixer-distributor-options", required: true },
        { key: "name", label: "Tên", required: true },
        { key: "phone", label: "SĐT", required: true },
        { key: "balance", label: "Số dư", type: "number" },
        { key: "enabled", label: "Bật", type: "checkbox" }
      ]
    },
    stage: {
      title: "Nguyên liệu",
      rowType: "stage",
      saveMacro: "mixer-admin-save-stage",
      deleteMacro: "mixer-admin-delete-stage",
      deleteLabel: "Tắt",
      keyFields: ["distributor_id", "stage_id"],
      fields: [
        { key: "distributor_id", label: "Distributor", list: "mixer-distributor-options", required: true },
        { key: "stage_id", label: "ID nguyên liệu", type: "number", required: true },
        { key: "name", label: "Tên", required: true },
        { key: "unit", label: "Đơn vị" },
        { key: "video", label: "Video" },
        { key: "sort_order", label: "Thứ tự", type: "number" },
        { key: "enabled", label: "Bật", type: "checkbox" }
      ]
    },
    menu: {
      title: "Công thức",
      rowType: "menu",
      saveMacro: "mixer-admin-save-menu",
      deleteMacro: "mixer-admin-delete-menu",
      deleteLabel: "Tắt",
      keyFields: ["menu_id"],
      fields: [
        { key: "menu_id", label: "Menu ID", required: true },
        { key: "distributor_id", label: "Distributor", list: "mixer-distributor-options", required: true },
        { key: "name", label: "Tên món", required: true },
        { key: "catalog", label: "Nhóm" },
        { key: "menu_index", label: "Index", type: "number", required: true },
        { key: "price", label: "Giá", type: "number" },
        { key: "image_url", label: "Ảnh", wide: true },
        { key: "description", label: "Mô tả", wide: true },
        { key: "enabled", label: "Bật", type: "checkbox" }
      ]
    },
    ingredient: {
      title: "Định lượng",
      rowType: "ingredient",
      saveMacro: "mixer-admin-save-menu-ingredient",
      deleteMacro: "mixer-admin-delete-menu-ingredient",
      deleteLabel: "Xóa dòng",
      keyFields: ["menu_id", "stage_id"],
      fields: [
        { key: "menu_id", label: "Menu", list: "mixer-menu-options", required: true },
        { key: "stage_id", label: "Nguyên liệu", list: "mixer-stage-options", type: "number", required: true },
        { key: "quantity", label: "Định lượng", type: "number", required: true },
        { key: "sort_order", label: "Thứ tự", type: "number" }
      ]
    },
    position: {
      title: "Vị trí máy",
      rowType: "position",
      saveMacro: "mixer-admin-save-position",
      deleteMacro: "mixer-admin-delete-position",
      deleteLabel: "Xóa dòng",
      keyFields: ["machine_id", "position_number"],
      fields: [
        { key: "machine_id", label: "Máy", list: "mixer-machine-options", required: true },
        { key: "position_number", label: "Vị trí", type: "number", required: true },
        { key: "stage_id", label: "Nguyên liệu", list: "mixer-stage-options", type: "number", required: true },
        { key: "sort_order", label: "Thứ tự", type: "number" }
      ]
    },
    link: {
      title: "Link /mixer",
      rowType: "link",
      saveMacro: "mixer-admin-save-link",
      deleteMacro: "mixer-admin-delete-link",
      deleteLabel: "Tắt",
      keyFields: ["link_id"],
      fields: [
        { key: "link_id", label: "Link ID", required: true },
        { key: "distributor_id", label: "Distributor", list: "mixer-distributor-options", required: true },
        { key: "machine_id", label: "Máy", list: "mixer-machine-options", required: true },
        { key: "staff_id", label: "Nhân viên", list: "mixer-staff-options", required: true },
        { key: "page_id", label: "Page ID", required: true },
        { key: "title", label: "Tiêu đề" },
        { key: "enabled", label: "Bật", type: "checkbox" }
      ]
    }
  };

  var tableDefs = [
    { entity: "machine", title: "Máy", columns: [["machine_id", "ID"], ["name", "Tên"], ["ioid", "IoID"], ["position_count", "Vị trí"], ["enabled", "Bật"]] },
    { entity: "staff", title: "Nhân viên", columns: [["staff_id", "ID"], ["name", "Tên"], ["phone", "SĐT"], ["balance", "Số dư"], ["enabled", "Bật"]] },
    { entity: "stage", title: "Nguyên liệu", columns: [["stage_id", "ID"], ["name", "Tên"], ["unit", "Đơn vị"], ["video", "Video"], ["enabled", "Bật"]] },
    { entity: "menu", title: "Công thức", columns: [["menu_id", "ID"], ["menu_index", "Index"], ["name", "Tên"], ["catalog", "Nhóm"], ["price", "Giá"]] },
    { entity: "ingredient", title: "Định lượng", columns: [["menu_id", "Menu"], ["stage_id", "Nguyên liệu"], ["quantity", "Lượng"], ["sort_order", "Thứ tự"]] },
    { entity: "position", title: "Vị trí máy", columns: [["machine_id", "Máy"], ["position_number", "Vị trí"], ["stage_id", "Nguyên liệu"], ["stage_name", "Tên"], ["sort_order", "Thứ tự"]] },
    { entity: "link", title: "Link /mixer", columns: [["link_id", "ID"], ["machine_id", "Máy"], ["staff_id", "Nhân viên"], ["page_id", "Page"], ["enabled", "Bật"]] }
  ];

  function readJson(source) {
    try {
      return JSON.parse(String(source || "").trim() || "{}");
    } catch (error) {
      return {};
    }
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || String(fallback || "");
  }

  function numberValue(value, fallback, min, max) {
    var parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) parsed = fallback;
    if (Number.isFinite(Number(min))) parsed = Math.max(Number(min), parsed);
    if (Number.isFinite(Number(max))) parsed = Math.min(Number(max), parsed);
    return parsed;
  }

  function setLive(text, state) {
    if (!nodes.live) return;
    nodes.live.textContent = text;
    nodes.live.setAttribute("data-state", state || "idle");
  }

  function toast(message, kind) {
    if (!nodes.toastStack) return;
    var item = document.createElement("div");
    item.className = "mixer-toast";
    item.setAttribute("data-kind", kind || "info");
    item.textContent = message;
    nodes.toastStack.appendChild(item);
    window.setTimeout(function () {
      item.remove();
    }, 4200);
  }

  function buildIoDataUrl() {
    var databaseSessionId = safeText(config.databaseSessionId, "");
    var syncId = safeText(config.syncId, "");
    if (!databaseSessionId || !syncId) return "";
    return "/api/" + encodeURIComponent(databaseSessionId) + "/" + encodeURIComponent(syncId) + "/iodata";
  }

  function postMacro(payload) {
    var url = buildIoDataUrl();
    if (!url) return Promise.reject(new Error("Thiếu cấu hình databaseSessionId/syncId."));
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) {
          throw new Error(data && data.error ? data.error : "Không thể chạy macro.");
        }
        if (Array.isArray(data)) return data;
        return data && Array.isArray(data.rows) ? data.rows : [];
      });
    });
  }

  function formatRows(rows) {
    return JSON.stringify(rows && rows.length === 1 ? rows[0] : rows, null, 2);
  }

  function macroName(kind, entity) {
    var source = kind === "delete" ? config.deleteMacros : config.saveMacros;
    var fallback = entityDefs[entity] && (kind === "delete" ? entityDefs[entity].deleteMacro : entityDefs[entity].saveMacro);
    return safeText(source && source[entity], fallback);
  }

  function rowsOf(type) {
    return byType[type] || [];
  }

  function distributorName(distributorId) {
    var id = safeText(distributorId, "");
    var row = rowsOf("distributor").filter(function (item) {
      return safeText(item.distributor_id, "") === id;
    })[0];
    return safeText(row && row.name, id || "Không rõ distributor");
  }

  function rowSearchText(row) {
    return Object.keys(row || {}).map(function (key) {
      return safeText(row[key], "");
    }).join(" ").toLowerCase() + " " + distributorName(row && row.distributor_id).toLowerCase();
  }

  function rowMatchesActiveFilters(entity, row, ignoreEntity) {
    if (activeFilters.distributor_id && safeText(row.distributor_id, "") !== activeFilters.distributor_id) return false;
    if (activeFilters.search && rowSearchText(row).indexOf(activeFilters.search.toLowerCase()) < 0) return false;
    return ignoreEntity || !entity || activeFilters.entity === "all" || activeFilters.entity === entity;
  }

  function filteredRows(entity, ignoreEntity) {
    var def = entityDefs[entity];
    if (!def) return [];
    return rowsOf(def.rowType).filter(function (row) {
      return rowMatchesActiveFilters(entity, row, ignoreEntity);
    });
  }

  function firstDistributorId() {
    var row = activeFilters.distributor_id ? { distributor_id: activeFilters.distributor_id } : (rowsOf("distributor")[0] || {});
    return safeText(row.distributor_id, "DIST-DEMO");
  }

  function firstMachineIoid() {
    var row = (activeFilters.distributor_id ? filteredRows("machine", true)[0] : rowsOf("machine")[0]) || {};
    return safeText(row.ioid, safeText(config.defaultIoid, ""));
  }

  function renderContract() {
    if (!nodes.contractBody) return;
    nodes.contractBody.innerHTML = contractRows.map(function (row) {
      return "<tr><td><strong>" + esc(row[0]) + "</strong></td><td>" + esc(row[1]) + "</td><td>" + esc(row[2]) + "</td></tr>";
    }).join("");
  }

  function renderFilterControls() {
    if (nodes.filterDistributor) {
      var distributorOptions = '<option value="">Tất cả distributor</option>' + rowsOf("distributor").map(function (row) {
        var id = safeText(row.distributor_id, "");
        return '<option value="' + esc(id) + '">' + esc(safeText(row.name, id)) + '</option>';
      }).join("");
      nodes.filterDistributor.innerHTML = distributorOptions;
      nodes.filterDistributor.value = activeFilters.distributor_id;
    }
    if (nodes.filterEntity) {
      var entityOptions = '<option value="all">Tất cả bảng</option>' + tableDefs.map(function (tableDef) {
        return '<option value="' + esc(tableDef.entity) + '">' + esc(tableDef.title) + '</option>';
      }).join("");
      nodes.filterEntity.innerHTML = entityOptions;
      nodes.filterEntity.value = activeFilters.entity;
    }
    if (nodes.filterSearch && nodes.filterSearch.value !== activeFilters.search) {
      nodes.filterSearch.value = activeFilters.search;
    }
  }

  function renderAdminForms() {
    if (!nodes.adminForms) return;
    nodes.adminForms.innerHTML = Object.keys(entityDefs).map(function (entity) {
      var def = entityDefs[entity];
      var fieldsHtml = def.fields.map(function (field) {
        var inputType = field.type === "checkbox" ? "checkbox" : field.type === "number" ? "number" : "text";
        var attrs = [
          'class="mixer-input"',
          'data-entity="' + esc(entity) + '"',
          'data-field="' + esc(field.key) + '"',
          'type="' + inputType + '"'
        ];
        if (field.list) attrs.push('list="' + esc(field.list) + '"');
        if (field.required) attrs.push("required");
        if (inputType === "number") attrs.push('step="any"');
        return '<label data-wide="' + (field.wide ? "true" : "false") + '">' + esc(field.label) +
          '<input ' + attrs.join(" ") + ' /></label>';
      }).join("");
      return '<form class="mixer-editor-card" data-editor="' + esc(entity) + '">' +
        '<h3>' + esc(def.title) + '</h3>' +
        '<div class="mixer-editor-grid">' + fieldsHtml + '</div>' +
        '<div class="mixer-editor-actions">' +
          '<button class="mixer-button" type="submit" data-save-entity="' + esc(entity) + '">Lưu</button>' +
          (def.deleteMacro ? '<button class="mixer-inline-button" type="button" data-delete-entity="' + esc(entity) + '">' + esc(def.deleteLabel || "Xóa") + '</button>' : '') +
          '<button class="mixer-inline-button" type="button" data-clear-entity="' + esc(entity) + '">Mới</button>' +
        '</div>' +
      '</form>';
    }).join("");
  }

  function optionHtml(rows, valueKey, labelFactory) {
    return rows.map(function (row) {
      var value = safeText(row[valueKey], "");
      var label = typeof labelFactory === "function" ? labelFactory(row, value) : safeText(row[labelFactory], value);
      return '<option value="' + esc(value) + '">' + esc(label) + '</option>';
    }).join("");
  }

  function renderDatalists() {
    if (nodes.distributorOptions) nodes.distributorOptions.innerHTML = optionHtml(rowsOf("distributor"), "distributor_id", function (row, value) {
      return safeText(row.name, value) + " - " + value;
    });
    if (nodes.machineOptions) nodes.machineOptions.innerHTML = optionHtml(rowsOf("machine"), "machine_id", function (row, value) {
      return safeText(row.name, value) + " - " + safeText(row.ioid, "") + " - " + distributorName(row.distributor_id);
    });
    if (nodes.staffOptions) nodes.staffOptions.innerHTML = optionHtml(rowsOf("staff"), "staff_id", function (row, value) {
      return safeText(row.name, value) + " - " + safeText(row.phone, "") + " - " + distributorName(row.distributor_id);
    });
    if (nodes.stageOptions) nodes.stageOptions.innerHTML = rowsOf("stage").map(function (row) {
      return '<option value="' + esc(row.stage_id) + '">' + esc(safeText(row.stage_id, "") + " · " + safeText(row.name, row.stage_id) + " · " + distributorName(row.distributor_id)) + '</option>';
    }).join("");
    if (nodes.menuOptions) nodes.menuOptions.innerHTML = optionHtml(rowsOf("menu"), "menu_id", function (row, value) {
      return safeText(row.name, value) + " - #" + safeText(row.menu_index, "") + " - " + distributorName(row.distributor_id);
    });
  }

  function defaultFor(entity, key) {
    if (key === "distributor_id") return firstDistributorId();
    if (key === "ioid") return safeText(config.defaultIoid, firstMachineIoid());
    if (key === "enabled") return "1";
    if (key === "last_order_no" || key === "balance" || key === "sort_order" || key === "price") return "0";
    if (key === "page_id") return "mixer-link-" + String(Date.now()).slice(-6);
    if (key === "title" && entity === "link") return "Mixer link";
    return "";
  }

  function inputFor(entity, key) {
    return nodes.adminForms && nodes.adminForms.querySelector('[data-entity="' + entity + '"][data-field="' + key + '"]');
  }

  function clearForm(entity) {
    var def = entityDefs[entity];
    if (!def) return;
    def.fields.forEach(function (field) {
      var input = inputFor(entity, field.key);
      if (!input) return;
      if (field.type === "checkbox") {
        input.checked = defaultFor(entity, field.key) !== "0";
      } else {
        input.value = defaultFor(entity, field.key);
      }
    });
  }

  function fillForm(entity, row) {
    var def = entityDefs[entity];
    if (!def) return;
    def.fields.forEach(function (field) {
      var input = inputFor(entity, field.key);
      if (!input) return;
      var value = row && Object.prototype.hasOwnProperty.call(row, field.key) ? row[field.key] : defaultFor(entity, field.key);
      if (field.type === "checkbox") {
        input.checked = Number(value) !== 0 && safeText(value, "1") !== "false";
      } else {
        input.value = safeText(value, defaultFor(entity, field.key));
      }
    });
  }

  function collectForm(entity) {
    var def = entityDefs[entity];
    var payload = {};
    if (!def) return payload;
    def.fields.forEach(function (field) {
      var input = inputFor(entity, field.key);
      if (!input) return;
      if (field.type === "checkbox") {
        payload[field.key] = input.checked ? "1" : "0";
      } else {
        payload[field.key] = input.value;
      }
    });
    return payload;
  }

  function rowMatches(entity, row, keys) {
    var def = entityDefs[entity];
    return def && def.keyFields.every(function (key) {
      return safeText(row[key], "") === safeText(keys[key], "");
    });
  }

  function findEntityRow(entity, keys) {
    var def = entityDefs[entity];
    if (!def) return null;
    return rowsOf(def.rowType).filter(function (row) {
      return rowMatches(entity, row, keys);
    })[0] || null;
  }

  function saveEntity(entity) {
    var macro = macroName("save", entity);
    var payload = collectForm(entity);
    if (!macro) return Promise.reject(new Error("Thiếu macro lưu " + entity + "."));
    payload.macro = macro;
    setLive("Đang lưu", "loading");
    return postMacro(payload).then(function (rows) {
      setLive("Đã lưu", "idle");
      toast((rows[0] && (rows[0].code || rows[0].c1)) || "OK");
      return loadState();
    }).catch(function (error) {
      setLive("Lỗi", "error");
      toast(error.message || "Không thể lưu.", "error");
    });
  }

  function deleteEntity(entity) {
    var def = entityDefs[entity] || {};
    var macro = macroName("delete", entity);
    var payload = collectForm(entity);
    if (!macro) return Promise.reject(new Error("Thiếu macro xóa " + entity + "."));
    var action = def.deleteLabel || "Xóa";
    var target = (def.keyFields || []).map(function (key) {
      return safeText(payload[key], "");
    }).filter(Boolean).join(" / ");
    if (!window.confirm(action + " " + (def.title || entity) + (target ? " (" + target + ")" : "") + "?")) {
      return Promise.resolve();
    }
    payload.macro = macro;
    setLive("Đang xóa", "loading");
    return postMacro(payload).then(function (rows) {
      setLive("Đã xóa", "idle");
      toast((rows[0] && (rows[0].code || rows[0].c1)) || "OK");
      return loadState();
    }).catch(function (error) {
      setLive("Lỗi", "error");
      toast(error.message || "Không thể xóa.", "error");
    });
  }

  function tableKeyAttrs(entity, row) {
    var def = entityDefs[entity];
    if (!def) return "";
    return def.keyFields.map(function (key) {
      return ' data-key-' + key.replace(/_/g, "-") + '="' + esc(row[key]) + '"';
    }).join("");
  }

  function renderTableBlock(tableDef) {
    var rows = filteredRows(tableDef.entity);
    var totalRows = rowsOf(entityDefs[tableDef.entity].rowType).length;
    var limit = displayLimits[tableDef.entity] || 80;
    var visibleRows = rows.slice(0, limit);
    var header = tableDef.columns.map(function (column) {
      return "<th>" + esc(column[1]) + "</th>";
    }).join("") + "<th></th>";
    var body = visibleRows.map(function (row) {
      var cells = tableDef.columns.map(function (column) {
        return "<td>" + esc(row[column[0]]) + "</td>";
      }).join("");
      return "<tr>" + cells + '<td><button class="mixer-inline-button" type="button" data-edit-entity="' + esc(tableDef.entity) + '"' + tableKeyAttrs(tableDef.entity, row) + ">Sửa</button></td></tr>";
    }).join("") || '<tr><td colspan="' + (tableDef.columns.length + 1) + '">Chưa có dữ liệu.</td></tr>';
    var countLabel = rows.length === totalRows ? rows.length + " dòng" : rows.length + "/" + totalRows + " dòng";
    var footer = '<div class="mixer-data-foot"><span>Đang xem ' + esc(Math.min(visibleRows.length, rows.length)) + '/' + esc(rows.length) + ' dòng phù hợp.</span>' +
      (rows.length > visibleRows.length ? '<button class="mixer-inline-button" type="button" data-load-more-entity="' + esc(tableDef.entity) + '">Xem thêm</button>' : '') +
      '</div>';
    return '<div class="mixer-data-block"><h3>' + esc(tableDef.title) + ' (' + esc(countLabel) + ')</h3>' +
      '<div class="mixer-table-wrap"><table class="mixer-mini-table"><thead><tr>' + header + '</tr></thead><tbody>' + body + '</tbody></table></div>' + footer + '</div>';
  }

  function renderAdminTables() {
    if (!nodes.adminTables) return;
    nodes.adminTables.innerHTML = tableDefs.filter(function (tableDef) {
      return activeFilters.entity === "all" || activeFilters.entity === tableDef.entity;
    }).map(renderTableBlock).join("");
    if (nodes.adminTableState) {
      nodes.adminTableState.textContent = "Đã tải " + stateRows.length + " dòng cấu hình. Bộ lọc đang áp dụng trên trình duyệt.";
    }
  }

  function renderState(rows) {
    stateRows = Array.isArray(rows) ? rows : [];
    byType = {};
    stateRows.forEach(function (row) {
      var type = safeText(row.row_type, "unknown");
      if (!byType[type]) byType[type] = [];
      byType[type].push(row);
    });
    var counts = {};
    Object.keys(byType).forEach(function (key) { counts[key] = byType[key].length; });
    var machines = filteredRows("machine", true);
    var totalMachines = rowsOf("machine").length;
    var site = rowsOf("distributor")[0] || {};

    if (nodes.kpis) {
      nodes.kpis.innerHTML = [
        ["Máy", counts.machine || 0],
        ["Nguyên liệu", counts.stage || 0],
        ["Công thức", counts.menu || 0],
        ["Link mixer", counts.link || 0]
      ].map(function (item) {
        return '<div class="mixer-kpi"><span>' + esc(item[0]) + '</span><strong>' + esc(item[1]) + '</strong></div>';
      }).join("");
    }

    if (nodes.machineCount) nodes.machineCount.textContent = machines.length === totalMachines ? String(machines.length) + " máy" : machines.length + "/" + totalMachines + " máy";
    if (nodes.machineList) {
      nodes.machineList.innerHTML = machines.map(function (machine) {
        return '<div class="mixer-machine">' +
          '<div><strong>' + esc(machine.name || machine.machine_name || machine.machine_id) + '</strong>' +
          '<span>IoID: ' + esc(machine.ioid || "") + '</span><br />' +
          '<small>Vị trí: ' + esc(machine.position_count || 0) + ', đơn cuối: ' + esc(machine.last_order_no || 0) + '</small></div>' +
          '<div class="mixer-badge">' + esc(machine.machine_id || "") + '</div>' +
        '</div>';
      }).join("") || '<div class="mixer-machine"><div><strong>Chưa có máy</strong><span>Kiểm tra sample database.</span></div></div>';
    }

    var defaultIoid = firstMachineIoid();
    [nodes.positionIoid, nodes.stageIoid, nodes.menuIoid].forEach(function (input) {
      if (input && !input.value) input.value = defaultIoid;
    });

    if (site.name && nodes.subtitle) {
      nodes.subtitle.textContent = safeText(config.subtitle, "") + " Distributor mẫu: " + site.name + ".";
    }

    renderFilterControls();
    renderDatalists();
    Object.keys(entityDefs).forEach(function (entity) {
      var def = entityDefs[entity];
      if (!rowsOf(def.rowType).length) clearForm(entity);
    });
    renderAdminTables();
  }

  function loadState() {
    setLive("Đang tải", "loading");
    return postMacro({ macro: safeText(config.stateMacro, "mixer-admin-state") })
      .then(function (rows) {
        renderState(rows);
        setLive("Đã tải", "idle");
      })
      .catch(function (error) {
        setLive("Lỗi", "error");
        toast(error.message || "Không thể tải dữ liệu.", "error");
      });
  }

  function renderWarnings(rows) {
    warningRows = Array.isArray(rows) ? rows : [];
    if (nodes.warningCount) {
      nodes.warningCount.textContent = warningRows.length ? warningRows.length + " cảnh báo cần xem" : "Không có cảnh báo";
    }
    if (!nodes.warningList) return;
    nodes.warningList.innerHTML = warningRows.map(function (row) {
      var severity = safeText(row.severity, "warning");
      var distributor = safeText(row.distributor_id, "") ? distributorName(row.distributor_id) : "";
      var refs = [
        distributor,
        safeText(row.machine_id, ""),
        safeText(row.link_id, ""),
        safeText(row.menu_id, ""),
        safeText(row.work_id, "")
      ].filter(Boolean).join(" · ");
      return '<div class="mixer-warning-item" data-severity="' + esc(severity) + '">' +
        '<div class="mixer-warning-mark">' + esc(severity === "error" ? "Lỗi" : "Cảnh báo") + '</div>' +
        '<div><strong class="mixer-warning-title">' + esc(row.title || row.code || "Cấu hình cần kiểm tra") + '</strong>' +
        '<span class="mixer-warning-detail">' + esc(row.detail || "") + (refs ? '<br />' + esc(refs) : '') + '</span></div>' +
      '</div>';
    }).join("") || '<div class="mixer-warning-item"><div class="mixer-warning-mark">OK</div><div><strong class="mixer-warning-title">Cấu hình mẫu đang sạch</strong><span class="mixer-warning-detail">Không phát hiện orphan work, trùng menu index, menu thiếu định lượng hoặc link gắn máy chưa có vị trí.</span></div></div>';
  }

  function loadWarnings() {
    return postMacro({ macro: safeText(config.warningMacro, "mixer-admin-warning-list") })
      .then(renderWarnings)
      .catch(function (error) {
        if (nodes.warningCount) nodes.warningCount.textContent = "Không kiểm tra được";
        if (nodes.warningList) nodes.warningList.innerHTML = '<div class="mixer-warning-item" data-severity="error"><div class="mixer-warning-mark">Lỗi</div><div><strong class="mixer-warning-title">Không tải được cảnh báo</strong><span class="mixer-warning-detail">' + esc(error.message || "Macro cảnh báo chưa khả dụng.") + '</span></div></div>';
      });
  }

  function batchValues(start) {
    var first = numberValue(start, 1, 1, 9999);
    var payload = {};
    for (var i = 0; i < 8; i += 1) payload["c" + (i + 2)] = first + i;
    return payload;
  }

  function readPositions() {
    var payload = batchValues(nodes.positionOffset && nodes.positionOffset.value);
    payload.macro = safeText(config.positionsMacro, "mixer-io-get-positions-8");
    payload.c1 = safeText(nodes.positionIoid && nodes.positionIoid.value, safeText(config.defaultIoid, ""));
    nodes.positionsResult.textContent = "Đang đọc...";
    return postMacro(payload).then(function (rows) {
      nodes.positionsResult.textContent = formatRows(rows);
    }).catch(function (error) {
      nodes.positionsResult.textContent = error.message || "Lỗi đọc vị trí.";
      toast(nodes.positionsResult.textContent, "error");
    });
  }

  function readStages() {
    var payload = batchValues(nodes.stageOffset && nodes.stageOffset.value);
    payload.macro = safeText(config.stagesMacro, "mixer-io-get-allstages-8");
    payload.c1 = safeText(nodes.stageIoid && nodes.stageIoid.value, safeText(config.defaultIoid, ""));
    nodes.stagesResult.textContent = "Đang đọc...";
    return postMacro(payload).then(function (rows) {
      nodes.stagesResult.textContent = formatRows(rows);
    }).catch(function (error) {
      nodes.stagesResult.textContent = error.message || "Lỗi đọc nguyên liệu.";
      toast(nodes.stagesResult.textContent, "error");
    });
  }

  function readMenu() {
    var payload = {
      macro: safeText(config.menuByNumberMacro, "mixer-io-query-menu-bynum"),
      c1: safeText(nodes.menuIoid && nodes.menuIoid.value, safeText(config.defaultIoid, "")),
      c2: numberValue(nodes.menuIndex && nodes.menuIndex.value, 1, 1, 9999)
    };
    nodes.menuResult.textContent = "Đang đọc...";
    return postMacro(payload).then(function (rows) {
      nodes.menuResult.textContent = formatRows(rows);
    }).catch(function (error) {
      nodes.menuResult.textContent = error.message || "Lỗi tra công thức.";
      toast(nodes.menuResult.textContent, "error");
    });
  }

  function exportConfigJson() {
    var payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      distributors: rowsOf("distributor"),
      machines: rowsOf("machine"),
      staff: rowsOf("staff"),
      stages: rowsOf("stage"),
      menus: rowsOf("menu"),
      menu_ingredients: rowsOf("ingredient"),
      positions: rowsOf("position"),
      links: rowsOf("link")
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "mixer-config.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function saveImportedRows(entity, rows) {
    rows = Array.isArray(rows) ? rows : [];
    return rows.reduce(function (chain, row) {
      return chain.then(function () {
        var payload = Object.assign({}, row || {});
        payload.macro = macroName("save", entity);
        return postMacro(payload);
      });
    }, Promise.resolve());
  }

  function importConfigJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var payload = readJson(reader.result);
      setLive("Đang import", "loading");
      Promise.resolve()
        .then(function () { return saveImportedRows("distributor", payload.distributors); })
        .then(function () { return saveImportedRows("machine", payload.machines); })
        .then(function () { return saveImportedRows("staff", payload.staff); })
        .then(function () { return saveImportedRows("stage", payload.stages); })
        .then(function () { return saveImportedRows("menu", payload.menus); })
        .then(function () { return saveImportedRows("ingredient", payload.menu_ingredients || payload.ingredients); })
        .then(function () { return saveImportedRows("position", payload.positions); })
        .then(function () { return saveImportedRows("link", payload.links); })
        .then(loadState)
        .then(function () {
          setLive("Đã import", "idle");
          toast("Đã import JSON.");
        })
        .catch(function (error) {
          setLive("Lỗi", "error");
          toast(error.message || "Không thể import JSON.", "error");
        });
    };
    reader.readAsText(file);
  }

  function formatTs(value) {
    var ts = Number(value);
    if (!Number.isFinite(ts) || ts <= 0) return "";
    try {
      return new Date(ts).toLocaleString("vi-VN");
    } catch (error) {
      return String(value);
    }
  }

  function loadEvents() {
    var payload = {
      macro: safeText(config.eventMacro, "mixer-admin-event-list"),
      dataset: safeText(nodes.eventDataset && nodes.eventDataset.value, "events"),
      machine_id: safeText(nodes.eventMachine && nodes.eventMachine.value, ""),
      event_type: safeText(nodes.eventType && nodes.eventType.value, ""),
      limit: numberValue(nodes.eventLimit && nodes.eventLimit.value, 50, 1, 500),
      offset: numberValue(nodes.eventOffset && nodes.eventOffset.value, 0, 0, 1000000)
    };
    return postMacro(payload).then(function (rows) {
      rows = (rows || []).filter(function (row) {
        return row && (row.row_type || row.ts || row.machine_id || row.event_type || row.order_no || row.detail || row.content);
      });
      if (nodes.eventCount) nodes.eventCount.textContent = rows.length + " dòng";
      if (!nodes.eventBody) return;
      nodes.eventBody.innerHTML = rows.map(function (row) {
        return "<tr>" +
          "<td>" + esc(formatTs(row.ts)) + "</td>" +
          "<td>" + esc(row.row_type || row.event_type || row.status || "") + "</td>" +
          "<td>" + esc(row.machine_id || "") + "</td>" +
          "<td>" + esc(row.order_no || "") + "</td>" +
          "<td>" + esc(row.staff_name || row.staff_id || "") + "</td>" +
          "<td>" + esc(row.detail || row.content || row.menu_name || "") + "</td>" +
        "</tr>";
      }).join("") || '<tr><td colspan="6">Không có dữ liệu.</td></tr>';
    }).catch(function (error) {
      toast(error.message || "Không thể tải log.", "error");
    });
  }

  function shiftEventOffset(delta) {
    if (!nodes.eventOffset || !nodes.eventLimit) return;
    var limit = numberValue(nodes.eventLimit.value, 50, 1, 500);
    var current = numberValue(nodes.eventOffset.value, 0, 0, 1000000);
    nodes.eventOffset.value = String(Math.max(0, current + delta * limit));
    loadEvents();
  }

  function bindAdminEvents() {
    if (!nodes.adminForms) return;
    nodes.adminForms.addEventListener("submit", function (event) {
      event.preventDefault();
      var form = event.target && event.target.closest("[data-editor]");
      if (!form) return;
      saveEntity(form.getAttribute("data-editor"));
    });
    nodes.adminForms.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.getAttribute) return;
      var clearEntity = target.getAttribute("data-clear-entity");
      var deleteEntityName = target.getAttribute("data-delete-entity");
      if (clearEntity) clearForm(clearEntity);
      if (deleteEntityName) deleteEntity(deleteEntityName);
    });
    if (nodes.adminTables) {
      nodes.adminTables.addEventListener("click", function (event) {
        var moreButton = event.target && event.target.closest("[data-load-more-entity]");
        if (moreButton) {
          var moreEntity = moreButton.getAttribute("data-load-more-entity");
          displayLimits[moreEntity] = (displayLimits[moreEntity] || 80) + 80;
          renderAdminTables();
          return;
        }
        var button = event.target && event.target.closest("[data-edit-entity]");
        if (!button) return;
        var entity = button.getAttribute("data-edit-entity");
        var def = entityDefs[entity];
        var keys = {};
        (def.keyFields || []).forEach(function (key) {
          keys[key] = button.getAttribute("data-key-" + key.replace(/_/g, "-")) || "";
        });
        var row = findEntityRow(entity, keys);
        if (row) fillForm(entity, row);
      });
    }
  }

  function bindFilters() {
    function applyFilters() {
      activeFilters.distributor_id = safeText(nodes.filterDistributor && nodes.filterDistributor.value, "");
      activeFilters.entity = safeText(nodes.filterEntity && nodes.filterEntity.value, "all");
      activeFilters.search = safeText(nodes.filterSearch && nodes.filterSearch.value, "").toLowerCase();
      displayLimits = {};
      renderState(stateRows);
    }
    if (nodes.filterDistributor) nodes.filterDistributor.addEventListener("change", applyFilters);
    if (nodes.filterEntity) nodes.filterEntity.addEventListener("change", applyFilters);
    if (nodes.filterSearch) nodes.filterSearch.addEventListener("input", applyFilters);
    if (nodes.filterClear) nodes.filterClear.addEventListener("click", function () {
      activeFilters = { distributor_id: "", entity: "all", search: "" };
      if (nodes.filterDistributor) nodes.filterDistributor.value = "";
      if (nodes.filterEntity) nodes.filterEntity.value = "all";
      if (nodes.filterSearch) nodes.filterSearch.value = "";
      displayLimits = {};
      renderState(stateRows);
    });
  }

  function bindThemePicker() {
    var picker = document.getElementById("theme-picker");
    var toggle = document.getElementById("theme-picker-toggle");
    if (!picker || !toggle) return;
    toggle.addEventListener("click", function () {
      var open = picker.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    Array.prototype.forEach.call(picker.querySelectorAll("[data-theme-option]"), function (button) {
      button.addEventListener("click", function () {
        var theme = button.getAttribute("data-theme-option") || "";
        document.documentElement.setAttribute("data-theme", theme);
        try { window.localStorage.setItem("sample-dashboard-theme", theme); } catch (error) {}
        picker.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  function init() {
    if (nodes.eyebrow) nodes.eyebrow.textContent = safeText(config.eyebrow, "ROSA Mixer Manager");
    if (nodes.title) nodes.title.textContent = safeText(config.title, "Quản lý máy pha chế");
    if (nodes.subtitle) nodes.subtitle.textContent = safeText(config.subtitle, "Quản lý máy pha chế, công thức, link public và API thiết bị theo batch.");
    renderContract();
    renderAdminForms();
    Object.keys(entityDefs).forEach(clearForm);
    bindAdminEvents();
    bindFilters();
    bindThemePicker();
    if (nodes.refresh) nodes.refresh.addEventListener("click", function () { loadState().then(loadWarnings).then(loadEvents); });
    if (nodes.loadPositions) nodes.loadPositions.addEventListener("click", readPositions);
    if (nodes.loadStages) nodes.loadStages.addEventListener("click", readStages);
    if (nodes.loadMenu) nodes.loadMenu.addEventListener("click", readMenu);
    if (nodes.exportConfig) nodes.exportConfig.addEventListener("click", exportConfigJson);
    if (nodes.importConfig) nodes.importConfig.addEventListener("click", function () { if (nodes.importFile) nodes.importFile.click(); });
    if (nodes.importFile) nodes.importFile.addEventListener("change", function () { importConfigJson(nodes.importFile.files && nodes.importFile.files[0]); nodes.importFile.value = ""; });
    if (nodes.eventLoad) nodes.eventLoad.addEventListener("click", loadEvents);
    if (nodes.eventPrev) nodes.eventPrev.addEventListener("click", function () { shiftEventOffset(-1); });
    if (nodes.eventNext) nodes.eventNext.addEventListener("click", function () { shiftEventOffset(1); });
    loadState().then(loadWarnings).then(function () {
      readPositions();
      readStages();
      readMenu();
      loadEvents();
    });
  }

  init();
})();
