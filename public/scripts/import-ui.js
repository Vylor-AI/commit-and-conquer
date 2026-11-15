(function () {
  const IMPORT_OVERLAY_ID = "cc-import-overlay";
  const CNC_REPO_URL = "https://github.com/Vylor-AI/commit-and-conquer";
  const GENERATE_SCRIPT_COMMAND =
    "bash <(curl -fsSL https://raw.githubusercontent.com/Vylor-AI/commit-and-conquer/refs/heads/master/generate-cnc-data.sh) -p 16 -o ./cnc_data.json .";

  let removeGlobalDragGuards = null;

  function hideImportOverlay() {
    const existing = document.getElementById(IMPORT_OVERLAY_ID);
    if (existing) existing.remove();

    if (typeof removeGlobalDragGuards === "function") {
      removeGlobalDragGuards();
      removeGlobalDragGuards = null;
    }
  }

  function installGlobalDragGuards() {
    const preventBrowserOpen = (event) => {
      event.preventDefault();
    };

    window.addEventListener("dragenter", preventBrowserOpen, false);
    window.addEventListener("dragover", preventBrowserOpen, false);
    window.addEventListener("drop", preventBrowserOpen, false);

    return () => {
      window.removeEventListener("dragenter", preventBrowserOpen, false);
      window.removeEventListener("dragover", preventBrowserOpen, false);
      window.removeEventListener("drop", preventBrowserOpen, false);
    };
  }

  function setStatus(statusNode, text, kind) {
    if (!statusNode) return;
    statusNode.textContent = text || "";
    statusNode.style.color = kind === "error" ? "#ff9ba6" : "#8a97ad";
  }

  function processImportedText(rawText, opts, statusNode) {
    if (!window.HistoryNormalizer) {
      setStatus(statusNode, "History normalizer is not available.", "error");
      return false;
    }

    const parsed = window.HistoryNormalizer.safeParseJson(rawText);
    if (!parsed) {
      setStatus(statusNode, "Invalid JSON file.", "error");
      return false;
    }

    const normalized = window.HistoryNormalizer.normalizeImportedHistory(parsed);
    const history = normalized.history;
    const errors = normalized.errors || [];

    if (errors.length > 0) {
      console.warn("Import warnings:", errors.slice(0, 20));
    }

    if (!history || history.length === 0) {
      setStatus(statusNode, errors.join(","), "error");
      return false;
    }

    if (window.HistoryStorage) {
      window.HistoryStorage.persistImportedHistory(rawText);
    }

    if (typeof opts.onHistoryImported === "function") {
      opts.onHistoryImported(history);
      return true;
    }

    if (typeof window.applyHistoryTimeline === "function") {
      window.applyHistoryTimeline(history);
      return true;
    }

    setStatus(
      statusNode,
      "Import succeeded, but timeline apply handler is not available.",
      "error"
    );
    return false;
  }

  async function processFile(file, opts, statusNode) {
    if (!file) {
      setStatus(statusNode, "No file detected.", "error");
      return false;
    }

    const looksLikeJson =
      !file.type ||
      file.type === "application/json" ||
      file.name.toLowerCase().endsWith(".json");

    if (!looksLikeJson) {
      setStatus(statusNode, "Please provide a JSON file.", "error");
      return false;
    }

    let rawText = "";
    try {
      rawText = await file.text();
    } catch (_error) {
      setStatus(statusNode, "Could not read the selected file.", "error");
      return false;
    }

    const ok = processImportedText(rawText, opts, statusNode);
    if (ok) {
      setStatus(statusNode, "Import succeeded.", "info");
      hideImportOverlay();
    }
    return ok;
  }

  function getDroppedFileFromDataTransfer(dataTransfer) {
    if (!dataTransfer) return null;

    if (dataTransfer.files && dataTransfer.files.length > 0) {
      return dataTransfer.files[0];
    }

    if (dataTransfer.items && dataTransfer.items.length > 0) {
      for (let i = 0; i < dataTransfer.items.length; i += 1) {
        const item = dataTransfer.items[i];
        if (item && item.kind === "file") {
          const file = item.getAsFile();
          if (file) return file;
        }
      }
    }

    return null;
  }

  function bindDropTarget(dropTarget, opts, statusNode) {
    const setActive = (active) => {
      dropTarget.style.borderColor = active
        ? "rgba(129, 194, 255, 0.85)"
        : "rgba(129, 194, 255, 0.45)";
      dropTarget.style.background = active
        ? "rgba(65, 120, 170, 0.22)"
        : "rgba(65, 120, 170, 0.14)";
    };

    const onDragEnter = (event) => {
      event.preventDefault();
      event.stopPropagation();
      setActive(true);
    };

    const onDragOver = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setActive(true);
    };

    const onDragLeave = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!dropTarget.contains(event.relatedTarget)) {
        setActive(false);
      }
    };

    const onDrop = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      setActive(false);

      const file = getDroppedFileFromDataTransfer(event.dataTransfer);
      if (!file) {
        setStatus(
          statusNode,
          "No file detected from drop. Try selecting with Choose file.",
          "error"
        );
        return;
      }

      await processFile(file, opts, statusNode);
    };

    dropTarget.addEventListener("dragenter", onDragEnter, false);
    dropTarget.addEventListener("dragover", onDragOver, false);
    dropTarget.addEventListener("dragleave", onDragLeave, false);
    dropTarget.addEventListener("drop", onDrop, false);

    return () => {
      dropTarget.removeEventListener("dragenter", onDragEnter, false);
      dropTarget.removeEventListener("dragover", onDragOver, false);
      dropTarget.removeEventListener("dragleave", onDragLeave, false);
      dropTarget.removeEventListener("drop", onDrop, false);
    };
  }

  async function copyScriptCommand(commandInput, copyButton, statusNode) {
    const textToCopy = commandInput.value || GENERATE_SCRIPT_COMMAND;
    let copied = false;

    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        copied = true;
      } catch (_error) {}
    }

    if (!copied) {
      try {
        commandInput.focus();
        commandInput.select();
        copied = document.execCommand("copy");
      } catch (_error) {
        copied = false;
      }
    }

    if (!copied) {
      setStatus(
        statusNode,
        "Could not copy command automatically. Please copy it manually.",
        "error"
      );
      return;
    }

    copyButton.textContent = "Copied!";
    setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 1800);

    setStatus(statusNode, "Command copied.", "info");
  }

  function showImportOverlay(options) {
    const opts = options || {};
    if (document.getElementById(IMPORT_OVERLAY_ID)) return;

    if (!removeGlobalDragGuards) {
      removeGlobalDragGuards = installGlobalDragGuards();
    }

    const overlay = document.createElement("div");
    overlay.id = IMPORT_OVERLAY_ID;
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "rgba(7, 12, 20, 0.78)";
    overlay.style.backdropFilter = "blur(1px)";
    overlay.style.zIndex = "10000";

    const card = document.createElement("div");
    card.style.width = "min(700px, 94vw)";
    card.style.padding = "22px";
    card.style.borderRadius = "14px";
    card.style.border = "1px solid rgba(129, 194, 255, 0.35)";
    card.style.background = "rgba(16, 24, 38, 0.95)";
    card.style.boxShadow = "0 24px 60px rgba(0, 0, 0, 0.45)";

    const title = document.createElement("h2");
    title.textContent = "Import battle data";
    title.style.margin = "0 0 8px";
    title.style.fontSize = "20px";
    title.style.color = "#e8f1ff";

    const subtitle = document.createElement("p");
    subtitle.textContent = "Drop your JSON file here, or choose it manually.";
    subtitle.style.margin = "0 0 14px";
    subtitle.style.fontSize = "14px";
    subtitle.style.color = "#9fb0ca";

    const statusNode = document.createElement("div");
    statusNode.style.marginTop = "14px";
    statusNode.style.minHeight = "20px";
    statusNode.style.fontSize = "13px";
    statusNode.style.color = "#8a97ad";

    const guidanceSection = document.createElement("div");
    guidanceSection.style.border = "1px solid rgba(129, 194, 255, 0.25)";
    guidanceSection.style.borderRadius = "10px";
    guidanceSection.style.padding = "12px";
    guidanceSection.style.marginBottom = "14px";
    guidanceSection.style.background = "rgba(11, 20, 35, 0.7)";

    const guidanceTitle = document.createElement("h3");
    guidanceTitle.textContent = "Generate a battle report";
    guidanceTitle.style.margin = "0 0 8px";
    guidanceTitle.style.fontSize = "15px";
    guidanceTitle.style.fontWeight = "700";
    guidanceTitle.style.color = "#dcecff";

    const repoLinkWrap = document.createElement("div");
    repoLinkWrap.style.marginBottom = "8px";

    const repoLink = document.createElement("a");
    repoLink.href = CNC_REPO_URL;
    repoLink.target = "_blank";
    repoLink.rel = "noopener noreferrer";
    repoLink.textContent = CNC_REPO_URL;
    repoLink.style.fontSize = "12px";
    repoLink.style.color = "#8fc7ff";
    repoLink.style.wordBreak = "break-all";

    repoLinkWrap.appendChild(repoLink);

    const warning = document.createElement("p");
    warning.textContent =
      "This command runs on your active directory (current folder '.') and generates importable battle data. Generated data contains no code artifacts or file contents—only commit dates, change counts, git blame ownership summaries, and contributor names. Please review the script before running. For further instructions, including multi-repo usage, check the README for more examples.";
    warning.style.margin = "0 0 10px";
    warning.style.fontSize = "12px";
    warning.style.lineHeight = "1.45";
    warning.style.color = "#a9bedc";

    const commandRow = document.createElement("div");
    commandRow.style.display = "flex";
    commandRow.style.gap = "8px";
    commandRow.style.alignItems = "center";

    const commandInput = document.createElement("input");
    commandInput.type = "text";
    commandInput.readOnly = true;
    commandInput.value = GENERATE_SCRIPT_COMMAND;
    commandInput.style.flex = "1";
    commandInput.style.minWidth = "0";
    commandInput.style.border = "1px solid rgba(129, 194, 255, 0.35)";
    commandInput.style.background = "rgba(5, 12, 22, 0.9)";
    commandInput.style.color = "#d7e6ff";
    commandInput.style.padding = "9px 10px";
    commandInput.style.borderRadius = "8px";
    commandInput.style.fontSize = "12px";
    commandInput.style.fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

    commandInput.addEventListener("focus", () => {
      commandInput.select();
    });
    commandInput.addEventListener("click", () => {
      commandInput.select();
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy";
    copyButton.style.border = "1px solid rgba(129, 194, 255, 0.55)";
    copyButton.style.background = "rgba(53, 101, 146, 0.35)";
    copyButton.style.color = "#e9f3ff";
    copyButton.style.fontSize = "13px";
    copyButton.style.padding = "9px 12px";
    copyButton.style.borderRadius = "8px";
    copyButton.style.cursor = "pointer";
    copyButton.style.whiteSpace = "nowrap";

    copyButton.addEventListener("click", async () => {
      await copyScriptCommand(commandInput, copyButton, statusNode);
    });

    commandRow.appendChild(commandInput);
    commandRow.appendChild(copyButton);

    guidanceSection.appendChild(guidanceTitle);
    guidanceSection.appendChild(repoLinkWrap);
    guidanceSection.appendChild(warning);
    guidanceSection.appendChild(commandRow);

    const dropZone = document.createElement("div");
    dropZone.style.border = "1px dashed rgba(129, 194, 255, 0.45)";
    dropZone.style.background = "rgba(65, 120, 170, 0.14)";
    dropZone.style.borderRadius = "12px";
    dropZone.style.padding = "22px";
    dropZone.style.textAlign = "center";
    dropZone.style.color = "#d9e7ff";
    dropZone.style.transition = "all 140ms ease";

    const dropText = document.createElement("div");
    dropText.textContent = "Drag and drop JSON file";
    dropText.style.fontSize = "15px";
    dropText.style.fontWeight = "600";
    dropText.style.marginBottom = "10px";

    const chooseButton = document.createElement("button");
    chooseButton.type = "button";
    chooseButton.textContent = "Choose file";
    chooseButton.style.border = "1px solid rgba(129, 194, 255, 0.55)";
    chooseButton.style.background = "rgba(53, 101, 146, 0.35)";
    chooseButton.style.color = "#e9f3ff";
    chooseButton.style.fontSize = "14px";
    chooseButton.style.padding = "9px 14px";
    chooseButton.style.borderRadius = "8px";
    chooseButton.style.cursor = "pointer";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";

    chooseButton.addEventListener("click", () => {
      input.click();
    });

    input.addEventListener("change", async () => {
      const file = input.files && input.files[0] ? input.files[0] : null;
      await processFile(file, opts, statusNode);
      input.value = "";
    });

    const unbindDropTarget = bindDropTarget(dropZone, opts, statusNode);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && opts.allowDismiss) {
        hideImportOverlay();
      }
    });

    dropZone.appendChild(dropText);
    dropZone.appendChild(chooseButton);
    dropZone.appendChild(input);

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(guidanceSection);
    card.appendChild(dropZone);
    card.appendChild(statusNode);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const originalHide = hideImportOverlay;
    hideImportOverlay = function patchedHideImportOverlay() {
      unbindDropTarget();
      hideImportOverlay = originalHide;
      originalHide();
    };
  }

  window.hideImportOverlay = hideImportOverlay;
  window.showImportOverlay = showImportOverlay;
  window.ImportUI = {
    hideImportOverlay,
    showImportOverlay,
  };
})();
