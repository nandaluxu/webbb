"use client";

/* Penampil foto: lightbox dengan zoom, geser, pinch, swipe, dan keyboard.
   Dipasang sekali di kerangka aplikasi; view lain manggil
   Penampil.buka(daftar, indeksAwal, elemenPemicu).

   Zoom "100%" = FIT KE VIEWPORT (bukan ukuran pixel asli): ukuran
   dasar gambar dibatesin ruang stage (viewport dikurangi ruang
   kontrol), jadi gambar resolusi gede tetap keliatan utuh pas
   baru kebuka. Zoom di atas 100% baru memperbesar dari ukuran
   fit itu (pan/drag nyala). */

import { useCallback, useEffect, useRef, useState } from "react";
import { TutupIkon, KiriIkon, KananIkon, ZoomInIkon, ZoomOutIkon, ResetIkon, PutarIkon } from "@/components/ikon";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";

export type Foto = {
  src: string;
  alt?: string;
  /* Pratinjau cadangan (P0-3 r27): kalau src utamany gak bisa
     dimuat (contoh nyata: pinimg nolak varian 736x buat PNG/GIF),
     penampil nyoba sekali lewat jalur ini sebelum nyerah. Sumber
     laen (galeri) gak ngisi — perilakunya sama kayak dulu. */
  cadangan?: string;
};

const api = {
  buka: (_daftar: Foto[], _mulai?: number, _pemicu?: HTMLElement | null) => {},
  tutup: () => {},
};
export const Penampil = api;

const MAX_ZOOM = 4;
const pad = (n: number) => String(n).padStart(2, "0");

export default function PenampilMount() {
  const [buka, setBuka] = useState(false);
  const [cur, setCur] = useState(0);
  const daftarRef = useRef<Foto[]>([]);
  const curRef = useRef(0);
  /* Indeks foto yang udah nyoba cadangan ny (sekali doang per
     foto — nyoba dua kali = infinite loop gagal). */
  const nyobaCadangan = useRef<Set<number>>(new Set());
  const pemicuRef = useRef<HTMLElement | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomInfoRef = useRef<HTMLDivElement>(null);
  const z = useRef(1);
  const tx = useRef(0);
  const ty = useRef(0);
  const busy = useRef(false);
  /* Nutupnya dianimasin (fadeout singkat): penanda + timer biar
     gak dobel panggil tutup pas animasi masih jalan. */
  const menutup = useRef(false);
  const timerTutup = useRef(0);
  /* Rotasi 90 derajat searah jarum jam: cuma tampilan ny, file asli
     gak tersentuh (transform CSS doang). Di-reset pas ganti foto. */
  const r = useRef(0);

  useEffect(() => {
    api.buka = (daftarBaru, mulai = 0, pemicu = null) => {
      if (!daftarBaru.length) return;
      clearTimeout(timerTutup.current);
      menutup.current = false;
      daftarRef.current = daftarBaru;
      pemicuRef.current = pemicu || null;
      const awal = Math.max(0, Math.min(daftarBaru.length - 1, mulai));
      curRef.current = awal;
      z.current = 1;
      tx.current = 0;
      ty.current = 0;
      r.current = 0;
      nyobaCadangan.current = new Set();
      setCur(awal);
      setBuka(true);
      kunciGulir();
    };
    api.tutup = () => {
      if (menutup.current) return;
      menutup.current = true;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      /* Fadeout singket (kelas .tutup) sebelum beneran dilepas:
      nutup ny gak patah. */
      document.getElementById("penampil-root")?.classList.add("tutup");
      timerTutup.current = window.setTimeout(
        () => {
          setBuka(false);
          bukaKunciGulir();
          const img = imgRef.current;
          if (img) img.removeAttribute("src");
          pemicuRef.current?.focus?.();
          menutup.current = false;
        },
        reduce ? 0 : 200
      );
    };
  }, []);

  function clampPan() {
    const img = imgRef.current;
    if (!img) return;
    if (z.current <= 1) {
      tx.current = 0;
      ty.current = 0;
      return;
    }
    /* Pas dirotasi 90/270, sumbu visual ke-swap: lebar nyambung
           tinggi. Clamp ny ikutin biar pan gak nyasar keluar layar. */
    const miring = r.current % 180 !== 0;
    const lebar = miring ? img.clientHeight : img.clientWidth;
    const tinggi = miring ? img.clientWidth : img.clientHeight;
    const mx = (lebar * z.current - img.clientWidth) / 2;
    const my = (tinggi * z.current - img.clientHeight) / 2;
    tx.current = Math.max(-mx, Math.min(mx, tx.current));
    ty.current = Math.max(-my, Math.min(my, ty.current));
  }

  function apply(smooth = true) {
    const img = imgRef.current;
    if (!img) return;
    img.style.transition = smooth ? "" : "none";
    img.style.transform = `translate(${tx.current}px,${ty.current}px) scale(${z.current}) rotate(${r.current}deg)`;
    img.classList.toggle("zoomed", z.current > 1);
    if (zoomInfoRef.current) zoomInfoRef.current.textContent = Math.round(z.current * 100) + "%" + (r.current ? " • " + r.current + "°" : "");
  }

  function setZoom(nz: number, smooth = true) {
    z.current = Math.max(1, Math.min(MAX_ZOOM, nz));
    clampPan();
    apply(smooth);
  }

  function resetZoom() {
    z.current = 1;
    tx.current = 0;
    ty.current = 0;
    r.current = 0;
    apply();
  }

  function putar() {
    r.current = (r.current + 90) % 360;
    clampPan();
    apply();
  }

  /* Zoom ke titik (double tap / double click): titik yang ditekan
     tetap di tempat ny pas skala naik, jadi bagian yang mau diliat
     gak nyasar ke pinggir. */
  function zoomKeTitik(x: number, y: number) {
    const img = imgRef.current;
    if (!img) return;
    if (z.current > 1) {
      resetZoom();
      return;
    }
    const kotak = img.getBoundingClientRect();
    const cx = kotak.left + kotak.width / 2;
    const cy = kotak.top + kotak.height / 2;
    const z1 = 2.5;
    tx.current = (x - cx) * (1 - z1);
    ty.current = (y - cy) * (1 - z1);
    z.current = z1;
    clampPan();
    apply();
  }

  async function load(i: number) {
    const img = imgRef.current;
    if (!img) return;
    const foto = daftarRef.current[i];
    if (!foto) return;
    img.src = foto.src;
    img.alt = foto.alt || "Foto " + (i + 1);
    try {
      await img.decode();
    } catch {}
    /* src utamany gagal dimuat (naturalWidth 0 = broken) + ada
       cadangan + belum pernah dicoba buat foto ini -> tuker ke
       cadangan (sekali aja). */
    if (img.naturalWidth === 0 && foto.cadangan && !nyobaCadangan.current.has(i)) {
      nyobaCadangan.current.add(i);
      img.src = foto.cadangan;
      try {
        await img.decode();
      } catch {}
    }
    const total = daftarRef.current.length;
    [i + 1, i - 1].forEach((j) => {
      const t = (j + total) % total;
      if (daftarRef.current[t]) {
        const p = new Image();
        p.src = daftarRef.current[t].src;
      }
    });
  }

  const go = useCallback(
    async (d: number) => {
      const total = daftarRef.current.length;
      if (busy.current || total < 2) return;
      const layer = layerRef.current;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      busy.current = true;
      try {
        if (layer) {
          const out = layer.animate(
            [
              { opacity: 1, transform: "translateX(0)" },
              { opacity: 0, transform: `translateX(${-d * 60}px)` },
            ],
            { duration: reduce ? 1 : 220, easing: "ease-in", fill: "forwards" }
          );
          await out.finished;
          out.cancel();
        }
        const berikut = (curRef.current + d + total) % total;
        curRef.current = berikut;
        setCur(berikut);
        z.current = 1;
        tx.current = 0;
        ty.current = 0;
        r.current = 0;
        apply(false);
        await load(berikut);
        if (layer) {
          const inn = layer.animate(
            [
              { opacity: 0, transform: `translateX(${d * 60}px)` },
              { opacity: 1, transform: "translateX(0)" },
            ],
            { duration: reduce ? 1 : 380, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" }
          );
          await inn.finished;
          inn.cancel();
        }
      } finally {
        busy.current = false;
      }
    },
    []
  );

  /* Pasang gesture + keyboard pas viewer lagi kebuka. */
  useEffect(() => {
    if (!buka) return;
    const img = imgRef.current;
    if (!img) return;
    const gambar = img;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    load(curRef.current);

    const pts = new Map<number, { x: number; y: number }>();
    let panStart: { x: number; y: number } | null = null;
    let pinchStart: { d: number; z: number } | null = null;
    let swipeX = 0;
    let swipeY = 0;
    /* Double tap (sentuh): deteksi manual, cuma buat pointer touch
       biar gak dobel sama event dblclick mouse. */
    let tapWaktu = 0;
    let tapX = 0;
    let tapY = 0;
    const dist = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    function onDown(e: PointerEvent) {
      gambar.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        pinchStart = { d: dist(), z: z.current };
        panStart = null;
      } else {
        panStart = { x: e.clientX - tx.current, y: e.clientY - ty.current };
        swipeX = e.clientX;
        swipeY = e.clientY;
        if (z.current > 1) {
          gambar.classList.add("dragging");
          window.dispatchEvent(new Event("inkgrab:start"));
        }
      }
    }
    function onMove(e: PointerEvent) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinchStart) {
        setZoom((pinchStart.z * dist()) / pinchStart.d, false);
      } else if (panStart && z.current > 1) {
        tx.current = e.clientX - panStart.x;
        ty.current = e.clientY - panStart.y;
        clampPan();
        apply(false);
      }
    }
    function onEnd(e: PointerEvent) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      gambar.classList.remove("dragging");
      if (pts.size < 2) pinchStart = null;
      if (pts.size === 0) {
        window.dispatchEvent(new Event("inkgrab:end"));
        if (panStart) {
          const dx = e.clientX - swipeX;
          const dy = e.clientY - swipeY;
          if (z.current <= 1 && e.type === "pointerup" && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
            go(dx < 0 ? 1 : -1);
            return apply();
          }
          /* Tap pendek nyaris gak gerak: kandidat double tap (sentuh). */
          if (e.pointerType === "touch" && e.type === "pointerup" && Math.abs(dx) < 24 && Math.abs(dy) < 24) {
            const kini = performance.now();
            const dobel = kini - tapWaktu < 320 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 36;
            tapWaktu = kini;
            tapX = e.clientX;
            tapY = e.clientY;
            if (dobel) {
              tapWaktu = 0;
              zoomKeTitik(e.clientX, e.clientY);
              return;
            }
          }
          apply();
        }
        panStart = null;
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), false);
    };
    const onDbl = (e: MouseEvent) => zoomKeTitik(e.clientX, e.clientY);
    function onKey(e: KeyboardEvent) {
      const k = e.key;
      if (k === "ArrowLeft") go(-1);
      else if (k === "ArrowRight") go(1);
      else if (k === "Escape") {
        mainkanSfx("ui-dissolve");
        api.tutup();
      }
      else if (k === "+" || k === "=") setZoom(z.current + 0.25);
      else if (k === "-") setZoom(z.current - 0.25);
      else if (k === "0") resetZoom();
      else if (k === "r" || k === "R") putar();
      else if (k === "Tab") {
        const root = document.getElementById("penampil-root");
        if (!root) return;
        const f = [...root.querySelectorAll<HTMLElement>("button")];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    const onResize = () => {
      clampPan();
      apply(false);
    };

    img.addEventListener("pointerdown", onDown);
    img.addEventListener("pointermove", onMove);
    img.addEventListener("pointerup", onEnd);
    img.addEventListener("pointercancel", onEnd);
    img.addEventListener("dblclick", onDbl);
    window.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);

    /* Fokus pertama biar keyboard langsung nyambung. */
    const t = setTimeout(() => {
      const root = document.getElementById("penampil-root");
      root?.querySelector<HTMLElement>(".ctrl.close")?.focus();
    }, reduce ? 0 : 60);

    return () => {
      clearTimeout(t);
      img.removeEventListener("pointerdown", onDown);
      img.removeEventListener("pointermove", onMove);
      img.removeEventListener("pointerup", onEnd);
      img.removeEventListener("pointercancel", onEnd);
      img.removeEventListener("dblclick", onDbl);
      window.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [buka, go]);

  const klikStage = useCallback((e: React.MouseEvent) => {
    if (e.target === stageRef.current || e.target === layerRef.current) {
      mainkanSfx("ui-dissolve");
      api.tutup();
    }
  }, []);

  if (!buka) return null;
  const total = daftarRef.current.length;

  return (
    <div
      className="viewer open"
      role="dialog"
      aria-modal="true"
      aria-label="Penampil foto"
      id="penampil-root"
      onClick={klikStage}
    >
      <div className="meta" aria-live="polite">
        <b>{pad(cur + 1)}</b>dari<span>{pad(total)}</span>
      </div>
      <button type="button" className="ctrl close" data-sfx="ui-dissolve" aria-label="Tutup penampil" onClick={() => api.tutup()}>
        <TutupIkon />
      </button>
      <button type="button" className="ctrl nav prev" aria-label="Foto sebelumnya" onClick={() => go(-1)}>
        <KiriIkon />
      </button>
      <div className="stage" ref={stageRef}>
        <div className="layer" ref={layerRef}>
          <img className="viewer-img" ref={imgRef} alt="" draggable="false" />
        </div>
      </div>
      <button type="button" className="ctrl nav next" aria-label="Foto berikutnya" onClick={() => go(1)}>
        <KananIkon />
      </button>
      <div className="toolbar">
        <button type="button" className="ctrl" aria-label="Perkecil" onClick={() => setZoom(z.current - 0.25)}>
          <ZoomOutIkon />
        </button>
        <div className="zoom-info" ref={zoomInfoRef}>
          100%
        </div>
        <button type="button" className="ctrl" aria-label="Perbesar" onClick={() => setZoom(z.current + 0.25)}>
          <ZoomInIkon />
        </button>
        <button type="button" className="ctrl" aria-label="Reset zoom" onClick={resetZoom}>
          <ResetIkon />
        </button>
        <button type="button" className="ctrl" aria-label="Putar 90 derajat searah jarum jam" onClick={putar} title="Putar (R)">
          <PutarIkon />
        </button>
      </div>
    </div>
  );
}
