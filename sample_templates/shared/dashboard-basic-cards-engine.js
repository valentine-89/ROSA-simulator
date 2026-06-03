(function () {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeText(value, fallback) {
    var text = String(value == null ? '' : value).trim();
    return text || String(fallback == null ? '' : fallback);
  }

  var LOCALE_TEXT = {
    en: {
      switchOn: 'ON',
      switchOff: 'OFF',
      switchSending: 'SENDING',
      switchOffline: 'OFFLINE',
      switchAria: 'Toggle switch',
      groupsSuffix: 'groups',
      cardsSuffix: 'cards',
      noSessionConfigured: 'No session configured',
      topbarTitle: 'Basic Cards Dashboard',
      topbarSubtitle: 'Compact config-driven widgets',
      run: 'Run',
      send: 'Send',
      save: 'Save',
      switchCommandMissing: 'Switch command is not configured.',
      switchUpdated: '{label} updated.',
      switchCommandFailed: 'Switch command failed.',
      commandMissing: 'Command is not configured.',
      commandSent: '{label} sent.',
      commandFailed: 'Command failed.',
      enterValueFirst: 'Enter a value first.',
      inputCommandMissing: 'Input command is not configured.',
      inputCommandFailed: 'Input command failed.',
      fillBothValues: 'Fill in both values first.',
      dualInputCommandMissing: 'Dual-input command is not configured.',
      widgetSaved: '{label} saved.',
      saveFailed: 'Save failed.',
      configInvalid: 'Basic cards config is invalid.',
      groupFallback: 'Group {index}'
    },
    vi: {
      switchOn: 'BẬT',
      switchOff: 'TẮT',
      switchSending: 'ĐANG GỬI',
      switchOffline: 'MẤT KẾT NỐI',
      switchAria: 'Đổi trạng thái công tắc',
      groupsSuffix: 'nhóm',
      cardsSuffix: 'thẻ',
      noSessionConfigured: 'Chưa cấu hình session',
      topbarTitle: 'Dashboard thẻ cơ bản',
      topbarSubtitle: 'Widget gọn, dựng hoàn toàn từ cấu hình',
      run: 'Chạy',
      send: 'Gửi',
      save: 'Lưu',
      switchCommandMissing: 'Chưa cấu hình lệnh công tắc.',
      switchUpdated: 'Đã cập nhật {label}.',
      switchCommandFailed: 'Gửi lệnh công tắc thất bại.',
      commandMissing: 'Chưa cấu hình lệnh.',
      commandSent: 'Đã gửi {label}.',
      commandFailed: 'Gửi lệnh thất bại.',
      enterValueFirst: 'Hãy nhập giá trị trước.',
      inputCommandMissing: 'Chưa cấu hình lệnh cho ô nhập.',
      inputCommandFailed: 'Gửi lệnh nhập liệu thất bại.',
      fillBothValues: 'Hãy nhập đủ cả hai giá trị.',
      dualInputCommandMissing: 'Chưa cấu hình lệnh cho hai ô nhập.',
      widgetSaved: 'Đã lưu {label}.',
      saveFailed: 'Lưu thất bại.',
      configInvalid: 'Cấu hình basic cards không hợp lệ.',
      groupFallback: 'Nhóm {index}'
    }
  };

  var activeLocale = null;

  function normalizeLocale(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (normalized.indexOf('vi') === 0) return 'vi';
    return 'en';
  }

  function getLocale() {
    if (activeLocale) return activeLocale;
    return normalizeLocale(document.documentElement.getAttribute('lang') || '');
  }

  function t(key, params) {
    var locale = getLocale();
    var table = LOCALE_TEXT[locale] || LOCALE_TEXT.en;
    var template = table[key] || LOCALE_TEXT.en[key] || key;
    if (!params || typeof params !== 'object') return template;
    return String(template).replace(/\{(\w+)\}/g, function (_, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : '';
    });
  }

  function parseSessionContext(sessionId) {
    var normalized = String(sessionId || '').trim();
    if (!normalized) return null;
    var atIndex = normalized.indexOf('@');
    if (atIndex <= 0) return null;
    return {
      ioid: normalized.slice(0, atIndex),
      apikey: normalized.slice(atIndex + 1),
    };
  }

  function buildCommandApiUrl(sessionId) {
    var context = parseSessionContext(sessionId);
    if (!context) return '';
    return 'https://iot.ioeasy.com/cmd/' + encodeURIComponent(context.ioid) + '?apiKey=' + encodeURIComponent(context.apikey);
  }

  function buildTelemetryUrl(sessionId, syncId) {
    if (!sessionId || !syncId) return '';
    return '/api/' + encodeURIComponent(sessionId) + '/' + encodeURIComponent(syncId) + '/iotelemetry';
  }

  function buildStreamUrl(sessionId, fields, historyMs) {
    if (!sessionId) return '';
    var params = new URLSearchParams();
    if (historyMs > 0) {
      params.set('historyMs', String(historyMs));
    }
    if (Array.isArray(fields) && fields.length > 0) {
      params.set('fields', fields.join(','));
    }
    return '/api/' + encodeURIComponent(sessionId) + '/stream?' + params.toString();
  }

  function numericValue(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    var match = String(value == null ? '' : value).match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
  }

  function formatValue(value, digits, unit) {
    var numeric = numericValue(value);
    if (numeric === null) return '--';
    var precision = Number.isFinite(digits) ? Math.max(0, Math.min(4, Number(digits))) : 0;
    return numeric.toFixed(precision) + (unit ? ' ' + unit : '');
  }

  function normalizeSwitchState(value) {
    var normalized = String(value == null ? '' : value).trim().toUpperCase();
    if (normalized === '1' || normalized === 'TRUE' || normalized === 'ON' || normalized === 'CLOSED') return 'on';
    if (normalized === '0' || normalized === 'FALSE' || normalized === 'OFF' || normalized === 'OPEN') return 'off';
    return 'offline';
  }

  function parseRangeMs(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (!normalized) return 6 * 60 * 60 * 1000;
    var match = normalized.match(/^(\d+)(m|h|d)$/);
    if (!match) return 6 * 60 * 60 * 1000;
    var amount = Math.max(1, Number(match[1]));
    if (match[2] === 'm') return amount * 60 * 1000;
    if (match[2] === 'h') return amount * 60 * 60 * 1000;
    return amount * 24 * 60 * 60 * 1000;
  }

  function getInputType(valueType) {
    var normalized = String(valueType || 'string').trim().toLowerCase();
    if (normalized === 'number') return 'number';
    if (normalized === 'datetime' || normalized === 'datetime-local') return 'datetime-local';
    return 'text';
  }

  function hydrateConfigPlaceholders(rawText) {
    var params = new URLSearchParams(window.location.search);
    var sessionId = String(params.get('sessionId') || params.get('sessionid') || '').trim();
    var syncId = String(params.get('syncId') || params.get('syncid') || '').trim();
    return String(rawText || '')
      .replaceAll('<<sessionid>>', sessionId || '<<sessionid>>')
      .replaceAll('<<syncid>>', syncId || '<<syncid>>');
  }

  function createToastStack() {
    return document.getElementById('basic-cards-toast-stack');
  }

  function showToast(message, type) {
    var stack = createToastStack();
    if (!stack) return;
    var toast = document.createElement('div');
    toast.className = 'bc-toast' + (type === 'error' ? ' error' : '');
    toast.textContent = String(message || '');
    stack.appendChild(toast);
    window.setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-6px)';
      toast.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
      window.setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }, 2200);
  }

  function ensureEngineStyles() {
    if (document.getElementById('basic-cards-engine-style')) {
      return;
    }
    var style = document.createElement('style');
    style.id = 'basic-cards-engine-style';
    style.textContent = '' +
      '.bc-chart-hitbox{fill:transparent;cursor:crosshair;pointer-events:all;}' +
      '.bc-chart-hover-line{fill:none;stroke:color-mix(in srgb, var(--theme-text) 32%, transparent);stroke-width:1.5;stroke-dasharray:4 4;opacity:0;pointer-events:none;}' +
      '.bc-chart-point{fill:var(--bc-accent);stroke:color-mix(in srgb, var(--theme-card) 92%, transparent);stroke-width:2;opacity:0;pointer-events:none;}' +
      '.bc-chart-tooltip{position:absolute;left:10px;top:28px;min-width:112px;max-width:min(180px,calc(100% - 20px));padding:8px 10px;border-radius:14px;background:color-mix(in srgb, var(--theme-card) 94%, transparent);border:var(--theme-border);box-shadow:var(--theme-shadow);font-size:0.72rem;font-weight:800;line-height:1.35;color:var(--theme-text);opacity:0;transform:translate3d(0,8px,0);transition:opacity 0.12s ease,transform 0.12s ease;pointer-events:none;z-index:3;}' +
      '.bc-chart-tooltip strong{display:block;font-size:0.82rem;letter-spacing:-0.02em;margin-top:2px;}' +
      '.bc-chart-tooltip-time{display:block;color:color-mix(in srgb, var(--theme-text) 62%, transparent);font-size:0.66rem;font-weight:700;letter-spacing:0.01em;}';
    document.head.appendChild(style);
  }

  function formatChartTimestamp(timestamp) {
    if (!timestamp) return '--';
    try {
      return new Date(timestamp).toLocaleString('en-GB', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).replace(',', '');
    } catch (error) {
      return '--';
    }
  }

  function hideChartTooltip(widgetState) {
    if (!widgetState || !widgetState.tooltipNode || !widgetState.hoverLineNode || !widgetState.pointNode) {
      return;
    }
    widgetState.tooltipNode.style.opacity = '0';
    widgetState.tooltipNode.style.transform = 'translate3d(0,8px,0)';
    widgetState.hoverLineNode.style.opacity = '0';
    widgetState.pointNode.style.opacity = '0';
  }

  function updateChartTooltip(widgetState, clientX) {
    var chartState = widgetState.chartState;
    if (!chartState || !Array.isArray(chartState.points) || chartState.points.length <= 1) {
      hideChartTooltip(widgetState);
      return;
    }
    var rect = widgetState.hitboxNode.getBoundingClientRect();
    if (!rect.width) {
      hideChartTooltip(widgetState);
      return;
    }
    var relativeX = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    var ratio = rect.width <= 0 ? 0 : (relativeX / rect.width);
    var index = Math.max(0, Math.min(chartState.points.length - 1, Math.round(ratio * (chartState.points.length - 1))));
    var point = chartState.points[index];
    if (!point) {
      hideChartTooltip(widgetState);
      return;
    }
    widgetState.hoverLineNode.setAttribute('x1', point.x.toFixed(2));
    widgetState.hoverLineNode.setAttribute('x2', point.x.toFixed(2));
    widgetState.hoverLineNode.style.opacity = '1';
    widgetState.pointNode.setAttribute('cx', point.x.toFixed(2));
    widgetState.pointNode.setAttribute('cy', point.y.toFixed(2));
    widgetState.pointNode.style.opacity = '1';
    widgetState.tooltipNode.innerHTML = '<span class="bc-chart-tooltip-time">' + escapeHtml(formatChartTimestamp(point.ts)) + '</span><strong>' + escapeHtml(formatValue(point.value, widgetState.widget.digits, widgetState.widget.unit)) + '</strong>';
    var tooltipLeft = Math.min(Math.max(point.x - 52, 8), Math.max(8, (widgetState.node.clientWidth || 176) - 132));
    widgetState.tooltipNode.style.left = tooltipLeft + 'px';
    widgetState.tooltipNode.style.opacity = '1';
    widgetState.tooltipNode.style.transform = 'translate3d(0,0,0)';
  }

  function applyTheme(nextTheme) {
    if (!nextTheme) return;
    document.documentElement.setAttribute('data-theme', nextTheme);
    try { window.localStorage.setItem('sample-dashboard-theme', nextTheme); } catch (error) {}
    var picker = document.getElementById('theme-picker');
    var buttons = picker ? picker.querySelectorAll('[data-theme-option]') : [];
    Array.prototype.forEach.call(buttons, function (button) {
      var isActive = String(button.getAttribute('data-theme-option') || '') === nextTheme;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  function initThemePicker() {
    var picker = document.getElementById('theme-picker');
    var toggle = document.getElementById('theme-picker-toggle');
    var menu = document.getElementById('theme-picker-menu');
    if (!picker || !toggle || !menu) return;

    function setOpen(isOpen) {
      picker.classList.toggle('is-open', !!isOpen);
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    toggle.addEventListener('click', function () {
      setOpen(!picker.classList.contains('is-open'));
    });

    menu.addEventListener('click', function (event) {
      var button = event.target && typeof event.target.closest === 'function'
        ? event.target.closest('[data-theme-option]')
        : null;
      if (!button) return;
      applyTheme(String(button.getAttribute('data-theme-option') || 'neumorphism'));
      setOpen(false);
    });

    document.addEventListener('click', function (event) {
      if (!picker.contains(event.target)) {
        setOpen(false);
      }
    });

    applyTheme(document.documentElement.getAttribute('data-theme') || 'neumorphism');
  }

  function createCardNode(widget) {
    var node = document.createElement('article');
    node.className = 'bc-card';
    node.setAttribute('data-type', widget.type);
    node.setAttribute('data-tone', widget.tone || 'primary');
    node.innerHTML = '<div class="bc-card-title"></div><div class="bc-card-body"></div>';
    node.querySelector('.bc-card-title').textContent = safeText(widget.label, widget.type);
    return node;
  }

  function setTelemetryState(widgetState, value) {
    if (widgetState.valueNode) {
      widgetState.valueNode.textContent = formatValue(value, widgetState.widget.digits, widgetState.widget.unit);
    }
  }

  function renderSparkline(widgetState, points) {
    if (!widgetState.pathNode || !widgetState.areaNode || !widgetState.emptyNode || !widgetState.valueNode) {
      return;
    }
    var historyMs = widgetState.widget.rangeMs || (6 * 60 * 60 * 1000);
    var from = Date.now() - historyMs;
    var visible = (points || []).filter(function (point) {
      return point && point.ts >= from && Number.isFinite(point.value);
    });

    if (visible.length > 160) {
      var step = (visible.length - 1) / 159;
      var sampled = [];
      for (var sampleIndex = 0; sampleIndex < 160; sampleIndex += 1) {
        var sourceIndex = Math.round(sampleIndex * step);
        if (sourceIndex >= visible.length) {
          sourceIndex = visible.length - 1;
        }
        if (sampled.length <= 0 || sampled[sampled.length - 1] !== visible[sourceIndex]) {
          sampled.push(visible[sourceIndex]);
        }
      }
      if (sampled[sampled.length - 1] !== visible[visible.length - 1]) {
        sampled.push(visible[visible.length - 1]);
      }
      visible = sampled;
    }

    if (visible.length <= 1) {
      widgetState.pathNode.setAttribute('d', '');
      widgetState.areaNode.setAttribute('d', '');
      widgetState.emptyNode.setAttribute('d', 'M10 76 H150');
      widgetState.valueNode.textContent = '--';
      widgetState.chartState = null;
      hideChartTooltip(widgetState);
      return;
    }

    var minValue = visible[0].value;
    var maxValue = visible[0].value;
    visible.forEach(function (point) {
      minValue = Math.min(minValue, point.value);
      maxValue = Math.max(maxValue, point.value);
    });
    if (Number.isFinite(widgetState.widget.yMin)) {
      minValue = Math.min(minValue, widgetState.widget.yMin);
    }
    if (Number.isFinite(widgetState.widget.yDeltaMin) && widgetState.widget.yDeltaMin > 0) {
      var currentDelta = maxValue - minValue;
      if (currentDelta < widgetState.widget.yDeltaMin) {
        var center = (maxValue + minValue) / 2;
        minValue = center - (widgetState.widget.yDeltaMin / 2);
        maxValue = center + (widgetState.widget.yDeltaMin / 2);
      }
    }
    if (minValue === maxValue) {
      minValue -= 1;
      maxValue += 1;
    }
    var left = 10;
    var right = 150;
    var top = 16;
    var bottom = 76;
    var width = right - left;
    var height = bottom - top;

    function pointX(index) {
      if (visible.length === 1) return left;
      return left + (index / (visible.length - 1)) * width;
    }

    function pointY(value) {
      return bottom - ((value - minValue) / (maxValue - minValue)) * height;
    }

    var chartPoints = visible.map(function (point, index) {
      return {
        ts: point.ts,
        value: point.value,
        x: pointX(index),
        y: pointY(point.value)
      };
    });

    var path = '';
    chartPoints.forEach(function (point, index) {
      path += (index === 0 ? 'M' : ' L') + point.x.toFixed(2) + ' ' + point.y.toFixed(2);
    });
    var area = path + ' L' + chartPoints[chartPoints.length - 1].x.toFixed(2) + ' ' + bottom + ' L' + chartPoints[0].x.toFixed(2) + ' ' + bottom + ' Z';
    widgetState.pathNode.setAttribute('d', path);
    widgetState.areaNode.setAttribute('d', area);
    widgetState.emptyNode.setAttribute('d', '');
    widgetState.valueNode.textContent = formatValue(chartPoints[chartPoints.length - 1].value, widgetState.widget.digits, widgetState.widget.unit);
    widgetState.chartState = {
      points: chartPoints,
      left: left,
      right: right,
      top: top,
      bottom: bottom
    };
  }

  function setSwitchVisual(widgetState, state) {
    var normalized = state || 'offline';
    widgetState.switchButton.setAttribute('data-state', normalized);
    widgetState.statusNode.setAttribute('data-state', normalized);
    widgetState.statusNode.textContent = normalized === 'on'
      ? t('switchOn')
      : normalized === 'off'
        ? t('switchOff')
        : normalized === 'pending'
          ? t('switchSending')
          : t('switchOffline');
  }

  function appendPoint(store, field, ts, value) {
    if (!field || !Number.isFinite(value)) return;
    var key = String(field).trim().toLowerCase();
    if (!key) return;
    if (!Array.isArray(store.series[key])) {
      store.series[key] = [];
    }
    store.series[key].push({ ts: Number(ts || Date.now()), value: Number(value) });
    store.series[key].sort(function (left, right) { return left.ts - right.ts; });
    var cutoff = Date.now() - Math.max(store.maxHistoryMs || 0, 24 * 60 * 60 * 1000);
    while (store.series[key].length > 1 && store.series[key][0].ts < cutoff) {
      store.series[key].shift();
    }
  }

  function createTelemetryWidget(widget) {
    var node = createCardNode(widget);
    var body = node.querySelector('.bc-card-body');
    body.innerHTML = '<div class="bc-value-stack"><div class="bc-value">--</div><div class="bc-subvalue">' + escapeHtml(widget.field) + '</div></div>';
    return {
      widget: widget,
      node: node,
      valueNode: body.querySelector('.bc-value'),
      apply: function (store) {
        setTelemetryState(this, store.latest[this.widget.fieldKey]);
      },
    };
  }

  function createSwitchWidget(widget, runCommand) {
    var node = createCardNode(widget);
    var body = node.querySelector('.bc-card-body');
    body.innerHTML = '' +
      '<div class="bc-switch-shell">' +
        '<button class="bc-switch-button" type="button" data-state="offline" aria-label="' + escapeHtml(t('switchAria')) + '">' +
          '<span class="bc-switch-track">' +
            '<span class="bc-switch-knob"></span>' +
            '<span class="bc-switch-label bc-switch-label-on">ON</span>' +
            '<span class="bc-switch-label bc-switch-label-off">OFF</span>' +
          '</span>' +
        '</button>' +
        '<div class="bc-status bc-switch-status" data-state="offline">OFFLINE</div>' +
      '</div>';
    var state = {
      widget: widget,
      node: node,
      switchButton: body.querySelector('.bc-switch-button'),
      statusNode: body.querySelector('.bc-switch-status'),
      isBusy: false,
      apply: function (store) {
        if (this.isBusy) return;
        setSwitchVisual(this, normalizeSwitchState(store.latest[this.widget.stateFieldKey]));
      },
    };
    state.switchButton.addEventListener('click', function () {
      if (state.isBusy) return;
      var current = state.switchButton.getAttribute('data-state') === 'on' ? 'on' : 'off';
      var nextState = current === 'on' ? 'off' : 'on';
      var command = nextState === 'on' ? widget.commandOn : widget.commandOff;
      if (!command) {
        showToast(t('switchCommandMissing'), 'error');
        return;
      }
      state.isBusy = true;
      setSwitchVisual(state, 'pending');
      runCommand(widget.sessionId, command)
        .then(function () {
          state.isBusy = false;
          setSwitchVisual(state, nextState);
          showToast(t('switchUpdated', { label: widget.label }), 'success');
        })
        .catch(function () {
          state.isBusy = false;
          setSwitchVisual(state, current === 'on' ? 'on' : 'off');
          showToast(t('switchCommandFailed'), 'error');
        });
    });
    return state;
  }

  function createCommandWidget(widget, runCommand) {
    var node = createCardNode(widget);
    var body = node.querySelector('.bc-card-body');
    body.innerHTML = '<button class="bc-command-button" type="button">' + escapeHtml(widget.buttonLabel || t('run')) + '</button>';
    var button = body.querySelector('.bc-command-button');
    button.addEventListener('click', function () {
      if (button.disabled) return;
      if (!widget.command) {
        showToast(t('commandMissing'), 'error');
        return;
      }
      button.disabled = true;
      runCommand(widget.sessionId, widget.command)
        .then(function () {
          showToast(t('commandSent', { label: widget.label }), 'success');
        })
        .catch(function () {
          showToast(t('commandFailed'), 'error');
        })
        .finally(function () {
          button.disabled = false;
        });
    });
    return { widget: widget, node: node, apply: function () {} };
  }

  function applyCommandTemplate(template, values) {
    var output = String(template || '');
    Object.keys(values || {}).forEach(function (key) {
      output = output.replaceAll('{' + key + '}', String(values[key] == null ? '' : values[key]));
    });
    return output;
  }

  function safeValueString(value) {
    if (value == null) return '';
    return String(value).trim();
  }

  function applyInputValue(input, nextValue, options) {
    if (!input) return;
    var normalized = safeValueString(nextValue);
    var shouldForce = !!(options && options.force);
    var isFocused = document.activeElement === input;
    var isDirty = input.getAttribute('data-dirty') === 'true';
    if (!shouldForce && (isFocused || isDirty)) {
      return;
    }
    if (!normalized) {
      if (shouldForce || !isDirty) {
        input.value = '';
        input.setAttribute('data-last-auto-value', '');
      }
      return;
    }
    if (input.value !== normalized) {
      input.value = normalized;
    }
    input.setAttribute('data-last-auto-value', normalized);
    input.setAttribute('data-dirty', 'false');
  }

  function parsePairedInputValue(value) {
    var normalized = safeValueString(value);
    if (!normalized) return null;
    var parts = normalized.split(',');
    if (parts.length < 2) return null;
    return [safeValueString(parts[0]), safeValueString(parts[1])];
  }

  function createInputWidget(widget, runCommand) {
    var node = createCardNode(widget);
    var body = node.querySelector('.bc-card-body');
    var inputType = getInputType(widget.input && widget.input.valueType);
    body.innerHTML = '' +
      '<div class="bc-input-shell">' +
        '<input class="bc-input" type="' + escapeHtml(inputType) + '" placeholder="' + escapeHtml(widget.input && widget.input.placeholder || '') + '" data-dirty="false" />' +
        '<button class="bc-input-button" type="button">' + escapeHtml(widget.buttonLabel || t('send')) + '</button>' +
      '</div>';
    var input = body.querySelector('.bc-input');
    var button = body.querySelector('.bc-input-button');
    if (widget.input && widget.input.defaultValue != null) {
      input.value = String(widget.input.defaultValue);
      input.setAttribute('data-last-auto-value', String(widget.input.defaultValue));
    }
    input.addEventListener('input', function () {
      input.setAttribute('data-dirty', 'true');
    });
    button.addEventListener('click', function () {
      if (button.disabled) return;
      var value = String(input.value || '').trim();
      if (!value) {
        showToast(t('enterValueFirst'), 'error');
        return;
      }
      var command = applyCommandTemplate(widget.submitCommand, { value: value, [(widget.input && widget.input.key) || 'value']: value });
      if (!command) {
        showToast(t('inputCommandMissing'), 'error');
        return;
      }
      button.disabled = true;
      input.disabled = true;
      runCommand(widget.sessionId, command)
        .then(function () {
          input.setAttribute('data-dirty', 'false');
          input.setAttribute('data-last-auto-value', value);
          showToast(t('commandSent', { label: widget.label }), 'success');
        })
        .catch(function () {
          showToast(t('inputCommandFailed'), 'error');
        })
        .finally(function () {
          button.disabled = false;
          input.disabled = false;
        });
    });
    return {
      widget: widget,
      node: node,
      inputNode: input,
      apply: function (store) {
        var sourceFieldKey = safeText((this.widget.input && (this.widget.input.field || this.widget.input.valueField)) || this.widget.field, '').toLowerCase();
        if (!sourceFieldKey) return;
        applyInputValue(this.inputNode, store.latest[sourceFieldKey]);
      }
    };
  }

  function createDualInputWidget(widget, runCommand) {
    var node = createCardNode(widget);
    var body = node.querySelector('.bc-card-body');
    body.innerHTML = '' +
      '<div class="bc-dual-shell">' +
        '<div class="bc-dual-row"></div>' +
        '<button class="bc-dual-button" type="button">' + escapeHtml(widget.buttonLabel || t('save')) + '</button>' +
      '</div>';
    var row = body.querySelector('.bc-dual-row');
    var button = body.querySelector('.bc-dual-button');
    var inputs = [];
    (Array.isArray(widget.inputs) ? widget.inputs : []).slice(0, 2).forEach(function (definition) {
      var input = document.createElement('input');
      input.className = 'bc-dual-input';
      input.type = getInputType(definition.valueType);
      input.placeholder = String(definition.placeholder || definition.label || '');
      input.setAttribute('data-dirty', 'false');
      if (definition.defaultValue != null) {
        input.value = String(definition.defaultValue);
        input.setAttribute('data-last-auto-value', String(definition.defaultValue));
      }
      input.addEventListener('input', function () {
        input.setAttribute('data-dirty', 'true');
      });
      row.appendChild(input);
      inputs.push({ key: definition.key || 'value', fieldKey: safeText(definition.field || definition.valueField, '').toLowerCase(), input: input });
    });
    button.addEventListener('click', function () {
      if (button.disabled) return;
      var payload = {};
      var isValid = true;
      inputs.forEach(function (entry) {
        var value = String(entry.input.value || '').trim();
        if (!value) isValid = false;
        payload[entry.key] = value;
      });
      if (!isValid) {
        showToast(t('fillBothValues'), 'error');
        return;
      }
      var command = applyCommandTemplate(widget.submitCommand, payload);
      if (!command) {
        showToast(t('dualInputCommandMissing'), 'error');
        return;
      }
      button.disabled = true;
      inputs.forEach(function (entry) { entry.input.disabled = true; });
      runCommand(widget.sessionId, command)
        .then(function () {
          inputs.forEach(function (entry) {
            entry.input.setAttribute('data-dirty', 'false');
            entry.input.setAttribute('data-last-auto-value', String(entry.input.value || '').trim());
          });
          showToast(t('widgetSaved', { label: widget.label }), 'success');
        })
        .catch(function () {
          showToast(t('saveFailed'), 'error');
        })
        .finally(function () {
          button.disabled = false;
          inputs.forEach(function (entry) { entry.input.disabled = false; });
        });
    });
    return {
      widget: widget,
      node: node,
      inputs: inputs,
      apply: function (store) {
        var pairFieldKey = safeText(this.widget.field, '').toLowerCase();
        if (pairFieldKey) {
          var pairValue = parsePairedInputValue(store.latest[pairFieldKey]);
          if (pairValue) {
            if (this.inputs[0]) applyInputValue(this.inputs[0].input, pairValue[0]);
            if (this.inputs[1]) applyInputValue(this.inputs[1].input, pairValue[1]);
            return;
          }
        }
        this.inputs.forEach(function (entry) {
          if (!entry.fieldKey) return;
          applyInputValue(entry.input, store.latest[entry.fieldKey]);
        });
      }
    };
  }

  function createLineChartWidget(widget) {
    var node = createCardNode(widget);
    var body = node.querySelector('.bc-card-body');
    body.innerHTML = '' +
      '<div class="bc-chart-wrap">' +
        '<div class="bc-chart-value">--</div>' +
        '<div class="bc-chart-tooltip"></div>' +
        '<svg class="bc-chart-svg" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true">' +
          '<g class="bc-chart-grid">' +
            '<line x1="10" y1="24" x2="150" y2="24"></line>' +
            '<line x1="10" y1="50" x2="150" y2="50"></line>' +
            '<line x1="10" y1="76" x2="150" y2="76"></line>' +
          '</g>' +
          '<path class="bc-chart-area" d=""></path>' +
          '<path class="bc-chart-path" d=""></path>' +
          '<path class="bc-chart-empty" d="M10 76 H150"></path>' +
          '<line class="bc-chart-hover-line" x1="10" y1="16" x2="10" y2="76"></line>' +
          '<circle class="bc-chart-point" cx="10" cy="76" r="3.6"></circle>' +
          '<rect class="bc-chart-hitbox" x="10" y="16" width="140" height="60"></rect>' +
        '</svg>' +
      '</div>';
    var state = {
      widget: widget,
      node: node,
      valueNode: body.querySelector('.bc-chart-value'),
      tooltipNode: body.querySelector('.bc-chart-tooltip'),
      pathNode: body.querySelector('.bc-chart-path'),
      areaNode: body.querySelector('.bc-chart-area'),
      emptyNode: body.querySelector('.bc-chart-empty'),
      hoverLineNode: body.querySelector('.bc-chart-hover-line'),
      pointNode: body.querySelector('.bc-chart-point'),
      hitboxNode: body.querySelector('.bc-chart-hitbox'),
      chartState: null,
      apply: function (store) {
        renderSparkline(this, store.series[this.widget.fieldKey] || []);
      },
    };
    state.hitboxNode.addEventListener('pointermove', function (event) {
      updateChartTooltip(state, event.clientX);
    });
    state.hitboxNode.addEventListener('pointerleave', function () {
      hideChartTooltip(state);
    });
    state.hitboxNode.addEventListener('pointerdown', function (event) {
      updateChartTooltip(state, event.clientX);
    });
    return state;
  }

  function normalizeWidget(rawWidget, groupIndex, widgetIndex, groupSessionId) {
    var widget = rawWidget && typeof rawWidget === 'object' ? rawWidget : {};
    var type = String(widget.type || 'telemetry').trim().toLowerCase();
    var normalized = {
      id: safeText(widget.id, 'widget-' + String(groupIndex + 1) + '-' + String(widgetIndex + 1)),
      type: type,
      label: safeText(widget.label, type),
      tone: safeText(widget.tone, 'primary'),
      sessionId: safeText(widget.sessionId, groupSessionId),
      digits: Number(widget.digits || 0),
      unit: safeText(widget.unit, ''),
      field: safeText(widget.field, ''),
      fieldKey: safeText(widget.field, '').toLowerCase(),
      stateField: safeText(widget.stateField, ''),
      stateFieldKey: safeText(widget.stateField, '').toLowerCase(),
      command: safeText(widget.command, ''),
      commandOn: safeText(widget.commandOn, ''),
      commandOff: safeText(widget.commandOff, ''),
      buttonLabel: safeText(widget.buttonLabel, ''),
      submitCommand: safeText(widget.submitCommand, ''),
      input: widget.input && typeof widget.input === 'object' ? widget.input : null,
      inputs: Array.isArray(widget.inputs) ? widget.inputs : [],
      range: safeText(widget.range, '6h'),
      rangeMs: parseRangeMs(widget.range),
      yMin: Number.isFinite(Number(widget.yMin)) ? Number(widget.yMin) : null,
      yDeltaMin: Number.isFinite(Number(widget.yDeltaMin)) ? Number(widget.yDeltaMin) : null,
    };
    return normalized;
  }

  function createWidgetState(widget, runCommand) {
    if (widget.type === 'switch') return createSwitchWidget(widget, runCommand);
    if (widget.type === 'command') return createCommandWidget(widget, runCommand);
    if (widget.type === 'input') return createInputWidget(widget, runCommand);
    if (widget.type === 'dual-input') return createDualInputWidget(widget, runCommand);
    if (widget.type === 'line-chart') return createLineChartWidget(widget);
    return createTelemetryWidget(widget);
  }

  function parseConfig() {
    var node = document.getElementById('basic-cards-config');
    if (!node) return null;
    try {
      var parsed = JSON.parse(hydrateConfigPlaceholders(node.textContent || '{}'));
      activeLocale = normalizeLocale(parsed && parsed.locale ? parsed.locale : '');
      return parsed;
    } catch (error) {
      showToast(t('configInvalid'), 'error');
      return null;
    }
  }

  function runCommandFactory(sessionStores) {
    return function runCommand(sessionId, command) {
      var sessionKey = String(sessionId || '').trim();
      var store = sessionStores[sessionKey];
      var commandApiUrl = store && store.commandApiUrl;
      if (!commandApiUrl || !command) {
        return Promise.reject(new Error('missing command context'));
      }
      var resolver = window.AIBridgeCommandTemplate;
      var resolvePromise = resolver && typeof resolver.resolveCommandTemplate === 'function'
        ? resolver.resolveCommandTemplate(command)
        : Promise.resolve(String(command || '')
          .replace(/<<email>>/gi, '')
          .replace(/<<username>>/gi, '')
          .replace(/<<phone>>/gi, ''));
      return resolvePromise.then(function (resolvedCommand) {
        return fetch(commandApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd: String(resolvedCommand || '') })
        }).then(function (response) {
          return response.text().then(function (text) {
            if (!response.ok) {
              throw new Error(text || 'Command failed.');
            }
            return text;
          });
        });
      });
    };
  }

  function applyTelemetryPayload(store, payload, timestamp) {
    if (!payload || typeof payload !== 'object') return;
    Object.keys(payload).forEach(function (field) {
      var key = String(field || '').trim();
      if (!key) return;
      store.latest[key.toLowerCase()] = payload[field];
      var numeric = numericValue(payload[field]);
      if (numeric !== null && store.chartFields[key.toLowerCase()]) {
        appendPoint(store, key, timestamp, numeric);
      }
    });
  }

  function applyTimeseriesRows(store, rows) {
    if (!Array.isArray(rows)) return;
    rows.forEach(function (row) {
      var field = String(row && row.field || '').trim();
      var value = Number(row && row.value);
      if (!field || !isFinite(value)) return;
      appendPoint(store, field, row.ts || Date.now(), value);
      store.latest[field.toLowerCase()] = value;
    });
  }

  function rerenderStoreWidgets(store) {
    store.widgets.forEach(function (widgetState) {
      widgetState.apply(store);
    });
  }

  function bootstrapStore(store, syncId) {
    var url = buildTelemetryUrl(store.sessionId, syncId);
    if (!url) return Promise.resolve();
    return fetch(url, { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        var latest = payload && payload.c2 && payload.c2.payload;
        if (latest && typeof latest === 'object') {
          applyTelemetryPayload(store, latest, payload.c2.serverTime || Date.now());
          rerenderStoreWidgets(store);
        }
      })
      .catch(function () {});
  }

  function connectStore(store) {
    if (!store.sessionId) return;
    var fields = Object.keys(store.fields);
    var url = buildStreamUrl(store.sessionId, fields, store.maxHistoryMs);
    if (!url) return;

    function open() {
      store.eventSource = new EventSource(url);
      store.eventSource.onmessage = function (event) {
        var data = null;
        try { data = JSON.parse(event.data); } catch (error) { return; }
        if (!data || !data.type) return;
        if (data.type === 'telemetry') {
          applyTelemetryPayload(store, data.payload, data.serverTime || Date.now());
          rerenderStoreWidgets(store);
          return;
        }
        if (data.type === 'timeseries') {
          applyTimeseriesRows(store, data.rows);
          rerenderStoreWidgets(store);
        }
      };
      store.eventSource.onerror = function () {
        if (store.eventSource) {
          store.eventSource.close();
          store.eventSource = null;
        }
        if (store.reconnectTimer) window.clearTimeout(store.reconnectTimer);
        store.reconnectTimer = window.setTimeout(open, 3000);
      };
    }

    open();
  }

  function render(config) {
    var groupsRoot = document.getElementById('basic-cards-groups');
    var titleNode = document.getElementById('basic-cards-title');
    var subtitleNode = document.getElementById('basic-cards-subtitle');
    var groupsChip = document.getElementById('basic-cards-groups-chip');
    var widgetsChip = document.getElementById('basic-cards-widgets-chip');
    if (!groupsRoot || !titleNode || !subtitleNode || !groupsChip || !widgetsChip) return;

    titleNode.textContent = safeText(config.title, t('topbarTitle'));
    subtitleNode.textContent = safeText(config.subtitle, t('topbarSubtitle'));
    groupsRoot.innerHTML = '';

    var groups = Array.isArray(config.groups) ? config.groups : [];
    var sessionStores = Object.create(null);

    function ensureStore(sessionId) {
      var key = String(sessionId || '').trim();
      if (!key) return null;
      if (!sessionStores[key]) {
        sessionStores[key] = {
          sessionId: key,
          commandApiUrl: buildCommandApiUrl(key),
          fields: Object.create(null),
          chartFields: Object.create(null),
          maxHistoryMs: 0,
          latest: Object.create(null),
          series: Object.create(null),
          widgets: [],
          eventSource: null,
          reconnectTimer: null,
        };
      }
      return sessionStores[key];
    }

    var totalWidgets = 0;
    var runCommand = runCommandFactory(sessionStores);

    groups.forEach(function (groupConfig, groupIndex) {
      var group = groupConfig && typeof groupConfig === 'object' ? groupConfig : {};
      var groupTitle = safeText(group.title, t('groupFallback', { index: String(groupIndex + 1) }));
      var groupSessionId = safeText(group.sessionId, '');
      var section = document.createElement('section');
      section.className = 'bc-group';
      section.innerHTML = '' +
        '<div class="bc-group-head">' +
          '<div class="bc-group-title">' +
            '<h2>' + escapeHtml(groupTitle) + '</h2>' +
            '<p>' + escapeHtml(groupSessionId ? groupSessionId.split('@')[0] : t('noSessionConfigured')) + '</p>' +
          '</div>' +
          '<div class="bc-chip">' + escapeHtml(String((Array.isArray(group.widgets) ? group.widgets.length : 0) || 0)) + ' ' + escapeHtml(t('cardsSuffix')) + '</div>' +
        '</div>' +
        '<div class="bc-grid"></div>';
      var grid = section.querySelector('.bc-grid');

      (Array.isArray(group.widgets) ? group.widgets : []).forEach(function (rawWidget, widgetIndex) {
        var widget = normalizeWidget(rawWidget, groupIndex, widgetIndex, groupSessionId);
        var widgetState = createWidgetState(widget, runCommand);
        grid.appendChild(widgetState.node);
        totalWidgets += 1;

        var store = ensureStore(widget.sessionId);
        if (store) {
          store.widgets.push(widgetState);
          // Keep stream query fields in original case; only runtime lookup keys should be normalized to lowercase.
          if (widget.field) {
            store.fields[widget.field] = true;
          }
          if (widget.stateField) {
            store.fields[widget.stateField] = true;
          }
          if (widget.type === 'input') {
            var inputField = safeText((widget.input && (widget.input.field || widget.input.valueField)) || widget.field, '');
            if (inputField) {
              store.fields[inputField] = true;
            }
          }
          if (widget.type === 'dual-input') {
            if (widget.field) {
              store.fields[widget.field] = true;
            }
            (Array.isArray(widget.inputs) ? widget.inputs : []).forEach(function (definition) {
              var definitionField = safeText(definition && (definition.field || definition.valueField), '');
              if (definitionField) {
                store.fields[definitionField] = true;
              }
            });
          }
          if (widget.type === 'line-chart' && widget.fieldKey) {
            store.chartFields[widget.fieldKey] = true;
            store.maxHistoryMs = Math.max(store.maxHistoryMs, widget.rangeMs || 0);
          }
        }
      });

      groupsRoot.appendChild(section);
    });

    groupsChip.textContent = String(groups.length) + ' ' + t('groupsSuffix');
    widgetsChip.textContent = String(totalWidgets) + ' ' + t('cardsSuffix');

    Object.keys(sessionStores).forEach(function (sessionKey) {
      var store = sessionStores[sessionKey];
      bootstrapStore(store, safeText(config.syncId, '')).finally(function () {
        connectStore(store);
      });
    });
  }

  function init() {
    if (!document.getElementById('basic-cards-root')) return;
    ensureEngineStyles();
    initThemePicker();
    var config = parseConfig();
    if (!config) return;
    render(config);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
