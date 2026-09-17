(function () {
  "use strict";

  /* ============================================================
     UTIL
     ============================================================ */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fmtNum(n) { return new Intl.NumberFormat("id-ID").format(Math.round(n || 0)); }
  function fmtCompact(n) {
    n = Number(n) || 0;
    if (n >= 1000) {
      var v = n / 1000;
      return (Math.round(v * 10) / 10).toString().replace(/\.0$/, "") + "K";
    }
    return String(Math.round(n));
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (e) { return "—"; }
  }
  function fmtDateTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleString("id-ID", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return "—"; }
  }
  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function animateCount(el, target) {
    if (!el) return;
    target = Number(target) || 0;
    if (prefersReducedMotion) { el.textContent = fmtNum(target); return; }
    var start = null, duration = 700;
    function tick(now) {
      if (start === null) start = now;
      var p = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtNum(target * eased);
      if (p < 1) requestAnimationFrame(tick); else el.textContent = fmtNum(target);
    }
    requestAnimationFrame(tick);
  }

  /* ============================================================
     STATE
     ============================================================ */
  var TOKEN_KEY = "unduhin_admin_token";
  var state = {
    route: "overview",
    period: "7d",
    activityFilter: "all",
    activityOffset: 0,
    activityLimit: 20,
    activityTotal: 0,
    activityLoading: false,
    theme: localStorage.getItem("unduhin_admin_theme") || "cream"
  };

  function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
  function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

  /* ============================================================
     BACKEND CALL
     ============================================================ */
  function call(action, extra) {
    if (!window.UnduhinBackend || !window.UnduhinBackend.isConfigured()) {
      return Promise.reject(new Error("BACKEND_NOT_CONFIGURED"));
    }
    var payload = Object.assign({ action: action, token: getToken() }, extra || {});
    return window.UnduhinBackend.request(payload).then(function (res) {
      if (!res || !res.ok) {
        var err = new Error((res && res.error) || "REQUEST_FAILED");
        err.code = res && res.error;
        throw err;
      }
      return res;
    });
  }

  function friendlyError(err) {
    if (!err) return "Terjadi kesalahan. Coba lagi.";
    if (err.message === "BACKEND_NOT_CONFIGURED") return "Backend belum terhubung. Isi URL Web App pada js/backend.js.";
    if (err.code === "UNAUTHORIZED") return "Sesi admin berakhir. Silakan login lagi.";
    if (err.code === "INVALID_CREDENTIALS") return "Password admin salah.";
    if (String(err.message || "").indexOf("BACKEND_HTTP_") === 0) return "Server backend bermasalah (" + err.message + ").";
    return "Gagal memuat data. Periksa koneksi lalu coba lagi.";
  }

  function handleAuthError(err) {
    if (err && err.code === "UNAUTHORIZED") {
      clearToken();
      showLogin("Sesi admin berakhir. Silakan login lagi.");
      return true;
    }
    return false;
  }

  /* ============================================================
     LOGIN / LOGOUT
     ============================================================ */
  var loginScreen = qs("#loginScreen"), adminApp = qs("#adminApp");
  var passwordInput = qs("#password"), loginBtn = qs("#loginBtn"), loginBtnText = qs("#loginBtnText"), loginStatus = qs("#loginStatus");

  function showLogin(message) {
    adminApp.hidden = true;
    adminApp.style.display = "none";
    loginScreen.hidden = false;
    loginScreen.style.display = "";
    if (message) { loginStatus.textContent = message; loginStatus.classList.remove("is-ok"); }
  }
  function showApp() {
    loginScreen.hidden = true;
    loginScreen.style.display = "none";
    adminApp.hidden = false;
    adminApp.style.display = "";
  }

  function doLogin() {
    var pwd = passwordInput.value;
    if (!pwd) { loginStatus.textContent = "Masukkan password admin."; loginStatus.classList.remove("is-ok"); return; }
    loginBtn.disabled = true;
    loginBtnText.textContent = "Memeriksa…";
    loginStatus.textContent = "";
    window.UnduhinBackend.request({ action: "adminLogin", password: pwd }).then(function (res) {
      if (!res || !res.ok) throw new Error(res && res.error === "INVALID_CREDENTIALS" ? "Password admin salah." : "Login gagal. Backend belum siap.");
      setToken(res.token);
      passwordInput.value = "";
      showApp();
      goToRoute(location.hash.replace("#", "") || "overview", true);
    }).catch(function (e) {
      loginStatus.textContent = e.message === "BACKEND_NOT_CONFIGURED"
        ? "Backend belum terhubung. Isi URL Web App pada js/backend.js."
        : (e.message || "Password admin salah atau backend belum siap.");
    }).finally(function () {
      loginBtn.disabled = false;
      loginBtnText.textContent = "Masuk";
    });
  }
  loginBtn.addEventListener("click", doLogin);
  passwordInput.addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });

  qs("#logoutBtn").addEventListener("click", function () {
    clearToken();
    closeMenu();
    showLogin();
  });

  /* ============================================================
     TOP MENU / THEME TOGGLE
     ============================================================ */
  var menuToggle = qs("#menuToggle"), menuDropdown = qs("#menuDropdown");
  function closeMenu() { menuDropdown.classList.remove("is-open"); menuToggle.setAttribute("aria-expanded", "false"); }
  function openMenu() { menuDropdown.classList.add("is-open"); menuToggle.setAttribute("aria-expanded", "true"); }
  menuToggle.addEventListener("click", function (e) {
    e.stopPropagation();
    if (menuDropdown.classList.contains("is-open")) closeMenu(); else openMenu();
  });
  document.addEventListener("click", function (e) {
    if (menuDropdown.classList.contains("is-open") && !menuDropdown.contains(e.target) && e.target !== menuToggle) closeMenu();
  });

  function applyTheme() {
    document.body.setAttribute("data-adm-theme", state.theme === "warm" ? "warm" : "cream");
  }
  qs("#themeToggle").addEventListener("click", function () {
    state.theme = state.theme === "warm" ? "cream" : "warm";
    localStorage.setItem("unduhin_admin_theme", state.theme);
    applyTheme();
  });
  applyTheme();

  /* ============================================================
     ROUTING
     ============================================================ */
  var routes = ["overview", "analytics", "activity", "system", "settings"];
  var loadedOnce = {};

  function goToRoute(route, force) {
    if (routes.indexOf(route) === -1) route = "overview";
    if (route === state.route && !force) return;
    state.route = route;
    if (location.hash !== "#" + route) location.hash = route;

    var target = qs("#page-" + route);

    routes.forEach(function (r) {
      var sec = qs("#page-" + r);
      if (sec && r !== route) { sec.hidden = true; sec.style.display = "none"; }
    });
    qsa(".adm-nav-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.route === route);
    });

    if (target) {
      if (prefersReducedMotion) {
        target.hidden = false;
        target.style.display = "";
      } else {
        target.classList.add("is-entering");
        target.hidden = false;
        target.style.display = "";
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            target.classList.remove("is-entering");
          });
        });
      }
      window.scrollTo({ top: 0 });
    }

    if (route === "overview") loadOverview();
    if (route === "analytics") loadAnalytics(state.period);
    if (route === "activity" && !loadedOnce.activity) { loadedOnce.activity = true; resetActivity(); }
    if (route === "system") loadSystemPage();
    if (route === "settings" && !loadedOnce.settings) { loadedOnce.settings = true; initSettingsPage(); }
  }

  qsa(".adm-nav-btn").forEach(function (btn) {
    btn.addEventListener("click", function () { goToRoute(btn.dataset.route); });
  });
  window.addEventListener("hashchange", function () {
    goToRoute(location.hash.replace("#", "") || "overview");
  });

  /* ============================================================
     CHARTS — SVG helpers
     ============================================================ */
  function niceAxis(maxVal) {
    if (maxVal <= 0) return { max: 4, step: 1 };
    var rawStep = maxVal / 3;
    var mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    var norm = rawStep / mag;
    var step;
    if (norm < 1.5) step = 1 * mag; else if (norm < 3) step = 2 * mag; else if (norm < 7) step = 5 * mag; else step = 10 * mag;
    return { max: step * 3, step: step };
  }

  function buildLineChart(labels, values) {
    var W = 600, H = 250, padL = 40, padR = 14, padT = 16, padB = 28;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxVal = Math.max.apply(null, values.concat([1]));
    var axis = niceAxis(maxVal);
    var n = values.length;
    if (n === 0) return '<p class="adm-chart-empty">Belum ada data pada periode ini.</p>';

    function xAt(i) { return n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW; }
    function yAt(v) { return padT + plotH - (v / axis.max) * plotH; }

    var pts = values.map(function (v, i) { return xAt(i) + "," + yAt(v); });
    var linePath = "M" + pts.join(" L");
    var areaPath = "M" + xAt(0) + "," + (padT + plotH) + " L" + pts.join(" L") + " L" + xAt(n - 1) + "," + (padT + plotH) + " Z";

    var gridLines = "", yLabels = "";
    for (var g = 0; g <= 3; g++) {
      var val = axis.step * g;
      var y = yAt(val);
      gridLines += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="var(--adm-line)" stroke-width="1" />';
      yLabels += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="var(--adm-ink-faint-solid)">' + fmtCompact(val) + "</text>";
    }

    var xLabels = "";
    var labelStep = n > 8 ? Math.ceil(n / 6) : 1;
    labels.forEach(function (lb, i) {
      if (i % labelStep !== 0 && i !== n - 1) return;
      xLabels += '<text x="' + xAt(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="var(--adm-ink-faint-solid)">' + escapeHtml(lb) + "</text>";
    });

    var dots = values.map(function (v, i) {
      return '<circle cx="' + xAt(i) + '" cy="' + yAt(v) + '" r="3.2" fill="var(--adm-brown-dark)" stroke="var(--adm-surface-solid)" stroke-width="1.5" />';
    }).join("");

    return (
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Grafik tren pengguna">' +
      '<defs><linearGradient id="admAreaFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--adm-brown-dark)" stop-opacity="0.22" />' +
      '<stop offset="100%" stop-color="var(--adm-brown-dark)" stop-opacity="0" />' +
      "</linearGradient></defs>" +
      gridLines + yLabels +
      '<path d="' + areaPath + '" fill="url(#admAreaFill)" stroke="none" />' +
      '<path d="' + linePath + '" fill="none" stroke="var(--adm-brown-dark)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />' +
      dots + xLabels +
      "</svg>"
    );
  }

  function buildSparkline(values, colorVar) {
    var W = 70, H = 28, pad = 3;
    var n = values.length;
    if (n < 2) return "";
    var maxVal = Math.max.apply(null, values.concat([1]));
    var minVal = Math.min.apply(null, values.concat([0]));
    var range = Math.max(1, maxVal - minVal);
    function xAt(i) { return pad + (i / (n - 1)) * (W - pad * 2); }
    function yAt(v) { return H - pad - ((v - minVal) / range) * (H - pad * 2); }
    var pts = values.map(function (v, i) { return xAt(i) + "," + yAt(v); });
    var areaPath = "M" + xAt(0) + "," + (H - pad) + " L" + pts.join(" L") + " L" + xAt(n - 1) + "," + (H - pad) + " Z";
    return (
      '<svg class="adm-spark" viewBox="0 0 ' + W + " " + H + '" width="64" height="26" aria-hidden="true">' +
      '<path d="' + areaPath + '" fill="' + colorVar + '" opacity="0.16" stroke="none" />' +
      '<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + colorVar + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />' +
      "</svg>"
    );
  }

  var CAT_COLOR = { download: "var(--adm-green)", deteksi: "var(--adm-purple)", kunjungan: "var(--adm-brown-dark)", lainnya: "var(--adm-pink)" };

  function buildDonut(items) {
    var total = items.reduce(function (s, it) { return s + it.count; }, 0);
    var size = 140, r = 50, cx = 60, cy = 60, sw = 20;
    var circumference = 2 * Math.PI * r;
    var offset = 0;
    var segs = "";
    if (total === 0) {
      segs = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--adm-line)" stroke-width="' + sw + '" />';
    } else {
      items.forEach(function (it) {
        if (it.count <= 0) return;
        var frac = it.count / total;
        var dash = frac * circumference;
        segs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + CAT_COLOR[it.key] + '" stroke-width="' + sw +
          '" stroke-dasharray="' + dash + " " + (circumference - dash) + '" stroke-dashoffset="' + (-offset) +
          '" transform="rotate(-90 ' + cx + " " + cy + ')" stroke-linecap="butt" />';
        offset += dash;
      });
    }
    var svg = '<div class="adm-donut-center" style="position:relative;width:' + size + "px;height:" + size + 'px;flex-shrink:0;">' +
      '<svg viewBox="0 0 120 120" width="' + size + '" height="' + size + '" role="img" aria-label="Distribusi jenis aktivitas">' + segs + "</svg>" +
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">' +
      '<strong style="font-family:var(--adm-font-display);font-size:1.15rem;font-weight:800;">' + fmtNum(total) + "</strong>" +
      '<span style="font-size:0.68rem;color:var(--adm-ink-soft);">Total</span></div></div>';

    var legend = '<div class="adm-donut-legend">' + items.map(function (it) {
      return '<div class="adm-donut-legend-row">' +
        '<span class="adm-legend-dot" style="background:' + CAT_COLOR[it.key] + '"></span>' +
        '<span class="adm-legend-label">' + escapeHtml(it.label) + "</span>" +
        '<span class="adm-legend-value">' + round1(it.percent) + "%</span></div>";
    }).join("") + "</div>";

    return total === 0
      ? svg + legend + '<p class="adm-chart-empty" style="width:100%;margin-top:8px;">Belum ada aktivitas pada periode ini.</p>'
      : svg + legend;
  }

  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

  function buildBarList(items) {
    var hasAny = items.some(function (it) { return it.count > 0; });
    if (!hasAny) return '<p class="adm-chart-empty">Belum ada download pada periode ini.</p>';
    return items.map(function (it) {
      return '<div class="adm-bar-item">' +
        '<div class="adm-bar-row-top"><span>' + escapeHtml(it.label) + "</span><span>" + round1(it.percent) + "%</span></div>" +
        '<div class="adm-bar-track"><div class="adm-bar-fill" style="width:' + Math.max(2, it.percent) + '%"></div></div>' +
        "</div>";
    }).join("");
  }

  /* ============================================================
     ICONS (kecil, dipakai di stat card & activity list)
     ============================================================ */
  var ICONS = {
    user: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/></svg>',
    detect: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.3 2.3L16 10"/></svg>',
    percent: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M5 19 19 5"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    api: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><path d="m9 6-6 6 6 6M15 6l6 6-6 6"/></svg>'
  };
  var CAT_ICON = {
    download: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/></svg>',
    deteksi: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    kunjungan: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4"/></svg>',
    lainnya: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 12h.01M12 12h.01M18 12h.01"/></svg>'
  };

  /* ============================================================
     API HEALTH
     ============================================================ */
  var apiDot = qs("#ovApiDot"), apiText = qs("#ovApiText"), apiTime = qs("#ovApiTime"), apiPill = qs("#ovApiPill");
  var topStatusDot = qs("#topStatusDot"), topStatusText = qs("#topStatusText");
  function checkApiHealth() {
    apiDot.className = "adm-status-dot is-checking";
    apiText.textContent = "Memeriksa sistem…";
    if (topStatusDot) { topStatusDot.className = "adm-status-dot is-checking"; topStatusText.textContent = "Memeriksa…"; }
    window.UnduhinBackend.request({ action: "ping" }).then(function (res) {
      var ok = !!(res && res.ok);
      apiDot.className = "adm-status-dot " + (ok ? "is-ok" : "is-error");
      apiText.textContent = ok ? "Sistem Normal" : "API Bermasalah";
      apiTime.textContent = "Terakhir diperiksa " + new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      if (topStatusDot) { topStatusDot.className = "adm-status-dot " + (ok ? "is-ok" : "is-error"); topStatusText.textContent = ok ? "Online" : "Offline"; }
    }).catch(function () {
      apiDot.className = "adm-status-dot is-error";
      apiText.textContent = "API Offline — coba lagi";
      apiTime.textContent = "Terakhir diperiksa " + new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      if (topStatusDot) { topStatusDot.className = "adm-status-dot is-error"; topStatusText.textContent = "Offline"; }
    });
  }
  apiPill.addEventListener("click", checkApiHealth);

  /* ============================================================
     OVERVIEW
     ============================================================ */
  var OV_META = [
    { key: "uniqueUsers", label: "Pengguna", icon: ICONS.user },
    { key: "visits", label: "Kunjungan", icon: ICONS.eye },
    { key: "downloads", label: "Download", icon: ICONS.download },
    { key: "attempts", label: "Percobaan", icon: ICONS.detect },
    { key: "success", label: "Deteksi", icon: ICONS.check },
    { key: "successRate", label: "Success Rate", icon: ICONS.percent, isPercent: true },
    { key: "sessions", label: "Sesi", icon: ICONS.clock }
  ];

  function deltaFromSums(a, b) {
    if (!a && !b) return 0;
    if (!a) return 100;
    return round1((b - a) / a * 100);
  }
  function splitSum(arr) {
    var mid = Math.floor(arr.length / 2);
    var first = arr.slice(0, mid).reduce(function (s, v) { return s + v; }, 0);
    var second = arr.slice(mid).reduce(function (s, v) { return s + v; }, 0);
    return { first: first, second: second };
  }

  function renderDeltaBadge(pct) {
    var cls = pct > 0.05 ? "is-up" : pct < -0.05 ? "is-down" : "is-flat";
    var arrow = pct > 0.05 ? "&uarr;" : pct < -0.05 ? "&darr;" : "•";
    return '<span class="adm-stat-delta ' + cls + '">' + arrow + " " + Math.abs(round1(pct)) + "%</span>";
  }

  function renderOverviewGrid(stats, trend) {
    var grid = qs("#ovStatGrid");
    var html = OV_META.map(function (m) {
      var value = stats[m.key];
      var trendArr = trend[m.key] || [];
      var delta;
      if (m.key === "successRate") {
        var attemptsSplit = splitSum(trend.attempts || []);
        var successSplit = splitSum(trend.success || []);
        var r1 = attemptsSplit.first ? successSplit.first / attemptsSplit.first * 100 : null;
        var r2 = attemptsSplit.second ? successSplit.second / attemptsSplit.second * 100 : null;
        delta = (r1 !== null && r2 !== null) ? deltaFromSums(r1, r2) : 0;
      } else {
        var sp = splitSum(trendArr);
        delta = deltaFromSums(sp.first, sp.second);
      }
      var displayValue = m.isPercent ? (value == null ? "—" : Math.round(value) + "%") : fmtNum(value);
      var spark = trendArr.length > 1 ? buildSparkline(trendArr, "var(--adm-brown-dark)") : "";
      return '<div class="adm-stat-card">' +
        '<div class="adm-stat-top"><span class="adm-stat-icon">' + m.icon + '</span><span class="adm-stat-label">' + m.label + "</span></div>" +
        '<div class="adm-stat-value" data-count="' + (m.isPercent ? "" : value) + '">' + (m.isPercent ? displayValue : fmtNum(value)) + "</div>" +
        '<div class="adm-stat-bottom">' + renderDeltaBadge(delta) + spark + "</div>" +
        "</div>";
    }).join("");

    grid.innerHTML = html;

    if (!prefersReducedMotion) {
      qsa(".adm-stat-value[data-count]", grid).forEach(function (el) {
        var target = el.getAttribute("data-count");
        if (target !== "") animateCount(el, Number(target));
      });
    }

    checkApiHealth();
  }

  function renderRecentList(container, items) {
    if (!items || !items.length) {
      container.innerHTML = '<p class="adm-state-empty">Belum ada aktivitas.</p>';
      return;
    }
    container.innerHTML = items.map(function (it) {
      return '<div class="adm-activity-row">' +
        '<span class="adm-activity-icon cat-' + it.category + '">' + CAT_ICON[it.category] + "</span>" +
        '<div class="adm-activity-main"><div class="adm-activity-title">' + activityTitle(it) + '</div><div class="adm-activity-time">' + fmtTime(it.time) + "</div></div>" +
        '<span class="adm-activity-badge">' + escapeHtml(it.categoryLabel) + "</span>" +
        "</div>";
    }).join("");
  }

  function activityTitle(it) {
    var map = {
      download: "Download " + (it.format || "video") + " berhasil",
      deteksi: it.action === "success" ? "Deteksi video berhasil" : "Percobaan deteksi video",
      kunjungan: "Pengunjung baru",
      lainnya: "Sesi baru dimulai"
    };
    return map[it.category] || "Aktivitas pengguna";
  }

  function loadOverview() {
    var trendEl = qs("#ovTrendChart"), recentEl = qs("#ovRecentList"), grid = qs("#ovStatGrid");
    grid.innerHTML = '<div class="adm-state">Memuat statistik…</div>';
    trendEl.innerHTML = '<div class="adm-state">Memuat grafik…</div>';
    recentEl.innerHTML = '<div class="adm-state">Memuat aktivitas…</div>';

    call("adminOverview").then(function (res) {
      renderOverviewGrid(res.stats, res.trend);
      trendEl.innerHTML = buildLineChart(res.trend.labels, res.trend.uniqueUsers);
      renderRecentList(recentEl, res.recentActivity);
    }).catch(function (err) {
      if (handleAuthError(err)) return;
      var msg = friendlyError(err);
      grid.innerHTML = '<div class="adm-state adm-state-error">' + escapeHtml(msg) +
        '<button class="adm-retry-btn" id="ovRetry" type="button">Coba lagi</button></div>';
      trendEl.innerHTML = ""; recentEl.innerHTML = "";
      var r = qs("#ovRetry"); if (r) r.addEventListener("click", loadOverview);
    });
  }

  /* ============================================================
     ANALYTICS
     ============================================================ */
  var AN_META = [
    { key: "uniqueUsers", label: "Pengguna", icon: ICONS.user, deltaKey: "uniqueUsersChangePct" },
    { key: "totalEvents", label: "Kunjungan", icon: ICONS.eye, deltaKey: "totalEventsChangePct" },
    { key: "totalDownloads", label: "Download", icon: ICONS.download, deltaKey: "totalDownloadsChangePct" },
    { key: "deteksiBerhasil", label: "Deteksi", icon: ICONS.check, deltaKey: "deteksiBerhasilChangePct" }
  ];
  var PERIOD_LABEL = { today: "Hari Ini", "7d": "7 Hari Terakhir", "30d": "30 Hari" };

  var periodBtn = qs("#periodBtn"), periodMenu = qs("#periodMenu"), periodLabel = qs("#periodLabel");
  periodBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var willOpen = !periodMenu.classList.contains("is-open");
    periodMenu.classList.toggle("is-open", willOpen);
    periodBtn.setAttribute("aria-expanded", String(willOpen));
  });
  qsa("#periodMenu li").forEach(function (li) {
    li.addEventListener("click", function () {
      state.period = li.dataset.period;
      periodLabel.textContent = PERIOD_LABEL[state.period];
      qsa("#periodMenu li").forEach(function (x) { x.classList.toggle("is-active", x === li); });
      periodMenu.classList.remove("is-open");
      periodBtn.setAttribute("aria-expanded", "false");
      loadAnalytics(state.period);
    });
  });
  document.addEventListener("click", function (e) {
    if (periodMenu.classList.contains("is-open") && !periodMenu.contains(e.target) && e.target !== periodBtn && !periodBtn.contains(e.target)) {
      periodMenu.classList.remove("is-open");
      periodBtn.setAttribute("aria-expanded", "false");
    }
  });

  function renderAnalyticsGrid(stats) {
    var grid = qs("#anStatGrid");
    grid.innerHTML = AN_META.map(function (m) {
      var value = stats[m.key];
      var delta = stats[m.deltaKey] || 0;
      return '<div class="adm-stat-card">' +
        '<div class="adm-stat-top"><span class="adm-stat-icon">' + m.icon + '</span><span class="adm-stat-label">' + m.label + "</span></div>" +
        '<div class="adm-stat-value" data-count="' + value + '">' + fmtNum(value) + "</div>" +
        '<div class="adm-stat-bottom">' + renderDeltaBadge(delta) + "</div>" +
        "</div>";
    }).join("");
    if (!prefersReducedMotion) {
      qsa(".adm-stat-value[data-count]", grid).forEach(function (el) {
        animateCount(el, Number(el.getAttribute("data-count")));
      });
    }
  }

  function renderActivityTable(container, items, emptyMsg) {
    if (!items || !items.length) {
      container.innerHTML = '<p class="adm-state-empty">' + escapeHtml(emptyMsg || "Belum ada aktivitas.") + "</p>";
      return;
    }
    var rows = items.map(function (it) {
      return "<tr><td>" + fmtDateTime(it.time) + "</td>" +
        '<td><span class="adm-table-badge cat-' + it.category + '">' + escapeHtml(it.categoryLabel) + "</span></td>" +
        "<td>" + escapeHtml(it.page || "—") + "</td>" +
        '<td class="adm-table-muted">' + (it.format ? escapeHtml(it.format) : "—") + "</td>" +
        '<td class="adm-table-muted">' + escapeHtml(it.visitorId) + "</td></tr>";
    }).join("");
    container.innerHTML = '<table class="adm-table"><thead><tr><th>Waktu</th><th>Jenis Aktivitas</th><th>Halaman</th><th>Format</th><th>Visitor ID</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  function loadAnalytics(period) {
    var grid = qs("#anStatGrid"), trendEl = qs("#anTrendChart"), donutEl = qs("#anDonutWrap"), barEl = qs("#anFormatList"), tableEl = qs("#anActivityTable"), trendSub = qs("#anTrendSub");
    grid.innerHTML = '<div class="adm-state">Memuat statistik…</div>';
    trendEl.innerHTML = '<div class="adm-state">Memuat grafik…</div>';
    donutEl.innerHTML = '<div class="adm-state">Memuat data…</div>';
    barEl.innerHTML = '<div class="adm-state">Memuat data…</div>';
    tableEl.innerHTML = '<div class="adm-state">Memuat aktivitas…</div>';

    call("adminAnalytics", { period: period }).then(function (res) {
      renderAnalyticsGrid(res.stats);
      trendSub.textContent = "Jumlah pengguna unik — " + PERIOD_LABEL[res.period].toLowerCase();
      trendEl.innerHTML = buildLineChart(res.trend.labels, res.trend.uniqueUsers);
      donutEl.innerHTML = buildDonut(res.jenisAktivitas);
      barEl.innerHTML = buildBarList(res.formatDownload);
      renderActivityTable(tableEl, res.recentActivity, "Belum ada aktivitas pada periode ini.");
    }).catch(function (err) {
      if (handleAuthError(err)) return;
      var msg = friendlyError(err);
      grid.innerHTML = '<div class="adm-state adm-state-error">' + escapeHtml(msg) +
        '<button class="adm-retry-btn" id="anRetry" type="button">Coba lagi</button></div>';
      trendEl.innerHTML = ""; donutEl.innerHTML = ""; barEl.innerHTML = ""; tableEl.innerHTML = "";
      var r = qs("#anRetry"); if (r) r.addEventListener("click", function () { loadAnalytics(state.period); });
    });
  }

  /* ============================================================
     ACTIVITY
     ============================================================ */
  var actTable = qs("#activityTable"), actCountLabel = qs("#actCountLabel"), loadMoreBtn = qs("#loadMoreBtn");
  var activitySearch = qs("#activitySearch");
  var activityAccum = [];
  var activitySearchTerm = "";

  function matchesSearch(it) {
    if (!activitySearchTerm) return true;
    var hay = [it.visitorId, it.page, it.format, it.categoryLabel].filter(Boolean).join(" ").toLowerCase();
    return hay.indexOf(activitySearchTerm) !== -1;
  }
  function renderFilteredActivity() {
    var filtered = activityAccum.filter(matchesSearch);
    renderActivityTable(actTable, filtered, activitySearchTerm ? "Tidak ditemukan aktivitas yang cocok." : "Belum ada aktivitas untuk filter ini.");
    actCountLabel.textContent = filtered.length
      ? "Menampilkan " + fmtNum(filtered.length) + " dari " + fmtNum(state.activityTotal) + " aktivitas"
      : "Tidak ada aktivitas ditemukan";
  }
  if (activitySearch) {
    activitySearch.addEventListener("input", function () {
      activitySearchTerm = activitySearch.value.trim().toLowerCase();
      renderFilteredActivity();
    });
  }

  qsa(".adm-filter-chip", qs("#activityFilters")).forEach(function (chip) {
    chip.addEventListener("click", function () {
      if (chip.classList.contains("is-active")) return;
      qsa(".adm-filter-chip", qs("#activityFilters")).forEach(function (c) { c.classList.toggle("is-active", c === chip); });
      state.activityFilter = chip.dataset.filter;
      resetActivity();
    });
  });

  function resetActivity() {
    state.activityOffset = 0;
    activityAccum = [];
    actTable.innerHTML = '<div class="adm-state">Memuat aktivitas…</div>';
    actCountLabel.textContent = "Memuat data…";
    loadMoreBtn.hidden = true;
    fetchActivityPage(true);
  }

  function fetchActivityPage(isFirst) {
    if (state.activityLoading) return;
    state.activityLoading = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "Memuat…";

    call("adminActivity", { filter: state.activityFilter, offset: state.activityOffset, limit: state.activityLimit }).then(function (res) {
      activityAccum = activityAccum.concat(res.items);
      state.activityOffset += res.items.length;
      state.activityTotal = res.total;

      renderFilteredActivity();

      loadMoreBtn.hidden = !res.hasMore;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "Muat lebih banyak";
    }).catch(function (err) {
      if (handleAuthError(err)) return;
      var msg = friendlyError(err);
      if (isFirst) {
        actTable.innerHTML = '<div class="adm-state adm-state-error">' + escapeHtml(msg) +
          '<button class="adm-retry-btn" id="actRetry" type="button">Coba lagi</button></div>';
        actCountLabel.textContent = "Gagal memuat data";
        var r = qs("#actRetry"); if (r) r.addEventListener("click", resetActivity);
      } else {
        actCountLabel.textContent = "Gagal memuat data tambahan — coba lagi.";
      }
      loadMoreBtn.hidden = false;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "Muat lebih banyak";
    }).finally(function () {
      state.activityLoading = false;
    });
  }
  loadMoreBtn.addEventListener("click", function () { fetchActivityPage(false); });

  /* ============================================================
     TOAST
     ============================================================ */
  function showToast(message, type) {
    var wrap = qs("#toastWrap");
    if (!wrap) return;
    var el = document.createElement("div");
    el.className = "adm-toast" + (type ? " is-" + type : "");
    el.textContent = message;
    wrap.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("is-show"); });
    setTimeout(function () {
      el.classList.remove("is-show");
      setTimeout(function () { el.remove(); }, 250);
    }, 2600);
  }

  /* ============================================================
     SYSTEM
     ============================================================ */
  var sysGasDot = qs("#sysGasDot"), sysGasText = qs("#sysGasText"), sysGasTime = qs("#sysGasTime"), sysGasCheck = qs("#sysGasCheck");
  var sysNetDot = qs("#sysNetDot"), sysNetText = qs("#sysNetText");

  function checkGasStatus() {
    if (!sysGasDot) return;
    sysGasDot.className = "adm-status-dot is-checking";
    sysGasText.textContent = "Memeriksa…";
    if (!window.UnduhinBackend || !window.UnduhinBackend.isConfigured()) {
      sysGasDot.className = "adm-status-dot is-error";
      sysGasText.textContent = "Belum terhubung";
      sysGasTime.textContent = "Isi URL Web App pada js/backend.js";
      return;
    }
    window.UnduhinBackend.request({ action: "ping" }).then(function (res) {
      var ok = !!(res && res.ok);
      sysGasDot.className = "adm-status-dot " + (ok ? "is-ok" : "is-error");
      sysGasText.textContent = ok ? "Terhubung" : "Bermasalah";
      sysGasTime.textContent = "Terakhir dicek " + new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }).catch(function () {
      sysGasDot.className = "adm-status-dot is-error";
      sysGasText.textContent = "Gagal terhubung";
      sysGasTime.textContent = "Terakhir dicek " + new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    });
  }
  if (sysGasCheck) sysGasCheck.addEventListener("click", checkGasStatus);

  function renderNetStatus() {
    if (!sysNetDot) return;
    var online = navigator.onLine;
    sysNetDot.className = "adm-status-dot " + (online ? "is-ok" : "is-error");
    sysNetText.textContent = online ? "Online" : "Offline";
  }
  window.addEventListener("online", renderNetStatus);
  window.addEventListener("offline", renderNetStatus);

  function renderSysInfo() {
    var list = qs("#sysInfoList");
    if (!list) return;
    var rows = [
      ["Versi Panel", "1.0"],
      ["Tema Aktif", state.theme === "warm" ? "Warm" : "Cream"],
      ["Resolusi Layar", window.innerWidth + " × " + window.innerHeight],
      ["Browser", (navigator.userAgentData && navigator.userAgentData.brands && navigator.userAgentData.brands.length)
        ? navigator.userAgentData.brands.map(function (b) { return b.brand; }).join(", ")
        : (navigator.vendor || navigator.platform || "—")]
    ];
    list.innerHTML = rows.map(function (r) {
      return '<div class="adm-info-row"><span>' + escapeHtml(r[0]) + "</span><span>" + escapeHtml(r[1]) + "</span></div>";
    }).join("");
  }

  /* ---- API HEALTH MONITOR ---- */
  var STATUS_LABEL = { ONLINE: "ONLINE", SLOW: "SLOW", ERROR: "ERROR", TIMEOUT: "TIMEOUT", DISABLED: "DISABLED" };
  var STATUS_CLASS = { ONLINE: "is-online", SLOW: "is-slow", ERROR: "is-error", TIMEOUT: "is-timeout", DISABLED: "is-disabled" };
  var STATUS_DOT = { ONLINE: "is-ok", SLOW: "is-slow", ERROR: "is-error", TIMEOUT: "is-error", DISABLED: "is-off" };

  var apiHealthList = qs("#apiHealthList"), apiHealthCheckAll = qs("#apiHealthCheckAll"), apiHealthUpdated = qs("#apiHealthUpdated");

  function renderApiHealth(providers) {
    if (!providers || !providers.length) {
      apiHealthList.innerHTML = '<div class="adm-state">Belum ada data provider.</div>';
      return;
    }
    apiHealthList.innerHTML = providers.map(function (p) {
      var cls = STATUS_CLASS[p.status] || "is-disabled";
      var dot = STATUS_DOT[p.status] || "is-off";
      var meta = [];
      if (p.responseTimeMs != null) meta.push(fmtNum(p.responseTimeMs) + " ms");
      if (p.httpStatus != null) meta.push("HTTP " + p.httpStatus);
      meta.push("Checked " + fmtTime(p.checkedAt));
      return (
        '<div class="adm-api-row">' +
          '<div class="adm-api-row-top">' +
            '<span class="adm-api-name">' + escapeHtml(p.name) + "</span>" +
            '<span class="adm-api-badge ' + cls + '"><span class="adm-status-dot ' + dot + '"></span>' + STATUS_LABEL[p.status] + "</span>" +
          "</div>" +
          '<div class="adm-api-row-meta">' + meta.map(function (m) { return "<span>" + escapeHtml(m) + "</span>"; }).join("") + "</div>" +
          (p.error ? '<p class="adm-api-error">' + escapeHtml(p.error) + "</p>" : "") +
        "</div>"
      );
    }).join("");
  }

  function loadApiHealth(isFirst) {
    if (isFirst) apiHealthList.innerHTML = '<div class="adm-state">Memeriksa seluruh provider…</div>';
    apiHealthCheckAll.disabled = true;
    apiHealthCheckAll.textContent = "Memeriksa…";
    call("adminApiHealth", {}).then(function (res) {
      renderApiHealth(res.providers);
      apiHealthUpdated.textContent = "Terakhir dicek " + fmtTime(res.checkedAt);
    }).catch(function (err) {
      if (handleAuthError(err)) return;
      var msg = friendlyError(err);
      if (isFirst) {
        apiHealthList.innerHTML = '<div class="adm-state adm-state-error">' + escapeHtml(msg) +
          '<button class="adm-retry-btn" id="apiHealthRetry" type="button">Coba lagi</button></div>';
        var r = qs("#apiHealthRetry"); if (r) r.addEventListener("click", function () { loadApiHealth(true); });
      } else {
        showToast(msg, "error");
      }
    }).finally(function () {
      apiHealthCheckAll.disabled = false;
      apiHealthCheckAll.textContent = "Check All";
    });
  }
  if (apiHealthCheckAll) apiHealthCheckAll.addEventListener("click", function () { loadApiHealth(false); });

  /* ---- API FAILOVER CONTROL ---- */
  var apiFailoverList = qs("#apiFailoverList");

  function renderApiFailover(providers) {
    if (!providers || !providers.length) {
      apiFailoverList.innerHTML = '<div class="adm-state">Belum ada data provider.</div>';
      return;
    }
    apiFailoverList.innerHTML = providers.map(function (p) {
      return (
        '<label class="adm-switch-row adm-api-toggle-row' + (p.enabled ? "" : " is-disabled-row") + '" for="apiToggle-' + p.id + '">' +
          "<span><strong>" + escapeHtml(p.name) + "</strong><span class=\"adm-api-toggle-sub\">" + escapeHtml(p.label) + "</span></span>" +
          '<span class="adm-switch"><input type="checkbox" id="apiToggle-' + p.id + '" data-provider="' + p.id + '"' + (p.enabled ? " checked" : "") + '>' +
          '<span class="adm-switch-track"><span class="adm-switch-thumb"></span></span></span>' +
        "</label>"
      );
    }).join("");

    qsa(".adm-switch input", apiFailoverList).forEach(function (input) {
      input.addEventListener("change", function () {
        var providerId = input.dataset.provider;
        var enabled = input.checked;
        var row = input.closest(".adm-api-toggle-row");
        input.disabled = true;
        call("adminApiToggle", { providerId: providerId, enabled: enabled }).then(function (res) {
          if (row) row.classList.toggle("is-disabled-row", !enabled);
          showToast(enabled ? "Provider diaktifkan." : "Provider dinonaktifkan.", "ok");
        }).catch(function (err) {
          if (handleAuthError(err)) return;
          input.checked = !enabled; // rollback tampilan kalau gagal disimpan di backend
          showToast(friendlyError(err), "error");
        }).finally(function () {
          input.disabled = false;
        });
      });
    });
  }

  function loadApiFailover() {
    call("adminApiConfig", {}).then(function (res) {
      renderApiFailover(res.providers);
    }).catch(function (err) {
      if (handleAuthError(err)) return;
      apiFailoverList.innerHTML = '<div class="adm-state adm-state-error">' + escapeHtml(friendlyError(err)) +
        '<button class="adm-retry-btn" id="apiFailoverRetry" type="button">Coba lagi</button></div>';
      var r = qs("#apiFailoverRetry"); if (r) r.addEventListener("click", loadApiFailover);
    });
  }

  /* ---- MAINTENANCE MODE ---- */
  var maintStatusDot = qs("#maintStatusDot"), maintStatusText = qs("#maintStatusText");
  var maintToggle = qs("#maintToggle"), maintMessage = qs("#maintMessage"), maintSaveBtn = qs("#maintSaveBtn");

  function applyMaintenanceState(m) {
    maintToggle.checked = !!m.enabled;
    maintMessage.value = m.message || "";
    maintStatusDot.className = "adm-status-dot " + (m.enabled ? "is-error" : "is-ok");
    maintStatusText.textContent = m.enabled ? "Maintenance aktif — situs publik ditutup sementara" : "Online — situs publik berjalan normal";
  }

  function loadMaintenance() {
    maintStatusText.textContent = "Memuat…";
    call("adminMaintenanceGet", {}).then(function (res) {
      applyMaintenanceState(res.maintenance);
    }).catch(function (err) {
      if (handleAuthError(err)) return;
      maintStatusDot.className = "adm-status-dot is-error";
      maintStatusText.textContent = "Gagal memuat status";
      showToast(friendlyError(err), "error");
    });
  }

  if (maintSaveBtn) {
    maintSaveBtn.addEventListener("click", function () {
      maintSaveBtn.disabled = true;
      maintSaveBtn.textContent = "Menyimpan…";
      call("adminMaintenanceSet", { enabled: maintToggle.checked, message: maintMessage.value }).then(function (res) {
        applyMaintenanceState(res.maintenance);
        showToast("Perubahan maintenance tersimpan.", "ok");
      }).catch(function (err) {
        if (handleAuthError(err)) return;
        showToast(friendlyError(err), "error");
      }).finally(function () {
        maintSaveBtn.disabled = false;
        maintSaveBtn.textContent = "Simpan Perubahan";
      });
    });
  }

  function loadSystemPage() {
    checkGasStatus();
    renderNetStatus();
    renderSysInfo();
    loadApiHealth(true);
    loadApiFailover();
    loadMaintenance();
  }

  /* ============================================================
     SETTINGS
     ============================================================ */
  function syncThemeSeg() {
    qsa(".adm-seg-btn", qs("#themeSeg")).forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.theme === (state.theme === "warm" ? "warm" : "cream"));
    });
  }
  function initSettingsPage() {
    var seg = qs("#themeSeg");
    if (seg) {
      syncThemeSeg();
      qsa(".adm-seg-btn", seg).forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.theme = btn.dataset.theme;
          localStorage.setItem("unduhin_admin_theme", state.theme);
          applyTheme();
          syncThemeSeg();
        });
      });
    }
    var logoutBtn = qs("#settingsLogoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", function () { clearToken(); showLogin(); });

    var resetBtn = qs("#settingsResetBtn");
    if (resetBtn) resetBtn.addEventListener("click", function () {
      localStorage.removeItem("unduhin_admin_theme");
      state.theme = "cream";
      applyTheme();
      syncThemeSeg();
      resetBtn.textContent = "Preferensi lokal direset";
      setTimeout(function () { resetBtn.textContent = "Reset Preferensi Tampilan Lokal"; }, 1600);
    });
  }

  /* ============================================================
     BOOTSTRAP
     ============================================================ */
  document.addEventListener("DOMContentLoaded", function () {
    var existingToken = getToken();
    if (existingToken) {
      showApp();
      goToRoute(location.hash.replace("#", "") || "overview", true);
    } else {
      showLogin();
    }
  });
})();
