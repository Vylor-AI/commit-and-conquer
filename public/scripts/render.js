const isDebugOverlayEnabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("debug") === "1";

let fpsSmoothed = 60;
let frameTimeSmoothed = 16.7;
let lastRenderPerfNow = performance.now();

function getPeriodStatsForFrame(frameIdx, mode = scoreMode) {
  const model = getContributionModelForMode(mode);
  if (!model) return null;

  const key = model.frameKeys[frameIdx];
  if (!key) return null;

  const currentScores = model.frameScoresTimeline[frameIdx] || {};
  const finalSummary = model.finalTotalsByKey[key] || {
    teamTotal: 0,
    byPlayer: {},
    byRepo: {},
  };
  const growth = model.growthByKey[key] || null;
  const label = model.labelByKey[key] || key;

  const keys = model.orderedKeys || Object.keys(model.finalTotalsByKey).sort();
  const keyIdx = keys.indexOf(key);
  const previousKey = keyIdx > 0 ? keys[keyIdx - 1] : "";
  const previousFinalRepoScores = previousKey
    ? model.finalRepoScoresByKey[previousKey] || null
    : null;

  const currentByPlayer = {};
  let currentTotal = 0;
  Object.values(currentScores).forEach((repoScores) => {
    Object.entries(repoScores || {}).forEach(([name, loc]) => {
      currentByPlayer[name] = (currentByPlayer[name] || 0) + loc;
      currentTotal += loc;
    });
  });

  return {
    key,
    label,
    currentTotal,
    finalTotal: finalSummary.teamTotal || 0,
    currentByPlayer,
    finalByPlayer: finalSummary.byPlayer || {},
    growth,
    previousFinalRepoScores,
  };
}

function drawRoundBannerOverlay() {
  if (!roundBanner || roundPauseUntil <= 0) return;
  if (performance.now() > roundPauseUntil) return;

  const isMobile = viewWidth <= 640;
  const mapW = viewWidth - SB_WIDTH;
  const boxW = Math.min(720, mapW - (isMobile ? 24 : 80));
  const boxH = isMobile ? 200 : 240;
  const x = SB_WIDTH + (mapW - boxW) / 2;
  const y = (viewHeight - boxH) / 2;

  ctx.save();
  ctx.fillStyle = "rgba(4, 8, 14, 0.76)";
  ctx.fillRect(SB_WIDTH, 0, mapW, viewHeight);

  ctx.fillStyle = "rgba(15,20,32,0.96)";
  ctx.strokeStyle = "rgba(112, 184, 255, 0.45)";
  ctx.lineWidth = 2;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 14);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeRect(x, y, boxW, boxH);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#eaf1fb";
  ctx.font = isMobile
    ? "800 18px Inter, sans-serif"
    : "800 26px Inter, sans-serif";
  ctx.fillText(
    roundBanner.title || "ROUND COMPLETE",
    x + boxW / 2,
    y + (isMobile ? 42 : 54)
  );

  ctx.fillStyle = "#8a97ad";
  ctx.font = isMobile
    ? "600 12px Inter, sans-serif"
    : "600 15px Inter, sans-serif";
  ctx.fillText(
    roundBanner.subtitle || "",
    x + boxW / 2,
    y + (isMobile ? 66 : 82)
  );

  const medals = ["🥇", "🥈", "🥉"];
  const winners = roundBanner.winners || [];
  winners.forEach((w, i) => {
    ctx.fillStyle = "#eaf1fb";
    ctx.font = isMobile
      ? "700 15px Inter, sans-serif"
      : "700 20px Inter, sans-serif";
    const rowY = y + (isMobile ? 102 : 126) + i * (isMobile ? 28 : 34);
    ctx.fillText(
      `${medals[i] || "•"}  ${displayName(w.name)}  ·  ${Math.round(w.loc).toLocaleString()} LOC`,
      x + boxW / 2,
      rowY
    );
  });

  if (winners.length === 0) {
    ctx.fillStyle = "#8a97ad";
    ctx.font = "600 15px Inter, sans-serif";
    ctx.fillText("No ranked players for this round.", x + boxW / 2, y + 130);
  }

  ctx.restore();
}

function drawBatchedWaterGrid(c0, c1, r0, r1) {
  if (cellPx < 6) return;
  if ((c1 - c0) * (r1 - r0) >= 40000) return;

  const startX = sx(c0);
  const endX = sx(c1 + 1);
  const startY = sy(r0);
  const endY = sy(r1 + 1);

  ctx.strokeStyle = PALETTE.waterGrid;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let c = c0; c <= c1 + 1; c++) {
    const x = sx(c);
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let r = r0; r <= r1 + 1; r++) {
    const y = sy(r);
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }

  ctx.stroke();
}

function drawWorldBlocks(blocksByPlayer, inset, alphaOverride) {
  const blockSize = cellPx - inset * 2;
  if (blockSize <= 0) return;

  blocksByPlayer.forEach((coords, name) => {
    if (!coords || coords.length === 0) return;
    ctx.fillStyle = PLAYER_PROFILES[name]?.color || "#8a97ad";
    if (typeof alphaOverride === "function") {
      ctx.globalAlpha = alphaOverride(name);
    }
    for (let i = 0; i < coords.length; i++) {
      const [r, c] = coords[i];
      ctx.fillRect(sx(c) + inset, sy(r) + inset, blockSize, blockSize);
    }
  });
}

function drawSimulation() {
  const now = performance.now();
  const dt = Math.max(1, now - lastRenderPerfNow);
  lastRenderPerfNow = now;
  frameTimeSmoothed = frameTimeSmoothed * 0.9 + dt * 0.1;
  fpsSmoothed = 1000 / Math.max(1, frameTimeSmoothed);

  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  if (historyTimeline.length === 0) {
    updateLeaderboardDOM({}, 0, null, {}, null);
    return;
  }

  let currentStep = historyTimeline[currentFrameIndex];
  let frameRepoScores = getRepoScoresAtFrame(currentFrameIndex);

  let scores = {};
  Object.values(frameRepoScores).forEach((repo) => {
    Object.entries(repo).forEach(([name, val]) => {
      scores[name] = (scores[name] || 0) + val;
    });
  });
  let totalLines = Object.values(scores).reduce((a, b) => a + b, 0);

  const periodStats =
    scoreMode === "monthly" || scoreMode === "quarterly"
      ? getPeriodStatsForFrame(currentFrameIndex, scoreMode)
      : null;

  const world = buildWorld(frameRepoScores);
  lastCentroids = world.centroids;

  if (followCam) {
    const viewW = Math.max(120, viewWidth - SB_WIDTH);
    const viewH = Math.max(120, viewHeight);
    const cc = (world.minC + world.maxC) / 2;
    const cr = (world.minR + world.maxR) / 2;
    const targetX = SB_WIDTH + viewW / 2 - cc * cellPx - baseOffsetX;
    const targetY = viewH / 2 - cr * cellPx - baseOffsetY;
    pan.x += (targetX - pan.x) * 0.06;
    pan.y += (targetY - pan.y) * 0.06;
  }

  let shX = 0;
  let shY = 0;
  if (screenShake > 0) {
    shX = (Math.random() - 0.5) * 2 * screenShake;
    shY = (Math.random() - 0.5) * 2 * screenShake;
  }
  mapOffsetX = baseOffsetX + pan.x + shX;
  mapOffsetY = baseOffsetY + pan.y + shY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(SB_WIDTH, 0, Math.max(0, viewWidth - SB_WIDTH), viewHeight);
  ctx.clip();

  let c0 = Math.floor((SB_WIDTH - mapOffsetX) / cellPx) - 1;
  let c1 = Math.ceil((viewWidth - mapOffsetX) / cellPx) + 1;
  let r0 = Math.floor((0 - mapOffsetY) / cellPx) - 1;
  let r1 = Math.ceil((viewHeight - mapOffsetY) / cellPx) + 1;

  drawBatchedWaterGrid(c0, c1, r0, r1);

  if (periodStats && periodStats.previousFinalRepoScores) {
    const ghostWorld = buildWorld(periodStats.previousFinalRepoScores);
    const ghostInset = (cellPx - (BLOCK / CELL) * cellPx) / 2;
    ctx.save();
    ctx.globalAlpha = 0.18;
    drawWorldBlocks(ghostWorld.blocksByPlayer, ghostInset, null);
    ctx.restore();
  }

  ctx.fillStyle = "rgba(234,241,251,0.32)";
  ctx.font =
    viewWidth <= 640
      ? "700 12px Inter, sans-serif"
      : "700 15px Inter, sans-serif";
  ctx.textAlign = "center";
  (function drawIslandLabels() {
    let cs = world.centroids.slice().sort((a, b) => a.c - b.c);
    if (cs.length === 0) return;
    let groups = [[cs[0]]];
    for (let i = 1; i < cs.length; i++) {
      if (cs[i].c - cs[i - 1].c > ISLAND_GAP + 2) groups.push([]);
      groups[groups.length - 1].push(cs[i]);
    }
    groups.forEach((g, gi) => {
      let avgC = g.reduce((s, p) => s + p.c, 0) / g.length;
      let label = REPO_ISLANDS[Math.min(gi, REPO_ISLANDS.length - 1)].label;
      ctx.fillText(label, sx(avgC) + cellPx / 2, sy(world.minR) - 8);
    });
  })();
  ctx.textAlign = "left";

  ctx.fillStyle = PALETTE.sand;
  const beachCells = world.beachCells;
  for (let i = 0; i < beachCells.length; i++) {
    const [r, c] = beachCells[i];
    ctx.fillRect(sx(c), sy(r), cellPx, cellPx);
  }

  const afkNow = new Set(Object.keys(afkByPlayer).filter((n) => isAfk(n)));
  let inset = (cellPx - (BLOCK / CELL) * cellPx) / 2;
  drawWorldBlocks(world.blocksByPlayer, inset, (name) =>
    afkNow.has(name) ? 0.3 : 1
  );
  ctx.globalAlpha = 1;

  for (let i = 0; i < liveProjectiles.length; i++) {
    const p = liveProjectiles[i];
    let x = sx(p.sc + (p.tc - p.sc) * p.pct) + cellPx / 2;
    let y = sy(p.sr + (p.tr - p.sr) * p.pct) + cellPx / 2;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < impactBlasts.length; i++) {
    const b = impactBlasts[i];
    let bx = sx(b.c) + cellPx / 2;
    let by = sy(b.r) + cellPx / 2;
    let rings = b.rings || 1;
    ctx.save();
    if (rings > 1) {
      ctx.globalAlpha = b.alpha * 0.25;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(bx, by, b.rad, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let ri = 0; ri < rings; ri++) {
      ctx.globalAlpha = b.alpha * (1 - ri * 0.25);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(2, b.rad - ri * 12), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  const avSize = viewWidth <= 640 ? 24 : 30;
  const radius = avSize / 2;
  world.centroids.forEach((ctr) => {
    let name = ctr.name;
    let prof = PLAYER_PROFILES[name] || PLAYER_PROFILES["Others"] || {
      color: "#8a97ad",
      short: "OT",
    };
    let img = avatarImages[name] || avatarImages["Others"];
    const cx = sx(ctr.c) + cellPx / 2;
    const cy = sy(ctr.r) + cellPx / 2;

    ctx.save();
    ctx.globalAlpha = afkNow.has(name) ? 0.4 : 1;

    ctx.fillStyle = "#0a0f1a";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = prof.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        img,
        cx - radius + 2,
        cy - radius + 2,
        avSize - 4,
        avSize - 4
      );
      ctx.restore();
    } else {
      ctx.fillStyle = prof.color;
      ctx.font =
        viewWidth <= 640
          ? "700 10px Inter, sans-serif"
          : "700 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(prof.short, cx, cy + 1);
    }

    ctx.restore();
  });

  ctx.save();
  ctx.font =
    viewWidth <= 640
      ? "800 15px Inter, sans-serif"
      : "800 18px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  for (let i = 0; i < floatingTexts.length; i++) {
    const t = floatingTexts[i];
    ctx.globalAlpha = Math.max(0, Math.min(1, t.life * 1.6));
    let px = sx(t.c) + cellPx / 2;
    let py = sy(t.r) + cellPx / 2 - 22 + t.yOffset;
    ctx.strokeText(t.text, px, py);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, px, py);
  }
  ctx.restore();

  ctx.textAlign = "left";
  ctx.restore();

  drawEventFeed();
  updateLeaderboardDOM(
    scores,
    totalLines,
    currentStep,
    frameRepoScores,
    periodStats
  );
  drawRoundBannerOverlay();

  if (isDebugOverlayEnabled) {
    drawDebugOverlay();
  }
}

function findLastEventIndexAtOrBefore(frameIdx) {
  let lo = 0;
  let hi = gameEvents.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (gameEvents[mid].frame <= frameIdx) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function drawEventFeed() {
  if (gameEvents.length === 0) return;
  const lastIdx = findLastEventIndexAtOrBefore(currentFrameIndex);
  if (lastIdx < 0) return;

  const isMobile = viewWidth <= 640;
  const maxLines = isMobile ? 3 : 6;
  const startIdx = Math.max(0, lastIdx - maxLines + 1);
  const shown = gameEvents.slice(startIdx, lastIdx + 1);
  if (shown.length === 0) return;

  const padX = isMobile ? 10 : 14;
  const padY = isMobile ? 8 : 12;
  const lineH = isMobile ? 18 : 22;
  const x = isMobile ? 12 : SB_WIDTH + 22;
  const y = isMobile ? 92 : 22;
  const width = isMobile ? Math.min(260, viewWidth - 24) : 320;
  const height = padY * 2 + shown.length * lineH;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 10);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, width, height);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  if (ctx.roundRect) ctx.stroke();

  ctx.font = isMobile
    ? "700 10px Inter, sans-serif"
    : "700 11px Inter, sans-serif";
  ctx.fillStyle = "rgba(234,241,251,0.5)";
  ctx.fillText("BATTLE LOG", x + padX, y + padY + 2);

  ctx.font = isMobile
    ? "600 12px Inter, sans-serif"
    : "600 14px Inter, sans-serif";
  shown.forEach((e, i) => {
    let age = shown.length - 1 - i;
    ctx.globalAlpha = Math.max(0.45, 1 - age * 0.12);
    ctx.fillStyle = e.color;
    ctx.fillText("›", x + padX, y + padY + (isMobile ? 18 : 22) + i * lineH);
    ctx.fillStyle = "#eaf1fb";
    ctx.fillText(
      e.text,
      x + padX + (isMobile ? 12 : 16),
      y + padY + (isMobile ? 18 : 22) + i * lineH
    );
  });
  ctx.globalAlpha = 1;
  ctx.restore();
}

function computePlayerTier(loc, name) {
  const warlords = Array.isArray(window.CNC_WARLORD_PLAYERS)
    ? window.CNC_WARLORD_PLAYERS
    : [];
  if (warlords.includes(name) || loc > 40000) return 4;
  if (loc > 15000) return 3;
  if (loc > 6000) return 2;
  if (loc > 1000) return 1;
  return 0;
}

let lastLeaderboardRenderKey = "";

function updateLeaderboardDOM(
  scores,
  totalLines,
  currentStep,
  frameRepoScores,
  periodStats
) {
  const renderKey = `${currentFrameIndex}|${scoreMode}|${historyTimeline.length}|${profileRevision}`;
  if (renderKey === lastLeaderboardRenderKey) return;
  lastLeaderboardRenderKey = renderKey;

  const modeTitleEl = document.getElementById("lb-mode-title");
  const subtitleEl = document.getElementById("lb-subtitle");
  const growthEl = document.getElementById("lb-growth");
  const island0El = document.getElementById("lb-island-0");
  const island1El = document.getElementById("lb-island-1");
  const listEl = document.getElementById("leaderboard-list");
  const drawerTitleEl = document.getElementById("drawer-summary-title");
  const drawerMetaEl = document.getElementById("drawer-summary-meta");
  const panelEl = document.getElementById("leaderboard-panel");

  if (!listEl || !subtitleEl) return;

  const isPeriodic = scoreMode === "monthly" || scoreMode === "quarterly";
  const isDrawerOpen = panelEl && panelEl.classList.contains("drawer-open");

  if (modeTitleEl) {
    if (scoreMode === "monthly") {
      modeTitleEl.textContent = "MONTHLY CONQUERED";
      modeTitleEl.classList.remove("hidden");
    } else if (scoreMode === "quarterly") {
      modeTitleEl.textContent = "QUARTERLY CONQUERED";
      modeTitleEl.classList.remove("hidden");
    } else {
      modeTitleEl.textContent = "";
      modeTitleEl.classList.add("hidden");
    }
  }

  if (isPeriodic && periodStats) {
    subtitleEl.textContent = `${periodStats.label} · Current ${Math.round(periodStats.currentTotal).toLocaleString()} LOC · Total ${Math.round(periodStats.finalTotal).toLocaleString()} LOC`;
    if (growthEl) {
      growthEl.classList.remove("hidden");
      const g = periodStats.growth;
      if (
        g &&
        typeof g.growthPct === "number" &&
        typeof g.ratioPct === "number"
      ) {
        const sign = g.growthPct >= 0 ? "+" : "";
        growthEl.innerHTML =
          `<div class="lb-growth-primary">${sign}${g.growthPct.toFixed(0)}% vs trailing 3-period avg (${Math.round(g.baselineAvg).toLocaleString()} LOC)</div>` +
          `<div class="lb-growth-secondary">${g.ratioPct.toFixed(0)}% of baseline (${g.ratioX.toFixed(1)}x)</div>`;
      } else {
        growthEl.innerHTML = `<div class="lb-growth-muted">Growth baseline: need 3 prior full periods</div>`;
      }
    }
  } else {
    subtitleEl.textContent = `TOTAL EMPIRE · ${Math.round(totalLines).toLocaleString()} LOC`;
    if (growthEl) {
      growthEl.classList.add("hidden");
      growthEl.innerHTML = "";
    }
  }

  let islandTotals = REPO_ISLANDS.map(() => 0);
  let playerIsland = {};
  Object.entries(frameRepoScores || {}).forEach(([repo, ps]) => {
    let idx = REPO_ISLANDS.findIndex((i) => i.match(repo));
    if (idx < 0) idx = 0;
    Object.entries(ps).forEach(([name, loc]) => {
      islandTotals[idx] += loc;
      (playerIsland[name] = playerIsland[name] || [0, 0])[idx] += loc;
    });
  });

  let empireSplit = islandTotals.map((t) =>
    totalLines > 0 ? (t / totalLines) * 100 : 0
  );
  if (island0El) {
    island0El.textContent = `${REPO_ISLANDS[0].short} ${empireSplit[0].toFixed(0)}%`;
  }
  if (island1El && REPO_ISLANDS[1]) {
    island1El.textContent = `${REPO_ISLANDS[1].short} ${empireSplit[1].toFixed(0)}%`;
  }

  let ranked = [];
  if (isPeriodic && periodStats) {
    const finalTotal = periodStats.finalTotal;
    const names = new Set([
      ...Object.keys(periodStats.currentByPlayer),
      ...Object.keys(periodStats.finalByPlayer),
    ]);

    ranked = Array.from(names)
      .map((name) => {
        const currentLoc = periodStats.currentByPlayer[name] || 0;
        const finalLoc = periodStats.finalByPlayer[name] || 0;
        const pct = finalTotal > 0 ? (finalLoc / finalTotal) * 100 : 0;
        const isl = playerIsland[name] || [0, 0];
        const feShare =
          islandTotals[0] > 0 ? (isl[0] / islandTotals[0]) * 100 : 0;
        const beShare =
          islandTotals[1] > 0 ? (isl[1] / islandTotals[1]) * 100 : 0;

        return {
          name,
          currentLoc,
          finalLoc,
          loc: currentLoc,
          tier: computePlayerTier(currentLoc, name),
          pct,
          feShare,
          beShare,
        };
      })
      .filter((p) => p.currentLoc > 0 || p.finalLoc > 0)
      .sort((a, b) => b.currentLoc - a.currentLoc || b.finalLoc - a.finalLoc);
  } else {
    ranked = Object.entries(scores)
      .map(([name, loc]) => {
        let pct = totalLines > 0 ? (loc / totalLines) * 100 : 0;
        let isl = playerIsland[name] || [0, 0];
        let feShare =
          islandTotals[0] > 0 ? (isl[0] / islandTotals[0]) * 100 : 0;
        let beShare =
          islandTotals[1] > 0 ? (isl[1] / islandTotals[1]) * 100 : 0;
        return {
          name,
          loc,
          tier: computePlayerTier(loc, name),
          pct,
          feShare,
          beShare,
          currentLoc: loc,
          finalLoc: loc,
        };
      })
      .filter((p) => p.loc > 0)
      .sort((a, b) => b.loc - a.loc);
  }

  // Update mobile drawer summary bar
  if (drawerTitleEl && drawerMetaEl) {
    const topLeader =
      ranked.length > 0
        ? `🥇 ${displayName(ranked[0].name)} (${Math.round(ranked[0].loc).toLocaleString()})`
        : isPeriodic && periodStats
          ? periodStats.label
          : "TOTAL EMPIRE";
    drawerTitleEl.textContent = topLeader;
    drawerMetaEl.textContent = `${Math.round(totalLines).toLocaleString()} LOC · ${isDrawerOpen ? "Hide ▼" : "Ranks ▲"}`;
  }

  if (ranked.length === 0) {
    listEl.innerHTML = `<div class="lb-empty">No territory conquered yet.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  ranked.forEach((player, idx) => {
    const prof = PLAYER_PROFILES[player.name] ||
      PLAYER_PROFILES["Others"] || { color: "#8a97ad", short: "OT" };
    const rData = RANKS[player.tier] || RANKS[0];
    const row = document.createElement("div");
    row.className = "lb-row";
    row.setAttribute("role", "listitem");
    row.style.setProperty("--player-color", prof.color);

    const avatarDiv = document.createElement("div");
    avatarDiv.className = "lb-avatar";
    const loadedAvatar = avatarImages[player.name];
    if (loadedAvatar && loadedAvatar.src) {
      const imgEl = document.createElement("img");
      imgEl.src = loadedAvatar.src;
      imgEl.alt = displayName(player.name);
      avatarDiv.appendChild(imgEl);
    } else {
      avatarDiv.textContent = prof.short || "OT";
    }

    const mainDiv = document.createElement("div");
    mainDiv.className = "lb-main";

    const nameDiv = document.createElement("div");
    nameDiv.className = "lb-name";
    nameDiv.textContent = `${idx + 1}. ${displayName(player.name)}`;

    const rankDiv = document.createElement("div");
    rankDiv.className = "lb-rank";
    rankDiv.textContent = `${rData.icon} ${rData.name}`;

    const sharesDiv = document.createElement("div");
    sharesDiv.className = "lb-shares";
    const feSpan = document.createElement("span");
    feSpan.className = "lb-island-fe";
    feSpan.textContent = `${REPO_ISLANDS[0].short} ${player.feShare.toFixed(0)}%`;
    sharesDiv.appendChild(feSpan);
    if (REPO_ISLANDS[1]) {
      const beSpan = document.createElement("span");
      beSpan.className = "lb-island-be";
      beSpan.textContent = `${REPO_ISLANDS[1].short} ${player.beShare.toFixed(0)}%`;
      sharesDiv.appendChild(beSpan);
    }

    mainDiv.appendChild(nameDiv);
    mainDiv.appendChild(rankDiv);
    mainDiv.appendChild(sharesDiv);

    const rightDiv = document.createElement("div");
    rightDiv.className = "lb-right";

    const locDiv = document.createElement("div");
    locDiv.className = "lb-loc";
    const pctDiv = document.createElement("div");
    pctDiv.className = "lb-pct";

    if (isPeriodic) {
      locDiv.textContent = `${Math.round(player.currentLoc).toLocaleString()} / ${Math.round(player.finalLoc).toLocaleString()}`;
      pctDiv.textContent = `${player.pct.toFixed(1)}% of period`;
    } else {
      locDiv.textContent = `${Math.round(player.loc).toLocaleString()}`;
      pctDiv.textContent = `${player.pct.toFixed(1)}%`;
    }

    rightDiv.appendChild(locDiv);
    rightDiv.appendChild(pctDiv);

    row.appendChild(avatarDiv);
    row.appendChild(mainDiv);
    row.appendChild(rightDiv);
    fragment.appendChild(row);
  });

  listEl.replaceChildren(fragment);
}

function drawDebugOverlay() {
  const x = viewWidth - 220;
  const y = 76;
  ctx.save();
  ctx.fillStyle = "rgba(6, 10, 18, 0.85)";
  ctx.strokeStyle = "rgba(74, 168, 255, 0.45)";
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, 200, 86);
  ctx.strokeRect(x, y, 200, 86);

  ctx.fillStyle = "#eaf1fb";
  ctx.font = "600 11px monospace";
  ctx.textAlign = "left";
  ctx.fillText(
    `FPS: ${fpsSmoothed.toFixed(1)} (${frameTimeSmoothed.toFixed(1)}ms)`,
    x + 10,
    y + 18
  );
  ctx.fillText(
    `World builds: ${worldStats.builds} (hits: ${worldStats.hits})`,
    x + 10,
    y + 34
  );
  ctx.fillText(
    `Last build: ${worldStats.lastBuildMs.toFixed(2)}ms`,
    x + 10,
    y + 50
  );
  ctx.fillText(
    `FX: txt=${floatingTexts.length} prj=${liveProjectiles.length} bls=${impactBlasts.length}`,
    x + 10,
    y + 66
  );
  ctx.restore();
}
