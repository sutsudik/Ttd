/* ==========================================================================
   Sidebar navigasi — dipakai bersama di semua halaman (index, statistik, faq)
   Menu: Statistik (halaman terpisah), Cara Penggunaan (tutup + smooth-scroll
   ke section yang sudah ada), FAQ (halaman terpisah).
   ========================================================================== */
(function () {
  "use strict";

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FOCUSABLE = "a[href], button:not([disabled])";

  function scrollToHowto(target) {
    target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var menuBtn = qs("#menuBtn");
    var sidebar = qs("#sidebar");
    var overlay = qs("#sidebarOverlay");
    var closeBtn = qs("#sidebarClose");
    if (!menuBtn || !sidebar || !overlay) return;

    var lastFocused = null;
    var closeTimer = null;

    function onKeydown(e) {
      if (e.key === "Escape") {
        closeSidebar();
        return;
      }
      if (e.key === "Tab") {
        var focusables = qsa(FOCUSABLE, sidebar);
        if (!focusables.length) return;
        var firstEl = focusables[0];
        var lastEl = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }

    function openSidebar() {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      lastFocused = document.activeElement;
      overlay.hidden = false;
      // dua-rAF supaya transisi opacity/transform sempat jalan (elemen baru saja display:block)
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          sidebar.classList.add("is-open");
          overlay.classList.add("is-open");
        });
      });
      sidebar.setAttribute("aria-hidden", "false");
      menuBtn.setAttribute("aria-expanded", "true");
      document.documentElement.classList.add("no-scroll");
      document.addEventListener("keydown", onKeydown);
      var first = qs(FOCUSABLE, sidebar);
      if (first) first.focus();
    }

    function closeSidebar() {
      sidebar.classList.remove("is-open");
      overlay.classList.remove("is-open");
      sidebar.setAttribute("aria-hidden", "true");
      menuBtn.setAttribute("aria-expanded", "false");
      document.documentElement.classList.remove("no-scroll");
      document.removeEventListener("keydown", onKeydown);
      closeTimer = setTimeout(function () { overlay.hidden = true; }, 320);
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    }

    menuBtn.addEventListener("click", function () {
      if (sidebar.classList.contains("is-open")) closeSidebar();
      else openSidebar();
    });
    overlay.addEventListener("click", closeSidebar);
    if (closeBtn) closeBtn.addEventListener("click", closeSidebar);

    // Tandai link halaman yang sedang aktif (bukan link anchor seperti
    // "Cara Penggunaan"), dan hindari reload kalau menu diklik lagi di
    // halaman yang sama.
    var currentFile = location.pathname.split("/").pop() || "index.html";
    qsa(".sidebar-link[href]", sidebar).forEach(function (link) {
      if (link.hash) return;
      var hrefFile = link.getAttribute("href").split("#")[0];
      if (hrefFile && hrefFile === currentFile) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
        link.addEventListener("click", function (e) {
          e.preventDefault();
          closeSidebar();
        });
      }
    });

    // "Cara Penggunaan": kalau section #howto ada di halaman ini (index.html),
    // tutup sidebar dulu lalu smooth-scroll ke sana. Kalau tidak ada (mis. di
    // statistik.html/faq.html), biarkan link menuju index.html#howto seperti biasa.
    var howtoLink = qs('[data-nav="howto"]', sidebar);
    if (howtoLink) {
      howtoLink.addEventListener("click", function (e) {
        var target = document.getElementById("howto");
        if (target) {
          e.preventDefault();
          closeSidebar();
          setTimeout(function () { scrollToHowto(target); }, 300);
        } else {
          closeSidebar();
        }
      });
    }
  });

  // Kalau baru tiba di halaman ini lewat "...#howto" dari halaman lain,
  // tetap scroll halus ke section-nya (bukan lompatan instan bawaan browser).
  window.addEventListener("load", function () {
    if (location.hash === "#howto") {
      var target = document.getElementById("howto");
      if (target) setTimeout(function () { scrollToHowto(target); }, 50);
    }
  });
})();
