/* KATALOG FITUR
   ------------------------------------------------------------
   Cara nambah fitur baru (contoh: Twitter):
   1. Tambahin satu objek baru di array KATALOG di bawah.
      - Fitur unduh link: isi cocok (validasi link), endpoint (URL API),
        cekData, susun (ngubah respons API jadi bentuk standar).
      - Fitur pencarian: mode 'cari' + fungsi cari(kataKunci, jumlah).
      - Fitur lain (AI, obrolan): mode sendiri, halamannya digambar
        terpisah di src/views, kartu menu tetap otomatis dari sini.
   2. Untuk fitur unduh/cari: gak perlu bikin halaman, router sudah
      otomatis render MesinUnduh buat mode itu.
   3. Beres. Menu di halaman Fitur nambah kartu sendiri.

   Bentuk standar hasil susun()/cari():
   {
     info: [ ['Judul baris', 'nilai'], ... ],
     items: [ { jenis: 'video'|'foto', url, cadangan?, thumbnail?, nama, judul?, sumber? } ],
     tambahan: [ { label, url, nama, ikon: 'nada'|'unduh' } ]
   } */

import type { ReactNode } from "react";
import { AsetIkon, Game2048Ikon, LampuGenieIkon, TictactoeIkon } from "@/components/ikon";
import { urlProksi } from "@/lib/unduh";
import { formatJumlah } from "@/lib/format";

export type ItemMedia = {
  jenis: "video" | "foto" | "audio";
  url: string;
  cadangan?: string;
  thumbnail?: string;
  nama: string;
  judul?: string;
  sumber?: string | null;
  /* URL pratinjau cadangan kalau thumbnail utamany gagal dimuat
     (dipake Penampil buat nyoba sekali lagi lewat jalur lain —
     misal pinimg nolak varian 736x). Tanpa ny: gak ada retry. */
  cadanganPratinjau?: string;
  /* Khusus AIO (j2download): url ny stream SSE progress render,
     file beneranny baru dapet dari event completed. Kartu video ny
     juga gak bisa diputar sebelum render, jadi pratinjau ny thumbnail
     (poster). Lihat MesinUnduh: selesaikanSse + unduhFile.
     Catatan: stream SSE cuman buat link YouTube — buat TikTok (dan
     platform lain) resolver ny balikin file LANGSUNG dari CDN
     (video/mp4, bisa diputar + diunduh), jadi unduhSse cuma nyala
     kalau url ny emang stream (deteksi dari pola ny). */
  unduhSse?: boolean;
  poster?: boolean;
};

export type SusunHasil = {
  info: [string, string][];
  items: ItemMedia[];
  tambahan: { label: string; url: string; nama: string; ikon: "nada" | "unduh" }[];
};

export type HasilCari = SusunHasil;

type DasarFitur = {
  id: string;
  label: string;
  ikon: (ukuran?: number) => ReactNode;
  format: string;
  lebar?: boolean;
  deskripsi: string;
  judul: string;
  lede: string;
  /* Alias pencarian (r27 / P3-10): singkatan/nama lain yang biasa
     diketik user ("ig", "yt", "pin") — cuma buat nyari, gak
     nampil di kartu. */
  alias?: string[];
};

export type EntryUnduh = DasarFitur & {
  mode: "unduh";
  placeholder: string;
  petunjuk: string;
  labelForm: string;
  kosong?: string;
  cocok: (link: string) => boolean;
  pesanSalah: string;
  endpoint: (link: string) => string;
  cekData: (data: unknown) => boolean;
  pesanGagal: (data: unknown) => string;
  susun: (data: any) => SusunHasil;
  /* panel: hasil ny dirender sebagai SATU panel (pratinjau tunggal +
     dropdown kualitas + tombol unduh) lewat PanelAio, bukan grid
     kartu per item. Buat fitur yang hasilny banyak variasi media
     BERBEDA (post IG, hasil cari) tetep false: grid kartu ny tepat. */
  panel?: boolean;
};

export type EntryCari = DasarFitur & {
  mode: "cari";
  placeholder: string;
  petunjuk: string;
  labelForm: string;
  kosong?: string;
  jumlahDefault: number;
  jumlahPilihan: number[];
  cari: (kueri: string, jumlah: number) => Promise<HasilCari>;
};

export type EntryLain = DasarFitur & {
  mode: "ai" | "obrolan" | "sfile" | "am" | "akinator" | "amv2" | "editgambar" | "tictactoe" | "game2048";
};

export type EntryFitur = EntryUnduh | EntryCari | EntryLain;

export function namaFile(prefix: string, teks: string, ekstensi: string) {
  const dasar = (teks || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return prefix + "-" + (dasar || Date.now()) + "." + ekstensi;
}

export const KATALOG: EntryFitur[] = [
  {
    id: "aio",
    label: "AIO Downloader",
    ikon: (n) => <AsetIkon nama="aio" ukuran={n} />,
    format: "Video + Audio", alias: ["all in one", "youtube", "yt", "video", "mp3"],
    deskripsi:
      "Satu buat semuany. Tempel link video (YouTube dll), pilih kualitas atau audionya, terus langsung simpen.",
    judul: "AIO Downloader",
    lede: "All-in-one: tempel link video dari YouTube dan platform lain ny, pilih kualitas atau audiony dari daftar yang tersedia, terus langsung simpen.",
    placeholder: "https://youtube.com/watch?v=... / youtu.be/... / shorts...",
    petunjuk: "Tempel link video ny di sini. YouTube (video, shorts, music) udah pasti jalan; platform lain kebaca juga selama server ny dukung.",
    labelForm: "Link video",
    mode: "unduh",
    panel: true,
    kosong:
      "Hasil bakal muncul di sini: <b>pratinjau thumbnail</b>, rincian ny, terus <b>dropdown kualitas</b> + tombol unduh.",
    cocok: (link) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(link),
    pesanSalah:
      "Linkny belum bener. Tempel link lengkap yang diawali https:// (misal: https://youtube.com/watch?v=...), lalu coba lagi.",
    endpoint: (link) => "/api/fitur/aio?url=" + encodeURIComponent(link),
    cekData: (data: any) => !!(data && data.status && Array.isArray(data.medias) && data.medias.length),
    pesanGagal: (data: any) =>
      data && data.message
        ? data.message
        : "Gagal ambil data dari server unduhan. Coba lagi bentar, atau ganti link ny.",
    susun: (data: any) => {
      const medias: any[] = data.medias || [];
      /* Stream SSE kejali dari pola url ny (semua CDN render j2
         duduk di *.zm.io.vn/sse-progress). Link TikTok balikin file
         mp4/mp3 langsung dari tiktokcdn — CORS ny fixed ke domain
         tunnel j2, jadi fetch langsung dari browser keblokir. Makanya
         file langsung dibungkus proksi dari sononya: unduhan jadi
         same-origin sekali jalan (gak ada percobaan fetch yang
         nyasar dulu), pratinjau video ny juga lewat proksi
         (content-type ny dijamin video/mp4). */
      const ituSse = (u: unknown) => {
        const s = String(u || "");
        return !!s && (s.includes("zm.io.vn") || s.includes("/sse-progress"));
      };
      const items: ItemMedia[] = medias.map((m) => {
        const audio = m.type === "audio";
        /* Stream SSE kejadian di video (YouTube) DAN di audio ny
           (mp3/m4a juga dirender lewat zm.io.vn). Poster cuma buat
           video SSE (audio gak punya pratinjau yang bisa diputar).
           Kalau audio ny file langsung (TikTok), dia gak SSE —
           tinggal di-proxy. */
        const sse = ituSse(m.url);
        return {
          jenis: audio ? "audio" : "video",
          url: sse ? String(m.url || "") : urlProksi(String(m.url || ""), audio ? "audio" : "video"),
          unduhSse: sse,
          poster: sse && !audio,
          thumbnail: audio ? undefined : data.thumbnail,
          nama: namaFile("aio", String(data.title || data.videoId || "video") + "-" + String(m.quality || m.label || ""), String(m.extension || (audio ? "mp3" : "mp4"))),
          judul: String(m.label || m.quality || (audio ? "Audio" : "Video")),
          sumber: null,
        };
      });
      /* Info: baris kosong/null GAK ikut dirender (P1-4c: jangan ada
         "-" / "undefined" / label kosong nyisain gap). Urusanny di
         sini (susun) + double-guard di komponen (Rincian/PanelAio).
         viewCount: SATU-SATUNY field yang kena formatter angka —
         mappingnya eksplisit di sini, bukan tebak-tebakan di
         renderer. Durasi udah string siap tampil dari route ny. */
      const info: [string, string][] = [];
      if (data.title) info.push(["Judul", potong(String(data.title), 90)]);
      if (data.author) info.push(["Pembuat", String(data.author)]);
      if (data.duration) info.push(["Durasi", String(data.duration)]);
      const penonton = formatJumlah(data.viewCount);
      if (penonton) info.push(["Penonton", penonton]);
      info.push(["Sumber", "j2download.com"]);
      return {
        info,
        items,
        tambahan: [],
      };
    },
  },
  {
    id: "tiktok",
    label: "TikTok",
    ikon: (n) => <AsetIkon nama="tiktok" ukuran={n} />,
    format: "Video + Audio", alias: ["tt", "vt", "video tiktok"],
    deskripsi: "Tempel link vt, intip preview ny dulu, abis itu simpen video atau mp3 ny.",
    judul: "Unduh TikTok",
    lede: "Tempel link TikTok, cek preview ny dulu, klo udah cocok tinggal simpen. Gampang, gak ribet.",
    placeholder: "https://www.tiktok.com/@nama/video/...",
    petunjuk: "Tempel link video TikTok di sini.",
    labelForm: "Link TikTok",
    mode: "unduh",
    cocok: (link) => link.includes("tiktok.com"),
    pesanSalah:
      "Link harus berawalan tiktok.com atau vt.tiktok.com. Salin ulang dari tombol Bagikan di aplikasi TikTok, lalu coba lagi.",
    endpoint: (link) =>
      "https://puruboy-api.vercel.app/api/downloader/tiktok?url=" + encodeURIComponent(link),
    cekData: (data: any) => !!(data && data.success && data.video_url),
    pesanGagal: (data: any) =>
      data && data.error ? data.error : "API tidak mengirim data yang diharapkan. Ganti linknya lalu coba lagi.",
    susun: (data: any) => ({
      info: [
        ["Caption", data.caption],
        ["Pembuat", data.author],
        ["Sumber", data.source],
      ],
      items: [
        {
          jenis: "video",
          /* Lewat proksi server: tikcdn ngasih content-type
             octet-stream (video element gak mau mainin) + CORS ny
             fixed ke ssstik.io (fetch blob keblokir). Dari proksi:
             video/mp4 + same-origin = pratinjau ke-buffer beneran,
             unduhanny langsung, tanpa popup tab baru. */
          url: urlProksi(String(data.video_url || ""), "video"),
          nama: namaFile("tiktok", data.caption || data.author, "mp4"),
        },
      ],
      tambahan: data.mp3_url
        ? [
            {
              label: "Unduh audio (MP3)",
              url: urlProksi(String(data.mp3_url), "audio"),
              nama: namaFile("tiktok", data.caption || data.author, "mp3"),
              ikon: "nada" as const,
            },
          ]
        : [],
    }),
  },
  {
    id: "instagram",
    label: "Instagram",
    ikon: (n) => <AsetIkon nama="instagram" ukuran={n} />,
    format: "Video + Foto", alias: ["ig", "reel", "reels"],
    deskripsi: "Reel, post, foto, sampai carousel, foto ny bisa di-zoom kayak di galeri.",
    judul: "Unduh Instagram",
    lede: "Reel, post, foto, sampai carousel: tempel linkny, lihat dulu preview ny, baru simpen.",
    placeholder: "https://www.instagram.com/reel/...",
    petunjuk: "Tempel link reel, post, atau carousel Instagram di sini.",
    labelForm: "Link Instagram",
    mode: "unduh",
    cocok: (link) => link.includes("instagram.com"),
    pesanSalah:
      "Link harus berawalan instagram.com. Salin ulang dari tombol Bagikan di aplikasi Instagram, lalu coba lagi.",
    endpoint: (link) => "https://api.nexray.eu.cc/downloader/instagram?url=" + encodeURIComponent(link),
    cekData: (data: any) => !!(data && data.status && Array.isArray(data.result) && data.result.length),
    pesanGagal: () =>
      "Gagal ambil data dari Instagram. Linkny mungkin private, kedaluwarsa, atau serverny lagi sibuk. Coba lagi bentar.",
    susun: (data: any) => {
      const items = (data.result || [])
        .filter((r: any) => (r.type === "video" || r.type === "image") && (r.url || r.thumbnail))
        .map((r: any, i: number) => ({
          jenis: (r.type === "video" ? "video" : "foto") as "video" | "foto",
          url: r.url || r.thumbnail,
          thumbnail: r.thumbnail,
          nama: "instagram-" + (i + 1) + (r.type === "video" ? ".mp4" : ".jpg"),
        }));
      const awal = (data.result || [])[0] || {};
      const judul = awal.caption || awal.title || "";
      return {
        info: judul ? ([["Caption", judul]] as [string, string][]) : [],
        items,
        tambahan: [],
      };
    },
  },
  {
    id: "pinterest",
    label: "Pinterest",
    ikon: (n) => <AsetIkon nama="pinterest" ukuran={n} />,
    format: "Pencarian Foto", alias: ["pin", "pin img", "wallpaper"],
    deskripsi: "Cari foto pake kata kunci, lihat hasil ny kayak galeri, terus simpen.",
    judul: "Cari Foto Pinterest",
    lede: "Ketik kata kunci ny, gw cariin pin ny. Hasil bisa di-zoom, disimpen satu-satu, atau sekalian.",
    placeholder: "kucing oren, aesthetic, wallpaper...",
    petunjuk: "Tulis kata kunci bebas, misal: kucing oren atau wallpaper estetik.",
    labelForm: "Kata kunci",
    mode: "cari",
    jumlahDefault: 12,
    jumlahPilihan: [6, 12, 24, 40],
    cari: cariPins,
  },
  {
    id: "am-premium",
    label: "AM Premium",
    ikon: (n) => <AsetIkon nama="am" ukuran={n} />,
    format: "Generator", alias: ["am", "premium", "magic link"],
    deskripsi:
      "Dapetin AM Premium 1 tahun: masukin email, minta magic link ny, salin link dari inbox (cek spam kalo gak ada), terus aktivasi di sini.",
    judul: "AM Premium Generator",
    lede: "Masukin email lo, gw kirimin magic link ny. Buka email ny (kalo gak nemu, cek folder spam), salin link ny, tempel di kotak aktivasi, premium 1 tahun langsung nempel.",
    mode: "am",
  },
  {
    id: "am-premium-v2",
    label: "AM Prem V2",
    ikon: (n) => <AsetIkon nama="am" ukuran={n} />,
    format: "Generator Otomatis", alias: ["am v2", "amv2", "am prem 2", "generator otomatis", "5mb", "converter", "bulk"],
    deskripsi:
      "Versi 2.0: sekali klik, email sementara + verifikasi + premium ny beres sendiri. Kotak masuk ny bisa dibuka lagi kapan aja, plus 5MB Converter.",
    judul: "AM Prem Generator V2",
    lede: "Generate akun AM Premium 1 tahun cuma sekali klik — semuany otomatis, tinggal buka link login ny di HP. Ada 5MB Converter (link preset ke XML + audio) juga.",
    mode: "amv2",
  },
  {
    id: "edit-gambar",
    label: "AI Image Editor",
    ikon: (n) => <AsetIkon nama="aio" ukuran={n} />,
    format: "Editor Foto", alias: ["edit foto", "filter", "anime", "chibi", "babi", "blonde", "botak", "dubai", "dpr", "editor", "foto ai"],
    deskripsi:
      "Ubah foto jadi gaya laen: anime, chibi, zombie, brewok, babi, botak, atau ganti latar jadi DPR/Dubai. Proses ny di server — boleh ditinggal, hasil ny nyimpen di riwayat akun lu.",
    judul: "AI Image Editor",
    lede: "Unggah foto, pilih filter ny, sisany beresin server. Boleh ditinggal (jalan terus di belakang), hasil ny masuk riwayat lu.",
    mode: "editgambar",
  },
  {
    id: "ai",
    label: "Ney AI",
    ikon: (n) => <AsetIkon nama="ai-chat" ukuran={n} />,
    format: "Chat", alias: ["chat", "ney", "ai chat", "ngobrol ai"],
    lebar: true,
    deskripsi:
      "Ngobrol sama AI pribadi Neyhra. Tanya apa aja, dari bantuin PR sampai rekomendasi lagu, dan dia inget obrolan lo.",
    judul: "Ney AI",
    lede: "Ngobrol sama Ney, AI pribadi Neyhra. Jawabanny nyambung sama obrolan sebelumnya, jadi gak mulai dari nol tiap kali.",
    mode: "ai",
  },
  {
    id: "obrolan",
    label: "Ruang Obrol",
    ikon: (n) => <AsetIkon nama="obrolan" ukuran={n} />,
    format: "Chat Global", alias: ["chat global", "grup", "ruang obrol"],
    lebar: true,
    deskripsi:
      "Chat global buat siapa aja yang mampir ke web ini. Isi chatny kesimpen, jadi walau serverny mati, obrolanny masih ada pas balik.",
    judul: "Ruang Obrol",
    lede: "Grup global: siapa aja yang buka web ini bisa ikutan ngobrol. Chatny gak hilang, kesimpen terus.",
    mode: "obrolan",
  },
  {
    id: "sfile",
    label: "Sfile",
    ikon: (n) => <AsetIkon nama="box" ukuran={n} />,
    format: "Cari + Unduh + Upload", alias: ["file", "sfile.mobi", "unduhan file"],
    deskripsi: "Tempel link sfile buat donlot, atau ketik kata kunci buat nyari file. Bisa upload juga, sekalian bagi link ny.",
    judul: "Sfile",
    lede: "Satu kotak buat semuany: link sfile = langsung donlot, teks biasa = nyari file di sfile. Ada tombol upload juga.",
    mode: "sfile",
  },
  {
    id: "akinator",
    label: "Akinator",
    ikon: (n) => <LampuGenieIkon ukuran={n} />,
    format: "Game", alias: ["game", "genie", "tebak karakter", "tebak-tebakan"],
    lebar: true,
    deskripsi:
      "Genie baca isi kepala lo: pikirin satu karakter, jawab pertanyaanny, dia nebak. Ekspresinya ganti-ganti ngikutin liany mikir.",
    judul: "Akinator",
    lede: "Pikirin satu karakter, jawab jujur, genie ny nebak. Nyambung ke mesin akinator.com yang asli.",
    mode: "akinator",
  },
  {
    id: "tictactoe",
    label: "Tic Tac Toe",
    ikon: (n) => <TictactoeIkon ukuran={n} />,
    format: "Game", alias: ["tictactoe", "ttt", "x o", "xo", "xoxo", "lawan cpu"],
    deskripsi:
      "Tic tac toe klasik: lawan CPU minimax (gampang, sedang, sampai sempurna), main dua orang satu HP, atau bikin room online pakai kode.",
    judul: "Tic Tac Toe",
    lede: "Sembilan kotak, garis satu piksel. Lawan CPU yang gak bisa dikalahkan di level Sempurna, main dua orang satu HP, atau bikin room online pake kode — tinggal share kodeny.",
    mode: "tictactoe",
  },
  {
    id: "game-2048",
    label: "2048",
    ikon: (n) => <Game2048Ikon ukuran={n} />,
    format: "Game", alias: ["2048", "game", "puzzle", "angka", "geser", "gabung", "merge"],
    deskripsi:
      "Geser ubin, gabungin angka yang sama sampai nyampe 2048 (atau lebih). Ada undo, rekor tersimpan, tiga ukuran papan, dan bisa dimainin pake swipe di HP.",
    judul: "2048",
    lede: "Geser semua ubin ke satu arah, dua ubin yang sama bakal gabung jadi dua kali lipat. Ada undo, rekor tersimpan, dan tiga ukuran papan: 4×4, 5×5, 6×6.",
    mode: "game2048",
  },
];

export function cariFitur(id: string) {
  return KATALOG.find((k) => k.id === id);
}

/* ---------- Pencarian foto Pinterest lewat API nexray ----------
   Sama kayak API Instagram di situs ini, CORS ny udah terbuka buat
   dipanggil langsung dari browser. Trik ny:
   - API cuma ngasih URL ukuran originals (gede). Buat grid dipake
     turunan 736x (ganti /originals/ jadi /736x/); kalau turunanny
     gak ada, gambar otomatis balik ke originals.
   - i.pinimg.com gak ngasih header CORS buat fetch blob, jadi tiap
     item dibekalin cadangan lewat images.weserv.nl biar tombol
     simpen tetap bisa unduh langsung. */

const API_PIN = "https://api.nexray.eu.cc/search/pinterest?q=";
const JEMBATAN = "https://images.weserv.nl/?url=";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function potong(s: string, n: number) {
  const t = String(s || "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n - 1) + "\u2026" : t;
}

/* Turunan hemat kuota buat grid: i.pinimg.com cuma nyimpen variasi
   /736x/ buat JPG — PNG/GIF balik 403 (kedaftar live pas audit r27,
   aplikasi 2026-10-05). Makany cuma JPG yang dikecilin; format lain
   pake URL asli ny (GIF tetep animasi, PNG tetep transparan). */
function kecil(url: string) {
  const s = String(url);
  if (/\.jpe?g(?:$|\?)/i.test(s)) return s.replace("/originals/", "/736x/");
  return s;
}

function ekstensi(url: string) {
  const m = String(url)
    .toLowerCase()
    .match(/\.(jpe?g|png|webp|gif|avif)(?:$|\?)/);
  return m ? m[1].replace("jpeg", "jpg") : "jpg";
}

function slug(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function cariPins(kueri: string, jumlah: number): Promise<HasilCari> {
  let res: Response;
  try {
    res = await fetch(API_PIN + encodeURIComponent(kueri));
  } catch {
    throw new Error("Gak bisa nyambung ke server pencarian. Cek koneksi ny, terus coba lagi.");
  }
  if (!res.ok) {
    throw new Error("Server pencarian lagi bermasalah (HTTP " + res.status + "). Tunggu bentar lalu coba lagi.");
  }
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error("Balasan dari server gak kebaca. Mungkin lagi sibuk, coba lagi bentar.");
  }
  if (!data || data.status !== true) {
    throw new Error(data && data.error ? data.error : "Server ny gak ngasih hasil. Coba lagi.");
  }

  const mentah = Array.isArray(data.result) ? data.result : [];
  const hasil: ItemMedia[] = mentah
    .filter(
      (r: any) =>
        r &&
        typeof r.images_url === "string" &&
        r.images_url.startsWith("http") &&
        (r.type || "image") === "image"
    )
    .slice(0, jumlah)
    .map((r: any, i: number) => {
      const asli = r.images_url as string;
      const judul = potong(r.grid_title || r.seo_alt_text || r.description || "Pin", 90);
      return {
        jenis: "foto" as const,
        /* Unduhan lewat proksi dari sononya: i.pinimg.com gak ngasih
           header CORS buat fetch, jadi percobaan pertama yang
           "nyasar" cuma bikin noise error di console sebelum nyerah
           ke cadangan. Weserv tetep jadi cadangan kalau server ny
           gak bisa nyampe pinimg. */
        url: urlProksi(asli),
        cadangan: JEMBATAN + asli.replace(/^https?:\/\//, ""),
        thumbnail: kecil(asli),
        /* Cadangan pratinjau: kalau varian 736x (atau malah URL
           asliny) gak kebaca di penampil, coba lewat proksi sekali.
           Format MIME ikut upstream — GIF tetep GIF, PNG tetep PNG. */
        cadanganPratinjau: urlProksi(asli),
        nama: "pinterest-" + (slug(kueri) || "pin") + "-" + pad(i + 1) + "." + ekstensi(asli),
        judul: judul || "Pin " + pad(i + 1),
        sumber: typeof r.pin === "string" && r.pin.startsWith("http") ? r.pin : null,
      };
    });

  if (!hasil.length) {
    throw new Error('Gak ada foto yang ketemu buat "' + kueri + '". Coba kata kunci lain, misalny yang lebih umum.');
  }

  return {
    info: [
      ["Kata kunci", kueri],
      ["Hasil", hasil.length + " foto"],
      ["Sumber", "pinterest.com"],
    ],
    items: hasil,
    tambahan: [],
  };
}
