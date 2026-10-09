"use client";

/* Konfirmasi aksi destruktif (hapus post, hapus user, dsb):
   modal kecil gaya pintu: judul, konsekuensi, Batal + tombol yakin. */

import { useEffect, useRef } from "react";
import { TutupIkon } from "@/components/ikon";
import { mainkanSfx } from "@/lib/suara";

export default function Konfirmasi({
  judul,
  pesan,
  labelYakin,
  sibuk = false,
  onYakin,
  onBatal,
}: {
  judul: string;
  pesan: string;
  labelYakin: string;
  sibuk?: boolean;
  onYakin: () => void;
  onBatal: () => void;
}) {
  const yakinRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    /* Modal konfirmasi = peringatan aksi destruktif: bunyi alert
       pas kebuka (bukan pas halaman dimuat, ini modal ny cuma muncul
       dari klik user). */
    mainkanSfx("system-alert");
    const t = setTimeout(() => yakinRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sibuk) {
        mainkanSfx("ui-dissolve");
        onBatal();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [onBatal, sibuk]);

  return (
    <div
      className="pintu-lapis"
      role="alertdialog"
      aria-modal="true"
      aria-label={judul}
      onClick={(e) => e.target === e.currentTarget && !sibuk && onBatal()}
    >
      <section className="pintu-kotak konfirmasi-kotak">
        <button type="button" className="pintu-tutup" aria-label="Batal" onClick={onBatal} disabled={sibuk}>
          <TutupIkon />
        </button>
        <h2>{judul}</h2>
        <p>{pesan}</p>
        <div className="row" style={{ marginTop: 20 }}>
          <button type="button" className="btn" onClick={onBatal} disabled={sibuk}>
            Batal
          </button>
          <button type="button" ref={yakinRef} className="btn bahaya" onClick={onYakin} disabled={sibuk}>
            {sibuk ? "Bentar..." : labelYakin}
          </button>
        </div>
      </section>
    </div>
  );
}
