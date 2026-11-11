/**
 * mapper.js — data-preparation layer for Commit & Conquer.
 *
 * Keeps the raw commit history raw; everything here turns that raw data into
 * the view model the renderer consumes: player identity/style, narrative feed,
 * AFK spans, and period contribution models (monthly + quarterly).
 */

const PLAYER_PROFILES = {};

const DISPLAY_OVERRIDE = {};

function normalizeNameKey(name) {
  return typeof name === "string" ? name.trim() : "";
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function hslToHex(h, s, l) {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;

  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - chroma / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = chroma;
    g = x;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = chroma;
  } else if (h >= 120 && h < 180) {
    g = chroma;
    b = x;
  } else if (h >= 180 && h < 240) {
    g = x;
    b = chroma;
  } else if (h >= 240 && h < 300) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  const toHex = (n) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function colorFromName(name) {
  const seed = hashString(name || "others");
  const hue = seed % 360;
  const saturation = 62 + (seed % 10);
  const lightness = 48 + (seed % 8);
  return hslToHex(hue, saturation, lightness);
}

function initialsFromName(name) {
  const clean = normalizeNameKey(name);
  if (!clean) return "OT";

  const parts = clean
    .split(/[\s._-]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }

  if (parts.length === 1) {
    const token = parts[0].replace(/[^a-zA-Z0-9]/g, "");
    if (!token) return "OT";
    if (token.length === 1) return `${token.toUpperCase()}X`;
    return token.slice(0, 2).toUpperCase();
  }

  return "OT";
}

function avatarFromName(name) {
  const clean = normalizeNameKey(name);
  if (!clean) return "Others.png";
  return `${clean.replace(/\s+/g, "_").replace(/\./g, "")}.png`;
}

function ensurePlayerProfile(name) {
  const key = normalizeNameKey(name);
  if (PLAYER_PROFILES[key]) return PLAYER_PROFILES[key];

  PLAYER_PROFILES[key] = {
    color: colorFromName(key),
    short: initialsFromName(key),
    avatar: avatarFromName(key),
  };
  return PLAYER_PROFILES[key];
}

function derivePlayerProfilesFromHistory(historyTimeline) {
  Object.keys(PLAYER_PROFILES).forEach((name) => {
    if (name !== "Others") delete PLAYER_PROFILES[name];
  });

  (historyTimeline || []).forEach((step) => {
    if (!step || typeof step !== "object") return;

    if (step.committer) ensurePlayerProfile(step.committer);

    const repoScores = step.repoScores || {};
    Object.values(repoScores).forEach((players) => {
      Object.keys(players || {}).forEach((name) => {
        ensurePlayerProfile(name);
      });
    });
  });

  return PLAYER_PROFILES;
}

function displayName(name) {
  const clean = normalizeNameKey(name);
  if (!clean) return "";
  if (DISPLAY_OVERRIDE[clean]) return DISPLAY_OVERRIDE[clean];
  const first = clean.split(/[.\s]+/)[0] || clean;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

const BOT_COMMITTERS = new Set([
  "CI",
  "Root",
  "Bitbucket-pipelines",
  "Semantic-release",
]);
const isNarratable = (name) =>
  name && !BOT_COMMITTERS.has(name) && !/bot|pipeline|ci\b/i.test(name);

// --- DAMAGE TIERS ---------------------------------------------------------
const DAMAGE_TIERS = [
  {
    min: 2000,
    ring: 3,
    rad: 70,
    shake: 16,
    label: "DEVASTATION",
    color: "#ff2d55",
  },
  {
    min: 1000,
    ring: 2,
    rad: 52,
    shake: 10,
    label: "CRITICAL HIT",
    color: "#ff5c6c",
  },
  {
    min: 500,
    ring: 2,
    rad: 38,
    shake: 5,
    label: "HEAVY HIT",
    color: "#ff8a3d",
  },
];
const damageTier = (loss) => DAMAGE_TIERS.find((t) => loss >= t.min) || null;

// --- NARRATIVE FEED + AFK -------------------------------------------------
const AFK_DAYS = 10;
const AFK_GRACE_DAYS = 2;
const MIN_AFK_FRAMES = 8;

function buildEventsData(historyTimeline) {
  const gameEvents = [];
  const afkByPlayer = {};

  const byPlayer = {};
  historyTimeline.forEach((s, i) => {
    const p = s.committer;
    if (!p || !isNarratable(p)) return;
    (byPlayer[p] = byPlayer[p] || []).push(i);
  });

  const firstAppear = {};
  historyTimeline.forEach((s, i) => {
    if (!s.repoScores) return;
    Object.values(s.repoScores).forEach((rs) => {
      Object.entries(rs).forEach(([n, loc]) => {
        if (
          loc > 0 &&
          n !== "Others" &&
          isNarratable(n) &&
          firstAppear[n] === undefined
        ) {
          firstAppear[n] = i;
        }
      });
    });
  });

  const firstFrames = Object.entries(firstAppear)
    .map(([p, f]) => ({ p, f }))
    .sort((a, b) => a.f - b.f);
  firstFrames.forEach((e, idx) => {
    gameEvents.push({
      frame: e.f,
      text:
        idx === 0
          ? `${displayName(e.p)} created a new server`
          : `${displayName(e.p)} joined the server`,
      color: idx === 0 ? "#37d67a" : "#4aa8ff",
    });
  });

  const frameTimes = historyTimeline.map((s) => new Date(s.date).getTime());
  const endTime = frameTimes[frameTimes.length - 1];
  const frameAtOrAfter = (t) => {
    let lo = 0;
    let hi = frameTimes.length;
    while (lo < hi) {
      let m = (lo + hi) >> 1;
      if (frameTimes[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const DAY = 86400000;

  Object.entries(byPlayer).forEach(([p, frames]) => {
    for (let i = 0; i < frames.length; i++) {
      const cur = frameTimes[frames[i]];
      const isLast = i + 1 >= frames.length;
      const next = isLast ? endTime : frameTimes[frames[i + 1]];
      if ((next - cur) / DAY < AFK_DAYS) continue;

      const startF = frameAtOrAfter(cur + AFK_GRACE_DAYS * DAY);
      const endF = isLast ? historyTimeline.length : frames[i + 1];
      if (endF - startF < MIN_AFK_FRAMES) continue;

      (afkByPlayer[p] = afkByPlayer[p] || []).push([startF, endF]);
      gameEvents.push({
        frame: startF,
        text: `${displayName(p)} went AFK`,
        color: "#8a97ad",
      });
      if (!isLast) {
        gameEvents.push({
          frame: endF,
          text: `${displayName(p)} is back online`,
          color: "#ffb648",
        });
      }
    }
  });

  gameEvents.sort((a, b) => a.frame - b.frame);
  return { gameEvents, afkByPlayer };
}

// --- CONTRIBUTION MODELS --------------------------------------------------
function cloneRepoScores(repoScores) {
  const cloned = {};
  Object.entries(repoScores || {}).forEach(([repo, playerScores]) => {
    cloned[repo] = {};
    Object.entries(playerScores || {}).forEach(([name, value]) => {
      cloned[repo][name] = value;
    });
  });
  return cloned;
}

/**
 * Primary source: per-player delta from repoScores snapshots.
 * Fallback source: changes.added for committer/repo when snapshots are missing.
 */
function framePositiveContributions(step, prevStep) {
  const byRepo = {};
  if (!step) return byRepo;

  const currScores = step.repoScores || null;
  const prevScores = (prevStep && prevStep.repoScores) || {};

  if (currScores) {
    const repos = new Set([
      ...Object.keys(currScores),
      ...Object.keys(prevScores),
    ]);
    repos.forEach((repo) => {
      const currRepo = currScores[repo] || {};
      const prevRepo = prevScores[repo] || {};
      const players = new Set([
        ...Object.keys(currRepo),
        ...Object.keys(prevRepo),
      ]);

      players.forEach((name) => {
        const delta = (currRepo[name] || 0) - (prevRepo[name] || 0);
        if (delta > 0) {
          if (!byRepo[repo]) byRepo[repo] = {};
          byRepo[repo][name] = (byRepo[repo][name] || 0) + delta;
        }
      });
    });

    if (Object.keys(byRepo).length > 0) return byRepo;
  }

  const changes = step.changes || {};
  const committer = step.committer;
  const repo = step.repo || "vylor";
  const added =
    typeof changes.added === "number" ? Math.max(0, changes.added) : 0;
  if (committer && added > 0) {
    byRepo[repo] = {};
    byRepo[repo][committer] = added;
  }

  return byRepo;
}

function monthKeyFromDate(dateString) {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelFromKey(monthKey) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return monthKey || "";
  const [year, month] = monthKey.split("-");
  const idx = Number(month) - 1;
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${names[Math.max(0, Math.min(11, idx))]} ${year}`;
}

function quarterKeyFromDate(dateString) {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

function quarterLabelFromKey(quarterKey) {
  if (!quarterKey || !/^\d{4}-Q[1-4]$/.test(quarterKey))
    return quarterKey || "";
  const [year, q] = quarterKey.split("-Q");
  return `Q${q} ${year}`;
}

function summarizeRepoScores(repoScores) {
  const byRepo = {};
  const byPlayer = {};
  let teamTotal = 0;

  Object.entries(repoScores || {}).forEach(([repo, playerScores]) => {
    let repoTotal = 0;
    Object.entries(playerScores || {}).forEach(([name, value]) => {
      const loc = Math.max(0, value || 0);
      repoTotal += loc;
      byPlayer[name] = (byPlayer[name] || 0) + loc;
      teamTotal += loc;
    });
    byRepo[repo] = repoTotal;
  });

  return { teamTotal, byRepo, byPlayer };
}

function buildPeriodContributionModel(historyTimeline, periodType) {
  const frameScoresTimeline = [];
  const framePeriodKey = [];
  const periodFinalTotalsByKey = {};
  const periodFinalRepoScoresByKey = {};
  const periodGrowthByKey = {};
  const periodLabelByKey = {};

  let currentPeriodKey = "";
  let activePeriodScores = {};

  historyTimeline.forEach((step, idx) => {
    const key =
      periodType === "quarterly"
        ? quarterKeyFromDate(step.date)
        : monthKeyFromDate(step.date);

    if (key !== currentPeriodKey) {
      currentPeriodKey = key;
      activePeriodScores = {};
    }

    framePeriodKey.push(key);
    periodLabelByKey[key] =
      periodType === "quarterly"
        ? quarterLabelFromKey(key)
        : monthLabelFromKey(key);

    const prevStep = idx > 0 ? historyTimeline[idx - 1] : null;
    const frameContrib = framePositiveContributions(step, prevStep);

    Object.entries(frameContrib).forEach(([repo, playerScores]) => {
      if (!activePeriodScores[repo]) activePeriodScores[repo] = {};
      Object.entries(playerScores).forEach(([name, contribution]) => {
        ensurePlayerProfile(name);
        if (contribution > 0) {
          activePeriodScores[repo][name] =
            (activePeriodScores[repo][name] || 0) + contribution;
        }
      });
    });

    frameScoresTimeline.push(cloneRepoScores(activePeriodScores));
  });

  frameScoresTimeline.forEach((repoScores, idx) => {
    const key = framePeriodKey[idx];
    periodFinalTotalsByKey[key] = summarizeRepoScores(repoScores);
    periodFinalRepoScoresByKey[key] = cloneRepoScores(repoScores);
  });

  const orderedKeys = Object.keys(periodFinalTotalsByKey).sort();
  orderedKeys.forEach((key, idx) => {
    const prev3 = orderedKeys.slice(Math.max(0, idx - 3), idx);
    if (prev3.length < 3) {
      periodGrowthByKey[key] = {
        baselineAvg: null,
        growthPct: null,
        ratioPct: null,
        ratioX: null,
      };
      return;
    }

    const baselineSum = prev3.reduce(
      (sum, k) => sum + periodFinalTotalsByKey[k].teamTotal,
      0
    );
    const baselineAvg = baselineSum / prev3.length;
    const currentTotal = periodFinalTotalsByKey[key].teamTotal;

    if (baselineAvg <= 0) {
      periodGrowthByKey[key] = {
        baselineAvg,
        growthPct: null,
        ratioPct: null,
        ratioX: null,
      };
      return;
    }

    const growthPct = ((currentTotal - baselineAvg) / baselineAvg) * 100;
    const ratioPct = (currentTotal / baselineAvg) * 100;
    const ratioX = currentTotal / baselineAvg;

    periodGrowthByKey[key] = {
      baselineAvg,
      growthPct,
      ratioPct,
      ratioX,
    };
  });

  return {
    frameScoresTimeline,
    framePeriodKey,
    periodFinalTotalsByKey,
    periodFinalRepoScoresByKey,
    periodGrowthByKey,
    periodLabelByKey,
  };
}

function buildMonthlyContributionModel(historyTimeline) {
  const m = buildPeriodContributionModel(historyTimeline, "monthly");
  return {
    frameScoresTimeline: m.frameScoresTimeline,
    frameMonthKey: m.framePeriodKey,
    monthFinalTotalsByKey: m.periodFinalTotalsByKey,
    monthFinalRepoScoresByKey: m.periodFinalRepoScoresByKey,
    monthGrowthByKey: m.periodGrowthByKey,
    monthLabelByKey: m.periodLabelByKey,
  };
}

function buildQuarterlyContributionModel(historyTimeline) {
  const q = buildPeriodContributionModel(historyTimeline, "quarterly");
  return {
    frameScoresTimeline: q.frameScoresTimeline,
    frameQuarterKey: q.framePeriodKey,
    quarterFinalTotalsByKey: q.periodFinalTotalsByKey,
    quarterFinalRepoScoresByKey: q.periodFinalRepoScoresByKey,
    quarterGrowthByKey: q.periodGrowthByKey,
    quarterLabelByKey: q.periodLabelByKey,
  };
}

function buildMonthlyContributionTimeline(historyTimeline) {
  const model = buildMonthlyContributionModel(historyTimeline);
  return model.frameScoresTimeline;
}
