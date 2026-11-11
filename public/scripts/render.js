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

  const keys = Object.keys(model.finalTotalsByKey).sort();
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

  const boxW = Math.min(720, canvas.width - 120);
  const boxH = 240;
  const x = (canvas.width - boxW) / 2;
  const y = (canvas.height - boxH) / 2;

  ctx.save();
  ctx.fillStyle = "rgba(4, 8, 14, 0.76)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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
  ctx.font = "800 28px Inter, sans-serif";
  ctx.fillText(roundBanner.title || "ROUND COMPLETE", x + boxW / 2, y + 54);

  ctx.fillStyle = "#8a97ad";
  ctx.font = "600 15px Inter, sans-serif";
  ctx.fillText(roundBanner.subtitle || "", x + boxW / 2, y + 82);

  const medals = ["🥇", "🥈", "🥉"];
  const winners = roundBanner.winners || [];
  winners.forEach((w, i) => {
    ctx.fillStyle = "#eaf1fb";
    ctx.font = "700 20px Inter, sans-serif";
    const rowY = y + 126 + i * 34;
    ctx.fillText(
      `${medals[i] || "•"}  ${displayName(w.name)}  ·  ${Math.round(w.loc).toLocaleString()} LOC`,
      x + boxW / 2,
      rowY
    );
  });

  if (winners.length === 0) {
    ctx.fillStyle = "#8a97ad";
    ctx.font = "600 16px Inter, sans-serif";
    ctx.fillText("No ranked players for this round.", x + boxW / 2, y + 146);
  }

  ctx.restore();
}

function drawSimulation() {
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (historyTimeline.length === 0) return;

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
    const viewW = canvas.width - SB_WIDTH;
    const viewH = canvas.height;
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
  ctx.rect(SB_WIDTH, 0, canvas.width - SB_WIDTH, canvas.height);
  ctx.clip();

  let c0 = Math.floor((SB_WIDTH - mapOffsetX) / cellPx) - 1;
  let c1 = Math.ceil((canvas.width - mapOffsetX) / cellPx) + 1;
  let r0 = Math.floor((0 - mapOffsetY) / cellPx) - 1;
  let r1 = Math.ceil((canvas.height - mapOffsetY) / cellPx) + 1;

  if ((c1 - c0) * (r1 - r0) < 40000) {
    ctx.strokeStyle = PALETTE.waterGrid;
    ctx.lineWidth = 1;
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        ctx.strokeRect(sx(c), sy(r), cellPx, cellPx);
      }
    }
  }

  if (periodStats && periodStats.previousFinalRepoScores) {
    const ghostWorld = buildWorld(periodStats.previousFinalRepoScores);
    const ghostInset = (cellPx - (BLOCK / CELL) * cellPx) / 2;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ghostWorld.owner.forEach((name, k) => {
      const [r, c] = k.split(",").map(Number);
      ctx.fillStyle = PLAYER_PROFILES[name]?.color || "#8a97ad";
      ctx.fillRect(
        sx(c) + ghostInset,
        sy(r) + ghostInset,
        cellPx - ghostInset * 2,
        cellPx - ghostInset * 2
      );
    });
    ctx.restore();
  }

  ctx.fillStyle = "rgba(234,241,251,0.32)";
  ctx.font = "700 15px Inter, sans-serif";
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

  world.beach.forEach((k) => {
    let [r, c] = k.split(",").map(Number);
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(sx(c), sy(r), cellPx, cellPx);
  });

  const afkNow = new Set(Object.keys(afkByPlayer).filter((n) => isAfk(n)));
  let inset = (cellPx - (BLOCK / CELL) * cellPx) / 2;
  world.owner.forEach((name, k) => {
    let [r, c] = k.split(",").map(Number);
    ctx.globalAlpha = afkNow.has(name) ? 0.3 : 1;
    ctx.fillStyle = PLAYER_PROFILES[name]?.color || "#fff";
    ctx.fillRect(
      sx(c) + inset,
      sy(r) + inset,
      cellPx - inset * 2,
      cellPx - inset * 2
    );
  });
  ctx.globalAlpha = 1;

  liveProjectiles.forEach((p) => {
    let x = sx(p.sc + (p.tc - p.sc) * p.pct) + cellPx / 2;
    let y = sy(p.sr + (p.tr - p.sr) * p.pct) + cellPx / 2;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  impactBlasts.forEach((b) => {
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
  });

  world.centroids.forEach((ctr) => {
    let name = ctr.name;
    let prof = PLAYER_PROFILES[name] || PLAYER_PROFILES["Others"];
    let img = avatarImages[name] || avatarImages["Others"];
    const avSize = 30;
    const radius = avSize / 2;
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
      ctx.font = "700 12px Inter, sans-serif";
      const prevAlign = ctx.textAlign;
      const prevBase = ctx.textBaseline;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(prof.short, cx, cy + 1);
      ctx.textAlign = prevAlign;
      ctx.textBaseline = prevBase;
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  });

  floatingTexts.forEach((t) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, t.life * 1.6));
    ctx.font = "800 18px Inter, sans-serif";
    ctx.textAlign = "center";
    let px = sx(t.c) + cellPx / 2;
    let py = sy(t.r) + cellPx / 2 - 22 + t.yOffset;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(t.text, px, py);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, px, py);
    ctx.restore();
  });

  ctx.textAlign = "left";
  ctx.restore();

  drawEventFeed();
  drawSidebar(scores, totalLines, currentStep, frameRepoScores, periodStats);
  drawRoundBannerOverlay();
}

function drawEventFeed() {
  let shown = gameEvents.filter((e) => e.frame <= currentFrameIndex);
  if (shown.length === 0) return;
  shown = shown.slice(-6);

  const padX = 14;
  const padY = 12;
  const lineH = 22;
  const x = SB_WIDTH + 22;
  const y = 22;
  let width = 320;
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

  ctx.font = "700 11px Inter, sans-serif";
  ctx.fillStyle = "rgba(234,241,251,0.5)";
  ctx.fillText("BATTLE LOG", x + padX, y + padY + 2);

  ctx.font = "600 14px Inter, sans-serif";
  shown.forEach((e, i) => {
    let age = shown.length - 1 - i;
    ctx.globalAlpha = Math.max(0.45, 1 - age * 0.12);
    ctx.fillStyle = e.color;
    ctx.fillText("›", x + padX, y + padY + 22 + i * lineH);
    ctx.fillStyle = "#eaf1fb";
    ctx.fillText(e.text, x + padX + 16, y + padY + 22 + i * lineH);
  });
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawSidebar(
  scores,
  totalLines,
  currentStep,
  frameRepoScores,
  periodStats
) {
  const isPeriodic = scoreMode === "monthly" || scoreMode === "quarterly";

  ctx.fillStyle = PALETTE.sidebarBg;
  ctx.fillRect(0, 0, SB_WIDTH, canvas.height);
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SB_WIDTH, 0);
  ctx.lineTo(SB_WIDTH, canvas.height);
  ctx.stroke();

  let y = 52;
  ctx.fillStyle = "#4aa8ff";
  ctx.font = "700 16px Inter, sans-serif";
  let modeTitle = "";
  if (scoreMode === "monthly") modeTitle = "MONTHLY CONQUERED";
  if (scoreMode === "quarterly") modeTitle = "QUARTERLY CONQUERED";
  ctx.fillText(modeTitle, 32, y);

  y += 24;
  ctx.fillStyle = PALETTE.textDim;
  ctx.font = "600 14px Inter, sans-serif";
  if (isPeriodic && periodStats) {
    ctx.fillText(
      `${periodStats.label} · Current ${Math.round(periodStats.currentTotal).toLocaleString()} LOC · Total ${Math.round(periodStats.finalTotal).toLocaleString()} LOC`,
      32,
      y
    );
    y += 20;

    const g = periodStats.growth;
    ctx.font = "600 12px Inter, sans-serif";
    if (
      g &&
      typeof g.growthPct === "number" &&
      typeof g.ratioPct === "number"
    ) {
      const sign = g.growthPct >= 0 ? "+" : "";
      ctx.fillStyle = "#7fd3c0";
      ctx.fillText(
        `${sign}${g.growthPct.toFixed(0)}% vs trailing 3-period avg (${Math.round(g.baselineAvg).toLocaleString()} LOC)`,
        32,
        y
      );
      y += 18;
      ctx.fillStyle = "#f0a868";
      ctx.fillText(
        `${g.ratioPct.toFixed(0)}% of baseline (${g.ratioX.toFixed(1)}x)`,
        32,
        y
      );
      y += 14;
    } else {
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText("Growth baseline: need 3 prior full periods", 32, y);
      y += 14;
    }
  } else {
    ctx.fillText(
      `TOTAL EMPIRE · ${Math.round(totalLines).toLocaleString()} LOC`,
      32,
      y
    );
  }

  y += 20;

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
  ctx.font = "600 12px Inter, sans-serif";
  ctx.fillStyle = "#7fd3c0";
  ctx.fillText(`${REPO_ISLANDS[0].short} ${empireSplit[0].toFixed(0)}%`, 32, y);
  ctx.fillStyle = "#f0a868";
  ctx.fillText(
    `${REPO_ISLANDS[1].short} ${empireSplit[1].toFixed(0)}%`,
    140,
    y
  );

  y += 34;

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

        let lvl = 0;
        if (currentLoc > 1000) lvl = 1;
        if (currentLoc > 6000) lvl = 2;
        if (currentLoc > 15000) lvl = 3;
        let simTime = new Date(currentStep.date).getTime();
        if (
          (name === "Vylor" || name === "Vylor AI") &&
          simTime > new Date("2026-06-12").getTime()
        ) {
          lvl = 4;
        }

        return {
          name,
          currentLoc,
          finalLoc,
          loc: currentLoc,
          tier: lvl,
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
        let lvl = 0;
        if (loc > 1000) lvl = 1;
        if (loc > 6000) lvl = 2;
        if (loc > 15000) lvl = 3;
        let simTime = new Date(currentStep.date).getTime();
        if (
          (name === "Vylor" || name === "Vylor AI") &&
          simTime > new Date("2026-06-12").getTime()
        ) {
          lvl = 4;
        }
        let pct = totalLines > 0 ? (loc / totalLines) * 100 : 0;
        let isl = playerIsland[name] || [0, 0];
        let feShare =
          islandTotals[0] > 0 ? (isl[0] / islandTotals[0]) * 100 : 0;
        let beShare =
          islandTotals[1] > 0 ? (isl[1] / islandTotals[1]) * 100 : 0;
        return {
          name,
          loc,
          tier: lvl,
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

  let startY = y;
  let spacing = 62;

  ranked.forEach((player, idx) => {
    let targetY = startY + idx * spacing;
    if (!playerRankY[player.name]) playerRankY[player.name] = targetY;
    playerRankY[player.name] += (targetY - playerRankY[player.name]) * 0.15;
    let rY = playerRankY[player.name];
    if (rY > canvas.height - 40) return;

    let prof = PLAYER_PROFILES[player.name] || PLAYER_PROFILES["Others"];
    let rData = RANKS[player.tier] || RANKS[0];

    const avSize = 36;
    const avRadius = avSize / 2;
    const avX = 32;
    const avY = rY - 18;
    const avCx = avX + avRadius;
    const avCy = avY + avRadius;

    ctx.fillStyle = "#0a0f1a";
    ctx.beginPath();
    ctx.arc(avCx, avCy, avRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = prof.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(avCx, avCy, avRadius - 0.5, 0, Math.PI * 2);
    ctx.stroke();

    if (avatarImages[player.name]) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(avCx, avCy, avRadius - 1.5, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        avatarImages[player.name],
        avX + 1,
        avY + 1,
        avSize - 2,
        avSize - 2
      );
      ctx.restore();
    } else {
      ctx.fillStyle = prof.color;
      ctx.font = "700 13px Inter, sans-serif";
      const prevAlign = ctx.textAlign;
      const prevBase = ctx.textBaseline;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(prof.short, avCx, avCy + 1);
      ctx.textAlign = prevAlign;
      ctx.textBaseline = prevBase;
    }

    ctx.fillStyle = prof.color;
    ctx.font = "700 17px Inter, sans-serif";
    ctx.fillText(`${idx + 1}. ${displayName(player.name)}`, 82, rY - 4);

    ctx.fillStyle = PALETTE.textDim;
    ctx.font = "500 12px Inter, sans-serif";
    ctx.fillText(`${rData.icon} ${rData.name}`, 82, rY + 12);

    ctx.font = "600 11px Inter, sans-serif";
    ctx.fillStyle = "#7fd3c0";
    ctx.fillText(
      `${REPO_ISLANDS[0].short} ${player.feShare.toFixed(0)}%`,
      82,
      rY + 28
    );
    ctx.fillStyle = "#f0a868";
    ctx.fillText(
      `${REPO_ISLANDS[1].short} ${player.beShare.toFixed(0)}%`,
      176,
      rY + 28
    );

    ctx.fillStyle = PALETTE.textMain;
    ctx.font = "700 15px Inter, sans-serif";
    ctx.textAlign = "right";
    if (isPeriodic) {
      ctx.fillText(
        `${Math.round(player.currentLoc).toLocaleString()} / ${Math.round(player.finalLoc).toLocaleString()}`,
        SB_WIDTH - 32,
        rY - 4
      );
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = "600 12px Inter, sans-serif";
      ctx.fillText(
        `${player.pct.toFixed(1)}% of period`,
        SB_WIDTH - 32,
        rY + 12
      );
    } else {
      ctx.fillText(
        `${Math.round(player.loc).toLocaleString()}`,
        SB_WIDTH - 32,
        rY - 4
      );
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = "600 12px Inter, sans-serif";
      ctx.fillText(`${player.pct.toFixed(1)}%`, SB_WIDTH - 32, rY + 12);
    }
    ctx.textAlign = "left";
  });
}
