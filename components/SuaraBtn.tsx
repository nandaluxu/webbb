"use client";

/* Tombol suara di masthead: buka panel kecil berisi play/pause
   backsound, volume, sama saklar efek suara. Prefensi kesimpen +
   gak pernah autoplay: backsound cuma jalan kalau user nyuruh. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NadaIkon, TutupIkon } from "@/components/ikon";
import Saklar from "@/components/Saklar";
import { useSuara, setBack, setVolume, setSfx, bangunkanAudio, mainkanSfx } from "@/lib/suara";

export default function SuaraBtn() {
  const { back, volume, sfx } = useSuara();
  const [buka, setBuka] = useState(false);
  const bungkusRef = useRef<HTMLDivElement>(null);
  const tombolRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!buka) return;
    const onClick = (e: MouseEvent) => {
      if (!bungkusRef.current?.contains(e.target as Node)) setBuka(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        mainkanSfx("ui-dissolve");
        setBuka(false);
        tombolRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [buka]);

  /* Panel ny nempel ke ikon ny (right:0). Kalau ikon ny dekat tepi
     kiri layar (HP sempit), ujung kiri panel pada keluar viewport dan
     gak bisa digeser. Jepit ke dalam layar: geser sebesar yang
     dibutuhin aja (desktop gak pernah kgeser, tampilan ny tetap). */
  useLayoutEffect(() => {
    if (!buka) return;
    const panel = panelRef.current;
    if (!panel) return;
    const jepit = () => {
      panel.style.transform = "";
      const kotak = panel.getBoundingClientRect();
      const aman = 8;
      const geserKiri = aman - kotak.left;
      const geserKanan = innerWidth - aman - kotak.right;
      const geser = Math.min(geserKiri, geserKanan);
      if (geser > 0) panel.style.transform = "translateX(" + Math.round(geser) + "px)";
    };
    jepit();
    addEventListener("resize", jepit);
    return () => {
      removeEventListener("resize", jepit);
      panel.style.transform = "";
    };
  }, [buka]);

  const bisu = volume === 0;

  return (
    <div className="suara-wrap" ref={bungkusRef}>
      <button
        type="button"
        ref={tombolRef}
        className={"tema-toggle suara-btn" + (bisu ? " bisu" : "") + (back ? " nyala" : "")}
        aria-expanded={buka}
        aria-controls="panel-suara"
        aria-label={buka ? "Tutup pengaturan suara" : "Buka pengaturan suara"}
        data-sfx={buka ? "ui-dissolve" : "ui-menu"}
        onClick={() => {
          bangunkanAudio();
          setBuka((v) => !v);
        }}
      >
        <NadaIkon ukuran={20} />
      </button>

      {buka && (
        <div id="panel-suara" className="suara-panel" role="dialog" aria-label="Pengaturan suara" ref={panelRef}>
          <button type="button" className="sisa-tutup kecil" aria-label="Tutup" onClick={() => setBuka(false)}>
            <TutupIkon ukuran={13} />
          </button>
          <p className="suara-judul">Backsound</p>
          <div className="suara-baris">
            <button
              type="button"
              className={"btn kecil" + (back ? " primary" : "")}
              aria-pressed={back}
              onClick={() => {
                bangunkanAudio();
                setBack(!back);
              }}
            >
              {back ? "Pause" : "Putar"}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              aria-label="Volume"
              onChange={(e) => {
                bangunkanAudio();
                setVolume(Number(e.target.value) / 100);
              }}
              style={{ ["--vol" as string]: volume }}
            />
          </div>
          <div className="suara-baris">
            <span className="suara-label">Efek suara ringan</span>
            <Saklar
              label="Efek suara ringan"
              nyala={sfx}
              onUbah={(jadi) => {
                bangunkanAudio();
                setSfx(jadi);
                if (jadi) mainkanSfx("notification");
              }}
            />
          </div>
          <p className="suara-ket">Preferensi ny keinget, gak ada suara yang nyala sendiri.</p>
        </div>
      )}
    </div>
  );
}
