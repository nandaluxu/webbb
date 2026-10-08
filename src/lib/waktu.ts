"use client";

import { useEffect, useState } from "react";

/* Waktu relatif (id-ID): "baru aja", "3 menit lalu", "2 jam lalu",
   "Kemarin", "5 hari lalu", terus tanggal buat yang lebih lama.

   Hydration-safe lewat dua aturan:
   1. waktuRelatif() murni: tanggal + "sekarang" dikasih sebagai input,
      gak baca Date.now() sendiri di dalamnya.
   2. Fungsi ny cuma dipanggil dari komponen yang ke-render SETELAH
      interaksi/fetch di client (panel post, daftar komentar), bukan
      pas render SSR pertama, jadi markup server gak pernah beda.
   Detak tick cuma jalan di client (setInterval di useEffect). */

export function waktuRelatif(iso: string, kini: number): string {
  const d = new Date(iso).getTime();
  if (!isFinite(d)) return "";
  const beda = Math.max(0, kini - d);
  const detik = Math.floor(beda / 1000);
  if (detik < 60) return "baru aja";
  const menit = Math.floor(beda / 60000);
  if (menit < 60) return menit + " menit lalu";
  const jam = Math.floor(beda / 3600000);
  if (jam < 24) return jam + " jam lalu";
  const hari = Math.floor(beda / 86400000);
  if (hari === 1) return "Kemarin";
  if (hari < 7) return hari + " hari lalu";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/* Jam "sekarang" yang ke-refresh tiap interval (default 30 detik) biar
   label "3 menit lalu" gak kedaluwarsa pas panel kebuka lama. Awal ny
   diambil sekali pas komponen ke-mount (client doang). */
export function useDetakWaktu(interval = 30000): number {
  const [kini, setKini] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setKini(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return kini;
}
