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
      repo:
        step && step.repo
          ? step.repo
          : window.CNC_DEFAULT_REPO || "default",
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

  async function tryLoadDemoFromLocation() {
    const showcase = window.CNCShowcase;
    const ref = showcase && showcase.currentDemoRef();
    if (!ref) return { hasDemoRef: false, history: [] };

    try {
      const entry = await showcase.findEntry(ref);
      if (!entry) return { hasDemoRef: true, notFound: true, history: [] };

      const { history } = await showcase.loadDemoHistory(entry);
      return { hasDemoRef: true, entry, history };
    } catch (error) {
      console.warn("Showcase deep link failed.", error);
      return { hasDemoRef: true, failed: true, history: [] };
    }
  }

  function clearLocationHashesForFileImport() {
    if (
      window.CNCShare &&
      typeof window.CNCShare.clearShareHashFromLocation === "function"
    ) {
      window.CNCShare.clearShareHashFromLocation();
    }
    if (window.CNCShowcase) {
      if (typeof window.CNCShowcase.clearDemoHashFromLocation === "function") {
        window.CNCShowcase.clearDemoHashFromLocation();
      }
      if (typeof window.CNCShowcase.setActiveDemo === "function") {
        window.CNCShowcase.setActiveDemo(null);
      }
    }
  }

  function showImportPrompt(options) {
    const promptOpts = options || {};
    if (!promptOpts.keepCurrentState) {
      sourceHistoryTimeline = [];
      resetToEmptyState();
    }

    if (window.ImportUI) {
      window.ImportUI.showImportOverlay({
        allowDismiss: true,
        onHistoryImported: (history, source) => {
          const resolvedSource = source || "file_import";
          applyResolvedHistory(history, resolvedSource);
          if (resolvedSource === "file_import") {
            clearLocationHashesForFileImport();
          }
        },
      });
    }
  }

  async function initializeHistoryFlow() {
    if (
      window.CNCShowcase &&
      typeof window.CNCShowcase.initializeRepoSwitcher === "function"
    ) {
      window.CNCShowcase.initializeRepoSwitcher(() => {
        showImportPrompt({ keepCurrentState: true });
      });
    }

    const shared = await tryLoadSharedHistoryFromLocation();
    if (Array.isArray(shared.history) && shared.history.length > 0) {
      applyResolvedHistory(shared.history, "shared_link");
      return;
    }

    const demo = await tryLoadDemoFromLocation();
    if (demo.history.length > 0) {
      if (
        window.CNCShowcase &&
        typeof window.CNCShowcase.setActiveDemo === "function"
      ) {
        window.CNCShowcase.setActiveDemo(demo.entry);
      }
      applyResolvedHistory(
        demo.history,
        `showcase:${demo.entry.owner}/${demo.entry.name}`
      );
      return;
    }

    if (demo.hasDemoRef) {
      if (
        window.CNCShare &&
        typeof window.CNCShare.notifyShareLoadFailure === "function"
      ) {
        window.CNCShare.notifyShareLoadFailure(
          demo.notFound
            ? "That repository isn't in the showcase. Pick one below or import your own data."
            : "Could not load that repository. Please try again or import your own data."
        );
      }
      showImportPrompt();
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

  window.addEventListener("hashchange", () => {
    const demoRef =
      window.CNCShowcase &&
      typeof window.CNCShowcase.currentDemoRef === "function"
        ? window.CNCShowcase.currentDemoRef()
        : null;
    if (demoRef) {
      initializeHistoryFlow();
    }
  });

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
