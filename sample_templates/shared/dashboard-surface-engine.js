(function () {
  function renderSurfaceWidgetLayout(surfaceConfig, helpers) {
    var root = helpers.getSurfaceWidgetRoot();
    if (!root) {
      return;
    }

    root.innerHTML = "";
    var sideGrid = document.createElement("div");
    var statsGrid = document.createElement("div");
    var widgets = Array.isArray(surfaceConfig && surfaceConfig.widgets) ? surfaceConfig.widgets : [];

    sideGrid.className = "widget-stack";
    statsGrid.className = "widget-cluster-grid";

    widgets.forEach(function (widget) {
      var templateId = "";
      var target = root;

      if (widget.type === "switch") {
        templateId = "ai-bridge-template-widget-switch-card";
        target = root;
      } else if (widget.type === "multi-line") {
        templateId = "ai-bridge-template-widget-multi-line-card";
        target = sideGrid;
      } else if (widget.type === "focus") {
        templateId = "ai-bridge-template-widget-focus-card";
        target = statsGrid;
      } else if (widget.type === "card") {
        templateId = "ai-bridge-template-widget-value-card";
        target = statsGrid;
      }

      if (!templateId) {
        return;
      }

      var node = helpers.cloneEditableTemplate(templateId);
      if (!node) {
        return;
      }

      var kickerNode = node.querySelector("[data-slot='kicker']");
      var titleNode = node.querySelector("[data-slot='title']");
      if (kickerNode) kickerNode.textContent = widget.kicker;
      if (titleNode) titleNode.textContent = widget.title;

      if (widget.type === "switch") {
        var onButton = node.querySelector("#widget-toggle-on");
        var offButton = node.querySelector("#widget-toggle-off");
        if (onButton) {
          onButton.setAttribute("data-command", String((widget.commands && widget.commands[0]) || ""));
          onButton.setAttribute("data-ai-session-index", widget.sessionIndex || surfaceConfig.sessionIndex);
        }
        if (offButton) {
          offButton.setAttribute("data-command", String((widget.commands && widget.commands[1]) || ""));
          offButton.setAttribute("data-ai-session-index", widget.sessionIndex || surfaceConfig.sessionIndex);
        }
      } else if (widget.type === "multi-line") {
        var legendRoot = node.querySelector("#widget-series-legend");
        var pathRoot = node.querySelector("#widget-series-paths");
        var pointRoot = node.querySelector("#widget-series-hover-points");
        if (legendRoot) {
          legendRoot.innerHTML = widget.series.map(function (seriesEntry) {
            var seriesNumber = (Number(seriesEntry.seriesIndex || 0) % 6) + 1;
            return '<span class="widget-legend-item" data-series-index="' + String(seriesEntry.seriesIndex || 0) + '" style="--series-color: var(--theme-series-' + String(seriesNumber) + ');"><span class="widget-legend-dot"></span>' + seriesEntry.label + '</span>';
          }).join("");
        }
        if (pathRoot) {
          pathRoot.innerHTML = widget.series.map(function (seriesEntry) {
            var seriesNumber = (Number(seriesEntry.seriesIndex || 0) % 6) + 1;
            return '<path class="widget-chart-path" data-series-index="' + String(seriesEntry.seriesIndex || 0) + '" style="--series-color: var(--theme-series-' + String(seriesNumber) + ');" id="widget-series-path-' + seriesEntry.key + '" d=""></path>';
          }).join("");
        }
        if (pointRoot) {
          pointRoot.innerHTML = widget.series.map(function (seriesEntry) {
            var seriesNumber = (Number(seriesEntry.seriesIndex || 0) % 6) + 1;
            return '<circle class="widget-chart-hover-point" data-series-index="' + String(seriesEntry.seriesIndex || 0) + '" style="--series-color: var(--theme-series-' + String(seriesNumber) + ');" id="widget-series-hover-point-' + seriesEntry.key + '" r="5" cx="0" cy="0"></circle>';
          }).join("");
        }
      }

      target.appendChild(node);
    });

    if (statsGrid.children.length > 0) {
      sideGrid.appendChild(statsGrid);
    }
    if (sideGrid.children.length > 0) {
      root.appendChild(sideGrid);
    }
  }

  function formatSurfaceShortTime(timestamp) {
    if (!timestamp) {
      return "No data";
    }
    try {
      return new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (error) {
      return "No data";
    }
  }

  function formatSurfaceTooltipTimestamp(timestamp) {
    if (!timestamp) {
      return "No data";
    }
    try {
      var date = new Date(timestamp);
      return date.toLocaleDateString("en-GB") + " " + date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch (error) {
      return "No data";
    }
  }

  function updateSurfaceTimestamp(timestamp, helpers) {
    var label = helpers.getSurfaceUpdatedLabel();
    if (label) {
      label.textContent = "Updated " + formatSurfaceShortTime(timestamp || Date.now());
    }
  }

  function extractSurfaceNumericValue(value) {
    if (typeof value === "number" && isFinite(value)) {
      return value;
    }
    var match = String(value == null ? "" : value).match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
  }

  function appendMultiLineWidgetSeries(field, ts, rawValue, helpers) {
    var numeric = extractSurfaceNumericValue(rawValue);
    var store = helpers.getSurfaceSeriesStore();
    if (numeric === null || !store[field]) {
      return;
    }
    store[field].push({ ts: Number(ts || Date.now()), value: numeric });
    store[field].sort(function (left, right) {
      return Number(left.ts || 0) - Number(right.ts || 0);
    });
    store[field] = store[field]
      .filter(function (point) {
        return point.ts >= (Date.now() - helpers.getSurfaceHistoryWindowMs());
      })
      .slice(-240);
  }

  function setToggleWidgetState(state, timestamp, helpers) {
    var normalized = String(state == null ? "" : state).trim().toUpperCase();
    if (normalized === "1" || normalized === "TRUE") {
      normalized = "ON";
    } else if (normalized === "0" || normalized === "FALSE") {
      normalized = "OFF";
    }

    var nextState = normalized === "ON" ? "on" : normalized === "OFF" ? "off" : "offline";
    var control = helpers.getSurfaceToggleControl();
    var label = helpers.getSurfaceToggleState();
    var meta = helpers.getSurfaceSwitchMeta();
    if (control) {
      control.setAttribute("data-state", nextState);
    }
    if (label) {
      label.setAttribute("data-state", nextState);
      label.textContent = nextState === "on"
        ? String((meta && meta.labels && meta.labels[0]) || "Closed")
        : nextState === "off"
          ? String((meta && meta.labels && meta.labels[1]) || "Open")
          : "Offline";
    }
    updateSurfaceTimestamp(timestamp || Date.now(), helpers);
  }

  function setToggleWidgetPendingState(label, helpers) {
    var control = helpers.getSurfaceToggleControl();
    var stateNode = helpers.getSurfaceToggleState();
    if (control) {
      control.setAttribute("data-state", "pending");
    }
    if (stateNode) {
      stateNode.setAttribute("data-state", "pending");
      stateNode.textContent = label || "Switching";
    }
  }

  function renderMultiLineWidgetChart(helpers) {
    var grid = helpers.getSurfaceChartGrid();
    var empty = helpers.getSurfaceChartEmpty();
    var meta = helpers.getSurfaceMultiLineMeta();
    if (!grid || !empty || !meta || !Array.isArray(meta.series) || meta.series.length <= 0) {
      return;
    }

    var store = helpers.getSurfaceSeriesStore();
    var pathNodes = helpers.getSurfaceChartPathNodes();
    var maxLabel = helpers.getSurfaceChartMaxLabel();
    var minLabel = helpers.getSurfaceChartMinLabel();

    var allPoints = [];
    meta.series.forEach(function (seriesEntry) {
      allPoints = allPoints.concat(store[seriesEntry.key] || []);
    });

    var left = 46;
    var top = 16;
    var width = 294;
    var height = 182;
    var bottom = top + height;
    var now = Date.now();
    var startTs = now - helpers.getSurfaceHistoryWindowMs();
    var tsSpan = Math.max(1, helpers.getSurfaceHistoryWindowMs());

    var gridHtml = "";
    for (var row = 0; row <= 4; row += 1) {
      var y = top + ((height / 4) * row);
      gridHtml += '<line x1="' + left + '" y1="' + y.toFixed(2) + '" x2="' + (left + width) + '" y2="' + y.toFixed(2) + '"></line>';
    }
    grid.innerHTML = gridHtml;

    if (allPoints.length <= 1) {
      empty.setAttribute("d", "M46 106 H340");
      Object.keys(pathNodes).forEach(function (key) {
        if (pathNodes[key]) {
          pathNodes[key].setAttribute("d", "");
        }
      });
      if (maxLabel) maxLabel.textContent = "0" + String((meta && meta.unit) || "");
      if (minLabel) minLabel.textContent = "0" + String((meta && meta.unit) || "");
      hideMultiLineWidgetTooltip(helpers);
      return;
    }

    var values = allPoints.map(function (point) { return point.value; });
    var minValue = Math.min.apply(null, values);
    var maxValue = Math.max.apply(null, values);
    if (minValue === maxValue) {
      minValue -= 1;
      maxValue += 1;
    }
    if (maxLabel) maxLabel.textContent = Math.round(maxValue) + String((meta && meta.unit) || "");
    if (minLabel) minLabel.textContent = Math.round(minValue) + String((meta && meta.unit) || "");
    empty.setAttribute("d", "");

    function pathFor(seriesKey) {
      var series = (store[seriesKey] || [])
        .slice()
        .sort(function (leftPoint, rightPoint) {
          return Number(leftPoint.ts || 0) - Number(rightPoint.ts || 0);
        })
        .filter(function (point) {
          return point.ts >= startTs;
        })
        .slice(-240);
      if (series.length <= 1) {
        return "";
      }
      var path = "";
      series.forEach(function (point, index) {
        var x = left + (((point.ts - startTs) / tsSpan) * width);
        var normalized = (point.value - minValue) / (maxValue - minValue);
        var y = bottom - (normalized * height);
        path += (index === 0 ? "M" : " L") + x.toFixed(2) + " " + y.toFixed(2);
      });
      return path;
    }

    meta.series.forEach(function (seriesEntry) {
      var node = pathNodes[seriesEntry.key];
      if (node) {
        node.setAttribute("d", pathFor(seriesEntry.key));
      }
    });
  }

  function findNearestMultiLineWidgetPoints(event, helpers) {
    var hitbox = helpers.getSurfaceChartHitbox();
    var meta = helpers.getSurfaceMultiLineMeta();
    if (!hitbox || !meta || !meta.series || meta.series.length <= 0) {
      return null;
    }

    var left = 46;
    var top = 16;
    var width = 294;
    var height = 182;
    var bottom = top + height;
    var now = Date.now();
    var startTs = now - helpers.getSurfaceHistoryWindowMs();
    var tsSpan = Math.max(1, helpers.getSurfaceHistoryWindowMs());
    var store = helpers.getSurfaceSeriesStore();
    var allPoints = [];
    meta.series.forEach(function (seriesEntry) {
      allPoints = allPoints.concat(store[seriesEntry.key] || []);
    });
    if (allPoints.length <= 0) {
      return null;
    }

    var values = allPoints.map(function (point) { return point.value; });
    var minValue = Math.min.apply(null, values);
    var maxValue = Math.max.apply(null, values);
    if (minValue === maxValue) {
      minValue -= 1;
      maxValue += 1;
    }

    var rect = hitbox.getBoundingClientRect();
    var relativeX = left + (((event.clientX - rect.left) / rect.width) * width);
    var anchorSeriesKey = meta.series[0].key;
    var anchorSeries = (store[anchorSeriesKey] || [])
      .slice()
      .sort(function (leftPoint, rightPoint) {
        return Number(leftPoint.ts || 0) - Number(rightPoint.ts || 0);
      })
      .filter(function (point) {
        return point.ts >= startTs;
      })
      .slice(-240);
    if (anchorSeries.length <= 0) {
      return null;
    }

    var nearest = anchorSeries[0];
    var nearestX = left + (((nearest.ts - startTs) / tsSpan) * width);
    var nearestDistance = Math.abs(relativeX - nearestX);
    anchorSeries.forEach(function (point) {
      var pointX = left + (((point.ts - startTs) / tsSpan) * width);
      var distance = Math.abs(relativeX - pointX);
      if (distance < nearestDistance) {
        nearest = point;
        nearestX = pointX;
        nearestDistance = distance;
      }
    });

    function pointFor(seriesKey) {
      var series = (store[seriesKey] || [])
        .slice()
        .sort(function (leftPoint, rightPoint) {
          return Number(leftPoint.ts || 0) - Number(rightPoint.ts || 0);
        })
        .filter(function (point) {
          return point.ts >= startTs;
        })
        .slice(-240);
      if (series.length <= 0) {
        return null;
      }
      var target = series[0];
      var targetDistance = Math.abs(nearest.ts - target.ts);
      series.forEach(function (point) {
        var distance = Math.abs(nearest.ts - point.ts);
        if (distance < targetDistance) {
          target = point;
          targetDistance = distance;
        }
      });
      var normalized = (target.value - minValue) / (maxValue - minValue);
      return {
        ts: target.ts,
        value: target.value,
        x: left + (((target.ts - startTs) / tsSpan) * width),
        y: bottom - (normalized * height)
      };
    }

    return {
      ts: nearest.ts,
      anchorX: nearestX,
      series: meta.series.map(function (seriesEntry) {
        return {
          key: seriesEntry.key,
          label: seriesEntry.label,
          seriesIndex: seriesEntry.seriesIndex,
          point: pointFor(seriesEntry.key)
        };
      })
    };
  }

  function showMultiLineWidgetTooltip(event, helpers) {
    var tooltip = helpers.getSurfaceChartTooltip();
    var hitbox = helpers.getSurfaceChartHitbox();
    var hoverLine = helpers.getSurfaceChartHoverLine();
    if (!tooltip || !hitbox || !hoverLine) {
      return;
    }

    var nearest = findNearestMultiLineWidgetPoints(event, helpers);
    if (!nearest) {
      hideMultiLineWidgetTooltip(helpers);
      return;
    }

    hoverLine.setAttribute("x1", nearest.anchorX.toFixed(2));
    hoverLine.setAttribute("x2", nearest.anchorX.toFixed(2));
    hoverLine.style.opacity = "1";

    var hoverPoints = helpers.getSurfaceChartHoverPoints();
    var meta = helpers.getSurfaceMultiLineMeta();
    nearest.series.forEach(function (entry) {
      var node = hoverPoints[entry.key];
      var point = entry.point;
      if (!node || !point) {
        return;
      }
      node.setAttribute("cx", point.x.toFixed(2));
      node.setAttribute("cy", point.y.toFixed(2));
      node.style.opacity = "1";
    });

    var container = hitbox.parentElement && hitbox.parentElement.parentElement;
    if (!container) {
      return;
    }
    var containerWidth = container.clientWidth || 320;
    var containerHeight = container.clientHeight || 240;
    var tooltipX = ((nearest.anchorX / 360) * containerWidth) + 12;
    var tooltipY = 18;
    tooltip.style.opacity = "1";
    tooltip.style.transform = "translate3d(0, 0, 0)";
    tooltip.style.left = Math.min(Math.max(tooltipX, 8), containerWidth - 176) + "px";
    tooltip.style.top = Math.min(Math.max(tooltipY, 8), containerHeight - 120) + "px";
    tooltip.innerHTML =
      "<strong>" + formatSurfaceTooltipTimestamp(nearest.ts) + "</strong>" +
      nearest.series.map(function (entry) {
        var seriesNumber = (Number(entry.seriesIndex || 0) % 6) + 1;
        return '<div class="widget-chart-tooltip-row"><span class="widget-chart-tooltip-label"><span class="widget-chart-tooltip-swatch" data-series-index="' + String(entry.seriesIndex || 0) + '" style="--series-color: var(--theme-series-' + String(seriesNumber) + ');"></span>' + entry.label + '</span><span>' + (entry.point ? entry.point.value.toFixed(1) + String((meta && meta.unit) || "") : '--') + "</span></div>";
      }).join("");
  }

  function hideMultiLineWidgetTooltip(helpers) {
    var tooltip = helpers.getSurfaceChartTooltip();
    var hoverLine = helpers.getSurfaceChartHoverLine();
    if (tooltip) {
      tooltip.style.opacity = "0";
      tooltip.style.transform = "translate3d(0, 8px, 0)";
    }
    if (hoverLine) {
      hoverLine.style.opacity = "0";
    }
    var hoverPoints = helpers.getSurfaceChartHoverPoints();
    Object.keys(hoverPoints).forEach(function (key) {
      var node = hoverPoints[key];
      if (node) node.style.opacity = "0";
    });
  }

  function setFocusWidgetValue(value, timestamp, helpers) {
    var numeric = extractSurfaceNumericValue(value);
    if (numeric === null) {
      return;
    }
    var valueNode = helpers.getSurfaceFocusValue();
    var captionNode = helpers.getSurfaceFocusCaption();
    var gauge = helpers.getSurfaceFocusGauge();
    var meta = helpers.getSurfaceFocusMeta();
    if (valueNode) {
      valueNode.textContent = numeric.toFixed(1) + String((meta && meta.unit) || "A");
    }
    if (captionNode) {
      captionNode.textContent = String((meta && meta.caption) || "Live current");
    }
    if (gauge) {
      var max = Math.max(1, Number((meta && meta.max) || 100));
      var angle = Math.max(0, Math.min(240, (numeric / max) * 240));
      gauge.style.setProperty("--gauge-angle", angle.toFixed(2) + "deg");
    }
    updateSurfaceTimestamp(timestamp || Date.now(), helpers);
  }

  function setValueCardValue(value, timestamp, helpers) {
    var numeric = extractSurfaceNumericValue(value);
    if (numeric === null) {
      return;
    }
    var primary = helpers.getSurfaceValuePrimary();
    var meta = helpers.getSurfaceValueMeta();
    if (primary) {
      var decimals = Math.max(0, Number((meta && meta.decimals) || 3));
      primary.textContent = numeric.toFixed(decimals).replace(/\.?0+$/, "") + " " + String((meta && meta.unit) || "kWh");
    }
    updateSurfaceTimestamp(timestamp || Date.now(), helpers);
  }

  window.AIBridgeDashboardSurfaceEngine = {
    renderSurfaceWidgetLayout: renderSurfaceWidgetLayout,
    formatSurfaceShortTime: formatSurfaceShortTime,
    formatSurfaceTooltipTimestamp: formatSurfaceTooltipTimestamp,
    updateSurfaceTimestamp: updateSurfaceTimestamp,
    extractSurfaceNumericValue: extractSurfaceNumericValue,
    appendMultiLineWidgetSeries: appendMultiLineWidgetSeries,
    setToggleWidgetState: setToggleWidgetState,
    setToggleWidgetPendingState: setToggleWidgetPendingState,
    renderMultiLineWidgetChart: renderMultiLineWidgetChart,
    showMultiLineWidgetTooltip: showMultiLineWidgetTooltip,
    hideMultiLineWidgetTooltip: hideMultiLineWidgetTooltip,
    setFocusWidgetValue: setFocusWidgetValue,
    setValueCardValue: setValueCardValue
  };
})();
