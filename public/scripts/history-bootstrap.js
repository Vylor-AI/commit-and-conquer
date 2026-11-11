(function () {
  let sourceHistoryTimeline = [];

  function cloneRepoScores(repoScores) {
    const cloned = {};
    Object.entries(repoScores || {}).forEach(([repoName, playerScores]) => {
      if (!repoName || !playerScores || typeof playerScores !== "object") {
        return;
      }

      cloned[repoName] = {};
      Object.entries(playerScores).forEach(([name, loc]) => {
        cloned[repoName][name] = loc;
      });
    });
    return cloned;
  }

  function cloneHistory(history) {
    if (!Array.isArray(history)) return [];
    return history.map((step) => ({
      date: step && step.date ? step.date : "",
      committer: step && step.committer ? step.committer : "",
      repo: step && step.repo ? step.repo : "vylor",
      changes:
        step && step.changes && typeof step.changes === "object"
          ? step.changes
          : {},
      repoScores: cloneRepoScores((step && step.repoScores) || {}),
    }));
  }

  function resetToEmptyState() {
    historyTimeline = [];
    monthlyContributionModel = null;
    quarterlyContributionModel = null;
    monthlyRepoScoresTimeline = [];
    gameEvents = [];
    afkByPlayer = {};
    slider.max = 0;
    updateControlsUI();
  }

  function loadBundledHistoryIfEnabledRefactored() {
    if (typeof window === "undefined") return [];
    if (window.__CC_ALLOW_BUNDLED_HISTORY__ !== true) return [];
    if (typeof commitHistory === "undefined") return [];
    if (!Array.isArray(commitHistory) || commitHistory.length === 0) return [];
    if (!window.HistoryNormalizer) return [];

    const normalized = window.HistoryNormalizer.normalizeImportedHistory(commitHistory);
    return normalized.history;
  }

  function resolveMergedHistory(history) {
    if (
      window.ProfileConfig &&
      typeof window.ProfileConfig.applyMergesToHistory === "function"
    ) {
      return window.ProfileConfig.applyMergesToHistory(history);
    }
    return history;
  }

  function getUniquePlayersCount(history) {
    if (!Array.isArray(history)) return 0;
    const players = new Set();
    history.forEach((step) => {
      if (step && step.committer) players.add(step.committer);
    });
    return players.size;
  }

  function applyResolvedHistory(history, source) {
    sourceHistoryTimeline = cloneHistory(history);
    const mergedHistory = resolveMergedHistory(sourceHistoryTimeline);

    if (typeof applyHistoryTimeline === "function") {
      applyHistoryTimeline(mergedHistory);
    }

    if (
      window.ProfileConfig &&
      typeof window.ProfileConfig.applyOverridesFromHistory === "function"
    ) {
      window.ProfileConfig.applyOverridesFromHistory(mergedHistory);
    }

    if (window.CNCAnalytics && typeof window.CNCAnalytics.track === "function") {
      window.CNCAnalytics.track("data_imported", {
        commit_count: Array.isArray(history) ? history.length : 0,
        player_count: getUniquePlayersCount(history),
        source: source || "unknown",
      });
    }
  }

  async function tryLoadSharedHistoryFromLocation() {
    if (
      !window.CNCShare ||
      typeof window.CNCShare.loadSharedHistoryFromLocation !== "function"
    ) {
      return {
        hasShareId: false,
        history: [],
      };
    }

    try {
      return await window.CNCShare.loadSharedHistoryFromLocation();
    } catch (error) {
      console.warn("Shared history load failed.", error);
      return {
        hasShareId: false,
        history: [],
      };
    }
  }

  function showImportPrompt() {
    sourceHistoryTimeline = [];
    resetToEmptyState();

    if (window.ImportUI) {
      window.ImportUI.showImportOverlay({
        allowDismiss: true,
        onHistoryImported: (history) => {
          applyResolvedHistory(history, "file_import");

          if (
            window.CNCShare &&
            typeof window.CNCShare.clearShareHashFromLocation === "function"
          ) {
            window.CNCShare.clearShareHashFromLocation();
          }
        },
      });
    }
  }

  async function initializeHistoryFlow() {
    const shared = await tryLoadSharedHistoryFromLocation();
    if (Array.isArray(shared.history) && shared.history.length > 0) {
      applyResolvedHistory(shared.history, "shared_link");
      return;
    }

    let sourceHistory = [];
    let importSource = "cached_storage";

    if (window.HistoryStorage) {
      sourceHistory = window.HistoryStorage.loadNormalizedHistory();
    }

    if (sourceHistory.length === 0) {
      sourceHistory = loadBundledHistoryIfEnabledRefactored();
      importSource = "bundled";
    }

    if (sourceHistory.length === 0) {
      if (shared.hasShareId && shared.notFound) {
        if (
          window.CNCShare &&
          typeof window.CNCShare.notifyShareLoadFailure === "function"
        ) {
          window.CNCShare.notifyShareLoadFailure(
            "Shared battle not found. Import your own battle data to start."
          );
        }
      }

      showImportPrompt();
      return;
    }

    applyResolvedHistory(sourceHistory, importSource);
  }

  if (window.HistoryNormalizer) {
    window.safeParseJson = window.HistoryNormalizer.safeParseJson;
    window.normalizeRepoScores = window.HistoryNormalizer.normalizeRepoScores;
    window.normalizeImportedHistory = window.HistoryNormalizer.normalizeImportedHistory;
  }

  if (window.HistoryStorage) {
    window.persistImportedHistory = window.HistoryStorage.persistImportedHistory;
    window.loadCachedImportedHistory = window.HistoryStorage.loadNormalizedHistory;
  }

  if (window.ImportUI) {
    window.showImportOverlay = window.ImportUI.showImportOverlay;
    window.hideImportOverlay = window.ImportUI.hideImportOverlay;
  }

  window.loadBundledHistoryIfEnabled = loadBundledHistoryIfEnabledRefactored;
  window.initTimeline = initializeHistoryFlow;
  window.initializeHistoryFlow = initializeHistoryFlow;
  window.applyImportedHistory = applyResolvedHistory;
  window.getSourceHistory = function getSourceHistory() {
    return cloneHistory(sourceHistoryTimeline);
  };
  window.getActiveHistory = function getActiveHistory() {
    return Array.isArray(historyTimeline) ? historyTimeline : [];
  };
})();
