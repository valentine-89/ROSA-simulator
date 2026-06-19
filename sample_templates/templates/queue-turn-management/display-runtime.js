(function () {
  "use strict";

  var meta = readJsonScript("rosa-iot-page-meta");
  var context = readJsonScript("rosa-iot-page-context");
  var queue = meta.queue && typeof meta.queue === "object" ? meta.queue : {};
  var prefix = safeText(queue.fieldPrefix || queue.field_prefix, "clinic_a");
  var layout = normalizeLayout(queue.layout);
  var theme = normalizeTheme(queue.themePreset || queue.theme_preset);
  var baseTitle = safeText(queue.title || context.title, "Màn hình nhảy số");
  var lastData = {};
  var lastAlert = "";
  var source = null;
  var reconnectTimer = null;
  var reconnectCount = 0;
  var statusHideTimer = null;
  var scrollTimers = [];
  var params = new URLSearchParams(location.search);
  var followNumber = safeText(params.get("follow"), "");
  var soundEnabled = params.get("sound") === "true";
  var userConfirmed = !followNumber;

  var nodes = {
    body: document.body,
    name: document.getElementById("qt-display-name"),
    note: document.getElementById("qt-display-note"),
    status: document.getElementById("qt-display-status"),
    main: document.getElementById("qt-display-main"),
    columns: document.getElementById("qt-number-columns"),
    followChip: document.getElementById("qt-follow-chip")
  };

  function readJsonScript(id) {
    try {
      var node = document.getElementById(id);
      return JSON.parse(node && node.textContent || "{}");
    } catch (error) {
      return {};
    }
  }

  function safeText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || String(fallback || "");
  }

  function normalizeTheme(value) {
    var text = safeText(value, "medical");
    return ["medical", "bank", "pickup", "amusement", "neutral"].indexOf(text) >= 0 ? text : "medical";
  }

  function normalizeLayout(value) {
    var text = safeText(value, "two-column");
    return ["single-column", "two-column", "media-top", "media-side"].indexOf(text) >= 0 ? text : "two-column";
  }

  function valueFor(data, suffix, fallback) {
    var key = prefix + "_" + suffix;
    if (data && Object.prototype.hasOwnProperty.call(data, key)) {
      return safeText(data[key], fallback);
    }
    return safeText(fallback, "");
  }

  function splitOrders(value) {
    return safeText(value, "")
      .split(/[,\n;|]+/)
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  function setStatus(text, online) {
    if (!nodes.status) return;
    clearTimeout(statusHideTimer);
    nodes.status.textContent = text;
    nodes.status.setAttribute("data-state", online ? "online" : "offline");
    nodes.status.setAttribute("aria-hidden", "false");
    nodes.status.classList.remove("is-hidden");
    if (online) {
      statusHideTimer = setTimeout(function () {
        nodes.status.classList.add("is-hidden");
        nodes.status.setAttribute("aria-hidden", "true");
      }, 2000);
    }
  }

  function clearScroll() {
    scrollTimers.forEach(function (timer) { clearInterval(timer); });
    scrollTimers = [];
  }

  function startAutoScroll() {
    clearScroll();
    Array.prototype.slice.call(document.querySelectorAll(".qt-number-list")).forEach(function (list) {
      if (list.scrollHeight <= list.clientHeight + 40) return;
      var direction = 1;
      var pause = 60;
      var timer = setInterval(function () {
        if (pause > 0) {
          pause -= 1;
          return;
        }
        var maxScroll = list.scrollHeight - list.clientHeight;
        if (direction > 0 && list.scrollTop >= maxScroll - 4) {
          direction = -1;
          pause = 36;
          return;
        }
        if (direction < 0 && list.scrollTop <= 4) {
          direction = 1;
          pause = 36;
          return;
        }
        list.scrollTop += direction * 2;
      }, 52);
      scrollTimers.push(timer);
    });
  }

  function numberItem(number, highlight) {
    var item = document.createElement("div");
    item.className = "qt-number-item" + (highlight ? " highlight" : "");
    item.textContent = number;
    return item;
  }

  function renderColumn(label, orders, alertValue) {
    var column = document.createElement("section");
    column.className = "qt-number-column";

    var labelNode = document.createElement("div");
    labelNode.className = "qt-column-label";
    labelNode.textContent = safeText(label, "Đang gọi");
    column.appendChild(labelNode);

    var list = document.createElement("div");
    list.className = "qt-number-list";
    if (!orders.length) {
      list.appendChild(numberItem("--", false));
    } else {
      orders.forEach(function (number) {
        list.appendChild(numberItem(number, alertValue && ticketsMatch(number, alertValue)));
      });
    }
    column.appendChild(list);
    return column;
  }

  function isHttpUrl(value) {
    var text = safeText(value, "");
    if (!/^https?:\/\//i.test(text) && text.charAt(0) !== "/") return false;
    try {
      var url = new URL(text, location.href);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function youtubeId(value) {
    try {
      var url = new URL(value, location.href);
      if (url.hostname.indexOf("youtu.be") >= 0) return url.pathname.split("/").filter(Boolean)[0] || "";
      if (url.hostname.indexOf("youtube.com") >= 0) return url.searchParams.get("v") || "";
    } catch (error) {}
    return "";
  }

  function mediaKind(value) {
    var text = safeText(value, "");
    var lower = text.toLowerCase();
    if (!text || !isHttpUrl(text)) return "";
    if (youtubeId(text)) return "youtube";
    if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)(?:\?|#|$)/.test(lower) || lower.indexOf("image") >= 0) return "image";
    if (/\.(mp4|webm|ogg|mov|m3u8)(?:\?|#|$)/.test(lower) || lower.indexOf("video") >= 0) return "video";
    return "web";
  }

  function renderMedia(value) {
    var kind = mediaKind(value);
    if (!kind) return null;
    var box = document.createElement("section");
    box.className = "qt-media-box";
    if (kind === "image") {
      var img = document.createElement("img");
      img.src = value;
      img.alt = "";
      box.appendChild(img);
      return box;
    }
    if (kind === "video") {
      var video = document.createElement("video");
      video.src = value;
      video.autoplay = true;
      video.loop = true;
      video.controls = true;
      video.muted = !soundEnabled;
      video.playsInline = true;
      box.appendChild(video);
      return box;
    }
    var iframe = document.createElement("iframe");
    var id = youtubeId(value);
    iframe.src = id ? "https://www.youtube.com/embed/" + encodeURIComponent(id) + "?autoplay=1&mute=" + (soundEnabled ? "0" : "1") : value;
    iframe.allow = "autoplay; encrypted-media";
    iframe.referrerPolicy = "no-referrer";
    box.appendChild(iframe);
    return box;
  }

  function normalizedTicket(value) {
    var text = safeText(value, "").replace(/\s+/g, "").toUpperCase();
    if (/^[0-9]+$/.test(text)) {
      return text.replace(/^0+/, "") || "0";
    }
    return text;
  }

  function ticketsMatch(left, right) {
    var a = normalizedTicket(left);
    var b = normalizedTicket(right);
    return !!a && !!b && (a === b || safeText(left, "") === safeText(right, ""));
  }

  function fitDisplayTitle() {
    if (!nodes.name) return;
    nodes.name.style.fontSize = "";
    nodes.name.style.whiteSpace = "";
    nodes.name.style.display = "";
    nodes.name.style.webkitLineClamp = "";
    nodes.name.style.webkitBoxOrient = "";
    var size = parseFloat(getComputedStyle(nodes.name).fontSize) || 36;
    var minSize = 14;
    while (nodes.name.scrollWidth > nodes.name.clientWidth + 2 && size > minSize) {
      size -= 2;
      nodes.name.style.fontSize = size + "px";
    }
    if (nodes.name.scrollWidth > nodes.name.clientWidth + 2) {
      nodes.name.style.whiteSpace = "normal";
      nodes.name.style.display = "-webkit-box";
      nodes.name.style.webkitLineClamp = "2";
      nodes.name.style.webkitBoxOrient = "vertical";
    }
  }

  function sameData(next) {
    return ["name", "note", "text1", "text2", "order1", "order2", "media", "alert"].every(function (suffix) {
      return valueFor(next, suffix, "") === valueFor(lastData, suffix, "");
    });
  }

  function render(data) {
    if (!userConfirmed) return;
    if (sameData(data)) return;
    lastData = Object.assign({}, lastData, data || {});

    var title = valueFor(lastData, "name", baseTitle);
    var note = valueFor(lastData, "note", "");
    var text1 = valueFor(lastData, "text1", "Đang gọi");
    var text2 = valueFor(lastData, "text2", "");
    var order1 = splitOrders(valueFor(lastData, "order1", ""));
    var order2 = splitOrders(valueFor(lastData, "order2", ""));
    var media = valueFor(lastData, "media", "");
    var alertValue = valueFor(lastData, "alert", "");

    document.title = title;
    if (nodes.name) {
      nodes.name.textContent = title;
      setTimeout(fitDisplayTitle, 0);
    }
    if (nodes.note) {
      nodes.note.textContent = note;
      nodes.note.hidden = !note;
    }

    var effectiveLayout = layout;
    var mediaNode = (effectiveLayout === "media-top" || effectiveLayout === "media-side") ? renderMedia(media) : null;
    if (!mediaNode && (effectiveLayout === "media-top" || effectiveLayout === "media-side")) {
      effectiveLayout = order2.length || text2 ? "two-column" : "single-column";
    }
    if (effectiveLayout === "single-column") {
      order2 = [];
      text2 = "";
    }

    nodes.main.className = "qt-display-main";
    if (effectiveLayout === "media-top") nodes.main.className += " has-media";
    if (effectiveLayout === "media-side") nodes.main.className += " has-media media-side";
    nodes.main.innerHTML = "";

    if (mediaNode) nodes.main.appendChild(mediaNode);

    var columns = document.createElement("div");
    columns.className = "qt-number-columns";
    columns.appendChild(renderColumn(text1, order1, alertValue));
    if (order2.length || text2) columns.appendChild(renderColumn(text2 || "Đang gọi", order2, alertValue));
    nodes.main.appendChild(columns);
    setTimeout(startAutoScroll, 80);

    detectFollow(order1.concat(order2), alertValue);
  }

  function beep() {
    if (!soundEnabled) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(function () {
        osc.stop();
        ctx.close();
      }, 420);
    } catch (error) {}
  }

  function showAlert(text) {
    var alert = document.createElement("div");
    alert.className = "qt-alert";
    alert.textContent = text;
    document.body.appendChild(alert);
    beep();
    try {
      if (navigator.vibrate) navigator.vibrate([600, 250, 600, 250, 600]);
    } catch (error) {}
    setTimeout(function () {
      alert.remove();
    }, 5500);
  }

  function detectFollow(orders, alertValue) {
    if (alertValue && alertValue !== lastAlert) {
      lastAlert = alertValue;
      showAlert(alertValue + " đến lượt");
    }
    if (!followNumber) return;
    var found = orders.some(function (number) { return ticketsMatch(number, followNumber); });
    if (found && lastAlert !== "follow:" + followNumber) {
      lastAlert = "follow:" + followNumber;
      showAlert(followNumber + " đến lượt");
    }
  }

  function confirmFollow() {
    if (!followNumber) return Promise.resolve();
    if (nodes.followChip) {
      nodes.followChip.hidden = false;
      nodes.followChip.textContent = "Số của bạn: " + followNumber;
    }
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.className = "qt-alert";
      overlay.textContent = "Số của bạn: " + followNumber;
      var button = document.createElement("button");
      button.className = "qt-button primary";
      button.type = "button";
      button.textContent = "OK";
      button.style.marginTop = "14px";
      button.addEventListener("click", function () {
        userConfirmed = true;
        overlay.remove();
        resolve();
      });
      overlay.appendChild(document.createElement("br"));
      overlay.appendChild(button);
      document.body.appendChild(overlay);
    });
  }

  function connect() {
    if (!context.ioid || !context.pageId) {
      setStatus("Đang chờ", false);
      return;
    }
    if (source) {
      source.close();
      source = null;
    }
    var url = "/api/iot-page-realtime/" + encodeURIComponent(context.ioid) + "/" + encodeURIComponent(context.pageId) + "?historyMs=0";
    source = new EventSource(url);
    source.onopen = function () {
      reconnectCount = 0;
      setStatus("Trực tuyến", true);
    };
    source.onmessage = function (event) {
      try {
        var payload = JSON.parse(event.data);
        if (payload.type === "telemetry" && payload.payload) render(payload.payload);
      } catch (error) {}
    };
    source.onerror = function () {
      setStatus("Mất kết nối", false);
      if (source) source.close();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, Math.min(1500 + reconnectCount * 700, 9000));
      reconnectCount += 1;
    };
  }

  function acquireWakeLock() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request("screen").catch(function () {});
      }
    } catch (error) {}
  }

  function loadLatest() {
    if (!context.ioid || !context.pageId) return;
    fetch("/api/iot-page-telemetry/" + encodeURIComponent(context.ioid) + "/" + encodeURIComponent(context.pageId), {
      credentials: "same-origin"
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (body) {
        if (!response.ok) throw new Error(body && body.error || "Không đọc được dữ liệu.");
        if (body && body.c2 && body.c2.payload) render(body.c2.payload);
      });
    }).catch(function () {});
  }

  nodes.body.setAttribute("data-queue-theme", theme);
  if (nodes.name) nodes.name.textContent = baseTitle;
  setTimeout(fitDisplayTitle, 0);
  acquireWakeLock();
  confirmFollow().then(function () {
    loadLatest();
    connect();
  });
  window.addEventListener("offline", function () {
    setStatus("Mất mạng", false);
    if (source) source.close();
  });
  window.addEventListener("online", function () {
    connect();
  });
  window.addEventListener("resize", fitDisplayTitle);
})();
