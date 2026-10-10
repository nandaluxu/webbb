"use client";

/* Kursor Hanami v2.
   - Kelopak melayang pakai fisika pegas (ada overshoot tipis), miring ke
     arah gerak, mengepak 3D — pelan pas diam, cepat pas ngebut.
   - Lagi bergerak cepat, kelopak kecil sesekali lepas dan jatuh
     melayang (canvas, bukan DOM, jadi ringan).
   - Klik/tap = bunga lima kelopak mekar bergantian + semburan kelopak.
     Di layar sentuh, mekar muncul saat jari diangkat (tap), bukan saat
     mulai scroll.
   - Di atas link/tombol, kelopak ditarik pelan ke tengah elemen.
   - Loop animasi berhenti sendiri kalau tidak ada yang bergerak.
   - Hormati prefers-reduced-motion: ikut langsung, tanpa efek. */

import { useEffect } from "react";
import { gerakDikurangi, TEKS, KLIK } from "@/components/efek/warna";

/* ---- setelan yang enak diutak-atik ---- */
const KEKAKUAN = 256; // makin besar makin cepat nyusul pointer
const REDAMAN = 24; // makin kecil makin banyak overshoot
const TARIK = 0.2; // 0 = matikan tarikan magnet di link/tombol
const JARAK_JEJAK = 120; // px gerak cepat per kelopak yang lepas
const KECEPATAN_JEJAK = 180; // px/dtk minimal biar kelopak lepas
const MAKS_PARTIKEL = 70;

const BENTUK = "M0 10C-7 5-8-6-2.6-10Q0-8 2.6-10C8-6 7 5 0 10Z";
const KELOPAK = `<svg viewBox="-10 -12 20 24" aria-hidden="true"><path d="${BENTUK}"/></svg>`;
const MEKAR =
  '<svg viewBox="-24 -24 48 48" aria-hidden="true">' +
  [0, 72, 144, 216, 288]
    .map(
      (d, i) =>
        `<g transform="rotate(${d})"><path class="bk" style="--i:${i}" d="M0 0C-9-5-10-16-3.5-21Q0-18 3.5-21C10-16 9-5 0 0Z"/></g>`,
    )
    .join("") +
  '<circle class="putik" r="2.4"/></svg>';

type Partikel = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  s: number;
  t: number;
  umur: number;
  fase: number;
  warna: string;
};

const acak = (a: number, b: number) => a + Math.random() * (b - a);
const jepit = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export default function KursorHanami() {
  useEffect(() => {
    const halus = window.matchMedia("(pointer: fine)").matches;
    let diam = gerakDikurangi();
    const mqGerak = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onGerak = () => {
      diam = gerakDikurangi();
    };
    mqGerak.addEventListener("change", onGerak);

    let hidup = true;

    /* ---------- elemen kelopak (desktop saja) ---------- */
    let akar: HTMLDivElement | null = null;
    if (halus) {
      akar = document.createElement("div");
      akar.className = "kursor-hanami";
      akar.innerHTML = `<span class="kursor-hanami-kelopak">${KELOPAK}</span>`;
      document.body.appendChild(akar);
    }
    const kel = akar?.firstElementChild as HTMLElement | undefined;

    /* ---------- warna partikel, dibaca dari CSS ---------- */
    let warna = ["#ffd3e1", "#f9b4cb", "#f4a0bd"];
    function bacaWarna() {
      const cs = getComputedStyle(document.documentElement);
      const ambil = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
      warna = [ambil("--hanami-1", warna[0]), ambil("--hanami-2", warna[1]), ambil("--hanami-3", warna[2])];
    }
    bacaWarna();

    /* ---------- canvas partikel (dibuat saat pertama dibutuhkan) ---------- */
    let kanvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let dpr = 1;
    const bentuk = new Path2D(BENTUK);
    const partikel: Partikel[] = [];

    function ukur() {
      if (!kanvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      kanvas.width = Math.round(window.innerWidth * dpr);
      kanvas.height = Math.round(window.innerHeight * dpr);
    }
    function siapKanvas() {
      if (kanvas) return !!ctx;
      kanvas = document.createElement("canvas");
      kanvas.className = "kursor-hanami-kanvas";
      kanvas.setAttribute("aria-hidden", "true");
      // gaya penting ditulis inline: biar canvas nggak pernah nutup klik
      // walau CSS belum termuat
      Object.assign(kanvas.style, {
        position: "fixed",
        inset: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: "9998",
      });
      document.body.appendChild(kanvas);
      ctx = kanvas.getContext("2d");
      ukur();
      window.addEventListener("resize", ukur);
      return !!ctx;
    }

    function lepas(x: number, y: number, vx: number, vy: number, besar = 1) {
      if (!siapKanvas()) return;
      if (partikel.length >= MAKS_PARTIKEL) partikel.shift();
      partikel.push({
        x,
        y,
        vx,
        vy,
        rot: acak(0, 360),
        vr: acak(-220, 220),
        s: acak(0.42, 0.78) * besar,
        t: 0,
        umur: acak(1.4, 2.4),
        fase: acak(0, Math.PI * 2),
        warna: warna[Math.floor(Math.random() * warna.length)],
      });
      mulai();
    }

    function semburan(x: number, y: number) {
      const n = 7;
      const dasar = acak(0, Math.PI * 2);
      for (let i = 0; i < n; i++) {
        const a = dasar + (i / n) * Math.PI * 2 + acak(-0.3, 0.3);
        const v = acak(70, 190);
        lepas(x, y, Math.cos(a) * v, Math.sin(a) * v - 30, 1.05);
      }
    }

    function gambarPartikel(dt: number) {
      if (!ctx || !kanvas) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, kanvas.width, kanvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const drag = Math.exp(-1.6 * dt);
      const jatuh = 1 - Math.exp(-1.2 * dt);
      const putarRedam = Math.exp(-0.4 * dt);

      let tulis = 0;
      for (let i = 0; i < partikel.length; i++) {
        const q = partikel[i];
        q.t += dt;
        const u = q.t / q.umur;
        if (u >= 1) continue; // habis → tidak disalin ulang

        q.vx *= drag;
        q.vy += (55 - q.vy) * jatuh; // melayang turun, bukan jatuh bebas
        q.vr *= putarRedam;
        q.x += (q.vx + Math.sin(q.t * 2.4 + q.fase) * 22) * dt;
        q.y += q.vy * dt;
        q.rot += q.vr * dt;

        const balik = Math.abs(Math.cos(q.fase + q.t * 5));
        const alfa = Math.min(1, u / 0.08, (1 - u) / 0.45);
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate((q.rot * Math.PI) / 180);
        ctx.scale(q.s * (0.35 + 0.65 * balik), q.s);
        ctx.globalAlpha = Math.max(0, alfa) * (0.72 + 0.28 * balik);
        ctx.fillStyle = q.warna;
        ctx.fill(bentuk);
        ctx.restore();

        partikel[tulis++] = q;
      }
      partikel.length = tulis;
    }

    /* ---------- bunga mekar (DOM + animasi CSS) ---------- */
    const bunga = new Set<HTMLElement>();
    function mekar(x: number, y: number) {
      const el = document.createElement("span");
      el.className = "mekar-hanami";
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.innerHTML = MEKAR;
      document.body.appendChild(el);
      bunga.add(el);
      const buang = () => {
        bunga.delete(el);
        el.remove();
      };
      // animationend dari kelopak anak ikut naik (bubbling) — cek targetnya
      el.addEventListener("animationend", (e) => {
        if (e.target === el) buang();
      });
      window.setTimeout(buang, 1600); // jaga-jaga kalau animasi dimatikan CSS
    }

    function ledak(x: number, y: number) {
      if (diam) return;
      bacaWarna(); // klik = momen murah buat ngikutin ganti tema
      mekar(x, y);
      semburan(x, y);
    }

    /* ---------- posisi, pegas, magnet ---------- */
    const mouse = { x: 0, y: 0 };
    const sasaran = { x: 0, y: 0 };
    const p = { x: 0, y: 0 };
    const v = { x: 0, y: 0 };
    let miring = 0;
    let fasaKepak = 0;
    let jarak = 0;
    let ada = false;
    let magnet: Element | null = null;

    function hitungSasaran() {
      sasaran.x = mouse.x;
      sasaran.y = mouse.y;
      if (!magnet || !magnet.isConnected || diam || TARIK <= 0) return;
      const r = magnet.getBoundingClientRect();
      if (r.width > 360 || r.height > 160) return; // kartu besar jangan ditarik
      sasaran.x += (r.left + r.width / 2 - mouse.x) * TARIK;
      sasaran.y += (r.top + r.height / 2 - mouse.y) * TARIK;
    }

    function tetapkan(t: Element | null) {
      if (!akar) return;
      const teks = !!t?.closest(TEKS);
      const klik = !teks && t ? t.closest(KLIK) : null;
      akar.classList.toggle("teks", teks);
      akar.classList.toggle("aktif", !!klik);
      magnet = klik;
      hitungSasaran();
    }

    /* ---------- loop: berhenti sendiri kalau sepi ---------- */
    let raf = 0;
    let tLalu = 0;
    function mulai() {
      if (raf || !hidup) return;
      tLalu = performance.now();
      raf = requestAnimationFrame(putar);
    }

    function putar(now: number) {
      raf = 0;
      if (!hidup) return;
      const dt = Math.min(Math.max((now - tLalu) / 1000, 0.001), 1 / 30);
      tLalu = now;

      if (ada && kel) {
        if (diam) {
          p.x = sasaran.x;
          p.y = sasaran.y;
          v.x = v.y = 0;
        } else {
          v.x += (KEKAKUAN * (sasaran.x - p.x) - REDAMAN * v.x) * dt;
          v.y += (KEKAKUAN * (sasaran.y - p.y) - REDAMAN * v.y) * dt;
          p.x += v.x * dt;
          p.y += v.y * dt;
        }

        const kecepatan = Math.hypot(v.x, v.y);
        const ngebut = Math.min(1, kecepatan / 900);
        miring += (jepit(v.x * 0.04, -45, 45) - miring) * (1 - Math.exp(-dt * 10));
        fasaKepak += dt * (2.2 + 9 * ngebut);

        const ayun = diam ? 0 : Math.sin(now / 900) * 6;
        const fy = diam ? 0 : Math.sin(fasaKepak) * (8 + 36 * ngebut);
        const fx = diam ? 0 : Math.cos(fasaKepak * 0.73 + 1) * (5 + 22 * ngebut);
        kel.style.transform =
          `translate3d(${p.x}px,${p.y}px,0) perspective(260px) ` +
          `rotate(${miring + ayun}deg) rotateX(${fx}deg) rotateY(${fy}deg) translate(-50%,-50%)`;

        // gerak cepat → sesekali satu kelopak lepas (kecuali di atas teks)
        if (!diam && kecepatan > KECEPATAN_JEJAK && !akar?.classList.contains("teks")) {
          jarak += kecepatan * dt;
          if (jarak > JARAK_JEJAK) {
            jarak = 0;
            lepas(
              p.x + acak(-4, 4),
              p.y + acak(-4, 4),
              -v.x * 0.12 + acak(-25, 25),
              -v.y * 0.12 + acak(-10, 30),
            );
          }
        }
      }

      if (partikel.length) gambarPartikel(dt);
      else if (ctx && kanvas) ctx.clearRect(0, 0, kanvas.width, kanvas.height);

      if (ada || partikel.length) raf = requestAnimationFrame(putar);
    }

    /* ---------- event ---------- */
    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch" || !akar) return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      hitungSasaran();
      if (!ada) {
        ada = true;
        p.x = sasaran.x;
        p.y = sasaran.y;
        v.x = v.y = 0;
        akar.classList.add("tampak");
      }
      mulai();
    }
    function onOver(e: PointerEvent) {
      if (e.pointerType === "touch" || !akar) return;
      tetapkan(e.target instanceof Element ? e.target : null);
    }

    // halaman di-scroll tapi pointer diam → elemen di bawahnya berubah
    let cekTertunda = false;
    function jadwalCek() {
      if (!ada || cekTertunda) return;
      cekTertunda = true;
      requestAnimationFrame(() => {
        cekTertunda = false;
        if (hidup && ada) tetapkan(document.elementFromPoint(mouse.x, mouse.y));
      });
    }

    let tap: { x: number; y: number; t: number } | null = null;
    function onDown(e: PointerEvent) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      akar?.classList.add("tekan");
      if (e.pointerType === "touch") {
        tap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        return; // tunggu jari diangkat: kalau malah scroll, nggak usah mekar
      }
      ledak(e.clientX, e.clientY);
    }
    function onUp(e: PointerEvent) {
      akar?.classList.remove("tekan");
      if (tap && e.pointerType === "touch") {
        const { x, y, t } = tap;
        tap = null;
        if (Math.hypot(e.clientX - x, e.clientY - y) < 12 && e.timeStamp - t < 600) ledak(x, y);
      }
    }
    function onBatal() {
      tap = null;
      akar?.classList.remove("tekan");
    }
    function onKeluar() {
      ada = false;
      magnet = null;
      akar?.classList.remove("tampak");
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerover", onOver);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onBatal);
    window.addEventListener("scroll", jadwalCek, { passive: true, capture: true });
    document.documentElement.addEventListener("mouseleave", onKeluar);

    return () => {
      hidup = false;
      cancelAnimationFrame(raf);
      mqGerak.removeEventListener("change", onGerak);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onBatal);
      window.removeEventListener("scroll", jadwalCek, { capture: true });
      window.removeEventListener("resize", ukur);
      document.documentElement.removeEventListener("mouseleave", onKeluar);
      bunga.forEach((el) => el.remove());
      kanvas?.remove();
      akar?.remove();
    };
  }, []);

  return null;
}
