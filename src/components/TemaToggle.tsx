"use client";

/* Tombol ganti tema: view transition lingkaran membesar dari tombol,
   cadangan fade kalau browser gak punya API ny, dan simpel kalau user
   minta gerakan dikurangi. Preferensi kesimpen + ikut setting OS
   selama user belum pernah milih manual.
   Ikon terang/gelap digerakin CSS lewat html[data-tema], jadi
   komponen ini gak butuh state React: cuku sinkron aria + favicon. */

import { useEffect, useRef } from "react";
import { Matahari, Bulan } from "@/components/ikon";

const KUNCI = "neyhra:tema";

function pasangFavicon() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  const ink = getComputedStyle(document.body).getPropertyValue("--ink").trim() || "#0A0A0A";
  const warna = encodeURIComponent(ink);
  link.href =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Crect x='1.25' y='1.25' width='11.5' height='11.5' fill='none' stroke='" +
    warna +
    "' stroke-width='1.5'/%3E%3Crect x='7.25' y='7.25' width='11.5' height='11.5' fill='" +
    warna +
    "'/%3E%3C/svg%3E";
}

function terapkan(t: "terang" | "gelap") {
  document.documentElement.dataset.tema = t;
  pasangFavicon();
  window.dispatchEvent(new CustomEvent("tema:ubah", { detail: { tema: t } }));
}

export default function TemaToggle() {
  const tombolRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    pasangFavicon();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const ikutOS = (e: MediaQueryListEvent) => {
      let tersimpan: string | null = null;
      try {
        tersimpan = window.localStorage.getItem(KUNCI);
      } catch {}
      if (tersimpan) return;
      terapkan(e.matches ? "gelap" : "terang");
    };
    mq.addEventListener("change", ikutOS);
    return () => mq.removeEventListener("change", ikutOS);
  }, []);

  function ganti() {
    const next = (document.documentElement.dataset.tema === "gelap" ? "terang" : "gelap") as "terang" | "gelap";
    try {
      window.localStorage.setItem(KUNCI, next);
    } catch {}
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (document.startViewTransition && !reduce) {
      let x = window.innerWidth - 60;
      let y = 60;
      const r = tombolRef.current?.getBoundingClientRect();
      if (r) {
        x = r.left + r.width / 2;
        y = r.top + r.height / 2;
      }
      const vt = document.startViewTransition(() => terapkan(next));
      vt.ready
        .then(() => {
          const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
          document.documentElement.animate(
            {
              clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
            },
            {
              duration: 550,
              easing: "cubic-bezier(.4,0,.2,1)",
              pseudoElement: "::view-transition-new(root)",
            }
          );
        })
        .catch(() => {});
    } else if (!reduce) {
      const html = document.documentElement;
      html.classList.add("tema-fade");
      terapkan(next);
      setTimeout(() => html.classList.remove("tema-fade"), 420);
    } else {
      terapkan(next);
    }
  }

  return (
    <button
      type="button"
      className="tema-toggle"
      id="tombolTema"
      ref={tombolRef}
      onClick={ganti}
      aria-label="Ganti tema terang atau gelap"
    >
      <Matahari ukuran={20} />
      <Bulan ukuran={20} />
    </button>
  );
}
