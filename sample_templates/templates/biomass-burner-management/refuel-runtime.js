(function () {
  "use strict";

  // This public page only calls macros explicitly allowlisted by system_pages.
  // Never place a device session, API key or SyncID in this browser runtime.
  function readJson(id) {
    try { return JSON.parse(document.getElementById(id).textContent || "{}"); } catch (_) { return {}; }
  }
  function number(value) { return Number(value || 0).toLocaleString("vi-VN"); }
  function requestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    return Array.from(bytes, function (value) { return value.toString(16).padStart(2, "0"); }).join("");
  }

  var context = readJson("rosa-iot-page-context");
  var pageIoid = String(context.ioid || "");
  var pageId = String(context.pageId || "");
  var storageKey = "biomass-refuel-complete:" + pageIoid + ":" + pageId;
  var pendingKey = "biomass-refuel-pending:" + pageIoid + ":" + pageId;
  var formView = document.getElementById("br-form-view");
  var successView = document.getElementById("br-success-view");
  var form = document.getElementById("br-form");
  var code = document.getElementById("br-code");
  var submit = document.getElementById("br-submit");
  var message = document.getElementById("br-message");
  var device = document.getElementById("br-device");
  var burned = document.getElementById("br-burned");
  var purchased = document.getElementById("br-purchased");
  var countdownTimer = 0;

  function macroUrl() {
    return "/api/iot-page-macro/" + encodeURIComponent(pageIoid) + "/" + encodeURIComponent(pageId);
  }
  async function runMacro(macro, params) {
    var response = await fetch(macroUrl(), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ macro: macro, params: params || {} })
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      if (response.status === 429) throw new Error("Bạn thao tác quá nhanh. Vui lòng chờ một phút rồi thử lại.");
      throw new Error(data.message || data.error || "Không thể kết nối. Vui lòng thử lại.");
    }
    return Array.isArray(data.rows) ? data.rows : [];
  }
  async function sendRefuelCommand(lotCode, minutes) {
    var response = await fetch("/api/iot-cmd/" + encodeURIComponent(pageIoid) + "/biomass-refuel?pageId=" + encodeURIComponent(pageId), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lot_code: lotCode, minutes: Number(minutes) })
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      if (["DEVICE_NOT_REGISTERED", "DEVICE_KEY_REJECTED", "DEVICE_COMMAND_FAILED", "BATCH_DEVICE_NOT_FOUND"].indexOf(data.error) >= 0) {
        throw new Error("Thiết bị chưa sẵn sàng. Vui lòng cắm điện vào lò và thử lại.");
      }
      throw new Error(data.message || data.error || "Không thể gửi yêu cầu tới thiết bị.");
    }
    if (String(data.gatewayText || "").trim() !== "OK") {
      throw new Error("Thiết bị chưa sẵn sàng. Vui lòng cắm điện vào lò và thử lại.");
    }
    return data;
  }

  function showSuccess(result, persist) {
    var saved = {
      added_minutes: Number(result.added_minutes || 0),
      purchased_minutes: Number(result.purchased_minutes || 0)
    };
    code.value = "";
    form.reset();
    formView.hidden = true;
    successView.hidden = false;
    document.getElementById("br-added").textContent = number(saved.added_minutes);
    document.getElementById("br-total").textContent = number(saved.purchased_minutes);
    if (persist) {
      try { sessionStorage.setItem(storageKey, JSON.stringify(saved)); } catch (_) {}
      try { history.replaceState({ biomassRefuelComplete: true }, document.title, location.pathname + location.search + "#completed"); } catch (_) {}
    }
    var left = 5;
    var label = document.getElementById("br-countdown");
    clearInterval(countdownTimer);
    label.textContent = "Trang sẽ tự đóng sau " + left + " giây.";
    countdownTimer = setInterval(function () {
      left -= 1;
      if (left > 0) { label.textContent = "Trang sẽ tự đóng sau " + left + " giây."; return; }
      clearInterval(countdownTimer);
      label.textContent = "Đã hoàn tất. Bạn có thể đóng trang này.";
      try { window.close(); } catch (_) {}
    }, 1000);
  }

  function friendlyStatus(status) {
    if (status === "ALREADY_USED") return "Mã này đã được nạp trước đó.";
    if (status === "NOT_FOUND") return "Không tìm thấy mã lô nhiên liệu.";
    if (status === "CREDIT_LIMIT") return "Lò đã đạt giới hạn phút mua. Vui lòng liên hệ quản lý.";
    return "Mã không hợp lệ. Vui lòng kiểm tra lại.";
  }

  function pendingRequestFor(lotCode) {
    try {
      var pending = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
      if (pending && pending.lot_code === lotCode && pending.client_request_id) return pending.client_request_id;
    } catch (_) {}
    var clientRequestId = requestId();
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify({ lot_code: lotCode, client_request_id: clientRequestId }));
    } catch (_) {}
    return clientRequestId;
  }

  function clearPendingRequest() {
    try { sessionStorage.removeItem(pendingKey); } catch (_) {}
  }

  code.addEventListener("input", function () {
    var normalized = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (code.value !== normalized) code.value = normalized;
    message.textContent = "";
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var lotCode = code.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(lotCode)) {
      message.textContent = "Vui lòng nhập đủ 6 ký tự A–Z hoặc 0–9.";
      code.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = "Đang kiểm tra thiết bị…";
    message.textContent = "";
    try {
      var checkedRows = await runMacro("biomass-refuel-check", { lot_code: lotCode });
      var checked = checkedRows[0] || {};
      if (checked.status !== "READY") {
        clearPendingRequest();
        throw new Error(friendlyStatus(String(checked.status || "INVALID")));
      }
      await sendRefuelCommand(lotCode, checked.added_minutes);
      var rows = await runMacro("biomass-refuel-redeem", {
        lot_code: lotCode,
        client_request_id: pendingRequestFor(lotCode)
      });
      var result = rows[0] || {};
      if (result.status !== "OK") {
        clearPendingRequest();
        throw new Error(friendlyStatus(String(result.status || "INVALID")));
      }
      clearPendingRequest();
      purchased.textContent = number(result.purchased_minutes);
      showSuccess(result, true);
    } catch (error) {
      message.textContent = error.message || "Không thể nạp nhiên liệu.";
      code.select();
    } finally {
      submit.disabled = false;
      submit.textContent = "Nạp phút đốt";
    }
  });

  (async function init() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved) { showSuccess(saved, false); return; }
    } catch (_) {}
    try {
      var rows = await runMacro("biomass-refuel-state");
      var row = rows[0];
      if (!row) throw new Error("Trang nạp không còn hiệu lực.");
      device.textContent = (row.name ? row.name + " · " : "") + row.burner_id;
      burned.textContent = number(row.burned_minutes);
      purchased.textContent = number(row.purchased_minutes);
      code.focus();
    } catch (error) {
      device.textContent = "Không thể tải thông tin lò";
      message.textContent = error.message || "Vui lòng thử lại sau.";
      submit.disabled = true;
    }
  })();
})();
