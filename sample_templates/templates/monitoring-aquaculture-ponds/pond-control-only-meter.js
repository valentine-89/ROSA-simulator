(function () {
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

  function numericValue(value) {
    if (typeof value === "number" && isFinite(value)) return value;
    var text = String(value == null ? "" : value).trim();
    if (!text) return null;
    var match = text.match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function formatNumber(value, digits) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return "--";
    return numeric.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatValue(value, digits, unit) {
    var numeric = numericValue(value);
    if (numeric === null) return "--";
    return formatNumber(numeric, digits) + (unit ? " " + unit : "");
  }

  function formatEnergy(valueWh) {
    var numeric = numericValue(valueWh);
    if (numeric === null) return "--";
    return formatNumber(numeric / 1000, 2) + " kWh";
  }

  function formatTime(timestamp) {
    if (!timestamp) return "--";
    try {
      return new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (error) {
      return "--";
    }
  }

  function buildTimeseriesUrl(sessionId, syncId, fields, from, to) {
    if (!sessionId || !syncId || !fields.length) return "";
    var params = new URLSearchParams();
    params.set("from", String(from));
    params.set("to", String(to));
    params.set("fields", fields.join(","));
    return "/api/" + encodeURIComponent(sessionId) + "/" + encodeURIComponent(syncId) + "/iotimeseries?" + params.toString();
  }

  function buildStreamUrl(sessionId, fields) {
    if (!sessionId || !fields.length) return "";
    var params = new URLSearchParams();
    params.set("historyMs", "0");
    params.set("fields", fields.join(","));
    return "/api/" + encodeURIComponent(sessionId) + "/stream?" + params.toString();
  }

  function unique(values) {
    return values.filter(Boolean).filter(function (value, index, list) {
      return list.indexOf(value) === index;
    });
  }

  function normalizeMeterFields(meter) {
    var source = meter && typeof meter === "object" ? meter : {};
    return {
      title: safeText(source.title, ""),
      voltage: safeText(source.voltage, ""),
      current1: safeText(source.current1, ""),
      current2: safeText(source.current2, ""),
      current3: safeText(source.current3, ""),
      temperature: safeText(source.temperature, ""),
      energy: safeText(source.energy, "")
    };
  }

  function hasMeterFields(fields) {
    return !!(fields && (fields.voltage || fields.current1 || fields.current2 || fields.current3 || fields.temperature || fields.energy));
  }

  function getMeterFieldsFromControl(control) {
    var fields = normalizeMeterFields(control && control.meter);
    return hasMeterFields(fields) ? fields : null;
  }

  function getUi(ui, path, fallback) {
    var parts = String(path || "").split(".");
    var node = ui || {};
    for (var index = 0; index < parts.length; index += 1) {
      if (!node || typeof node !== "object" || !(parts[index] in node)) return fallback;
      node = node[parts[index]];
    }
    return node == null || node === "" ? fallback : node;
  }

  function formatUi(ui, path, fallback, values) {
    var text = String(getUi(ui, path, fallback) || "");
    Object.keys(values || {}).forEach(function (key) {
      text = text.replace(new RegExp("\\{" + key + "\\}", "g"), String(values[key]));
    });
    return text;
  }

  function appendSeriesPoint(series, point, historyMs) {
    if (!series || !point || !Number.isFinite(point.ts) || !Number.isFinite(point.value)) return;
    var last = series.length ? series[series.length - 1] : null;
    if (last && last.ts === point.ts && last.value === point.value) return;
    series.push(point);
    var minTs = Date.now() - historyMs;
    while (series.length && series[0].ts < minTs) series.shift();
  }

  function clearSeries(meter) {
    Object.keys(meter.series).forEach(function (key) {
      meter.series[key] = [];
    });
  }

  function createChartCardHtml(key, title, legendHtml, pathHtml, thresholdHtml, pointHtml) {
    return ""
      + "<section class=\"chart-card meter-chart-card\" data-chart-card=\"" + esc(key) + "\">"
      + "<div class=\"chart-head\"><strong data-chart-title>" + esc(title) + "</strong><div class=\"chart-legend\">" + legendHtml + "</div></div>"
      + "<div class=\"chart-shell\" data-chart-shell>"
      + "<div class=\"chart-y-label\" data-align=\"max\" data-chart-max>0</div>"
      + "<div class=\"chart-y-label\" data-align=\"min\" data-chart-min>0</div>"
      + "<svg class=\"chart-svg\" viewBox=\"0 0 360 240\" preserveAspectRatio=\"none\">"
      + "<g class=\"chart-grid\" data-chart-grid></g>"
      + "<g class=\"chart-axis\"><line x1=\"46\" y1=\"198\" x2=\"340\" y2=\"198\"></line><line x1=\"46\" y1=\"16\" x2=\"46\" y2=\"198\"></line></g>"
      + "<path class=\"chart-empty\" data-chart-empty d=\"M46 106 H340\"></path>"
      + thresholdHtml
      + pathHtml
      + "<line class=\"chart-hover-line\" data-chart-hover-line x1=\"0\" y1=\"16\" x2=\"0\" y2=\"198\"></line>"
      + pointHtml
      + "<rect class=\"chart-hitbox\" data-chart-hitbox x=\"46\" y=\"16\" width=\"294\" height=\"182\"></rect>"
      + "</svg><div class=\"chart-tooltip\" data-chart-tooltip></div></div></section>";
  }

  function createModal(ui) {
    var existing = document.getElementById("control-only-meter-modal");
    if (existing) return existing;
    var modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "control-only-meter-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = ""
      + "<div class=\"modal-card modal-card-meter control-only-meter-modal-card\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"control-only-meter-title\">"
      + "<div class=\"modal-head\"><div><h2 id=\"control-only-meter-title\">" + esc(getUi(ui, "meterModal.idleTitle", "Electrical meter")) + "</h2>"
      + "<p id=\"control-only-meter-description\">" + esc(getUi(ui, "meterModal.description", "Voltage, current, temperature and energy for this contactor.")) + "</p></div>"
      + "<button class=\"icon-button\" type=\"button\" data-meter-close aria-label=\"" + esc(getUi(ui, "meterModal.closeAriaLabel", "Close dialog")) + "\">&#215;</button></div>"
      + "<div class=\"meter-grid\">"
      + "<section class=\"metric-card meter-energy-card\"><strong data-energy-title>" + esc(getUi(ui, "meterModal.energyTitle", "Energy consumption")) + "</strong><div class=\"metric-value\" data-energy-value>--</div></section>"
      + createChartCardHtml("voltage", getUi(ui, "meterModal.voltageTitle", "Voltage"),
        "<span class=\"chart-legend-item\"><span class=\"chart-legend-dot\" style=\"--dot-color: var(--theme-series-1);\"></span><span class=\"chart-live-value\" data-live=\"voltage\">--</span></span>",
        "<path class=\"chart-path\" data-path=\"voltage\" style=\"--line-color: var(--theme-series-1);\" d=\"\"></path>",
        "",
        "<circle class=\"chart-hover-point\" data-point=\"voltage\" style=\"--line-color: var(--theme-series-1);\" r=\"4\" cx=\"0\" cy=\"0\"></circle>")
      + createChartCardHtml("current", getUi(ui, "meterModal.currentTitle", "Current"),
        "<span class=\"chart-legend-item\"><span class=\"chart-legend-dot\" style=\"--dot-color: var(--theme-series-3);\"></span><span class=\"chart-live-value\" data-live=\"current1\">--</span></span>"
        + "<span class=\"chart-legend-item\"><span class=\"chart-legend-dot\" style=\"--dot-color: var(--theme-series-4);\"></span><span class=\"chart-live-value\" data-live=\"current2\">--</span></span>"
        + "<span class=\"chart-legend-item\"><span class=\"chart-legend-dot\" style=\"--dot-color: var(--theme-series-5);\"></span><span class=\"chart-live-value\" data-live=\"current3\">--</span></span>",
        "<path class=\"chart-path\" data-path=\"current1\" style=\"--line-color: var(--theme-series-3);\" d=\"\"></path>"
        + "<path class=\"chart-path\" data-path=\"current2\" style=\"--line-color: var(--theme-series-4);\" d=\"\"></path>"
        + "<path class=\"chart-path\" data-path=\"current3\" style=\"--line-color: var(--theme-series-5);\" d=\"\"></path>",
        "",
        "<circle class=\"chart-hover-point\" data-point=\"current1\" style=\"--line-color: var(--theme-series-3);\" r=\"4\" cx=\"0\" cy=\"0\"></circle>"
        + "<circle class=\"chart-hover-point\" data-point=\"current2\" style=\"--line-color: var(--theme-series-4);\" r=\"4\" cx=\"0\" cy=\"0\"></circle>"
        + "<circle class=\"chart-hover-point\" data-point=\"current3\" style=\"--line-color: var(--theme-series-5);\" r=\"4\" cx=\"0\" cy=\"0\"></circle>")
      + createChartCardHtml("temperature", getUi(ui, "meterModal.temperatureTitle", "Temperature"),
        "<span class=\"chart-legend-item\"><span class=\"chart-legend-dot\" style=\"--dot-color: var(--theme-series-5);\"></span><span class=\"chart-live-value\" data-live=\"temperature\">--</span></span>",
        "<path class=\"chart-path\" data-path=\"temperature\" style=\"--line-color: var(--theme-series-5);\" d=\"\"></path>",
        "",
        "<circle class=\"chart-hover-point\" data-point=\"temperature\" style=\"--line-color: var(--theme-series-5);\" r=\"4\" cx=\"0\" cy=\"0\"></circle>")
      + "</div></div>";
    document.body.appendChild(modal);
    return modal;
  }

  function chartMeta(card, series, options) {
    return {
      card: card,
      shell: card.querySelector("[data-chart-shell]"),
      grid: card.querySelector("[data-chart-grid]"),
      max: card.querySelector("[data-chart-max]"),
      min: card.querySelector("[data-chart-min]"),
      empty: card.querySelector("[data-chart-empty]"),
      hoverLine: card.querySelector("[data-chart-hover-line]"),
      hitbox: card.querySelector("[data-chart-hitbox]"),
      tooltip: card.querySelector("[data-chart-tooltip]"),
      left: 46,
      top: 16,
      width: 294,
      height: 182,
      floorMode: options.floorMode || "",
      floorValue: options.floorValue,
      ceilingValue: options.ceilingValue,
      minRange: options.minRange || 0,
      series: series
    };
  }

  function resolveBounds(values, meta) {
    var minValue = Math.min.apply(null, values);
    var maxValue = Math.max.apply(null, values);
    if (meta.floorMode === "zero" && minValue > 0) minValue = 0;
    if (typeof meta.floorValue === "number" && isFinite(meta.floorValue) && minValue > meta.floorValue) minValue = meta.floorValue;
    if (typeof meta.ceilingValue === "number" && isFinite(meta.ceilingValue) && maxValue < meta.ceilingValue) maxValue = meta.ceilingValue;
    if (minValue === maxValue) {
      minValue -= 1;
      maxValue += 1;
    }
    if (meta.minRange > 0 && (maxValue - minValue) < meta.minRange) {
      if (meta.floorMode === "zero" || typeof meta.floorValue === "number") {
        maxValue = minValue + meta.minRange;
      } else {
        var mid = (minValue + maxValue) / 2;
        minValue = mid - (meta.minRange / 2);
        maxValue = mid + (meta.minRange / 2);
      }
    }
    return { minValue: minValue, maxValue: maxValue };
  }

  function hideTooltip(meta) {
    if (!meta || !meta.tooltip) return;
    meta.tooltip.style.opacity = "0";
    meta.tooltip.style.transform = "translate3d(0, 8px, 0)";
    if (meta.hoverLine) meta.hoverLine.style.opacity = "0";
    meta.series.forEach(function (entry) {
      if (entry.point) entry.point.style.opacity = "0";
    });
  }

  function renderChart(meter, meta, historyMs) {
    if (!meter || !meta || !meta.grid) return;
    var left = meta.left;
    var top = meta.top;
    var width = meta.width;
    var height = meta.height;
    var bottom = top + height;
    var startTs = Date.now() - historyMs;
    var tsSpan = historyMs;
    var visible = meta.series.map(function (entry) {
      return meter.series[entry.key].filter(function (point) { return point.ts >= startTs; });
    });
    var allPoints = visible.reduce(function (result, series) { return result.concat(series); }, []);
    var gridHtml = "";
    for (var row = 0; row <= 4; row += 1) {
      var y = top + ((height / 4) * row);
      gridHtml += "<line x1=\"" + left + "\" y1=\"" + y.toFixed(2) + "\" x2=\"" + (left + width) + "\" y2=\"" + y.toFixed(2) + "\"></line>";
    }
    meta.grid.innerHTML = gridHtml;
    if (allPoints.length <= 1) {
      meta.empty.setAttribute("d", "M" + left + " " + (top + height / 2) + " H" + (left + width));
      meta.series.forEach(function (entry) { if (entry.path) entry.path.setAttribute("d", ""); });
      meta.min.textContent = "0";
      meta.max.textContent = "0";
      meta.bounds = null;
      hideTooltip(meta);
      return;
    }
    var values = allPoints.map(function (point) { return point.value; });
    var bounds = resolveBounds(values, meta);
    function pathFromSeries(series) {
      if (series.length <= 1) return "";
      var path = "";
      series.forEach(function (point, index) {
        var x = left + (((point.ts - startTs) / tsSpan) * width);
        var y = bottom - (((point.value - bounds.minValue) / (bounds.maxValue - bounds.minValue)) * height);
        path += (index === 0 ? "M" : " L") + x.toFixed(2) + " " + y.toFixed(2);
      });
      return path;
    }
    meta.empty.setAttribute("d", "");
    meta.series.forEach(function (entry, index) {
      if (entry.path) entry.path.setAttribute("d", pathFromSeries(visible[index]));
    });
    meta.min.textContent = String(Math.round(bounds.minValue));
    meta.max.textContent = String(Math.round(bounds.maxValue));
    meta.bounds = { left: left, top: top, width: width, height: height, bottom: bottom, startTs: startTs, tsSpan: tsSpan, minValue: bounds.minValue, maxValue: bounds.maxValue };
  }

  function bindHover(getMeter, meta) {
    if (!meta || !meta.hitbox || !meta.tooltip) return;
    meta.hitbox.addEventListener("mousemove", function (event) {
      if (!meta.bounds) return;
      var meter = getMeter();
      if (!meter) return;
      var bounds = meta.bounds;
      var rect = meta.hitbox.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
      var targetTs = bounds.startTs + ((relativeX / rect.width) * bounds.tsSpan);
      var anchor = null;
      meta.series.forEach(function (entry) {
        meter.series[entry.key].forEach(function (point) {
          if (point.ts < bounds.startTs) return;
          if (!anchor || Math.abs(point.ts - targetTs) < Math.abs(anchor.ts - targetTs)) anchor = point;
        });
      });
      if (!anchor) return;
      var anchorX = null;
      var rows = "";
      meta.series.forEach(function (entry) {
        var nearest = null;
        meter.series[entry.key].forEach(function (point) {
          if (point.ts < bounds.startTs) return;
          if (!nearest || Math.abs(point.ts - anchor.ts) < Math.abs(nearest.ts - anchor.ts)) nearest = point;
        });
        if (!nearest) {
          if (entry.point) entry.point.style.opacity = "0";
          return;
        }
        var pointX = bounds.left + (((nearest.ts - bounds.startTs) / bounds.tsSpan) * bounds.width);
        var pointY = bounds.bottom - (((nearest.value - bounds.minValue) / (bounds.maxValue - bounds.minValue)) * bounds.height);
        if (anchorX === null) anchorX = pointX;
        if (entry.point) {
          entry.point.setAttribute("cx", pointX.toFixed(2));
          entry.point.setAttribute("cy", pointY.toFixed(2));
          entry.point.style.opacity = "1";
        }
        rows += "<div class=\"chart-tooltip-row\"><span class=\"chart-tooltip-label\"><span class=\"chart-legend-dot\" style=\"--dot-color:" + esc(entry.color) + ";background:" + esc(entry.color) + ";\"></span>" + esc(entry.label) + "</span><strong>" + esc(formatValue(nearest.value, entry.digits, entry.unit)) + "</strong></div>";
      });
      if (anchorX === null) return;
      meta.hoverLine.setAttribute("x1", anchorX.toFixed(2));
      meta.hoverLine.setAttribute("x2", anchorX.toFixed(2));
      meta.hoverLine.style.opacity = "1";
      meta.tooltip.innerHTML = "<strong>" + esc(formatTime(anchor.ts)) + "</strong>" + rows;
      meta.tooltip.style.opacity = "1";
      meta.tooltip.style.transform = "translate3d(0, 0, 0)";
      meta.tooltip.style.left = Math.min(Math.max(anchorX + 10, 8), Math.max(8, (meta.shell.clientWidth || 360) - 192)) + "px";
      meta.tooltip.style.top = "12px";
    });
    meta.hitbox.addEventListener("mouseleave", function () { hideTooltip(meta); });
  }

  function create(options) {
    var ui = options.ui || {};
    var syncId = String(options.syncId || "").trim();
    var showToast = typeof options.showToast === "function" ? options.showToast : function () {};
    var historyMs = Number(getUi(ui, "meterModal.historyMs", options.historyMs || 6 * 60 * 60 * 1000)) || (6 * 60 * 60 * 1000);
    var modal = createModal(ui);
    var titleNode = modal.querySelector("#control-only-meter-title");
    var descriptionNode = modal.querySelector("#control-only-meter-description");
    var energyTitleNode = modal.querySelector("[data-energy-title]");
    var energyValueNode = modal.querySelector("[data-energy-value]");
    var closeButton = modal.querySelector("[data-meter-close]");
    var meters = [];
    var fieldIndex = {};
    var activeMeter = null;
    var activeRequestId = 0;
    var activeEventSource = null;
    var activeReconnectTimer = null;

    var charts = {
      voltage: chartMeta(modal.querySelector("[data-chart-card=\"voltage\"]"), [
        { key: "voltage", label: getUi(ui, "meterModal.seriesLabels.voltage", "V"), unit: "V", digits: 1, color: "var(--theme-series-1)" }
      ], { floorMode: "baseline", floorValue: 180, ceilingValue: 260, minRange: 80 }),
      current: chartMeta(modal.querySelector("[data-chart-card=\"current\"]"), [
        { key: "current1", label: getUi(ui, "meterModal.seriesLabels.current1", "I1"), unit: "A", digits: 2, color: "var(--theme-series-3)" },
        { key: "current2", label: getUi(ui, "meterModal.seriesLabels.current2", "I2"), unit: "A", digits: 2, color: "var(--theme-series-4)" },
        { key: "current3", label: getUi(ui, "meterModal.seriesLabels.current3", "I3"), unit: "A", digits: 2, color: "var(--theme-series-5)" }
      ], { floorMode: "zero", minRange: 5 }),
      temperature: chartMeta(modal.querySelector("[data-chart-card=\"temperature\"]"), [
        { key: "temperature", label: getUi(ui, "meterModal.seriesLabels.temperature", "Temp"), unit: "°C", digits: 1, color: "var(--theme-series-5)" }
      ], { floorMode: "zero", minRange: 20 })
    };

    Object.keys(charts).forEach(function (key) {
      charts[key].baseSeries = charts[key].series.slice();
      charts[key].series.forEach(function (entry) {
        entry.path = charts[key].card.querySelector("[data-path=\"" + entry.key + "\"]");
        entry.point = charts[key].card.querySelector("[data-point=\"" + entry.key + "\"]");
      });
    });

    function registerField(sessionId, field, meter, key) {
      var normalized = String(field || "").trim().toLowerCase();
      if (!normalized) return;
      var bucketKey = sessionId + "\n" + normalized;
      if (!fieldIndex[bucketKey]) fieldIndex[bucketKey] = [];
      fieldIndex[bucketKey].push({ meter: meter, key: key });
    }

    function getMeterFieldList(meter) {
      return unique([meter.fields.voltage, meter.fields.current1, meter.fields.current2, meter.fields.current3, meter.fields.temperature, meter.fields.energy]);
    }

    function updateLiveNodes(meter) {
      if (!meter) return;
      var latest = meter.latestValues;
      var liveNodes = modal.querySelectorAll("[data-live]");
      Array.prototype.forEach.call(liveNodes, function (node) {
        var key = node.getAttribute("data-live");
        var unit = key === "voltage" ? "V" : key === "temperature" ? "°C" : "A";
        var digits = key === "voltage" || key === "temperature" ? 1 : 2;
        node.textContent = Number.isFinite(latest[key]) ? formatValue(latest[key], digits, unit) : "--";
      });
      if (energyValueNode) energyValueNode.textContent = meter.energyDisplay || "--";
    }

    function refreshModal() {
      var meter = activeMeter;
      if (!meter) return;
      if (titleNode) titleNode.textContent = formatUi(ui, "meterModal.title", "Electrical meter | {label}", { label: meter.label });
      if (descriptionNode) descriptionNode.textContent = formatUi(ui, "meterModal.description", "Voltage, current, temperature and energy for {label}.", { label: meter.label });
      if (energyTitleNode) energyTitleNode.textContent = getUi(ui, "meterModal.energyTitle", "Energy consumption");
      updateLiveNodes(meter);

      charts.voltage.card.hidden = !meter.fields.voltage;
      charts.current.card.hidden = !(meter.fields.current1 || meter.fields.current2 || meter.fields.current3);
      charts.temperature.card.hidden = !meter.fields.temperature;
      charts.voltage.series = charts.voltage.baseSeries.filter(function (entry) { return !!meter.fields[entry.key]; });
      charts.current.series = charts.current.baseSeries.filter(function (entry) { return !!meter.fields[entry.key]; });
      charts.temperature.series = charts.temperature.baseSeries.filter(function (entry) { return !!meter.fields[entry.key]; });

      Object.keys(charts).forEach(function (key) {
        hideTooltip(charts[key]);
        if (!charts[key].card.hidden) renderChart(meter, charts[key], historyMs);
      });
    }

    function loadHistory(meter) {
      if (!meter || !syncId) return Promise.resolve();
      var to = Date.now();
      var from = to - historyMs;
      var fields = getMeterFieldList(meter);
      var url = buildTimeseriesUrl(meter.sessionId, syncId, fields, from, to);
      if (!url) return Promise.resolve();
      var requestId = ++activeRequestId;
      return fetch(url, { cache: "no-store" }).then(function (response) {
        if (!response.ok) return null;
        return response.json();
      }).then(function (payload) {
        if (!payload || requestId !== activeRequestId) return;
        var rows = payload.c2 && Array.isArray(payload.c2.rows) ? payload.c2.rows : [];
        clearSeries(meter);
        rows.forEach(function (row) {
          var value = typeof row.last !== "undefined" ? row.last : typeof row.value !== "undefined" ? row.value : row.avg;
          updateField(meter.sessionId, row.field, value, row.ts || Date.now(), true);
        });
        refreshModal();
      }).catch(function () {
        showToast(getUi(ui, "meterModal.loadFailed", "Unable to load meter history."), "error");
      });
    }

    function closeActiveStream() {
      if (activeReconnectTimer) {
        window.clearTimeout(activeReconnectTimer);
        activeReconnectTimer = null;
      }
      if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
      }
    }

    function handleActiveStreamPayload(meter, payload) {
      if (!meter || activeMeter !== meter || !payload || !payload.type) return;
      if (payload.type === "telemetry" && payload.payload && typeof payload.payload === "object") {
        Object.keys(payload.payload).forEach(function (field) {
          updateField(meter.sessionId, field, payload.payload[field], payload.serverTime || Date.now());
        });
      } else if (payload.type === "timeseries" && Array.isArray(payload.rows)) {
        payload.rows.forEach(function (row) {
          updateField(meter.sessionId, row.field, typeof row.last !== "undefined" ? row.last : row.value, row.ts || Date.now());
        });
      }
    }

    function connectActiveStream(meter) {
      closeActiveStream();
      if (!meter || typeof EventSource === "undefined") return;
      var fields = getMeterFieldList(meter);
      var url = buildStreamUrl(meter.sessionId, fields);
      if (!url) return;
      try {
        activeEventSource = new EventSource(url);
        activeEventSource.onmessage = function (event) {
          try { handleActiveStreamPayload(meter, JSON.parse(event.data)); } catch (error) {}
        };
        activeEventSource.onerror = function () {
          closeActiveStream();
          if (activeMeter !== meter) return;
          activeReconnectTimer = window.setTimeout(function () {
            activeReconnectTimer = null;
            if (activeMeter === meter) connectActiveStream(meter);
          }, 3000);
        };
      } catch (error) {
        activeReconnectTimer = window.setTimeout(function () {
          activeReconnectTimer = null;
          if (activeMeter === meter) connectActiveStream(meter);
        }, 3000);
      }
    }

    function openMeter(meter) {
      if (!meter) {
        showToast(getUi(ui, "meterModal.unavailable", "Meter data is not configured for this contactor."), "error");
        return;
      }
      activeMeter = meter;
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      refreshModal();
      loadHistory(meter);
      connectActiveStream(meter);
    }

    function closeMeter() {
      activeMeter = null;
      closeActiveStream();
      activeRequestId += 1;
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      Object.keys(charts).forEach(function (key) { hideTooltip(charts[key]); });
    }

    function updateField(sessionId, field, value, timestamp, fromHistory) {
      var key = String(sessionId || "") + "\n" + String(field || "").trim().toLowerCase();
      var matches = fieldIndex[key] || [];
      var ts = Number(timestamp || Date.now());
      matches.forEach(function (match) {
        var meter = match.meter;
        var seriesKey = match.key;
        if (seriesKey === "energy") {
          meter.energyDisplay = formatEnergy(value);
        } else {
          var numeric = numericValue(value);
          if (numeric !== null) {
            meter.latestValues[seriesKey] = numeric;
            appendSeriesPoint(meter.series[seriesKey], { ts: ts, value: numeric }, historyMs);
          }
        }
        if (!fromHistory && activeMeter === meter) refreshModal();
      });
    }

    function bindControl(control) {
      var fields = getMeterFieldsFromControl(control);
      if (!fields || !control || !control.meterButton) return;
      var meter = {
        control: control,
        label: safeText(fields.title, control.label),
        sessionId: control.sessionId,
        fields: fields,
        latestValues: { voltage: NaN, current1: NaN, current2: NaN, current3: NaN, temperature: NaN },
        energyDisplay: "--",
        series: { voltage: [], current1: [], current2: [], current3: [], temperature: [] }
      };
      meters.push(meter);
      ["voltage", "current1", "current2", "current3", "temperature", "energy"].forEach(function (key) {
        registerField(control.sessionId, fields[key], meter, key);
      });
      control.meter = fields;
      control.meterState = meter;
      control.meterButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openMeter(meter);
      });
    }

    closeButton.addEventListener("click", closeMeter);
    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeMeter();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && modal.classList.contains("is-open")) closeMeter();
    });
    Object.keys(charts).forEach(function (key) {
      bindHover(function () { return activeMeter; }, charts[key]);
    });

    return {
      bindControl: bindControl,
      updateField: updateField,
      getFields: function (controlList) {
        var fields = [];
        (controlList || []).forEach(function (control) {
          var meterFields = getMeterFieldsFromControl(control);
          if (!meterFields) return;
          fields = fields.concat([meterFields.voltage, meterFields.current1, meterFields.current2, meterFields.current3, meterFields.temperature, meterFields.energy]);
        });
        return unique(fields.map(function (field) { return String(field || "").trim(); }).filter(Boolean));
      }
    };
  }

  window.PondControlOnlyMeters = {
    create: create,
    getMeterFieldsFromControl: getMeterFieldsFromControl
  };
})();
