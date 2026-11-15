const IMPORTED_HISTORY_STORAGE_KEY = "commit_and_conquer.imported_history.v1";
const IMPORTED_HISTORY_CACHE_SOFT_LIMIT = 4_500_000;

const MAX_FLOATING_TEXTS = 40;
const MAX_PROJECTILES = 25;
const MAX_BLASTS = 15;
const MAX_STEPS_PER_TICK = 8;

const ImportedHistoryStore = {
  readRaw() {
    try {
      return localStorage.getItem(IMPORTED_HISTORY_STORAGE_KEY) || "";
    } catch (_error) {
      return "";
    }
  },

  writeRaw(rawJsonText) {
    try {
      if (typeof rawJsonText !== "string") return false;
      localStorage.setItem(IMPORTED_HISTORY_STORAGE_KEY, rawJsonText);
      return true;
    } catch (error) {
      console.warn("Could not cache imported history:", error);
      return false;
    }
  },

  loadNormalizedHistory() {
    const raw = this.readRaw();
    if (!raw) return [];

    const parsed = safeParseJson(raw);
    if (!parsed) return [];

    const normalized = normalizeImportedHistory(parsed);
    return normalized.history;
  },
};

function getContributionModelForMode(mode) {
  if (mode === "monthly" && monthlyContributionModel) {
    return {
      frameScoresTimeline: monthlyContributionModel.frameScoresTimeline || [],
      frameKeys: monthlyContributionModel.frameMonthKey || [],
      finalTotalsByKey: monthlyContributionModel.monthFinalTotalsByKey || {},
      growthByKey: monthlyContributionModel.monthGrowthByKey || {},
      labelByKey: monthlyContributionModel.monthLabelByKey || {},
      finalRepoScoresByKey:
        monthlyContributionModel.monthFinalRepoScoresByKey || {},
      orderedKeys: monthlyContributionModel.orderedKeys || null,
    };
  }

  if (mode === "quarterly" && quarterlyContributionModel) {
    return {
      frameScoresTimeline: quarterlyContributionModel.frameScoresTimeline || [],
      frameKeys: quarterlyContributionModel.frameQuarterKey || [],
      finalTotalsByKey:
        quarterlyContributionModel.quarterFinalTotalsByKey || {},
      growthByKey: quarterlyContributionModel.quarterGrowthByKey || {},
      labelByKey: quarterlyContributionModel.quarterLabelByKey || {},
      finalRepoScoresByKey:
        quarterlyContributionModel.quarterFinalRepoScoresByKey || {},
      orderedKeys: quarterlyContributionModel.orderedKeys || null,
    };
  }

  return null;
}

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
    if (!repoName || !playerScores || typeof playerScores !== "object") return;

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

function normalizeImportedHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) {
    return {
      history: [],
      errors: ["JSON root must be an array of commit snapshots."],
    };
  }

  const errors = [];
  const normalized = [];
  const defaultRepo = window.CNC_DEFAULT_REPO || "default";

  rawHistory.forEach((step, idx) => {
    if (!step || typeof step !== "object") {
      errors.push(`Entry #${idx + 1}: must be an object.`);
      return;
    }

    const date = typeof step.date === "string" ? step.date : "";
    const parsedDate = new Date(date);
    if (!date || Number.isNaN(parsedDate.getTime())) {
      errors.push(`Entry #${idx + 1}: invalid or missing date.`);
      return;
    }

    const hasRepoScores =
      step.repoScores && typeof step.repoScores === "object";

    let repoScores = {};
    if (hasRepoScores) {
      repoScores = normalizeRepoScores(step.repoScores);
    } else {
      errors.push(`Entry #${idx + 1}: missing repoScores/scores.`);
      return;
    }

    normalized.push({
      date,
      committer: typeof step.committer === "string" ? step.committer : "",
      repo:
        typeof step.repo === "string" && step.repo ? step.repo : defaultRepo,
      changes:
        step.changes && typeof step.changes === "object" ? step.changes : {},
      repoScores: repoScores,
    });
  });

  normalized.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { history: normalized, errors };
}

function persistImportedHistory(rawJsonText) {
  if (
    typeof rawJsonText === "string" &&
    rawJsonText.length > IMPORTED_HISTORY_CACHE_SOFT_LIMIT
  ) {
    console.warn(
      `Imported history is large (${rawJsonText.length.toLocaleString()} chars). ` +
        "Caching may fail on browsers with lower localStorage limits."
    );
  }
  return ImportedHistoryStore.writeRaw(rawJsonText);
}

function loadCachedImportedHistory() {
  return ImportedHistoryStore.loadNormalizedHistory();
}

function resetTransientSimulationState() {
  frameAccumulator = 0;
  roundPauseUntil = 0;
  roundBanner = null;
  screenShake = 0;
  liveProjectiles = [];
  impactBlasts = [];
  floatingTexts = [];
  playerRankY = {};
}

function applyHistoryTimeline(history) {
  historyTimeline = Array.isArray(history) ? history : [];

  if (typeof derivePlayerProfilesFromHistory === "function") {
    derivePlayerProfilesFromHistory(historyTimeline);
  }

  monthlyContributionModel = buildMonthlyContributionModel(historyTimeline);
  quarterlyContributionModel = buildQuarterlyContributionModel(historyTimeline);
  monthlyRepoScoresTimeline = monthlyContributionModel.frameScoresTimeline;

  currentFrameIndex = 0;
  slider.max = Math.max(0, historyTimeline.length - 1);

  ({ gameEvents, afkByPlayer } = buildEventsData(historyTimeline));

  resetTransientSimulationState();
  recomputeWorldView();
  updateControlsUI(true);
}

function getRepoScoresAtFrame(frameIdx) {
  if (frameIdx < 0 || frameIdx >= historyTimeline.length) return {};

  if (scoreMode !== "total") {
    const model = getContributionModelForMode(scoreMode);
    if (model) return model.frameScoresTimeline[frameIdx] || {};
  }

  const step = historyTimeline[frameIdx] || {};
  return step.repoScores || {};
}

function getPeriodKeyAtFrame(frameIdx, mode = scoreMode) {
  if (frameIdx < 0 || frameIdx >= historyTimeline.length) return "";
  const model = getContributionModelForMode(mode);
  if (!model) return "";
  return model.frameKeys[frameIdx] || "";
}

function getPeriodLabelForKey(key, mode = scoreMode) {
  if (!key) return "";
  const model = getContributionModelForMode(mode);
  if (!model) return key;
  return model.labelByKey[key] || key;
}

function buildRoundBanner(periodKey, mode = scoreMode) {
  const model = getContributionModelForMode(mode);
  if (!model || !periodKey) return null;

  const summary = model.finalTotalsByKey[periodKey] || { byPlayer: {} };
  const ranked = Object.entries(summary.byPlayer || {})
    .filter(([name, loc]) => name !== "Others" && name !== "CI" && loc > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const winners = ranked.map(([name, loc]) => ({ name, loc }));
  return {
    title: `🏁 ROUND COMPLETE · ${getPeriodLabelForKey(periodKey, mode)}`,
    subtitle:
      mode === "quarterly"
        ? "Quarter champions locked. New quarter begins..."
        : "Month champions locked. New month begins...",
    winners,
  };
}

function recomputeWorldView() {
  if (historyTimeline.length === 0) return;
  const finalScores = getRepoScoresAtFrame(historyTimeline.length - 1);
  precomputeLayout(finalScores);
  precomputeCamera(finalScores);
  centerOnFrame(currentFrameIndex);
}

function resizeCanvas() {
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  canvasDpr = Math.min(window.devicePixelRatio || 1, 2);
  SB_WIDTH = getSidebarWidth(viewWidth);
  document.documentElement.style.setProperty("--sb-width", `${SB_WIDTH}px`);

  canvas.width = Math.round(viewWidth * canvasDpr);
  canvas.height = Math.round(viewHeight * canvasDpr);
  ctx.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
}

function loadBundledHistoryIfEnabled() {
  if (typeof window === "undefined") return [];
  if (window.__CC_ALLOW_BUNDLED_HISTORY__ !== true) return [];
  if (typeof commitHistory === "undefined") return [];
  if (!Array.isArray(commitHistory) || commitHistory.length === 0) return [];

  const normalized = normalizeImportedHistory(commitHistory);
  return normalized.history;
}

function initTimeline() {
  let sourceHistory = loadCachedImportedHistory();

  if (sourceHistory.length === 0) {
    sourceHistory = loadBundledHistoryIfEnabled();
  }

  if (sourceHistory.length === 0) {
    historyTimeline = [];
    monthlyContributionModel = null;
    quarterlyContributionModel = null;
    monthlyRepoScoresTimeline = [];
    gameEvents = [];
    afkByPlayer = {};
    slider.max = 0;
    updateControlsUI(true);
    return;
  }

  applyHistoryTimeline(sourceHistory);
}

function spawnFloatingText(text, r, c, color, stack = 0, meta = null) {
  if (meta && meta.player && meta.kind) {
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const existing = floatingTexts[i];
      if (
        existing.player === meta.player &&
        existing.kind === meta.kind &&
        existing.life > 0.35
      ) {
        if (typeof meta.delta === "number") {
          existing.delta = (existing.delta || 0) + meta.delta;
          const rounded = Math.round(existing.delta);
          existing.text =
            meta.kind === "gain"
              ? `+${rounded}`
              : meta.kind === "loss"
                ? `-${rounded}`
                : `${rounded}`;
        } else {
          existing.text = text;
        }
        existing.r = r;
        existing.c = c;
        existing.color = color;
        existing.life = Math.min(1.0, Math.max(existing.life, 0.85));
        return;
      }
    }
  }

  if (floatingTexts.length >= MAX_FLOATING_TEXTS) {
    floatingTexts.shift();
  }

  floatingTexts.push({
    text,
    r,
    c,
    yOffset: -stack * 20,
    life: 1.0,
    color,
    player: meta ? meta.player : null,
    kind: meta ? meta.kind : null,
    delta: meta && typeof meta.delta === "number" ? meta.delta : 0,
  });
}

function spawnOrCoalesceProjectile(committer, victim, sr, sc, tr, tc, loss, tier, color) {
  for (let i = liveProjectiles.length - 1; i >= 0; i--) {
    const p = liveProjectiles[i];
    if (p.attacker === committer && p.victim === victim && p.pct < 0.35) {
      p.loss = (p.loss || 0) + loss;
      p.tier = damageTier(p.loss) || p.tier || tier;
      p.tr = tr;
      p.tc = tc;
      return;
    }
  }

  if (liveProjectiles.length >= MAX_PROJECTILES) {
    liveProjectiles.shift();
  }

  liveProjectiles.push({
    attacker: committer,
    victim,
    loss,
    sr,
    sc,
    tr,
    tc,
    pct: 0,
    tier,
    color,
  });
}

function processStepEvents(frameIdx) {
  if (frameIdx <= 0) return;

  let currentStep = historyTimeline[frameIdx];
  if (!currentStep) return;

  let committer = currentStep.committer;
  let defaultRepo = window.CNC_DEFAULT_REPO || "default";
  let targetRepo = currentStep.repo || defaultRepo;
  let prevRepo = getRepoScoresAtFrame(frameIdx - 1)[targetRepo] || {};
  let currRepo = getRepoScoresAtFrame(frameIdx)[targetRepo] || {};

  let names = new Set([...Object.keys(prevRepo), ...Object.keys(currRepo)]);
  let deltas = [];
  names.forEach((name) => {
    let d = (currRepo[name] || 0) - (prevRepo[name] || 0);
    if (Math.abs(d) >= 5) deltas.push({ name, d });
  });
  if (deltas.length === 0) return;

  let committerAnchor = centroidFor(lastCentroids, committer, targetRepo);

  deltas.forEach((entry) => {
    let anchor = centroidFor(lastCentroids, entry.name, targetRepo);
    if (!anchor) anchor = committerAnchor;
    if (!anchor) return;

    if (entry.d > 0) {
      spawnFloatingText(
        `+${Math.round(entry.d)}`,
        anchor.r,
        anchor.c,
        PLAYER_PROFILES[entry.name]?.color || "#37d67a",
        0,
        { player: entry.name, kind: "gain", delta: entry.d }
      );
    } else if (entry.name !== committer) {
      let loss = -entry.d;
      let tier = damageTier(loss);
      spawnFloatingText(
        `-${Math.round(loss)}`,
        anchor.r,
        anchor.c,
        tier ? tier.color : "#ff5c6c",
        0,
        { player: entry.name, kind: "loss", delta: loss }
      );
      if (tier) {
        spawnFloatingText(
          tier.label,
          anchor.r - 0.7,
          anchor.c,
          tier.color,
          0,
          { player: entry.name, kind: "tier" }
        );
      }
      if (committerAnchor) {
        spawnOrCoalesceProjectile(
          committer,
          entry.name,
          committerAnchor.r,
          committerAnchor.c,
          anchor.r,
          anchor.c,
          loss,
          tier,
          PLAYER_PROFILES[committer]?.color || "#fff"
        );
      }
    } else {
      spawnFloatingText(
        `${Math.round(entry.d)}`,
        anchor.r,
        anchor.c,
        "#ffb648",
        0,
        { player: entry.name, kind: "self", delta: entry.d }
      );
    }
  });
}

let lastControlsState = {
  max: -1,
  val: -1,
  date: "",
  btnText: "",
  disabled: null,
};

function updateControlsUI(force = false) {
  const maxVal = Math.max(0, historyTimeline.length - 1);
  if (force || lastControlsState.max !== maxVal) {
    slider.max = maxVal;
    lastControlsState.max = maxVal;
  }

  if (historyTimeline.length === 0) {
    if (force || lastControlsState.val !== 0) {
      slider.value = 0;
      lastControlsState.val = 0;
    }
    if (counter && (force || lastControlsState.date !== "No battle data loaded")) {
      counter.textContent = "No battle data loaded";
      lastControlsState.date = "No battle data loaded";
    }
    if (playBtn) {
      if (force || lastControlsState.disabled !== true) {
        playBtn.disabled = true;
        lastControlsState.disabled = true;
      }
      if (force || lastControlsState.btnText !== "Play") {
        playBtn.textContent = "Play";
        lastControlsState.btnText = "Play";
      }
    }
    return;
  }

  if (playBtn && (force || lastControlsState.disabled !== false)) {
    playBtn.disabled = false;
    lastControlsState.disabled = false;
  }

  if (force || lastControlsState.val !== currentFrameIndex) {
    slider.value = currentFrameIndex;
    lastControlsState.val = currentFrameIndex;
  }

  let step = historyTimeline[currentFrameIndex];
  const nextDate = step ? step.date : "";
  if (counter && (force || lastControlsState.date !== nextDate)) {
    counter.textContent = nextDate;
    lastControlsState.date = nextDate;
  }

  if (playBtn) {
    const nextBtnText =
      currentFrameIndex >= historyTimeline.length - 1
        ? "Replay"
        : isPlaying
          ? "Pause"
          : "Play";
    if (force || lastControlsState.btnText !== nextBtnText) {
      playBtn.textContent = nextBtnText;
      lastControlsState.btnText = nextBtnText;
    }
  }
}

function updateSimulation() {
  let now = performance.now();
  let rawDelta = now - lastFrameTime;
  lastFrameTime = now;
  if (historyTimeline.length === 0) return;

  // Clamp delta to prevent huge catch-up bursts after tab switches or lag spikes
  let delta = Math.min(Math.max(0, rawDelta), 100);
  let dtScale = Math.min(2.5, Math.max(0.2, delta / 16.667));

  if (roundPauseUntil > 0) {
    if (now < roundPauseUntil) {
      updateControlsUI();
      return;
    }
    roundPauseUntil = 0;
    roundBanner = null;
  }

  let speedMultiplier = parseFloat(speedSelect.value);
  if (isPlaying && currentFrameIndex < historyTimeline.length - 1) {
    frameAccumulator += (delta / 120) * speedMultiplier;
    let stepsProcessed = 0;
    while (
      frameAccumulator >= 1 &&
      currentFrameIndex < historyTimeline.length - 1 &&
      stepsProcessed < MAX_STEPS_PER_TICK
    ) {
      let prevIndex = currentFrameIndex;
      currentFrameIndex++;
      frameAccumulator -= 1;
      stepsProcessed++;
      processStepEvents(currentFrameIndex);

      if (scoreMode !== "total") {
        const prevKey = getPeriodKeyAtFrame(prevIndex, scoreMode);
        const nextKey = getPeriodKeyAtFrame(currentFrameIndex, scoreMode);
        if (prevKey && nextKey && prevKey !== nextKey) {
          roundBanner = buildRoundBanner(prevKey, scoreMode);
          roundPauseUntil = now + ROUND_PAUSE_MS;
          frameAccumulator = 0;
          break;
        }
      }
    }
    if (frameAccumulator > 2) {
      frameAccumulator = 1;
    }
    updateControlsUI();
  }

  for (let i = liveProjectiles.length - 1; i >= 0; i--) {
    let p = liveProjectiles[i];
    p.pct += 0.06 * dtScale;
    if (p.pct >= 1) {
      let t = p.tier;
      if (impactBlasts.length >= MAX_BLASTS) {
        impactBlasts.shift();
      }
      impactBlasts.push({
        r: p.tr,
        c: p.tc,
        rad: 4,
        maxRad: t ? t.rad : 26,
        rings: t ? t.ring : 1,
        alpha: 1,
        color: t ? t.color : p.color,
      });
      if (t) screenShake = Math.max(screenShake, t.shake);
      liveProjectiles.splice(i, 1);
    }
  }

  for (let i = impactBlasts.length - 1; i >= 0; i--) {
    let b = impactBlasts[i];
    b.rad += (b.maxRad || 26) * 0.06 * dtScale;
    b.alpha -= 0.05 * dtScale;
    if (b.alpha <= 0) impactBlasts.splice(i, 1);
  }

  screenShake *= Math.pow(0.85, dtScale);
  if (screenShake < 0.3) screenShake = 0;

  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    let t = floatingTexts[i];
    t.yOffset -= 0.35 * dtScale;
    t.life -= 0.008 * dtScale;
    if (t.life <= 0) floatingTexts.splice(i, 1);
  }
}
