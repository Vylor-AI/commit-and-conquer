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

  function decodeCompactV2(payload) {
    const errors = [];
    const authors = Array.isArray(payload.authors) ? payload.authors : [];
    const names = authors.map((a, idx) =>
      a && typeof a.n === "string" && a.n ? a.n : `Player ${idx + 1}`
    );
    const rawSteps = Array.isArray(payload.steps) ? payload.steps : null;

    if (!rawSteps) {
      return {
        history: [],
        errors: ["Invalid v2 payload: missing 'steps' array."],
      };
    }

    const repoName =
      typeof payload.label === "string" && payload.label
        ? payload.label
        : typeof payload.repo === "string" && payload.repo
          ? payload.repo
          : window.CNC_DEFAULT_REPO || "default";

    const running = {};
    const history = [];

    rawSteps.forEach((row, idx) => {
      if (!Array.isArray(row) || row.length < 5) {
        errors.push(`Step #${idx + 1}: malformed row.`);
        return;
      }

      const [ts, authorIdx, added, removed, changed] = row;
      const date = new Date(Number(ts) * 1000);
      if (Number.isNaN(date.getTime())) {
        errors.push(`Step #${idx + 1}: invalid timestamp.`);
        return;
      }

      if (Array.isArray(changed)) {
        changed.forEach((pair) => {
          if (!Array.isArray(pair)) return;
          const name = names[pair[0]];
          if (!name) return;
          running[name] = Math.max(0, Number(pair[1]) || 0);
        });
      }

      history.push({
        date: date.toISOString(),
        committer: names[authorIdx] || "",
        repo: repoName,
        changes: {
          added: Number(added) || 0,
          removed: Number(removed) || 0,
        },
        repoScores: { [repoName]: Object.assign({}, running) },
      });
    });

    return {
      history,
      errors,
      meta: {
        generatedAt: payload.generatedAt || null,
        repositories: [repoName],
        source: payload.repo || null,
        sha: payload.sha || null,
        stats: payload.stats || null,
      },
    };
  }

  function normalizeImportedHistory(rawPayload) {
    if (rawPayload && !Array.isArray(rawPayload) && rawPayload.v === 2) {
      return decodeCompactV2(rawPayload);
    }

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
        repo:
          typeof step.repo === "string" && step.repo
            ? step.repo
            : window.CNC_DEFAULT_REPO || "default",
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
    decodeCompactV2,
  };
})();
