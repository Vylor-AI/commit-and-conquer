(function () {
  const INTRO_STORAGE_KEY = "c2c_intro_seen_v1";

  const panel = document.getElementById("onboarding-panel");
  const playIntroBtn = document.getElementById("onboarding-play-btn");
  const infoBtn = document.getElementById("onboarding-info-btn");
  const timelinePlayBtn = document.getElementById("play-pause-btn");

  if (!panel || !playIntroBtn || !infoBtn || !timelinePlayBtn) return;

  function isTimelinePlaying() {
    return timelinePlayBtn.textContent.trim().toLowerCase() === "pause";
  }

  function pauseTimelineIfPlaying() {
    if (isTimelinePlaying()) {
      timelinePlayBtn.click();
    }
  }

  function resumeTimelineIfPaused() {
    if (!isTimelinePlaying()) {
      timelinePlayBtn.click();
    }
  }

  function showPanel() {
    panel.classList.remove("hidden");
    infoBtn.classList.add("hidden");
  }

  function hidePanel() {
    panel.classList.add("hidden");
    infoBtn.classList.remove("hidden");
  }

  const hasSeenIntro = localStorage.getItem(INTRO_STORAGE_KEY) === "1";

  if (!hasSeenIntro) {
    pauseTimelineIfPlaying();
    showPanel();
  } else {
    hidePanel();
  }

  playIntroBtn.addEventListener("click", function () {
    localStorage.setItem(INTRO_STORAGE_KEY, "1");
    hidePanel();
    resumeTimelineIfPaused();
    if (window.CNCAnalytics && typeof window.CNCAnalytics.track === "function") {
      window.CNCAnalytics.track("onboarding_completed");
    }
  });

  infoBtn.addEventListener("click", function () {
    showPanel();
  });
})();
