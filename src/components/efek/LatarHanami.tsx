"use client";

/* Latar Hanami: taman sakura musim semi.

   Terang (pagi): semburat fajar merah muda + wakaba, berkas sinar yang
   menembus dedaunan (komorebi) dan bintik cahaya yang pelan bergeser.
   Gelap (senja): langit ungu plum, kaki langit dusty pink, cahaya lentera
   yang samar berkedip.

   Kedalaman, dari jauh ke dekat:
   kelopak jauh (kecil, buram) -> kelopak tengah -> ranting di pojok layar
   -> kelopak dekat (besar, bokeh) -> kelopak "lintas" yang sesekali melesat
   sangat dekat kamera dengan blur + rotasi 3D.

   Interaksi: kursor meniup kelopak di sekitarnya, scroll menggeser tiap
   lapis dengan kecepatan beda (parallax), ranting ikut goyang diterpa angin.
   Hujan kelopak bisa dipicu dari komponen lain:
     window.dispatchEvent(new CustomEvent("hanami:hujan", { detail: { x, y, jumlah } }))
   (x, y dalam px layar; semuanya opsional).

   Gerak dikurangi = digambar sekali, tanpa animasi. */

import { useEffect } from "react";
import { gerakDikurangi, rgba } from "@/components/efek/warna";
import {
  acak,
  bacaPalet,
  buatRanting,
  buatSpriteKelopak,
  type Palet,
  type Spr,
} from "@/components/efek/sakura";

/* Saklar: matikan satu per satu kalau ada yang terasa terlalu ramai. */
const OPSI = {
  ranting: true,
  rantingKiri: true,
  cahaya: true, // sinar pagi (terang) / lentera (gelap)
  lintas: true, // kelopak yang sesekali melintas dekat kamera
};

const LAPIS = [
  { n: 0.5, uk: [8, 12], alpha: 0.5, v: [14, 24], blur: 0.8, k: 0.6 },
  { n: 0.4, uk: [14, 20], alpha: 0.8, v: [24, 38], blur: 0, k: 1 },
  { n: 0.1, uk: [26, 36], alpha: 0.9, v: [44, 64], blur: 1.6, k: 1.5 },
] as const;

const DEKAT = 120; // ukuran dasar sprite kelopak lintas

const SINAR = [
  { a: 2.2, w: 0.07, al: 0.9, ph: 0.0 },
  { a: 2.42, w: 0.05, al: 0.7, ph: 1.7 },
  { a: 2.62, w: 0.09, al: 1.0, ph: 3.1 },
  { a: 2.85, w: 0.04, al: 0.6, ph: 4.4 },
  { a: 3.02, w: 0.06, al: 0.8, ph: 5.2 },
] as const;

const BINTIK = [
  { x: 0.82, y: 0.14, r: 90, ph: 0.4, sp: 1 },
  { x: 0.66, y: 0.28, r: 60, ph: 1.9, sp: 1.3 },
  { x: 0.9, y: 0.42, r: 70, ph: 3.2, sp: 0.8 },
  { x: 0.52, y: 0.12, r: 50, ph: 4.1, sp: 1.1 },
  { x: 0.74, y: 0.56, r: 110, ph: 5.0, sp: 0.7 },
  { x: 0.38, y: 0.34, r: 44, ph: 2.6, sp: 1.5 },
] as const;

const LENTERA = [
  { x: 0.07, y: 0.8, r: 0.3, ph: 0.2 },
  { x: 0.96, y: 0.52, r: 0.22, ph: 2.4 },
  { x: 0.62, y: 1.04, r: 0.34, ph: 4.6 },
] as const;

type Kel = {
  x: number; y: number; vx: number; vy: number; vy0: number;
  rot: number; vr: number; f: number; vf: number; g: number; vg: number;
  ay: number; af: number; ph: number;
  l: number; v: number; uk: number; alpha: number; k: number;
  fd: number; // 0..1, muncul perlahan supaya tidak "pop"
  mati?: boolean;
};

type Lin = {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; f: number; vf: number; g: number; vg: number;
  ph: number; uk: number; umur: number; dur: number; v: number;
};

type Rnt = { cv: HTMLCanvasElement; w: number; h: number };

export default function LatarHanami() {
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
    let raf = 0;
    let t = 0;
    let terakhir = performance.now();
    let angin = 0;
    let sy = window.scrollY; // posisi scroll yang dihaluskan
    let sy0 = window.scrollY;
    let jumlah = 0;
    let batas = 0; // indeks kelopak pertama di lapis dekat
    let jedaLintas = 3.5;
    let C: Palet = bacaPalet(false);
    let sprite: Spr[][] = [];
    let spriteDekat: Spr[] = [];
    let bintik: HTMLCanvasElement | null = null;
    let rantB: Rnt | null = null;
    let rantK: Rnt | null = null;
    let kelopak: Kel[] = [];
    let percik: Kel[] = [];
    let lintas: Lin[] = [];
    const tiup = { x: 0, y: 0 };
    const mouse = { x: -9999, y: -9999 };
    const par = { x: 0 };

    const reset = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
    };

    function baca() {
      gelap = document.documentElement.dataset.tema === "gelap";
      C = bacaPalet(gelap);
    }

    function bangunBintik() {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 128;
      const c = cv.getContext("2d")!;
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, rgba(C.sinar, 1));
      g.addColorStop(0.45, rgba(C.sinar, 0.5));
      g.addColorStop(1, rgba(C.sinar, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
      bintik = cv;
    }

    function bangunSprite() {
      sprite = LAPIS.map((l) => [
        buatSpriteKelopak(l.uk[1], l.blur, 0, C, dpr),
        buatSpriteKelopak(l.uk[1], l.blur, 1, C, dpr),
      ]);
      spriteDekat = [
        buatSpriteKelopak(DEKAT, 7, 0, C, dpr),
        buatSpriteKelopak(DEKAT, 7, 1, C, dpr),
      ];
      bangunBintik();
    }

    function bangunRanting() {
      rantB = rantK = null;
      if (!OPSI.ranting) return;
      const hp = W < 640;
      const bw = hp ? Math.min(W * 0.78, 320) : Math.min(W * 0.42, 540);
      rantB = { cv: buatRanting(bw, bw * 0.78, dpr, C, 7), w: bw, h: bw * 0.78 };
      if (hp || !OPSI.rantingKiri) return;
      const kw = bw * 0.6;
      rantK = { cv: buatRanting(kw, kw * 0.78, dpr, C, 23), w: kw, h: kw * 0.78 };
    }

    const hitungTotal = () => Math.max(26, Math.min(80, Math.round((W * H) / 26000)));

    function taburan(total: number) {
      kelopak = [];
      LAPIS.forEach((l, i) => {
        const n = Math.round(total * l.n);
        for (let j = 0; j < n; j++) {
          const vy0 = acak(l.v[0], l.v[1]);
          kelopak.push({
            x: Math.random() * W, y: Math.random() * H, vx: 0, vy: vy0, vy0,
            rot: Math.random() * 6.28, vr: acak(-1.4, 1.4) * l.k,
            f: Math.random() * 6.28, vf: acak(1.2, 2.8),
            g: Math.random() * 6.28, vg: acak(0.8, 2),
            ay: acak(8, 24), af: acak(0.5, 1.3), ph: Math.random() * 6.28,
            l: i, v: Math.random() < 0.5 ? 0 : 1, uk: acak(l.uk[0], l.uk[1]),
            alpha: l.alpha, k: l.k, fd: 1,
          });
        }
      });
      const b = kelopak.findIndex((p) => p.l === 2);
      batas = b < 0 ? kelopak.length : b;
    }

    /* ---------- fisika ---------- */

    function gerak(p: Kel, dt: number, kx: number, ky: number) {
      if (kx || ky) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < 140) {
          const f = 1 - d / 140;
          p.vx += kx * f * p.k * 3;
          p.vy += ky * f * p.k * 2;
        }
      }
      p.vx += (angin * (0.6 + p.k * 0.4) - p.vx) * dt * 1.2;
      p.vy += (p.vy0 - p.vy) * dt * 1.5;
      p.x += (p.vx + Math.sin(t * p.af + p.ph) * p.ay) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.f += p.vf * dt;
      p.g += p.vg * dt;
      p.fd = Math.min(1, p.fd + dt * 0.8);
    }

    function lahir(p: Kel) {
      p.fd = 0;
      // sebagian kelopak yang jatuh muncul lagi dari ranting
      if (rantB && p.l >= 1 && Math.random() < 0.3) {
        p.x = W - acak(40, rantB.w * 0.85);
        p.y = acak(0, rantB.h * 0.55);
      } else {
        p.y = -60;
        p.x = Math.random() * (W + 120) - 60;
      }
    }

    function daur(p: Kel) {
      if (p.y > H + 60) lahir(p);
      else if (p.y < -90) {
        // terdorong ke atas oleh scroll
        p.y = H + 60;
        p.x = Math.random() * (W + 120) - 60;
        p.fd = 0;
      }
      if (p.x > W + 80) {
        p.x = -60;
        p.fd = 0;
      } else if (p.x < -80) {
        p.x = W + 60;
        p.fd = 0;
      }
    }

    function lahirLintas() {
      const arah = Math.random() < 0.75 ? 1 : -1;
      const uk = acak(70, 120);
      const vx = acak(300, 460) * arah;
      lintas.push({
        x: arah > 0 ? -uk : W + uk, y: acak(-0.05, 0.6) * H, vx, vy: acak(60, 160),
        rot: acak(0, 6.28), vr: acak(-2.2, 2.2),
        f: acak(0, 6.28), vf: acak(2.4, 4.4), g: acak(0, 6.28), vg: acak(1.4, 3),
        ph: acak(0, 6.28), uk, umur: 0, dur: (W + uk * 2) / Math.abs(vx),
        v: Math.random() < 0.5 ? 0 : 1,
      });
    }

    /* ---------- gambar ---------- */

    function latar() {
      reset();
      const m = Math.max(W, H);
      if (!gelap) {
        const cx = W * (0.88 + Math.sin(t * 0.05) * 0.03);
        const napas = 0.8 + 0.2 * Math.sin(t * 0.09 + 1);
        const fajar = ctx.createRadialGradient(cx, -H * 0.05, 0, cx, -H * 0.05, m * 0.8);
        fajar.addColorStop(0, rgba(C.sakura, 0.16 * napas));
        fajar.addColorStop(1, rgba(C.sakura, 0));
        ctx.fillStyle = fajar;
        ctx.fillRect(0, 0, W, H);
      } else {
        const senja = ctx.createLinearGradient(0, 0, 0, H);
        senja.addColorStop(0, rgba(C.plum, 0.34));
        senja.addColorStop(0.6, rgba(C.plum, 0.1));
        senja.addColorStop(1, rgba(C.sakura, 0.1));
        ctx.fillStyle = senja;
        ctx.fillRect(0, 0, W, H);
        const kaki = ctx.createRadialGradient(W * 0.3, H * 1.1, 0, W * 0.3, H * 1.1, m * 0.7);
        kaki.addColorStop(0, rgba(C.tua, 0.12));
        kaki.addColorStop(1, rgba(C.tua, 0));
        ctx.fillStyle = kaki;
        ctx.fillRect(0, 0, W, H);
      }
      const hijau = ctx.createRadialGradient(W * 0.05, H * 1.05, 0, W * 0.05, H * 1.05, m * 0.6);
      hijau.addColorStop(0, rgba(C.wakaba, gelap ? 0.05 : 0.09));
      hijau.addColorStop(1, rgba(C.wakaba, 0));
      ctx.fillStyle = hijau;
      ctx.fillRect(0, 0, W, H);
    }

    /* Berkas sinar pagi + bintik cahaya yang bergeser pelan (komorebi). */
    function sinar() {
      reset();
      const ox = W * 0.92;
      const oy = -H * 0.1;
      const D = Math.hypot(W, H) * 1.15;
      const n = W < 640 ? 3 : SINAR.length;
      for (let i = 0; i < n; i++) {
        const r = SINAR[i];
        const br = (0.55 + 0.45 * Math.sin(t * 0.17 + r.ph)) * (0.8 + 0.2 * Math.sin(t * 0.41 + r.ph * 2));
        const a1 = r.a - r.w / 2;
        const a2 = r.a + r.w / 2;
        const g = ctx.createLinearGradient(
          ox, oy, ox + Math.cos(r.a) * D * 0.85, oy + Math.sin(r.a) * D * 0.85,
        );
        g.addColorStop(0, rgba(C.sinar, 0.2 * r.al * br));
        g.addColorStop(0.5, rgba(C.sinar, 0.07 * r.al * br));
        g.addColorStop(1, rgba(C.sinar, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + Math.cos(a1) * D, oy + Math.sin(a1) * D);
        ctx.lineTo(ox + Math.cos(a2) * D, oy + Math.sin(a2) * D);
        ctx.closePath();
        ctx.fill();
      }
      if (!bintik) return;
      const sk = Math.max(0.6, Math.min(1.3, W / 1280));
      for (const b of BINTIK) {
        const x = b.x * W + Math.sin(t * 0.07 * b.sp + b.ph) * 40;
        const y = b.y * H + Math.cos(t * 0.05 * b.sp + b.ph) * 30;
        const r = b.r * sk * (0.9 + 0.1 * Math.sin(t * 0.3 * b.sp + b.ph));
        ctx.globalAlpha = 0.16 * (0.5 + 0.5 * Math.sin(t * 0.23 * b.sp + b.ph * 1.7));
        ctx.drawImage(bintik, x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }

    /* Cahaya lentera senja: samar, berkedip pelan. */
    function lentera() {
      reset();
      const m = Math.max(W, H);
      for (const l of LENTERA) {
        const kedip = 0.86 + 0.14 * Math.sin(t * 2.3 + l.ph) * Math.sin(t * 0.9 + l.ph * 1.7);
        const cx = l.x * W;
        const cy = l.y * H;
        const R = l.r * m;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, rgba(C.lentera, 0.2 * kedip));
        g.addColorStop(0.2, rgba(C.lentera, 0.1 * kedip));
        g.addColorStop(1, rgba(C.lentera, 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        if (l.y < 1) {
          const inti = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18);
          inti.addColorStop(0, rgba(C.lentera, 0.55 * kedip));
          inti.addColorStop(1, rgba(C.lentera, 0));
          ctx.fillStyle = inti;
          ctx.fillRect(cx - 18, cy - 18, 36, 36);
        }
      }
    }

    function pasang(r: Rnt, kiri: boolean, alpha: number, fase: number, naik: number) {
      const goyang = Math.sin(t * 0.45 + fase) * 0.01 + Math.sin(t * 0.93 + fase * 2) * 0.004 - angin * 0.0003;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(kiri ? par.x : W + par.x, naik);
      ctx.rotate(goyang);
      if (kiri) ctx.scale(-1, 1);
      ctx.drawImage(r.cv, -r.w, 0, r.w, r.h);
      ctx.restore();
    }

    function ranting() {
      reset();
      const naik = -Math.min(sy * 0.1, 90);
      if (rantB) pasang(rantB, false, gelap ? 0.78 : 0.9, 0, naik);
      if (rantK) pasang(rantK, true, gelap ? 0.6 : 0.72, 1.7, naik);
    }

    function lukisKelopak(arr: Kel[], dari: number, sampai: number) {
      for (let i = dari; i < sampai; i++) {
        const p = arr[i];
        const s = sprite[p.l][p.v];
        const sx = 0.35 + 0.65 * Math.abs(Math.cos(p.f));
        const sv = 0.7 + 0.3 * Math.abs(Math.cos(p.g));
        const cos = Math.cos(p.rot);
        const sin = Math.sin(p.rot);
        const dw = (s.w * p.uk) / LAPIS[p.l].uk[1];
        ctx.globalAlpha = p.alpha * p.fd * (gelap ? 0.9 : 1);
        ctx.setTransform(cos * sx * dpr, sin * sx * dpr, -sin * sv * dpr, cos * sv * dpr, p.x * dpr, p.y * dpr);
        ctx.drawImage(s.cv, -dw / 2, -dw / 2, dw, dw);
      }
    }

    /* Kelopak yang melintas dekat kamera: besar, buram, berputar 3D (lebar
       dan tinggi menyempit bergantian), memudar masuk dan keluar. */
    function lukisLintas() {
      for (const l of lintas) {
        const u = l.umur / l.dur;
        const env = Math.max(0, Math.min(1, u * 5, (1 - u) * 5));
        const sx = 0.18 + 0.82 * Math.abs(Math.cos(l.f));
        const sv = 0.55 + 0.45 * Math.abs(Math.cos(l.g));
        const cos = Math.cos(l.rot);
        const sin = Math.sin(l.rot);
        const s = spriteDekat[l.v];
        const dw = (s.w * l.uk) / DEKAT;
        ctx.globalAlpha = 0.62 * env * (0.6 + 0.4 * sx) * (gelap ? 0.9 : 1);
        ctx.setTransform(cos * sx * dpr, sin * sx * dpr, -sin * sv * dpr, cos * sv * dpr, l.x * dpr, l.y * dpr);
        ctx.drawImage(s.cv, -dw / 2, -dw / 2, dw, dw);
      }
    }

    function gambar() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      latar();
      if (OPSI.cahaya) {
        if (gelap) lentera();
        else sinar();
      }
      lukisKelopak(kelopak, 0, batas);
      ranting();
      lukisKelopak(kelopak, batas, kelopak.length);
      lukisKelopak(percik, 0, percik.length);
      lukisLintas();
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* ---------- loop ---------- */

    function putar(now: number) {
      if (!hidup) return;
      const dt = Math.min((now - terakhir) / 1000, 0.05);
      terakhir = now;
      t += dt;
      angin = Math.sin(t * 0.13) * 16 + Math.sin(t * 0.047 + 1.3) * 10 + 8;

      const sk = window.scrollY;
      const ds = Math.max(-120, Math.min(120, sk - sy0));
      sy0 = sk;
      sy += (sk - sy) * Math.min(1, dt * 5);
      const target = mouse.x > -1000 ? (0.5 - mouse.x / W) * 12 : 0;
      par.x += (target - par.x) * Math.min(1, dt * 2);

      const kx = tiup.x;
      const ky = tiup.y;
      tiup.x = tiup.y = 0;
      for (const p of kelopak) {
        gerak(p, dt, kx, ky);
        if (ds) p.y -= ds * 0.12 * p.k; // lapis dekat bergeser lebih jauh
        daur(p);
      }
      for (const p of percik) {
        gerak(p, dt, kx, ky);
        if (p.y > H + 60 || p.x < -120 || p.x > W + 120) p.mati = true;
      }
      if (percik.some((p) => p.mati)) percik = percik.filter((p) => !p.mati);

      if (OPSI.lintas) {
        jedaLintas -= dt;
        if (jedaLintas <= 0 && lintas.length < 2) {
          lahirLintas();
          jedaLintas = acak(10, 20);
        }
        for (const l of lintas) {
          l.umur += dt;
          l.x += l.vx * dt;
          l.y += (l.vy + Math.sin(t * 1.6 + l.ph) * 45) * dt;
          l.rot += l.vr * dt;
          l.f += l.vf * dt;
          l.g += l.vg * dt;
        }
        if (lintas.some((l) => l.umur >= l.dur)) lintas = lintas.filter((l) => l.umur < l.dur);
      }

      gambar();
      raf = requestAnimationFrame(putar);
    }

    /* ---------- event ---------- */

    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      tiup.x += e.movementX;
      tiup.y += e.movementY;
    }

    function onHujan(e: Event) {
      const d = ((e as CustomEvent).detail ?? {}) as { x?: number; y?: number; jumlah?: number };
      const x = d.x ?? W / 2;
      const y = d.y ?? H * 0.4;
      const n = Math.min(d.jumlah ?? 28, 60);
      for (let i = 0; i < n && percik.length < 140; i++) {
        const li = Math.random() < 0.6 ? 1 : 2;
        const L = LAPIS[li];
        const th = acak(0, Math.PI * 2);
        const sp = acak(120, 420);
        const vy0 = acak(L.v[0], L.v[1]);
        percik.push({
          x: x + Math.cos(th) * acak(0, 24), y: y + Math.sin(th) * acak(0, 24),
          vx: Math.cos(th) * sp, vy: Math.sin(th) * sp - 120, vy0,
          rot: acak(0, 6.28), vr: acak(-3, 3) * L.k,
          f: acak(0, 6.28), vf: acak(2, 5), g: acak(0, 6.28), vg: acak(1.5, 3),
          ay: acak(8, 24), af: acak(0.5, 1.3), ph: acak(0, 6.28),
          l: li, v: Math.random() < 0.5 ? 0 : 1, uk: acak(L.uk[0], L.uk[1]),
          alpha: L.alpha, k: L.k, fd: 1,
        });
      }
    }

    function ukur() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.ceil(W * dpr);
      canvas.height = Math.ceil(H * dpr);
      const total = hitungTotal();
      // jangan tabur ulang tiap resize kecil (mis. address bar mobile naik-turun)
      if (!kelopak.length || Math.abs(total - jumlah) / jumlah > 0.15) {
        jumlah = total;
        taburan(total);
      }
      bangunRanting();
      gambar();
    }

    function onTema() {
      baca();
      bangunSprite();
      bangunRanting();
      gambar();
    }

    baca();
    bangunSprite();
    window.addEventListener("resize", ukur);
    window.addEventListener("tema:ubah", onTema);
    ukur();
    if (!diam) {
      window.addEventListener("pointermove", onMove);
      window.addEventListener("hanami:hujan", onHujan);
      raf = requestAnimationFrame(putar);
    }

    return () => {
      hidup = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", ukur);
      window.removeEventListener("tema:ubah", onTema);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("hanami:hujan", onHujan);
      canvas.remove();
    };
  }, []);

  return null;
}
