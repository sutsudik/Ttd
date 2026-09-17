/* ==========================================================================
   TikTok Video Downloader — front-end interaction layer
   --------------------------------------------------------------------------
   INTEGRASI API — 100% client-side, tanpa backend/server sendiri.

   Halaman ini TIDAK berisi data video contoh/dummy. Semua data (akun,
   caption, thumbnail, likes, komentar, share, tautan unduhan) hanya
   tampil jika benar-benar dikembalikan oleh salah satu sumber di bawah.

   SISTEM MULTI-API AUTO FALLBACK (sequential, bukan paralel):
     API 1 — Yoinku            → CONFIG.YOINKU_BASE
     API 2 — tdownv4           → CONFIG.TDOWNV4_BASE (Cloudflare Worker publik)
     API 3 — TikWM             → CONFIG.TIKWM_BASE (tikwm.com/api, langsung)
     API 4 — TikWM via proxy   → CONFIG.PROXY_BASE (jalur CORS cadangan ke
                                   TikWM lewat proxy publik, dipakai kalau
                                   API 3 diblokir CORS di origin tertentu)

   ATURAN PALING PENTING: LAMBAT ≠ pindah API. LIMIT = pindah API.
   BERHASIL = STOP. SEMUA LIMIT/GAGAL = STOP.

   Untuk tiap request video, keempat sumber dicoba SATU PER SATU (bukan
   sekaligus, tidak dijalankan bersamaan) dengan urutan tetap di atas:
     - Selama sebuah sumber masih memproses, kode TETAP MENUNGGU respons
       — TIDAK ADA timeout pendek (2-3 detik) yang dipakai sebagai alasan
       pindah API. Prosesnya boleh lama, itu bukan alasan untuk berganti
       sumber. (CONFIG.SAFETY_TIMEOUT_MS hanya jaring pengaman teknis agar
       browser tidak menunggu selamanya kalau koneksi benar-benar macet —
       nilainya sengaja dibuat sangat besar/longgar, bukan patokan "lambat".)
     - Kalau sebuah sumber berhasil dan mengembalikan download_url yang
       valid → dipakai langsung dan proses BERHENTI, sumber berikutnya
       TIDAK dipanggil sama sekali.
     - Kalau sebuah sumber kena limit (HTTP 429 atau body mengandung
       indikasi "quota exceeded" / "rate limit" / "limit reached" / tanda
       limit lain), sumber itu ditandai cooldown selama CONFIG.COOLDOWN_MS
       milidetik supaya tidak dicoba lagi berulang-ulang di request
       berikutnya selama masa cooldown (mencegah infinite loop), lalu baru
       lanjut ke sumber berikutnya.
     - Kalau sebuah sumber benar-benar gagal (error jaringan/server, atau
       respons tidak valid — BUKAN karena lambat) → lanjut ke sumber
       berikutnya.
     - Kalau semua sumber sudah kena limit/gagal → error jelas ditampilkan
       ke pengguna dan loading dihentikan (lihat fetchVideoData &
       handleDetect). Tidak ada retry otomatis/infinite loop.

   Setiap sumber punya fungsi handler + normalizer sendiri (callYoinku,
   callTdownv4, callTikwmDirect, callTikwmViaProxy) yang mengubah bentuk
   respons masing-masing API ke satu bentuk standar yang sama:
     { author, caption, thumbnailUrl, likes, comments, shares, downloadUrls,
       duration, sizeBytes }

   CATATAN JUJUR soal API 1 (Yoinku): pada saat kode ini ditulis, Yoinku
   tidak memiliki dokumentasi publik resmi yang bisa diverifikasi, jadi
   CONFIG.YOINKU_BASE & normalizeYoinku() di bawah adalah dugaan terbaik
   berdasarkan pola umum API sejenis (parameter "url", field seperti
   download_url/video_url). Karena ini adalah sistem FALLBACK, kalaupun
   endpoint/format Yoinku ternyata berbeda, permintaan ke sana akan gagal
   dengan aman (network error/timeout ≤3 detik) dan otomatis lanjut ke
   API 2 (tdownv4) tanpa mengganggu pengguna sama sekali. Kalau Anda tahu
   endpoint & format respons Yoinku yang sebenarnya, tinggal sesuaikan
   CONFIG.YOINKU_BASE dan isi function normalizeYoinku() di bawah.

   Semua permintaan pakai fetch() GET biasa tanpa header kustom (supaya
   tidak memicu CORS preflight) dan TANPA mode "no-cors" — jika sebuah
   sumber diblokir CORS oleh browser, fetch-nya akan gagal (TypeError) dan
   kode otomatis lanjut ke sumber berikutnya, sama seperti error jaringan.

   Kalau sumber yang berhasil datanya kurang lengkap (tanpa sampul video /
   jumlah komentar / share — ini sering terjadi pada Yoinku & tdownv4),
   kode diam-diam melengkapi field yang kosong dari TikWM tanpa mengganti
   tautan video utama yang sudah didapat. Field yang tetap tidak tersedia
   dari semua sumber ditampilkan sebagai "—", bukan angka rekaan.
   ========================================================================== */

const CONFIG = {
  YOINKU_BASE: "https://yoinku.vercel.app/api/tiktok?url=", // TODO: verifikasi endpoint resmi Yoinku, lihat catatan di atas
  TDOWNV4_BASE: "https://tdownv4.sl-bjs.workers.dev/?down=",
  TIKWM_BASE: "https://www.tikwm.com/api/?url=",
  PROXY_BASE: "https://api.allorigins.win/raw?url=",
  // Jaring pengaman TEKNIS saja (bukan aturan "lambat = pindah API"). Kalau
  // sebuah API memang masih memproses, kode menunggu — nilai ini sengaja
  // dibuat sangat longgar (60 detik) supaya tidak pernah kepicu oleh proses
  // yang wajar-lambat, hanya oleh koneksi yang benar-benar macet total.
  SAFETY_TIMEOUT_MS: 60000,
  ENRICH_TIMEOUT_MS: 8000,
  COOLDOWN_MS: 2 * 60 * 1000, // API yang kena limit "diistirahatkan" 2 menit sebelum dicoba lagi
};

(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     Utilities
     --------------------------------------------------------------------- */

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function formatCompact(n) {
    return new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  }

  // Durasi (detik) -> "m:ss". Tidak valid/tidak tersedia -> null (tampil "—").
  function formatDuration(seconds) {
    if (!isFiniteNumber(seconds) || seconds < 0) return null;
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  // Ukuran berkas (byte) -> "x.x MB" dsb. Tidak valid/tidak tersedia -> null ("—").
  function formatFileSize(bytes) {
    if (!isFiniteNumber(bytes) || bytes <= 0) return null;
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    const decimals = i === 0 || value >= 10 ? 0 : 1;
    return value.toFixed(decimals) + " " + units[i];
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------------
     API integration — Multi-API Auto Fallback
     --------------------------------------------------------------------- */

  // Error yang ditampilkan ke pengguna (pesan akhir setelah semua API dicoba)
  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  // Error internal per-provider, dipakai untuk klasifikasi & logging saja —
  // tidak pernah ditampilkan langsung ke pengguna.
  class ProviderRateLimitError extends Error {}
  class ProviderTimeoutError extends Error {}
  class ProviderNetworkError extends Error {}
  class ProviderInvalidResponseError extends Error {}

  function isFiniteNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    return fetch(url, { method: "GET", signal: controller.signal }).finally(() =>
      clearTimeout(id)
    );
  }

  // Deteksi tanda-tanda limit/quota habis di body respons (teks mentah,
  // jadi mencakup JSON yang belum di-parse maupun pesan teks biasa).
  function looksRateLimited(rawText) {
    return /quota\s*exceeded|rate\s*limit|limit\s*reached|too\s*many\s*requests/i.test(
      rawText || ""
    );
  }

  // Ambil respons mentah dari sebuah provider. Kode MENUNGGU sampai
  // respons datang — "ms" di sini hanya jaring pengaman teknis (sangat
  // longgar, lihat CONFIG.SAFETY_TIMEOUT_MS) untuk koneksi yang benar-benar
  // macet, BUKAN dipakai sebagai alasan "lambat maka pindah API". Deteksi
  // limit (HTTP 429 atau tanda di body) dilakukan di sini juga, lalu coba
  // parse JSON. Melempar error yang sudah terklasifikasi (rate limit /
  // macet total / jaringan) supaya fetchVideoData tahu persis kenapa
  // provider ini gagal.
  async function fetchProviderRaw(url, ms) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    let res;
    try {
      res = await fetch(url, { method: "GET", signal: controller.signal });
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new ProviderTimeoutError("tidak ada respons sama sekali setelah " + ms + "ms (koneksi macet)");
      }
      throw new ProviderNetworkError((err && err.message) || "network error");
    } finally {
      clearTimeout(id);
    }

    const text = await res.text();

    if (res.status === 429 || looksRateLimited(text)) {
      throw new ProviderRateLimitError("rate limited (HTTP " + res.status + ")");
    }
    if (!res.ok) {
      throw new ProviderNetworkError("HTTP " + res.status);
    }

    try {
      return JSON.parse(text);
    } catch (err) {
      throw new ProviderInvalidResponseError("respons bukan JSON yang valid");
    }
  }

  /* ---- Normalizer: respons Yoinku -> bentuk standar (lihat catatan di header file) ---- */
  function normalizeYoinku(json) {
    if (!json) return null;
    const root = json.data || json.result || json;
    const downloadUrl =
      root.download_url ||
      root.downloadUrl ||
      root.video_url ||
      root.videoUrl ||
      (root.video && (root.video.no_watermark || root.video.noWatermark || root.video.url)) ||
      null;
    if (!downloadUrl) return null;

    const author = root.author || {};
    const handle = author.username || author.unique_id || author.nickname || root.author_name;

    return {
      author: handle ? "@" + String(handle).replace(/^@/, "") : "—",
      caption: root.title || root.caption || root.desc || "Tanpa keterangan.",
      thumbnailUrl: root.cover || root.thumbnail || root.thumb || null,
      likes: isFiniteNumber(root.likes || root.digg_count) ? root.likes || root.digg_count : null,
      comments: isFiniteNumber(root.comments || root.comment_count)
        ? root.comments || root.comment_count
        : null,
      shares: isFiniteNumber(root.shares || root.share_count) ? root.shares || root.share_count : null,
      duration: isFiniteNumber(root.duration) ? root.duration : null,
      sizeBytes: isFiniteNumber(root.size || root.filesize) ? root.size || root.filesize : null,
      downloadUrls: {
        "mp4-hd": downloadUrl,
        "mp4-sd": root.download_url_sd || root.downloadUrlSd || downloadUrl,
        mp3: root.music_url || root.audio_url || null,
      },
    };
  }

  /* ---- Normalizer: respons tdownv4.sl-bjs.workers.dev -> bentuk standar ---- */
  function normalizeTdownv4(json) {
    if (!json || !json.download_url) return null;
    const author = json.author || {};
    const handle = author.username || author.nickname;
    if (!handle) return null;
    return {
      author: "@" + String(handle).replace(/^@/, ""),
      caption: json.title || "Tanpa keterangan.",
      thumbnailUrl: null, // sumber ini tidak mengirim sampul video
      likes: isFiniteNumber(author.like_count) ? author.like_count : null,
      comments: null, // tidak disediakan oleh sumber ini
      shares: null, // tidak disediakan oleh sumber ini
      duration: null, // tidak disediakan oleh sumber ini
      sizeBytes: null, // tidak disediakan oleh sumber ini
      downloadUrls: {
        "mp4-hd": json.download_url,
        "mp4-sd": json.download_url,
        mp3: author.audio_url || null,
      },
    };
  }

  /* ---- Normalizer: respons tikwm.com/api -> bentuk standar ---- */
  function normalizeTikwm(json) {
    if (!json || json.code !== 0 || !json.data) return null;
    const d = json.data;
    const video = d.hdplay || d.play;
    if (!video) return null;
    const author = d.author || {};
    const handle = author.unique_id || author.nickname;
    if (!handle) return null;
    return {
      author: "@" + String(handle).replace(/^@/, ""),
      caption: d.title || "Tanpa keterangan.",
      thumbnailUrl: d.cover || d.origin_cover || null,
      likes: isFiniteNumber(d.digg_count) ? d.digg_count : null,
      comments: isFiniteNumber(d.comment_count) ? d.comment_count : null,
      shares: isFiniteNumber(d.share_count) ? d.share_count : null,
      duration: isFiniteNumber(d.duration) ? d.duration : null,
      sizeBytes: isFiniteNumber(d.hd_size || d.size) ? d.hd_size || d.size : null,
      downloadUrls: {
        "mp4-hd": d.hdplay || d.play,
        "mp4-sd": d.play || d.hdplay,
        mp3: d.music || null,
      },
    };
  }

  /* ---- Handler API 1: Yoinku ---- */
  async function callYoinku(tiktokUrl) {
    const json = await fetchProviderRaw(
      CONFIG.YOINKU_BASE + encodeURIComponent(tiktokUrl),
      CONFIG.SAFETY_TIMEOUT_MS
    );
    const normalized = normalizeYoinku(json);
    if (!normalized) throw new ProviderInvalidResponseError("yoinku: respons tidak berisi video yang valid");
    return normalized;
  }

  /* ---- Handler API 2: tdownv4 ---- */
  async function callTdownv4(tiktokUrl) {
    const json = await fetchProviderRaw(
      CONFIG.TDOWNV4_BASE + encodeURIComponent(tiktokUrl),
      CONFIG.SAFETY_TIMEOUT_MS
    );
    const normalized = normalizeTdownv4(json);
    if (!normalized) throw new ProviderInvalidResponseError("tdownv4: respons tidak berisi video yang valid");
    return normalized;
  }

  /* ---- Handler API 3: TikWM (langsung) ---- */
  async function callTikwmDirect(tiktokUrl) {
    const json = await fetchProviderRaw(
      CONFIG.TIKWM_BASE + encodeURIComponent(tiktokUrl),
      CONFIG.SAFETY_TIMEOUT_MS
    );
    const normalized = normalizeTikwm(json);
    if (!normalized) throw new ProviderInvalidResponseError("tikwm: respons tidak berisi video yang valid");
    return normalized;
  }

  /* ---- Handler API 4: TikWM via proxy CORS (cadangan) ---- */
  async function callTikwmViaProxy(tiktokUrl) {
    const inner = CONFIG.TIKWM_BASE + encodeURIComponent(tiktokUrl);
    const json = await fetchProviderRaw(
      CONFIG.PROXY_BASE + encodeURIComponent(inner),
      CONFIG.SAFETY_TIMEOUT_MS
    );
    const normalized = normalizeTikwm(json);
    if (!normalized) throw new ProviderInvalidResponseError("tikwm(proxy): respons tidak berisi video yang valid");
    return normalized;
  }

  // Best-effort: kalau sumber yang berhasil datanya kurang lengkap (tanpa
  // sampul/komentar/share), diam-diam lengkapi dari TikWM tanpa mengganti
  // tautan video utama yang sudah didapat. Ini BUKAN bagian dari rantai
  // fallback — kegagalan di sini tidak menggagalkan proses, data dari
  // sumber utama tetap dipakai apa adanya.
  async function enrichIfIncomplete(data, tiktokUrl) {
    const needsEnrich =
      !data.thumbnailUrl ||
      data.comments === null ||
      data.shares === null ||
      data.duration === null ||
      data.sizeBytes === null;
    if (!needsEnrich) return data;

    try {
      const res = await fetchWithTimeout(
        CONFIG.TIKWM_BASE + encodeURIComponent(tiktokUrl),
        CONFIG.ENRICH_TIMEOUT_MS
      );
      if (!res.ok) return data;
      const json = await res.json();
      const extra = normalizeTikwm(json);
      if (!extra) return data;
      return {
        author: data.author,
        caption: data.caption,
        thumbnailUrl: data.thumbnailUrl || extra.thumbnailUrl,
        likes: data.likes === null ? extra.likes : data.likes,
        comments: data.comments === null ? extra.comments : data.comments,
        shares: data.shares === null ? extra.shares : data.shares,
        duration: data.duration === null ? extra.duration : data.duration,
        sizeBytes: data.sizeBytes === null ? extra.sizeBytes : data.sizeBytes,
        downloadUrls: {
          "mp4-hd": data.downloadUrls["mp4-hd"] || extra.downloadUrls["mp4-hd"],
          "mp4-sd": data.downloadUrls["mp4-sd"] || extra.downloadUrls["mp4-sd"],
          mp3: data.downloadUrls.mp3 || extra.downloadUrls.mp3,
        },
      };
    } catch (err) {
      return data; // pengaya gagal — tetap pakai data dari sumber utama
    }
  }

  // Urutan provider tetap: Yoinku → tdownv4 → TikWM → TikWM(proxy).
  // cooldownUntil menyimpan, per provider, sampai kapan (timestamp ms) ia
  // "diistirahatkan" karena kena limit — supaya request berikutnya tidak
  // terus-menerus mencoba provider yang sama selama masa cooldown itu.
  const PROVIDERS = [
    { id: "yoinku", label: "API 1", name: "Yoinku", call: callYoinku },
    { id: "tdownv4", label: "API 2", name: "tdownv4", call: callTdownv4 },
    { id: "tikwm", label: "API 3", name: "TikWM", call: callTikwmDirect },
    { id: "tikwm-proxy", label: "API 4", name: "TikWM(proxy)", call: callTikwmViaProxy },
  ];
  const cooldownUntil = Object.create(null);

  /* ---------------------------------------------------------------------
     API Failover Control (dikelola dari admin panel → SYSTEM → API
     FAILOVER). Provider yang di-disable admin tidak boleh dipanggil sama
     sekali oleh downloader, tapi kalau backend tidak terhubung/gagal
     dihubungi, kode ini "gagal aman" (fail-open) dan tetap menganggap
     semua provider enabled — supaya downloader tidak pernah rusak hanya
     karena backend admin sedang bermasalah. Config diambil sekali di awal
     lalu di-cache singkat (bukan polling agresif).
     --------------------------------------------------------------------- */
  let remoteProviderConfig = null; // null = belum dimuat -> anggap semua enabled
  let remoteConfigFetchedAt = 0;
  const REMOTE_CONFIG_TTL_MS = 5 * 60 * 1000;

  async function loadRemoteProviderConfig() {
    if (!(window.UnduhinBackend && window.UnduhinBackend.isConfigured())) return;
    if (remoteProviderConfig && Date.now() - remoteConfigFetchedAt < REMOTE_CONFIG_TTL_MS) return;
    try {
      const res = await window.UnduhinBackend.request({ action: "publicConfig" });
      if (res && res.ok && Array.isArray(res.providers)) {
        const map = Object.create(null);
        res.providers.forEach((p) => {
          if (p && p.id) map[p.id] = p.enabled !== false;
        });
        remoteProviderConfig = map;
        remoteConfigFetchedAt = Date.now();
      }
    } catch (err) {
      // gagal ambil config → biarkan remoteProviderConfig apa adanya
      // (fail-open kalau belum pernah berhasil sama sekali)
    }
  }

  function isProviderEnabled(providerId) {
    if (!remoteProviderConfig) return true; // belum ada data -> anggap enabled
    if (typeof remoteProviderConfig[providerId] === "undefined") return true;
    return remoteProviderConfig[providerId] !== false;
  }

  async function fetchVideoData(url) {
    await loadRemoteProviderConfig();

    let lastError = null;
    let attemptedAny = false;
    let result = null;

    for (let i = 0; i < PROVIDERS.length; i++) {
      const provider = PROVIDERS[i];
      const nextLabel = PROVIDERS[i + 1] ? PROVIDERS[i + 1].label : null;

      if (!isProviderEnabled(provider.id)) {
        console.log("[" + provider.label + "] Disabled by admin → skipping");
        continue;
      }

      const cd = cooldownUntil[provider.id];
      if (cd && cd > Date.now()) {
        console.log("[" + provider.label + "] Still limited (cooldown) → skipping");
        continue;
      }

      attemptedAny = true;
      console.log("[" + provider.label + "] Processing...");

      try {
        // Menunggu sampai provider ini benar-benar merespons — proses yang
        // lama BUKAN alasan untuk pindah ke provider berikutnya.
        const data = await provider.call(url);
        console.log("[" + provider.label + "] Success");
        result = data;
        break; // sudah dapat download_url valid → STOP, jangan panggil API lain
      } catch (err) {
        lastError = err;
        if (err instanceof ProviderRateLimitError) {
          // Satu-satunya alasan resmi untuk pindah API: limit/quota habis.
          cooldownUntil[provider.id] = Date.now() + CONFIG.COOLDOWN_MS;
          console.log(
            "[" + provider.label + "] Limit reached" + (nextLabel ? " → switching to " + nextLabel : " → no more APIs left")
          );
        } else {
          // Kegagalan nyata (bukan sekadar lambat): error jaringan/server,
          // respons tidak valid, atau koneksi benar-benar macet total.
          console.log(
            "[" + provider.label + "] Failed" + (nextLabel ? " → switching to " + nextLabel : " → no more APIs left")
          );
        }
        // lanjut ke provider berikutnya (sequential, satu per satu, bukan paralel)
      }
    }

    if (result) {
      return enrichIfIncomplete(result, url);
    }

    // Semua provider gagal, atau semua sedang cooldown — hentikan di sini,
    // jangan retry otomatis (mencegah infinite loop). handleDetect() di
    // initFlow() yang menghentikan spinner & menampilkan pesan ini.
    if (!attemptedAny) {
      throw new ApiError(
        "ALL_RATE_LIMITED",
        "Semua sumber unduhan sedang mencapai batas penggunaan (limit). Coba lagi dalam beberapa menit."
      );
    }

    if (lastError instanceof ProviderRateLimitError) {
      throw new ApiError(
        "ALL_RATE_LIMITED",
        "Semua sumber unduhan sedang mencapai batas penggunaan (limit). Coba lagi dalam beberapa menit."
      );
    }
    if (lastError instanceof ProviderTimeoutError || lastError instanceof ProviderNetworkError) {
      throw new ApiError(
        "NETWORK_ERROR",
        "Tidak dapat menghubungi sumber video (koneksi terputus, lambat, atau diblokir browser). Coba lagi beberapa saat."
      );
    }
    throw new ApiError(
      "REQUEST_FAILED",
      "Video tidak dapat dibaca dari semua sumber yang tersedia. Pastikan link TikTok valid, publik, dan bukan video privat."
    );
  }

  // Nama file unduhan dari handle akun + format, mis. "tiktok-studio-senja-hd.mp4".
  // Karakter di luar huruf/angka/-/_ dibuang supaya aman dipakai di semua OS.
  function buildFileName(format, data) {
    const ext = format === "mp3" ? "mp3" : "mp4";
    const suffix = format === "mp4-sd" ? "sd" : format === "mp3" ? "audio" : "hd";
    const rawHandle = data && data.author ? String(data.author).replace(/^@/, "") : "";
    const safeHandle = rawHandle
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return "tiktok-" + (safeHandle || "video") + "-" + suffix + "." + ext;
  }

  // Unduhan LANGSUNG (bukan buka tab baru): fetch() file sebagai Blob lalu
  // picu simpan-berkas lewat <a download>. Kalau fetch() gagal karena CORS
  // diblokir browser atau jaringan bermasalah, error dilempar ke pemanggil
  // (initFlow) supaya ditampilkan sebagai kegagalan yang jujur — TIDAK ADA
  // fallback yang membuka fileUrl di tab baru, karena itu cuma pratinjau,
  // bukan unduhan sungguhan.
  async function startDownload(fileUrl, fileName) {
    let res;
    try {
      res = await fetch(fileUrl, { method: "GET" });
    } catch (err) {
      // Umumnya fetch gagal total karena CORS diblokir browser
      // (TypeError "Failed to fetch") atau koneksi terputus.
      throw new ApiError("DOWNLOAD_BLOCKED", "Gagal mengunduh. Silakan coba lagi.");
    }
    if (!res.ok) {
      throw new ApiError("DOWNLOAD_FAILED", "Gagal mengunduh. Silakan coba lagi.");
    }

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Object URL dibersihkan sedikit ditunda supaya browser sempat memulai
    // proses simpan-berkas dahulu (mencegah memory leak).
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  }

  /* ---------------------------------------------------------------------
     Scroll-reveal (IntersectionObserver) — fade / stagger / blur-to-sharp
     --------------------------------------------------------------------- */

  function initRevealObserver() {
    const targets = qsa("[data-reveal], [data-stagger], .step");
    if (!targets.length) return;

    if (prefersReducedMotion) {
      targets.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" }
    );

    targets.forEach((el) => io.observe(el));
  }

  function initEndingReveal() {
    const lines = qsa("[data-stagger-word]");
    if (!lines.length) return;

    if (prefersReducedMotion) {
      lines.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target;
            const index = lines.indexOf(el);
            setTimeout(() => el.classList.add("is-visible"), index * 250);
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.4 }
    );
    lines.forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------------------
     Progress rail (desktop) — highlights current section
     --------------------------------------------------------------------- */

  function initRail() {
    const rail = qs("#rail");
    if (!rail) return;
    const dots = qsa(".rail-dot", rail);
    const sectionMap = {
      hero: qs("#hero"),
      stats: qs("#stepStats"),
      download: qs("#stepDownload"),
      howto: qs("#howto"),
    };

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const key = Object.keys(sectionMap).find((k) => sectionMap[k] === entry.target);
          dots.forEach((d) => d.classList.toggle("is-active", d.dataset.rail === key));
        });
      },
      { threshold: 0.5 }
    );

    Object.values(sectionMap).forEach((el) => el && io.observe(el));
    rail.classList.add("is-visible");
  }

  /* ---------------------------------------------------------------------
     Number counter: 0 → 1 → 10 → 100 → 1K → ... → angka asli dari API
     --------------------------------------------------------------------- */

  function magnitudeSteps(target) {
    const steps = [0, 1, 10, 100, 1000, 10000, 100000, 1000000, 10000000];
    return steps.filter((s) => s < target);
  }

  function animateCounter(el, target, opts) {
    opts = opts || {};
    const totalDuration = opts.duration || 1800;

    if (prefersReducedMotion) {
      el.textContent = formatCompact(target);
      return;
    }

    const checkpoints = magnitudeSteps(target).concat([target]);
    const stepDuration = totalDuration / checkpoints.length;
    let i = 0;

    function nextStep() {
      if (i >= checkpoints.length) {
        el.textContent = formatCompact(target); // berhenti tepat di angka asli dari API
        return;
      }
      const from = i === 0 ? 0 : checkpoints[i - 1];
      const to = checkpoints[i];
      const start = performance.now();

      function tick(now) {
        const p = Math.min(1, (now - start) / stepDuration);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = Math.round(from + (to - from) * eased);
        el.textContent = formatCompact(val);
        if (p < 1) {
          requestAnimationFrame(tick);
        } else {
          i++;
          nextStep();
        }
      }
      requestAnimationFrame(tick);
    }
    nextStep();
  }

  /* ---------------------------------------------------------------------
     Main flow controller
     --------------------------------------------------------------------- */

  function initFlow() {
    const form = qs("#linkForm");
    const input = qs("#tiktokUrl");
    const submitBtn = qs("#submitBtn");
    const hint = qs("#formHint");
    const hintDefaultText = hint.textContent;
    const flow = qs("#flow");
    const clearBtn = qs("#linkClearBtn");
    const pasteBtn = qs("#linkPasteBtn");

    const videoCard = qs("#videoCard");
    const videoThumb = qs("#videoThumb");
    const videoScan = qs("#videoScan");
    const videoBadge = qs("#videoBadge");
    const videoBadgeText = qs("#videoBadgeText");
    const videoAuthor = qs("#videoAuthor");
    const videoCaption = qs("#videoCaption");
    const videoDuration = qs("#videoDuration");
    const videoSize = qs("#videoSize");
    const placeholderPoster = videoThumb.getAttribute("poster");

    const statStats = qs("#stepStats");
    const statRows = qsa("#statList .stat-row");
    let statsAnimated = false;

    const downloadOptions = qsa(".download-option");
    const downloadStatus = qs("#downloadStatus");

    let currentData = null;
    let isProcessing = false;

    // Kalau video gagal diputar (mis. sumbernya memblokir hotlink dari luar
    // TikTok — beda dari soal CORS di tombol Download), jangan biarkan
    // player terlihat seperti rusak diam-diam. Ditandai hanya saat memang
    // sedang menampilkan hasil ("ready"), supaya reset/idle tidak salah
    // terdeteksi sebagai error.
    videoThumb.addEventListener("error", () => {
      if (flow.dataset.state !== "ready") return;
      videoThumb.classList.add("is-broken");
      videoThumb.removeAttribute("controls");
      videoBadge.classList.remove("is-ready");
      videoBadgeText.textContent = "Pratinjau tidak tersedia";
    });

    function isLikelyTikTokUrl(value) {
      return /tiktok\.com\//i.test(value.trim());
    }

    function updateClearVisibility() {
      if (clearBtn) clearBtn.hidden = input.value.trim().length === 0;
    }

    updateClearVisibility();
    input.addEventListener("input", updateClearVisibility);

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        input.value = "";
        updateClearVisibility();
        hint.textContent = hintDefaultText;
        hint.classList.remove("is-error", "is-success");
        input.focus();
      });
    }

    if (pasteBtn) {
      pasteBtn.addEventListener("click", async () => {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          hint.textContent = "Browser ini tidak mendukung tempel otomatis. Tempel manual dengan Ctrl+V / long-press.";
          hint.classList.add("is-error");
          input.focus();
          return;
        }
        try {
          const text = (await navigator.clipboard.readText()).trim();
          if (text) {
            input.value = text;
            updateClearVisibility();
            hint.textContent = hintDefaultText;
            hint.classList.remove("is-error", "is-success");
          }
        } catch (err) {
          hint.textContent = "Gagal mengambil dari clipboard. Izinkan akses clipboard di browser, lalu coba lagi.";
          hint.classList.add("is-error");
        } finally {
          input.focus();
        }
      });
    }

    // Result (#flow) tetap "display: none" (tanpa ruang kosong) sampai video
    // valid berhasil dideteksi. showResult()/hideResult() mengatur transisi
    // yang halus: display diaktifkan dulu, lalu opacity/transform di-animasi
    // pada frame berikutnya (trik dua-rAF, karena display:none tidak bisa
    // langsung ditransisikan).
    function showResult() {
      flow.classList.add("is-visible-block");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          flow.classList.add("is-revealed");
        });
      });
    }

    function hideResult() {
      flow.classList.remove("is-revealed", "is-visible-block");
    }

    function resetFlowVisuals() {
      hideResult();
      videoCard.classList.remove("is-ready");
      videoThumb.classList.remove("is-sharp", "is-broken");
      videoThumb.pause();
      videoThumb.removeAttribute("src");
      videoThumb.setAttribute("controls", "");
      videoThumb.setAttribute("poster", placeholderPoster);
      videoThumb.load();
      videoScan.classList.remove("is-active");
      videoBadge.classList.remove("is-ready");
      videoBadgeText.textContent = "Menunggu link";
      videoAuthor.textContent = "—";
      videoCaption.textContent = "Pratinjau akan muncul di sini setelah video terdeteksi.";
      videoDuration.textContent = "—";
      videoSize.textContent = "—";
      statRows.forEach((row) => {
        row.querySelector(".stat-value").textContent = "0";
      });
      statsAnimated = false;
      downloadOptions.forEach((btn) => btn.classList.remove("is-downloading", "is-done"));
      downloadStatus.textContent = "";
      flow.dataset.state = "idle";
      currentData = null;
    }

    async function handleDetect(url) {
      if (isProcessing) return;
      isProcessing = true;

      hint.textContent = "Menghubungi server untuk membaca video…";
      hint.classList.remove("is-error", "is-success");
      submitBtn.classList.add("is-loading");
      flow.dataset.state = "detecting";

      // Persiapan visual video card berjalan di latar belakang, tapi #flow
      // masih "display: none" — tidak ada apa pun yang terlihat sampai
      // proses berhasil dan showResult() dipanggil di bawah.
      videoBadge.classList.remove("is-ready");
      videoBadgeText.textContent = "Menganalisis…";
      videoScan.classList.add("is-active");
      videoCard.classList.add("is-ready");

      try {
        const data = await fetchVideoData(url);
        currentData = data;

        // Statistik nyata (lihat js/stats.js) — dicatat hanya saat video
        // BENAR-BENAR berhasil dideteksi, bukan angka rekaan.
        if (window.UnduhinStats) {
          window.UnduhinStats.recordAttempt();
          window.UnduhinStats.recordSuccess();
        }

        videoScan.classList.remove("is-active");
        if (data.thumbnailUrl) {
          videoThumb.setAttribute("poster", data.thumbnailUrl);
        }
        const playableUrl =
          (data.downloadUrls && (data.downloadUrls["mp4-hd"] || data.downloadUrls["mp4-sd"])) || null;
        if (playableUrl) {
          videoThumb.setAttribute("src", playableUrl);
          videoThumb.load();
        }
        videoThumb.classList.add("is-sharp");
        videoBadge.classList.add("is-ready");
        videoBadgeText.textContent = "Geser untuk mendownload";
        videoAuthor.textContent = data.author;
        videoCaption.textContent = data.caption;
        videoDuration.textContent = formatDuration(data.duration) || "—";
        videoSize.textContent = formatFileSize(data.sizeBytes) || "—";

        hint.textContent = "Video ditemukan — gulir ke bawah untuk melihat detailnya.";
        hint.classList.add("is-success");

        flow.dataset.state = "ready";
        showResult();

        qs("#flow").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
      } catch (err) {
        currentData = null;

        // Percobaan yang gagal tetap dihitung sebagai "attempt" asli supaya
        // Success Rate di halaman Statistik mencerminkan pemakaian nyata.
        if (window.UnduhinStats) {
          window.UnduhinStats.recordAttempt();
        }

        flow.dataset.state = "error";
        hideResult();
        videoScan.classList.remove("is-active");
        videoBadge.classList.remove("is-ready");
        videoBadgeText.textContent = "Gagal memuat";
        videoAuthor.textContent = "—";

        const message = err instanceof ApiError ? err.message : "Video tidak dapat dibaca. Coba lagi.";
        videoCaption.textContent = message;

        hint.textContent = message;
        hint.classList.add("is-error");
      } finally {
        submitBtn.classList.remove("is-loading");
        isProcessing = false;
      }
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) {
        hint.textContent = "Tempel link video TikTok terlebih dahulu.";
        hint.classList.add("is-error");
        return;
      }
      if (!isLikelyTikTokUrl(value)) {
        hint.textContent = "Sepertinya itu bukan link TikTok. Contoh: tiktok.com/@akun/video/123";
        hint.classList.add("is-error");
        return;
      }
      resetFlowVisuals();
      handleDetect(value);
    });

    qsa(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        input.value = chip.dataset.example;
        updateClearVisibility();
        input.focus();
        form.requestSubmit();
      });
    });

    // animate stats once the stats step scrolls into view — hanya jika data asli tersedia
    if (statStats) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !statsAnimated && currentData) {
              statsAnimated = true;
              statRows.forEach((row) => {
                const key = row.dataset.stat;
                const valueEl = row.querySelector(".stat-value");
                const value = currentData[key];
                if (isFiniteNumber(value)) {
                  animateCounter(valueEl, value, { duration: 850 });
                } else {
                  // sumber video tidak menyediakan angka ini — jangan tampilkan angka rekaan
                  valueEl.textContent = "—";
                }
              });
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.45 }
      );
      io.observe(statStats);
    }

    // download buttons — hanya aktif jika API mengembalikan tautan unduhan
    // asli. Klik = unduh berkas sungguhan (fetch → Blob → <a download>),
    // BUKAN membuka video di tab baru.
    downloadOptions.forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!currentData) {
          downloadStatus.textContent = "Deteksi video terlebih dahulu sebelum mengunduh.";
          return;
        }
        if (btn.classList.contains("is-downloading")) return;

        const format = btn.dataset.format;
        const fileUrl = currentData.downloadUrls && currentData.downloadUrls[format];

        if (!fileUrl) {
          downloadStatus.textContent = "API belum menyediakan tautan unduhan untuk format ini.";
          return;
        }

        downloadOptions.forEach((b) => b.classList.remove("is-done"));
        btn.classList.add("is-downloading");
        downloadStatus.textContent = "Downloading...";

        try {
          await startDownload(fileUrl, buildFileName(format, currentData));
          btn.classList.remove("is-downloading");
          btn.classList.add("is-done");
          downloadStatus.textContent = "Download selesai";
        } catch (err) {
          btn.classList.remove("is-downloading");
          downloadStatus.textContent =
            err instanceof ApiError ? err.message : "Gagal mengunduh. Silakan coba lagi.";
        }
      });
    });

    // restart
    const restartBtn = qs("#restartBtn");
    if (restartBtn) {
      restartBtn.addEventListener("click", () => {
        input.value = "";
        updateClearVisibility();
        resetFlowVisuals();
        hint.textContent = hintDefaultText;
        hint.classList.remove("is-error", "is-success");
        qs("#hero").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
        input.focus();
      });
    }
  }

  /* ---------------------------------------------------------------------
     Light parallax on the hero batik pattern
     --------------------------------------------------------------------- */

  function initParallax() {
    if (prefersReducedMotion) return;
    const pattern = qs(".hero-pattern");
    if (!pattern) return;
    let ticking = false;

    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const y = window.scrollY;
          pattern.style.transform = "translateY(" + y * 0.08 + "px)";
          ticking = false;
        });
      },
      { passive: true }
    );
  }

  /* ---------------------------------------------------------------------
     Init
     --------------------------------------------------------------------- */

  document.addEventListener("DOMContentLoaded", () => {
    initRevealObserver();
    initEndingReveal();
    initRail();
    initFlow();
    initParallax();
  });
})();
