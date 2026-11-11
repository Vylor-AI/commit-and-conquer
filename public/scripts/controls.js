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

  recomputeWorldView();
  updateControlsUI();
}

window.addEventListener("resize", () => {
  resizeCanvas();
  if (historyTimeline.length > 0) {
    precomputeCamera(getRepoScoresAtFrame(historyTimeline.length - 1));
    if (followCam) centerOnFrame(currentFrameIndex);
  }
});

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
  updateControlsUI();

  if (window.CNCAnalytics && typeof window.CNCAnalytics.track === "function") {
    const speedSelect = document.getElementById("speed-select");
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
  updateControlsUI();
});

modeTotalBtn.addEventListener("click", () => setScoreMode("total"));
modeMonthlyBtn.addEventListener("click", () => setScoreMode("monthly"));
modeQuarterlyBtn.addEventListener("click", () => setScoreMode("quarterly"));
applyModeButtonState();
