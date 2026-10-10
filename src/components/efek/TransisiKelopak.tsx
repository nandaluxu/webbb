"use client";

/* Transisi halaman Hanami: tiap kali rute berganti, selarik angin membawa
   kelopak menyapu layar dari kiri ke kanan. Selubung tipis ikut lewat
   sehingga pergantian konten tertutup halus, lalu konten baru masuk
   mengikuti arah angin (lihat hanami.css). Pasang sekali, di samping
   LatarHanami. Gerak dikurangi = tidak ada transisi. */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { gerakDikurangi, rgba } from "@/components/efek/warna";
import { acak, bacaPalet, buatSpriteKelopak } from "@/components/efek/sakura";

const DURASI = 1.5; // detik
const KECIL = 26;
const BESAR = 44;

type Kel = {
  off: number; y: number; ph: number;
  rot: number; vr: number; f: number; vf: number; g: number;
  uk: number; besar: boolean; v: number;
};

export default function TransisiKelopak() {
  const path = usePathname();
  const sebelum = useRef<string | null>(null);

  useEffect(() => {
    // lewati render pertama (dan putaran ganda React Strict Mode)
    if (sebelum.current === null) {
      sebelum.current = path;
      return;
    }
    if (sebelum.current === path) return;
    sebelum.current = path;
    if (gerakDikurangi()) return;

    const root = document.documentElement;
    const gelap = root.dataset.tema === "gelap";
    const C = bacaPalet(gelap);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:90";
    canvas.width = Math.ceil(W * dpr);
    canvas.height = Math.ceil(H * dpr);
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    root.dataset.transisi = "masuk";

    const spr = [
      [buatSpriteKelopak(KECIL, 0, 0, C, dpr), buatSpriteKelopak(KECIL, 0, 1, C, dpr)],
      [buatSpriteKelopak(BESAR, 1.4, 0, C, dpr), buatSpriteKelopak(BESAR, 1.4, 1, C, dpr)],
    ];
    const n = Math.max(36, Math.min(80, Math.round(W / 18)));
    const kelopak: Kel[] = Array.from({ length: n }, () => {
      const besar = Math.random() < 0.3;
      return {
        // lebih banyak kelopak dekat ujung depan angin, sisanya menyusul di belakang
        off: W * (0.1 * Math.random() - 0.55 * Math.pow(Math.random(), 1.6)),
        y: acak(-0.05, 0.95) * H,
        ph: acak(0, 6.28),
        rot: acak(0, 6.28), vr: acak(-5, 5),
        f: acak(0, 6.28), vf: acak(6, 12), g: acak(0, 6.28),
        uk: besar ? acak(30, BESAR) : acak(16, KECIL),
        besar, v: Math.random() < 0.5 ? 0 : 1,
      };
    });

    const selubung = gelap ? C.plum : C.pucat;
    const mulai = performance.now();
    let raf = 0;

    function frame(now: number) {
      const u = Math.min(1, (now - mulai) / 1000 / DURASI);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
      const depan = -0.3 * W + e * 2.0 * W;
      const kuat = Math.sin(Math.PI * u);
      const fin = u > 0.8 ? (1 - u) / 0.2 : 1;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const g = ctx.createLinearGradient(depan - 0.6 * W, 0, depan + 0.2 * W, 0);
      g.addColorStop(0, rgba(selubung, 0));
      g.addColorStop(0.7, rgba(selubung, 0.5 * kuat));
      g.addColorStop(1, rgba(selubung, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      for (const p of kelopak) {
        const x = depan + p.off;
        if (x < -80 || x > W + 80) continue;
        const y = p.y + Math.sin(u * 7 + p.ph) * 34 + u * 70;
        const rot = p.rot + p.vr * u;
        const f = p.f + p.vf * u;
        const sx = 0.3 + 0.7 * Math.abs(Math.cos(f));
        const sv = 0.7 + 0.3 * Math.abs(Math.cos(p.g + u * 5));
        const tepi = Math.max(0, Math.min(1, (x + 60) / 140, (W + 60 - x) / 140));
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const s = spr[p.besar ? 1 : 0][p.v];
        const dw = (s.w * p.uk) / (p.besar ? BESAR : KECIL);
        ctx.globalAlpha = 0.9 * tepi * fin;
        ctx.setTransform(cos * sx * dpr, sin * sx * dpr, -sin * sv * dpr, cos * sv * dpr, x * dpr, y * dpr);
        ctx.drawImage(s.cv, -dw / 2, -dw / 2, dw, dw);
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      if (u < 1) raf = requestAnimationFrame(frame);
      else {
        canvas.remove();
        delete root.dataset.transisi;
      }
    }
    raf = requestAnimationFrame(frame);
    const timer = window.setTimeout(() => {
      delete root.dataset.transisi;
    }, 1100);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      canvas.remove();
      delete root.dataset.transisi;
    };
  }, [path]);

  return null;
}
