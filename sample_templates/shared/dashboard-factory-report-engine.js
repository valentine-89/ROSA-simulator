(function () {
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function num(value, digits) {
    var parsed = Number(value);
    if (!isFinite(parsed)) {
      return "--";
    }
    return parsed.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function unit(value, digits, suffix) {
    var formatted = num(value, digits);
    return formatted === "--" ? formatted : formatted + suffix;
  }

  function csvCell(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  }

  function alignDateToBucket(date, minutes) {
    var copy = new Date(date.getTime());
    copy.setSeconds(0, 0);
    copy.setMinutes(copy.getMinutes() - (copy.getMinutes() % minutes));
    return copy;
  }

  function formatSqlDateTime(date) {
    return date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0") + " " +
      String(date.getHours()).padStart(2, "0") + ":" +
      String(date.getMinutes()).padStart(2, "0") + ":" +
      String(date.getSeconds()).padStart(2, "0");
  }

  function parseSqlDateTime(value) {
    var text = String(value || "").trim();
    if (!text) {
      return null;
    }
    var match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) {
      var parsed = new Date(text);
      return isFinite(parsed.getTime()) ? parsed : null;
    }
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0),
      0
    );
  }

  function normalizePayload(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return text;
    }
  }

  function buildLinePath(points, accessor, left, width, paneTop, paneHeight, min, max) {
    var path = "";
    for (var index = 0; index < points.length; index += 1) {
      var raw = accessor(points[index]);
      if (!isFinite(raw)) {
        continue;
      }
      var x = left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * width);
      var y = paneTop + paneHeight - (((raw - min) / (max - min)) * paneHeight);
      path += (path ? " L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
    }
    return path;
  }

  function buildAreaPath(points, accessor, left, width, paneTop, paneHeight, min, max) {
    var line = buildLinePath(points, accessor, left, width, paneTop, paneHeight, min, max);
    if (!line) {
      return "";
    }
    var firstIndex = -1;
    var lastIndex = -1;
    for (var index = 0; index < points.length; index += 1) {
      if (isFinite(accessor(points[index]))) {
        if (firstIndex === -1) {
          firstIndex = index;
        }
        lastIndex = index;
      }
    }
    if (firstIndex === -1 || lastIndex === -1) {
      return "";
    }
    var firstX = left + (points.length <= 1 ? 0 : (firstIndex / (points.length - 1)) * width);
    var lastX = left + (points.length <= 1 ? 0 : (lastIndex / (points.length - 1)) * width);
    var baseY = paneTop + paneHeight;
    return line + " L" + lastX.toFixed(2) + " " + baseY.toFixed(2) + " L" + firstX.toFixed(2) + " " + baseY.toFixed(2) + " Z";
  }

  function metricMax(points, accessor) {
    var max = 0;
    for (var index = 0; index < points.length; index += 1) {
      var value = Number(accessor(points[index]));
      if (isFinite(value) && value > max) {
        max = value;
      }
    }
    return max > 0 ? max : 1;
  }

  function formatBucketTime(value) {
    return String(value || "").replace(" ", " | ");
  }

  function createState(root, options) {
    return {
      root: root,
      options: options,
      busy: false,
      timer: 0,
      row: null,
      latestDataTime: "",
      overviewPage: 1,
      overviewPageSize: 20,
      overviewTotalRows: 0
    };
  }

  function getRefs(root) {
    return {
      range: root.querySelector("#factory-report-range"),
      refreshButton: root.querySelector("#factory-report-refresh"),
      status: root.querySelector("#factory-report-status"),
      machineList: root.querySelector("#factory-report-machine-list"),
      overviewTable: root.querySelector("#factory-report-overview-table"),
      overviewPrev: root.querySelector("#factory-report-overview-prev"),
      overviewNext: root.querySelector("#factory-report-overview-next"),
      overviewPageInfo: root.querySelector("#factory-report-overview-page-info"),
      overviewExport: root.querySelector("#factory-report-overview-export"),
      modal: root.querySelector("#factory-report-modal"),
      modalTitle: root.querySelector("#factory-report-modal-title"),
      form: root.querySelector("#factory-report-form"),
      modalClose: root.querySelector("#factory-report-modal-close"),
      modalCancel: root.querySelector("#factory-report-modal-cancel"),
      modalSubmit: root.querySelector("#factory-report-modal-submit")
    };
  }

  function setStatus(refs, text, mode) {
    if (!refs.status) {
      return;
    }
    refs.status.innerHTML = '<span class="status-dot' + (mode === "live" ? ' ok' : '') + '"></span>' + esc(text || "--");
  }

  function getBucketMinutes(refs) {
    return refs.range && (refs.range.value === "7d" || refs.range.value === "30d") ? 60 : 15;
  }

  function getBucketLabel(minutes) {
    return minutes >= 60 ? "1 hour" : String(minutes) + " mins";
  }

  function getLatestDataWindow(refs, options, anchorValue) {
    var minutes = getBucketMinutes(refs);
    var anchorDate = parseSqlDateTime(anchorValue) || new Date();
    var end = alignDateToBucket(anchorDate, minutes);
    var start = new Date(end.getTime());
    var value = refs.range ? refs.range.value : "3d";
    if (value === "24h") {
      start.setDate(start.getDate() - 1);
    } else if (value === "7d") {
      start.setDate(start.getDate() - 7);
    } else if (value === "30d") {
      start.setDate(start.getDate() - 30);
    } else {
      start.setDate(start.getDate() - 3);
    }
    start = alignDateToBucket(start, minutes);
    return {
      factory_id: String(options.factoryId || "").trim(),
      start_time: formatSqlDateTime(start),
      end_time: formatSqlDateTime(end),
      bucket_minutes: minutes,
      bucket_label: getBucketLabel(minutes),
      latest_time: formatSqlDateTime(end)
    };
  }

  function resolveLatestQuery(refs, state) {
    return postMacro(state.options, {
      macro: "factory-latest-update-time",
      factory_id: String(state.options.factoryId || "").trim()
    }).then(function (rows) {
      var latest = rows && rows[0] ? String(rows[0].latest_update_time || "").trim() : "";
      state.latestDataTime = latest;
      return getLatestDataWindow(refs, state.options, latest);
    }).catch(function () {
      state.latestDataTime = "";
      return getLatestDataWindow(refs, state.options, "");
    });
  }

  function postMacro(options, payload) {
    var sessionId = String(options.sessionId || "").trim();
    var syncId = String(options.syncId || "").trim();
    var url = "/api/" + encodeURIComponent(sessionId) + "/" + encodeURIComponent(syncId) + "/iodata";
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = normalizePayload(text);
        if (!response.ok) {
          throw new Error((data && data.error) || text || ("Request failed with status " + response.status));
        }
        return Array.isArray(data) ? data : [];
      });
    });
  }

  function openModal(state, refs, row) {
    if (!refs.modal || !refs.form || !row) {
      return;
    }
    state.row = row;
    if (refs.modalTitle) {
      refs.modalTitle.textContent = "Edit declaration | " + String(row.machine_code || "--");
    }
    ["machine_code", "session_code", "order_id", "mold_code", "lot_code", "staff", "required_quantity", "rated_weight", "raw_materials"].forEach(function (name) {
      var input = refs.form.elements[name];
      if (!input) {
        return;
      }
      var value = row[name] == null ? "" : String(row[name]);
      input.value = value;
      input.placeholder = value;
    });
    refs.modal.classList.add("is-open");
    refs.modal.setAttribute("aria-hidden", "false");
  }

  function closeModal(state, refs) {
    if (!refs.modal) {
      return;
    }
    refs.modal.classList.remove("is-open");
    refs.modal.setAttribute("aria-hidden", "true");
    state.row = null;
  }

  function buildSeriesMap(rows) {
    var grouped = {};
    (rows || []).forEach(function (row) {
      var key = String(row.machine_code || "").trim();
      if (!key) {
        return;
      }
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(row);
    });
    Object.keys(grouped).forEach(function (key) {
      grouped[key].sort(function (left, right) {
        return new Date(left.bucket_time).getTime() - new Date(right.bucket_time).getTime();
      });
    });
    return grouped;
  }

  function renderTrend(points, label) {
    if (!points || points.length <= 1) {
      return '<svg class="factory-report-trend-svg" viewBox="0 0 860 320"><path class="factory-report-trend-axis" d="M68 152 H800"></path></svg><div class="factory-report-empty">Not enough samples for this machine in the selected range.</div>';
    }

    var rows = points.slice();
    var left = 68;
    var right = 48;
    var top = 18;
    var width = 860 - left - right;
    var paneHeight = 72;
    var paneGap = 18;
    var outputTop = top;
    var efficiencyTop = outputTop + paneHeight + paneGap;
    var materialTop = efficiencyTop + paneHeight + paneGap;
    var outputMax = metricMax(rows, function (row) { return row.output_units; });
    var efficiencyMax = metricMax(rows, function (row) { return row.wh_per_unit; });
    var materialMax = metricMax(rows, function (row) { return row.remaining_material; });
    var slotWidth = width / Math.max(rows.length, 1);
    var barWidth = Math.max(2, Math.min(14, slotWidth * 0.72));
    var bars = "";
    var dotsEfficiency = "";
    var dotsMaterial = "";
    var grid = "";

    for (var lineIndex = 0; lineIndex <= 3; lineIndex += 1) {
      var outputY = outputTop + (paneHeight / 3) * lineIndex;
      var efficiencyY = efficiencyTop + (paneHeight / 3) * lineIndex;
      var materialY = materialTop + (paneHeight / 3) * lineIndex;
      grid += '<line class="factory-report-trend-grid" x1="' + left + '" y1="' + outputY.toFixed(2) + '" x2="' + (left + width) + '" y2="' + outputY.toFixed(2) + '"></line>';
      grid += '<line class="factory-report-trend-grid" x1="' + left + '" y1="' + efficiencyY.toFixed(2) + '" x2="' + (left + width) + '" y2="' + efficiencyY.toFixed(2) + '"></line>';
      grid += '<line class="factory-report-trend-grid" x1="' + left + '" y1="' + materialY.toFixed(2) + '" x2="' + (left + width) + '" y2="' + materialY.toFixed(2) + '"></line>';
    }

    rows.forEach(function (row, index) {
      var x = left + (rows.length <= 1 ? 0 : (index / (rows.length - 1)) * width);
      var outputValue = Number(row.output_units || 0);
      var barHeight = (outputValue / outputMax) * paneHeight;
      var barY = outputTop + paneHeight - barHeight;
      bars += '<rect class="factory-report-trend-bar" x="' + (x - (barWidth / 2)).toFixed(2) + '" y="' + barY.toFixed(2) + '" width="' + barWidth.toFixed(2) + '" height="' + Math.max(barHeight, 1).toFixed(2) + '"></rect>';

      var efficiencyValue = Number(row.wh_per_unit);
      if (isFinite(efficiencyValue)) {
        var efficiencyY = efficiencyTop + paneHeight - ((efficiencyValue / efficiencyMax) * paneHeight);
        dotsEfficiency += '<circle class="factory-report-trend-dot efficiency" data-series="efficiency" data-index="' + index + '" cx="' + x.toFixed(2) + '" cy="' + efficiencyY.toFixed(2) + '" r="5"></circle>';
      }

      var materialValue = Number(row.remaining_material);
      if (isFinite(materialValue)) {
        var materialY = materialTop + paneHeight - ((materialValue / materialMax) * paneHeight);
        dotsMaterial += '<circle class="factory-report-trend-dot material" data-series="material" data-index="' + index + '" cx="' + x.toFixed(2) + '" cy="' + materialY.toFixed(2) + '" r="5"></circle>';
      }
    });

    var efficiencyPath = buildLinePath(rows, function (row) { return Number(row.wh_per_unit); }, left, width, efficiencyTop, paneHeight, 0, efficiencyMax);
    var materialPath = buildLinePath(rows, function (row) { return Number(row.remaining_material); }, left, width, materialTop, paneHeight, 0, materialMax);
    var materialArea = buildAreaPath(rows, function (row) { return Number(row.remaining_material); }, left, width, materialTop, paneHeight, 0, materialMax);
    var firstLabel = rows[0].bucket_time.slice(5, 16);
    var lastLabel = rows[rows.length - 1].bucket_time.slice(5, 16);
    var overallBottom = materialTop + paneHeight;

    return '<div class="factory-report-tooltip"></div><svg class="factory-report-trend-svg" viewBox="0 0 860 320"><g>' + grid + '</g><line class="factory-report-trend-axis" x1="' + left + '" y1="' + outputTop + '" x2="' + left + '" y2="' + overallBottom + '"></line><line class="factory-report-trend-axis" x1="' + left + '" y1="' + overallBottom + '" x2="' + (left + width) + '" y2="' + overallBottom + '"></line><text class="factory-report-trend-pane-title" x="' + left + '" y="' + (outputTop - 6) + '">Output / ' + esc(label) + '</text><text class="factory-report-trend-pane-title" x="' + left + '" y="' + (efficiencyTop - 6) + '">Wh / unit</text><text class="factory-report-trend-pane-title" x="' + left + '" y="' + (materialTop - 6) + '">Remaining material</text><text class="factory-report-trend-label" x="6" y="' + (outputTop + 10) + '">' + esc(num(outputMax, 0)) + '</text><text class="factory-report-trend-label" x="18" y="' + (outputTop + paneHeight) + '">0</text><text class="factory-report-trend-label" x="6" y="' + (efficiencyTop + 10) + '">' + esc(num(efficiencyMax, 2)) + '</text><text class="factory-report-trend-label" x="18" y="' + (efficiencyTop + paneHeight) + '">0</text><text class="factory-report-trend-label" x="6" y="' + (materialTop + 10) + '">' + esc(num(materialMax, 0)) + ' g</text><text class="factory-report-trend-label" x="18" y="' + (materialTop + paneHeight) + '">0</text><text class="factory-report-trend-label" x="' + left + '" y="' + (overallBottom + 22) + '">' + esc(firstLabel) + '</text><text class="factory-report-trend-label" x="' + (left + width) + '" y="' + (overallBottom + 22) + '" text-anchor="end">' + esc(lastLabel) + '</text><g>' + bars + '</g>' + (materialArea ? '<path class="factory-report-trend-area" d="' + materialArea + '"></path>' : "") + (materialPath ? '<path class="factory-report-trend-line material" d="' + materialPath + '"></path>' : "") + (efficiencyPath ? '<path class="factory-report-trend-line efficiency" d="' + efficiencyPath + '"></path>' : "") + '<line class="factory-report-trend-hover-line" x1="' + left + '" y1="' + outputTop + '" x2="' + left + '" y2="' + overallBottom + '"></line><g>' + dotsEfficiency + dotsMaterial + '</g><rect class="factory-report-trend-hitbox" x="' + left + '" y="' + outputTop + '" width="' + width + '" height="' + (overallBottom - outputTop) + '"></rect></svg>';
  }

  function bindTrend(host, points, label) {
    if (!host) {
      return;
    }
    host.innerHTML = renderTrend(points, label);
    var rows = (points || []).slice().sort(function (left, right) {
      return new Date(left.bucket_time).getTime() - new Date(right.bucket_time).getTime();
    });
    var tooltip = host.querySelector(".factory-report-tooltip");
    var hitbox = host.querySelector(".factory-report-trend-hitbox");
    var hoverLine = host.querySelector(".factory-report-trend-hover-line");
    var dots = host.querySelectorAll(".factory-report-trend-dot");
    if (!hitbox || rows.length <= 1) {
      return;
    }
    hitbox.addEventListener("mousemove", function (event) {
      var rect = hitbox.getBoundingClientRect();
      var x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
      var index = Math.round((x / rect.width) * (rows.length - 1));
      var row = rows[index];
      var svgX = 68 + ((rows.length <= 1 ? 0 : index / (rows.length - 1)) * (860 - 68 - 48));
      hoverLine.setAttribute("x1", svgX.toFixed(2));
      hoverLine.setAttribute("x2", svgX.toFixed(2));
      hoverLine.style.opacity = "1";
      Array.prototype.forEach.call(dots, function (dot) {
        dot.style.opacity = Number(dot.getAttribute("data-index")) === index ? "1" : "0";
      });
      tooltip.innerHTML = "<strong>" + esc(formatBucketTime(row.bucket_time)) + "</strong><div>Output: " + esc(unit(row.output_units, 0, " units")) + "</div><div>Wh / unit: " + esc(unit(row.wh_per_unit, 2, " Wh")) + "</div><div>Remaining material: " + esc(unit(Math.round(Number(row.remaining_material || 0)), 0, " g")) + "</div>";
      var hostRect = host.getBoundingClientRect();
      var tooltipRect = tooltip.getBoundingClientRect();
      var desiredLeft = (event.clientX - hostRect.left) + 14;
      var desiredTop = (event.clientY - hostRect.top) + 14;
      var maxLeft = Math.max(12, hostRect.width - tooltipRect.width - 12);
      var maxTop = Math.max(12, hostRect.height - tooltipRect.height - 12);
      tooltip.style.left = Math.min(Math.max(12, desiredLeft), maxLeft) + "px";
      tooltip.style.top = Math.min(Math.max(12, desiredTop), maxTop) + "px";
      tooltip.style.opacity = "1";
      tooltip.style.transform = "translate3d(0,0,0)";
    });
    hitbox.addEventListener("mouseleave", function () {
      hoverLine.style.opacity = "0";
      Array.prototype.forEach.call(dots, function (dot) {
        dot.style.opacity = "0";
      });
      tooltip.style.opacity = "0";
      tooltip.style.transform = "translate3d(0,8px,0)";
    });
  }

  function renderOverviewTable(state, refs, rows) {
    if (!refs.overviewTable) {
      return;
    }
    if (!rows || !rows.length) {
      refs.overviewTable.innerHTML = '<div class="factory-report-empty">No production overview rows in this range.</div>';
      if (refs.overviewPageInfo) {
        refs.overviewPageInfo.textContent = "Page 1 / 1";
      }
      if (refs.overviewPrev) {
        refs.overviewPrev.disabled = true;
      }
      if (refs.overviewNext) {
        refs.overviewNext.disabled = true;
      }
      return;
    }
    var totalRows = Number(rows[0].total_rows || 0);
    var totalPages = Math.max(1, Math.ceil(totalRows / state.overviewPageSize));
    if (refs.overviewPageInfo) {
      refs.overviewPageInfo.textContent = "Page " + state.overviewPage + " / " + totalPages + " · " + num(totalRows, 0) + " rows";
    }
    if (refs.overviewPrev) {
      refs.overviewPrev.disabled = state.overviewPage <= 1;
    }
    if (refs.overviewNext) {
      refs.overviewNext.disabled = state.overviewPage >= totalPages;
    }
    var html = '<table><thead><tr><th>Updated</th><th>Machine</th><th>Order</th><th>Mold</th><th>Lot</th><th>Staff</th><th>Session</th><th>Quantity</th><th>Errors</th><th>Required</th><th>Rated weight</th><th>Remaining</th><th>Remaining %</th><th>Total energy</th><th>Total time</th><th>Wh/unit</th></tr></thead><tbody>';
    rows.forEach(function (row) {
      var warning = Number(row.remaining_percent || 0) < 15;
      html += '<tr' + (warning ? ' class="warn-row"' : '') + '><td>' + esc(row.update_time || '--') + '</td><td><strong>' + esc(row.machine_code || '--') + '</strong></td><td>' + esc(row.order_id || '--') + '</td><td>' + esc(row.mold_code || '--') + '</td><td>' + esc(row.lot_code || '--') + '</td><td>' + esc(row.staff || '--') + '</td><td>' + esc(row.session_code || '--') + '</td><td>' + esc(num(row.quantity, 0)) + '</td><td>' + esc(num(row.error_quantity, 0)) + '</td><td>' + esc(num(row.required_quantity, 0)) + '</td><td>' + esc(unit(row.rated_weight, 2, ' g')) + '</td><td>' + esc(unit(Math.round(Number(row.raw_materials || 0)), 0, ' g')) + '</td><td>' + esc(unit(row.remaining_percent, 0, '%')) + '</td><td>' + esc(unit(Number(row.total_energy_wh || 0) / 1000, 2, ' KWh')) + '</td><td>' + esc(unit(row.total_time_s, 0, ' s')) + '</td><td>' + esc(unit(row.wh_per_unit, 2, ' Wh')) + '</td></tr>';
    });
    refs.overviewTable.innerHTML = html + '</tbody></table>';
  }

  function renderMachines(state, refs, rows, seriesMap, label) {
    if (!refs.machineList) {
      return;
    }
    if (!rows || !rows.length) {
      refs.machineList.innerHTML = '<div class="factory-report-empty">No machine declarations available.</div>';
      return;
    }
    refs.machineList.innerHTML = rows.map(function (row, index) {
      var warning = Number(row.remaining_percent || 0) < 15;
      return '<article class="factory-report-machine-card' + (warning ? ' is-warning' : '') + '"><div class="factory-report-machine-top"><div class="factory-report-machine-title"><strong>' + esc(row.machine_code || ("Machine " + (index + 1))) + '</strong><span>' + esc(row.order_id || "--") + ' | ' + esc(row.session_code || "--") + '</span></div><div style="display:grid;gap:10px;justify-items:end;"><button type="button" class="btn" data-factory-report-edit="' + index + '">Edit</button>' + (warning ? '<span class="factory-report-warn-chip">Material low</span>' : '') + '</div></div><div class="factory-report-legend"><span class="factory-report-legend-chip"><span class="factory-report-swatch output"></span>Output <em>/ ' + esc(label) + '</em></span><span class="factory-report-legend-chip"><span class="factory-report-swatch efficiency"></span>Wh / unit</span><span class="factory-report-legend-chip"><span class="factory-report-swatch material"></span>Remaining material</span></div><div class="factory-report-trend-shell' + (warning ? ' is-warning' : '') + '" data-factory-report-chart-index="' + index + '"></div><div class="factory-report-meta"><div><b>Mold</b><br />' + esc(row.mold_code || "--") + '</div><div><b>Lot</b><br />' + esc(row.lot_code || "--") + '</div><div><b>Staff</b><br />' + esc(row.staff || "--") + '</div><div><b>Required</b><br />' + esc(num(row.required_quantity, 0)) + '</div><div><b>Rated weight</b><br />' + esc(unit(row.rated_weight, 2, " g")) + '</div><div><b>Total energy</b><br />' + esc(unit(Number(row.total_energy_wh || 0) / 1000, 2, " KWh")) + '</div></div></article>';
    }).join("");

    Array.prototype.forEach.call(refs.machineList.querySelectorAll("[data-factory-report-edit]"), function (button) {
      button.addEventListener("click", function () {
        openModal(state, refs, rows[Number(button.getAttribute("data-factory-report-edit"))]);
      });
    });

    Array.prototype.forEach.call(refs.machineList.querySelectorAll("[data-factory-report-chart-index]"), function (host) {
      var row = rows[Number(host.getAttribute("data-factory-report-chart-index"))];
      var points = seriesMap[String(row.machine_code || "").trim()] || [];
      bindTrend(host, points, label);
    });
  }

  function exportCsv(state, refs) {
    resolveLatestQuery(refs, state).then(function (query) {
      return postMacro(state.options, {
        macro: "factory-production-overview",
        factory_id: query.factory_id,
        start_time: query.start_time,
        end_time: query.end_time,
        page_size: 100000,
        offset: 0
      }).then(function (rows) {
        if (!rows || !rows.length) {
          state.options.showToast("No overview rows to export.", "error");
          return;
        }
        var headers = ["update_time", "machine_code", "order_id", "mold_code", "lot_code", "staff", "session_code", "quantity", "error_quantity", "required_quantity", "rated_weight_g", "raw_materials_g", "remaining_percent", "total_energy_kwh", "total_time_s", "wh_per_unit"];
        var lines = [headers.map(csvCell).join(",")];
        rows.forEach(function (row) {
          lines.push([
            row.update_time,
            row.machine_code,
            row.order_id,
            row.mold_code,
            row.lot_code,
            row.staff,
            row.session_code,
            row.quantity,
            row.error_quantity,
            row.required_quantity,
            row.rated_weight,
            Math.round(Number(row.raw_materials || 0)),
            row.remaining_percent,
            (Number(row.total_energy_wh || 0) / 1000).toFixed(2),
            row.total_time_s,
            row.wh_per_unit
          ].map(csvCell).join(","));
        });
        var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = "factory-production-overview-" + query.start_time.slice(0, 10) + "-to-" + query.end_time.slice(0, 10) + ".csv";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
        state.options.showToast("CSV exported for latest-data range.", "success");
      });
    }).catch(function (error) {
      state.options.showToast(error && error.message ? error.message : "Unable to export CSV.", "error");
    });
  }

  function refresh(state, refs) {
    if (state.busy) {
      return Promise.resolve();
    }
    state.busy = true;
    setStatus(refs, "Loading", "loading");
    return resolveLatestQuery(refs, state).then(function (query) {
      return Promise.all([
        postMacro(state.options, { macro: "factory-kpis", factory_id: query.factory_id, start_time: query.start_time, end_time: query.end_time }),
        postMacro(state.options, { macro: "factory-machine-list", factory_id: query.factory_id }),
        postMacro(state.options, { macro: "factory-machine-series", factory_id: query.factory_id, start_time: query.start_time, end_time: query.end_time, bucket_minutes: query.bucket_minutes }),
        postMacro(state.options, { macro: "factory-production-overview", factory_id: query.factory_id, start_time: query.start_time, end_time: query.end_time, page_size: state.overviewPageSize, offset: (state.overviewPage - 1) * state.overviewPageSize })
      ]).then(function (response) {
        var kpi = response[0] && response[0][0] ? response[0][0] : {};
        var machines = Array.isArray(response[1]) ? response[1] : [];
        var series = Array.isArray(response[2]) ? response[2] : [];
        var overviewRows = Array.isArray(response[3]) ? response[3] : [];
        var totalRows = overviewRows.length ? Number(overviewRows[0].total_rows || 0) : 0;
        var totalPages = Math.max(1, Math.ceil(totalRows / state.overviewPageSize));
        if (state.overviewPage > totalPages) {
          state.overviewPage = totalPages;
          state.busy = false;
          return refresh(state, refs);
        }

        var root = state.root;
        var unitsNode = root.querySelector("#factory-report-kpi-units");
        var energyNode = root.querySelector("#factory-report-kpi-energy");
        var whNode = root.querySelector("#factory-report-kpi-wh");
        var sessionsNode = root.querySelector("#factory-report-kpi-sessions");
        if (unitsNode) unitsNode.textContent = num(kpi.total_units, 0);
        if (energyNode) energyNode.textContent = unit(Number(kpi.total_energy_wh || 0) / 1000, 2, " KWh");
        if (whNode) whNode.textContent = unit(kpi.wh_per_unit, 2, " Wh");
        if (sessionsNode) sessionsNode.textContent = num(kpi.active_sessions, 0);

        renderMachines(state, refs, machines, buildSeriesMap(series), query.bucket_label);
        state.overviewTotalRows = totalRows;
        renderOverviewTable(state, refs, overviewRows);
        setStatus(refs, "Live", "live");
      });
    }).catch(function (error) {
      setStatus(refs, "Error", "error");
      state.options.showToast(error && error.message ? error.message : "Unable to refresh factory production report.", "error");
    }).finally(function () {
      state.busy = false;
    });
  }

  function bind(root, state, refs) {
    if (root.dataset.factoryReportBound === "true") {
      return;
    }
    root.dataset.factoryReportBound = "true";

    if (refs.refreshButton) {
      refs.refreshButton.addEventListener("click", function () {
        refresh(state, refs);
      });
    }
    if (refs.range) {
      refs.range.addEventListener("change", function () {
        state.overviewPage = 1;
        refresh(state, refs);
      });
    }
    if (refs.overviewPrev) {
      refs.overviewPrev.addEventListener("click", function () {
        if (state.overviewPage > 1 && !state.busy) {
          state.overviewPage -= 1;
          refresh(state, refs);
        }
      });
    }
    if (refs.overviewNext) {
      refs.overviewNext.addEventListener("click", function () {
        var totalPages = Math.max(1, Math.ceil(state.overviewTotalRows / state.overviewPageSize));
        if (state.overviewPage < totalPages && !state.busy) {
          state.overviewPage += 1;
          refresh(state, refs);
        }
      });
    }
    if (refs.overviewExport) {
      refs.overviewExport.addEventListener("click", function () {
        exportCsv(state, refs);
      });
    }
    if (refs.modal) {
      refs.modal.addEventListener("click", function (event) {
        if (event.target === refs.modal) {
          closeModal(state, refs);
        }
      });
    }
    if (refs.modalClose) {
      refs.modalClose.addEventListener("click", function () {
        closeModal(state, refs);
      });
    }
    if (refs.modalCancel) {
      refs.modalCancel.addEventListener("click", function () {
        closeModal(state, refs);
      });
    }
    if (refs.form) {
      refs.form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (refs.modalSubmit) {
          refs.modalSubmit.disabled = true;
        }
        postMacro(state.options, {
          macro: "factory-log-declare",
          factory_id: String(state.options.factoryId || "").trim(),
          update_time: new Date().toISOString().slice(0, 19).replace("T", " "),
          machine_code: refs.form.elements.machine_code.value.trim(),
          session_code: refs.form.elements.session_code.value.trim(),
          order_id: refs.form.elements.order_id.value.trim(),
          mold_code: refs.form.elements.mold_code.value.trim(),
          lot_code: refs.form.elements.lot_code.value.trim(),
          staff: refs.form.elements.staff.value.trim(),
          required_quantity: refs.form.elements.required_quantity.value.trim(),
          rated_weight: refs.form.elements.rated_weight.value.trim(),
          raw_materials: refs.form.elements.raw_materials.value.trim()
        }).then(function () {
          closeModal(state, refs);
          state.options.showToast("Declaration updated.", "success");
          refresh(state, refs);
        }).catch(function (error) {
          state.options.showToast(error && error.message ? error.message : "Unable to update declaration.", "error");
        }).finally(function () {
          if (refs.modalSubmit) {
            refs.modalSubmit.disabled = false;
          }
        });
      });
    }
  }

  window.AIBridgeDashboardFactoryReportEngine = {
    init: function (root, options) {
      if (!root) {
        return;
      }
      var nextOptions = {
        sessionId: String(options && options.sessionId || "").trim(),
        syncId: String(options && options.syncId || "").trim(),
        factoryId: String(options && options.factoryId || "").trim(),
        showToast: options && typeof options.showToast === "function" ? options.showToast : function () {}
      };
      var state = root.__factoryReportState;
      if (!state) {
        state = createState(root, nextOptions);
        root.__factoryReportState = state;
      } else {
        state.options = nextOptions;
      }
      var refs = getRefs(root);
      bind(root, state, refs);
      if (state.timer) {
        window.clearInterval(state.timer);
      }
      state.timer = window.setInterval(function () {
        refresh(state, refs);
      }, 30000);
      return refresh(state, refs);
    },
    refresh: function (root) {
      if (!root || !root.__factoryReportState) {
        return Promise.resolve();
      }
      return refresh(root.__factoryReportState, getRefs(root));
    }
  };
})();
