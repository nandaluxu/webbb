"use client";

/* Latar Swiss Zen: kisi tanda-plus 48px yang hampir gak kelihatan.
   Tanda di sekitar kursor "bangun" (membesar + menebal) lalu tenang
   lagi pas kursor pergi, kayak lensa di atas kertas grid. Digambar
   ulang cuma saat kursor bergerak — diam = nol kerja. */

import { useEffect } from "react";
import { bacaWarna, rgba, gerakDikurangi } from "@/components/efek/warna";

export default function LatarSwiss() {
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.id = "bg-canvas";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    const dasar = document.createElement("canvas");
    const dctx = dasar.getContext("2d")!;

    const SEL = 48;
    const JARI = 190;
    const k = gerakDikurangi() ? 1 : 0.16;
    const JAUH = -9999;
    let w = 0;
    let h = 0;
    let RGB = bacaWarna("--ink", "#111111");
    const mouse = { x: JAUH, y: JAUH };
    const lensa = { x: JAUH, y: JAUH };
    let jalan = false;
    let hidup = true;

    function tanda(c: CanvasRenderingContext2D, x: number, y: number, arm: number) {
      c.fillRect(x - arm, y, arm * 2 + 1, 1);
      c.fillRect(x, y - arm, 1, arm * 2 + 1);
    }

    function gambarDasar() {
      dasar.width = w;
      dasar.height = h;
      dctx.fillStyle = rgba(RGB, 0.13);
      for (let y = SEL; y < h; y += SEL) for (let x = SEL; x < w; x += SEL) tanda(dctx, x, y, 2);
    }

    function gambar() {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(dasar, 0, 0);
      const gx0 = Math.max(1, Math.floor((lensa.x - JARI) / SEL));
      const gx1 = Math.ceil((lensa.x + JARI) / SEL);
      const gy0 = Math.max(1, Math.floor((lensa.y - JARI) / SEL));
      const gy1 = Math.ceil((lensa.y + JARI) / SEL);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const px = gx * SEL;
          const py = gy * SEL;
          if (px >= w || py >= h) continue;
          const d = Math.hypot(px - lensa.x, py - lensa.y);
          if (d >= JARI) continue;
          const t = 1 - d / JARI;
          ctx.fillStyle = rgba(RGB, 0.13 + 0.6 * t * t);
          tanda(ctx, px, py, 2 + Math.round(4 * t));
        }
      }
    }

    function putar() {
      if (!hidup) return;
      lensa.x += (mouse.x - lensa.x) * k;
      lensa.y += (mouse.y - lensa.y) * k;
      if (Math.abs(mouse.x - lensa.x) < 0.4 && Math.abs(mouse.y - lensa.y) < 0.4) {
        lensa.x = mouse.x;
        lensa.y = mouse.y;
        jalan = false;
        gambar();
        return;
      }
      gambar();
      requestAnimationFrame(putar);
    }

    function bangun() {
      if (jalan) return;
      jalan = true;
      requestAnimationFrame(putar);
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      if (lensa.x === JAUH) {
        lensa.x = e.clientX;
        lensa.y = e.clientY;
      }
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      bangun();
    }

    function onKeluar() {
      mouse.x = mouse.y = lensa.x = lensa.y = JAUH;
      gambar();
    }

    function ukur() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      gambarDasar();
      gambar();
    }

    function onTema() {
      RGB = bacaWarna("--ink", "#111111");
      gambarDasar();
      gambar();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("resize", ukur);
    window.addEventListener("tema:ubah", onTema);
    document.documentElement.addEventListener("mouseleave", onKeluar);
    ukur();

    return () => {
      hidup = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", ukur);
      window.removeEventListener("tema:ubah", onTema);
      document.documentElement.removeEventListener("mouseleave", onKeluar);
      canvas.remove();
    };
  }, []);

  return null;
}
