(function () {
  const DEMO_HASH_PATTERN = /^#\/r\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/;

  let indexPromise = null;
  let activeDemo = null;
  let onOpenGallery = null;

  function baseUrl() {
    const configured =
      typeof window.CNC_DEMOS_BASE_URL === "string"
        ? window.CNC_DEMOS_BASE_URL.trim()
        : "";
    const base = configured || "demos/";
    return base.endsWith("/") ? base : `${base}/`;
  }

  function parseDemoFromHash(hash) {
    if (typeof hash !== "string" || !hash) return null;
    const match = hash.trim().match(DEMO_HASH_PATTERN);
    if (!match) return null;
    return { owner: match[1], name: match[2] };
  }

  function currentDemoRef() {
    return parseDemoFromHash(window.location.hash || "");
  }

  function demoHash(entry) {
    return `#/r/${entry.owner}/${entry.name}`;
  }

  function setDemoHash(entry) {
    setActiveDemo(entry);
    const url = `${window.location.pathname}${window.location.search}${demoHash(entry)}`;
    if (window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState({}, "", url);
    } else {
      window.location.hash = demoHash(entry);
    }
  }

  function clearDemoHashFromLocation() {
    if (!currentDemoRef()) return;
    if (window.history && typeof window.history.replaceState === "function") {
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState({}, "", cleanUrl);
      return;
    }
    window.location.hash = "";
  }

  function updateReposButton() {
    const btn = document.getElementById("repos-btn");
    if (!btn) return;
    if (activeDemo && activeDemo.owner && activeDemo.name) {
      btn.textContent = `${activeDemo.owner}/${activeDemo.name} \u25be`;
      btn.title = "Switch repository";
    } else {
      btn.textContent = "Famous Repos \u25be";
      btn.title = "Browse famous repositories";
    }
  }

  function setActiveDemo(entry) {
    activeDemo = entry && entry.owner && entry.name ? entry : null;
    updateReposButton();
  }

  function initializeRepoSwitcher(openGalleryHandler) {
    if (typeof openGalleryHandler === "function") {
      onOpenGallery = openGalleryHandler;
    }

    const btn = document.getElementById("repos-btn");
    if (!btn) return;

    if (!btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        if (typeof onOpenGallery === "function") {
          onOpenGallery();
        }
      });
    }

    updateReposButton();
    loadIndex()
      .then(() => {
        btn.classList.remove("hidden");
      })
      .catch(() => {
        btn.classList.add("hidden");
      });
  }

  async function fetchJsonWithProgress(url, expectedBytes, onProgress) {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    // Fall back to a plain read when streaming isn't available.
    if (!response.body || typeof response.body.getReader !== "function") {
      return response.json();
    }

    const headerLength = Number(response.headers.get("content-length")) || 0;
    const total = expectedBytes || headerLength || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (typeof onProgress === "function" && total > 0) {
        onProgress(Math.min(0.99, received / total));
      }
    }

    const text = new TextDecoder("utf-8").decode(
      chunks.length === 1 ? chunks[0] : concatChunks(chunks, received)
    );
    return JSON.parse(text);
  }

  function concatChunks(chunks, totalLength) {
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    chunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.length;
    });
    return merged;
  }

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetchJsonWithProgress(`${baseUrl()}index.json`, 0).then(
        (index) => {
          const repos =
            index && Array.isArray(index.repos)
              ? index.repos.filter(
                  (r) => r && r.owner && r.name && typeof r.file === "string"
                )
              : [];
          if (repos.length === 0) throw new Error("Showcase is empty.");
          return { generatedAt: index.generatedAt || null, repos };
        }
      );
      // Allow a retry after a failure instead of caching the rejection.
      indexPromise.catch(() => {
        indexPromise = null;
      });
    }
    return indexPromise;
  }

  async function findEntry(ref) {
    const index = await loadIndex();
    const owner = String(ref.owner).toLowerCase();
    const name = String(ref.name).toLowerCase();
    return (
      index.repos.find(
        (r) =>
          String(r.owner).toLowerCase() === owner &&
          String(r.name).toLowerCase() === name
      ) || null
    );
  }

  async function loadDemoHistory(entry, onProgress) {
    if (!window.HistoryNormalizer) {
      throw new Error("History normalizer is not available.");
    }

    // Only files listed in the manifest are ever fetched.
    const raw = await fetchJsonWithProgress(
      `${baseUrl()}${encodeURIComponent(entry.file)}`,
      entry.rawBytes || 0,
      onProgress
    );

    const normalized = window.HistoryNormalizer.normalizeImportedHistory(raw);
    if (!normalized.history || normalized.history.length === 0) {
      throw new Error(
        (normalized.errors && normalized.errors[0]) || "No data in this demo."
      );
    }
    if (typeof onProgress === "function") onProgress(1);
    return { history: normalized.history, meta: normalized.meta || null };
  }

  function formatCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
  }

  function yearOf(dateString) {
    const d = new Date(dateString);
    return Number.isNaN(d.getTime()) ? "" : String(d.getUTCFullYear());
  }

  window.CNCShowcase = {
    baseUrl,
    parseDemoFromHash,
    currentDemoRef,
    demoHash,
    setDemoHash,
    clearDemoHashFromLocation,
    setActiveDemo,
    initializeRepoSwitcher,
    loadIndex,
    findEntry,
    loadDemoHistory,
    formatCount,
    yearOf,
  };
})();
