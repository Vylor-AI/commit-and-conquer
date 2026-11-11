function gameLoop() {
  updateSimulation();
  drawSimulation();
  requestAnimationFrame(gameLoop);
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (
        existing.getAttribute("data-loaded") === "1" ||
        typeof window.CNCShare !== "undefined"
      ) {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Failed to load script ${src}`)),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.addEventListener("load", () => {
      script.setAttribute("data-loaded", "1");
      resolve();
    });
    script.addEventListener("error", () => {
      reject(new Error(`Failed to load script ${src}`));
    });

    document.head.appendChild(script);
  });
}

async function bootstrap() {
  resizeCanvas();

  if (window.CNCAnalytics && typeof window.CNCAnalytics.track === "function") {
    window.CNCAnalytics.track("page_viewed", {
      referrer: document.referrer || "direct",
      url: window.location.href,
      path: window.location.pathname,
    });
  }

  try {
    await loadScriptOnce("scripts/share.js");
  } catch (error) {
    console.warn("Share module failed to load.", error);
  }

  if (typeof initializeHistoryFlow === "function") {
    const maybePromise = initializeHistoryFlow();
    if (maybePromise && typeof maybePromise.then === "function") {
      await maybePromise;
    }
  } else if (typeof initTimeline === "function") {
    const maybePromise = initTimeline();
    if (maybePromise && typeof maybePromise.then === "function") {
      await maybePromise;
    }
  }

  if (window.SettingsUI && typeof window.SettingsUI.initialize === "function") {
    window.SettingsUI.initialize();
  }

  if (window.CNCShare && typeof window.CNCShare.initializeShareButton === "function") {
    window.CNCShare.initializeShareButton();
  }

  gameLoop();
}

bootstrap();
