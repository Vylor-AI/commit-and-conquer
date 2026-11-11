(function () {
  const PROFILE_CONFIG_STORAGE_KEY = "commit_and_conquer.profile_config.v2";

  const baseProfilesByName = {};
  let knownContributors = [];

  function normalizeName(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function safeGetDisplayOverrides() {
    if (
      typeof DISPLAY_OVERRIDE !== "undefined" &&
      DISPLAY_OVERRIDE &&
      typeof DISPLAY_OVERRIDE === "object"
    ) {
      return DISPLAY_OVERRIDE;
    }

    if (
      !window.DISPLAY_OVERRIDE ||
      typeof window.DISPLAY_OVERRIDE !== "object"
    ) {
      window.DISPLAY_OVERRIDE = {};
    }

    return window.DISPLAY_OVERRIDE;
  }

  function readState() {
    const base = { mergeMap: {}, profiles: {} };

    try {
      const raw = localStorage.getItem(PROFILE_CONFIG_STORAGE_KEY) || "";
      if (!raw) return base;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return base;

      const mergeMap =
        parsed.mergeMap && typeof parsed.mergeMap === "object"
          ? parsed.mergeMap
          : {};
      const profiles =
        parsed.profiles && typeof parsed.profiles === "object"
          ? parsed.profiles
          : {};

      return { mergeMap, profiles };
    } catch (_error) {
      return base;
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(PROFILE_CONFIG_STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.warn("Could not persist profile config:", error);
      return false;
    }
  }

  function clearState() {
    try {
      localStorage.removeItem(PROFILE_CONFIG_STORAGE_KEY);
    } catch (_error) {}
  }

  function sanitizeInitials(value, fallback) {
    const source = typeof value === "string" ? value.trim() : "";
    const clean = source.slice(0, 3).toUpperCase();
    if (clean) return clean;
    return fallback || "NA";
  }

  function sanitizeColor(value, fallback) {
    const source = typeof value === "string" ? value.trim() : "";
    if (/^#[0-9a-fA-F]{6}$/.test(source)) return source.toLowerCase();
    return fallback || "#8a97ad";
  }

  function hashString(value) {
    let h = 0;
    for (let i = 0; i < value.length; i += 1) {
      h = (h * 31 + value.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function hslToHex(h, s, l) {
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = light - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;

    if (h >= 0 && h < 60) {
      r = c;
      g = x;
      b = 0;
    } else if (h < 120) {
      r = x;
      g = c;
      b = 0;
    } else if (h < 180) {
      r = 0;
      g = c;
      b = x;
    } else if (h < 240) {
      r = 0;
      g = x;
      b = c;
    } else if (h < 300) {
      r = x;
      g = 0;
      b = c;
    } else {
      r = c;
      g = 0;
      b = x;
    }

    const toHex = (v) => {
      const n = Math.round((v + m) * 255);
      return n.toString(16).padStart(2, "0");
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function defaultColorForName(name) {
    const hue = hashString(name || "player") % 360;
    return hslToHex(hue, 68, 56);
  }

  function initialsFromName(name) {
    const raw = normalizeName(name);
    if (!raw) return "NA";
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function ensureBaseProfile(name) {
    if (!name) return;
    if (baseProfilesByName[name]) return;

    const existing = PLAYER_PROFILES[name];
    const base = {
      color: sanitizeColor(
        existing && existing.color,
        defaultColorForName(name)
      ),
      short: sanitizeInitials(
        existing && existing.short,
        initialsFromName(name)
      ),
      avatar: "",
    };

    baseProfilesByName[name] = base;

    if (!existing) {
      PLAYER_PROFILES[name] = {
        color: base.color,
        short: base.short,
        avatar: "",
      };
    }
  }

  function collectContributorsFromHistory(history) {
    if (!Array.isArray(history)) return [];

    const contributors = new Set();
    history.forEach((step) => {
      if (!step || !step.repoScores || typeof step.repoScores !== "object") {
        return;
      }

      Object.values(step.repoScores).forEach((repoScores) => {
        if (!repoScores || typeof repoScores !== "object") return;

        Object.keys(repoScores).forEach((name) => {
          const clean = normalizeName(name);
          if (clean) contributors.add(clean);
        });
      });
    });

    return Array.from(contributors).sort((a, b) => a.localeCompare(b));
  }

  function resolveCanonicalNameWithMap(name, mergeMap) {
    const clean = normalizeName(name);
    if (!clean) return "";

    let current = clean;
    const seen = new Set();

    while (true) {
      const next = normalizeName(mergeMap[current]);
      if (!next) break;
      if (next === current) break;
      if (seen.has(current)) break;
      seen.add(current);
      current = next;
    }

    return current;
  }

  function normalizeMergeMap(mergeMap) {
    const normalized = {};

    Object.entries(mergeMap || {}).forEach(([aliasRaw, targetRaw]) => {
      const alias = normalizeName(aliasRaw);
      const target = normalizeName(targetRaw);

      if (!alias || !target) return;
      if (alias === target) return;
      if (alias === "Others" || target === "Others") return;

      normalized[alias] = target;
    });

    const flattened = {};
    Object.keys(normalized).forEach((alias) => {
      const canonical = resolveCanonicalNameWithMap(normalized[alias], normalized);
      if (!canonical || canonical === alias) return;
      flattened[alias] = canonical;
    });

    return flattened;
  }

  function getMergeMap() {
    const state = readState();
    return normalizeMergeMap(state.mergeMap);
  }

  function setMerge(aliasName, targetName) {
    const alias = normalizeName(aliasName);
    const target = normalizeName(targetName);
    if (!alias || !target) return false;
    if (alias === target) return false;
    if (alias === "Others" || target === "Others") return false;

    const state = readState();
    const mergeMap = normalizeMergeMap(state.mergeMap);

    const canonicalTarget = resolveCanonicalNameWithMap(target, mergeMap);
    if (!canonicalTarget || canonicalTarget === alias) return false;

    mergeMap[alias] = canonicalTarget;
    state.mergeMap = normalizeMergeMap(mergeMap);
    return writeState(state);
  }

  function removeMerge(aliasName) {
    const alias = normalizeName(aliasName);
    if (!alias) return false;

    const state = readState();
    const mergeMap = normalizeMergeMap(state.mergeMap);
    if (!mergeMap[alias]) return true;

    delete mergeMap[alias];
    state.mergeMap = normalizeMergeMap(mergeMap);
    return writeState(state);
  }

  function resetMerges() {
    const state = readState();
    state.mergeMap = {};
    return writeState(state);
  }

  function resolveCanonicalName(name) {
    const mergeMap = getMergeMap();
    return resolveCanonicalNameWithMap(name, mergeMap);
  }

  function applyMergesToHistory(history) {
    if (!Array.isArray(history)) return [];
    const mergeMap = getMergeMap();

    return history.map((step) => {
      const mergedRepoScores = {};

      Object.entries((step && step.repoScores) || {}).forEach(
        ([repoName, playerScores]) => {
          if (!repoName || !playerScores || typeof playerScores !== "object") {
            return;
          }

          const mergedPlayers = {};
          Object.entries(playerScores).forEach(([playerName, loc]) => {
            const canonical = resolveCanonicalNameWithMap(playerName, mergeMap);
            if (!canonical) return;

            const numericLoc = Number(loc);
            if (!Number.isFinite(numericLoc)) return;

            mergedPlayers[canonical] = (mergedPlayers[canonical] || 0) + Math.max(0, numericLoc);
          });

          mergedRepoScores[repoName] = mergedPlayers;
        }
      );

      return {
        date: step && step.date ? step.date : "",
        committer: resolveCanonicalNameWithMap(step && step.committer, mergeMap),
        repo: step && step.repo ? step.repo : "vylor",
        changes:
          step && step.changes && typeof step.changes === "object"
            ? step.changes
            : {},
        repoScores: mergedRepoScores,
      };
    });
  }

  function applyStyleToContributor(name, profileState, displayOverrides) {
    ensureBaseProfile(name);

    const base = baseProfilesByName[name];
    const player = PLAYER_PROFILES[name] || {};

    const preferredName =
      profileState && typeof profileState.name === "string"
        ? profileState.name.trim()
        : "";
    const preferredInitials =
      profileState && typeof profileState.initials === "string"
        ? profileState.initials
        : "";
    const preferredColor =
      profileState && typeof profileState.color === "string"
        ? profileState.color
        : "";
    const preferredAvatar =
      profileState && typeof profileState.avatarUrl === "string"
        ? profileState.avatarUrl.trim()
        : "";

    player.short = sanitizeInitials(preferredInitials, base.short);
    player.color = sanitizeColor(preferredColor, base.color);
    player.avatar = preferredAvatar || "";

    PLAYER_PROFILES[name] = player;

    if (preferredName) {
      displayOverrides[name] = preferredName;
    } else {
      delete displayOverrides[name];
    }
  }

  function applyOverridesFromHistory(history) {
    knownContributors = collectContributorsFromHistory(history);

    const displayOverrides = safeGetDisplayOverrides();
    Object.keys(displayOverrides).forEach((k) => {
      delete displayOverrides[k];
    });

    const state = readState();
    state.mergeMap = normalizeMergeMap(state.mergeMap);
    writeState(state);

    const canonicalContributors = Array.from(
      new Set(
        knownContributors
          .map((name) => resolveCanonicalNameWithMap(name, state.mergeMap))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    canonicalContributors.forEach((name) => {
      applyStyleToContributor(name, state.profiles[name] || {}, displayOverrides);
    });

    if (typeof window.refreshAvatarImages === "function") {
      window.refreshAvatarImages();
    }

    return canonicalContributors;
  }

  function getEditableContributors() {
    const state = readState();
    const mergeMap = normalizeMergeMap(state.mergeMap);
    const canonicalToAliases = {};

    knownContributors.forEach((name) => {
      const canonical = resolveCanonicalNameWithMap(name, mergeMap);
      if (!canonical) return;
      if (!canonicalToAliases[canonical]) canonicalToAliases[canonical] = [];
      canonicalToAliases[canonical].push(name);
    });

    const canonicalNames = Object.keys(canonicalToAliases).sort((a, b) =>
      a.localeCompare(b)
    );

    return canonicalNames.map((canonicalName) => {
      ensureBaseProfile(canonicalName);

      const profileState = state.profiles[canonicalName] || {};
      const base = baseProfilesByName[canonicalName];
      const aliases = canonicalToAliases[canonicalName] || [];
      const preferredName =
        typeof profileState.name === "string" ? profileState.name.trim() : "";

      return {
        name: canonicalName,
        displayName: preferredName || "",
        initials: sanitizeInitials(profileState.initials, base.short),
        color: sanitizeColor(profileState.color, base.color),
        avatarUrl:
          typeof profileState.avatarUrl === "string"
            ? profileState.avatarUrl.trim()
            : "",
        aliases,
      };
    });
  }

  function saveProfiles(nextProfiles) {
    const state = readState();
    const cleaned = {};

    Object.entries(nextProfiles || {}).forEach(([canonicalNameRaw, profile]) => {
      const canonicalName = normalizeName(canonicalNameRaw);
      if (!canonicalName) return;
      if (!profile || typeof profile !== "object") return;

      const name =
        typeof profile.name === "string" ? profile.name.trim() : "";
      const initials =
        typeof profile.initials === "string" ? profile.initials.trim() : "";
      const color = typeof profile.color === "string" ? profile.color.trim() : "";
      const avatarUrl =
        typeof profile.avatarUrl === "string" ? profile.avatarUrl.trim() : "";

      cleaned[canonicalName] = {
        name,
        initials: sanitizeInitials(initials, initialsFromName(canonicalName)),
        color: sanitizeColor(color, defaultColorForName(canonicalName)),
        avatarUrl,
      };
    });

    state.profiles = cleaned;
    state.mergeMap = normalizeMergeMap(state.mergeMap);
    return writeState(state);
  }

  function resetAll() {
    clearState();
    return true;
  }

  window.ProfileConfig = {
    applyOverridesFromHistory,
    collectContributorsFromHistory,
    getEditableContributors,
    saveProfiles,
    getMergeMap,
    setMerge,
    removeMerge,
    resetMerges,
    resolveCanonicalName,
    applyMergesToHistory,
    resetAll,
  };
})();
