# Cara Jalanin Neyhra Playground

Situs ini bukan lagi folder HTML statis, jadi `python3 -m http.server` gak bisa.
Alasannya: fitur **Chat AI** harus nyedot dari server (butuh header + cookie
kustom yang cuma bisa dikirim dari backend, browser bakal diblokir CORS), dan
**Obrolan Global** butuh server nyimpen pesan (SQLite) + relai realtime
(socket.io). Jadi sekarang pakai Next.js: satu server, semua urusan backend
beres di situ, browser cuma ngobrol sama satu domain (gak ada masalah CORS
sama sekali).

## Kebutuhan

- Node.js 20+ (disarankan) atau bun
- cloudflared (kalau mau expose ke internet)

## Nyalain (cara gampang)

```bash
cd neyhra-playground
bash mulai.sh
```

Script itu otomatis: pasang dependensi, bikin database (`db/custom.db`),
nyalain mini-service realtime, jalanin web di `http://localhost:3000`.

Port lain: `PORT=8080 bash mulai.sh`

## Expose ke internet (gantiin cara lama)

Dulu: `python3 -m http.server $SERVER_PORT` + cloudflared.
Sekarang tinggal ganti baris pertama ny:

```bash
PORT=$SERVER_PORT bash mulai.sh
cloudflared tunnel --url http://localhost:$SERVER_PORT
```

Satu tunnel cukup. Socket.io obrolan ngelewatin server Next lewat path
`/socket.io/*` (di-proxy otomatis), jadi gak perlu buka port mini-service.

Tips tunnel:
- Log cloudflared kadang munculin pre-check FAIL (UDP/TCP region2) tapi
  tunnel tetep jalan, itu cuma info redundansi koneksi. Biar lebih stabil
  bisa pakai: `cloudflared tunnel --protocol http2 --url http://localhost:$SERVER_PORT`
- Quick tunnel dapet domain `*.trycloudflare.com` acak, udah otomatis
  diizinin buat dev. Kalau lo pake domain/nama tunnel sendiri, tambahin
  domain ny ke `allowedDevOrigins` di `next.config.ts` terus restart.

## Cara manual (kalau gak mau pake mulai.sh)

```bash
npm install                                  # atau: bun install
echo "DATABASE_URL=file:$(pwd)/db/custom.db" > .env   # path absolut, jalan di mana aja
npx prisma db push                           # bikin db/custom.db
node scripts/bikin-admin.mjs                 # pastiin akun owner ada (sandi awal: nanda)
cd mini-services/obrolan && npm install && cd ../..
(cd mini-services/obrolan && nohup node index.js > obrolan.log 2>&1 &)
npm run dev                                  # PORT=8080 npm run dev buat ganti port
```

## Catatan

- **Chat AI**: ngambil jawaban dari backend anonim. Koneksi dari Indonesia
  aman; kalau server ny lu di luar negeri bisa kena blokir regional
  (bukan bug, tinggal ganti IP/host server ny).
- **Pesan obrolan kesimpen** di `db/custom.db`, matiin server pun pesan
  tetep ada pas nyala lagi.
- **Login (fix31)**: pakai USERNAME (huruf kecil, a-z 0-9 . _ ; boleh
  diketik pake @ di depan). Tab **Masuk** dan tab **Daftar** di pintu
  login sekarang dipisah tegas di server: masuk ke username yang
  belum terdaftar = DITOLAK (404 "belum terdaftar", gak bikin akun
  diam-diam) — bikin akun itu tugas tab **Daftar**; daftar ke username
  yang udah ada juga ditolak (409). Kedua pesan ny dibarengin tombol
  "Pindah ke Daftar/Masuk" di UI, dan tab Masuk nunjukin live apakah
  username ny terdaftar sebelum submit. Sandi daftar baru: minimal
  4 karakter (sandi akun lama tetep sah).
  Anonim (tanpa sandi) tetep ada, di tautan bawah pintu login.
  Sesi disimpen cookie httpOnly di browser, bukan localStorage.
- **User lama**: pas update ke versi ini, username otomatis dibikin
  dari nama lu (huruf kecil, karakter aneh dibuang) pas server nyala —
  login aja pake nama lama (huruf gede/kecil gak ngaruh). Nama tampilan
  lu GAK berubah. Link profil lama (pake nama) tetep kebaca.
- **Akun owner**: otomatis dibikinin tiap `mulai.sh` jalan — username
  `neyhra`, nama tampilan `Neyhra`, sandi awal `nanda`. Script ny
  idempoten: sandi yang udah diganti manual GAK disentuh, cuma ngisi
  yang kurang (flag admin/verified, username). Database kehapus
  atau keganti? Nyalain ulang aja, akun owner ny balik sendiri.
  Kelupaan sandi owner: `node scripts/bikin-admin.mjs --reset`.
  Mau sandi laen: `SANDI_OWNER=sandibaru node scripts/bikin-admin.mjs`.
  Kalau username `neyhra` keduluan dipake akun laen sebelum seed
  jalan, script ny gak nebak (kaget + exit 1) — kalau itu punya
  lo sendiri: `node scripts/bikin-admin.mjs --ambil` buat ngambil
  alih jadi owner. Otomatis dapet badge terverifikasi sama akses
  Dashboard Admin (statistik, kasih/cabut verified, hapus post/user,
  intip sandi user). Dashboard cuma kebuka buat owner.
- **Follow (r27)**: tiap profil orang laen ada tombol Ikutin / Henti
  ikutin. Statistik profil: Post, Pengikut, Mengikuti, Like (jumlah
  like yang diterima di semua post milik user — bukan post yang dia
  like). "Suka diberikan" + "Komentar" ada di "Aktivitas lainnya".
- **Privasi post (r27)**: pemilik post bisa ganti Publik / Hanya
  Profil / Private kapan aja dari menu titik-tiga post (server-side
  divalidasi ulang, gallery/profil orang laen otomatis ikut ke-filter).
- **Navigasi**: menu utama (Utama / Galeri / Fitur) tetep di bagian atas.
  Menu samping (tombol garis tiga di kanan atas) isinya akun: profil,
  pengaturan (tema + suara), logout, Dashboard (khusus owner).
- **Suara**: backsound disintesis langsung di browser (gak ada file
  ny), tapi efek suara (SFX) pake file .mp3 kecil di
  `public/aset/suara/` biar gampang diganti sendiri: timpa aja file ny
  pake nama yang sama (`ui-button.mp3`, `ui-menu.mp3`,
  `ui-dissolve.mp3`, `digital-burst.mp3`, `failure.mp3`,
  `data-load.mp3`, `notification.mp3`, `system-alert.mp3`), terus
  refresh (cache ny sehari). Semua tombol/aksi dapet bunyi click
  ringan; bunyi error/peringatan cuma pas beneran kejadian. Gak pernah
  nyala sendiri: baru bunyi pas ada interaksi, preferensi mute/volume
  ny keinget.
- **Emoji** di UI pake font `public/aset/NotoColorEmoji.ttf` milik pemilik.
  Filenya gede (34 MB) tapi cuma diunduh kalau ada emoji yang beneran
  muncul di layar (termasuk di Chat AI sama Ruang Obrolan), terus
  di-cache browser sehari biar gak unduh ulang tiap refresh.
- **Galeri**: file di `public/galeri` ke-scan otomatis jadi post.
  Unggahan user masuk `data/media` (maks 10 MB per media), pratinjau
  low-res ny di-cache di `data/pratinjau` biar hemat kuota. Video
  butuh `ffmpeg` buat poster (kalau gak ada, video tetep jalan).
  Klik post = buka detail (komentar), file asli baru kebuka pas
  "Lihat asli" / "Putar video" diklik.
- **Sfile**: ketik kata kunci = nyari file, tempel link sfile = unduh.
  Ada juga upload (share link). Unduhanny lewat server biar lolos
  proteksi CDN sfile. Tombol Tempel ny baca clipboard browser.
- **Akinator**: server ny ngobrol langsung sama akinator.com. Kalau IP
  server lu kena tantangan Cloudflare, otomatis naik lapisan: browser
  nyala (pakai Chrome/Edge/Chromium yang kepasang di mesin — deteksi
  otomatis, Windows udah cukup sama Edge bawaan). Semua request game
  selanjutnya tetep lewat lapisan itu sampe game selesai. ENV opsional:
  `AKINATOR_PROXY` / `AKINATOR_PROXY_LIST` (proxy cadangan, cuma
  dipakai kalau koneksi langsung gagal), `AKINATOR_TIMEOUT` (detik,
  default 60), `AKINATOR_MAX_RETRIES`, `AKINATOR_START_BUDGET_MS`
  (batas waktu mulai game, default 45000), `AKINATOR_PLAYWRIGHT_MODULE`
  (urutan default: playwright dulu, terus playwright-core),
  `AKINATOR_PLAYWRIGHT_EXECUTABLE_PATH` (paksa path browser),
  `AKINATOR_PLAYWRIGHT_HEADLESS` (default true). Owner bisa lihat mode
  transport yang kepake dari Dashboard Admin.
- **Sandi user** disimpen sebagai hash buat cek login, plus salinan
  terenkripsi (kunci ny di `data/kunci.txt`, kebikin otomatis) yang cuma
  bisa dibuka dari Dashboard Admin. Jangan bagikan file `data/` ke siapa
  siapa.
- Isi `mini-services/obrolan/obrolan.log` kalau chat realtime gak nyambung,
  pastiin service ny idup (`pgrep -f "node index.js"`).
- Ganti port mini-service: `OBROLAN_PORT=3100 PORT=3000 bash mulai.sh`
  (kalau 3003/3004 kepake aplikasi lain).
- **Izin unduh post (r30)**: waktu upload ada saklar "Izinkan orang
  mengunduh post ini" (default NYALA, nyamain perilaku lama: semua
  post yang keliatan bisa diunduh). Bisa diganti kapan aja lewat menu
  titik-tiga post (pemilik doang, divalidasi server-side). Izin mati:
  tombol Download ilang dari menu + link unduh di kartu, dan
  `?unduh=1` ditolak server (403) buat orang lain — pemilikny
  sendiri tetep bisa unduh postny.
- **Kontrol video (r30)**: tombol bisu + perbesar sekarang SATU
  BARIS di pojok kanan-bawah video (sebelumny dua tombol dari dua
  komponen beda yang posisiny nyaris nimpa). Info "browser nolak
  suara otomatis" nempel DI ATAS baris itu.
- **Ikon mail (r30)**: pas panel notifikasi kebuka, ikon mail di
  header kebalik warnany (kotak tinta, ikon kertas) — nutup panel
  (Esc / klik luar / tombol X) balikin ke normal. Kelasny nurut
  state panel, bukan state klik.
- **AM Prem V2 (r30)**: generator otomatis 1-klik (email sementara
  dibikinin mail.tm, magic link dijemput otomatis, premium diaktifin
  pake alur + format order V1). Kredensial email sementara ny
  disimpen di DB nempel ke akun yang login, jadi kotak masukny bisa
  dibuka ulang kapan aja + link login HP bisa dibikin ulang.
  Dibawahny ada **5MB Converter** (link preset alight.link -> file
  XML + audiony, unduhan lewat server pake token sesi 30 menit).
  Khusus owner: seksi **Bulk Account** (1-20 akun sekaligus, jeda
  antar akun otomatis biar gak kena rate limit).
- **AI Image Editor (r30)**: unggah/drag&drop foto, pilih filter
  (anime, kartun, brewok, dll), proses ny jalan di SERVER (job
  background — boleh ditinggal/refresh, tetep jalan; satu job per
  user pada satu waktu; lewat 30 menit otomatis kedaluwarsa).
  Hasilny disimpen di `data/edit-gambar/`, riwayatny per akun
  (user lain gak bisa lihat). Prosesor gambarny nyaring IP yang
  nembak cepet — makany di server ada antrean + jeda otomatis;
  kalau lagi diblokir sementara, pesanny jujur ("coba lagi
  beberapa menit").
- **Tema Ruang Obrol**: tampilan obrolan global ngikutin gaya UI yang dipilih
  di Pengaturan (Klasik / Swiss Zen / Japandi / Hanami), terang maupun gelap.
  Semua gaya ada di `src/app/ruang-obrol.css` (scope `.ruang-obrol` +
  `html[data-ui]`, dimuat paling akhir di `layout.tsx`), jadi Chat AI gak ikut
  berubah. Avatar inisial, lencana kepala, sama gambar "belum ada pesan"
  dirender semua versi ny di `Obrolan.tsx` terus CSS yang nampilin satu —
  ganti tema langsung ganti tanpa reload. Mau nambah tema baru: tambah satu
  blok `html[data-ui="..."] .ruang-obrol` di file itu (token warna gelembung:
  `--o-bg-lain`, `--o-bg-sendiri`, `--o-fg-sendiri`, `--o-jam-sendiri`).
- **Tema Game + Dropdown**: Tic Tac Toe, 2048, dan dropdown kustom (PilihOpsi
  di PapanSkor / EditGambar / Profil / PanelAio) juga ikut gaya UI. Semua ada
  di `src/app/permainan.css` (dimuat paling akhir, scope `html[data-ui]`,
  Klasik gak tersentuh). Tanda X/O dibedain lewat atribut `data-tanda` di
  `TandaSVG` (TicTacToe.tsx); tangga ubin 2048 per tema ditulis eksplisit
  (l1-l13) biar kontras angka ny aman di terang + gelap. Mau tema baru:
  tambahin blok `html[data-ui="..."]` di file itu, ngikutin pola yang udah ada.
