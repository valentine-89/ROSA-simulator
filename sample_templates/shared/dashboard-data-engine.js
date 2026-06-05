(function () {
  function renderBusinessReportLayout(manifest, helpers) {
    var root = helpers.getBusinessReportRoot();
    if (!root) {
      return;
    }

    var normalizedManifest = manifest || helpers.normalizeBusinessReportManifest();
    var kpis = Array.isArray(normalizedManifest && normalizedManifest.kpis) ? normalizedManifest.kpis : [];
    var surfaces = Array.isArray(normalizedManifest && normalizedManifest.surfaces) ? normalizedManifest.surfaces : [];

    root.innerHTML = "";

    if (kpis.length > 0) {
      var kpiGrid = document.createElement("div");
      kpiGrid.className = "data-kpi-grid";
      kpis.forEach(function (definition) {
        var card = helpers.cloneTemplateById("ai-bridge-template-data-kpi-card");
        if (!card) {
          return;
        }
        var titleNode = card.querySelector("small");
        if (titleNode) {
          titleNode.textContent = String((definition && definition.title) || "--");
        }
        helpers.applyWidgetDataAttributes(card, definition || {});
        kpiGrid.appendChild(card);
      });
      root.appendChild(kpiGrid);
    }

    if (surfaces.length > 0) {
      var surfaceGrid = document.createElement("div");
      surfaceGrid.className = "data-report-grid";
      surfaces.forEach(function (definition) {
        var card = helpers.cloneTemplateById("ai-bridge-template-data-surface");
        if (!card) {
          return;
        }
        var titleNode = card.querySelector("h3");
        if (titleNode) {
          titleNode.textContent = String((definition && definition.title) || "--");
        }
        var slot = card.querySelector(".data-widget-slot");
        if (!slot) {
          return;
        }

        var widgetType = String((definition && definition.widgetType) || "chart").trim().toLowerCase();
        var widget = document.createElement("div");
        if (widgetType === "table") {
          widget.className = "data-table-shell";
          widget.setAttribute("data-ai-data-table", "");
        } else {
          widget.className = "data-chart-shell";
          widget.setAttribute("data-ai-data-chart", "");
        }

        helpers.applyWidgetDataAttributes(widget, definition || {});
        slot.replaceWith(widget);
        surfaceGrid.appendChild(card);
      });
      root.appendChild(surfaceGrid);
    }
  }

  async function executeMacroRequest(endpoint, payload, sessionIndex, helpers) {
    var rawEndpoint = String(endpoint || "data").trim().toLowerCase();
    var normalizedEndpoint = rawEndpoint === "report" ? "report" : "data";
    var sessionConfig = helpers.getSessionByIndex(sessionIndex);
    var sessionId = String((sessionConfig && sessionConfig.sessionId) || "").trim();
    var url = helpers.buildDataApiUrl(sessionId);
    if (!url) {
      throw new Error("Set dataSyncId in the dashboard config or syncid in the page URL to enable IoData reports.");
    }

    var gatewayPayload = { c1: normalizedEndpoint };
    if (payload && typeof payload === "object") {
      if (String(payload.macro || "").trim()) {
        gatewayPayload.c2 = String(payload.macro || "").trim();
      }
      Object.keys(payload).forEach(function (key) {
        if (key === "macro") {
          return;
        }
        var match = String(key || "").match(/^c(\d+)$/i);
        if (!match) {
          gatewayPayload[key] = payload[key];
          return;
        }
        var index = Number(match[1]);
        gatewayPayload["c" + String(index + 2)] = payload[key];
      });
    }

    var response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(gatewayPayload)
    });

    var rawText = await response.text();
    var data = helpers.normalizePayload(rawText);
    if (!response.ok) {
      throw new Error((data && data.error) || rawText || ("Request failed with status " + response.status));
    }

    if (!Array.isArray(data)) {
      throw new Error("The macro response must be a row array.");
    }

    return data;
  }

  function renderDataWidgetEmpty(element, message, isError, helpers) {
    if (!element) {
      return;
    }
    if (element.hasAttribute("data-ai-data-kpi")) {
      var strong = element.querySelector("strong");
      var span = element.querySelector("span");
      if (strong) {
        strong.textContent = "--";
      }
      if (span) {
        span.textContent = message;
      }
      element.classList.toggle("data-kpi-error", !!isError);
      return;
    }
    element.innerHTML = '<div class="data-widget-empty' + (isError ? ' error' : '') + '">' + helpers.escapeHtml(message) + '</div>';
  }

  function renderDataKpi(element, rows, helpers) {
    var valueNode = element && element.querySelector("strong");
    var field = String((element && element.getAttribute("data-ai-field")) || "").trim();
    var format = String((element && element.getAttribute("data-ai-format")) || "").trim();

    if (!valueNode) {
      return;
    }

    if (!Array.isArray(rows) || rows.length <= 0) {
      valueNode.textContent = "--";
      return;
    }

    var firstRow = rows[0] || {};
    var resolvedField = field || Object.keys(firstRow)[0] || "";
    var value = resolvedField ? firstRow[resolvedField] : "";
    valueNode.textContent = helpers.formatDataValue(value, format, element);
  }

  function renderDataTable(element, rows, helpers) {
    if (!element) {
      return;
    }

    if (!Array.isArray(rows) || rows.length <= 0) {
      renderDataWidgetEmpty(element, String(element.getAttribute("data-ai-empty") || "No rows returned."), false, helpers);
      return;
    }

    var configuredColumns = String(element.getAttribute("data-ai-columns") || "").split(",").map(function (value) {
      return value.trim();
    }).filter(Boolean);
    var columns = configuredColumns.length > 0 ? configuredColumns : Object.keys(rows[0] || {});
    var limit = Math.max(1, Math.min(50, parseInt(String(element.getAttribute("data-ai-limit") || "8"), 10) || 8));
    var bodyRows = rows.slice(0, limit).map(function (row) {
      return "<tr>" + columns.map(function (column) {
        return "<td>" + helpers.escapeHtml(row[column]) + "</td>";
      }).join("") + "</tr>";
    }).join("");

    element.innerHTML = '<table><thead><tr>' +
      columns.map(function (column) {
        return "<th>" + helpers.escapeHtml(helpers.humanizeLabel(column)) + "</th>";
      }).join("") +
      '</tr></thead><tbody>' + bodyRows + '</tbody></table>';
  }

  function renderDataChart(element, rows, helpers) {
    if (!element) {
      return;
    }

    if (!Array.isArray(rows) || rows.length <= 0) {
      renderDataWidgetEmpty(element, String(element.getAttribute("data-ai-empty") || "No rows returned."), false, helpers);
      return;
    }

    var xKey = String(element.getAttribute("data-ai-x") || "").trim();
    var yKey = String(element.getAttribute("data-ai-y") || "").trim();
    var chartType = String(element.getAttribute("data-ai-chart-type") || "bar").trim().toLowerCase();
    var format = String(element.getAttribute("data-ai-format") || "").trim();
    var points = rows.map(function (row) {
      var label = xKey ? row[xKey] : "";
      var numeric = helpers.extractNumericValue(yKey ? row[yKey] : null);
      return {
        label: String(label == null ? "" : label),
        value: numeric
      };
    }).filter(function (point) {
      return point.label && point.value !== null;
    }).slice(0, 8);

    if (points.length <= 0) {
      renderDataWidgetEmpty(element, String(element.getAttribute("data-ai-empty") || "No numeric chart rows returned."), false, helpers);
      return;
    }

    var width = 440;
    var height = chartType === "line" ? 236 : 220;
    var left = 46;
    var right = 16;
    var top = 16;
    var bottom = chartType === "line" ? 158 : 176;
    var innerWidth = width - left - right;
    var innerHeight = bottom - top;
    var maxValue = points.reduce(function (max, point) {
      return Math.max(max, Number(point.value || 0));
    }, 0);
    if (!maxValue || !isFinite(maxValue)) {
      maxValue = 1;
    }
    var grid = "";
    for (var step = 0; step <= 4; step += 1) {
      var y = top + (innerHeight / 4) * step;
      grid += '<line x1="' + left + '" y1="' + y.toFixed(2) + '" x2="' + (left + innerWidth) + '" y2="' + y.toFixed(2) + '"></line>';
    }

    var labelHtml = "";
    var valueHtml = "";
    var chartHtml = "";
    var linePath = "";
    var areaPath = "";
    var pointHtml = "";
    var gap = points.length > 1 ? innerWidth / (points.length - 1) : innerWidth;

    points.forEach(function (point, index) {
      var x = chartType === "bar"
        ? left + (innerWidth / points.length) * index + (innerWidth / points.length) * 0.16
        : left + gap * index;
      var normalized = Math.max(0, Number(point.value || 0)) / maxValue;
      var y = bottom - normalized * innerHeight;
      var displayLabel = helpers.formatChartLabelValue(point.label);
      var safeLabel = helpers.escapeHtml(displayLabel.length > 14 ? displayLabel.slice(0, 13) + "..." : displayLabel);
      var labelX = chartType === "bar" ? x + ((innerWidth / points.length) * 0.68) / 2 : x;
      if (chartType !== "line") {
        labelHtml += '<text x="' + labelX + '" y="198" text-anchor="middle">' + safeLabel + '</text>';
      }

      if (chartType === "bar") {
        var barWidth = Math.max(18, ((innerWidth / points.length) * 0.68));
        chartHtml += '<rect class="data-chart-bar" x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barWidth.toFixed(2) + '" height="' + Math.max(2, bottom - y).toFixed(2) + '" rx="10"></rect>';
        valueHtml += '<text x="' + (x + barWidth / 2).toFixed(2) + '" y="' + Math.max(12, y - 8).toFixed(2) + '" text-anchor="middle">' + helpers.escapeHtml(helpers.formatDataValue(point.value, format, element)) + '</text>';
        return;
      }

      linePath += (index === 0 ? "M" : " L") + x.toFixed(2) + " " + y.toFixed(2);
      areaPath += (index === 0 ? "M" : " L") + x.toFixed(2) + " " + y.toFixed(2);
      valueHtml += '<text x="' + x.toFixed(2) + '" y="' + Math.max(12, y - 8).toFixed(2) + '" text-anchor="middle">' + helpers.escapeHtml(helpers.formatDataValue(point.value, format, element)) + '</text>';
      pointHtml += '<g><circle class="data-chart-point" cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="4"></circle><circle class="data-chart-hit-point" cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="12" fill="transparent" data-label="' + helpers.escapeHtml(String(point.label || "")) + '" data-value="' + helpers.escapeHtml(helpers.formatDataValue(point.value, format, element)) + '"></circle></g>';
    });

    if (chartType !== "bar") {
      areaPath += " L" + (left + innerWidth) + " " + bottom + " L" + left + " " + bottom + " Z";
      chartHtml = '<path class="data-chart-area" d="' + areaPath + '"></path><path class="data-chart-line" d="' + linePath + '"></path>' + pointHtml;
    }

    element.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<g class="data-chart-grid">' + grid + '</g>' +
      chartHtml +
      valueHtml +
      labelHtml +
      '</svg>' +
      (chartType === "line" ? '<div class="data-chart-tooltip"><strong>--</strong><small>--</small></div>' : '');

    if (chartType === "line") {
      var tooltip = element.querySelector(".data-chart-tooltip");
      var hitPoints = element.querySelectorAll(".data-chart-hit-point");
      function hideTooltip() {
        if (!tooltip) {
          return;
        }
        tooltip.style.opacity = "0";
        tooltip.style.transform = "translateY(6px)";
      }
      function showTooltip(hitPoint) {
        if (!tooltip || !hitPoint) {
          return;
        }
        var valueText = String(hitPoint.getAttribute("data-value") || "--");
        var labelText = String(hitPoint.getAttribute("data-label") || "--");
        var cx = Number(hitPoint.getAttribute("cx") || 0);
        var cy = Number(hitPoint.getAttribute("cy") || 0);
        tooltip.style.opacity = "1";
        tooltip.style.transform = "translateY(0)";
        tooltip.style.left = Math.min(Math.max((cx / width) * element.clientWidth + 12, 8), Math.max(8, element.clientWidth - 132)) + "px";
        tooltip.style.top = Math.max(((cy / height) * element.clientHeight) - 10, 8) + "px";
        tooltip.innerHTML = "<strong>" + helpers.escapeHtml(valueText) + "</strong><small>" + helpers.escapeHtml(labelText) + "</small>";
      }
      Array.prototype.forEach.call(hitPoints, function (hitPoint) {
        hitPoint.addEventListener("mouseenter", function () { showTooltip(hitPoint); });
        hitPoint.addEventListener("mousemove", function () { showTooltip(hitPoint); });
        hitPoint.addEventListener("mouseleave", hideTooltip);
      });
      element.addEventListener("mouseleave", hideTooltip);
    }
  }

  async function refreshDataViews(helpers) {
    var widgets = helpers.queryDataWidgets();
    if (widgets.length <= 0) {
      return;
    }

    if (!helpers.getDataSyncId()) {
      helpers.setDataReportState("Set dataSyncId", "error");
      widgets.forEach(function (widget) {
        renderDataWidgetEmpty(widget, "Set dataSyncId in the dashboard config or syncid in the page URL to load IoData reports.", true, helpers);
      });
      return;
    }

    helpers.setDataReportLastRefreshAt(Date.now());
    helpers.setDataReportState("Loading reports...", "busy");
    var requestCache = new Map();
    var successCount = 0;
    var errorCount = 0;
    var widgetTasks = [];

    for (var index = 0; index < widgets.length; index += 1) {
      (function (widget) {
        var endpoint = String(widget.getAttribute("data-ai-endpoint") || "data").trim().toLowerCase();
        var payload = helpers.buildMacroPayloadFromElement(widget);
        if (!String(payload.macro || "").trim()) {
          renderDataWidgetEmpty(widget, "Set data-ai-macro on this widget to load data.", false, helpers);
          return;
        }

        var sessionIndex = helpers.getSessionIndexFromElement(widget);
        var cacheKey = JSON.stringify({
          endpoint: endpoint,
          sessionIndex: sessionIndex,
          payload: payload
        });

        if (!requestCache.has(cacheKey)) {
          requestCache.set(cacheKey, executeMacroRequest(endpoint, payload, sessionIndex, helpers));
        }

        widgetTasks.push(
          requestCache.get(cacheKey)
            .then(function (rows) {
              if (widget.hasAttribute("data-ai-data-kpi")) {
                renderDataKpi(widget, rows, helpers);
              } else if (widget.hasAttribute("data-ai-data-table")) {
                renderDataTable(widget, rows, helpers);
              } else if (widget.hasAttribute("data-ai-data-chart")) {
                renderDataChart(widget, rows, helpers);
              }
              successCount += 1;
            })
            .catch(function (error) {
              errorCount += 1;
              renderDataWidgetEmpty(widget, helpers.toFriendlyErrorMessage((error && error.message) || "Data macro failed."), true, helpers);
            })
        );
      })(widgets[index]);
    }

    if (widgetTasks.length > 0) {
      await Promise.all(widgetTasks);
    }

    if (errorCount > 0 && successCount <= 0) {
      helpers.setDataReportState("Report error", "error");
      return;
    }

    if (errorCount > 0) {
      helpers.setDataReportState("Reports loaded with warnings", "error");
      return;
    }

    helpers.setDataReportState("Reports ready", "");
  }

  window.AIBridgeDashboardDataEngine = {
    renderBusinessReportLayout: renderBusinessReportLayout,
    executeMacroRequest: executeMacroRequest,
    renderDataWidgetEmpty: renderDataWidgetEmpty,
    renderDataKpi: renderDataKpi,
    renderDataTable: renderDataTable,
    renderDataChart: renderDataChart,
    refreshDataViews: refreshDataViews
  };
})();
