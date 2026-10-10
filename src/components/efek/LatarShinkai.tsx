"use client";

/* Latar Shinkai (r37) — langit sinematik anime, versi "hidup".

   Baru di r37:
   - Awan nutupin matahari/bulan itu BERPENGARUH. Tiap sprite awan punya
     peta alpha kecil (40px); tiap frame dicek seberapa tebal awan di atas
     titik matahari. Makin tertutup: bloom meredup, kilau & flare hilang,
     awan itu menyala dari dalam (pendar tembus awan), dan berkas justru
     MENGUAT saat tertutup sebagian (matahari ngintip dari celah) lalu
     padam kalau tertutup penuh. Semua dihaluskan, gak ada kedip mendadak.
   - Matahari/bulan ketutup = SELURUH langit ikut gelap. Lapisan multiply
     warna biru-abu menimpa langit + awan, makin tertutup makin redup, dan
     dihaluskan pelan (seperti mata menyesuaikan cahaya), jadi awan lewat
     terasa kayak mendung sesaat. Pendar tembus awan digambar SETELAH
     peredupan, jadi titik matahari di balik awan tetap paling terang.
   - Pointer nutupin matahari/bulan: kursor jadi penghalang kecil. Pas
     lewat di depan, piringannya ketutup, cahaya bocor jadi cincin tipis
     di sekeliling kursor (efek gerhana), berkas ikut bereaksi.
   - Malam dirombak: gak ada lagi berkas runcing. Sekarang berkas bulan
     lebar, sangat lembut, redup; plus halo cincin, dan awan dekat bulan
     kena rim light dingin.
   - Tepi berkas lebih halus (6-8 lapis, bukan 4).

   Pemeran utama r36: BERKAS CAHAYA (god rays) yang beneran bergerak.
   - 3 kipas berkas, tiap kipas di-render sekali ke sprite lalu diputar
     pelan-pelan per frame (goyang sinus, kecepatan beda-beda), denyut
     terang-redup sendiri-sendiri, dan ikut miring ngikutin pointer.
     Karena 3 kipas saling silang dengan fase beda, berkasnya "berkilau"
     dan bergeser terus tanpa pernah berulang persis.
   - Kedalaman: kipas digambar DI ANTARA awan tengah dan awan dekat, jadi
     awan dekat nutupin sebagian berkas = cahaya tembus celah awan.
   - Malam: berkas jadi cahaya bulan (biru dingin, lebih tipis).

   Tambahan lain (semua hemat, di-cache, gak pakai ctx.filter):
   - Matahari: kilau bintang 4 sudut yang berputar + berkedip, halo
     cincin tipis, bloom bernapas.
   - Lens flare: hantu-hantu cahaya sepanjang garis matahari->tengah
     layar, bergeser pas pointer digerakkan.
   - Tepi awan dekat matahari menyala hangat (silver lining) lewat sprite
     "hangat" yang di-screen sesuai jarak ke matahari.
   - Awan naik-turun pelan (bobbing) biar langit gak kaku.
   - Serbuk cahaya melayang (siang hangat / malam kunang-kunang biru).
   - Malam: bintang jatuh sesekali.
   - Kualitas adaptif: kalau frame time rata-rata jelek (HP kentang),
     otomatis matiin partikel / flare / rim light / kipas ke-3.
   - prefers-reduced-motion: dirender sekali, statis.
   Warna tetap dari token shinkai.css. */

import { useEffect } from "react";
import { bacaWarna, rgba, gerakDikurangi } from "@/components/efek/warna";
import awan1 from "./assets/shinkai/awan1.png";
import awan2 from "./assets/shinkai/awan2.png";
import awan3 from "./assets/shinkai/awan3.png";
import awan4 from "./assets/shinkai/awan4.png";
import awan5 from "./assets/shinkai/awan5.png";
import awan6 from "./assets/shinkai/awan6.png";

/* Awan = PNG buatan sendiri di ./assets/shinkai/awan1..6.png. Kalau
   semuanya gagal dimuat, otomatis balik ke awan generatif (buatAwan). */
const FILE_AWAN = [awan1, awan2, awan3, awan4, awan5, awan6];

type RGB = number[];
type Gumpal = { x: number; y: number; r: number };
type Palet = { bayang: RGB; dalam: RGB; tengah: RGB; terang: RGB };
type Mapa = { d: Uint8ClampedArray; w: number; h: number };
type Spr = { cv: HTMLCanvasElement; w: number; h: number; hangat?: HTMLCanvasElement; mapa?: Mapa };
type Awan = { x: number; y: number; v: number; l: number; i: number; uk: number; a: number; fase: number; tt: number };
type Burung = { ox: number; oy: number; s: number; fase: number };
type Kawanan = { x: number; y: number; dir: 1 | -1; v: number; ay: number; anggota: Burung[] };
type Bintang = { x: number; y: number; r: number; fase: number };
type KonfigKipas = {
  n: number;
  seed: number;
  spread: number;
  lebar: readonly [number, number];
  a: number;
  sway: number;
  w: number;
  den: number;
  pf: number;
};
type Kipas = { cv: HTMLCanvasElement; R: number; K: KonfigKipas };
type Partikel = { x: number; y: number; r: number; vx: number; vy: number; fase: number; a: number; f: number };
type Meteor = { x: number; y: number; vx: number; vy: number; umur: number; maks: number; pj: number };

/* Tiga lapis (jauh -> dekat): proporsi, ukuran px, alpha, kecepatan
   hanyut px/detik, faktor parallax scroll, geser pointer px, bobbing px. */
const LAPIS = [
  { n: 0.34, uk: [90, 150], a: 0.62, v: [3, 5], f: 0.02, pf: 6, bob: 3 },
  { n: 0.4, uk: [170, 260], a: 0.86, v: [5, 8], f: 0.05, pf: 14, bob: 5 },
  { n: 0.26, uk: [300, 440], a: 0.96, v: [8, 12], f: 0.1, pf: 26, bob: 8 },
] as const;

/* Kipas berkas cahaya. n = jumlah berkas, spread = sebaran sudut (rad),
   lebar = setengah-lebar sudut min/maks, a = alpha dasar, sway = amplitudo
   goyang (rad), w = kecepatan goyang (rad/s), den = kecepatan denyut,
   pf = seberapa miring ngikutin pointer. */
const KIPAS: readonly KonfigKipas[] = [
  { n: 13, seed: 31, spread: 0.8, lebar: [0.008, 0.03], a: 0.62, sway: 0.045, w: 0.28, den: 0.35, pf: 0.05 },
  { n: 9, seed: 47, spread: 0.65, lebar: [0.012, 0.045], a: 0.46, sway: 0.07, w: 0.19, den: 0.23, pf: -0.035 },
  { n: 7, seed: 59, spread: 0.95, lebar: [0.02, 0.06], a: 0.34, sway: 0.05, w: 0.14, den: 0.17, pf: 0.02 },
];

/* Malam: berkas bulan LEBAR, sangat lembut, redup, dan lambat. Berkas tipis
   runcing cocok untuk matahari tapi kelihatan murahan kalau keluar dari
   bulan sabit kecil. */
const KIPAS_MALAM: readonly KonfigKipas[] = [
  { n: 5, seed: 71, spread: 0.7, lebar: [0.05, 0.12], a: 0.26, sway: 0.03, w: 0.12, den: 0.15, pf: 0.03 },
  { n: 4, seed: 83, spread: 0.55, lebar: [0.07, 0.16], a: 0.18, sway: 0.04, w: 0.09, den: 0.11, pf: -0.02 },
];

/* Titik uji tutupan awan di sekitar matahari: [offset x, offset y, bobot]
   (offset dikali jari-jari uji). Rata-rata berbobot = seberapa tertutup. */
const TITIK_UJI = [
  [0, 0, 2],
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
] as const;
const RC = 30; /* jari-jari "penghalang" kursor (px) */
const RS = 20; /* jari-jari piringan matahari yang dihitung (px) */
const REDUP_WARNA = "rgb(140,158,198)"; /* warna multiply saat matahari tertutup */
const REDUP_MAKS = 0.85; /* kekuatan peredupan siang (malam otomatis separuhnya) */

/* Hantu lens flare: posisi di garis matahari->tengah (1 = tengah layar),
   diameter px, alpha, indeks warna (0 hangat, 1 dingin). */
const HANTU = [
  [0.45, 40, 0.28, 0],
  [0.8, 84, 0.2, 1],
  [1.12, 34, 0.3, 0],
  [1.55, 130, 0.15, 1],
  [2.05, 60, 0.22, 0],
] as const;

const SLK = 60; /* kelonggaran di luar layar biar bungkusan gak keliatan */
const PI2 = Math.PI * 2;

const acak = (a: number, b: number) => a + Math.random() * (b - a);
const mod = (n: number, m: number) => ((n % m) + m) % m;
const campur = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => v + (b[i] - v) * t);
function benih(s: number) {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bikinCv(w: number, h: number, s: number) {
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(w * s);
  cv.height = Math.ceil(h * s);
  const c = cv.getContext("2d")!;
  c.scale(s, s);
  return { cv, c };
}
function lukisGumpal(c: CanvasRenderingContext2D, g: Gumpal[], dx: number, dy: number, k: number) {
  c.beginPath();
  for (const p of g) {
    c.moveTo(p.x + dx + p.r * k, p.y + dy);
    c.arc(p.x + dx, p.y + dy, p.r * k, 0, PI2);
  }
  c.fill();
}

function muatGambar(): Promise<HTMLImageElement[]> {
  return Promise.all(
    FILE_AWAN.map(
      (f) =>
        new Promise<HTMLImageElement | null>((res) => {
          const im = new Image();
          im.onload = () => res(im.naturalWidth > 0 ? im : null);
          im.onerror = () => res(null);
          im.src = typeof f === "string" ? f : f.src;
        }),
    ),
  ).then((a) => a.filter((x): x is HTMLImageElement => !!x));
}

/* Sprite dari PNG: diperkecil ke lebar target (hemat memori), rasio asli
   dijaga. Malam: PNG di-multiply warna awan malam biar gak putih terang. */
function dariGambar(im: HTMLImageElement, lebar: number, res: number, tint: RGB | null): Spr {
  const h = lebar * (im.naturalHeight / im.naturalWidth);
  const { cv, c } = bikinCv(lebar, h, res);
  c.imageSmoothingQuality = "high";
  c.drawImage(im, 0, 0, lebar, h);
  if (tint) {
    c.globalCompositeOperation = "multiply";
    c.fillStyle = rgba(tint, 1);
    c.fillRect(0, 0, lebar, h);
    c.globalCompositeOperation = "destination-in";
    c.drawImage(im, 0, 0, lebar, h);
    c.globalCompositeOperation = "source-over";
  }
  return { cv, w: lebar, h };
}

/* Salinan sprite yang seluruh pikselnya diwarnai (alpha asli dijaga).
   Di-screen di atas awan dengan alpha ~ kedekatan ke matahari = tepi dan
   bayangan awan ikut hangat kena cahaya. */
function bikinHangat(s: Spr, warna: RGB): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = s.cv.width;
  cv.height = s.cv.height;
  const c = cv.getContext("2d")!;
  c.drawImage(s.cv, 0, 0);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = rgba(warna, 1);
  c.fillRect(0, 0, cv.width, cv.height);
  return cv;
}

/* ---------- Sprite awan cumulus cel-shading (cadangan) ----------
   Siluet = barisan lingkaran dasar + kubah + tonjolan kecil, dasar
   DATAR. Diisi nada bayangan, lalu dua lapis lebih terang digeser ke
   arah matahari (kanan-atas) dan dipotong siluet (source-atop): sisi
   kiri-bawah tiap kubah tetap gelap = volume ala anime. */
function buatAwan(lebar: number, P: Palet, res: number): Spr {
  const pad = lebar * 0.05;
  const w = lebar + pad * 2;
  const h = lebar * 0.6 + pad * 2;
  const { cv, c } = bikinCv(w, h, res);
  const dasar = h - pad;
  const g: Gumpal[] = [];
  const nD = 4 + Math.floor(Math.random() * 2);
  for (let i = 0; i < nD; i++) {
    const r = lebar * acak(0.07, 0.1);
    g.push({ x: pad + lebar * (0.12 + (0.76 * i) / (nD - 1)), y: dasar - r, r });
  }
  const pusat = acak(0.38, 0.62);
  const nK = 4 + Math.floor(Math.random() * 3);
  const kubah: Gumpal[] = [];
  for (let i = 0; i < nK; i++) {
    const fx = 0.2 + (0.6 * i) / (nK - 1);
    const bukit = Math.max(0, 1 - Math.abs(fx - pusat) / 0.45);
    const r = lebar * (0.075 + 0.12 * bukit) * acak(0.92, 1.08);
    kubah.push({
      x: pad + lebar * fx + acak(-5, 5),
      y: dasar - lebar * (0.07 + 0.2 * bukit) - r * 0.35,
      r,
    });
  }
  g.push(...kubah);
  for (const k of [...kubah].sort((a, b) => b.r - a.r).slice(0, 3)) {
    for (let j = 0; j < 2; j++) {
      const sdt = acak(-2.5, -0.65);
      g.push({
        x: k.x + Math.cos(sdt) * k.r * 0.88,
        y: k.y + Math.sin(sdt) * k.r * 0.88,
        r: k.r * acak(0.32, 0.46),
      });
    }
  }

  c.fillStyle = rgba(P.bayang, 1);
  lukisGumpal(c, g, 0, 0, 1);
  c.fillRect(pad + lebar * 0.12, dasar - lebar * 0.06, lebar * 0.76, lebar * 0.06);

  c.globalCompositeOperation = "source-atop";
  const perut = c.createLinearGradient(0, dasar - lebar * 0.3, 0, dasar);
  perut.addColorStop(0, rgba(P.dalam, 0));
  perut.addColorStop(1, rgba(P.dalam, 0.7));
  c.fillStyle = perut;
  c.fillRect(0, 0, w, h);

  const lembut = Math.max(2, lebar * 0.01) * res; /* shadowBlur gak ikut scale */
  const arah = { x: 0.6, y: -0.8 };
  const lapis: [RGB, number, number][] = [
    [P.tengah, lebar * 0.035, 0.97],
    [P.terang, lebar * 0.07, 0.8],
  ];
  for (const [warna, d, k] of lapis) {
    c.fillStyle = rgba(warna, 1);
    c.shadowColor = rgba(warna, 1);
    c.shadowBlur = lembut;
    lukisGumpal(c, g, arah.x * d, arah.y * d, k);
  }
  c.shadowBlur = 0;
  c.globalCompositeOperation = "source-over";
  return { cv, w, h };
}

/* ---------- Sprite cahaya (semua di-cache sekali) ---------- */

/* Satu kipas berkas: wedge segitiga dari matahari, tiap berkas ditumpuk 6-8x
   dengan lebar menyusut biar tepinya lembut tanpa blur, lalu dimask radial
   (terang di dekat matahari, hilang di ujung). Resolusi 0.25x cukup karena
   berkas memang lembut, dan hemat memori untuk layar besar. */
function bangunKipas(K: KonfigKipas, R: number, dasar: number, warna: RGB): Kipas {
  const { cv, c } = bikinCv(R * 2, R * 2, 0.25);
  c.translate(R, R);
  const rnd = benih(K.seed);
  for (let i = 0; i < K.n; i++) {
    const a = dasar + (rnd() * 2 - 1) * K.spread;
    const hw = K.lebar[0] + rnd() * rnd() * (K.lebar[1] - K.lebar[0]);
    const al = 0.35 + rnd() * 0.65;
    const lp = hw > 0.045 ? 8 : 6;
    for (let j = 0; j < lp; j++) {
      const h = hw * (1 - (j / lp) * 0.85);
      c.fillStyle = rgba(warna, (al * 1.3) / lp);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a - h) * R * 1.2, Math.sin(a - h) * R * 1.2);
      c.lineTo(Math.cos(a + h) * R * 1.2, Math.sin(a + h) * R * 1.2);
      c.closePath();
      c.fill();
    }
  }
  c.globalCompositeOperation = "destination-in";
  const m = c.createRadialGradient(0, 0, 0, 0, 0, R);
  m.addColorStop(0, "rgba(0,0,0,1)");
  m.addColorStop(0.3, "rgba(0,0,0,.6)");
  m.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = m;
  c.fillRect(-R, -R, R * 2, R * 2);
  return { cv, R, K };
}

/* Kilau bintang 4 sudut + 2 diagonal tipis (dirotasi saat digambar). */
function bikinKilau(): HTMLCanvasElement {
  const S = 256;
  const { cv, c } = bikinCv(S, S, 1);
  c.translate(S / 2, S / 2);
  const arah: [number, number, number][] = [
    [0, 0.045, 1],
    [Math.PI / 2, 0.045, 1],
    [Math.PI / 4, 0.03, 0.45],
    [-Math.PI / 4, 0.03, 0.45],
  ];
  for (const [rot, tipis, kuat] of arah) {
    c.save();
    c.rotate(rot);
    c.scale(1, tipis);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * kuat})`);
    g.addColorStop(0.3, `rgba(255,246,220,${0.3 * kuat})`);
    g.addColorStop(1, "rgba(255,240,200,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, S / 2, 0, PI2);
    c.fill();
    c.restore();
  }
  return cv;
}

/* Hantu lens flare: cincin lembut dengan isi samar. */
function bikinCincin(warna: RGB): HTMLCanvasElement {
  const S = 96;
  const { cv, c } = bikinCv(S, S, 1);
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, rgba(warna, 0));
  g.addColorStop(0.55, rgba(warna, 0.1));
  g.addColorStop(0.84, rgba(warna, 0.7));
  g.addColorStop(0.93, rgba(warna, 0.25));
  g.addColorStop(1, rgba(warna, 0));
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  return cv;
}

/* Titik cahaya kecil untuk serbuk melayang. */
function bikinTitik(warna: RGB): HTMLCanvasElement {
  const S = 32;
  const { cv, c } = bikinCv(S, S, 1);
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, rgba(warna, 0.65));
  g.addColorStop(0.55, rgba(warna, 0.14));
  g.addColorStop(1, rgba(warna, 0));
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  return cv;
}

/* Pendar matahari yang tembus awan (di-screen di atas awan penutup). */
function bikinPendar(warna: RGB): HTMLCanvasElement {
  const S = 256;
  const { cv, c } = bikinCv(S, S, 1);
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,.95)");
  g.addColorStop(0.22, rgba(warna, 0.6));
  g.addColorStop(0.6, rgba(warna, 0.16));
  g.addColorStop(1, rgba(warna, 0));
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  return cv;
}

/* Peta alpha kecil (40px lebar) dari sprite awan, untuk ngecek apakah
   suatu titik layar tertutup awan. Kalau getImageData ditolak browser
   (canvas tainted), sprite pakai pendekatan elips di alfaDi(). */
function bikinMapa(s: Spr): Mapa | undefined {
  const w = 40;
  const h = Math.max(8, Math.round((w * s.h) / s.w));
  try {
    const { cv, c } = bikinCv(w, h, 1);
    c.imageSmoothingQuality = "high";
    c.drawImage(s.cv, 0, 0, w, h);
    const px = c.getImageData(0, 0, cv.width, cv.height).data;
    const d = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) d[i] = px[i * 4 + 3];
    return { d, w, h };
  } catch {
    return undefined;
  }
}

/* Alpha sprite di koordinat relatif (u,v) 0..1. */
function alfaDi(s: Spr, u: number, v: number): number {
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
  const m = s.mapa;
  if (!m) {
    const e = ((u - 0.5) / 0.46) ** 2 + ((v - 0.58) / 0.34) ** 2;
    return e < 1 ? Math.min(1, (1 - e) * 3) : 0;
  }
  return m.d[Math.floor(v * m.h) * m.w + Math.floor(u * m.w)] / 255;
}

/* Multiplier berkas terhadap tutupan c (0 terbuka, 1 tertutup penuh):
   menguat saat tertutup sebagian (cahaya ngintip celah), padam kalau penuh. */
const rayMul = (c: number) => (1 - 0.9 * c * c) * (1 + 2.8 * c * (1 - c));

export default function LatarShinkai() {
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.id = "bg-canvas";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;

    const diam = gerakDikurangi();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    let gelap = false;
    let hidup = true;
    let t = 0;
    let terakhir = performance.now();
    let rafId = 0;
    let frame = 0;
    let tampak = true;
    let timerUkur = 0;

    /* Kualitas adaptif: 1 = penuh, 0 = ringan (tanpa partikel, flare,
       rim light, dan kipas ke-3). Turun sekali kalau frame time jelek. */
    let kualitas = 1;
    let ema = 1 / 60;
    let nUkur = 0;

    let C = {
      tua: [0, 0, 0],
      langit: [0, 0, 0],
      pucat: [0, 0, 0],
      senja: [0, 0, 0],
      matahari: [0, 0, 0],
      awanTerang: [0, 0, 0],
      awanGelap: [0, 0, 0],
      siluet: [0, 0, 0],
    };
    let P: Palet = { bayang: [0, 0, 0], dalam: [0, 0, 0], tengah: [0, 0, 0], terang: [0, 0, 0] };

    let sprite: Spr[][] = [];
    let gambarAwan: HTMLImageElement[] = [];
    let siap = false; /* true setelah PNG selesai dimuat */
    let awan: Awan[][] = [];
    let kawanan: Kawanan[] = [];
    let bintang: Bintang[] = [];
    let partikel: Partikel[] = [];
    let meteor: Meteor[] = [];
    let langit: HTMLCanvasElement | null = null;
    let cahaya: HTMLCanvasElement | null = null;
    let kipas: Kipas[] = [];
    let kilau: HTMLCanvasElement | null = null;
    let hantu: HTMLCanvasElement[] = [];
    let debu: HTMLCanvasElement | null = null;
    let pendar: HTMLCanvasElement | null = null;
    let cincinK: HTMLCanvasElement | null = null;
    let sx = 0;
    let sy = 0;
    let berikutKawanan = 6;
    let berikutMeteor = 5;

    let gulir = 0;
    let gulirH = 0;
    const titik = { x: 0, y: 0 };
    const ptr = { x: 0, y: 0 };

    /* Tutupan matahari/bulan (dihaluskan) + posisi kursor dalam px. */
    let tAwan = 0;
    let tMouse = 0;
    let tRedup = 0; /* peredupan seluruh langit, lebih lambat dari tAwan/tMouse */
    let dtF = 1; /* dt frame terakhir; 1 = langsung (mode hening) */
    let kAda = false;
    const kursor = { x: 0, y: 0 };
    const kTarget = { x: 0, y: 0 };
    const pos = { x: 0, y: 0, dw: 0, dh: 0 };

    function baca() {
      C = {
        tua: bacaWarna("--langit-tua", "#2E7CC4"),
        langit: bacaWarna("--langit", "#5FB0EC"),
        pucat: bacaWarna("--langit-pucat", "#BFE2F8"),
        senja: bacaWarna("--senja", "#FFB37A"),
        matahari: bacaWarna("--matahari", "#FFD166"),
        awanTerang: bacaWarna("--awan-terang", "#FFFFFF"),
        awanGelap: bacaWarna("--awan-gelap", "#A9CBE9"),
        siluet: bacaWarna("--siluet", "#22364E"),
      };
      gelap = document.documentElement.dataset.tema === "gelap";
      if (gelap) {
        P = {
          terang: campur(C.awanTerang, [205, 225, 252], 0.4),
          tengah: C.awanTerang,
          bayang: C.awanGelap,
          dalam: campur(C.awanGelap, [8, 16, 34], 0.5),
        };
      } else {
        const bayang = campur(C.awanGelap, [160, 165, 220], 0.3);
        P = {
          terang: C.awanTerang,
          tengah: campur(C.awanGelap, C.awanTerang, 0.6),
          bayang,
          dalam: campur(bayang, [110, 135, 200], 0.5),
        };
      }
    }

    function bangunSprite() {
      if (!siap) {
        sprite = [];
        return;
      }
      const res = Math.min(dpr, 1.5);
      sprite = LAPIS.map((La, l) => {
        const daftar = gambarAwan.length
          ? gambarAwan.map((im) => dariGambar(im, La.uk[1], res, gelap ? P.terang : null))
          : Array.from({ length: 3 }, () => buatAwan(La.uk[1], P, res));
        for (const s of daftar) s.mapa = bikinMapa(s);
        /* Rim light cuma untuk lapis tengah/dekat: hangat siang, dingin malam. */
        if (l > 0) for (const s of daftar) s.hangat = bikinHangat(s, gelap ? [175, 205, 255] : C.matahari);
        return daftar;
      });
    }

    function taburAwan() {
      if (!sprite.length) return;
      const total = Math.max(7, Math.min(15, Math.round((W * H) / 110000)));
      const esk = Math.max(0.6, Math.min(1, W / 1000));
      awan = LAPIS.map((La, l) => {
        const n = Math.max(1, Math.round(total * La.n));
        const daftar: Awan[] = [];
        for (let j = 0; j < n; j++) {
          const i = Math.floor(Math.random() * 99);
          const uk = acak(La.uk[0], La.uk[1]) * esk;
          const s = sprite[l][i % sprite[l].length];
          const k = uk / La.uk[1];
          daftar.push({
            x: Math.random() * (W + s.w * k + SLK * 2),
            y: acak(H * 0.02, H * 0.78) + s.h * k + SLK,
            v: acak(La.v[0], La.v[1]),
            l,
            i,
            uk,
            a: La.a * acak(0.88, 1),
            fase: Math.random() * PI2,
            tt: 0,
          });
        }
        return daftar;
      });
    }

    function taburPartikel() {
      const n = Math.round(Math.max(14, Math.min(46, (W * H) / 30000)));
      partikel = Array.from({ length: n }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: acak(1.2, 3.6),
        vx: acak(2, 9),
        vy: -acak(1, 7),
        fase: Math.random() * PI2,
        a: acak(0.35, 0.9),
        f: acak(0.6, 1.6),
      }));
    }

    /* Layer statis: langit + bintang diam + matahari/bulan (opaque), dan
       layer cahaya (bloom, halo, kilau memanjang) yang ditimpa blend
       "screen" DI ATAS awan. Sprite kipas berkas, kilau, hantu flare dan
       titik debu juga dibangun di sini. Cuma dibangun ulang pas resize /
       ganti tema; yang bergerak (rotasi, denyut) dikerjakan di gambar(). */
    function bangunStatik() {
      sx = W * (W < 700 ? 0.72 : 0.8);
      sy = H * (W < 700 ? 0.13 : 0.17);
      const L = bikinCv(W, H, dpr);
      const c = L.c;
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, rgba(C.tua, 1));
      g.addColorStop(0.55, rgba(C.langit, 1));
      g.addColorStop(1, rgba(C.pucat, 1));
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      if (!gelap) {
        const hg = c.createLinearGradient(0, H * 0.7, 0, H);
        hg.addColorStop(0, rgba(C.senja, 0));
        hg.addColorStop(1, rgba(C.senja, 0.2));
        c.fillStyle = hg;
        c.fillRect(0, H * 0.7, W, H * 0.3);
      }
      const r1 = benih(11);
      for (let i = 0; i < 16; i++) {
        const x = (i / 15) * (W + 200) - 100 + (r1() - 0.5) * 80;
        const r = 60 + r1() * 100;
        const y = H * (0.98 + r1() * 0.05);
        const rg = c.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, rgba(P.terang, gelap ? 0.3 : 0.65));
        rg.addColorStop(1, rgba(P.terang, 0));
        c.fillStyle = rg;
        c.fillRect(x - r, y - r, r * 2, r * 2);
      }

      bintang = [];
      if (gelap) {
        const r2 = benih(5);
        const n = Math.round((W * H) / 14000);
        c.fillStyle = "#EAF3FF";
        for (let i = 0; i < n; i++) {
          const b = { x: r2() * W, y: r2() * H * 0.85, r: 0.5 + r2() * r2() * 1.5, fase: r2() * PI2 };
          if (r2() < 0.3) {
            bintang.push(b);
          } else {
            c.globalAlpha = 0.35 + r2() * 0.5;
            c.beginPath();
            c.arc(b.x, b.y, b.r, 0, PI2);
            c.fill();
          }
        }
        c.globalAlpha = 1;
        /* Bulan sabit: potong piringan dengan lingkaran lain (evenodd). */
        const R = 21;
        const gm = c.createRadialGradient(sx, sy, R * 0.6, sx, sy, R * 4.5);
        gm.addColorStop(0, "rgba(215,230,255,.4)");
        gm.addColorStop(1, "rgba(215,230,255,0)");
        c.fillStyle = gm;
        c.fillRect(sx - R * 5, sy - R * 5, R * 10, R * 10);
        c.save();
        c.beginPath();
        c.arc(sx, sy, R, 0, PI2);
        c.clip();
        c.beginPath();
        c.rect(sx - R * 2, sy - R * 2, R * 4, R * 4);
        c.moveTo(sx - R * 0.42 + R * 0.86, sy - R * 0.28);
        c.arc(sx - R * 0.42, sy - R * 0.28, R * 0.86, 0, PI2);
        c.fillStyle = "rgba(236,244,255,.97)";
        c.fill("evenodd");
        c.restore();
      } else {
        const gs = c.createRadialGradient(sx, sy, 0, sx, sy, 130);
        gs.addColorStop(0, "rgba(255,255,255,1)");
        gs.addColorStop(0.16, rgba(C.matahari, 0.95));
        gs.addColorStop(0.45, rgba(C.matahari, 0.22));
        gs.addColorStop(1, rgba(C.matahari, 0));
        c.fillStyle = gs;
        c.fillRect(sx - 130, sy - 130, 260, 260);
        c.fillStyle = "rgba(255,255,255,.98)";
        c.beginPath();
        c.arc(sx, sy, 17, 0, PI2);
        c.fill();
      }

      const T = bikinCv(W, H, 0.5);
      const d = T.c;
      if (!gelap) {
        const rr = Math.max(W, H) * 0.6;
        const h1 = d.createRadialGradient(sx, sy, 0, sx, sy, rr);
        h1.addColorStop(0, rgba(C.matahari, 0.5));
        h1.addColorStop(0.15, rgba(C.matahari, 0.26));
        h1.addColorStop(0.5, rgba(C.matahari, 0.07));
        h1.addColorStop(1, rgba(C.matahari, 0));
        d.fillStyle = h1;
        d.fillRect(0, 0, W, H);
        /* Halo cincin tipis di sekitar matahari. */
        const rh = Math.max(W, H) * 0.2;
        const hr = d.createRadialGradient(sx, sy, 0, sx, sy, rh);
        hr.addColorStop(0, "rgba(255,248,230,0)");
        hr.addColorStop(0.8, "rgba(255,248,230,0)");
        hr.addColorStop(0.9, "rgba(255,248,230,.1)");
        hr.addColorStop(1, "rgba(255,248,230,0)");
        d.fillStyle = hr;
        d.fillRect(sx - rh, sy - rh, rh * 2, rh * 2);
        /* Kilau memanjang horizontal (anamorphic). */
        d.save();
        d.translate(sx, sy);
        d.scale(1, 0.045);
        const sk = W * 0.55;
        const gk = d.createRadialGradient(0, 0, 0, 0, 0, sk);
        gk.addColorStop(0, "rgba(255,255,255,.6)");
        gk.addColorStop(1, "rgba(255,255,255,0)");
        d.fillStyle = gk;
        d.beginPath();
        d.arc(0, 0, sk, 0, PI2);
        d.fill();
        d.restore();
      } else {
        const rr = Math.min(W, H) * 0.55;
        const gh = d.createRadialGradient(sx, sy, 0, sx, sy, rr);
        gh.addColorStop(0, "rgba(190,215,255,.34)");
        gh.addColorStop(0.25, "rgba(160,190,240,.12)");
        gh.addColorStop(1, "rgba(160,190,240,0)");
        d.fillStyle = gh;
        d.fillRect(0, 0, W, H);
        /* Halo cincin bulan. */
        const rh = Math.min(W, H) * 0.2;
        const hr = d.createRadialGradient(sx, sy, 0, sx, sy, rh);
        hr.addColorStop(0, "rgba(200,222,255,0)");
        hr.addColorStop(0.78, "rgba(200,222,255,0)");
        hr.addColorStop(0.88, "rgba(200,222,255,.1)");
        hr.addColorStop(1, "rgba(200,222,255,0)");
        d.fillStyle = hr;
        d.fillRect(sx - rh, sy - rh, rh * 2, rh * 2);
      }
      langit = L.cv;
      cahaya = T.cv;

      /* Sprite untuk elemen bergerak. Kipas mengarah dari matahari ke
         sekitar tengah layar; jari-jari dibatasi biar memori aman. */
      const jari = Math.min(Math.hypot(Math.max(sx, W - sx), Math.max(sy, H - sy)), Math.max(W, H) * 1.05);
      const dasar = Math.atan2(H * 0.58 - sy, W * 0.42 - sx);
      const warnaKipas: RGB = gelap ? [170, 195, 240] : campur([255, 255, 255], C.matahari, 0.3);
      kipas = (gelap ? KIPAS_MALAM : KIPAS).map((K) => bangunKipas(K, jari, dasar, warnaKipas));
      pendar = bikinPendar(gelap ? [190, 215, 255] : C.matahari);
      cincinK = bikinCincin(gelap ? [190, 215, 255] : C.matahari);
      kilau = gelap ? null : bikinKilau();
      hantu = gelap ? [] : [bikinCincin(C.matahari), bikinCincin([170, 210, 255])];
      debu = bikinTitik(gelap ? [190, 215, 255] : campur([255, 255, 255], C.matahari, 0.45));
    }

    /* Posisi layar sebuah awan (dipakai gambar() dan hitungTutup()). */
    function hitungPos(a: Awan, La: (typeof LAPIS)[number], s: Spr) {
      const k = a.uk / La.uk[1];
      pos.dw = s.w * k;
      pos.dh = s.h * k;
      pos.x = mod(a.x, W + pos.dw + SLK * 2) - pos.dw - SLK - ptr.x * La.pf;
      pos.y =
        mod(a.y - gulirH * La.f, H + pos.dh + SLK * 2) -
        pos.dh -
        SLK -
        ptr.y * La.pf * 0.5 +
        Math.sin(t * 0.12 + a.fase) * La.bob;
    }

    /* Seberapa tertutup matahari oleh awan (0..1). Sekalian isi a.tt =
       kontribusi tiap awan, buat bikin awan penutup menyala. */
    function hitungTutup(): number {
      let sisa = 1;
      for (let l = 0; l < awan.length; l++) {
        const La = LAPIS[l];
        for (const a of awan[l]) {
          a.tt = 0;
          const s = sprite[l][a.i % sprite[l].length];
          hitungPos(a, La, s);
          const { x, y, dw, dh } = pos;
          if (sx < x - RS || sx > x + dw + RS || sy < y - RS || sy > y + dh + RS) continue;
          let jum = 0;
          for (const [ox, oy, w] of TITIK_UJI) jum += w * alfaDi(s, (sx + ox * RS - x) / dw, (sy + oy * RS - y) / dh);
          a.tt = Math.min(1, jum / 6) * a.a;
          sisa *= 1 - a.tt;
        }
      }
      return 1 - sisa;
    }

    /* Seberapa tertutup matahari oleh kursor: penuh kalau pusatnya
       nyaris ketimpa, nol kalau sudah lewat RC+RS. */
    function hitungMouse(): number {
      if (!kAda) return 0;
      const u = Math.max(0, Math.min(1, (RC + RS - Math.hypot(kursor.x - sx, kursor.y - sy)) / 28));
      return u * u * (3 - 2 * u);
    }

    function bikinKawanan(): Kawanan {
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      const n = 5 + Math.floor(Math.random() * 3);
      const anggota: Burung[] = [];
      for (let i = 0; i < n; i++) {
        const baris = Math.ceil(i / 2);
        anggota.push({
          ox: -baris * acak(13, 17),
          oy: i === 0 ? 0 : (i % 2 ? 1 : -1) * baris * acak(6, 9),
          s: acak(4.5, 7),
          fase: Math.random() * PI2,
        });
      }
      return {
        x: dir === 1 ? -120 : W + 120,
        y: acak(H * 0.08, H * 0.36),
        dir,
        v: acak(20, 30),
        ay: acak(4.2, 5.2),
        anggota,
      };
    }

    function bikinMeteor(): Meteor {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const sdt = acak(0.35, 0.7);
      const kec = acak(650, 950);
      return {
        x: acak(W * 0.1, W * 0.9),
        y: acak(0, H * 0.35),
        vx: dir * Math.cos(sdt) * kec,
        vy: Math.sin(sdt) * kec,
        umur: 0,
        maks: acak(0.7, 1.1),
        pj: acak(90, 160),
      };
    }

    function gambarBurung(x: number, y: number, s: number, kepak: number) {
      const ay = kepak * s * 0.55;
      ctx.beginPath();
      ctx.moveTo(x - s, y - ay);
      ctx.quadraticCurveTo(x - s * 0.4, y - ay * 0.2 - s * 0.1, x, y);
      ctx.quadraticCurveTo(x + s * 0.4, y - ay * 0.2 - s * 0.1, x + s, y - ay);
      ctx.stroke();
    }

    /* Berkas cahaya bergerak: tiap kipas diputar di sekitar matahari
       (goyang sinus + ikut pointer), sedikit "bernapas" skalanya, dan
       alpha-nya berdenyut dengan frekuensi sendiri-sendiri. */
    function gambarKipas(mul: number) {
      ctx.globalCompositeOperation = "screen";
      const n = kualitas ? kipas.length : Math.min(2, kipas.length);
      for (let i = 0; i < n; i++) {
        const f = kipas[i];
        const K = f.K;
        const rot = K.sway * Math.sin(t * K.w + i * 2.1) + ptr.x * K.pf;
        const sk = 1 + 0.03 * Math.sin(t * 0.21 + i * 1.3);
        ctx.globalAlpha = Math.max(0, Math.min(1, K.a * mul * (0.62 + 0.38 * Math.sin(t * K.den + i * 1.7))));
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(rot);
        ctx.scale(sk, sk);
        ctx.drawImage(f.cv, -f.R, -f.R, f.R * 2, f.R * 2);
        ctx.restore();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    function gambar() {
      if (!langit || !cahaya) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.drawImage(langit, 0, 0, W, H);

      /* Seberapa tertutup matahari/bulan: awan (peta alpha sprite) dan
         kursor. Dihaluskan biar transisinya mulus. */
      tAwan += (hitungTutup() - tAwan) * Math.min(1, dtF * 3);
      tMouse += (hitungMouse() - tMouse) * Math.min(1, dtF * 8);
      const tutup = 1 - (1 - tAwan) * (1 - tMouse);
      /* Kursor cuma nutup sebagian kecil sinar, jadi bobotnya 0.6. */
      tRedup += (1 - (1 - tAwan) * (1 - tMouse * 0.6) - tRedup) * Math.min(1, dtF * 1.6);

      if (gelap) {
        ctx.fillStyle = "#EAF3FF";
        for (const b of bintang) {
          ctx.globalAlpha = 0.3 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.9 + b.fase));
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 0.3, 0, PI2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      /* Kursor di depan matahari/bulan: piringan + glow intinya ketutup
         (ditimpa warna langit di titik itu). */
      if (tMouse > 0.01) {
        const rt = H > 0 ? sy / H : 0;
        const lk = rt < 0.55 ? campur(C.tua, C.langit, rt / 0.55) : campur(C.langit, C.pucat, (rt - 0.55) / 0.45);
        const rp = 130;
        const gp = ctx.createRadialGradient(sx, sy, 0, sx, sy, rp);
        gp.addColorStop(0, rgba(lk, tMouse * 0.97));
        gp.addColorStop(0.45, rgba(lk, tMouse * 0.8));
        gp.addColorStop(1, rgba(lk, 0));
        ctx.fillStyle = gp;
        ctx.fillRect(sx - rp, sy - rp, rp * 2, rp * 2);
      }

      const rimR = Math.max(W, H) * (gelap ? 0.4 : 0.55);
      const rimK = gelap ? 0.7 : 1;
      for (let l = 0; l < LAPIS.length; l++) {
        const La = LAPIS[l];
        for (const a of awan[l] ?? []) {
          const s = sprite[l][a.i % sprite[l].length];
          hitungPos(a, La, s);
          const { x, y, dw, dh } = pos;
          ctx.globalAlpha = a.a;
          ctx.drawImage(s.cv, x, y, dw, dh);
          /* Tepi awan dekat matahari/bulan menyala; awan yang lagi nutupin
             menyala lebih kuat (cahaya tembus dari baliknya). */
          if (s.hangat && kualitas) {
            const p = Math.max(0, 1 - Math.hypot(x + dw / 2 - sx, y + dh * 0.45 - sy) / rimR);
            const q = Math.min(1, p * 1.25);
            const al = (q * q * 0.55 + a.tt * 0.9) * a.a * rimK;
            if (al > 0.01) {
              ctx.globalCompositeOperation = "screen";
              ctx.globalAlpha = Math.min(1, al);
              ctx.drawImage(s.hangat, x, y, dw, dh);
              ctx.globalCompositeOperation = "source-over";
            }
          }
        }
        /* Berkas lewat DI ANTARA awan tengah dan awan dekat: awan dekat
           nutupin sebagian berkas, jadi cahaya kelihatan tembus celah. */
        if (l === 1) gambarKipas(rayMul(tutup));
      }

      /* Matahari/bulan ketutup -> seluruh langit (dan awan) ikut gelap.
         Multiply biru-abu: langit makin dalam, awan putih jadi kelabu. */
      if (tRedup > 0.01) {
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = Math.min(1, tRedup * REDUP_MAKS * (gelap ? 0.5 : 1));
        ctx.fillStyle = REDUP_WARNA;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = "source-over";
      }

      /* Matahari/bulan di balik awan: pendar tembus awan (setelah
         peredupan, jadi tetap titik paling terang). */
      if (pendar && tAwan > 0.02) {
        const rp = 150 * (1 + 0.06 * Math.sin(t * 1.1));
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = Math.min(1, tAwan * 0.7) * (1 - tMouse);
        ctx.drawImage(pendar, sx - rp, sy - rp, rp * 2, rp * 2);
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.globalAlpha = gelap ? 0.5 : 0.6;
      ctx.strokeStyle = rgba(C.siluet, 1);
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      for (const k of kawanan) {
        const ky = k.y - gulirH * 0.05;
        for (const b of k.anggota) {
          gambarBurung(k.x + b.ox * k.dir, ky + b.oy, b.s, Math.sin(t * k.ay + b.fase));
        }
      }

      /* Bloom + halo di atas segalanya (screen) biar cahaya "tembus".
         Meredup kalau tertutup, tapi gak pernah mati total (cahaya bocor). */
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = (0.85 + 0.15 * Math.sin(t * 0.6)) * (1 - 0.5 * tAwan - 0.3 * tMouse);
      ctx.drawImage(cahaya, 0, 0, W, H);

      /* Kilau bintang matahari: berputar pelan + berkedip; hilang kalau
         tertutup. */
      const lihat = 1 - tutup;
      if (kilau && lihat > 0.02) {
        const sz = Math.max(260, Math.min(520, W * 0.28));
        ctx.globalAlpha = (0.5 + 0.3 * Math.sin(t * 1.2)) * lihat * Math.sqrt(lihat);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(t * 0.035 + ptr.x * 0.3);
        ctx.drawImage(kilau, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }

      /* Hantu lens flare: bergeser ngikutin pointer lewat titik tengah;
         lenyap cepat kalau matahari tertutup (flare butuh sumber langsung). */
      if (hantu.length && kualitas && lihat > 0.02) {
        const cx = W * 0.5 - ptr.x * W * 0.16;
        const cy = H * 0.5 - ptr.y * H * 0.16;
        const esk = Math.max(0.7, Math.min(1.2, W / 1400));
        for (let i = 0; i < HANTU.length; i++) {
          const [tf, dm, al, w] = HANTU[i];
          const ukr = dm * esk * (1 + 0.04 * Math.sin(t * 0.7 + i));
          ctx.globalAlpha = al * (0.75 + 0.25 * Math.sin(t * 0.9 + i * 1.9)) * lihat * lihat;
          ctx.drawImage(hantu[w], sx + (cx - sx) * tf - ukr / 2, sy + (cy - sy) * tf - ukr / 2, ukr, ukr);
        }
      }

      /* Cincin cahaya bocor di sekeliling kursor pas nutupin matahari
         (efek gerhana). Redup kalau awan juga lagi nutupin. */
      if (cincinK && tMouse > 0.02) {
        const dm = RC * 2.6 * (1 + 0.05 * Math.sin(t * 2));
        ctx.globalAlpha = tMouse * (1 - tMouse * 0.4) * 0.55 * (1 - tAwan) * (gelap ? 0.6 : 1);
        ctx.drawImage(cincinK, kursor.x - dm / 2, kursor.y - dm / 2, dm, dm);
      }

      /* Serbuk cahaya: makin terang makin dekat matahari/bulan. */
      if (debu && kualitas) {
        const jauh = Math.max(W, H) * 0.9;
        for (const p of partikel) {
          const dekat = 0.4 + 0.6 * Math.max(0, 1 - Math.hypot(p.x - sx, p.y - sy) / jauh);
          const kedip = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.f + p.fase));
          ctx.globalAlpha = Math.min(1, p.a * dekat * kedip * (gelap ? 0.8 : 1));
          const dm = p.r * 6;
          ctx.drawImage(debu, p.x - dm / 2 - ptr.x * p.r * 10, p.y - dm / 2 - ptr.y * p.r * 6, dm, dm);
        }
      }

      /* Bintang jatuh (malam). */
      if (meteor.length) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        for (const m of meteor) {
          const al = Math.sin(Math.min(1, m.umur / m.maks) * Math.PI);
          const n = Math.hypot(m.vx, m.vy);
          const tx = m.x - (m.vx / n) * m.pj;
          const ty = m.y - (m.vy / n) * m.pj;
          const gr = ctx.createLinearGradient(m.x, m.y, tx, ty);
          gr.addColorStop(0, `rgba(255,255,255,${0.9 * al})`);
          gr.addColorStop(1, "rgba(180,210,255,0)");
          ctx.strokeStyle = gr;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(tx, ty);
          ctx.stroke();
        }
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }

    function putar(now: number) {
      if (!hidup) return;
      const mentah = (now - terakhir) / 1000;
      const dt = Math.min(mentah, 0.05);
      terakhir = now;
      t += dt;
      dtF = dt;
      if (frame++ % 30 === 0) tampak = canvas.getClientRects().length > 0; /* mode latar polos = disembunyiin */
      if (tampak) {
        /* Pantau frame time; sekali jelek langsung turun ke mode ringan. */
        if (mentah < 0.5) {
          ema += (mentah - ema) * 0.04;
          nUkur++;
          if (kualitas && nUkur > 180 && ema > 0.027) kualitas = 0;
        }
        for (const lp of awan) for (const a of lp) a.x += a.v * dt;
        gulirH += (gulir - gulirH) * Math.min(1, dt * 6);
        ptr.x += (titik.x - ptr.x) * Math.min(1, dt * 2.2);
        ptr.y += (titik.y - ptr.y) * Math.min(1, dt * 2.2);
        const kl = Math.min(1, dt * 14);
        kursor.x += (kTarget.x - kursor.x) * kl;
        kursor.y += (kTarget.y - kursor.y) * kl;

        if (kualitas) {
          for (const p of partikel) {
            p.x += (p.vx + Math.sin(t * 0.5 + p.fase) * 5) * dt;
            p.y += p.vy * dt;
            if (p.x > W + 30) p.x = -30;
            else if (p.x < -30) p.x = W + 30;
            if (p.y < -30) p.y = H + 30;
          }
        }

        berikutKawanan -= dt;
        if (berikutKawanan <= 0 && kawanan.length < 1) {
          kawanan.push(bikinKawanan());
          berikutKawanan = acak(20, 38);
        }
        for (const k of kawanan) k.x += k.v * k.dir * dt;
        kawanan = kawanan.filter((k) => (k.dir === 1 ? k.x < W + 150 : k.x > -150));

        if (gelap) {
          berikutMeteor -= dt;
          if (berikutMeteor <= 0 && meteor.length < 1) {
            meteor.push(bikinMeteor());
            berikutMeteor = acak(9, 20);
          }
        }
        for (const m of meteor) {
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          m.umur += dt;
        }
        if (meteor.length) meteor = meteor.filter((m) => m.umur < m.maks);

        gambar();
      }
      rafId = requestAnimationFrame(putar);
    }

    function onGulir() {
      gulir = window.scrollY;
      if (diam) {
        gulirH = gulir;
        gambar();
      }
    }
    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      titik.x = e.clientX / Math.max(1, W) - 0.5;
      titik.y = e.clientY / Math.max(1, H) - 0.5;
      kTarget.x = e.clientX;
      kTarget.y = e.clientY;
      if (!kAda) {
        kursor.x = e.clientX;
        kursor.y = e.clientY;
        kAda = true;
      }
    }
    function onKeluar() {
      kAda = false;
    }
    function onTema() {
      baca();
      bangunSprite();
      bangunStatik();
      meteor = [];
      if (diam) gambar();
    }
    /* Resize beneran (lebar berubah / tinggi geser >140px) = tabur ulang.
       Toolbar HP muncul/hilang (geser kecil) = awan JANGAN diacak. */
    function ukur() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const nyata = w !== W || Math.abs(h - H) > 140;
      if (!nyata && h <= H) return;
      W = w;
      H = h;
      canvas.width = Math.ceil(W * dpr);
      canvas.height = Math.ceil(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      bangunStatik();
      if (nyata) {
        taburAwan();
        taburPartikel();
      }
      gulir = window.scrollY;
      gulirH = gulir;
      gambar();
    }
    function onUkur() {
      window.clearTimeout(timerUkur);
      timerUkur = window.setTimeout(ukur, 120);
    }

    baca();
    bangunSprite();
    window.addEventListener("resize", onUkur);
    window.addEventListener("tema:ubah", onTema);
    window.addEventListener("scroll", onGulir, { passive: true });
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("mouseleave", onKeluar);
    ukur();
    muatGambar().then((daftar) => {
      if (!hidup) return;
      gambarAwan = daftar;
      siap = true;
      bangunSprite();
      taburAwan();
      if (diam) gambar();
    });
    if (diam) {
      /* Versi hening: satu kawanan statis biar identitas tema tetap kebaca. */
      const k = bikinKawanan();
      k.x = W * 0.62;
      k.y = H * 0.22;
      kawanan = [k];
      gambar();
    } else {
      rafId = requestAnimationFrame(putar);
    }

    return () => {
      hidup = false;
      cancelAnimationFrame(rafId);
      window.clearTimeout(timerUkur);
      window.removeEventListener("resize", onUkur);
      window.removeEventListener("tema:ubah", onTema);
      window.removeEventListener("scroll", onGulir);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onKeluar);
      canvas.remove();
    };
  }, []);

  return null;
}
