"use client";

/* Latar butir tinta yang hanyut pelan + noise halus.
   Warna butirny ngekor token --ink, jadi pas tema ganti dia ikut
   lewat event tema:ubah. */

import { useEffect } from "react";

export default function Noise() {
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.id = "bg-canvas";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;

    let w = 0;
    let h = 0;

    function bacaInk() {
      const v = getComputedStyle(document.body).getPropertyValue("--ink").trim();
      return /^\#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : "#0A0A0A";
    }

    function keRgb(hex: string) {
      let s = hex.replace("#", "");
      if (s.length === 3) s = s.split("").map((c) => c + c).join("");
      const n = parseInt(s, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    const keRgba = (rgb: number[], a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

    let RGB = keRgb(bacaInk());

    const DOT_COUNT = 280;
    const DOT_MIN = 1;
    const DOT_MAX = 3;
    const DRIFT_SPEED = 0.18;
    const NOISE_ALPHA = 0.1;
    const NOISE_DENSITY = 0.03;
    const MICRO_COUNT = 200;

    const dots: {
      x: number;
      y: number;
      size: number;
      vx: number;
      vy: number;
      alpha: number;
      phase: number;
      speed: number;
    }[] = [];

    function initDots() {
      dots.length = 0;
      for (let i = 0; i < DOT_COUNT; i++) {
        dots.push({
          x: Math.random() * w,
          y: Math.random() * h,
          size: DOT_MIN + Math.random() * (DOT_MAX - DOT_MIN),
          vx: (Math.random() - 0.5) * DRIFT_SPEED * 2,
          vy: (Math.random() - 0.5) * DRIFT_SPEED * 2,
          alpha: 0.25 + Math.random() * 0.5,
          phase: Math.random() * Math.PI * 2,
          speed: 0.7 + Math.random() * 0.8,
        });
      }
      for (let i = 0; i < MICRO_COUNT; i++) {
        dots.push({
          x: Math.random() * w,
          y: Math.random() * h,
          size: 1,
          vx: (Math.random() - 0.5) * DRIFT_SPEED * 3,
          vy: (Math.random() - 0.5) * DRIFT_SPEED * 3,
          alpha: 0.1 + Math.random() * 0.25,
          phase: Math.random() * Math.PI * 2,
          speed: 1.5 + Math.random() * 1.5,
        });
      }
    }

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      initDots();
    }

    const noiseCanvas = document.createElement("canvas");
    const noiseCtx = noiseCanvas.getContext("2d")!;

    function generateNoise() {
      noiseCanvas.width = w;
      noiseCanvas.height = h;
      const img = noiseCtx.createImageData(w, h);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.random() < NOISE_DENSITY) {
          data[i] = RGB[0];
          data[i + 1] = RGB[1];
          data[i + 2] = RGB[2];
          data[i + 3] = Math.random() * NOISE_ALPHA * 255;
        }
      }
      noiseCtx.putImageData(img, 0, 0);
    }

    let t = 0;
    let hidup = true;
    function animate() {
      if (!hidup) return;
      t += 0.01;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(noiseCanvas, 0, 0);
      for (const dot of dots) {
        dot.x += dot.vx;
        dot.y += dot.vy;
        if (dot.x < -10) dot.x = w + 10;
        if (dot.x > w + 10) dot.x = -10;
        if (dot.y < -10) dot.y = h + 10;
        if (dot.y > h + 10) dot.y = -10;
        const pulse = 0.7 + Math.sin(t * dot.speed + dot.phase) * 0.3;
        const size = Math.max(1, Math.round(dot.size * pulse));
        ctx.fillStyle = keRgba(RGB, dot.alpha * pulse);
        ctx.fillRect(Math.round(dot.x - size / 2), Math.round(dot.y - size / 2), size, size);
      }
      requestAnimationFrame(animate);
    }

    const onTema = () => {
      RGB = keRgb(bacaInk());
      generateNoise();
    };
    const onResize = () => {
      resize();
      generateNoise();
    };

    window.addEventListener("tema:ubah", onTema);
    window.addEventListener("resize", onResize);
    resize();
    generateNoise();
    requestAnimationFrame(animate);

    return () => {
      hidup = false;
      window.removeEventListener("tema:ubah", onTema);
      window.removeEventListener("resize", onResize);
      canvas.remove();
    };
  }, []);

  return null;
}
