"use client";

/* GulirBar (r27 / P3-11): scrollbar dokumen custom ala Neyhra.
   Prinsip: MESIN SCROLL TETEP NATIVE (window scroll biasa, gak ada
   scroll-sintetis/transform body). Yang diganti cuma VISUAL ny:
   - CSS nyembunyin scrollbar dokumen native (pointer:fine doang —
     HP tetep pake scrollbar overlay OS ny).
   - Komponen ny gambar track+thumb fixed di kanan, posisiny diitung
     dari scrollY asli tiap frame (rAF), TANPA React state per
     piksel (langsung style via ref).
   - EKOR: panjang ekor = kecepatan scroll (cepat = ekor panjang,
     pelan = pendek). Dinamikany SPRING underdamped: pas scroll
     berhenti abis kenceng, ekor ny balik dengan overshoot kecil
     (efek "boing" yang diminta, gak berlebihan).
   - reduced-motion: ekor + boing mati (thumb posisiny tetep bener —
     itu informasi, bukan animasi).
   - Overlay kebuka (body overflow hidden): thumb nyembunyi (emang
     gak bisa scroll). Gak ngeganggu klik: pointer-events:none.
   - Cleanup: semua listener + loop di-buang pas unmount. */

import { useEffect, useRef, useState } from "react";

const LEBAR_TRACK = 10;
const LEBAR_THUMB = 5;
const TINGGI_MIN_THUMB = 34;
const EKOR_MAKS = 64;

export default function GulirBar() {
  const jalurRef = useRef<HTMLDivElement>(null);
  const ibuRef = useRef<HTMLDivElement>(null);
  /* Keputusan pointer:fine diambil SETELAH mount (bukan pas render):
     server gak punya matchMedia — render null dulu di dua-duany
     sisi, baru muncul di client. Tanpa ini: hydration mismatch
     (server null vs client div). */
  const [halus, setHalus] = useState(false);

  useEffect(() => {
    setHalus(window.matchMedia("(pointer: fine)").matches);
  }, []);

  useEffect(() => {
    /* Mobile/touch: scrollbar native overlay OS ny udah pas — jangan
       dipaksa pake visual desktop. (Komponen ny render null.) */
    if (!halus) return;

    const jalur = jalurRef.current;
    const ibuJari = ibuRef.current;
    if (!jalur || !ibuJari) return;
    const jalurEl: HTMLDivElement = jalur;
    const ibuEl: HTMLDivElement = ibuJari;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let jalan = false;
    let nyalaSampai = 0;
    let yTerakhir = window.scrollY;
    let vy = 0; /* px per frame (dihalusin) */
    let ekor = 0; /* panjang ekor sekarang (px) */
    let ekorKecepatan = 0; /* spring velocity */
    let sembunyi = false;
    let hidup = true;
    let hitungKe = 0;

    function ukurDasar() {
      const dok = document.documentElement;
      const bisa = dok.scrollHeight > dok.clientHeight + 8;
      const terkunci = document.body.style.overflow === "hidden";
      sembunyi = !bisa || terkunci;
      jalurEl.style.opacity = sembunyi ? "0" : "1";
    }

    function bentuk() {
      const dok = document.documentElement;
      const tinggiPandang = dok.clientHeight;
      const tinggiPenuh = dok.scrollHeight;
      const maksGulir = Math.max(1, tinggiPenuh - tinggiPandang);
      const y = window.scrollY;

      const dasarIbu = Math.max(TINGGI_MIN_THUMB, (tinggiPandang / tinggiPenuh) * tinggiPandang);
      const ruangGerak = Math.max(1, tinggiPandang - dasarIbu - 6);
      const puncak = 3 + (y / maksGulir) * ruangGerak;

      /* Ekor nurun ke arah GERAKAN yang BARU LEWAT (trailing):
         scroll ke bawah (vy>0) = ekor ke ATAS; ke atas = ke BAWAH. */
      const total = dasarIbu + (reduce ? 0 : ekor);
      const ekorAtas = vy > 0.4;
      const top = ekorAtas ? puncak - ekor : puncak;

      ibuEl.style.height = total + "px";
      ibuEl.style.transform = "translateY(" + Math.max(3, top) + "px)";
    }

    function putar() {
      if (!hidup) return;
      raf = requestAnimationFrame(putar);

      const y = window.scrollY;
      const beda = y - yTerakhir;
      yTerakhir = y;

      /* velocity dihalusin (EMA) biar ekor gak gemetar. */
      vy = vy * 0.72 + beda * 0.28;

      if (Math.abs(beda) > 0.5) nyalaSampai = performance.now() + 400;

      /* Spring ekor: target = panjang sesuai kecepatan sekarang. */
      if (!reduce) {
        const target = Math.min(EKOR_MAKS, Math.abs(vy) * 3.4);
        const gaya = (target - ekor) * 0.16;
        ekorKecepatan = (ekorKecepatan + gaya) * 0.82; /* underdamped: boing kecil pas berhenti */
        ekor += ekorKecepatan;
        if (ekor < 0.5 && target < 0.5) {
          ekor = 0;
          ekorKecepatan = 0;
        }
      }

      bentuk();

      /* hemat: pas gak ada gerakan + ekor udah tenang, loop berhenti;
         nyala lagi dari event scroll/resize. */
      if (performance.now() > nyalaSampai && ekor < 0.5 && Math.abs(vy) < 0.1) {
        jalan = false;
        vy = 0;
        cancelAnimationFrame(raf);
        return;
      }

      /* cek "masih scrollable?" cukup 2x/detik (murah). */
      if (++hitungKe % 120 === 0) ukurDasar();
    }

    function bangun() {
      ukurDasar();
      yTerakhir = window.scrollY;
      if (!jalan && !sembunyi) {
        jalan = true;
        nyalaSampai = performance.now() + 400;
        raf = requestAnimationFrame(putar);
      } else if (jalan) {
        nyalaSampai = performance.now() + 400;
      }
    }

    const onScroll = () => bangun();
    const onResize = () => bangun();
    /* overlay (panel/viewer) buka-tutup: body overflow ganti — cek
     ulang keadaan scrollable. */
    const onMulai = () => setTimeout(ukurDasar, 60);
    const io = new MutationObserver(onMulai);
    io.observe(document.body, { attributes: true, attributeFilter: ["style"] });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    bangun();

    return () => {
      hidup = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [halus]);

  /* server + render pertama: null (amannya hydration); muncul cuma
     pas client beneran pointer:fine. */
  if (!halus) return null;

  return (
    <div ref={jalurRef} className="gulir-bar" aria-hidden="true">
      <div ref={ibuRef} className="gulir-ibu" />
    </div>
  );
}
