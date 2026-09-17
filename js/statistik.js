/* Global statistics page — data comes from Google Apps Script / Google Sheets. */
(function () {
  "use strict";
  function qs(sel) { return document.querySelector(sel); }
  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function formatNumber(n) { return new Intl.NumberFormat("id-ID").format(n); }
  function animateNumber(el, target, opts) {
    opts = opts || {}; var suffix = opts.suffix || "";
    if (target === null || target === undefined) { el.textContent = "—"; return; }
    if (prefersReducedMotion || target === 0) { el.textContent = formatNumber(target) + suffix; return; }
    var duration = 900, start = null;
    function tick(now) {
      if (start === null) start = now;
      var p = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - p, 3);
      el.textContent = formatNumber(Math.round(target * eased)) + suffix;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = formatNumber(target) + suffix;
    }
    requestAnimationFrame(tick);
  }
  document.addEventListener("DOMContentLoaded", async function () {
    if (!window.UnduhinStats) return;
    var stats = await window.UnduhinStats.getStats();
    var els = [qs("#statProcessed"), qs("#statUsers"), qs("#statVisits")];
    if (els[0]) animateNumber(els[0], stats.processed);
    if (els[1]) animateNumber(els[1], stats.users);
    if (els[2]) animateNumber(els[2], stats.visits);
    if (qs("#statSuccessRate")) {
      var rate = stats.successRate === null ? null : Math.round(stats.successRate);
      animateNumber(qs("#statSuccessRate"), rate, { suffix: rate === null ? "" : "%" });
    }
    var note = qs(".stat-note");
    if (note) note.textContent = stats.error
      ? "Backend belum terhubung. Isi URL Web App Google Apps Script pada js/backend.js."
      : "Statistik di halaman ini berasal dari seluruh akses yang tercatat oleh backend Google Apps Script dan disimpan terpusat di Google Sheets.";
  });
})();
