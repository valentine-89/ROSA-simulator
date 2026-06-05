(function () {
  function createHistoryWindowControl(helpers) {
    var wrapper = document.createElement("div");
    wrapper.className = "sensor-range";

    var label = document.createElement("small");
    label.textContent = "History window";
    wrapper.appendChild(label);

    var select = document.createElement("select");
    select.className = "select select-inline";
    select.id = "sensor-history-range";

    [
      ["1800000", "Last 30 min"],
      ["3600000", "Last 1 hour"],
      ["21600000", "Last 6 hours"],
      ["86400000", "Last 24 hours"],
      ["604800000", "Last 7 days"]
    ].forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry[0];
      option.textContent = entry[1];
      if (Number(entry[0]) === Number(helpers.getSensorHistoryWindowMs())) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener("change", function () {
      if (helpers && typeof helpers.setHistoryWindow === "function") {
        helpers.setHistoryWindow(select.value);
      }
    });

    wrapper.appendChild(select);
    return wrapper;
  }

  function renderSensorWidgetLayout(manifest, helpers) {
    var root = helpers.getSensorRoot();
    if (!root) {
      return;
    }

    var cards = Array.isArray(manifest) ? manifest : helpers.normalizeSensorManifest();
    root.innerHTML = "";

    cards.forEach(function (definition, index) {
      var card = helpers.cloneTemplateById("ai-bridge-template-sensor-stat");
      if (!card) {
        return;
      }

      var titleNode = card.querySelector("[data-slot='title']");
      var valueNode = card.querySelector("[data-slot='value']");
      var chartNode = card.querySelector("[data-slot='chart']");
      var gridNode = card.querySelector("[data-slot='grid']");
      var maxLabelNode = card.querySelector("[data-slot='max-label']");
      var emptyPathNode = card.querySelector("[data-slot='empty-path']");
      var areaPathNode = card.querySelector("[data-slot='area-path']");
      var linePathNode = card.querySelector("[data-slot='line-path']");
      var hoverLineNode = card.querySelector("[data-slot='hover-line']");
      var hoverPointNode = card.querySelector("[data-slot='hover-point']");
      var hitboxNode = card.querySelector("[data-slot='hitbox']");
      var tooltipNode = card.querySelector("[data-slot='tooltip']");
      var footLeftNode = card.querySelector("[data-slot='foot-left']");

      if (titleNode) {
        titleNode.textContent = definition.title;
      }
      if (valueNode) {
        valueNode.id = "sensor-" + definition.key;
      }
      if (chartNode) {
        chartNode.id = definition.key + "-chart";
        chartNode.setAttribute("data-series-index", String(definition.seriesIndex || 0));
      }
      if (gridNode) {
        gridNode.id = definition.key + "-chart-grid";
      }
      if (maxLabelNode) {
        maxLabelNode.id = definition.key + "-chart-max-label";
      }
      if (emptyPathNode) {
        emptyPathNode.id = definition.key + "-chart-empty";
      }
      if (areaPathNode) {
        areaPathNode.id = definition.key + "-chart-area";
      }
      if (linePathNode) {
        linePathNode.id = definition.key + "-chart-path";
      }
      if (hoverLineNode) {
        hoverLineNode.id = definition.key + "-chart-hover-line";
      }
      if (hoverPointNode) {
        hoverPointNode.id = definition.key + "-chart-hover-point";
      }
      if (hitboxNode) {
        hitboxNode.id = definition.key + "-chart-hitbox";
      }
      if (tooltipNode) {
        tooltipNode.id = definition.key + "-chart-tooltip";
      }
      if (footLeftNode) {
        footLeftNode.innerHTML = "";
        if (index === 0) {
          footLeftNode.appendChild(createHistoryWindowControl(helpers));
        }
      }

      root.appendChild(card);
    });
  }

  function buildChartScale(series, helpers) {
    var min = 0;
    var max = 0;
    var minTs = Infinity;
    var maxTs = 0;
    series.forEach(function (point) {
      if (point.value > max) {
        max = point.value;
      }
      if (isFinite(point.ts)) {
        if (point.ts < minTs) {
          minTs = point.ts;
        }
        if (point.ts > maxTs) {
          maxTs = point.ts;
        }
      }
    });
    if (max <= 0) {
      max = 10;
    }
    max = Math.ceil(max / 5) * 5;
    if (max < 10) {
      max = 10;
    }
    if (!isFinite(minTs)) {
      minTs = Date.now() - helpers.getSensorHistoryWindowMs();
    }
    if (!isFinite(maxTs) || maxTs <= minTs) {
      maxTs = minTs + helpers.getSensorHistoryWindowMs();
    }
    return {
      min: min,
      max: max,
      minTs: minTs,
      maxTs: maxTs,
      width: 278,
      height: 108,
      left: 46,
      top: 14,
      bottom: 122
    };
  }

  function getChartGeometry(series, scale) {
    if (!series || series.length <= 0) {
      return [];
    }

    var tsSpan = Math.max(1, scale.maxTs - scale.minTs);
    return series
      .slice()
      .sort(function (leftPoint, rightPoint) {
        return Number(leftPoint.ts || 0) - Number(rightPoint.ts || 0);
      })
      .map(function (point) {
      var tsOffset = Math.min(Math.max(point.ts - scale.minTs, 0), tsSpan);
      var x = scale.left + (tsOffset / tsSpan) * scale.width;
      var normalized = (point.value - scale.min) / (scale.max - scale.min);
      var y = scale.bottom - (normalized * scale.height);
      return {
        ts: point.ts,
        value: point.value,
        x: x,
        y: y
      };
      });
  }

  function renderChartGrid(gridElement, scale) {
    if (!gridElement) {
      return;
    }

    var html = "";
    for (var step = 0; step <= 4; step += 1) {
      var y = scale.top + ((scale.height / 4) * step);
      html += '<line x1="' + scale.left + '" y1="' + y.toFixed(2) + '" x2="' + (scale.left + scale.width) + '" y2="' + y.toFixed(2) + '"></line>';
    }
    gridElement.innerHTML = html;
  }

  function renderSensorChart(name, helpers) {
    var config = helpers.getChartConfig(name);
    if (!config || !config.path || !config.area || !config.empty || !config.maxLabel) {
      return;
    }

    var scale = buildChartScale(config.series, helpers);
    var points = getChartGeometry(config.series, scale);
    renderChartGrid(config.grid, scale);
    config.maxLabel.textContent = String(scale.max) + config.unit;

    if (points.length <= 1) {
      config.empty.setAttribute("d", "M" + scale.left + " " + (scale.top + scale.height / 2) + " H" + (scale.left + scale.width));
      config.path.setAttribute("d", "M" + scale.left + " " + (scale.top + scale.height / 2) + " H" + (scale.left + scale.width));
      config.area.setAttribute("d", "");
      hideChartTooltip(name, helpers);
      return;
    }

    var path = "";
    var areaPath = "";
    points.forEach(function (point, index) {
      path += (index === 0 ? "M" : " L") + point.x.toFixed(2) + " " + point.y.toFixed(2);
      areaPath += (index === 0 ? "M" : " L") + point.x.toFixed(2) + " " + point.y.toFixed(2);
    });

    areaPath += " L" + points[points.length - 1].x.toFixed(2) + " " + scale.bottom + " L" + points[0].x.toFixed(2) + " " + scale.bottom + " Z";
    config.empty.setAttribute("d", "");
    config.path.setAttribute("d", path);
    config.area.setAttribute("d", areaPath);
  }

  function findNearestChartPoint(name, event, helpers) {
    var config = helpers.getChartConfig(name);
    if (!config || !config.container) {
      return null;
    }

    var scale = buildChartScale(config.series, helpers);
    var points = getChartGeometry(config.series, scale);
    if (points.length <= 0) {
      return null;
    }

    var rect = config.container.getBoundingClientRect();
    var relativeX = ((event.clientX - rect.left) / rect.width) * 340;
    var nearest = points[0];
    var nearestDistance = Math.abs(relativeX - nearest.x);

    points.forEach(function (point) {
      var distance = Math.abs(relativeX - point.x);
      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    });

    return {
      point: nearest,
      scale: scale
    };
  }

  function showChartTooltip(name, event, helpers) {
    var config = helpers.getChartConfig(name);
    if (!config || !config.tooltip || !config.hoverLine || !config.hoverPoint || !config.container) {
      return;
    }

    var nearest = findNearestChartPoint(name, event, helpers);
    if (!nearest) {
      hideChartTooltip(name, helpers);
      return;
    }

    config.hoverLine.setAttribute("x1", nearest.point.x.toFixed(2));
    config.hoverLine.setAttribute("x2", nearest.point.x.toFixed(2));
    config.hoverLine.style.opacity = "1";
    config.hoverPoint.setAttribute("cx", nearest.point.x.toFixed(2));
    config.hoverPoint.setAttribute("cy", nearest.point.y.toFixed(2));
    config.hoverPoint.style.opacity = "1";

    var tooltipX = ((nearest.point.x / 340) * config.container.clientWidth) + 10;
    var tooltipY = ((nearest.point.y / 156) * config.container.clientHeight) - 8;
    config.tooltip.style.opacity = "1";
    config.tooltip.style.left = Math.min(Math.max(tooltipX, 8), config.container.clientWidth - 126) + "px";
    config.tooltip.style.top = Math.max(tooltipY, 10) + "px";
    config.tooltip.innerHTML = "<strong>" + nearest.point.value.toFixed(1) + config.unit + "</strong><small>" + helpers.formatTimestamp(new Date(nearest.point.ts)) + "</small>";
  }

  function hideChartTooltip(name, helpers) {
    var config = helpers.getChartConfig(name);
    if (!config || !config.tooltip || !config.hoverLine || !config.hoverPoint) {
      return;
    }
    config.tooltip.style.opacity = "0";
    config.hoverLine.style.opacity = "0";
    config.hoverPoint.style.opacity = "0";
  }

  function updateSensorHistory(field, ts, value, helpers) {
    if (!isFinite(value)) {
      return;
    }
    var key = helpers.normalizeWidgetKey(field);
    var config = helpers.getChartConfig(key);
    var entry = helpers.getSensorWidgetEntry(key);
    if (!config) {
      return;
    }

    var nextSeries = helpers.appendSeriesPoint(Array.isArray(helpers.getSensorSeries(key)) ? helpers.getSensorSeries(key) : [], ts, value);
    helpers.setSensorSeries(key, nextSeries);
    config.series = nextSeries;
    renderSensorChart(key, helpers);
  }

  function setSensorValue(target, value, helpers) {
    if (target) {
      target.textContent = helpers.normalizeResultValue(value);
    }
  }

  window.AIBridgeDashboardSensorEngine = {
    renderSensorWidgetLayout: renderSensorWidgetLayout,
    renderSensorChart: renderSensorChart,
    showChartTooltip: showChartTooltip,
    hideChartTooltip: hideChartTooltip,
    updateSensorHistory: updateSensorHistory,
    setSensorValue: setSensorValue
  };
})();
