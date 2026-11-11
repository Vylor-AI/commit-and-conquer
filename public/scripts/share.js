(function () {
  const SHARE_BUTTON_ID = "cc-share-btn";
  const SHARE_MODAL_ID = "cc-share-modal";
  const SHARE_STATUS_ID = "cc-share-status";
  const SHARE_HASH_PATTERN = /^#\/(?:s|share)\/([A-Za-z0-9_-]{10,80})$/;

  let floatingShareButton = null;

  function apiBaseUrl() {
    if (
      typeof window.CNC_API_BASE_URL === "string" &&
      window.CNC_API_BASE_URL.trim()
    ) {
      return window.CNC_API_BASE_URL.trim();
    }

    const host = window.location.hostname.toLowerCase();

    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:3001";
    }

    if (host === "staging.gitconquer.com") {
      return "https://api-staging.vylor.ai";
    }

    return "https://api.vylor.ai";
  }

  function buildApiUrl(path) {
    const base = apiBaseUrl();
    if (!base) return path;
    return `${base}${path}`;
  }

  function parseShareIdFromHash(hash) {
    if (typeof hash !== "string" || hash.length === 0) return null;
    const trimmed = hash.trim();
    const match = trimmed.match(SHARE_HASH_PATTERN);
    if (!match) return null;
    return match[1];
  }

  function currentShareId() {
    return parseShareIdFromHash(window.location.hash || "");
  }

  function clearShareHashFromLocation() {
    if (!currentShareId()) return;
    if (window.history && typeof window.history.replaceState === "function") {
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState({}, "", cleanUrl);
      return;
    }
    window.location.hash = "";
  }

  function normalizeSharedHistoryResponse(raw) {
    if (Array.isArray(raw)) return raw;

    if (raw && Object.prototype.hasOwnProperty.call(raw, "payload")) {
      const payload = raw.payload;
      if (Array.isArray(payload)) return payload;
      if (payload && Array.isArray(payload.history)) return payload.history;
      return [];
    }

    if (raw && Array.isArray(raw.history)) {
      return raw.history;
    }

    return [];
  }

  async function loadSharedHistoryFromLocation() {
    const shareId = currentShareId();
    if (!shareId) {
      return { hasShareId: false, history: [] };
    }

    const url = buildApiUrl(`/public/commit-and-conquer/shares/${shareId}`);
    let response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch (error) {
      return {
        hasShareId: true,
        notFound: false,
        history: [],
        error: error instanceof Error ? error.message : "Network error.",
      };
    }

    if (response.status === 404) {
      return { hasShareId: true, notFound: true, history: [] };
    }

    if (!response.ok) {
      return { hasShareId: true, notFound: false, history: [] };
    }

    let data = null;
    try {
      data = await response.json();
    } catch (_error) {
      return { hasShareId: true, notFound: false, history: [] };
    }

    const result = {
      hasShareId: true,
      notFound: false,
      history: normalizeSharedHistoryResponse(data),
    };

    if (
      result.history.length > 0 &&
      window.CNCAnalytics &&
      typeof window.CNCAnalytics.track === "function"
    ) {
      window.CNCAnalytics.track("share_link_loaded", {
        share_id: shareId,
        commit_count: result.history.length,
      });
    }

    return result;
  }

  function cloneActiveHistory() {
    if (typeof window.getActiveHistory !== "function") return [];
    const active = window.getActiveHistory();
    if (!Array.isArray(active)) return [];

    try {
      return JSON.parse(JSON.stringify(active));
    } catch (_error) {
      return [];
    }
  }

  function sharePathFromId(shareId) {
    return `${window.location.origin}${window.location.pathname}#/s/${shareId}`;
  }

  function setStatus(text, kind) {
    const statusNode = document.getElementById(SHARE_STATUS_ID);
    if (!statusNode) return;

    statusNode.textContent = text || "";
    statusNode.style.color = kind === "error" ? "#ff9ba6" : "#8a97ad";
  }

  async function createShare() {
    const history = cloneActiveHistory();
    if (history.length === 0) {
      setStatus(
        "No battle data found. Import or load a battle first.",
        "error"
      );
      return null;
    }

    const url = buildApiUrl("/public/commit-and-conquer/shares");
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(history),
      });
    } catch (_error) {
      setStatus(
        "Network error while generating link. Please try again.",
        "error"
      );
      return null;
    }

    let data = null;
    try {
      data = await response.json();
    } catch (_error) {
      setStatus("Invalid response from share endpoint.", "error");
      return null;
    }

    if (!response.ok) {
      error =
        data.error || `Error while geenrating the link: ${response.statusText}`;
      setStatus(error, "error");
      return null;
    }

    const link =
      data && typeof data.url === "string" && data.url
        ? data.url
        : data && typeof data.id === "string" && data.id
          ? sharePathFromId(data.id)
          : "";

    if (!link) {
      setStatus("Share response is missing URL information.", "error");
      return null;
    }

    valid_for_days = data.valid_for_days;

    setStatus(
      `Share link generated successfully. Valid for ${valid_for_days} days.`,
      "info"
    );
    return link;
  }

  function removeShareModal() {
    const existing = document.getElementById(SHARE_MODAL_ID);
    if (existing) existing.remove();
  }

  function buildShareModal() {
    removeShareModal();

    if (window.CNCAnalytics && typeof window.CNCAnalytics.track === "function") {
      window.CNCAnalytics.track("share_triggered");
    }

    const overlay = document.createElement("div");
    overlay.id = SHARE_MODAL_ID;
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "rgba(7, 12, 20, 0.78)";
    overlay.style.backdropFilter = "blur(1px)";
    overlay.style.zIndex = "10100";

    const card = document.createElement("div");
    card.style.width = "min(680px, 94vw)";
    card.style.padding = "24px";
    card.style.borderRadius = "14px";
    card.style.border = "1px solid rgba(129, 194, 255, 0.35)";
    card.style.background = "rgba(16, 24, 38, 0.96)";
    card.style.boxShadow = "0 24px 60px rgba(0, 0, 0, 0.45)";

    const title = document.createElement("h2");
    title.textContent = "Share Battle";
    title.style.margin = "0 0 10px";
    title.style.fontSize = "20px";
    title.style.color = "#e8f1ff";

    const warning = document.createElement("div");
    warning.style.whiteSpace = "pre-line";
    warning.style.color = "#d9e7ff";
    warning.style.fontSize = "14px";
    warning.style.lineHeight = "1.45";
    warning.style.marginBottom = "16px";
    warning.textContent =
      "⚠️ By sharing, you confirm that you have the right to publish this high-level commit timeline. " +
      "The shared file only contains commit dates, line counts, and name labels,no actual source code is ever sent or stored.\n\n" +
      "If needed, you can adjust the names in Settings before you create the link.";

    const buttonBar = document.createElement("div");
    buttonBar.style.display = "flex";
    buttonBar.style.gap = "8px";
    buttonBar.style.flexWrap = "wrap";
    buttonBar.style.marginBottom = "12px";

    const generateButton = document.createElement("button");
    generateButton.type = "button";
    generateButton.textContent = "Generate Shareable Link";
    generateButton.style.border = "1px solid rgba(129, 194, 255, 0.6)";
    generateButton.style.background = "rgba(53, 101, 146, 0.45)";
    generateButton.style.color = "#e8f1ff";
    generateButton.style.fontSize = "13px";
    generateButton.style.padding = "9px 12px";
    generateButton.style.borderRadius = "7px";
    generateButton.style.cursor = "pointer";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";
    closeButton.style.border = "1px solid rgba(129, 194, 255, 0.35)";
    closeButton.style.background = "rgba(38, 55, 80, 0.25)";
    closeButton.style.color = "#d7e6ff";
    closeButton.style.fontSize = "13px";
    closeButton.style.padding = "9px 12px";
    closeButton.style.borderRadius = "7px";
    closeButton.style.cursor = "pointer";

    const linkWrap = document.createElement("div");
    linkWrap.style.display = "none";
    linkWrap.style.marginTop = "4px";

    const linkInput = document.createElement("input");
    linkInput.type = "text";
    linkInput.readOnly = true;
    linkInput.style.width = "100%";
    linkInput.style.boxSizing = "border-box";
    linkInput.style.border = "1px solid rgba(129, 194, 255, 0.28)";
    linkInput.style.background = "rgba(8, 16, 28, 0.62)";
    linkInput.style.color = "#e8f1ff";
    linkInput.style.padding = "8px 9px";
    linkInput.style.borderRadius = "6px";
    linkInput.style.fontSize = "12px";
    linkInput.style.marginBottom = "8px";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy Link";
    copyButton.style.border = "1px solid rgba(129, 194, 255, 0.55)";
    copyButton.style.background = "rgba(53, 101, 146, 0.35)";
    copyButton.style.color = "#e9f3ff";
    copyButton.style.fontSize = "13px";
    copyButton.style.padding = "8px 12px";
    copyButton.style.borderRadius = "7px";
    copyButton.style.cursor = "pointer";

    const status = document.createElement("div");
    status.id = SHARE_STATUS_ID;
    status.style.marginTop = "12px";
    status.style.minHeight = "20px";
    status.style.fontSize = "13px";
    status.style.color = "#8a97ad";

    copyButton.addEventListener("click", async () => {
      if (!linkInput.value) return;
      try {
        await navigator.clipboard.writeText(linkInput.value);
        setStatus("Link copied to clipboard.", "info");
      } catch (_error) {
        linkInput.select();
        document.execCommand("copy");
        setStatus("Link copied.", "info");
      }
    });

    generateButton.addEventListener("click", async () => {
      generateButton.disabled = true;
      generateButton.style.opacity = "0.75";
      setStatus("Generating share link...", "info");

      const link = await createShare();
      generateButton.disabled = false;
      generateButton.style.opacity = "1";

      if (!link) return;

      linkWrap.style.display = "block";
      linkInput.value = link;
      linkInput.focus();
      linkInput.select();
    });

    closeButton.addEventListener("click", () => {
      removeShareModal();
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        removeShareModal();
      }
    });

    buttonBar.appendChild(generateButton);
    buttonBar.appendChild(closeButton);

    linkWrap.appendChild(linkInput);
    linkWrap.appendChild(copyButton);

    card.appendChild(title);
    card.appendChild(warning);
    card.appendChild(buttonBar);
    card.appendChild(linkWrap);
    card.appendChild(status);
    overlay.appendChild(card);

    document.body.appendChild(overlay);
  }

  function ensureShareButton() {
    let button = document.getElementById(SHARE_BUTTON_ID);
    if (button) return button;

    button = document.createElement("button");
    button.id = SHARE_BUTTON_ID;
    button.type = "button";
    button.textContent = "🔗";
    button.title = "Share battle";
    button.setAttribute("aria-label", "Share battle");
    button.style.position = "fixed";
    button.style.width = "42px";
    button.style.height = "42px";
    button.style.borderRadius = "50%";
    button.style.border = "1px solid rgba(129, 194, 255, 0.55)";
    button.style.background = "rgba(53, 101, 146, 0.42)";
    button.style.color = "#e8f1ff";
    button.style.fontSize = "18px";
    button.style.cursor = "pointer";
    button.style.zIndex = "20";
    button.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.35)";

    button.addEventListener("click", () => {
      buildShareModal();
    });

    document.body.appendChild(button);
    return button;
  }

  function positionShareButtonLeftOfSettings() {
    if (!floatingShareButton) return;
    const settingsButton = document.getElementById("settings-btn");
    if (!settingsButton) {
      floatingShareButton.style.right = "74px";
      floatingShareButton.style.bottom = "14px";
      return;
    }

    const rect = settingsButton.getBoundingClientRect();
    const top = Math.max(10, rect.top);
    const left = Math.max(10, rect.left - 52);

    floatingShareButton.style.top = `${top}px`;
    floatingShareButton.style.left = `${left}px`;
  }

  function initializeShareButton() {
    floatingShareButton = ensureShareButton();
    positionShareButtonLeftOfSettings();
    window.addEventListener("resize", positionShareButtonLeftOfSettings);
    window.addEventListener("scroll", positionShareButtonLeftOfSettings, true);
  }

  function notifyShareLoadFailure(message) {
    const existing = document.getElementById("cc-share-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "cc-share-toast";
    toast.textContent = message;
    toast.style.position = "fixed";
    toast.style.left = "14px";
    toast.style.bottom = "14px";
    toast.style.maxWidth = "min(520px, calc(100vw - 28px))";
    toast.style.padding = "11px 14px";
    toast.style.background = "rgba(39, 16, 24, 0.92)";
    toast.style.border = "1px solid rgba(255, 118, 133, 0.5)";
    toast.style.borderRadius = "8px";
    toast.style.color = "#ffd6db";
    toast.style.fontSize = "13px";
    toast.style.zIndex = "10120";
    toast.style.boxShadow = "0 12px 26px rgba(0, 0, 0, 0.45)";

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 4200);
  }

  window.CNCShare = {
    initializeShareButton,
    loadSharedHistoryFromLocation,
    clearShareHashFromLocation,
    notifyShareLoadFailure,
  };
})();
