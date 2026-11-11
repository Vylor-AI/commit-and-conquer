(function () {
  const IMPORTED_HISTORY_STORAGE_KEY = "commit_and_conquer.imported_history.v1";
  const IMPORTED_HISTORY_CACHE_SOFT_LIMIT = 4_500_000;

  function readRaw() {
    try {
      return localStorage.getItem(IMPORTED_HISTORY_STORAGE_KEY) || "";
    } catch (_error) {
      return "";
    }
  }

  function writeRaw(rawJsonText) {
    try {
      if (typeof rawJsonText !== "string") return false;
      localStorage.setItem(IMPORTED_HISTORY_STORAGE_KEY, rawJsonText);
      return true;
    } catch (error) {
      console.warn("Could not cache imported history:", error);
      return false;
    }
  }

  function persistImportedHistory(rawJsonText) {
    if (typeof rawJsonText === "string" && rawJsonText.length > IMPORTED_HISTORY_CACHE_SOFT_LIMIT) {
      console.warn(
        `Imported history is large (${rawJsonText.length.toLocaleString()} chars). ` +
          "Caching may fail on browsers with lower localStorage limits."
      );
    }
    return writeRaw(rawJsonText);
  }

  function loadNormalizedHistory() {
    const raw = readRaw();
    if (!raw) return [];

    if (!window.HistoryNormalizer) return [];

    const parsed = window.HistoryNormalizer.safeParseJson(raw);
    if (!parsed) return [];

    const normalized = window.HistoryNormalizer.normalizeImportedHistory(parsed);
    return normalized.history;
  }

  window.HistoryStorage = {
    readRaw,
    writeRaw,
    persistImportedHistory,
    loadNormalizedHistory,
  };
})();
