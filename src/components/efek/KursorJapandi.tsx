"use client";

/* Kursor Japandi: "batu" (ishi) kecil berwarna lumut + halo lembut
   yang ngikutin dengan lag. Di atas link/tombol halonya mekar jadi
   cincin; di kolom teks batunya jadi garis tipis; pas klik muncul
   satu riak air (mouse maupun sentuh). Tanpa jejak, tanpa kedip.
   Batu + halo cuma di perangkat pointer halus (desktop). */

import { useEffect } from "react";
import { gerakDikurangi } from "@/components/efek/warna";

const TEKS =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="file"]),textarea,[contenteditable="true"]';
const KLIK =
  'a[href],button,[role="button"],select,summary,label,input[type="checkbox"],input[type="radio"],input[type="range"],.kartu,.kartu-media,[data-klik]';

export default function KursorJapandi() {
  useEffect(() => {
    const halus = window.matchMedia("(pointer: fine)").matches;
    const diam = gerakDikurangi();

    let akar: HTMLDivElement | null = null;
    if (halus) {
      akar = document.createElement("div");
      akar.className = "kursor-japandi";
      akar.innerHTML = '<span class="kursor-japandi-halo"></span><span class="kursor-japandi-batu"></span>';
      document.body.appendChild(akar);
    }
    const halo = akar?.children[0] as HTMLElement | undefined;
    const batu = akar?.children[1] as HTMLElement | undefined;

    const mouse = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    const h = { x: 0, y: 0 };
    const kb = diam ? 1 : 0.38;
    const kh = diam ? 1 : 0.14;
    let ada = false;
    let hidup = true;

    function riak(x: number, y: number) {
      const r = document.createElement("span");
      r.className = "riak-japandi";
      r.style.left = x + "px";
      r.style.top = y + "px";
      document.body.appendChild(r);
      r.addEventListener("animationend", () => r.remove());
      window.setTimeout(() => r.remove(), 1600);
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch" || !akar) return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (!ada) {
        ada = true;
        b.x = h.x = mouse.x;
        b.y = h.y = mouse.y;
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
      if (!diam) riak(e.clientX, e.clientY);
    }
    const onUp = () => akar?.classList.remove("tekan");
    const onKeluar = () => {
      ada = false;
      akar?.classList.remove("tampak");
    };

    function putar() {
      if (!hidup) return;
      if (ada && halo && batu) {
        b.x += (mouse.x - b.x) * kb;
        b.y += (mouse.y - b.y) * kb;
        h.x += (mouse.x - h.x) * kh;
        h.y += (mouse.y - h.y) * kh;
        batu.style.transform = `translate3d(${b.x}px,${b.y}px,0) translate(-50%,-50%)`;
        halo.style.transform = `translate3d(${h.x}px,${h.y}px,0) translate(-50%,-50%)`;
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
