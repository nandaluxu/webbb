"use client";

/* Editor foto profil: muncul SETELAH user milih foto, SEBELUM nyimpen.
   File asli gak tersentuh sampai user pencet Simpan (cuma kebaca
   lewat object URL); hasil akhirny gambar 1:1 (512px, webp) dari
   posisi crop yang user atur.

   Alat ny: zoom (tombol/scroll/pinch), geser (drag/pinch), putar
   90 derajat, reset, preview kecil, batal. Pan kekunci biar area
   crop gak pernah kosong (gambar selalu nutupin kotak 1:1). */

import { useEffect, useRef, useState } from "react";
import { TutupIkon, ZoomInIkon, ZoomOutIkon, PutarIkon, ResetIkon } from "@/components/ikon";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";

const UKURAN = 512;
const ZOOM_MAKS_FAKTOR = 5;

export default function EditorPfp({
  file,
  nama,
  onSimpan,
  onBatal,
}: {
  file: File;
  nama: string;
  onSimpan: (hasil: File) => void;
  onBatal: () => void;
}) {
  const kanvasRef = useRef<HTMLCanvasElement>(null);
  const pratinjauRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [siap, setSiap] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");

  /* Transformasi: zoom skala gambar, geser (px output), putar (derajat,
     kelipatan 90). Disimpan di ref biar gambar ulang gak bergantung
     render React (60fps pas drag). */
  const z = useRef(1);
  const geser = useRef({ x: 0, y: 0 });
  const putar = useRef(0);
  const dasarZoom = useRef(1);

  /* Muat file ke <img> (object URL). */
  useEffect(() => {
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => {
      imgRef.current = img;
      /* Zoom awal: cover (gambar nutupin kotak 1:1, gak ada area
         kosong). Nilai ny kebalik invariant terhadap rotasi 90
         karena max(a,b) simetris. */
      const s = Math.max(UKURAN / img.naturalWidth, UKURAN / img.naturalHeight);
      dasarZoom.current = s;
      z.current = s;
      geser.current = { x: 0, y: 0 };
      putar.current = 0;
      setSiap(true);
      gambarUlang();
    };
    img.onerror = () => setGalat("File ny gak kebaca sebagai gambar.");
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
      urlRef.current = null;
    };
  }, [file]);

  /* Scroll lock + Esc = batal + fokus ke tombol tutup. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sibuk) {
        mainkanSfx("ui-dissolve");
        onBatal();
      }
    };
    document.addEventListener("keydown", onKey);
    kunciGulir();
    return () => {
      document.removeEventListener("keydown", onKey);
      bukaKunciGulir();
    };
  }, []);

  function gambarUlang() {
    const kanvas = kanvasRef.current;
    const img = imgRef.current;
    if (!kanvas || !img) return;
    const ctx = kanvas.getContext("2d");
    if (!ctx) return;
    /* Kepit pan dulu biar area crop gak pernah kosong. */
    kepIt();
    ctx.save();
    ctx.clearRect(0, 0, UKURAN, UKURAN);
    ctx.translate(UKURAN / 2 + geser.current.x, UKURAN / 2 + geser.current.y);
    ctx.rotate((putar.current * Math.PI) / 180);
    ctx.scale(z.current, z.current);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
    /* Pratinjau kecil: cuma nyalin kanvas utama. */
    const pra = pratinjauRef.current;
    if (pra) {
      const pctx = pra.getContext("2d");
      if (pctx) {
        pctx.clearRect(0, 0, pra.width, pra.height);
        pctx.drawImage(kanvas, 0, 0, pra.width, pra.height);
      }
    }
  }

  /* Kepit pan biar kotak 1:1 selalu keisi gambar (gak ada sisi
     kosong), panen ny dari bounding box yang udah keputar. */
  function kepIt() {
    const img = imgRef.current;
    if (!img) return;
    const miring = putar.current % 180 !== 0;
    const w = (miring ? img.naturalHeight : img.naturalWidth) * z.current;
    const h = (miring ? img.naturalWidth : img.naturalHeight) * z.current;
    const setengah = UKURAN / 2;
    if (w < UKURAN) geser.current.x = 0;
    else geser.current.x = Math.max(setengah - w / 2, Math.min(w / 2 - setengah, geser.current.x));
    if (h < UKURAN) geser.current.y = 0;
    else geser.current.y = Math.max(setengah - h / 2, Math.min(h / 2 - setengah, geser.current.y));
  }

  function setZoom(nz: number) {
    z.current = Math.max(dasarZoom.current, Math.min(dasarZoom.current * ZOOM_MAKS_FAKTOR, nz));
    gambarUlang();
  }

  /* Zoom di sekitar titik (scroll/pinch): titik itu tetap di tempat. */
  function zoomDiTitik(px: number, py: number, nz: number) {
    const cakup = Math.max(dasarZoom.current, Math.min(dasarZoom.current * ZOOM_MAKS_FAKTOR, nz));
    const rasio = cakup / z.current;
    geser.current.x = (px - UKURAN / 2) * (1 - rasio) + rasio * geser.current.x;
    geser.current.y = (py - UKURAN / 2) * (1 - rasio) + rasio * geser.current.y;
    z.current = cakup;
    gambarUlang();
  }

  function putar_() {
    putar.current = (putar.current + 90) % 360;
    gambarUlang();
    mainkanSfx("ui-menu");
  }

  function reset() {
    z.current = dasarZoom.current;
    geser.current = { x: 0, y: 0 };
    putar.current = 0;
    gambarUlang();
    mainkanSfx("ui-dissolve");
  }

  async function simpan() {
    setSibuk(true);
    setGalat("");
    mainkanSfx("ui-menu");
    try {
      const kanvas = kanvasRef.current;
      if (!kanvas) throw new Error();
      const blob = await new Promise<Blob | null>((ya) => kanvas.toBlob(ya, "image/webp", 0.92));
      if (!blob || blob.type !== "image/webp") throw new Error();
      const hasil = new File([blob], "pfp.webp", { type: "image/webp" });
      setSibuk(false);
      onSimpan(hasil);
    } catch {
      setSibuk(false);
      setGalat("Gagal nyimpen hasil potongan. Coba lagi.");
      mainkanSfx("failure");
    }
  }

  /* Gesture di panggung: drag 1 jari, pinch 2 jari (zoom + geser),
     scroll = zoom. Koordinat pointer di-skala ke ukuran output. */
  function pasangGesture(el: HTMLElement) {
    const pts = new Map<number, { x: number; y: number }>();
    let panAwal: { x: number; y: number } | null = null;
    let pinchAwal: { d: number; z: number; mx: number; my: number; gx: number; gy: number } | null = null;
    const skala = () => UKURAN / el.getBoundingClientRect().width;

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinchAwal === null) {
        const [a, b] = [...pts.values()];
        pinchAwal = {
          d: Math.hypot(a.x - b.x, a.y - b.y),
          z: z.current,
          mx: (a.x + b.x) / 2,
          my: (a.y + b.y) / 2,
          gx: geser.current.x,
          gy: geser.current.y,
        };
        panAwal = null;
      } else if (pts.size === 1) {
        panAwal = { x: e.clientX - geser.current.x * skala(), y: e.clientY - geser.current.y * skala() };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinchAwal) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchAwal.d > 0) setZoom(pinchAwal.z * (d / pinchAwal.d));
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        geser.current.x = pinchAwal.gx + (mx - pinchAwal.mx) * skala();
        geser.current.y = pinchAwal.gy + (my - pinchAwal.my) * skala();
        gambarUlang();
      } else if (panAwal && pts.size === 1) {
        geser.current.x = (e.clientX - panAwal.x) / skala();
        geser.current.y = (e.clientY - panAwal.y) / skala();
        gambarUlang();
      }
    };
    const onEnd = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinchAwal = null;
      if (pts.size === 0) panAwal = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const kotak = el.getBoundingClientRect();
      const px = (e.clientX - kotak.left) * (UKURAN / kotak.width);
      const py = (e.clientY - kotak.top) * (UKURAN / kotak.height);
      zoomDiTitik(px, py, z.current * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onEnd);
    el.addEventListener("pointercancel", onEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onEnd);
      el.removeEventListener("pointercancel", onEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }

  const panggungRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!siap || !panggungRef.current) return;
    const lepas = pasangGesture(panggungRef.current);
    return lepas;
  }, [siap]);

  return (
    <div
      className="pfp-lapis"
      role="dialog"
      aria-modal="true"
      aria-label="Atur foto profil"
      onClick={(e) => e.target === e.currentTarget && !sibuk && onBatal()}
    >
      <section className="pfp-kotak">
        <button type="button" className="post-tutup" data-sfx="ui-dissolve" aria-label="Batal" onClick={onBatal} disabled={sibuk}>
          <TutupIkon />
        </button>

        <h2>Atur foto profil</h2>
        <p className="pfp-ket">Geser, zoom, atau putar fotony. Hasilny dipotong jadi kotak 1:1, file asli lu gak berubah sebelum nyimpen.</p>

        <div className="pfp-badan">
          <div
            className={"pfp-panggung" + (siap ? "" : " memuat")}
            ref={panggungRef}
            aria-label="Area potong foto"
            role="application"
          >
            <canvas ref={kanvasRef} width={UKURAN} height={UKURAN} className="pfp-kanvas" />
            {!siap && !galat && <span className="pfp-memuat" aria-hidden="true" />}
          </div>

          <div className="pfp-sisi">
            <div className="pfp-pratinjau">
              <canvas ref={pratinjauRef} width={96} height={96} className="pfp-pra-kanvas" aria-label="Pratinjau foto profil" role="img" />
              <span className="pfp-pra-ket">Pratinjau 1:1</span>
            </div>
            <div className="pfp-alat" role="group" aria-label="Alat edit foto">
              <button type="button" className="btn kecil" onClick={() => setZoom(z.current / 1.25)} disabled={!siap} aria-label="Perkecil">
                <ZoomOutIkon ukuran={15} />
              </button>
              <button type="button" className="btn kecil" onClick={() => setZoom(z.current * 1.25)} disabled={!siap} aria-label="Perbesar">
                <ZoomInIkon ukuran={15} />
              </button>
              <button type="button" className="btn kecil" onClick={putar_} disabled={!siap} aria-label="Putar 90 derajat">
                <PutarIkon ukuran={15} />
              </button>
              <button type="button" className="btn kecil" onClick={reset} disabled={!siap} aria-label="Atur ulang">
                <ResetIkon ukuran={15} />
              </button>
            </div>
          </div>
        </div>

        {galat && (
          <p className="hint" role="alert" style={{ color: "var(--tanda)" }}>
            {galat}
          </p>
        )}

        <div className="pfp-aksi">
          <button type="button" className="btn" onClick={onBatal} disabled={sibuk}>
            Batal
          </button>
          <button type="submit" className="btn primary" onClick={simpan} disabled={!siap || sibuk}>
            {sibuk ? "Nyunuh..." : "Simpan foto profil"}
          </button>
        </div>
        <p className="pfp-catatan">Nama akun: {nama}. Fotony keproses jadi 256px pas disimpen.</p>
      </section>
    </div>
  );
}
