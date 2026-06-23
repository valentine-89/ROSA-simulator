(function () {
  "use strict";

  var configNode = document.getElementById("retail-chain-config");
  var cfg = {
    title: "Retail Chain",
    subtitle: "Điều hành bán hàng, tồn kho và thiết bị",
    eyebrow: "ROSA Retail",
    databaseSessionId: "",
    syncId: "",
    defaultView: "overview",
    storeId: "",
    pageSize: 80,
    stream: { enabled: true, cooldownMs: 1800 },
    macros: {
      overview: "retail-admin-overview",
      machines: "retail-admin-machines",
      inventory: "retail-admin-inventory",
      sales: "retail-admin-sales",
      users: "retail-admin-users",
      links: "retail-admin-links",
      saveProduct: "retail-admin-save-product",
      adjustStock: "retail-admin-adjust-stock",
      saveMachine: "retail-admin-save-machine",
      saveUser: "retail-admin-save-user",
      saveLink: "retail-admin-save-link",
      orderStatus: "retail-admin-order-status"
    }
  };

  try {
    cfg = mergeDeep(cfg, JSON.parse(configNode && configNode.textContent ? configNode.textContent : "{}"));
  } catch (error) {
    console.error("Invalid retail-chain config", error);
  }

  var query = new URLSearchParams(window.location.search);
  var sessionId = normalizeToken(query.get("sessionId") || query.get("sessionid") || cfg.databaseSessionId || "");
  var syncId = normalizeToken(query.get("syncId") || query.get("syncid") || cfg.syncId || "");
  var requestedView = normalizeView(query.get("view") || cfg.defaultView);
  var state = {
    view: requestedView,
    loading: false,
    selectedMachineId: "",
    filters: { search: "", category: "", store: cfg.storeId || "", status: "" },
    data: { overview: [], machines: [], inventory: [], sales: [], users: [], links: [] },
    eventSource: null,
    refreshTimer: null,
    refreshQueued: false
  };

  var root = document.getElementById("retail-chain-root");
  if (!root) return;
  buildShell();

  var nodes = {
    title: document.getElementById("rt-page-title"),
    subtitle: document.getElementById("rt-page-subtitle"),
    status: document.getElementById("rt-live-status"),
    refresh: document.getElementById("rt-refresh"),
    content: document.getElementById("rt-content"),
    modal: document.getElementById("rt-modal"),
    modalTitle: document.getElementById("rt-modal-title"),
    modalBody: document.getElementById("rt-modal-body"),
    modalSubmit: document.getElementById("rt-modal-submit"),
    modalClose: document.getElementById("rt-modal-close"),
    modalCancel: document.getElementById("rt-modal-cancel"),
    toastStack: document.getElementById("rt-toast-stack")
  };

  bindShell();
  activateView(state.view, false);
  connectStream();

  function mergeDeep(base, extra) {
    var output = Object.assign({}, base || {});
    Object.keys(extra || {}).forEach(function (key) {
      if (extra[key] && typeof extra[key] === "object" && !Array.isArray(extra[key]) && base && typeof base[key] === "object") {
        output[key] = mergeDeep(base[key], extra[key]);
      } else {
        output[key] = extra[key];
      }
    });
    return output;
  }

  function normalizeToken(value) {
    var text = String(value || "").trim();
    return text.indexOf("<<") >= 0 ? "" : text;
  }

  function normalizeView(value) {
    var valid = ["overview", "machines", "inventory", "sales", "links", "users"];
    var text = String(value || "overview").toLowerCase();
    return valid.indexOf(text) >= 0 ? text : "overview";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function asNumber(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function money(value) {
    return asNumber(value).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + "đ";
  }

  function number(value) {
    return asNumber(value).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  }

  function dateTime(value) {
    var ts = asNumber(value);
    if (!ts) return "—";
    try { return new Date(ts).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }); }
    catch (error) { return "—"; }
  }

  function shortDate(value) {
    var ts = asNumber(value);
    if (!ts) return "";
    try { return new Date(ts).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }); }
    catch (error) { return ""; }
  }

  function safeImage(value) {
    var text = String(value || "").trim();
    return /^https?:\/\//i.test(text) || /^\/sample_templates\//.test(text) ? text : "";
  }

  function json(value, fallback) {
    try { return JSON.parse(String(value || "")); } catch (error) { return fallback || {}; }
  }

  function buildShell() {
    root.innerHTML = '' +
      '<div class="rt-app">' +
        '<aside class="rt-sidebar">' +
          '<div class="rt-brand"><div class="rt-brand-mark">RC</div><div><strong>' + esc(cfg.title) + '</strong><span>' + esc(cfg.eyebrow) + '</span></div></div>' +
          '<nav class="rt-nav" aria-label="Điều hướng retail">' + navButtons(false) + '</nav>' +
          '<div class="rt-sidebar-foot">SQLite theo IOID<br><span id="rt-database-label">' + esc(sessionId || "Chưa gắn thiết bị") + '</span></div>' +
        '</aside>' +
        '<main class="rt-main">' +
          '<header class="rt-topbar">' +
            '<div class="rt-title-block"><h1 id="rt-page-title"></h1><p id="rt-page-subtitle"></p></div>' +
            '<div class="rt-toolbar"><span class="rt-status" id="rt-live-status" data-state="loading">Đang tải</span><button class="rt-icon-button" id="rt-refresh" type="button" title="Tải lại" aria-label="Tải lại">↻</button></div>' +
          '</header>' +
          '<nav class="rt-mobile-nav" aria-label="Điều hướng retail mobile">' + navButtons(true) + '</nav>' +
          '<div class="rt-content" id="rt-content"></div>' +
        '</main>' +
      '</div>' +
      '<div class="rt-modal" id="rt-modal" hidden><form class="rt-modal-card" id="rt-modal-form"><div class="rt-modal-head"><h2 id="rt-modal-title"></h2><button class="rt-icon-button" id="rt-modal-close" type="button" aria-label="Đóng">×</button></div><div class="rt-modal-body" id="rt-modal-body"></div><div class="rt-modal-actions"><button class="rt-button" id="rt-modal-cancel" type="button">Hủy</button><button class="rt-button is-primary" id="rt-modal-submit" type="submit">Lưu</button></div></form></div>' +
      '<div class="rt-toast-stack" id="rt-toast-stack" aria-live="polite"></div>';
  }

  function navButtons(mobile) {
    var items = [
      ["overview", "TQ", "Tổng quan"],
      ["machines", "MB", "Máy bán hàng"],
      ["inventory", "TK", "Tồn kho"],
      ["sales", "BH", "Bán hàng"],
      ["links", "LK", "Link đặt hàng"],
      ["users", "ND", "Người dùng"]
    ];
    return items.map(function (item) {
      if (mobile) return '<button type="button" data-view="' + item[0] + '">' + item[2] + '</button>';
      return '<button class="rt-nav-button" type="button" data-view="' + item[0] + '"><span class="rt-nav-icon">' + item[1] + '</span><span>' + item[2] + '</span><small class="rt-nav-count" data-count-for="' + item[0] + '"></small></button>';
    }).join("");
  }

  function bindShell() {
    root.querySelectorAll("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () { activateView(button.dataset.view, true); });
    });
    nodes.refresh.addEventListener("click", function () { loadView(state.view, true); });
    nodes.modalClose.addEventListener("click", closeModal);
    nodes.modalCancel.addEventListener("click", closeModal);
    document.getElementById("rt-modal-form").addEventListener("submit", submitModal);
    nodes.modal.addEventListener("click", function (event) { if (event.target === nodes.modal) closeModal(); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && !nodes.modal.hidden) closeModal(); });
    nodes.content.addEventListener("click", handleContentClick);
    nodes.content.addEventListener("input", handleContentInput);
    nodes.content.addEventListener("change", handleContentInput);
  }

  function viewCopy(view) {
    var copy = {
      overview: ["Tổng quan chuỗi bán lẻ", "Doanh thu, cảnh báo tồn kho và hoạt động mới nhất"],
      machines: ["Quản lý máy bán hàng", "Theo dõi máy, vị trí bán và lượng hàng tại từng ngăn"],
      inventory: ["Quản lý tồn kho", "Danh mục, giá bán, tồn khả dụng và ngưỡng nhập hàng"],
      sales: ["Báo cáo bán hàng", "Doanh thu, đơn hàng và sản phẩm bán chạy"],
      links: ["Trang đặt mua hàng", "Tạo link iot-page bảo mật theo cửa hàng hoặc máy bán hàng"],
      users: ["Quản lý người dùng", "Khách hàng, nhân viên và quyền truy cập hệ thống"]
    };
    return copy[view] || copy.overview;
  }

  function activateView(view, pushState) {
    state.view = normalizeView(view);
    var copy = viewCopy(state.view);
    nodes.title.textContent = copy[0];
    nodes.subtitle.textContent = copy[1];
    root.querySelectorAll("[data-view]").forEach(function (button) {
      if (button.dataset.view === state.view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (pushState && window.history && window.history.replaceState) {
      var url = new URL(window.location.href);
      url.searchParams.set("view", state.view);
      window.history.replaceState({}, "", url.toString());
    }
    renderLoading();
    loadView(state.view, false);
  }

  function macroUrl() {
    return sessionId && syncId ? "/api/" + encodeURIComponent(sessionId) + "/" + encodeURIComponent(syncId) + "/iodata" : "";
  }

  function postMacro(payload) {
    var url = macroUrl();
    if (!url) return Promise.reject(new Error("Thiếu sessionId hoặc syncId để đọc SQLite."));
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) throw new Error(data && data.error ? data.error : "Không thể chạy macro.");
        if (Array.isArray(data)) return data;
        return data && Array.isArray(data.rows) ? data.rows : [];
      });
    });
  }

  function loadView(view, notify) {
    var macro = cfg.macros[view];
    if (!macro || state.loading) return;
    state.loading = true;
    setLive("loading", "Đang tải");
    var payload = { macro: macro, store_id: state.filters.store, limit: cfg.pageSize || 80, offset: 0 };
    if (view === "inventory" || view === "users") payload.search = state.filters.search;
    if (view === "inventory") payload.category_id = state.filters.category;
    if (view === "sales") payload.status = state.filters.status;
    postMacro(payload).then(function (rows) {
      state.data[view] = rows || [];
      renderView(view);
      updateCounts();
      setLive("live", "Đã đồng bộ");
      if (notify) toast("Dữ liệu đã được cập nhật.", "ok");
    }).catch(function (error) {
      renderError(error.message || "Không thể tải dữ liệu.");
      setLive("error", "Mất kết nối");
    }).finally(function () { state.loading = false; });
  }

  function setLive(mode, label) {
    nodes.status.dataset.state = mode;
    nodes.status.textContent = label;
  }

  function renderLoading() {
    nodes.content.innerHTML = '<div class="rt-empty">Đang tải dữ liệu vận hành…</div>';
  }

  function renderError(message) {
    nodes.content.innerHTML = '<div class="rt-empty rt-error"><strong>Không thể tải trang</strong><br>' + esc(message) + '</div>';
  }

  function renderView(view) {
    if (view === "overview") renderOverview();
    else if (view === "machines") renderMachines();
    else if (view === "inventory") renderInventory();
    else if (view === "sales") renderSales();
    else if (view === "links") renderLinks();
    else renderUsers();
  }

  function rowsFor(view, type) {
    return (state.data[view] || []).filter(function (row) { return row.row_type === type; });
  }

  function renderOverview() {
    var kpi = rowsFor("overview", "kpi")[0] || {};
    var trends = rowsFor("overview", "trend");
    var stores = rowsFor("overview", "store");
    var orders = rowsFor("overview", "order");
    var alerts = rowsFor("overview", "alert");
    nodes.content.innerHTML = '' +
      '<section class="rt-kpis">' +
        kpiCard("Doanh thu hôm nay", money(kpi.value1), number(kpi.value5) + "% so với hôm qua", "green") +
        kpiCard("Đơn hôm nay", number(kpi.value2), "Tất cả kênh bán", "blue") +
        kpiCard("Máy đang online", number(kpi.value3), number(kpi.value6) + " máy cần kiểm tra", kpi.value6 > 0 ? "amber" : "green") +
        kpiCard("Sản phẩm sắp hết", number(kpi.value4), "Theo ngưỡng tồn tối thiểu", kpi.value4 > 0 ? "red" : "green") +
      '</section>' +
      '<section class="rt-grid-2">' +
        panel("Doanh thu 7 ngày", "Đơn vị: VNĐ", '<div class="rt-panel-body rt-chart">' + salesChart(trends) + '</div>') +
        panel("Cảnh báo cần xử lý", alerts.length + " mục", '<div class="rt-list">' + (alerts.length ? alerts.map(alertRow).join("") : emptyInline("Không có cảnh báo")) + '</div>') +
      '</section>' +
      '<section class="rt-grid-even" style="margin-top:14px">' +
        panel("Hiệu quả cửa hàng", stores.length + " điểm bán", '<div class="rt-list">' + stores.map(storeRow).join("") + '</div>') +
        panel("Đơn hàng mới", orders.length + " đơn gần nhất", '<div class="rt-list">' + orders.map(orderListRow).join("") + '</div>') +
      '</section>';
  }

  function kpiCard(label, value, note, tone) {
    return '<article class="rt-kpi" data-tone="' + esc(tone) + '"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(note) + '</small></article>';
  }

  function panel(title, meta, body) {
    return '<section class="rt-panel"><div class="rt-panel-head"><h3>' + esc(title) + '</h3><span>' + esc(meta) + '</span></div>' + body + '</section>';
  }

  function salesChart(rows) {
    if (!rows.length) return emptyInline("Chưa có dữ liệu doanh thu");
    var values = rows.map(function (row) { return asNumber(row.value1); });
    var max = Math.max.apply(Math, values.concat([1]));
    var width = 720, height = 180, padX = 32, padY = 22;
    var points = rows.map(function (row, index) {
      var x = padX + (rows.length === 1 ? 0 : index * (width - padX * 2) / (rows.length - 1));
      var y = padY + (height - padY * 2) * (1 - asNumber(row.value1) / max);
      return { x: x, y: y, row: row };
    });
    var path = points.map(function (point, index) { return (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1); }).join(" ");
    var area = path + " L" + points[points.length - 1].x + " " + (height - padY) + " L" + points[0].x + " " + (height - padY) + " Z";
    var grid = [0,.5,1].map(function (ratio) { var y = padY + ratio * (height-padY*2); return '<line class="rt-chart-grid" x1="' + padX + '" x2="' + (width-padX) + '" y1="' + y + '" y2="' + y + '"></line>'; }).join("");
    var marks = points.map(function (point) {
      return '<circle class="rt-chart-dot" cx="' + point.x + '" cy="' + point.y + '" r="3.5"></circle>' +
        '<text class="rt-chart-value" x="' + point.x + '" y="' + Math.max(10, point.y-9) + '" text-anchor="middle">' + esc(compactMoney(point.row.value1)) + '</text>' +
        '<text class="rt-chart-label" x="' + point.x + '" y="' + (height-5) + '" text-anchor="middle">' + esc(point.row.label || shortDate(point.row.ts)) + '</text>';
    }).join("");
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Doanh thu bảy ngày">' + grid + '<path class="rt-chart-area" d="' + area + '"></path><path class="rt-chart-line" d="' + path + '"></path>' + marks + '</svg>';
  }

  function compactMoney(value) {
    var amount = asNumber(value);
    if (Math.abs(amount) >= 1000000) return (amount / 1000000).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + "tr";
    if (Math.abs(amount) >= 1000) return (amount / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + "k";
    return number(amount);
  }

  function alertRow(row) {
    return '<div class="rt-list-row"><div><strong>' + esc(row.label) + '</strong><span>' + esc(row.sub_label || row.detail) + '</span></div><span class="rt-badge" data-tone="' + (row.status === "critical" ? "red" : "amber") + '">' + esc(row.status === "critical" ? "Khẩn" : "Cần xử lý") + '</span></div>';
  }

  function storeRow(row) {
    return '<div class="rt-list-row"><div><strong>' + esc(row.label) + '</strong><span>' + number(row.value2) + ' đơn · ' + number(row.value3) + ' sản phẩm cảnh báo</span></div><div class="rt-list-value">' + money(row.value1) + '</div></div>';
  }

  function orderListRow(row) {
    return '<div class="rt-list-row"><div><strong>' + esc(row.label) + '</strong><span>' + esc(row.sub_label) + ' · ' + dateTime(row.ts) + '</span></div><div class="rt-list-value">' + money(row.value1) + '<br>' + badge(statusLabel(row.status), statusTone(row.status)) + '</div></div>';
  }

  function renderMachines() {
    var machines = rowsFor("machines", "machine");
    var positions = rowsFor("machines", "position");
    if (!state.selectedMachineId && machines.length) state.selectedMachineId = machines[0].id;
    if (!machines.some(function (row) { return row.id === state.selectedMachineId; }) && machines.length) state.selectedMachineId = machines[0].id;
    var selected = machines.filter(function (row) { return row.id === state.selectedMachineId; })[0] || {};
    var selectedPositions = positions.filter(function (row) { return row.parent_id === state.selectedMachineId; });
    nodes.content.innerHTML = '' +
      '<div class="rt-section-head"><div><h2>Đội máy bán hàng</h2><p>' + machines.length + ' máy trong chuỗi</p></div><button class="rt-button is-primary" type="button" data-action="new-machine">Thêm máy</button></div>' +
      '<section class="rt-machine-layout">' +
        '<div class="rt-panel rt-machine-list">' + machines.map(machineRow).join("") + '</div>' +
        '<div class="rt-panel">' +
          '<div class="rt-panel-head"><div><h3>' + esc(selected.label || "Chọn máy") + '</h3><span>' + esc(selected.sub_label || "") + '</span></div>' + (selected.id ? badge(statusLabel(selected.status), statusTone(selected.status)) : "") + '</div>' +
          '<div class="rt-panel-body">' +
            '<section class="rt-kpis">' +
              kpiCard("Vị trí", number(selected.value1), "Số ngăn đã cấu hình", "blue") +
              kpiCard("Hàng trong máy", number(selected.value2), "Tổng sản phẩm khả dụng", "green") +
              kpiCard("Sức chứa", number(selected.value3), "Dung lượng tối đa", "blue") +
              kpiCard("Cập nhật cuối", selected.ts ? shortDate(selected.ts) : "—", selected.ts ? dateTime(selected.ts) : "Chưa có", selected.status === "offline" ? "red" : "green") +
            '</section>' +
            '<div class="rt-position-grid">' + (selectedPositions.length ? selectedPositions.map(positionCard).join("") : emptyInline("Máy chưa có vị trí bán hàng")) + '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  function machineRow(row) {
    return '<button class="rt-machine-row' + (row.id === state.selectedMachineId ? " is-active" : "") + '" type="button" data-action="select-machine" data-id="' + esc(row.id) + '"><span class="rt-machine-dot" data-tone="' + statusTone(row.status) + '"></span><span><strong>' + esc(row.label) + '</strong><span>' + esc(row.sub_label) + '</span></span><small>' + number(row.value2) + '/' + number(row.value3) + '</small></button>';
  }

  function positionCard(row) {
    var ratio = row.value2 > 0 ? Math.max(0, Math.min(100, row.value1 * 100 / row.value2)) : 0;
    var tone = ratio <= 15 ? "red" : ratio <= 35 ? "amber" : "green";
    return '<article class="rt-position"><div class="rt-position-head"><span class="rt-position-no">Vị trí ' + esc(row.id) + '</span>' + badge(row.status === "enabled" ? "Đang bán" : "Tạm dừng", row.status === "enabled" ? "green" : "red") + '</div><h4>' + esc(row.label || "Chưa gắn sản phẩm") + '</h4><p>' + esc(row.sub_label || "") + '</p><div class="rt-position-stock"><div class="rt-stock-track"><div class="rt-stock-fill" data-tone="' + tone + '" style="width:' + ratio + '%"></div></div><strong>' + number(row.value1) + ' / ' + number(row.value2) + '</strong></div></article>';
  }

  function renderInventory() {
    var products = rowsFor("inventory", "product");
    var categories = rowsFor("inventory", "category");
    nodes.content.innerHTML = '' +
      '<div class="rt-section-head"><div><h2>Danh mục và tồn kho</h2><p>' + products.length + ' mặt hàng trong kết quả</p></div><button class="rt-button is-primary" type="button" data-action="new-product">Thêm sản phẩm</button></div>' +
      '<div class="rt-filterbar"><input class="rt-input rt-search" id="rt-inventory-search" type="search" placeholder="Tìm tên, SKU hoặc barcode" value="' + esc(state.filters.search) + '"><select class="rt-input" id="rt-inventory-category"><option value="">Tất cả nhóm</option>' + categories.map(function (row) { return '<option value="' + esc(row.id) + '"' + (row.id === state.filters.category ? " selected" : "") + '>' + esc(row.label) + '</option>'; }).join("") + '</select><button class="rt-button" type="button" data-action="apply-inventory-filter">Lọc</button></div>' +
      '<section class="rt-panel"><div class="rt-table-wrap"><table class="rt-table"><thead><tr><th>Sản phẩm</th><th>Nhóm</th><th>Tồn khả dụng</th><th>Ngưỡng</th><th>Giá bán</th><th>Cập nhật</th><th></th></tr></thead><tbody>' +
      (products.length ? products.map(productRow).join("") : '<tr><td colspan="7">' + emptyInline("Không tìm thấy sản phẩm") + '</td></tr>') +
      '</tbody></table></div></section>';
  }

  function productRow(row) {
    var data = json(row.detail, {});
    var available = asNumber(row.value1) - asNumber(row.value2);
    var max = Math.max(asNumber(row.value3) * 3, asNumber(row.value1), 1);
    var ratio = Math.max(0, Math.min(100, available * 100 / max));
    var tone = row.status === "out" ? "red" : row.status === "low" ? "amber" : "green";
    return '<tr><td>' + productCell(row.label, data.sku + (data.store_name ? ' · ' + data.store_name : ''), data.image_url) + '</td><td>' + esc(row.sub_label) + '</td><td><div class="rt-stock-meter"><div class="rt-stock-track"><div class="rt-stock-fill" data-tone="' + tone + '" style="width:' + ratio + '%"></div></div><small>' + number(available) + ' ' + esc(data.unit || "") + '</small></div></td><td>' + number(row.value3) + '</td><td><strong>' + money(row.value4) + '</strong><small>Giá vốn ' + money(row.value5) + '</small></td><td>' + dateTime(row.ts) + '</td><td><button class="rt-button" type="button" data-action="adjust-stock" data-product="' + esc(row.id) + '" data-store="' + esc(data.store_id || "") + '">Điều chỉnh</button></td></tr>';
  }

  function productCell(name, sku, imageUrl) {
    var image = safeImage(imageUrl);
    var initial = String(name || "SP").trim().slice(0, 2).toUpperCase();
    return '<div class="rt-product-cell"><span class="rt-product-thumb">' + (image ? '<img src="' + esc(image) + '" alt="" loading="lazy" onerror="this.remove()">' : esc(initial)) + '</span><span><strong>' + esc(name) + '</strong><small>' + esc(sku || "") + '</small></span></div>';
  }

  function renderSales() {
    var kpi = rowsFor("sales", "kpi")[0] || {};
    var trends = rowsFor("sales", "trend");
    var orders = rowsFor("sales", "order");
    var products = rowsFor("sales", "product");
    nodes.content.innerHTML = '' +
      '<section class="rt-kpis">' +
        kpiCard("Doanh thu kỳ này", money(kpi.value1), "Theo bộ lọc hiện tại", "green") +
        kpiCard("Số đơn", number(kpi.value2), "Đơn đã ghi nhận", "blue") +
        kpiCard("Giá trị trung bình", money(kpi.value3), "Trên mỗi đơn", "blue") +
        kpiCard("Chờ xử lý", number(kpi.value4), "Đơn chưa hoàn tất", kpi.value4 > 0 ? "amber" : "green") +
      '</section>' +
      '<section class="rt-grid-2">' +
        panel("Xu hướng doanh thu", "14 ngày gần nhất", '<div class="rt-panel-body rt-chart">' + salesChart(trends) + '</div>') +
        panel("Sản phẩm bán chạy", products.length + " sản phẩm", '<div class="rt-list">' + products.map(function (row) { return '<div class="rt-list-row"><div><strong>' + esc(row.label) + '</strong><span>' + number(row.value2) + ' sản phẩm</span></div><div class="rt-list-value">' + money(row.value1) + '</div></div>'; }).join("") + '</div>') +
      '</section>' +
      '<div class="rt-section-head" style="margin-top:18px"><div><h2>Đơn hàng gần đây</h2><p>Theo dõi và cập nhật trạng thái xử lý</p></div><select class="rt-input" id="rt-sales-status"><option value="">Tất cả trạng thái</option>' + ["pending","confirmed","processing","fulfilled","cancelled"].map(function (status) { return '<option value="' + status + '"' + (state.filters.status === status ? " selected" : "") + '>' + statusLabel(status) + '</option>'; }).join("") + '</select></div>' +
      '<section class="rt-panel"><div class="rt-table-wrap"><table class="rt-table"><thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Kênh bán</th><th>Giá trị</th><th>Trạng thái</th><th>Thời gian</th><th></th></tr></thead><tbody>' + orders.map(orderTableRow).join("") + '</tbody></table></div></section>';
  }

  function orderTableRow(row) {
    var data = json(row.detail, {});
    return '<tr><td><strong>' + esc(row.label) + '</strong><small>' + esc(row.id) + '</small></td><td>' + esc(row.sub_label || "Khách lẻ") + '<small>' + esc(data.phone || "") + '</small></td><td>' + esc(data.channel || "Dashboard") + '<small>' + esc(data.store_name || "") + '</small></td><td><strong>' + money(row.value1) + '</strong><small>' + number(row.value2) + ' sản phẩm</small></td><td>' + badge(statusLabel(row.status), statusTone(row.status)) + '</td><td>' + dateTime(row.ts) + '</td><td><button class="rt-button" type="button" data-action="order-status" data-id="' + esc(row.id) + '" data-status="' + esc(row.status) + '">Cập nhật</button></td></tr>';
  }

  function renderLinks() {
    var links = rowsFor("links", "link");
    nodes.content.innerHTML = '' +
      '<div class="rt-section-head"><div><h2>Link đặt mua hàng</h2><p>Mỗi link có context và macro allowlist riêng trên iot-page</p></div><button class="rt-button is-primary" type="button" data-action="new-link">Tạo link</button></div>' +
      '<section class="rt-link-grid">' + (links.length ? links.map(linkCard).join("") : emptyInline("Chưa có link đặt hàng")) + '</section>';
  }

  function linkCard(row) {
    var data = json(row.detail, {});
    var url = window.location.origin + "/iot-page/" + encodeURIComponent(data.ioid || sessionId.split("@")[0] || "IOID") + "/" + encodeURIComponent(row.id);
    return '<article class="rt-link-item"><div class="rt-section-head"><div><h3>' + esc(row.label) + '</h3><p>' + esc(row.sub_label) + '</p></div>' + badge(row.status === "enabled" ? "Đang mở" : "Đã tắt", row.status === "enabled" ? "green" : "red") + '</div><p>' + esc(data.scope || "Toàn cửa hàng") + ' · ' + (data.require_phone ? "Xác thực SĐT" : "Không yêu cầu SĐT") + '</p><div class="rt-link-url">' + esc(url) + '</div><div class="rt-link-actions"><button class="rt-button" type="button" data-action="copy-link" data-url="' + esc(url) + '">Sao chép</button><button class="rt-button" type="button" data-action="open-link" data-url="' + esc(url) + '">Mở trang</button><button class="rt-button" type="button" data-action="edit-link" data-id="' + esc(data.link_id || "") + '">Chỉnh sửa</button></div></article>';
  }

  function renderUsers() {
    var users = rowsFor("users", "user");
    nodes.content.innerHTML = '' +
      '<div class="rt-section-head"><div><h2>Người dùng hệ thống</h2><p>' + users.length + ' kết quả</p></div><button class="rt-button is-primary" type="button" data-action="new-user">Thêm người dùng</button></div>' +
      '<div class="rt-filterbar"><input class="rt-input rt-search" id="rt-user-search" type="search" placeholder="Tìm tên, SĐT hoặc email" value="' + esc(state.filters.search) + '"><button class="rt-button" type="button" data-action="apply-user-filter">Tìm</button></div>' +
      '<section class="rt-panel"><div class="rt-table-wrap"><table class="rt-table"><thead><tr><th>Người dùng</th><th>Liên hệ</th><th>Vai trò</th><th>Đơn hàng</th><th>Chi tiêu</th><th>Hoạt động cuối</th><th></th></tr></thead><tbody>' + users.map(userRow).join("") + '</tbody></table></div></section>';
  }

  function userRow(row) {
    return '<tr><td><strong>' + esc(row.label) + '</strong><small>' + esc(row.id) + '</small></td><td>' + esc(row.phone) + '<small>' + esc(row.email) + '</small></td><td>' + badge(roleLabel(row.role), row.role === "admin" ? "blue" : row.role === "staff" ? "green" : "") + '</td><td>' + number(row.value1) + '</td><td>' + money(row.value2) + '</td><td>' + dateTime(row.ts) + '</td><td><button class="rt-button" type="button" data-action="edit-user" data-id="' + esc(row.id) + '">Chỉnh sửa</button></td></tr>';
  }

  function badge(label, tone) {
    return '<span class="rt-badge" data-tone="' + esc(tone || "") + '">' + esc(label) + '</span>';
  }

  function statusLabel(status) {
    var map = { online: "Online", warning: "Cảnh báo", offline: "Offline", enabled: "Đang bật", disabled: "Đã tắt", pending: "Chờ xác nhận", confirmed: "Đã xác nhận", processing: "Đang xử lý", fulfilled: "Hoàn tất", cancelled: "Đã hủy", low: "Sắp hết", out: "Hết hàng", ok: "Ổn định" };
    return map[String(status || "").toLowerCase()] || String(status || "Không rõ");
  }

  function statusTone(status) {
    var text = String(status || "").toLowerCase();
    if (["online","enabled","fulfilled","ok","active"].indexOf(text) >= 0) return "green";
    if (["warning","pending","confirmed","processing","low"].indexOf(text) >= 0) return "amber";
    if (["offline","disabled","cancelled","out","error","critical"].indexOf(text) >= 0) return "red";
    return "blue";
  }

  function roleLabel(role) {
    return { admin: "Quản trị", staff: "Nhân viên", customer: "Khách hàng" }[role] || role || "Khách hàng";
  }

  function emptyInline(message) {
    return '<div class="rt-empty">' + esc(message) + '</div>';
  }

  function updateCounts() {
    var counts = {
      overview: rowsFor("overview", "alert").length,
      machines: rowsFor("machines", "machine").length,
      inventory: rowsFor("inventory", "product").length,
      sales: rowsFor("sales", "order").length,
      links: rowsFor("links", "link").length,
      users: rowsFor("users", "user").length
    };
    root.querySelectorAll("[data-count-for]").forEach(function (node) { node.textContent = counts[node.dataset.countFor] ? String(counts[node.dataset.countFor]) : ""; });
  }

  function handleContentInput(event) {
    if (event.target.id === "rt-sales-status") {
      state.filters.status = event.target.value;
      loadView("sales", false);
    }
  }

  function handleContentClick(event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var action = button.dataset.action;
    if (action === "select-machine") {
      state.selectedMachineId = button.dataset.id || "";
      renderMachines();
    } else if (action === "apply-inventory-filter") {
      state.filters.search = valueOf("rt-inventory-search");
      state.filters.category = valueOf("rt-inventory-category");
      loadView("inventory", false);
    } else if (action === "apply-user-filter") {
      state.filters.search = valueOf("rt-user-search");
      loadView("users", false);
    } else if (action === "copy-link") {
      copyText(button.dataset.url || "");
    } else if (action === "open-link") {
      window.open(button.dataset.url || "", "_blank", "noopener,noreferrer");
    } else if (action === "new-product") openProductModal();
    else if (action === "adjust-stock") openStockModal(button.dataset.product, button.dataset.store);
    else if (action === "new-machine") openMachineModal();
    else if (action === "new-link") openLinkModal();
    else if (action === "edit-link") openLinkModal(button.dataset.id);
    else if (action === "new-user") openUserModal();
    else if (action === "edit-user") openUserModal(button.dataset.id);
    else if (action === "order-status") openOrderStatusModal(button.dataset.id, button.dataset.status);
  }

  function valueOf(id) {
    var node = document.getElementById(id);
    return node ? String(node.value || "").trim() : "";
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Đã sao chép link.", "ok"); }).catch(function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var input = document.createElement("textarea");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try { document.execCommand("copy"); toast("Đã sao chép link.", "ok"); } catch (error) { toast("Không thể sao chép tự động.", "error"); }
    input.remove();
  }

  function openModal(type, title, body, submitLabel) {
    nodes.modal.dataset.type = type;
    nodes.modalTitle.textContent = title;
    nodes.modalBody.innerHTML = body;
    nodes.modalSubmit.textContent = submitLabel || "Lưu";
    nodes.modal.hidden = false;
    var first = nodes.modalBody.querySelector("input,select,textarea");
    if (first) window.setTimeout(function () { first.focus(); }, 30);
  }

  function closeModal() {
    nodes.modal.hidden = true;
    nodes.modal.dataset.type = "";
    nodes.modalBody.innerHTML = "";
  }

  function field(label, name, value, type, extra) {
    return '<label' + (extra && extra.full ? ' class="rt-field-full"' : '') + '>' + esc(label) + '<input class="rt-input" name="' + esc(name) + '" type="' + esc(type || "text") + '" value="' + esc(value == null ? "" : value) + '"' + (extra && extra.required ? " required" : "") + (extra && extra.min != null ? ' min="' + esc(extra.min) + '"' : "") + '></label>';
  }

  function selectField(label, name, value, options, full) {
    return '<label' + (full ? ' class="rt-field-full"' : '') + '>' + esc(label) + '<select class="rt-input" name="' + esc(name) + '">' + options.map(function (item) { return '<option value="' + esc(item[0]) + '"' + (String(value) === String(item[0]) ? " selected" : "") + '>' + esc(item[1]) + '</option>'; }).join("") + '</select></label>';
  }

  function openProductModal() {
    var cats = rowsFor("inventory", "category");
    openModal("product", "Thêm sản phẩm", '<div class="rt-form-grid">' + field("Mã sản phẩm", "product_id", "", "text", { required: true }) + field("SKU", "sku", "", "text", { required: true }) + field("Tên sản phẩm", "name", "", "text", { required: true, full: true }) + selectField("Nhóm sản phẩm", "category_id", cats[0] && cats[0].id, cats.map(function (r) { return [r.id, r.label]; })) + field("Đơn vị", "unit", "chai") + field("Giá bán", "sale_price", "", "number", { required: true, min: 0 }) + field("Giá vốn", "cost_price", "", "number", { min: 0 }) + field("Barcode", "barcode", "") + field("URL hình ảnh", "image_url", "", "url", { full: true }) + '</div>', "Tạo sản phẩm");
  }

  function openStockModal(productId, storeId) {
    openModal("stock", "Điều chỉnh tồn kho", '<div class="rt-form-grid">' + field("Mã sản phẩm", "product_id", productId, "text", { required: true }) + field("Mã cửa hàng", "store_id", storeId || cfg.storeId || "STORE-HCM", "text", { required: true }) + field("Thay đổi số lượng", "quantity_delta", "", "number", { required: true }) + selectField("Loại điều chỉnh", "movement_type", "manual_adjustment", [["manual_adjustment","Điều chỉnh thủ công"],["stock_in","Nhập kho"],["stock_out","Xuất kho"],["return","Hoàn kho"]]) + field("Mã yêu cầu", "request_id", "ADM-" + Date.now(), "text", { required: true }) + field("Ghi chú", "note", "", "text", { full: true }) + '</div>', "Cập nhật tồn kho");
  }

  function openMachineModal() {
    openModal("machine", "Thêm máy bán hàng", '<div class="rt-form-grid">' + field("Mã máy", "machine_id", "VM-", "text", { required: true }) + field("Tên máy", "name", "", "text", { required: true }) + field("Mã cửa hàng", "store_id", cfg.storeId || "STORE-HCM", "text", { required: true }) + field("IOID thiết bị", "ioid", "<<ioid>>", "text") + field("Vị trí lắp đặt", "location", "", "text", { full: true }) + selectField("Trạng thái", "status", "online", [["online","Online"],["warning","Cảnh báo"],["offline","Offline"]]) + '</div>', "Lưu máy");
  }

  function openLinkModal(linkId) {
    var row = rowsFor("links", "link").filter(function (item) { return json(item.detail, {}).link_id === linkId; })[0] || {};
    var data = json(row.detail, {});
    openModal("link", linkId ? "Chỉnh sửa link đặt hàng" : "Tạo link đặt hàng", '<div class="rt-form-grid">' + field("Mã link", "link_id", linkId || "SHOP-" + Date.now().toString().slice(-6), "text", { required: true }) + field("Page ID", "page_id", row.id || "retail-shop-" + Date.now().toString().slice(-6), "text", { required: true }) + field("Tiêu đề", "title", row.label || "Cửa hàng tiện lợi ROSA", "text", { required: true, full: true }) + field("Mô tả", "subtitle", row.sub_label || "Chọn sản phẩm, xác nhận đơn và nhận hàng thuận tiện.", "text", { full: true }) + field("Mã cửa hàng", "store_id", data.store_id || cfg.storeId || "STORE-HCM", "text", { required: true }) + field("Mã máy (để trống nếu toàn cửa hàng)", "machine_id", data.machine_id || "") + selectField("Yêu cầu xác thực SĐT", "require_phone", data.require_phone == null ? "1" : String(data.require_phone), [["1","Có"],["0","Không"]]) + selectField("Trạng thái", "enabled", row.status === "disabled" ? "0" : "1", [["1","Đang mở"],["0","Tạm đóng"]]) + '</div>', "Lưu và tạo iot-page");
  }

  function openUserModal(userId) {
    var row = rowsFor("users", "user").filter(function (item) { return item.id === userId; })[0] || {};
    openModal("user", userId ? "Chỉnh sửa người dùng" : "Thêm người dùng", '<div class="rt-form-grid">' + field("Mã người dùng", "user_id", userId || "USR-" + Date.now().toString().slice(-6), "text", { required: true }) + field("Số điện thoại", "phone", row.phone || "", "tel", { required: true }) + field("Họ tên", "name", row.label || "", "text", { required: true }) + field("Email", "email", row.email || "", "email") + selectField("Vai trò", "role", row.role || "customer", [["customer","Khách hàng"],["staff","Nhân viên"],["admin","Quản trị"]]) + selectField("Trạng thái", "status", row.status || "active", [["active","Đang hoạt động"],["disabled","Đã khóa"]]) + '</div>', "Lưu người dùng");
  }

  function openOrderStatusModal(orderId, current) {
    openModal("order-status", "Cập nhật trạng thái đơn", '<div class="rt-form-grid">' + field("Mã đơn", "order_id", orderId, "text", { required: true }) + selectField("Trạng thái", "status", current, [["pending","Chờ xác nhận"],["confirmed","Đã xác nhận"],["processing","Đang xử lý"],["cancelled","Hủy đơn"]]) + field("Mã yêu cầu", "request_id", "STATUS-" + Date.now(), "text", { required: true }) + field("Ghi chú", "note", "", "text", { full: true }) + '</div>', "Cập nhật");
  }

  function formDataObject() {
    var data = {};
    new FormData(document.getElementById("rt-modal-form")).forEach(function (value, key) { data[key] = String(value); });
    return data;
  }

  function submitModal(event) {
    event.preventDefault();
    var type = nodes.modal.dataset.type;
    var data = formDataObject();
    var macroMap = { product: cfg.macros.saveProduct, stock: cfg.macros.adjustStock, machine: cfg.macros.saveMachine, link: cfg.macros.saveLink, user: cfg.macros.saveUser, "order-status": cfg.macros.orderStatus };
    var macro = macroMap[type];
    if (!macro) return;
    data.macro = macro;
    nodes.modalSubmit.disabled = true;
    postMacro(data).then(function (rows) {
      var result = rows[0] || {};
      if (String(result.c1 || result.code || "OK").toUpperCase() === "FAIL") throw new Error(result.message || result.code || "Không thể lưu dữ liệu.");
      closeModal();
      toast("Đã lưu thay đổi.", "ok");
      loadView(state.view, false);
    }).catch(function (error) {
      toast(error.message || "Không thể lưu dữ liệu.", "error");
    }).finally(function () { nodes.modalSubmit.disabled = false; });
  }

  function toast(message, tone) {
    var node = document.createElement("div");
    node.className = "rt-toast";
    node.dataset.tone = tone || "ok";
    node.textContent = message;
    nodes.toastStack.appendChild(node);
    window.setTimeout(function () { node.remove(); }, 3600);
  }

  function streamUrl() {
    return sessionId ? "/api/" + encodeURIComponent(sessionId) + "/stream?historyMs=0" : "";
  }

  function connectStream() {
    if (!cfg.stream || cfg.stream.enabled === false || typeof EventSource === "undefined") return;
    var url = streamUrl();
    if (!url) return;
    if (state.eventSource) state.eventSource.close();
    state.eventSource = new EventSource(url);
    state.eventSource.onmessage = function (event) {
      try {
        var payload = JSON.parse(event.data);
        if (payload && payload.type === "iodata_changed") queueRefresh();
      } catch (error) {}
    };
    state.eventSource.onerror = function () { setLive("error", "Đang kết nối lại"); };
  }

  function queueRefresh() {
    if (state.refreshTimer) {
      state.refreshQueued = true;
      return;
    }
    state.refreshTimer = window.setTimeout(function () {
      state.refreshTimer = null;
      loadView(state.view, false);
      if (state.refreshQueued) {
        state.refreshQueued = false;
        queueRefresh();
      }
    }, Math.max(500, Number(cfg.stream && cfg.stream.cooldownMs || 1800)));
  }
})();
