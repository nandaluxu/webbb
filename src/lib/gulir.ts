"use client";

/* Kunci scroll body buat overlay (modal/viewer/panel) yang numpuk.
   Dulu tiap overlay set body.style.overflow sendiri-sendiri: pas dua
   layer kebuka (post panel + zoom) terus yang atas ditutup, scroll
   belakang nyala lagi padahal panel bawah masih kebuka. Penghitung di
   sini bikin cuma pemanggil TERAKHIR yang benerin balik overflow. */

let dalam = 0;

export function kunciGulir() {
  dalam++;
  if (dalam === 1) document.body.style.overflow = "hidden";
}

export function bukaKunciGulir() {
  if (dalam === 0) return;
  dalam--;
  if (dalam === 0) document.body.style.overflow = "";
}

/* Cadangan: kalau unmount gak kebersihin (pindah halaman dadakan),
   reset manual biar gak kekunci selamany. */
export function resetGulir() {
  dalam = 0;
  document.body.style.overflow = "";
}
