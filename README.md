# TikTok Video Downloader — Landing Page

Landing page mobile-first untuk alur "tempel link → deteksi → pratinjau →
statistik → unduh", dengan gaya visual clean, bright, premium, dan cinematic.
Latar belakang menggunakan pola batik kawung yang sangat samar (opacity ±5%).

## Struktur folder

```
tiktok-downloader/
├── index.html          Halaman utama: hero, hasil deteksi, cara pakai
├── statistik.html       Halaman Statistik (lihat "Sidebar navigasi" di bawah)
├── faq.html             Halaman FAQ (lihat "Sidebar navigasi" di bawah)
├── css/
│   └── style.css        Design tokens, layout, komponen, animasi
├── js/
│   ├── script.js         Logika alur downloader (lihat catatan API di bawah)
│   ├── stats.js          Pencatat statistik pemakaian nyata (localStorage)
│   ├── sidebar.js        Perilaku sidebar (buka/tutup, fokus, scroll ke #howto)
│   └── statistik.js      Menampilkan angka dari stats.js di statistik.html
├── assets/
│   ├── batik-pattern.svg     Tekstur batik kawung untuk background hero
│   └── preview-placeholder.svg  Sampul video sebelum thumbnail asli dimuat
└── README.md
```

## Sidebar navigasi

Tombol menu (ikon garis tiga) di kanan header membuka sidebar berisi:

- **Statistik** — membuka `statistik.html`, halaman terpisah yang menampilkan
  Video Diproses, Pengguna, Web Dikunjungi, dan Success Rate. Situs ini tidak
  punya backend/database sendiri, jadi angka-angka itu dihitung dari pemakaian
  nyata di browser masing-masing lewat `localStorage` (lihat komentar di
  `js/stats.js`) — bukan angka gabungan seluruh pengguna internet, dan bukan
  angka contoh/hardcode.
- **Cara Penggunaan** — menutup sidebar lalu smooth-scroll ke section
  "Cara pakai" yang sudah ada di `index.html`. Dari halaman lain, link ini
  menuju `index.html#howto`.
- **FAQ** — membuka `faq.html`, halaman terpisah berisi pertanyaan umum.

## Cara menjalankan

Buka `index.html` langsung di browser, atau jalankan server statis sederhana
dari dalam folder ini, misalnya:

```bash
python3 -m http.server 8080
```

lalu buka `http://localhost:8080`.

## ⚠️ Tentang data video (penting)

Proyek ini **100% front-end** — HTML + CSS + JavaScript murni, **tanpa
PHP/Node/Python/server/backend sendiri** — dan **tidak berisi data video
contoh atau hardcode apa pun**: tidak ada akun, caption, likes, komentar,
share, maupun tautan unduhan palsu di mana pun dalam kode. Semua nilai
yang tampil selalu berasal dari respons `fetch()` sungguhan ke API publik
di bawah, dipanggil langsung dari browser pengguna.

### Sumber API (dipanggil langsung dari browser, tanpa API key)

`js/script.js` mencoba tiga sumber publik secara berurutan lewat
`fetchVideoData()`, berhenti begitu salah satu berhasil:

1. **`https://tdownv4.sl-bjs.workers.dev/?down=`** — Cloudflare Worker
   publik, sumber utama sesuai permintaan. Tidak mengirim sampul video,
   jumlah komentar, atau jumlah share, jadi field itu dilengkapi
   diam-diam dari sumber #2 tanpa mengganti tautan video utamanya.
2. **`https://www.tikwm.com/api/?url=`** — dipanggil langsung sebagai
   cadangan bila sumber #1 gagal atau diblokir CORS oleh browser. Sumber
   ini punya data paling lengkap (sampul, likes, komentar, share, video
   HD & SD, audio MP3).
3. **`https://api.allorigins.win/raw?url=`** — proxy CORS publik (bukan
   server kita) yang meneruskan permintaan ke sumber #2, untuk kasus
   sumber #2 tidak mengirim header CORS ke origin GitHub Pages tertentu.

Semua permintaan berupa `fetch()` GET biasa tanpa header kustom dan
**tanpa `mode: "no-cors"`** — kalau sebuah sumber diblokir CORS oleh
browser, `fetch`-nya gagal (`TypeError`) dan kode otomatis lanjut ke
sumber berikutnya. Kalau ketiganya gagal (mis. link privat, tidak valid,
atau semua sumber publik sedang down), halaman menampilkan pesan error
yang jujur — bukan data rekaan — dan tombol unduhan tetap nonaktif.

Field yang tetap tidak tersedia dari semua sumber (mis. jumlah komentar
dari sumber #1 tanpa cadangan) ditampilkan sebagai **"—"**, bukan angka
0 atau angka rekaan.

### Mengganti/menambah sumber API

Semua URL dasar ada di `CONFIG` pada baris paling atas `js/script.js`:

```js
const CONFIG = {
  PRIMARY_API_BASE: "https://tdownv4.sl-bjs.workers.dev/?down=",
  SECONDARY_API_BASE: "https://www.tikwm.com/api/?url=",
  PROXY_BASE: "https://api.allorigins.win/raw?url=",
  REQUEST_TIMEOUT_MS: 15000,
  ENRICH_TIMEOUT_MS: 8000,
};
```

Untuk menambah sumber lain, buat fungsi `normalize...()` baru (ubah
respons JSON sumber tersebut ke bentuk `{ author, caption, thumbnailUrl,
likes, comments, shares, downloadUrls }`), lalu tambahkan pemanggilnya ke
array `attempts` di dalam `fetchVideoData()`.

## Alur halaman

1. **Hero** — input link TikTok + dua contoh cepat. Saat halaman pertama
   dibuka, hanya bagian ini yang tampil — bagian Result (pratinjau, statistik,
   unduhan) sepenuhnya `display: none`, tanpa ruang kosong tersisa.
2. **Result** (`#flow`) — baru dimunculkan (dengan transisi fade/slide halus)
   setelah `fetchVideoData()` benar-benar berhasil mengembalikan data video,
   lewat `showResult()` di `js/script.js`. Kalau link kosong, tidak valid,
   atau semua sumber API gagal, Result tetap tersembunyi dan pesan error
   ditampilkan lewat `#formHint` (`hideResult()` dipanggil). Isinya:
   - **Pratinjau** — kartu video berisi sampul, akun, dan caption.
   - **Statistik** — likes, komentar, share dengan animasi hitung naik
     (0 → 1 → 10 → … → angka asli), berhenti tepat di angka asli, durasi
     ±0.85 detik.
   - **Unduh** — tiga pilihan format (MP4 HD, MP4 ringkas, MP3), lalu tautan
     "Unduh video lain" untuk mengulang dari awal.
3. **Cara pakai** (`#howto`) — tiga langkah singkat memakai layanan ini.
   Selalu berada tepat setelah area input/Result, baik Result sedang tampil
   maupun tidak — jadi kalau pengguna scroll tanpa memasukkan link, bagian
   ini yang langsung terlihat.

## Interaksi & animasi

- Scroll-reveal halus (fade, slide, blur-to-sharp) lewat `IntersectionObserver`.
- Kartu video pinned/sticky selama bagian statistik & unduhan di-scroll.
- Parallax ringan pada pola batik di hero.
- Counter angka berhenti tepat di data asli (bukan angka hardcode acak).
- Menghormati `prefers-reduced-motion`: animasi dinonaktifkan otomatis
  bila pengguna mengaktifkan pengaturan tersebut di sistemnya.

## Tipografi & warna

- **Plus Jakarta Sans** untuk judul/angka, **Inter** untuk teks isi.
- Latar off-white hangat (`#FAF8F2`), aksen indigo tua ala batik tulis
  (`#24314F`) dan emas pudar (`#A9812E`) — dipakai secukupnya, tanpa neon
  atau efek glow berlebihan.

## Backend Google Apps Script + Google Sheets

Versi ini memindahkan statistik dari `localStorage` menjadi statistik terpusat.
Frontend tetap dapat di-host di GitHub Pages. Backend dijalankan sebagai Google
Apps Script Web App dan data event disimpan di Google Sheets.

### Setup singkat

1. Buat Google Spreadsheet baru.
2. Buka **Extensions → Apps Script**.
3. Salin isi `Code.gs` ke Apps Script.
4. Isi `SPREADSHEET_ID` dengan ID spreadsheet.
5. Ganti `ADMIN_PASSWORD` dengan password admin sendiri.
6. Jalankan fungsi `setup()` sekali dan izinkan akses.
7. **Deploy → New deployment → Web app**.
8. Pilih **Execute as: Me** dan akses **Anyone**.
9. Salin URL Web App yang berakhiran `/exec`.
10. Buka `js/backend.js` dan isi `API_ENDPOINT` dengan URL tersebut.
11. Upload seluruh folder frontend ke GitHub Pages.

### Admin tersembunyi

Pada halaman frontend, logo **Unduhin** harus diklik **6 kali dalam sekitar
1,8 detik** untuk membuka `admin.html`. Setelah itu password tetap diverifikasi
oleh Google Apps Script. Token admin disimpan hanya selama sesi browser dan
memiliki masa berlaku terbatas di cache Apps Script.

### Statistik global

Setiap browser mendapatkan visitor ID anonim. Backend mencatat event `visit`,
`session`, `attempt`, `success`, dan `download` ke Google Sheets. Dashboard
menghitung seluruh event yang masuk ke spreadsheet, sehingga angka tidak lagi
terbatas pada localStorage satu perangkat.

### Catatan

`SPREADSHEET_ID`, password admin, dan URL Web App adalah konfigurasi milik kamu.
Jangan memasukkan password admin ke frontend. Password hanya disimpan di
`Code.gs` dan frontend hanya mengirimkannya saat login melalui HTTPS.

## Admin Panel → System (API Health, API Failover, Maintenance)

Ditambahkan di atas fondasi backend yang sama (Google Apps Script + Google
Sheets), semuanya real — tidak ada data contoh/hardcode.

- **API Health Monitor** — admin menekan "Check All" (atau membuka halaman
  System), lalu `Code.gs` memanggil langsung tiap provider downloader
  (`PROVIDERS_REGISTRY`, harus selalu sinkron dengan array `PROVIDERS` di
  `js/script.js`) lewat `UrlFetchApp` di server, mengukur waktu respons
  sungguhan, dan mengklasifikasikan status: `ONLINE` / `SLOW` / `ERROR` /
  `TIMEOUT` / `DISABLED`. Video uji ada di `CONFIG.HEALTH_CHECK_VIDEO_URL` —
  ganti dengan link TikTok publik apa pun kalau link bawaan sudah tidak
  tersedia.
- **API Failover Control** — enable/disable per provider, tersimpan di sheet
  baru **APIConfig** (`providerId | enabled | updatedAt`). Status ini dibaca
  oleh `js/script.js` lewat action publik `publicConfig` sebelum menjalankan
  rantai fallback, jadi provider yang di-disable benar-benar dilewati oleh
  downloader di browser pengunjung — bukan sekadar toggle UI. Kalau backend
  tidak terhubung/gagal dihubungi, downloader tetap fail-open (semua
  provider dianggap enabled) supaya fitur inti tidak pernah rusak karena
  masalah di admin panel.
- **Maintenance Mode** — enable/disable + pesan kustom, tersimpan di sheet
  baru **SystemConfig** (`key | value | updatedAt`). Situs publik
  (`index.html`, `faq.html`, `statistik.html`, lewat `js/maintenance.js`)
  memeriksa status ini melalui `publicConfig` dan menampilkan overlay
  pemeliharaan bila aktif. `admin.html` **tidak** memuat `maintenance.js`,
  jadi admin tetap bisa login dan mematikan maintenance kapan pun.

Semua endpoint admin di atas (`adminApiHealth`, `adminApiConfig`,
`adminApiToggle`, `adminMaintenanceGet`, `adminMaintenanceSet`) memvalidasi
token admin (`isAdmin_`) seperti endpoint admin lain. Hanya `publicConfig`
yang tidak butuh token — sifatnya read-only dan tidak pernah membocorkan
data statistik/password.

Sheet **SystemConfig** dan **APIConfig** dibuat otomatis saat `setup()`
dijalankan (sama seperti sheet `Events`), lengkap dengan nilai default.
