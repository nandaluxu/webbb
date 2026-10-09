"use client";

/* Latar Japandi: kabut tipis (lumut, oak, linen) yang hanyut sangat
   pelan, serat kertas washi, dan beberapa debu cahaya yang naik
   pelan. Kabut bergeser tipis berlawanan arah kursor. Digambar di
   setengah resolusi lalu diregangkan CSS — memang dibikin lembut.
   Gerak dikurangi = digambar sekali, diam. */

import { useEffect } from "react";
import { bacaWarna, rgba, gerakDikurangi } from "@/components/efek/warna";

type Nama = "lumut" | "kayu" | "kilau";

const KABUT: { c: Nama; x: number; y: number; ax: number; ay: number; fx: number; fy: number; p: number; r: number; a: number }[] = [
  { c: "lumut", x: 0.2, y: 0.25, ax: 0.1, ay: 0.08, fx: 0.7, fy: 0.9, p: 0, r: 0.55, a: 0.16 },
  { c: "kayu", x: 0.82, y: 0.2, ax: 0.08, ay: 0.1, fx: 0.5, fy: 0.6, p: 2, r: 0.5, a: 0.13 },
  { c: "kilau", x: 0.6, y: 0.85, ax: 0.12, ay: 0.06, fx: 0.4, fy: 0.8, p: 4, r: 0.6, a: 0.5 },
  { c: "lumut", x: 0.1, y: 0.9, ax: 0.06, ay: 0.08, fx: 0.9, fy: 0.5, p: 1, r: 0.4, a: 0.1 },
];

export default function LatarJapandi() {
  useEffect(() => {
    const S = 0.5;
    const canvas = document.createElement("canvas");
    canvas.id = "bg-canvas";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    const serat = document.createElement("canvas");
    const sctx = serat.getContext("2d")!;

    const diam = gerakDikurangi();
    let w = 0;
    let h = 0;
    let warna: Record<Nama, number[]> & { ink: number[] };
    let gelap = false;
    let hidup = true;
    let t = 0;
    let terakhir = performance.now();
    const par = { x: 0, y: 0 };
    const tujuan = { x: 0, y: 0 };
    const debu = Array.from({ length: 22 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.7 + Math.random() * 1.1,
      v: 0.000015 + Math.random() * 0.00003,
      s: Math.random() * 6.28,
      a: 0.15 + Math.random() * 0.25,
    }));

    function baca() {
      warna = {
        lumut: bacaWarna("--lumut", "#6F7F66"),
        kayu: bacaWarna("--kayu", "#A98B63"),
        kilau: bacaWarna("--kilau", "#E1DBCE"),
        ink: bacaWarna("--ink", "#2E2C28"),
      };
      gelap = document.documentElement.dataset.tema === "gelap";
    }

    function buatSerat() {
      serat.width = w;
      serat.height = h;
      const img = sctx.createImageData(w, h);
      const d = img.data;
      const c = warna.ink;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.random() < 0.4) {
          d[i] = c[0];
          d[i + 1] = c[1];
          d[i + 2] = c[2];
          d[i + 3] = Math.random() * (gelap ? 9 : 11);
        }
      }
      sctx.putImageData(img, 0, 0);
      sctx.lineWidth = 1;
      const n = Math.round((w * h) / 900);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const a = Math.random() * Math.PI;
        const l = 4 + Math.random() * 10;
        sctx.strokeStyle = rgba(c, 0.035 + Math.random() * 0.04);
        sctx.beginPath();
        sctx.moveTo(x, y);
        sctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        sctx.stroke();
      }
    }

    function gambar() {
      ctx.clearRect(0, 0, w, h);
      const m = Math.max(w, h);
      const redam = gelap ? 0.7 : 1;
      for (const b of KABUT) {
        const cx = (b.x + b.ax * Math.sin(t * b.fx + b.p)) * w + par.x;
        const cy = (b.y + b.ay * Math.cos(t * b.fy + b.p)) * h + par.y;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.r * m);
        g.addColorStop(0, rgba(warna[b.c], b.a * redam));
        g.addColorStop(1, rgba(warna[b.c], 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(serat, 0, 0);
      const dc = gelap ? warna.ink : warna.kayu;
      for (const p of debu) {
        const x = (p.x + Math.sin(t * 2.5 + p.s) * 0.01) * w;
        const y = p.y * h;
        ctx.fillStyle = rgba(dc, p.a * (gelap ? 0.6 : 1));
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function putar(now: number) {
      if (!hidup) return;
      const dt = Math.min(now - terakhir, 50);
      terakhir = now;
      t += dt * 0.00018;
      par.x += (tujuan.x - par.x) * 0.03;
      par.y += (tujuan.y - par.y) * 0.03;
      for (const p of debu) {
        p.y -= p.v * dt;
        if (p.y < -0.02) p.y = 1.02;
      }
      gambar();
      requestAnimationFrame(putar);
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      tujuan.x = (e.clientX / window.innerWidth - 0.5) * -40;
      tujuan.y = (e.clientY / window.innerHeight - 0.5) * -40;
    }

    function ukur() {
      w = canvas.width = Math.ceil(window.innerWidth * S);
      h = canvas.height = Math.ceil(window.innerHeight * S);
      buatSerat();
      gambar();
    }

    function onTema() {
      baca();
      buatSerat();
      gambar();
    }

    baca();
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
