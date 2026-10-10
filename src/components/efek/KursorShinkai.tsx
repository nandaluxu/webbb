"use client";

/* Kursor Shinkai: titik cahaya kecil (glint matahari) yang ngejar
   pointer dengan lenggang, halo ny membesar di atas link/tombol,
   dan tiap klik mecuar satu lingkaran cahaya yang membesar lalu
   pudar — kayak kilau pantulan matahari di kaca jendela kereta.
   Keglintiran ny dari warna token --matahari, jadi ikut terang/
   gelap otomatis. Cuma di perangkat pointer halus (desktop). */

import { useEffect } from "react";
import { gerakDikurangi, TEKS, KLIK } from "@/components/efek/warna";

export default function KursorShinkai() {
  useEffect(() => {
    const halus = window.matchMedia("(pointer: fine)").matches;
    const diam = gerakDikurangi();

    let akar: HTMLDivElement | null = null;
    if (halus) {
      akar = document.createElement("div");
      akar.className = "kursor-shinkai";
      akar.innerHTML = '<span class="kursor-shinkai-orb"></span>';
      document.body.appendChild(akar);
    }
    const orb = akar?.firstElementChild as HTMLElement | undefined;

    const mouse = { x: 0, y: 0 };
    const p = { x: 0, y: 0 };
    const k = diam ? 1 : 0.3;
    let ada = false;
    let hidup = true;

    function cahaya(x: number, y: number) {
      const el = document.createElement("span");
      el.className = "riak-shinkai";
      el.style.left = x + "px";
      el.style.top = y + "px";
      document.body.appendChild(el);
      el.addEventListener("animationend", () => el.remove());
      window.setTimeout(() => el.remove(), 1200);
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
      if (!diam) cahaya(e.clientX, e.clientY);
    }
    const onUp = () => akar?.classList.remove("tekan");
    const onKeluar = () => {
      ada = false;
      akar?.classList.remove("tampak");
    };

    function putar() {
      if (!hidup) return;
      if (ada && orb) {
        p.x += (mouse.x - p.x) * k;
        p.y += (mouse.y - p.y) * k;
        orb.style.transform = `translate3d(${p.x}px,${p.y}px,0) translate(-50%,-50%)`;
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
