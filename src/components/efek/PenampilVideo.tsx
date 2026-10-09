"use client";

/* Penampil video (r24): overlay buat video galeri. ENGINE tetap
   <video> native (decoder browser); yang diganti cuma LAPISAN
   KONTROL ny (gak ada atribut controls). Kontrol: putar/jeda,
   jalur posisi (klik + drag + keyboard), waktu, layar penuh,
   tombol bisu. Nge-load file asli pas dibuka aja (preload
   metadata), browsing grid cuma makan pratinjau.

   Autoplay (r28): langsung coba play ngikut PREFERENSI BISU/SUARA
   terakhir user (localStorage, bukan setting global). Browser nolak
   autoplay yang bersuara -> fallback muted autoplay + tombol suara
   (ny selalu keliatan). Video inline di panel post udah muter duluan;
   parent ngejeda ny pas penampil ini kebuka (gak ada dua audio).

   Bar kontrol muncul pas interaksi, lesap pelan pas idle (cuma
   pas muter; jeda = selalu keliatan). Tombol bisu nempel pojok
   kanan-bawah area media, SELALU keliatan (gak ikut lesap) biar
   gampang dijretpas video muter — kontras gelap di atas video
   terang maupun gelap. Reduced-motion: transisi lesap mati
   otomatis lewat aturan global. Keyboard (fokus di area video):
   Spasi/K = putar-jeda, M = bisu, F = layar penuh, panah = geser
   5 detik, Esc = nutup (listener dokumen). */

import { useEffect, useRef, useState } from "react";
import { TutupIkon, PlayIkon, JedaIkon, SuaraIkon, BisuIkon, LayarIkon } from "@/components/ikon";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";
import { bacaBisuVideo, setBisuVideo } from "@/lib/pref-video";

const IDLE_MS = 2600;

function formatWaktu(dtk: number): string {
  if (!Number.isFinite(dtk) || dtk < 0) dtk = 0;
  const s = Math.floor(dtk);
  const jam = Math.floor(s / 3600);
  const mnt = Math.floor((s % 3600) / 60);
  const dua = (n: number) => String(n).padStart(2, "0");
  return jam > 0 ? jam + ":" + dua(mnt) + ":" + dua(s % 60) : mnt + ":" + dua(s % 60);
}

export default function PenampilVideo({
  media,
  rasio,
  onTutup,
}: {
  media: { file: string; nama: string; judul: string | null; pratinjau?: string };
  rasio?: number | null;
  onTutup: () => void;
}) {
  const vRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mainkan, setMainkan] = useState(false);
  const [bisu, setBisu] = useState(false);
  const [posisi, setPosisi] = useState(0);
  const [durasi, setDurasi] = useState(0);
  const [geser, setGeser] = useState(false);
  const [barOn, setBarOn] = useState(true);
  const [layar, setLayar] = useState(false);
  const [dukungLayar, setDukungLayar] = useState(false);
  /* r29: video ny SEMPIT (lebar ny kecil — misal video portrait 320px
     di layar desktop): bar kontrol default butuh ~346px konten;
     kalau dipaksain, tombol layar-penuh MELUBER ke slot tombol bisu
     (itulah tabrakan ny — root cause: konten bar gak muat di lebar
     video). Mode "rapat": label durasi total diilangin + gap/
     padding/min-width dirapatkan -> konten muat + slot bisu tetep
     kosong. ResizeObserver = pola yang sama kayak carousel post. */
  const [rapat, setRapat] = useState(false);
  const idleRef = useRef<number | null>(null);

  /* Timer idle: reset tiap interaksi; lesapin bar cuma kalo lagi
     muter. Jeda/drag = kontrol tetep nyala. */
  function bangunkanKontrol() {
    setBarOn(true);
    if (idleRef.current) window.clearTimeout(idleRef.current);
    const v = vRef.current;
    if (v && !v.paused && !geser) {
      idleRef.current = window.setTimeout(() => setBarOn(false), IDLE_MS);
    }
  }

  /* Esc = nutup (di level dokumen, perilaku lama) + kunci gulir. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        mainkanSfx("ui-dissolve");
        onTutup();
      }
    };
    document.addEventListener("keydown", onKey);
    kunciGulir();
    return () => {
      document.removeEventListener("keydown", onKey);
      bukaKunciGulir();
      if (idleRef.current) window.clearTimeout(idleRef.current);
    };
  }, [onTutup]);

  /* Autoplay (sekali pas buka, r28): coba play() ngikut preferensi
     bisu/suara terakhir user (persisten). Ditolak browser (autoplay
     policy) -> kalo tadiny bersuara, fallback ke BISU autoplay —
     video tetep jalan, tangkap error ny doang biar gak ngelempar ke
     console. Kebalikan penampil lama: bisu ny bisa dinyalain dari
     tombol (gesture) + preferensi ny ke-save. */
  useEffect(() => {
    const v = vRef.current;
    if (!v) return;
    v.muted = bacaBisuVideo();
    setBisu(v.muted);
    const p = v.play();
    if (p && typeof p.then === "function") {
      p.then(() => setMainkan(true)).catch(() => {
        if (!v.muted) {
          v.muted = true;
          setBisu(true);
          v.play().catch(() => {});
        }
      });
    }
  }, []);

  /* Layar penuh: tombol cuma muncul kalau API-ny ada (iOS Safari
     gak dukung element fullscreen -> tombolny gak ke-render).
     Deteksi kemampuan browser pas mount = baca sistem eksternal
     (setState ny legit, bukan cascade render).
     r29: rapat-mode ngukur lebar video (lihat komentar state). */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDukungLayar(typeof document !== "undefined" && !!document.fullscreenEnabled);
    const onChange = () => setLayar(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((e) => setRapat(e[0].contentRect.width < 430));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    /* Preferensi LANGSUNG user: persist (video lain ikutin keputusan
       ini — r28). */
    setBisuVideo(v.muted);
    setBisu(v.muted);
  }

  async function toggleLayar() {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      /* ditolak (misal iframe tanpa izin): diemin aja */
    }
  }

  function lompat(dtk: number) {
    const v = vRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 0.05, v.currentTime + dtk));
    setPosisi(v.currentTime);
    bangunkanKontrol();
  }

  /* ---------- Jalur posisi: klik + drag + keyboard ---------- */
  function posisiDariPointer(e: React.PointerEvent): number {
    const jalur = e.currentTarget as HTMLElement;
    const kotak = jalur.getBoundingClientRect();
    const r = kotak.width > 0 ? (e.clientX - kotak.left) / kotak.width : 0;
    return Math.max(0, Math.min(1, r));
  }

  function mulaiGeser(e: React.PointerEvent) {
    const v = vRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGeser(true);
    const rasio = posisiDariPointer(e);
    v.currentTime = rasio * v.duration;
    setPosisi(v.currentTime);
  }

  function gerakGeser(e: React.PointerEvent) {
    if (!geser) return;
    const v = vRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const rasio = posisiDariPointer(e);
    v.currentTime = rasio * v.duration;
    setPosisi(v.currentTime);
  }

  function lepasGeser() {
    setGeser(false);
    bangunkanKontrol();
  }

  /* Keyboard area video (fokus). Spasi/K, M, F, panah. */
  function keyWrap(e: React.KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (e.key === " " || k === "k") {
      e.preventDefault();
      toggleMainkan();
    } else if (k === "m") {
      e.preventDefault();
      toggleBisu();
    } else if (k === "f" && dukungLayar) {
      e.preventDefault();
      void toggleLayar();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      lompat(-5);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      lompat(5);
    }
  }

  function keyJalur(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      lompat(-5);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      lompat(5);
    }
  }

  const total = Number.isFinite(durasi) && durasi > 0 ? durasi : 0;
  const pct = total > 0 ? Math.min(100, (posisi / total) * 100) : 0;
  const adaWaktu = total > 0;

  return (
    <div
      className="video-lapis"
      role="dialog"
      aria-modal="true"
      aria-label="Penampil video"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          mainkanSfx("ui-dissolve");
          onTutup();
        }
      }}
    >
      <button type="button" className="ctrl close" data-sfx="ui-dissolve" aria-label="Tutup penampil" onClick={onTutup} autoFocus>
        <TutupIkon />
      </button>
      <div className="video-kotak">
        <div
          className="vp-wrap"
          ref={wrapRef}
          tabIndex={0}
          role="group"
          aria-label={"Pemutar video " + (media.judul || media.nama)}
          onPointerMove={bangunkanKontrol}
          onPointerDown={bangunkanKontrol}
          onKeyDown={keyWrap}
        >
          <video
            ref={vRef}
            src={media.file}
            poster={media.pratinjau}
            playsInline
            preload="metadata"
            style={rasio && rasio > 0 ? { aspectRatio: String(rasio) } : undefined}
            onPlay={() => {
              setMainkan(true);
              bangunkanKontrol();
            }}
            onPause={() => {
              setMainkan(false);
              setBarOn(true);
              if (idleRef.current) window.clearTimeout(idleRef.current);
            }}
            onEnded={() => {
              setMainkan(false);
              setBarOn(true);
            }}
            onTimeUpdate={(e) => {
              if (geser) return;
              setPosisi(e.currentTarget.currentTime);
            }}
            onDurationChange={(e) => setDurasi(e.currentTarget.duration)}
            onLoadedMetadata={(e) => setDurasi(e.currentTarget.duration)}
            onClick={toggleMainkan}
          />

          {/* Bar kontrol: muncul pas interaksi, lesap pas idle
              (muter). Kanan ny dikasih jeda 60px biar gak ketiban
              tombol bisu yang nempel pojok. r29 .rapat: video sempit
              -> durasi total diilangin + spacing dirapatkan (biar
              tombol layar-penuh GAK meluber ke slot bisu). */}
          <div className={"vp-bar" + (barOn ? " on" : "") + (rapat ? " rapat" : "")}>
            <button
              type="button"
              className="vp-btn"
              onClick={toggleMainkan}
              aria-label={mainkan ? "Jeda video" : "Putar video"}
            >
              {mainkan ? <JedaIkon ukuran={14} /> : <PlayIkon ukuran={14} />}
            </button>
            {adaWaktu && <span className="vp-waktu">{formatWaktu(posisi)}</span>}
            <div
              className="vp-jalur"
              role="slider"
              aria-label="Posisi video"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              tabIndex={0}
              onPointerDown={mulaiGeser}
              onPointerMove={gerakGeser}
              onPointerUp={lepasGeser}
              onPointerCancel={lepasGeser}
              onKeyDown={keyJalur}
            >
              <span className="vp-isi" style={{ width: pct + "%" }} />
              <span className="vp-knob" style={{ left: pct + "%" }} />
            </div>
            {/* Label durasi total: gak ikut di mode rapat (video sempit). */}
            {adaWaktu && !rapat && <span className="vp-waktu total">{formatWaktu(total)}</span>}
            {dukungLayar && (
              <button
                type="button"
                className="vp-btn"
                onClick={() => void toggleLayar()}
                aria-label={layar ? "Keluar layar penuh" : "Layar penuh"}
              >
                <LayarIkon ukuran={15} />
              </button>
            )}
          </div>

          {/* Bisu: pojok kanan-bawah media, SELALU keliatan. */}
          <button
            type="button"
            className="vp-mute"
            onClick={toggleBisu}
            aria-label={bisu ? "Nyalain suara" : "Bisukan video"}
            aria-pressed={bisu}
          >
            {bisu ? <BisuIkon ukuran={17} /> : <SuaraIkon ukuran={17} />}
          </button>
        </div>
        <p className="video-judul">{media.judul || media.nama}</p>
      </div>
    </div>
  );
}
