"use client";

/* Kursor Hanami: satu kelopak sakura kecil yang melayang ngikutin
   pointer — miring ke arah gerak, bergoyang tipis pas diam, mekar
   membesar di atas link/tombol. Klik/tap = satu bunga lima kelopak
   mekar lalu pudar. Kelopak cuma di perangkat pointer halus
   (desktop); bunga mekar jalan di sentuh juga. */

import { useEffect } from "react";
import { gerakDikurangi, TEKS, KLIK } from "@/components/efek/warna";

const KELOPAK =
  '<svg viewBox="-10 -12 20 24" aria-hidden="true"><path d="M0 10C-7 5-8-6-2.6-10Q0-8 2.6-10C8-6 7 5 0 10Z"/></svg>';
const MEKAR =
  '<svg viewBox="-24 -24 48 48" aria-hidden="true">' +
  [0, 72, 144, 216, 288]
    .map((d) => `<path d="M0 0C-9-5-10-16-3.5-21Q0-18 3.5-21C10-16 9-5 0 0Z" transform="rotate(${d})"/>`)
    .join("") +
  "</svg>";

export default function KursorHanami() {
  useEffect(() => {
    const halus = window.matchMedia("(pointer: fine)").matches;
    const diam = gerakDikurangi();

    let akar: HTMLDivElement | null = null;
    if (halus) {
      akar = document.createElement("div");
      akar.className = "kursor-hanami";
      akar.innerHTML = `<span class="kursor-hanami-kelopak">${KELOPAK}</span>`;
      document.body.appendChild(akar);
    }
    const kel = akar?.firstElementChild as HTMLElement | undefined;

    const mouse = { x: 0, y: 0 };
    const p = { x: 0, y: 0 };
    const k = diam ? 1 : 0.28;
    let miring = 0;
    let ada = false;
    let hidup = true;

    function mekar(x: number, y: number) {
      const el = document.createElement("span");
      el.className = "mekar-hanami";
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.innerHTML = MEKAR;
      document.body.appendChild(el);
      el.addEventListener("animationend", () => el.remove());
      window.setTimeout(() => el.remove(), 1500);
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch" || !akar) return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (!ada) {
        ada = true;
        p.x = mouse.x;
        p.y = mouse.y;
        akar.classList.add("tampak");
      }
    }
    function onOver(e: PointerEvent) {
      if (e.pointerType === "touch" || !akar) return;
      const t = e.target instanceof Element ? e.target : null;
      const teks = !!t?.closest(TEKS);
      akar.classList.toggle("teks", teks);
      akar.classList.toggle("aktif", !teks && !!t?.closest(KLIK));
    }
    function onDown(e: PointerEvent) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      akar?.classList.add("tekan");
      if (!diam) mekar(e.clientX, e.clientY);
    }
    const onUp = () => akar?.classList.remove("tekan");
    const onKeluar = () => {
      ada = false;
      akar?.classList.remove("tampak");
    };

    function putar(now: number) {
      if (!hidup) return;
      if (ada && kel) {
        const vx = (mouse.x - p.x) * k;
        p.x += vx;
        p.y += (mouse.y - p.y) * k;
        miring += (Math.max(-45, Math.min(45, vx * 2.2)) - miring) * 0.15;
        const ayun = diam ? 0 : Math.sin(now / 900) * 6;
        kel.style.transform = `translate3d(${p.x}px,${p.y}px,0) rotate(${miring + ayun}deg) translate(-50%,-50%)`;
      }
      requestAnimationFrame(putar);
    }
    if (akar) requestAnimationFrame(putar);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerover", onOver);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    document.documentElement.addEventListener("mouseleave", onKeluar);

    return () => {
      hidup = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("mouseleave", onKeluar);
      akar?.remove();
    };
  }, []);

  return null;
}
