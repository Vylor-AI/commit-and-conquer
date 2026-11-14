function applyModeButtonState() {
  modeTotalBtn.classList.toggle("active", scoreMode === "total");
  modeMonthlyBtn.classList.toggle("active", scoreMode === "monthly");
  modeQuarterlyBtn.classList.toggle("active", scoreMode === "quarterly");
}

function setScoreMode(mode) {
  if (mode !== "total" && mode !== "monthly" && mode !== "quarterly") return;
  if (scoreMode === mode) return;

  const fromMode = scoreMode;
  scoreMode = mode;
  applyModeButtonState();

  if (window.CNCAnalytics && typeof window.CNCAnalytics.track === "function") {
    window.CNCAnalytics.track("score_mode_changed", {
      from_mode: fromMode,
      to_mode: mode,
    });
  }

  liveProjectiles = [];
  impactBlasts = [];
  floatingTexts = [];
  frameAccumulator = 0;
  roundPauseUntil = 0;
  roundBanner = null;
  followCam = true;

  recomputeWorldView();
  updateControlsUI(true);
}

window.addEventListener("resize", () => {
  resizeCanvas();
  if (historyTimeline.length > 0) {
    precomputeCamera(getRepoScoresAtFrame(historyTimeline.length - 1));
    if (followCam) centerOnFrame(currentFrameIndex);
  }
});

// --- MOUSE PAN & ZOOM ---
canvas.addEventListener("mousedown", (e) => {
  if (e.clientX < SB_WIDTH) return;
  isDragging = true;
  followCam = false;
  dragStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  pan.x = e.clientX - dragStart.x;
  pan.y = e.clientY - dragStart.y;
});

window.addEventListener("mouseup", () => {
  isDragging = false;
});

canvas.addEventListener("dblclick", (e) => {
  if (e.clientX < SB_WIDTH) return;
  followCam = true;
  if (historyTimeline.length > 0) {
    centerOnFrame(currentFrameIndex);
  }
});

canvas.addEventListener(
  "wheel",
  (e) => {
    if (e.clientX < SB_WIDTH) return;
    e.preventDefault();
    let factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    linesPerBlock = Math.max(LPB_MIN, Math.min(LPB_MAX, linesPerBlock * factor));
    zoomHud.textContent = `1 BLOCK = ${Math.round(linesPerBlock)} LOC`;
  },
  { passive: false }
);

// --- TOUCH PAN, PINCH-ZOOM & DOUBLE-TAP ---
let touchMode = "none"; // "pan" | "pinch"
let pinchStartDist = 0;
let pinchStartLPB = 100;
let pinchLastMid = { x: 0, y: 0 };
let lastTapTime = 0;

function getTouchDistance(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}

function getTouchMidpoint(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

canvas.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      if (t.clientX < SB_WIDTH) return;
      e.preventDefault();

      const now = performance.now();
      if (now - lastTapTime < 280) {
        followCam = true;
        if (historyTimeline.length > 0) {
          centerOnFrame(currentFrameIndex);
        }
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;

      touchMode = "pan";
      followCam = false;
      dragStart = { x: t.clientX - pan.x, y: t.clientY - pan.y };
    } else if (e.touches.length === 2) {
      e.preventDefault();
      touchMode = "pinch";
      followCam = false;
      pinchStartDist = Math.max(10, getTouchDistance(e.touches[0], e.touches[1]));
      pinchStartLPB = linesPerBlock;
      pinchLastMid = getTouchMidpoint(e.touches[0], e.touches[1]);
    }
  },
  { passive: false }
);

canvas.addEventListener(
  "touchmove",
  (e) => {
    if (touchMode === "pan" && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      pan.x = t.clientX - dragStart.x;
      pan.y = t.clientY - dragStart.y;
    } else if (touchMode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const dist = Math.max(10, getTouchDistance(e.touches[0], e.touches[1]));
      const ratio = pinchStartDist / dist; // pinch out (dist > start) -> smaller linesPerBlock (more blocks)
      linesPerBlock = Math.max(
        LPB_MIN,
        Math.min(LPB_MAX, pinchStartLPB * ratio)
      );
      zoomHud.textContent = `1 BLOCK = ${Math.round(linesPerBlock)} LOC`;

      const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
      pan.x += mid.x - pinchLastMid.x;
      pan.y += mid.y - pinchLastMid.y;
      pinchLastMid = mid;
    }
  },
  { passive: false }
);

canvas.addEventListener("touchend", (e) => {
  if (e.touches.length === 0) {
    touchMode = "none";
  } else if (e.touches.length === 1) {
    const t = e.touches[0];
    touchMode = "pan";
    dragStart = { x: t.clientX - pan.x, y: t.clientY - pan.y };
  }
});

canvas.addEventListener("touchcancel", () => {
  touchMode = "none";
});

// --- MOBILE LEADERBOARD DRAWER TOGGLE ---
const drawerToggleBtn = document.getElementById("leaderboard-drawer-toggle");
const leaderboardPanelEl = document.getElementById("leaderboard-panel");

if (drawerToggleBtn && leaderboardPanelEl) {
  drawerToggleBtn.addEventListener("click", () => {
    const isOpen = leaderboardPanelEl.classList.toggle("drawer-open");
    drawerToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    lastLeaderboardRenderKey = "";
  });
}

// --- PLAYBACK & TIMELINE CONTROLS ---
playBtn.addEventListener("click", () => {
  if (currentFrameIndex >= historyTimeline.length - 1) {
    currentFrameIndex = 0;
    liveProjectiles = [];
    floatingTexts = [];
    roundPauseUntil = 0;
    roundBanner = null;
    isPlaying = true;
  } else {
    isPlaying = !isPlaying;
  }
  updateControlsUI(true);

  if (window.CNCAnalytics && typeof window.CNCAnalytics.track === "function") {
    const speed = speedSelect ? parseFloat(speedSelect.value) : 1;
    if (isPlaying) {
      window.CNCAnalytics.track("playback_play", {
        frame_index: currentFrameIndex,
        total_frames: historyTimeline.length,
        speed: speed,
      });
    } else {
      window.CNCAnalytics.track("playback_pause", {
        frame_index: currentFrameIndex,
        total_frames: historyTimeline.length,
      });
    }
  }
});

slider.addEventListener("input", (e) => {
  currentFrameIndex = parseInt(e.target.value, 10);
  frameAccumulator = 0;
  roundPauseUntil = 0;
  roundBanner = null;
  updateControlsUI(true);
});

modeTotalBtn.addEventListener("click", () => setScoreMode("total"));
modeMonthlyBtn.addEventListener("click", () => setScoreMode("monthly"));
modeQuarterlyBtn.addEventListener("click", () => setScoreMode("quarterly"));
applyModeButtonState();
