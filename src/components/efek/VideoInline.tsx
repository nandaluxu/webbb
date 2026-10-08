"use client";

/* VideoInline (r28): <video> native yang LANGSUNG autoplay di dalem
   panel post (bukan thumbnail + tombol play dulu).

   Autoplay policy yang dihormati (gak ada workaround aneh):
   1. Coba play() ngikut preferensi bisu/bersuara terakhir user
      (localStorage, lihat lib/pref-video — BUKAN setting global).
   2. Browser nolak autoplay bersuara -> fallback ke BISU autoplay
      (video tetep jalan) + hint "tap buat suara" + tombol bisu ny
      selalu keliatan.
   3. Gagal total (autoplay diblokir ama user di setting browser) ->
      video diemin paused, tombol play gede kebaca.

   Mesin ny 100% <video> native browser. Kontrol minimal inline:
   play/jeda (klik video), bisu (pojok, selalu keliatan), perbesar
   (buka PenampilVideo — dipanggil parent). Pas parent buka penampil
   penuh, prop `tertunda` nyala: video ny dijeda (gak ada dua video
   muter barengan), dan dilanjutin lagi pas penampilny ketutup kalo
   tadi ny lagi muter.

   Cleanup: effect muter balik + ref mainkanSebelum dibersihin pas
   unmount — pindah slide / ganti post / nutup panel = berhenti. */
import { useEffect, useRef, useState } from "react";
import { PlayIkon, JedaIkon, SuaraIkon, BisuIkon, BesarIkon } from "@/components/ikon";
import { bacaBisuVideo, setBisuVideo } from "@/lib/pref-video";

export default function VideoInline({
  file,
  pratinjau,
  nama,
  rasio,
  tertunda,
  onPerbesar,
}: {
  file: string;
  pratinjau?: string;
  nama: string;
  rasio?: number | null;
  /* True = ditahan (penampil penuh lagi kebuka): video dijeda. */
  tertunda: boolean;
  /* r30: buka penampil penuh. Dipasang parent (PanelPost) — kalo
     ada, tombol perbesar ny nempel di BARIS KONTROL video ini
     (satu row sama bisu), bukan tombol overlay terpisah milik
     panel. Satu kontainer = gak mungkin tabrakan. */
  onPerbesar?: () => void;
}) {
  const vRef = useRef<HTMLVideoElement>(null);
  const [mainkan, setMainkan] = useState(false);
  const [bisu, setBisu] = useState(false);
  /* Bisu gara-gara fallback autoplay (bukan pilihan user) -> hint
     "tap buat suara" muncul sampai user ngambil keputusan. */
  const [bisuFallback, setBisuFallback] = useState(false);
  const hintTimer = useRef(0);
  /* Lagi muter sebelum ditahan? buat muter balik pas penampil tutup. */
  const mainkanSebelum = useRef(false);

  /* Autoplay sekali pas mount. play() dipanggil dari effect (bukan
     handler klik) — biasanya masih dalem jendela user-activation dari
     klik yang buka post; kalo browser tetep nolak yang bersuara,
     fallback bisu. */
  useEffect(() => {
    const v = vRef.current;
    if (!v) return;
    v.muted = bacaBisuVideo();
    setBisu(v.muted);
    const p = v.play();
    if (p && typeof p.then === "function") {
      p.then(() => setMainkan(true)).catch(() => {
        if (!v.muted) {
          /* Autoplay bersuara ditolak -> muted autoplay + hint. */
          v.muted = true;
          setBisu(true);
          setBisuFallback(true);
          clearTimeout(hintTimer.current);
          hintTimer.current = window.setTimeout(() => setBisuFallback(false), 6000);
          v.play().catch(() => {});
        } else {
          /* Muted autoplay juga ditolak (autoplay diblokir total) ->
             paused, tombol play nyelasarin diri ny. */
          setMainkan(false);
        }
      });
    }
    return () => {
      clearTimeout(hintTimer.current);
      const el = vRef.current;
      if (el) el.pause();
    };
  }, []);

  /* Ditahan (penampil penuh kebuka): jeda + catet lagi-muter ny;
     dilepas: lanjutin kalo tadi ny muter. */
  useEffect(() => {
    const v = vRef.current;
    if (!v) return;
    if (tertunda) {
      mainkanSebelum.current = !v.paused;
      v.pause();
    } else if (mainkanSebelum.current) {
      mainkanSebelum.current = false;
      v.play().catch(() => {});
    }
  }, [tertunda]);

  function toggleMainkan() {
    const v = vRef.current;
    if (!v) return;
    if (v.paused) {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } else {
      v.pause();
    }
  }

  function toggleBisu() {
    const v = vRef.current;
    if (!v) return;
    v.muted = !v.muted;
    /* Preferensi langsung user: persist (video berikutnya nurut
       keputusan ini — gak reset pas pindah post / remount). */
    setBisuVideo(v.muted);
    setBisu(v.muted);
    setBisuFallback(false);
  }

  return (
    <div
      className="vi-wrap"
      style={rasio && rasio > 0.05 ? { aspectRatio: String(rasio) } : undefined}
    >
      <video
        ref={vRef}
        src={file}
        poster={pratinjau}
        playsInline
        preload="auto"
        aria-label={"Video " + nama}
        onClick={toggleMainkan}
        onPlay={() => setMainkan(true)}
        onPause={() => setMainkan(false)}
        onEnded={() => setMainkan(false)}
      />

      {/* Tombol play/jeda: nongol pas paused ATAU pas hover (muter ny
          lesap biar fokus ke videony). */}
      <button
        type="button"
        className={"vi-tombol" + (mainkan ? " muter" : "")}
        onClick={toggleMainkan}
        aria-label={mainkan ? "Jeda video" : "Putar video"}
        aria-pressed={mainkan}
      >
        {mainkan ? <JedaIkon ukuran={18} /> : <PlayIkon ukuran={22} />}
      </button>

      {/* Hint bisu-fallback (autoplay bersuara ditolak browser):
          nempel DI ATAS baris kontrol (r30) — gak pernah nutupin
          bisu/perbesar, gak mungkin keluar viewport (posisiny
          relatif kontainer media, bukan layar). */}
      {bisuFallback && (
        <button type="button" className="vi-hint" onClick={toggleBisu}>
          <SuaraIkon ukuran={13} />
          Browser nolak suara otomatis — tap buat nyalain
        </button>
      )}

      {/* Baris kontrol pojok kanan-bawah (r30): [bisu] [perbesar]
          SATU ROW. Dulu bisu (bottom:68) disusun manual di atas
          tombol "Perbesar video" milik PanelPost (bottom:14) — dua
          komponen beda, dua posisi hard-coded, tabrakan ny kebolak
          balik tiap ronde. Sekarang kedua tombol jadi ANAK kontainer
          flex yang sama: jarak ny dari gap, urutanny dari flex,
          gak ada angka posisi ny harus disinkronin manual. Foto
          tetep pake tombol "Lihat asli" milik panel (posisiny
          konsisten buat foto). */}
      <div className="vi-kontrol">
        <button
          type="button"
          className="vi-bisu"
          onClick={toggleBisu}
          aria-label={bisu ? "Nyalain suara" : "Bisukan video"}
          aria-pressed={bisu}
        >
          {bisu ? <BisuIkon ukuran={17} /> : <SuaraIkon ukuran={17} />}
        </button>
        {onPerbesar && (
          <button
            type="button"
            className="vi-perbesar"
            data-sfx="ui-menu"
            onClick={onPerbesar}
            aria-label="Perbesar video"
          >
            <BesarIkon ukuran={16} />
            <span className="vi-tip" aria-hidden="true">
              Perbesar video
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
