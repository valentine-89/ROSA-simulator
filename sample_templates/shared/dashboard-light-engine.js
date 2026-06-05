(function () {
  function renderLightWidgetLayout(cards, helpers) {
    var root = helpers.getLightRoot();
    if (!root) {
      return;
    }

    root.innerHTML = "";
    (Array.isArray(cards) ? cards : []).forEach(function (definition) {
      var card = helpers.cloneTemplateById("ai-bridge-template-light-card");
      if (!card) {
        return;
      }

      var titleNode = card.querySelector("[data-slot='title']");
      var refreshButton = card.querySelector("[data-slot='refresh']");
      var onButton = card.querySelector("[data-slot='on-button']");
      var offButton = card.querySelector("[data-slot='off-button']");
      var outputCode = String(definition.outputCode || "").trim().toUpperCase();
      var title = String(definition.title || outputCode || "Light");

      card.id = "light-card-" + String(definition.key || outputCode || title);
      if (titleNode) {
        titleNode.textContent = title;
      }
      if (refreshButton) {
        refreshButton.setAttribute("data-ai-session-index", definition.sessionIndex);
        refreshButton.setAttribute("data-command", outputCode);
        refreshButton.setAttribute("data-label", title + " status");
        refreshButton.setAttribute("aria-label", "Read " + title + " status");
        refreshButton.setAttribute("title", "Read " + title + " status");
      }
      if (onButton) {
        onButton.setAttribute("data-ai-session-index", definition.sessionIndex);
        onButton.setAttribute("data-command", "D1" + outputCode);
        onButton.setAttribute("data-label", title + " on");
      }
      if (offButton) {
        offButton.setAttribute("data-ai-session-index", definition.sessionIndex);
        offButton.setAttribute("data-command", "D2" + outputCode);
        offButton.setAttribute("data-label", title + " off");
      }

      root.appendChild(card);
    });
  }

  function setLightState(card, value) {
    if (!card) {
      return;
    }

    var onButton = card.querySelector("[data-slot='on-button']");
    var offButton = card.querySelector("[data-slot='off-button']");
    var normalized = String(value == null ? "" : value).trim().toUpperCase();
    if (normalized === "TRUE" || normalized === "1") {
      normalized = "ON";
    } else if (normalized === "FALSE" || normalized === "0") {
      normalized = "OFF";
    }

    card.classList.remove("is-on", "is-off");

    if (normalized === "ON") {
      card.classList.add("is-on");
      card.setAttribute("data-state", "on");
      if (onButton) onButton.setAttribute("aria-pressed", "true");
      if (offButton) offButton.setAttribute("aria-pressed", "false");
      return;
    }

    if (normalized === "OFF") {
      card.classList.add("is-off");
      card.setAttribute("data-state", "off");
      if (onButton) onButton.setAttribute("aria-pressed", "false");
      if (offButton) offButton.setAttribute("aria-pressed", "true");
      return;
    }

    card.classList.add("is-off");
    card.setAttribute("data-state", "pending");
    if (onButton) onButton.setAttribute("aria-pressed", "false");
    if (offButton) offButton.setAttribute("aria-pressed", "false");
  }

  window.AIBridgeDashboardLightEngine = {
    renderLightWidgetLayout: renderLightWidgetLayout,
    setLightState: setLightState
  };
})();
