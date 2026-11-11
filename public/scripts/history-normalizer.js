(function () {
  function safeParseJson(text) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  function normalizeRepoScores(repoScoresRaw) {
    if (!repoScoresRaw || typeof repoScoresRaw !== "object") return {};

    const normalized = {};
    Object.entries(repoScoresRaw).forEach(([repoName, playerScores]) => {
      if (!repoName || !playerScores || typeof playerScores !== "object")
        return;

      const cleaned = {};
      Object.entries(playerScores).forEach(([playerName, loc]) => {
        if (!playerName) return;
        const numericLoc = Number(loc);
        if (!Number.isFinite(numericLoc)) return;
        cleaned[playerName] = Math.max(0, numericLoc);
      });

      normalized[repoName] = cleaned;
    });

    return normalized;
  }

  function normalizeImportedHistory(rawPayload) {
    if (!rawPayload) {
      return {
        history: [],
        errors: ["No data parsed"],
      };
    }
    let timeline;

    if (Array.isArray(rawPayload)) {
      timeline = rawPayload;
    } else if (
      typeof rawPayload === "object" &&
      Array.isArray(rawPayload.timeline)
    ) {
      timeline = rawPayload.timeline;
    }

    if (!timeline) {
      return {
        history: [],
        errors: [
          "Invalid payload structure. Expected an object containing a 'timeline' array.",
        ],
      };
    }

    const errors = [];
    const normalized = [];

    timeline.forEach((step, idx) => {
      if (!step || typeof step !== "object") {
        errors.push(`Entry #${idx + 1}: must be an object.`);
        return { errors };
      }

      const date = typeof step.date === "string" ? step.date : "";
      const parsedDate = new Date(date);
      if (!date || Number.isNaN(parsedDate.getTime())) {
        errors.push(`Entry #${idx + 1}: invalid or missing date.`);
        return {
          history: [],
          errors,
        };
      }

      if (!step.repoScores || typeof step.repoScores !== "object") {
        errors.push(`Entry #${idx + 1}: missing repoScores object.`);
        return {
          history: [],
          errors,
        };
      }

      normalized.push({
        date,
        committer: typeof step.committer === "string" ? step.committer : "",
        repo: typeof step.repo === "string" && step.repo ? step.repo : "vylor",
        changes:
          step.changes && typeof step.changes === "object" ? step.changes : {},
        repoScores: normalizeRepoScores(step.repoScores),
      });
    });

    normalized.sort((a, b) => new Date(a.date) - new Date(b.date));

    return {
      history: normalized,
      errors,
      meta: {
        generatedAt: rawPayload.generatedAt || null,
        repositories: rawPayload.repositories || [],
      },
    };
  }

  window.HistoryNormalizer = {
    safeParseJson,
    normalizeRepoScores,
    normalizeImportedHistory,
  };
})();
