(function () {
  const AMPLITUDE_API_KEY = window.AMPLITUDE_API_KEY || "";

  let isInitialized = false;

  function loadAmplitudeSDK() {
    return new Promise((resolve, reject) => {
      if (window.amplitude) {
        resolve(window.amplitude);
        return;
      }

      // Standard Amplitude snippet initialization loader
      (function (e, t) {
        var n = e.amplitude || { _q: [], _iq: {} };
        var r = t.createElement("script");
        r.type = "text/javascript";
        r.async = true;
        r.src =
          "https://cdn.amplitude.com/libs/analytics-browser-2.11.0-min.js.gz";
        r.onload = function () {
          if (!e.amplitude.runQueuedFunctions) {
            console.warn("Amplitude failed to initialize.");
          }
          resolve(e.amplitude);
        };
        r.onerror = function (err) {
          reject(err);
        };
        var s = t.getElementsByTagName("script")[0];
        s.parentNode.insertBefore(r, s);

        function i(e, t) {
          e.prototype[t] = function () {
            this._q.push([t, Array.prototype.slice.call(arguments, 0)]);
            return this;
          };
        }

        var o = function () {
          this._q = [];
          return this;
        };

        var a = [
          "add",
          "append",
          "clearAll",
          "prepend",
          "set",
          "setOnce",
          "unset",
          "preInsert",
          "postInsert",
          "remove",
        ];

        for (var c = 0; c < a.length; c++) {
          i(o, a[c]);
        }
        n.Identify = o;

        var u = function () {
          this._q = [];
          return this;
        };

        var l = [
          "getEventProperties",
          "setProductId",
          "setQuantity",
          "setPrice",
          "setRevenue",
          "setRevenueType",
          "setEventProperties",
        ];

        for (var p = 0; p < l.length; p++) {
          i(u, l[p]);
        }
        n.Revenue = u;

        var d = [
          "init",
          "add",
          "remove",
          "track",
          "reset",
          "setUserId",
          "setDeviceId",
          "postInsert",
          "getDeviceId",
          "getUserId",
          "setMinIdLength",
          "setOptOut",
          "setVersionName",
          "setDomain",
          "setLanguage",
          "setPlatform",
          "setGroup",
        ];

        function s1(e, t) {
          e[t] = function () {
            e._q.push([t, Array.prototype.slice.call(arguments, 0)]);
          };
        }

        for (var v = 0; v < d.length; v++) {
          s1(n, d[v]);
        }
        e.amplitude = n;
      })(window, document);
    });
  }

  async function init() {
    if (!AMPLITUDE_API_KEY) {
      console.info(
        "[Analytics] Amplitude API Key is empty. Tracking will run in stub/silent mode."
      );
      return;
    }

    try {
      await loadAmplitudeSDK();
      window.amplitude.init(AMPLITUDE_API_KEY, undefined, {
        defaultTracking: false,
      });
      isInitialized = true;
    } catch (err) {
      console.warn("[Analytics] Failed to load Amplitude SDK:", err);
    }
  }

  function track(eventName, properties) {
    const payload = properties || {};
    if (AMPLITUDE_API_KEY && window.amplitude && typeof window.amplitude.track === "function") {
      try {
        window.amplitude.track(eventName, payload);
      } catch (err) {
        console.warn("[Analytics] Track error:", err);
      }
    } else {
      // Stub logging in debug mode or when API key not configured yet
      console.debug(`[Analytics Event] ${eventName}`, payload);
    }
  }

  // Auto initialize on load
  init();

  window.CNCAnalytics = {
    track: track,
    isInitialized: function () {
      return isInitialized;
    },
  };
})();
