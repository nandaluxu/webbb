/* Perkakas bersama tema Hanami: palet warna, bentuk kelopak, sprite
   kelopak, dan ranting sakura. Dipakai LatarHanami dan TransisiKelopak.
   Semua gambar dibuat sekali ke canvas luar-layar, lalu tinggal di-drawImage. */

import { bacaWarna, rgba } from "@/components/efek/warna";

export type Warna = number[];
export type Palet = {
  tua: Warna;
  sakura: Warna;
  pucat: Warna;
  wakaba: Warna;
  kayu: Warna;
  sinar: Warna;
  plum: Warna;
  lentera: Warna;
};
export type Spr = { cv: HTMLCanvasElement; w: number };

export const acak = (a: number, b: number) => a + Math.random() * (b - a);

/* Baca warna dari CSS variable. Variable baru (--ranting, --sinar, --plum,
   --lentera) opsional: kalau belum didefinisikan, nilai bawaan di bawah dipakai. */
export function bacaPalet(gelap: boolean): Palet {
  return {
    tua: bacaWarna("--sakura-tua", "#D6849F"),
    sakura: bacaWarna("--sakura", "#EBA9BC"),
    pucat: bacaWarna("--sakura-pucat", "#FBDCE5"),
    wakaba: bacaWarna("--wakaba", "#789A66"),
    kayu: bacaWarna("--ranting", gelap ? "#5A4258" : "#7B5E58"),
    sinar: bacaWarna("--sinar", "#FFE6A8"),
    plum: bacaWarna("--plum", "#3B2650"),
    lentera: bacaWarna("--lentera", "#FFA85A"),
  };
}

/* Satu kelopak sakura: ujung berlekuk, pangkal di (0, +L/2), ujung di (0, -L/2). */
export function jalurKelopak(c: CanvasRenderingContext2D, L: number, Wd: number) {
  c.beginPath();
  c.moveTo(0, L * 0.5);
  c.bezierCurveTo(-Wd * 0.55, L * 0.22, -Wd * 0.62, -L * 0.34, -Wd * 0.17, -L * 0.5);
  c.quadraticCurveTo(0, -L * 0.36, Wd * 0.17, -L * 0.5);
  c.bezierCurveTo(Wd * 0.62, -L * 0.34, Wd * 0.55, L * 0.22, 0, L * 0.5);
  c.closePath();
}

export function buatSpriteKelopak(
  maks: number,
  blur: number,
  varian: number,
  P: Palet,
  dpr: number,
): Spr {
  const pad = Math.ceil(maks * 0.2 + blur * 3);
  const sisi = maks + pad * 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = Math.ceil(sisi * dpr);
  const c = cv.getContext("2d")!;
  c.scale(dpr, dpr);
  c.translate(sisi / 2, sisi / 2);
  if (blur > 0) c.filter = `blur(${blur}px)`;
  const g = c.createLinearGradient(0, maks * 0.5, 0, -maks * 0.5);
  const [a, b, d] = varian === 0 ? [P.tua, P.sakura, P.pucat] : [P.sakura, P.pucat, P.pucat];
  g.addColorStop(0, rgba(a, 1));
  g.addColorStop(0.65, rgba(b, 1));
  g.addColorStop(1, rgba(d, 1));
  c.fillStyle = g;
  jalurKelopak(c, maks, maks * 0.72);
  c.fill();
  if (blur === 0) {
    c.strokeStyle = rgba(P.tua, 0.25);
    c.lineWidth = 0.6;
    c.beginPath();
    c.moveTo(0, maks * 0.44);
    c.lineTo(0, -maks * 0.18);
    c.stroke();
  }
  return { cv, w: sisi };
}

/* ---------- Ranting ---------- */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gambarBunga(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  P: Palet,
) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  for (let i = 0; i < 5; i++) {
    c.save();
    c.rotate((i * Math.PI * 2) / 5);
    c.translate(0, -r * 0.5);
    const g = c.createLinearGradient(0, r * 0.5, 0, -r * 0.5);
    g.addColorStop(0, rgba(P.tua, 1));
    g.addColorStop(0.45, rgba(P.sakura, 1));
    g.addColorStop(1, rgba(P.pucat, 1));
    c.fillStyle = g;
    jalurKelopak(c, r, r * 0.86);
    c.fill();
    c.strokeStyle = rgba(P.tua, 0.18);
    c.lineWidth = 0.5;
    c.stroke();
    c.restore();
  }
  c.strokeStyle = rgba(P.tua, 0.9);
  c.fillStyle = rgba(P.tua, 1);
  c.lineWidth = 0.6;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const l = r * (0.28 + (i % 2) * 0.08);
    const px = Math.cos(a) * l;
    const py = Math.sin(a) * l;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(px, py);
    c.stroke();
    c.beginPath();
    c.arc(px, py, r * 0.05 + 0.4, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/* Ranting yang menjuntai dari pojok kanan-atas sprite (jangkar di (bw, 0)).
   Bentuknya deterministik (seed), jadi tidak berubah-ubah saat resize / ganti tema.
   Untuk pojok kiri, sprite yang sama tinggal dicerminkan saat digambar. */
export function buatRanting(
  bw: number,
  bh: number,
  dpr: number,
  P: Palet,
  seed: number,
): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(bw * dpr);
  cv.height = Math.ceil(bh * dpr);
  const c = cv.getContext("2d")!;
  c.scale(dpr, dpr);

  const r = rng(seed);
  const ra = (a: number, b: number) => a + r() * (b - a);
  const u = Math.max(0.55, Math.min(1.1, bw / 540));

  type Titik = { x: number; y: number; s: number; rot: number };
  const bunga: Titik[] = [];
  const daun: Titik[] = [];
  const kuncup: Titik[] = [];

  c.lineCap = "round";
  c.lineJoin = "round";
  c.strokeStyle = rgba(P.kayu, 0.92);

  const tumbuh = (
    x0: number,
    y0: number,
    sudut: number,
    panjang: number,
    lebar: number,
    dalam: number,
  ) => {
    const langkah = Math.max(5, Math.round(panjang / 13));
    const dl = panjang / langkah;
    const tarik = dalam === 0 ? 0.014 : 0.05; // makin dalam, makin menjuntai
    let x = x0;
    let y = y0;
    let a = sudut;
    for (let i = 0; i < langkah; i++) {
      a += (Math.PI / 2 - a) * tarik + (r() - 0.5) * 0.22;
      const nx = x + Math.cos(a) * dl;
      const ny = y + Math.sin(a) * dl;
      c.lineWidth = Math.max(0.8, lebar * (1 - (i / langkah) * 0.65));
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(nx, ny);
      c.stroke();
      x = nx;
      y = ny;
      if (i > 1 && dalam < 2 && r() < (dalam === 0 ? 0.13 : 0.15)) {
        tumbuh(
          x,
          y,
          a + (r() < 0.5 ? -1 : 1) * ra(0.5, 1.0),
          panjang * ra(0.32, 0.5),
          lebar * 0.55,
          dalam + 1,
        );
      }
      const pBunga = dalam === 0 ? (i > 3 ? 0.1 : 0) : 0.14;
      if (r() < pBunga) bunga.push({ x, y, s: ra(0.75, 1.1), rot: ra(0, 6.28) });
      if (r() < (dalam === 0 ? 0.08 : 0.1)) daun.push({ x, y, s: ra(0.8, 1.2), rot: a + ra(-1, 1) });
    }
    if (dalam > 0) {
      bunga.push({ x, y, s: ra(0.9, 1.15), rot: ra(0, 6.28) });
      if (r() < 0.7) {
        bunga.push({ x: x + ra(-9, 9) * u, y: y + ra(-4, 9) * u, s: ra(0.7, 0.95), rot: ra(0, 6.28) });
      }
      kuncup.push({ x: x + ra(-6, 6) * u, y: y + ra(4, 10) * u, s: ra(0.8, 1.2), rot: ra(-0.6, 0.6) });
    }
  };

  tumbuh(bw + 24, -12, Math.PI - 0.3, bw * 1.05, 5.2 * u, 0);

  c.fillStyle = rgba(P.wakaba, 0.72);
  for (const d of daun) {
    c.beginPath();
    c.ellipse(d.x, d.y, 9 * d.s * u, 3.6 * d.s * u, d.rot, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = rgba(P.tua, 0.9);
  for (const k of kuncup) {
    c.beginPath();
    c.ellipse(k.x, k.y, 3 * k.s * u, 5 * k.s * u, k.rot, 0, Math.PI * 2);
    c.fill();
  }
  for (const b of bunga) gambarBunga(c, b.x, b.y, 11 * b.s * u, b.rot, P);

  // pudarkan ke arah ujung supaya ranting jadi atmosfer, bukan penghalang konten
  c.globalCompositeOperation = "destination-in";
  const m = c.createRadialGradient(bw, 0, bw * 0.15, bw, 0, bw * 1.08);
  m.addColorStop(0, "rgba(0,0,0,1)");
  m.addColorStop(0.7, "rgba(0,0,0,0.92)");
  m.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = m;
  c.fillRect(0, 0, bw, bh);
  c.globalCompositeOperation = "source-over";
  return cv;
}
