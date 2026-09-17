/**
 * UNDUHIN — Google Apps Script backend
 * Database: Google Sheets
 *
 * 1. Buat Google Spreadsheet.
 * 2. Extensions > Apps Script.
 * 3. Paste file ini.
 * 4. Ganti ADMIN_PASSWORD.
 * 5. Deploy > New deployment > Web app.
 *    Execute as: Me
 *    Who has access: Anyone
 * 6. Copy URL /exec ke js/backend.js.
 *
 * Sheet "Events" (dibuat otomatis oleh setup()):
 *   timestamp | visitorId | action | page | format | userAgent
 *   action yang dicatat situs publik: visit, session, attempt, success, download
 *
 * Sheet "SystemConfig" (dibuat otomatis oleh setup()) — Maintenance Mode:
 *   key | value | updatedAt
 *   key yang dipakai: maintenance_enabled ("true"/"false"), maintenance_message
 *
 * Sheet "APIConfig" (dibuat otomatis oleh setup()) — API Failover Control:
 *   providerId | enabled ("true"/"false") | updatedAt
 *   providerId harus cocok dengan id di PROVIDERS_REGISTRY (lihat di bawah)
 *   dan array PROVIDERS di js/script.js.
 */
const CONFIG = {
  SPREADSHEET_ID: "PASTE_YOUR_SPREADSHEET_ID_HERE",
  SHEET_NAME: "Events",
  SYSTEM_SHEET_NAME: "SystemConfig",
  API_SHEET_NAME: "APIConfig",
  ADMIN_PASSWORD: "GANTI_PASSWORD_ADMIN_INI",
  TOKEN_TTL_SECONDS: 21600,
  // Video TikTok publik yang dipakai HANYA sebagai input uji saat admin
  // menekan "Check All" di API Health Monitor (bukan endpoint API — endpoint
  // provider tetap persis seperti yang sudah dipakai downloader di
  // js/script.js). Ganti dengan link video TikTok valid mana pun bila link
  // ini di kemudian hari sudah tidak tersedia.
  HEALTH_CHECK_VIDEO_URL: "https://www.tiktok.com/@tiktok/video/7000000000000000000",
  // Ambang batas (ms) untuk status SLOW pada API Health Monitor. Ini bukan
  // nilai tetap/pasti — hanya perkiraan wajar untuk membedakan respons
  // normal dari respons yang mulai lambat.
  API_SLOW_THRESHOLD_MS: 2500
};

// Provider downloader terpusat — HARUS selalu sinkron dengan array PROVIDERS
// di js/script.js (id, urutan, dan base URL). Dipakai oleh API Health
// Monitor & API Failover Control. Jangan menambah/mengganti endpoint di
// sini tanpa mengubahnya juga di js/script.js.
const PROVIDERS_REGISTRY = [
  { id: "yoinku", label: "API 1", name: "Yoinku", base: "https://yoinku.vercel.app/api/tiktok?url=", kind: "direct" },
  { id: "tdownv4", label: "API 2", name: "tdownv4", base: "https://tdownv4.sl-bjs.workers.dev/?down=", kind: "direct" },
  { id: "tikwm", label: "API 3", name: "TikWM", base: "https://www.tikwm.com/api/?url=", kind: "direct" },
  { id: "tikwm-proxy", label: "API 4", name: "TikWM Proxy", base: "https://www.tikwm.com/api/?url=", proxyBase: "https://api.allorigins.win/raw?url=", kind: "proxy" }
];

function setup() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) sh = ss.insertSheet(CONFIG.SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["timestamp","visitorId","action","page","format","userAgent"]);
    sh.setFrozenRows(1);
  }

  let sysSh = ss.getSheetByName(CONFIG.SYSTEM_SHEET_NAME);
  if (!sysSh) sysSh = ss.insertSheet(CONFIG.SYSTEM_SHEET_NAME);
  if (sysSh.getLastRow() === 0) {
    sysSh.appendRow(["key", "value", "updatedAt"]);
    sysSh.setFrozenRows(1);
    sysSh.appendRow(["maintenance_enabled", "false", new Date().toISOString()]);
    sysSh.appendRow(["maintenance_message", "Unduhin sedang dalam pemeliharaan.", new Date().toISOString()]);
  }

  let apiSh = ss.getSheetByName(CONFIG.API_SHEET_NAME);
  if (!apiSh) apiSh = ss.insertSheet(CONFIG.API_SHEET_NAME);
  if (apiSh.getLastRow() === 0) {
    apiSh.appendRow(["providerId", "enabled", "updatedAt"]);
    apiSh.setFrozenRows(1);
    PROVIDERS_REGISTRY.forEach(function (p) {
      apiSh.appendRow([p.id, "true", new Date().toISOString()]);
    });
  }

  return "OK";
}

function doGet(e) {
  return json_({ ok: true, service: "Unduhin backend", time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    const action = String(data.action || "");

    if (action === "ping") return json_({ ok: true, service: "Unduhin backend", time: new Date().toISOString() });
    if (action === "stats") return json_({ ok: true, stats: getStats_() });
    if (action === "publicConfig") return json_(publicConfig_());
    if (action === "adminLogin") return json_(adminLogin_(data));
    if (action === "adminStats") return json_(adminStats_(data));
    if (action === "adminOverview") return json_(adminOverview_(data));
    if (action === "adminAnalytics") return json_(adminAnalytics_(data));
    if (action === "adminActivity") return json_(adminActivity_(data));
    if (action === "adminApiConfig") return json_(adminApiConfig_(data));
    if (action === "adminApiHealth") return json_(adminApiHealth_(data));
    if (action === "adminApiToggle") return json_(adminApiToggle_(data));
    if (action === "adminMaintenanceGet") return json_(adminMaintenanceGet_(data));
    if (action === "adminMaintenanceSet") return json_(adminMaintenanceSet_(data));
    if (["visit","session","attempt","success","download"].indexOf(action) !== -1) {
      logEvent_(data);
      return json_({ ok: true });
    }
    return json_({ ok: false, error: "UNKNOWN_ACTION" });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ==========================================================================
   LOGGING (dipakai situs publik — jangan diubah bentuknya)
   ========================================================================== */
function logEvent_(data) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) { setup(); sh = ss.getSheetByName(CONFIG.SHEET_NAME); }
  sh.appendRow([
    new Date(),
    sanitize_(data.visitorId),
    sanitize_(data.action),
    sanitize_(data.page),
    sanitize_(data.format),
    sanitize_(data.userAgent || "")
  ]);
}

function getStats_() {
  const rows = getRows_();
  const visitors = {};
  let visits = 0, sessions = 0, attempts = 0, success = 0, downloads = 0;
  rows.forEach(function(r) {
    const action = String(r[2] || "");
    const visitor = String(r[1] || "");
    if (visitor) visitors[visitor] = true;
    if (action === "visit") visits++;
    if (action === "session") sessions++;
    if (action === "attempt") attempts++;
    if (action === "success") success++;
    if (action === "download") downloads++;
  });
  return {
    uniqueUsers: Object.keys(visitors).length,
    visits: visits,
    sessions: sessions,
    attempts: attempts,
    success: success,
    downloads: downloads,
    successRate: attempts ? success / attempts * 100 : null,
    updatedAt: new Date().toISOString()
  };
}

/* ==========================================================================
   ADMIN AUTH
   ========================================================================== */
function adminLogin_(data) {
  if (String(data.password || "") !== CONFIG.ADMIN_PASSWORD) {
    return { ok: false, error: "INVALID_CREDENTIALS" };
  }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put("admin:" + token, "1", CONFIG.TOKEN_TTL_SECONDS);
  return { ok: true, token: token, expiresIn: CONFIG.TOKEN_TTL_SECONDS };
}

function adminStats_(data) {
  if (!isAdmin_(data.token)) return { ok: false, error: "UNAUTHORIZED" };
  return { ok: true, stats: getStats_() };
}

function isAdmin_(token) {
  return !!token && CacheService.getScriptCache().get("admin:" + token) === "1";
}

/* ==========================================================================
   ADMIN — OVERVIEW  (jendela tetap: 7 hari terakhir, sesuai grafik tren)
   ========================================================================== */
function adminOverview_(data) {
  if (!isAdmin_(data.token)) return { ok: false, error: "UNAUTHORIZED" };

  const tz = scriptTz_();
  const now = new Date();
  const range = { start: startOfDaysAgo_(now, 6), end: now, granularity: "day", tz: tz, bucketCount: 7 };
  const buckets = buildBuckets_(range);
  const rows = getRows_();
  const events = parseRows_(rows);
  const inRange = events.filter(function (ev) { return ev.ts >= range.start.getTime() && ev.ts <= range.end.getTime(); });

  const visitorSet = {};
  let visits = 0, sessions = 0, attempts = 0, success = 0, downloads = 0;
  const perBucket = buckets.map(function () { return { users: {}, visits: 0, sessions: 0, attempts: 0, success: 0, downloads: 0 }; });

  inRange.forEach(function (ev) {
    if (ev.visitorId) visitorSet[ev.visitorId] = true;
    if (ev.action === "visit") visits++;
    if (ev.action === "session") sessions++;
    if (ev.action === "attempt") attempts++;
    if (ev.action === "success") success++;
    if (ev.action === "download") downloads++;

    const bIdx = bucketIndexFor_(buckets, ev.ts);
    if (bIdx !== -1) {
      const b = perBucket[bIdx];
      if (ev.visitorId) b.users[ev.visitorId] = true;
      if (ev.action === "visit") b.visits++;
      if (ev.action === "session") b.sessions++;
      if (ev.action === "attempt") b.attempts++;
      if (ev.action === "success") b.success++;
      if (ev.action === "download") b.downloads++;
    }
  });

  const trend = {
    labels: buckets.map(function (b) { return b.key; }),
    uniqueUsers: perBucket.map(function (b) { return Object.keys(b.users).length; }),
    visits: perBucket.map(function (b) { return b.visits; }),
    downloads: perBucket.map(function (b) { return b.downloads; }),
    attempts: perBucket.map(function (b) { return b.attempts; }),
    success: perBucket.map(function (b) { return b.success; }),
    sessions: perBucket.map(function (b) { return b.sessions; })
  };

  const recent = events
    .slice()
    .sort(function (a, b) { return b.ts - a.ts; })
    .slice(0, 6)
    .map(eventToItem_);

  return {
    ok: true,
    stats: {
      uniqueUsers: Object.keys(visitorSet).length,
      visits: visits,
      downloads: downloads,
      attempts: attempts,
      success: success,
      sessions: sessions,
      successRate: attempts ? (success / attempts * 100) : null
    },
    trend: trend,
    recentActivity: recent,
    updatedAt: new Date().toISOString()
  };
}

/* ==========================================================================
   ADMIN — ANALYTICS  (period: today | 7d | 30d)
   ========================================================================== */
function adminAnalytics_(data) {
  if (!isAdmin_(data.token)) return { ok: false, error: "UNAUTHORIZED" };

  const period = ["today", "7d", "30d"].indexOf(String(data.period)) !== -1 ? String(data.period) : "7d";
  const range = getRangeForPeriod_(period);
  const prevRange = getPreviousRange_(range);
  const buckets = buildBuckets_(range);

  const rows = getRows_();
  const events = parseRows_(rows);
  const inRange = events.filter(function (ev) { return ev.ts >= range.start.getTime() && ev.ts <= range.end.getTime(); });
  const inPrevRange = events.filter(function (ev) { return ev.ts >= prevRange.start.getTime() && ev.ts < prevRange.end.getTime(); });

  const visitorSet = {};
  const catCounts = { download: 0, deteksi: 0, kunjungan: 0, lainnya: 0 };
  const fmtCounts = { "mp4-hd": 0, "mp4-sd": 0, mp3: 0, lainnya: 0 };
  let downloadRows = 0, successCount = 0;

  const perBucketUsers = buckets.map(function () { return {}; });

  inRange.forEach(function (ev) {
    if (ev.visitorId) visitorSet[ev.visitorId] = true;
    catCounts[ev.category]++;
    if (ev.action === "download") {
      downloadRows++;
      fmtCounts[ev.formatBucket]++;
    }
    if (ev.action === "success") successCount++;

    const bIdx = bucketIndexFor_(buckets, ev.ts);
    if (bIdx !== -1 && ev.visitorId) perBucketUsers[bIdx][ev.visitorId] = true;
  });

  const prevVisitorSet = {};
  let prevDownloads = 0, prevSuccess = 0;
  inPrevRange.forEach(function (ev) {
    if (ev.visitorId) prevVisitorSet[ev.visitorId] = true;
    if (ev.action === "download") prevDownloads++;
    if (ev.action === "success") prevSuccess++;
  });

  const totalEvents = inRange.length;
  const prevTotalEvents = inPrevRange.length;
  const uniqueUsers = Object.keys(visitorSet).length;
  const prevUniqueUsers = Object.keys(prevVisitorSet).length;

  const trend = {
    labels: buckets.map(function (b) { return b.key; }),
    uniqueUsers: perBucketUsers.map(function (u) { return Object.keys(u).length; })
  };

  const jenisAktivitas = ["download", "deteksi", "kunjungan", "lainnya"].map(function (key) {
    return {
      key: key,
      label: categoryLabel_(key),
      count: catCounts[key],
      percent: totalEvents ? round1_(catCounts[key] / totalEvents * 100) : 0
    };
  });

  const formatDownload = ["mp4-hd", "mp4-sd", "mp3", "lainnya"].map(function (key) {
    return {
      key: key,
      label: formatLabel_(key),
      count: fmtCounts[key],
      percent: downloadRows ? round1_(fmtCounts[key] / downloadRows * 100) : 0
    };
  });

  const recent = inRange
    .slice()
    .sort(function (a, b) { return b.ts - a.ts; })
    .slice(0, 5)
    .map(eventToItem_);

  return {
    ok: true,
    period: period,
    stats: {
      uniqueUsers: uniqueUsers,
      uniqueUsersChangePct: pctChange_(uniqueUsers, prevUniqueUsers),
      totalEvents: totalEvents,
      totalEventsChangePct: pctChange_(totalEvents, prevTotalEvents),
      totalDownloads: downloadRows,
      totalDownloadsChangePct: pctChange_(downloadRows, prevDownloads),
      deteksiBerhasil: successCount,
      deteksiBerhasilChangePct: pctChange_(successCount, prevSuccess)
    },
    trend: trend,
    jenisAktivitas: jenisAktivitas,
    formatDownload: formatDownload,
    recentActivity: recent,
    updatedAt: new Date().toISOString()
  };
}

/* ==========================================================================
   ADMIN — ACTIVITY (list + filter + pagination)
   ========================================================================== */
function adminActivity_(data) {
  if (!isAdmin_(data.token)) return { ok: false, error: "UNAUTHORIZED" };

  const filter = String(data.filter || "all");
  const offset = Math.max(0, parseInt(data.offset, 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(data.limit, 10) || 20));

  const rows = getRows_();
  let events = parseRows_(rows).sort(function (a, b) { return b.ts - a.ts; });
  if (filter !== "all") {
    events = events.filter(function (ev) { return ev.category === filter; });
  }

  const total = events.length;
  const page = events.slice(offset, offset + limit).map(eventToItem_);

  return {
    ok: true,
    items: page,
    total: total,
    offset: offset,
    limit: limit,
    hasMore: offset + limit < total,
    updatedAt: new Date().toISOString()
  };
}

/* ==========================================================================
   SYSTEM CONFIG (Maintenance) — disimpan di sheet SystemConfig
   ========================================================================== */
function getSystemConfigSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sh = ss.getSheetByName(CONFIG.SYSTEM_SHEET_NAME);
  if (!sh) { setup(); sh = ss.getSheetByName(CONFIG.SYSTEM_SHEET_NAME); }
  return sh;
}

function getSystemConfigMap_() {
  const sh = getSystemConfigSheet_();
  const map = {};
  if (sh.getLastRow() < 2) return map;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  rows.forEach(function (r) {
    const key = String(r[0] || "");
    if (key) map[key] = String(r[1] == null ? "" : r[1]);
  });
  return map;
}

function setSystemConfigValue_(key, value) {
  const sh = getSystemConfigSheet_();
  const lastRow = sh.getLastRow();
  let rowIndex = -1;
  if (lastRow >= 2) {
    const keys = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0] || "") === key) { rowIndex = i + 2; break; }
    }
  }
  if (rowIndex === -1) {
    sh.appendRow([key, value, new Date().toISOString()]);
  } else {
    sh.getRange(rowIndex, 2, 1, 2).setValues([[value, new Date().toISOString()]]);
  }
}

function getMaintenanceState_() {
  const map = getSystemConfigMap_();
  return {
    enabled: map.maintenance_enabled === "true",
    message: map.maintenance_message || "Unduhin sedang dalam pemeliharaan."
  };
}

function adminMaintenanceGet_(data) {
  if (!isAdmin_(data.token)) return { ok: false, error: "UNAUTHORIZED" };
  return { ok: true, maintenance: getMaintenanceState_() };
}

function adminMaintenanceSet_(data) {
  if (!isAdmin_(data.token)) return { ok: false, error: "UNAUTHORIZED" };
  if (typeof data.enabled !== "undefined") {
    setSystemConfigValue_("maintenance_enabled", data.enabled ? "true" : "false");
  }
  if (typeof data.message !== "undefined") {
    const msg = sanitize_(data.message).trim();
    setSystemConfigValue_("maintenance_message", msg || "Unduhin sedang dalam pemeliharaan.");
  }
  return { ok: true, maintenance: getMaintenanceState_() };
}

/* ==========================================================================
   API CONFIG (Failover) — disimpan di sheet APIConfig
   ========================================================================== */
function getApiConfigSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sh = ss.getSheetByName(CONFIG.API_SHEET_NAME);
  if (!sh) { setup(); sh = ss.getSheetByName(CONFIG.API_SHEET_NAME); }
  return sh;
}

// { providerId: true/false }. Provider yang belum punya baris dianggap enabled (default aman).
function getApiConfigMap_() {
  const sh = getApiConfigSheet_();
  const map = {};
  if (sh.getLastRow() >= 2) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    rows.forEach(function (r) {
      const id = String(r[0] || "");
      if (id) map[id] = String(r[1]) === "true";
    });
  }
  PROVIDERS_REGISTRY.forEach(function (p) {
    if (typeof map[p.id] === "undefined") map[p.id] = true;
  });
  return map;
}

function setApiConfigValue_(providerId, enabled) {
  const sh = getApiConfigSheet_();
  const lastRow = sh.getLastRow();
  let rowIndex = -1;
  if (lastRow >= 2) {
    const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || "") === providerId) { rowIndex = i + 2; break; }
    }
  }
  const value = enabled ? "true" : "false";
  if (rowIndex === -1) {
    sh.appendRow([providerId, value, new Date().toISOString()]);
  } else {
    sh.getRange(rowIndex, 2, 1, 2).setValues([[value, new Date().toISOString()]]);
  }
}

function providersWithConfig_() {
  const cfg = getApiConfigMap_();
  return PROVIDERS_REGISTRY.map(function (p) {
    return { id: p.id, label: p.label, name: p.name, enabled: cfg[p.id] !== false };
  });
}

function adminApiConfig_(data) {
  if (!isAdmin_(data.token)) return { ok: false, error: "UNAUTHORIZED" };
  return { ok: true, providers: providersWithConfig_(), updatedAt: new Date().toISOString() };
}

function adminApiToggle_(data) {
  if (!isAdmin_(data.token)) return { ok: false, error: "UNAUTHORIZED" };
  const providerId = String(data.providerId || "");
  const known = PROVIDERS_REGISTRY.some(function (p) { return p.id === providerId; });
  if (!known) return { ok: false, error: "UNKNOWN_PROVIDER" };
  setApiConfigValue_(providerId, !!data.enabled);
  return { ok: true, providers: providersWithConfig_(), updatedAt: new Date().toISOString() };
}

/* ==========================================================================
   API HEALTH MONITOR — cek langsung ke provider nyata (UrlFetchApp),
   dipanggil server-side supaya hasilnya tidak dipengaruhi CORS/jaringan
   browser admin. Provider yang sedang DISABLED tidak dipanggil (dianggap
   status DISABLED), sama seperti perilaku fallback di downloader.
   ========================================================================== */
function buildHealthCheckUrl_(provider, testUrl) {
  if (provider.kind === "proxy") {
    const inner = provider.base + encodeURIComponent(testUrl);
    return provider.proxyBase + encodeURIComponent(inner);
  }
  return provider.base + encodeURIComponent(testUrl);
}

function checkProviderHealth_(provider, testUrl) {
  const url = buildHealthCheckUrl_(provider, testUrl);
  const startedAt = Date.now();
  try {
    const res = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true, followRedirects: true });
    const elapsed = Date.now() - startedAt;
    const httpStatus = res.getResponseCode();

    if (httpStatus < 200 || httpStatus >= 400) {
      return { status: "ERROR", responseTimeMs: elapsed, httpStatus: httpStatus, error: "HTTP " + httpStatus };
    }
    const status = elapsed >= CONFIG.API_SLOW_THRESHOLD_MS ? "SLOW" : "ONLINE";
    return { status: status, responseTimeMs: elapsed, httpStatus: httpStatus, error: null };
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    const message = String(err && err.message || err);
    const isTimeout = /timeout|timed out|deadline/i.test(message);
    return { status: isTimeout ? "TIMEOUT" : "ERROR", responseTimeMs: elapsed, httpStatus: null, error: message };
  }
}

function adminApiHealth_(data) {
  if (!isAdmin_(data.token)) return { ok: false, error: "UNAUTHORIZED" };
  const cfg = getApiConfigMap_();
  const testUrl = CONFIG.HEALTH_CHECK_VIDEO_URL;
  const checkedAt = new Date().toISOString();

  const results = PROVIDERS_REGISTRY.map(function (provider) {
    const enabled = cfg[provider.id] !== false;
    if (!enabled) {
      return {
        id: provider.id, label: provider.label, name: provider.name, enabled: false,
        status: "DISABLED", responseTimeMs: null, httpStatus: null, error: null, checkedAt: checkedAt
      };
    }
    const result = checkProviderHealth_(provider, testUrl);
    return {
      id: provider.id, label: provider.label, name: provider.name, enabled: true,
      status: result.status, responseTimeMs: result.responseTimeMs, httpStatus: result.httpStatus,
      error: result.error, checkedAt: checkedAt
    };
  });

  return { ok: true, providers: results, checkedAt: checkedAt };
}

/* ==========================================================================
   PUBLIC CONFIG — dibaca oleh situs publik (maintenance overlay) dan oleh
   downloader (js/script.js) untuk tahu provider mana yang sedang
   dinonaktifkan admin. Tidak butuh token (dipakai pengunjung biasa), tapi
   tidak pernah mengizinkan perubahan apa pun — hanya baca.
   ========================================================================== */
function publicConfig_() {
  return {
    ok: true,
    maintenance: getMaintenanceState_(),
    providers: providersWithConfig_().map(function (p) { return { id: p.id, enabled: p.enabled }; }),
    updatedAt: new Date().toISOString()
  };
}

/* ==========================================================================
   HELPERS
   ========================================================================== */
function getRows_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
}

function parseRows_(rows) {
  return rows.map(function (r) {
    const tsDate = r[0] instanceof Date ? r[0] : new Date(r[0]);
    const action = String(r[2] || "");
    return {
      ts: tsDate.getTime(),
      tsIso: tsDate.toISOString(),
      visitorId: String(r[1] || ""),
      action: action,
      page: String(r[3] || ""),
      format: String(r[4] || ""),
      category: category_(action),
      formatBucket: formatBucket_(r[4])
    };
  }).filter(function (ev) { return !isNaN(ev.ts); });
}

function eventToItem_(ev) {
  return {
    time: ev.tsIso,
    action: ev.action,
    category: ev.category,
    categoryLabel: categoryLabel_(ev.category),
    page: ev.page,
    format: ev.action === "download" ? formatLabel_(ev.formatBucket) : "",
    visitorId: shortVisitorId_(ev.visitorId)
  };
}

function category_(action) {
  if (action === "download") return "download";
  if (action === "attempt" || action === "success") return "deteksi";
  if (action === "visit") return "kunjungan";
  return "lainnya";
}

function categoryLabel_(key) {
  return { download: "Download", deteksi: "Deteksi", kunjungan: "Kunjungan", lainnya: "Lainnya" }[key] || "Lainnya";
}

function formatBucket_(fmt) {
  const f = String(fmt || "").toLowerCase();
  if (f === "mp4-hd") return "mp4-hd";
  if (f === "mp4-sd") return "mp4-sd";
  if (f === "mp3") return "mp3";
  return "lainnya";
}

function formatLabel_(key) {
  return { "mp4-hd": "MP4 (HD)", "mp4-sd": "MP4 (SD)", mp3: "MP3", lainnya: "Lainnya" }[key] || "Lainnya";
}

function shortVisitorId_(id) {
  id = String(id || "");
  if (!id) return "V-000000";
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, id);
  const hex = digest.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length < 2 ? "0" + v : v;
  }).join("");
  return "V-" + hex.substring(0, 6).toUpperCase();
}

function scriptTz_() {
  try { return Session.getScriptTimeZone() || "Etc/UTC"; } catch (e) { return "Etc/UTC"; }
}

function startOfDaysAgo_(now, daysAgo) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 0, 0, 0, 0);
}

function getRangeForPeriod_(period) {
  const tz = scriptTz_();
  const now = new Date();
  if (period === "today") {
    const start = startOfDaysAgo_(now, 0);
    return { start: start, end: now, granularity: "hour", tz: tz, bucketCount: 24 };
  }
  if (period === "30d") {
    const start = startOfDaysAgo_(now, 29);
    return { start: start, end: now, granularity: "day", tz: tz, bucketCount: 30 };
  }
  const start = startOfDaysAgo_(now, 6);
  return { start: start, end: now, granularity: "day", tz: tz, bucketCount: 7 };
}

function getPreviousRange_(range) {
  const lengthMs = range.end.getTime() - range.start.getTime();
  const prevEnd = new Date(range.start.getTime());
  const prevStart = new Date(range.start.getTime() - lengthMs);
  return { start: prevStart, end: prevEnd };
}

function buildBuckets_(range) {
  const buckets = [];
  if (range.granularity === "hour") {
    const currentHour = range.end.getHours();
    for (let h = 0; h <= currentHour; h++) {
      const d = new Date(range.start.getTime());
      d.setHours(h, 0, 0, 0);
      buckets.push({ key: Utilities.formatDate(d, range.tz, "HH:00"), start: d.getTime(), end: d.getTime() + 3600000 });
    }
  } else {
    for (let i = range.bucketCount - 1; i >= 0; i--) {
      const d = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate() - i, 0, 0, 0, 0);
      const startMs = d.getTime();
      buckets.push({ key: Utilities.formatDate(d, range.tz, "dd/MM"), start: startMs, end: startMs + 86400000 });
    }
  }
  return buckets;
}

function bucketIndexFor_(buckets, ts) {
  for (let i = 0; i < buckets.length; i++) {
    if (ts >= buckets[i].start && ts < buckets[i].end) return i;
  }
  if (buckets.length && ts === buckets[buckets.length - 1].end) return buckets.length - 1;
  return -1;
}

function pctChange_(current, previous) {
  if (!previous) return current ? 100 : 0;
  return round1_((current - previous) / previous * 100);
}

function round1_(n) {
  return Math.round(n * 10) / 10;
}

function sanitize_(value) {
  const s = String(value == null ? "" : value);
  return s.length > 500 ? s.slice(0, 500) : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
