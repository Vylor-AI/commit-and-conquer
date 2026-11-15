(function () {
  const PANEL_ID = "cc-settings-panel";
  const BACKDROP_ID = "cc-settings-backdrop";
  const CONTRIBUTORS_CONTAINER_ID = "cc-settings-contributors";

  function createOrGetBackdrop() {
    let backdrop = document.getElementById(BACKDROP_ID);
    if (backdrop) return backdrop;

    backdrop = document.createElement("div");
    backdrop.id = BACKDROP_ID;
    backdrop.style.position = "fixed";
    backdrop.style.inset = "0";
    backdrop.style.background = "rgba(7, 12, 20, 0.68)";
    backdrop.style.backdropFilter = "blur(1px)";
    backdrop.style.zIndex = "10020";
    backdrop.style.display = "none";
    document.body.appendChild(backdrop);

    return backdrop;
  }

  function createOrGetPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.style.position = "fixed";
    panel.style.top = "58px";
    panel.style.right = "14px";
    panel.style.width = "min(640px, calc(100vw - 28px))";
    panel.style.maxHeight = "calc(100vh - 78px)";
    panel.style.overflow = "auto";
    panel.style.border = "1px solid rgba(129, 194, 255, 0.34)";
    panel.style.borderRadius = "12px";
    panel.style.background = "rgba(16, 24, 38, 0.96)";
    panel.style.boxShadow = "0 16px 50px rgba(0,0,0,0.5)";
    panel.style.zIndex = "10030";
    panel.style.padding = "14px";
    panel.style.display = "none";

    const title = document.createElement("h3");
    title.textContent = "Settings";
    title.style.margin = "0";
    title.style.color = "#e8f1ff";
    title.style.fontSize = "20px";

    const subtitle = document.createElement("p");
    subtitle.textContent = "Select rows to merge.";
    subtitle.style.margin = "6px 0 10px";
    subtitle.style.color = "#9fb0ca";
    subtitle.style.fontSize = "13px";

    const actionBar = document.createElement("div");
    actionBar.style.display = "flex";
    actionBar.style.flexWrap = "wrap";
    actionBar.style.gap = "8px";
    actionBar.style.marginBottom = "10px";

    const reimportButton = document.createElement("button");
    reimportButton.type = "button";
    reimportButton.textContent = "Import / Re-import JSON";
    stylePrimaryButton(reimportButton);
    reimportButton.addEventListener("click", () => {
      closeSettings();
      if (typeof window.showImportOverlay === "function") {
        window.showImportOverlay({
          allowDismiss: true,
          onHistoryImported: (history) => {
            if (typeof window.applyImportedHistory === "function") {
              window.applyImportedHistory(history);
            } else if (typeof applyHistoryTimeline === "function") {
              applyHistoryTimeline(history);
            }

            refreshContributorList();
          },
        });
      }
    });

    const mergeSelectedButton = document.createElement("button");
    mergeSelectedButton.type = "button";
    mergeSelectedButton.textContent = "Merge selected";
    stylePrimaryButton(mergeSelectedButton);
    mergeSelectedButton.addEventListener("click", () => {
      if (!window.ProfileConfig) return;

      const list = document.getElementById(CONTRIBUTORS_CONTAINER_ID);
      if (!list) return;

      const selectedRows = Array.from(
        list.querySelectorAll("[data-contributor-row='1']")
      ).filter((row) => {
        const checkbox = row.querySelector("[data-select='1']");
        return checkbox && checkbox.checked;
      });

      if (selectedRows.length < 2) return;

      const canonicalName = selectedRows[0].getAttribute("data-name") || "";
      if (!canonicalName) return;

      selectedRows.slice(1).forEach((row) => {
        const aliasName = row.getAttribute("data-name") || "";
        if (!aliasName || aliasName === canonicalName) return;
        window.ProfileConfig.setMerge(aliasName, canonicalName);
      });

      refreshContributorList();
    });

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";
    stylePrimaryButton(saveButton);
    saveButton.addEventListener("click", () => {
      if (!window.ProfileConfig) return;

      const list = document.getElementById(CONTRIBUTORS_CONTAINER_ID);
      if (!list) return;

      const profiles = {};
      list.querySelectorAll("[data-contributor-row='1']").forEach((row) => {
        const canonicalName = row.getAttribute("data-name") || "";
        if (!canonicalName) return;

        const nameInput = row.querySelector("[data-field='name']");
        const initialsInput = row.querySelector("[data-field='initials']");
        const colorInput = row.querySelector("[data-field='color']");
        const avatarInput = row.querySelector("[data-field='avatarUrl']");

        profiles[canonicalName] = {
          name: nameInput ? nameInput.value : "",
          initials: initialsInput ? initialsInput.value : "",
          color: colorInput ? colorInput.value : "",
          avatarUrl: avatarInput ? avatarInput.value : "",
        };
      });

      window.ProfileConfig.saveProfiles(profiles);

      const sourceHistory =
        typeof window.getSourceHistory === "function"
          ? window.getSourceHistory()
          : typeof window.getActiveHistory === "function"
            ? window.getActiveHistory()
            : Array.isArray(historyTimeline)
              ? historyTimeline
              : [];

      if (typeof window.applyImportedHistory === "function") {
        window.applyImportedHistory(sourceHistory);
      } else if (typeof applyHistoryTimeline === "function") {
        applyHistoryTimeline(sourceHistory);
      }

      refreshContributorList();
      closeSettings();
    });

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "Reset";
    styleGhostButton(resetButton);
    resetButton.addEventListener("click", () => {
      if (!window.ProfileConfig) return;
      window.ProfileConfig.resetAll();

      const sourceHistory =
        typeof window.getSourceHistory === "function"
          ? window.getSourceHistory()
          : typeof window.getActiveHistory === "function"
            ? window.getActiveHistory()
            : Array.isArray(historyTimeline)
              ? historyTimeline
              : [];

      if (typeof window.applyImportedHistory === "function") {
        window.applyImportedHistory(sourceHistory);
      } else if (typeof applyHistoryTimeline === "function") {
        applyHistoryTimeline(sourceHistory);
      }

      refreshContributorList();
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";
    styleGhostButton(closeButton);
    closeButton.addEventListener("click", () => {
      closeSettings();
    });

    actionBar.appendChild(reimportButton);
    actionBar.appendChild(mergeSelectedButton);
    actionBar.appendChild(saveButton);
    actionBar.appendChild(resetButton);
    actionBar.appendChild(closeButton);

    const contributorList = document.createElement("div");
    contributorList.id = CONTRIBUTORS_CONTAINER_ID;
    contributorList.style.display = "grid";
    contributorList.style.gap = "8px";

    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(actionBar);
    panel.appendChild(contributorList);

    document.body.appendChild(panel);
    return panel;
  }

  function stylePrimaryButton(button) {
    button.style.border = "1px solid rgba(129, 194, 255, 0.6)";
    button.style.background = "rgba(53, 101, 146, 0.45)";
    button.style.color = "#e8f1ff";
    button.style.fontSize = "12px";
    button.style.padding = "8px 10px";
    button.style.borderRadius = "7px";
    button.style.cursor = "pointer";
  }

  function styleGhostButton(button) {
    button.style.border = "1px solid rgba(129, 194, 255, 0.35)";
    button.style.background = "rgba(38, 55, 80, 0.25)";
    button.style.color = "#d7e6ff";
    button.style.fontSize = "12px";
    button.style.padding = "8px 10px";
    button.style.borderRadius = "7px";
    button.style.cursor = "pointer";
  }

  function styleInput(input) {
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.border = "1px solid rgba(129, 194, 255, 0.28)";
    input.style.background = "rgba(8, 16, 28, 0.62)";
    input.style.color = "#e8f1ff";
    input.style.padding = "8px 9px";
    input.style.borderRadius = "6px";
    input.style.fontSize = "12px";
  }

  function styleCompactInput(input) {
    input.style.boxSizing = "border-box";
    input.style.border = "1px solid rgba(129, 194, 255, 0.28)";
    input.style.background = "rgba(8, 16, 28, 0.62)";
    input.style.color = "#e8f1ff";
    input.style.padding = "7px 8px";
    input.style.borderRadius = "6px";
    input.style.fontSize = "12px";
  }

  function buildContributorRow(entry) {
    const row = document.createElement("div");
    row.setAttribute("data-contributor-row", "1");
    row.setAttribute("data-name", entry.name);
    row.style.display = "grid";
    row.style.gridTemplateColumns =
      "28px 34px 56px minmax(170px, 1fr) minmax(200px, 1.3fr)";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.padding = "8px";
    row.style.border = "1px solid rgba(129, 194, 255, 0.2)";
    row.style.borderRadius = "8px";
    row.style.background = "rgba(19, 31, 50, 0.55)";

    const selectInput = document.createElement("input");
    selectInput.type = "checkbox";
    selectInput.setAttribute("data-select", "1");
    selectInput.style.width = "16px";
    selectInput.style.height = "16px";
    selectInput.style.cursor = "pointer";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = entry.color || "#8a97ad";
    colorInput.setAttribute("data-field", "color");
    colorInput.style.width = "32px";
    colorInput.style.height = "32px";
    colorInput.style.padding = "0";
    colorInput.style.border = "1px solid rgba(129, 194, 255, 0.28)";
    colorInput.style.borderRadius = "6px";
    colorInput.style.background = "transparent";

    const initialsInput = document.createElement("input");
    initialsInput.type = "text";
    initialsInput.value = entry.initials || "";
    initialsInput.maxLength = 3;
    initialsInput.placeholder = "INI";
    initialsInput.setAttribute("data-field", "initials");
    initialsInput.style.width = "56px";
    styleCompactInput(initialsInput);

    const nameWrap = document.createElement("div");
    nameWrap.style.display = "flex";
    nameWrap.style.flexDirection = "column";
    nameWrap.style.gap = "4px";

    const nameView = document.createElement("button");
    nameView.type = "button";
    nameView.textContent = entry.displayName || entry.name;
    nameView.title = `${entry.name}${entry.aliases && entry.aliases.length > 1 ? ` (${entry.aliases.length} merged)` : ""}`;
    nameView.style.textAlign = "left";
    nameView.style.border = "rgba(129, 194, 255, 0.2)";
    nameView.style.background = "rgba(13, 24, 40)";
    nameView.style.color = "#e8f1ff";
    nameView.style.padding = "8px 9px";
    nameView.style.borderRadius = "6px";
    nameView.style.cursor = "text";
    nameView.style.fontSize = "12px";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = entry.displayName || entry.name;
    nameInput.setAttribute("data-field", "name");
    styleInput(nameInput);
    nameInput.style.display = "none";

    nameView.addEventListener("click", () => {
      nameView.style.display = "none";
      nameInput.style.display = "block";
      nameInput.focus();
      nameInput.select();
    });

    const commitNameInput = () => {
      const value = nameInput.value.trim();
      nameView.textContent = value || entry.name;
      nameInput.value = value;
      nameInput.style.display = "none";
      nameView.style.display = "block";
    };

    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        commitNameInput();
      }
      if (event.key === "Escape") {
        nameInput.value = nameView.textContent || entry.name;
        nameInput.style.display = "none";
        nameView.style.display = "block";
      }
    });

    nameInput.addEventListener("blur", () => {
      commitNameInput();
    });

    const aliasHint = document.createElement("div");
    aliasHint.style.fontSize = "11px";
    aliasHint.style.color = "#9fb0ca";
    if (!entry.aliases || entry.aliases.length == 0) {
      aliasHint.style.display = "none";
    }
    aliasHint.textContent =
      entry.aliases && entry.aliases.length > 1
        ? `${entry.aliases.length} merged identities`
        : "";

    nameWrap.appendChild(nameView);
    nameWrap.appendChild(nameInput);
    nameWrap.appendChild(aliasHint);

    const avatarInput = document.createElement("input");
    avatarInput.type = "text";
    avatarInput.value = entry.avatarUrl || "";
    avatarInput.placeholder = "Avatar URL";
    avatarInput.setAttribute("data-field", "avatarUrl");
    styleInput(avatarInput);

    row.appendChild(selectInput);
    row.appendChild(colorInput);
    row.appendChild(initialsInput);
    row.appendChild(nameWrap);
    row.appendChild(avatarInput);

    return row;
  }

  function refreshContributorList() {
    const container = document.getElementById(CONTRIBUTORS_CONTAINER_ID);
    if (!container) return;

    container.innerHTML = "";

    if (!window.ProfileConfig) {
      const empty = document.createElement("div");
      empty.textContent = "Profile config module is unavailable.";
      empty.style.color = "#ff9ba6";
      empty.style.fontSize = "13px";
      container.appendChild(empty);
      return;
    }

    const entries = window.ProfileConfig.getEditableContributors();
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.textContent =
        "No contributors available yet. Import battle data first.";
      empty.style.color = "#9fb0ca";
      empty.style.fontSize = "13px";
      container.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      container.appendChild(buildContributorRow(entry));
    });
  }

  function openSettings() {
    const backdrop = createOrGetBackdrop();
    const panel = createOrGetPanel();
    refreshContributorList();
    backdrop.style.display = "block";
    panel.style.display = "block";

    if (window.CNCAnalytics && typeof window.CNCAnalytics.track === "function") {
      window.CNCAnalytics.track("settings_opened");
    }
  }

  function closeSettings() {
    const backdrop = createOrGetBackdrop();
    const panel = createOrGetPanel();
    backdrop.style.display = "none";
    panel.style.display = "none";
  }

  function initialize() {
    const trigger = document.getElementById("settings-btn");
    const backdrop = createOrGetBackdrop();
    createOrGetPanel();

    if (trigger) {
      trigger.addEventListener("click", () => {
        const panel = document.getElementById(PANEL_ID);
        if (panel && panel.style.display === "block") {
          closeSettings();
        } else {
          openSettings();
        }
      });
    }

    backdrop.addEventListener("click", () => {
      closeSettings();
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeSettings();
      }
    });
  }

  window.SettingsUI = {
    initialize,
    open: openSettings,
    close: closeSettings,
    refreshContributorList,
  };
})();
