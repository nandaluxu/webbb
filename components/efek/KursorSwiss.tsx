"use client";

/* Kursor Swiss Zen: titik 5px + empat tanda potong (crop marks) ala
   cetak Swiss. Tanda potong itu "magnet": di atas link, tombol, atau
   kartu kecil, kotaknya melebar dan nempel ke tepi elemen; ditekan =
   menciut. Putih + mix-blend-mode:difference (lihat swiss-zen.css),
   jadi otomatis kebalik di tema terang maupun gelap. Desktop saja. */

import { useEffect } from "react";
import { gerakDikurangi } from "@/components/efek/warna";

const TARGET =
  'a[href],button,[role="button"],input:not([type="hidden"]),textarea,select,summary,.kartu,.kartu-media,[data-klik]';

export default function KursorSwiss() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const akar = document.createElement("div");
    akar.className = "kursor-swiss";
    akar.innerHTML =
      '<span class="kursor-swiss-titik"></span><span class="kursor-swiss-kotak"><i></i><i></i><i></i><i></i></span>';
    document.body.appendChild(akar);
    const titik = akar.children[0] as HTMLElement;
    const kotak = akar.children[1] as HTMLElement;

    const UKURAN = 30;
    const k = gerakDikurangi() ? 1 : 0.22;
    const mouse = { x: 0, y: 0 };
    const box = { x: 0, y: 0, w: UKURAN, h: UKURAN };
    let el: Element | null = null;
    let ada = false;
    let tekan = false;
    let hidup = true;

    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (!ada) {
        ada = true;
        box.x = mouse.x - UKURAN / 2;
        box.y = mouse.y - UKURAN / 2;
        akar.classList.add("tampak");
      }
      el = e.target instanceof Element ? e.target.closest(TARGET) : null;
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button === 0) tekan = true;
    };
    const onUp = () => {
      tekan = false;
    };
    const onKeluar = () => {
      ada = false;
      akar.classList.remove("tampak");
    };

    function putar() {
      if (!hidup) return;
      if (ada) {
        let tx = mouse.x - UKURAN / 2;
        let ty = mouse.y - UKURAN / 2;
        let tw = UKURAN;
        let th = UKURAN;
        if (el && el.isConnected) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.width <= 520 && r.height <= 360) {
            tx = r.left - 5;
            ty = r.top - 5;
            tw = r.width + 10;
            th = r.height + 10;
          }
        }
        if (tekan) {
          tx += 4;
          ty += 4;
          tw -= 8;
          th -= 8;
        }
        box.x += (tx - box.x) * k;
        box.y += (ty - box.y) * k;
        box.w += (tw - box.w) * k;
        box.h += (th - box.h) * k;
        titik.style.transform = `translate3d(${mouse.x}px,${mouse.y}px,0)`;
        kotak.style.transform = `translate3d(${box.x}px,${box.y}px,0)`;
        kotak.style.width = box.w + "px";
        kotak.style.height = box.h + "px";
      }
      requestAnimationFrame(putar);
    }
    requestAnimationFrame(putar);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    document.documentElement.addEventListener("mouseleave", onKeluar);

    return () => {
      hidup = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("mouseleave", onKeluar);
      akar.remove();
    };
  }, []);

  return null;
}
