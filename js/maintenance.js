/* ==========================================================================
   MAINTENANCE MODE — overlay situs publik
   --------------------------------------------------------------------------
   Dipasang di index.html / faq.html / statistik.html (BUKAN admin.html,
   admin panel harus tetap bisa diakses saat maintenance aktif).

   Mengambil status maintenance dari backend (action "publicConfig", tidak
   butuh token) lalu menampilkan overlay penuh layar bila aktif. Pesan
   maintenance diambil langsung dari backend (diatur admin), bukan hardcode.

   FAIL-OPEN BY DESIGN: kalau backend belum terhubung atau request gagal,
   overlay TIDAK ditampilkan — situs tetap berjalan normal. Ini disengaja
   supaya masalah sementara pada backend admin tidak ikut menjatuhkan
   seluruh situs publik.
   ========================================================================== */
(function () {
  "use strict";

  function buildOverlay(message) {
    var overlay = document.createElement("div");
    overlay.id = "maintenanceOverlay";
    overlay.setAttribute("role", "alert");
    overlay.innerHTML =
      '<div class="maint-card">' +
        '<span class="maint-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>' +
        "</span>" +
        "<strong>UNDUHIN</strong>" +
        "<p>Sedang dalam pemeliharaan</p>" +
        '<span class="maint-message"></span>' +
        '<button type="button" class="maint-retry">Coba Lagi</button>' +
      "</div>";
    overlay.querySelector(".maint-message").textContent = message;
    overlay.querySelector(".maint-retry").addEventListener("click", function () {
      window.location.reload();
    });
    return overlay;
  }

  function showMaintenance(message) {
    if (document.getElementById("maintenanceOverlay")) return;
    document.documentElement.classList.add("is-maintenance-locked");
    document.body.appendChild(buildOverlay(message));
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!(window.UnduhinBackend && window.UnduhinBackend.isConfigured())) return;
    window.UnduhinBackend.request({ action: "publicConfig" })
      .then(function (res) {
        if (res && res.ok && res.maintenance && res.maintenance.enabled) {
          showMaintenance(res.maintenance.message || "Unduhin sedang dalam pemeliharaan.");
        }
      })
      .catch(function () {
        // fail-open — lihat catatan di atas
      });
  });
})();
