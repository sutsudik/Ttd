/* Central statistics client. Data is recorded by Google Apps Script + Google Sheets. */
(function (global) {
  "use strict";

  function backend() { return global.UnduhinBackend; }

  function send(action, extra) {
    var b = backend();
    if (!b || !b.isConfigured()) return Promise.resolve(null);
    return b.fire(Object.assign({ action: action, page: location.pathname }, extra || {}));
  }

  function recordVisit() { return send("visit"); }
  function recordSessionOnce() {
    try {
      if (sessionStorage.getItem("unduhin_session_counted_v2")) return Promise.resolve(null);
      sessionStorage.setItem("unduhin_session_counted_v2", "1");
    } catch (e) {}
    return send("session");
  }
  function recordAttempt() { return send("attempt"); }
  function recordSuccess() { return send("success"); }
  function recordDownload(format) { return send("download", { format: format || "unknown" }); }

  /* Backward-compatible shape for script.js. getStats() now fetches global data. */
  async function getStats() {
    var b = backend();
    if (!b || !b.isConfigured()) return { processed: 0, users: 0, visits: 0, successRate: null };
    try {
      var result = await b.request({ action: "stats" });
      var s = result && result.stats ? result.stats : {};
      return {
        processed: Number(s.success) || 0,
        users: Number(s.uniqueUsers) || 0,
        visits: Number(s.visits) || 0,
        successRate: s.attempts ? ((Number(s.success) || 0) / Number(s.attempts)) * 100 : null,
        attempts: Number(s.attempts) || 0
      };
    } catch (e) {
      return { processed: 0, users: 0, visits: 0, successRate: null, attempts: 0, error: true };
    }
  }

  global.UnduhinStats = {
    recordVisit: recordVisit,
    recordSessionOnce: recordSessionOnce,
    recordAttempt: recordAttempt,
    recordSuccess: recordSuccess,
    recordDownload: recordDownload,
    getStats: getStats
  };

  recordVisit();
  recordSessionOnce();
})(window);
