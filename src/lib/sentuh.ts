"use client";

/* Helper pola layar sentuh: satu sumber buat matiin lapisan "aktif"
   (hover tiruan) di thumbnail galeri maupun kartu media hasil. */

export function matikanAktifLain(kecuali: Element | null) {
  document.querySelectorAll<HTMLElement>(".kartu-media.aktif, .thumb.aktif").forEach((el) => {
    if (el !== kecuali) el.classList.remove("aktif");
  });
}
