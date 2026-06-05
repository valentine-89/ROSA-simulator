(function () {
  function normalizeActionEntry(entry, sessionIndex) {
    var kind = String((entry && entry[0]) || "quick").trim().toLowerCase();
    if (kind === "params") {
      return {
        kind: "parameterized",
        title: String((entry && entry[1]) || "--"),
        commandFormat: String((entry && entry[2]) || ""),
        iconText: String((entry && entry[3]) || ""),
        params: (Array.isArray(entry && entry[4]) ? entry[4] : []).map(function (param) {
          return {
            key: String((param && param[0]) || "").trim(),
            label: String((param && param[1]) || "--"),
            type: String((param && param[2]) || "text").trim().toLowerCase(),
            placeholder: String((param && param[3]) || "")
          };
        }).filter(function (param) {
          return param.key;
        }),
        sessionIndex: String(sessionIndex || "0")
      };
    }
    return {
      kind: "quick",
      title: String((entry && entry[1]) || "Actions"),
      command: String((entry && entry[2]) || ""),
      iconText: String((entry && entry[3]) || ""),
      sessionIndex: String(sessionIndex || "0")
    };
  }

  function normalizeCommandUiConfig(dashboardConfig) {
    var source = dashboardConfig && dashboardConfig.widgetManifests && typeof dashboardConfig.widgetManifests.commandUi === "object"
      ? dashboardConfig.widgetManifests.commandUi
      : {};
    var defaultSessionIndex = String(source.sessionIndex || "0");
    var widgets = Array.isArray(source.widgets) ? source.widgets : [];
    return {
      defaultSessionIndex: defaultSessionIndex,
      widgets: widgets.map(function (entry) {
        var type = String((entry && entry[0]) || "").trim().toLowerCase();
        if (type === "iframe") {
          var meta = entry && typeof entry[3] === "object" ? entry[3] : {};
          return {
            type: "iframe",
            title: String((entry && entry[1]) || "Control view"),
            url: String((entry && entry[2]) || ""),
            width: Number(meta.width || 1280),
            height: Number(meta.height || 720)
          };
        }
        if (type === "actions") {
          return {
            type: "actions",
            title: String((entry && entry[1]) || "--"),
            display: String((entry && entry[2]) || "panel").trim().toLowerCase(),
            actions: (Array.isArray(entry && entry[3]) ? entry[3] : []).map(function (actionEntry) {
              return normalizeActionEntry(actionEntry, defaultSessionIndex);
            }).filter(function (action) {
              return action.kind === "parameterized" ? action.commandFormat : action.command;
            })
          };
        }
        if (type === "slider") {
          var sliderPayload = entry && typeof entry[2] === "object" ? entry[2] : {};
          return {
            type: "slider",
            title: String((entry && entry[1]) || sliderPayload.title || "Slider control"),
            sessionIndex: String(sliderPayload.sessionIndex || defaultSessionIndex),
            toolbar: (Array.isArray(sliderPayload.toolbar) ? sliderPayload.toolbar : []).map(function (actionEntry) {
              return normalizeActionEntry(actionEntry, String(sliderPayload.sessionIndex || defaultSessionIndex));
            }).filter(function (action) {
              return action.command;
            }),
            control: Array.isArray(sliderPayload.control) ? sliderPayload.control : ["Target angle", "deg", "100", "0", "360", "D1O1'{angle}'", ""]
          };
        }
        if (type === "form") {
          var formPayload = entry && typeof entry[2] === "object" ? entry[2] : {};
          return {
            type: "form",
            title: String((entry && entry[1]) || formPayload.title || "Input form"),
            sessionIndex: String(formPayload.sessionIndex || defaultSessionIndex),
            fields: Array.isArray(formPayload.fields) ? formPayload.fields : [],
            submit: Array.isArray(formPayload.submit) ? formPayload.submit : ["Submit", ""],
            actions: (Array.isArray(formPayload.actions) ? formPayload.actions : []).map(function (actionEntry) {
              return normalizeActionEntry(actionEntry, String(formPayload.sessionIndex || defaultSessionIndex));
            }).filter(function (action) {
              return action.command;
            })
          };
        }
        return null;
      }).filter(Boolean)
    };
  }

  function renderActionToolbar(widget, dom, helpers) {
    if (dom.commandCenterTitle) {
      dom.commandCenterTitle.textContent = widget.title || "Command center";
    }
    if (!dom.commandCenterToolbar) {
      return;
    }
    dom.commandCenterToolbar.innerHTML = "";
    widget.actions.forEach(function (action) {
      var node = helpers.cloneEditableTemplate("ai-bridge-template-command-toolbar-button");
      var button = node && (node.matches("button") ? node : node.querySelector("[data-slot='button']"));
      if (!button) {
        return;
      }
      button.className = "btn toolbar-button";
      button.textContent = action.title;
      button.setAttribute("data-ai-session-index", action.sessionIndex);
      button.setAttribute("data-command", String(action.command || ""));
      button.setAttribute("data-label", String(action.title || "Command"));
      dom.commandCenterToolbar.appendChild(button);
    });
  }

  function renderSliderControlLayout(widget, dom, helpers) {
    if (!dom.sliderWidgetRoot) {
      return;
    }
    var panel = helpers.cloneEditableTemplate("ai-bridge-template-slider-control-panel");
    if (!panel) {
      return;
    }

    var titleNode = panel.querySelector("#slider-control-title");
    var toolbar = panel.querySelector("#slider-control-toolbar");
    var sliderLabel = panel.querySelector("#slider-control-label");
    var sliderInput = panel.querySelector("#slider-control-input");
    var sliderValueLabel = panel.querySelector("#slider-control-value-label");
    var controlConfig = widget.control;

    if (titleNode) titleNode.textContent = widget.title || "Slider control";
    if (sliderLabel) sliderLabel.textContent = String((controlConfig && controlConfig[0]) || "Target value");
    if (sliderInput) {
      sliderInput.value = String((controlConfig && controlConfig[2]) || "100");
      sliderInput.min = String((controlConfig && controlConfig[3]) || "0");
      sliderInput.max = String((controlConfig && controlConfig[4]) || "360");
      sliderInput.setAttribute("data-command-format", String((controlConfig && controlConfig[5]) || ""));
      sliderInput.setAttribute("data-unit", String((controlConfig && controlConfig[1]) || ""));
      sliderInput.setAttribute("data-ai-session-index", String(widget.sessionIndex || "0"));
      sliderInput.setAttribute("data-feedback-code", String((controlConfig && controlConfig[6]) || ""));
    }
    if (sliderValueLabel && sliderInput) {
      sliderValueLabel.textContent = sliderInput.value + " " + (sliderInput.getAttribute("data-unit") || "");
    }
    if (sliderInput) {
      sliderInput.addEventListener("input", function () {
        if (sliderValueLabel) {
          sliderValueLabel.textContent = sliderInput.value + " " + (sliderInput.getAttribute("data-unit") || "");
        }
      });
      sliderInput.addEventListener("change", function () {
        var commandFormat = String(sliderInput.getAttribute("data-command-format") || "");
        var sessionIndex = String(sliderInput.getAttribute("data-ai-session-index") || widget.sessionIndex || "0");
        var command = commandFormat.replaceAll("{angle}", String(sliderInput.value || "").trim());
        if (!command || !helpers.runtime || typeof helpers.runtime.runCommand !== "function") {
          return;
        }
        helpers.runtime.runCommand(command, widget.title || "Slider control", sessionIndex);
      });
    }
    if (toolbar) {
      toolbar.innerHTML = "";
      (Array.isArray(widget.toolbar) ? widget.toolbar : []).forEach(function (action) {
        var readButton = helpers.cloneEditableTemplate("ai-bridge-template-command-toolbar-button");
        var readNode = readButton && (readButton.matches("button") ? readButton : readButton.querySelector("[data-slot='button']"));
        if (!readNode) {
          return;
        }
        readNode.className = "btn toolbar-button";
        readNode.textContent = String(action.title || "Action");
        readNode.setAttribute("data-ai-session-index", action.sessionIndex);
        readNode.setAttribute("data-command", String(action.command || ""));
        readNode.setAttribute("data-label", String(action.title || "Action"));
        toolbar.appendChild(readNode);
      });
    }

    dom.sliderWidgetRoot.appendChild(panel);
  }

  function renderFormWidgetLayout(widget, dom, helpers) {
    if (!dom.formWidgetRoot) {
      return;
    }
    var panel = helpers.cloneEditableTemplate("ai-bridge-template-form-panel");
    if (!panel) {
      return;
    }

    var titleNode = panel.querySelector("#form-panel-title");
    var fieldGrid = panel.querySelector("#form-panel-field-grid");
    var actionsRoot = panel.querySelector("#form-panel-actions");
    var submitButton = panel.querySelector("#form-panel-submit");

    if (titleNode) {
      titleNode.textContent = widget.title || "Input form";
    }
    if (fieldGrid) {
      fieldGrid.innerHTML = "";
      widget.fields.forEach(function (field) {
        var key = String((field && field[0]) || "");
        var type = String((field && field[1]) || "text").toLowerCase();
        var defaultValue = String((field && field[2]) || "");
        var placeholder = String((field && field[3]) || "");
        var input = document.createElement(type === "select" ? "select" : type === "textarea" ? "textarea" : "input");
        input.className = type === "select" ? "select" : type === "textarea" ? "textarea tall-textarea" : "input";
        input.setAttribute("data-form-field", key);
        if (type === "select") {
          (Array.isArray(field && field[4]) ? field[4] : []).forEach(function (option) {
            var optionNode = document.createElement("option");
            optionNode.value = String((option && option[0]) || "");
            optionNode.textContent = String((option && option[1]) || optionNode.value);
            if (optionNode.value === defaultValue) {
              optionNode.selected = true;
            }
            input.appendChild(optionNode);
          });
        } else if (type === "textarea") {
          input.value = defaultValue;
          if (placeholder) {
            input.placeholder = placeholder;
          }
        } else {
          input.type = type;
          input.value = defaultValue;
          if (placeholder) {
            input.placeholder = placeholder;
          }
        }
        fieldGrid.appendChild(input);
      });
    }
    if (actionsRoot) {
      actionsRoot.innerHTML = "";
      widget.actions.forEach(function (action) {
        var actionButton = helpers.cloneEditableTemplate("ai-bridge-template-command-toolbar-button");
        var actionNode = actionButton && (actionButton.matches("button") ? actionButton : actionButton.querySelector("[data-slot='button']"));
        if (!actionNode) {
          return;
        }
        actionNode.className = "btn toolbar-button w-full";
        actionNode.textContent = String(action.title || "Action");
        actionNode.setAttribute("data-ai-session-index", String(action.sessionIndex || widget.sessionIndex || "0"));
        actionNode.setAttribute("data-command", String(action.command || ""));
        actionNode.setAttribute("data-label", String(action.title || "Action"));
        actionsRoot.appendChild(actionNode);
      });
    }
    if (submitButton) {
      submitButton.textContent = String((widget.submit && widget.submit[0]) || "Submit");
      submitButton.setAttribute("data-ai-session-index", String(widget.sessionIndex || "0"));
      submitButton.addEventListener("click", function () {
        var command = String((widget.submit && widget.submit[1]) || "");
        if (!command) {
          return;
        }
        Array.prototype.forEach.call(panel.querySelectorAll("[data-form-field]"), function (fieldNode) {
          var fieldKey = String(fieldNode.getAttribute("data-form-field") || "");
          var fieldValue = String(fieldNode.value || "").replace(/"/g, '\\"');
          command = command.replaceAll("{" + fieldKey + "}", fieldValue);
        });
        helpers.runtime.runCommand(command, String((widget.submit && widget.submit[0]) || "Submit"), helpers.runtime.getSessionIndex(submitButton));
      });
    }

    dom.formWidgetRoot.appendChild(panel);
  }

  function renderActionPanelLayout(widget, dom, helpers) {
    if (!dom.actionPanelRoot) {
      return;
    }
    if (dom.actionPanelTitle) {
      dom.actionPanelTitle.textContent = widget.title || "Actions";
    }
    dom.actionPanelRoot.innerHTML = "";
    widget.actions.forEach(function (definition) {
      var node = helpers.cloneEditableTemplate("ai-bridge-template-program-action");
      if (!node) {
        return;
      }
      var button = node.matches("button") ? node : node.querySelector("[data-slot='button']");
      var iconNode = node.querySelector("[data-slot='icon']");
      var titleNode = node.querySelector("[data-slot='title']");
      if (!button) {
        return;
      }
      button.className = "btn program-action-button";
      button.setAttribute("data-action-kind", definition.kind);
      button.setAttribute("data-action-title", definition.title);
      button.setAttribute("data-ai-session-index", definition.sessionIndex);
      if (definition.command) {
        button.setAttribute("data-command", definition.command);
        button.setAttribute("data-label", definition.title);
      }
      if (iconNode) {
        var iconText = String(definition.iconText || "").trim();
        iconNode.textContent = iconText;
        iconNode.toggleAttribute("hidden", !iconText);
      }
      if (titleNode) {
        titleNode.textContent = definition.title;
      }
      if (definition.kind === "parameterized") {
        button.addEventListener("click", function () {
          helpers.openActionModal(definition);
        });
      }
      dom.actionPanelRoot.appendChild(node);
    });
  }

  function renderCommandUi(config, dom, helpers) {
    if (dom.sliderWidgetRoot) {
      dom.sliderWidgetRoot.innerHTML = "";
    }
    if (dom.formWidgetRoot) {
      dom.formWidgetRoot.innerHTML = "";
    }
    config.widgets.forEach(function (widget) {
      if (widget.type === "iframe") {
        helpers.renderControlView(widget);
        return;
      }
      if (widget.type === "actions" && widget.display === "toolbar") {
        renderActionToolbar(widget, dom, helpers);
        return;
      }
      if (widget.type === "actions" && widget.display === "panel") {
        renderActionPanelLayout(widget, dom, helpers);
        return;
      }
      if (widget.type === "slider") {
        renderSliderControlLayout(widget, dom, helpers);
        return;
      }
      if (widget.type === "form") {
        renderFormWidgetLayout(widget, dom, helpers);
      }
    });
  }

  function openActionModal(definition, dom) {
    if (!dom.actionModal || !dom.actionModalFields || !definition) {
      return;
    }
    if (dom.actionModalTitle) {
      dom.actionModalTitle.textContent = definition.title;
    }
    if (dom.actionModalSubmit) {
      dom.actionModalSubmit.className = "btn full modal-submit";
      dom.actionModalSubmit.textContent = definition.title;
      dom.actionModalSubmit.setAttribute("data-ai-session-index", definition.sessionIndex);
    }
    dom.actionModalFields.innerHTML = "";
    definition.params.forEach(function (param, index) {
      var label = document.createElement("label");
      label.className = "subhead";
      if (index > 0) {
        label.classList.add("field-label-gap");
      }
      label.textContent = param.label;
      dom.actionModalFields.appendChild(label);

      var field;
      if (param.type === "textarea") {
        field = document.createElement("textarea");
        field.classList.add("tall-textarea");
      } else {
        field = document.createElement("input");
        field.type = param.type || "text";
      }
      field.className = "input";
      field.setAttribute("data-action-param", param.key);
      if (param.placeholder) {
        field.setAttribute("placeholder", param.placeholder);
      }
      dom.actionModalFields.appendChild(field);
    });
    dom.actionModal.classList.add("is-open");
  }

  function closeActionModal(dom) {
    if (dom.actionModal) {
      dom.actionModal.classList.remove("is-open");
    }
  }

  function buildActionCommand(definition, dom) {
    var command = String((definition && definition.commandFormat) || "");
    if (!command || !dom.actionModalFields) {
      return "";
    }
    var valid = true;
    Array.prototype.forEach.call(dom.actionModalFields.querySelectorAll("[data-action-param]"), function (field) {
      var key = String(field.getAttribute("data-action-param") || "");
      var value = String(field.value || "").trim();
      if (!value) {
        valid = false;
      }
      command = command.replaceAll("{" + key + "}", value.replace(/"/g, '\\"'));
    });
    return valid ? command : "";
  }

  window.AIBridgeDashboardActionEngine = {
    normalizeActionEntry: normalizeActionEntry,
    normalizeCommandUiConfig: normalizeCommandUiConfig,
    renderActionToolbar: renderActionToolbar,
    renderSliderControlLayout: renderSliderControlLayout,
    renderFormWidgetLayout: renderFormWidgetLayout,
    renderActionPanelLayout: renderActionPanelLayout,
    renderCommandUi: renderCommandUi,
    openActionModal: openActionModal,
    closeActionModal: closeActionModal,
    buildActionCommand: buildActionCommand
  };
})();
