"use client";

/* Latar Hanami: kelopak sakura berjatuhan. Tiga lapis kedalaman
   (jauh kecil + buram, tengah, dekat besar + buram ala bokeh),
   tiap kelopak berputar dan "berkepak" (lebarnya menyempit-melebar
   seperti jatuh miring), diterpa angin yang arahnya pelan berubah.
   Gerakan kursor ikut meniup kelopak di sekitarnya. Di belakang ada
   semburat fajar merah muda tipis. Gerak dikurangi = digambar sekali. */

import { useEffect } from "react";
import { bacaWarna, rgba, gerakDikurangi } from "@/components/efek/warna";

const LAPIS = [
  { n: 0.5, uk: [8, 12], alpha: 0.5, v: [14, 24], blur: 0.8, k: 0.6 },
  { n: 0.4, uk: [14, 20], alpha: 0.8, v: [24, 38], blur: 0, k: 1 },
  { n: 0.1, uk: [26, 36], alpha: 0.9, v: [44, 64], blur: 1.6, k: 1.5 },
] as const;

type Spr = { cv: HTMLCanvasElement; w: number };
type Kel = {
  x: number; y: number; vx: number; vy: number; vy0: number;
  rot: number; vr: number; f: number; vf: number; ay: number; af: number; ph: number;
  l: number; v: number; uk: number; alpha: number; k: number;
};

const acak = (a: number, b: number) => a + Math.random() * (b - a);

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
    let t = 0;
    let terakhir = performance.now();
    let sprite: Spr[][] = [];
    let kelopak: Kel[] = [];
    let C = { tua: [0, 0, 0], sakura: [0, 0, 0], pucat: [0, 0, 0], wakaba: [0, 0, 0] };
    const tiup = { x: 0, y: 0 };
    const mouse = { x: -9999, y: -9999 };

    function baca() {
      C = {
        tua: bacaWarna("--sakura-tua", "#D6849F"),
        sakura: bacaWarna("--sakura", "#EBA9BC"),
        pucat: bacaWarna("--sakura-pucat", "#FBDCE5"),
        wakaba: bacaWarna("--wakaba", "#789A66"),
      };
      gelap = document.documentElement.dataset.tema === "gelap";
    }

    function jalur(c: CanvasRenderingContext2D, L: number, Wd: number) {
      c.beginPath();
      c.moveTo(0, L * 0.5);
      c.bezierCurveTo(-Wd * 0.55, L * 0.22, -Wd * 0.62, -L * 0.34, -Wd * 0.17, -L * 0.5);
      c.quadraticCurveTo(0, -L * 0.36, Wd * 0.17, -L * 0.5);
      c.bezierCurveTo(Wd * 0.62, -L * 0.34, Wd * 0.55, L * 0.22, 0, L * 0.5);
      c.closePath();
    }

    function buatSprite(maks: number, blur: number, varian: number): Spr {
      const pad = Math.ceil(maks * 0.2 + blur * 3);
      const sisi = maks + pad * 2;
      const cv = document.createElement("canvas");
      cv.width = cv.height = Math.ceil(sisi * dpr);
      const c = cv.getContext("2d")!;
      c.scale(dpr, dpr);
      c.translate(sisi / 2, sisi / 2);
      if (blur > 0) c.filter = `blur(${blur}px)`;
      const g = c.createLinearGradient(0, maks * 0.5, 0, -maks * 0.5);
      const [a, b, d] = varian === 0 ? [C.tua, C.sakura, C.pucat] : [C.sakura, C.pucat, C.pucat];
      g.addColorStop(0, rgba(a, 1));
      g.addColorStop(0.65, rgba(b, 1));
      g.addColorStop(1, rgba(d, 1));
      c.fillStyle = g;
      jalur(c, maks, maks * 0.72);
      c.fill();
      if (blur === 0) {
        c.strokeStyle = rgba(C.tua, 0.25);
        c.lineWidth = 0.6;
        c.beginPath();
        c.moveTo(0, maks * 0.44);
        c.lineTo(0, -maks * 0.18);
        c.stroke();
      }
      return { cv, w: sisi };
    }

    function bangunSprite() {
      sprite = LAPIS.map((l) => [buatSprite(l.uk[1], l.blur, 0), buatSprite(l.uk[1], l.blur, 1)]);
    }

    function taburan() {
      const total = Math.max(26, Math.min(80, Math.round((W * H) / 26000)));
      kelopak = [];
      LAPIS.forEach((l, i) => {
        const n = Math.round(total * l.n);
        for (let j = 0; j < n; j++) {
          const vy0 = acak(l.v[0], l.v[1]);
          kelopak.push({
            x: Math.random() * W, y: Math.random() * H, vx: 0, vy: vy0, vy0,
            rot: Math.random() * 6.28, vr: acak(-1.4, 1.4) * l.k, f: Math.random() * 6.28, vf: acak(1.2, 2.8),
            ay: acak(8, 24), af: acak(0.5, 1.3), ph: Math.random() * 6.28,
            l: i, v: Math.random() < 0.5 ? 0 : 1, uk: acak(l.uk[0], l.uk[1]), alpha: l.alpha, k: l.k,
          });
        }
      });
    }

    function gambar() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const m = Math.max(W, H);
      const fajar = ctx.createRadialGradient(W * 0.88, -H * 0.05, 0, W * 0.88, -H * 0.05, m * 0.8);
      fajar.addColorStop(0, rgba(C.sakura, gelap ? 0.1 : 0.16));
      fajar.addColorStop(1, rgba(C.sakura, 0));
      ctx.fillStyle = fajar;
      ctx.fillRect(0, 0, W, H);
      const hijau = ctx.createRadialGradient(W * 0.05, H * 1.05, 0, W * 0.05, H * 1.05, m * 0.6);
      hijau.addColorStop(0, rgba(C.wakaba, gelap ? 0.07 : 0.09));
      hijau.addColorStop(1, rgba(C.wakaba, 0));
      ctx.fillStyle = hijau;
      ctx.fillRect(0, 0, W, H);

      for (const p of kelopak) {
        const s = sprite[p.l][p.v];
        const sx = 0.35 + 0.65 * Math.abs(Math.cos(p.f));
        const cos = Math.cos(p.rot);
        const sin = Math.sin(p.rot);
        const dw = (s.w * p.uk) / LAPIS[p.l].uk[1];
        ctx.globalAlpha = p.alpha * (gelap ? 0.9 : 1);
        ctx.setTransform(cos * sx * dpr, sin * sx * dpr, -sin * dpr, cos * dpr, p.x * dpr, p.y * dpr);
        ctx.drawImage(s.cv, -dw / 2, -dw / 2, dw, dw);
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function putar(now: number) {
      if (!hidup) return;
      const dt = Math.min((now - terakhir) / 1000, 0.05);
      terakhir = now;
      t += dt;
      const angin = Math.sin(t * 0.13) * 16 + Math.sin(t * 0.047 + 1.3) * 10 + 8;
      const kx = tiup.x;
      const ky = tiup.y;
      tiup.x = tiup.y = 0;
      for (const p of kelopak) {
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
        if (p.y > H + 60) {
          p.y = -60;
          p.x = Math.random() * (W + 120) - 60;
        }
        if (p.x > W + 80) p.x = -60;
        else if (p.x < -80) p.x = W + 60;
      }
      gambar();
      requestAnimationFrame(putar);
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      tiup.x += e.movementX;
      tiup.y += e.movementY;
    }

    function ukur() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.ceil(W * dpr);
      canvas.height = Math.ceil(H * dpr);
      taburan();
      gambar();
    }

    function onTema() {
      baca();
      bangunSprite();
      gambar();
    }

    baca();
    bangunSprite();
    window.addEventListener("resize", ukur);
    window.addEventListener("tema:ubah", onTema);
    ukur();
    if (!diam) {
      window.addEventListener("pointermove", onMove);
      requestAnimationFrame(putar);
    }

    return () => {
      hidup = false;
      window.removeEventListener("resize", ukur);
      window.removeEventListener("tema:ubah", onTema);
      window.removeEventListener("pointermove", onMove);
      canvas.remove();
    };
  }, []);

  return null;
}
