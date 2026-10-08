"use client";

/* Preferensi video (r28): BISU/ADA-SUARA, preferensi playback LANGSUNG
   user (BUKAN setting global halaman Pengaturan).

   - Nyimpen di localStorage, pola yang sama kayak suara/tema (satu
     kunci, event ubah, hydration aman).
   - Default: Bersuara (false = gak bisu). Buka video pertama kali ->
     coba play bersuara; browser nolak autoplay bersuara -> fallback
     bisu otomatis (tapi preferensi user NYA tetep bersuara sampai dia
     beneran muter tombol bisu).
   - Sekali user nekan tombol bisu/nyalain suara, preferensi ny
     tersimpan: video berikutnya (post lain, remount, restart browser)
     nurutin preferensi terakhir itu.
   - Akun gak terlibat: ini murni per-browser.

   (r24 punya kunci "neyhra:autoplay-video" buat toggle autoplay di
   Pengaturan — r28: autoplay selalu nyala jadi post video langsung
   muter pas dibuka, toggle ny dihapus dari Pengaturan, kunci lama ny
   dibersihin biar gak nyangkut.) */

import { useSyncExternalStore } from "react";

const KUNCI = "neyhra:bisu-video";
const KUNCI_LAMA = "neyhra:autoplay-video";
const BAWAAN = false;

let nilai = BAWAAN;
const pendengar = new Set<() => void>();

try {
  if (typeof window !== "undefined") {
    if (window.localStorage.getItem(KUNCI) === "bisu") nilai = true;
    /* Bersihin sisa preferensi r24 (gak kepake lagi). */
    window.localStorage.removeItem(KUNCI_LAMA);
  }
} catch {}

function umpan() {
  pendengar.forEach((f) => f());
}

export function bacaBisuVideo(): boolean {
  return nilai;
}

export function setBisuVideo(bisu: boolean) {
  nilai = bisu;
  try {
    window.localStorage.setItem(KUNCI, bisu ? "bisu" : "bersuara");
  } catch {}
  umpan();
}

function langganan(f: () => void) {
  pendengar.add(f);
  return () => pendengar.delete(f);
}

/* Snapshot server konstan (false): nilai localStorage cuma kebaca
   setelah hydration, render server gak boleh beda. */
export function useBisuVideo(): boolean {
  return useSyncExternalStore(langganan, () => nilai, () => BAWAAN);
}
