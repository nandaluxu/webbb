"use client";

/* Latar + kursor per gaya UI (dataset.ui di <html>):
   - Klasik   : butir tinta hanyut + kursor tinta (Noise + Kursor)
   - Swiss Zen: kisi tanda-plus yang "bangun" dekat kursor + kursor
                tanda-potong magnet
   - Japandi  : kabut washi + serat kertas + kursor batu lumut
   - Hanami   : kelopak sakura berjatuhan + kursor kelopak, klik = mekar
   Ganti gaya di Pengaturan (event ui:ubah) langsung ganti pasangan
   efeknya tanpa reload. Snapshot server = null supaya gak ada kedip
   efek klasik pas pertama buka di gaya lain. */

import { useSyncExternalStore } from "react";
import Noise from "@/components/efek/Noise";
import Kursor from "@/components/efek/Kursor";
import LatarSwiss from "@/components/efek/LatarSwiss";
import KursorSwiss from "@/components/efek/KursorSwiss";
import LatarJapandi from "@/components/efek/LatarJapandi";
import KursorJapandi from "@/components/efek/KursorJapandi";
import LatarHanami from "@/components/efek/LatarHanami";
import KursorHanami from "@/components/efek/KursorHanami";

type Gaya = "klasik" | "swiss" | "japandi" | "hanami";

function langganan(f: () => void) {
  window.addEventListener("ui:ubah", f);
  return () => window.removeEventListener("ui:ubah", f);
}

function baca(): Gaya {
  const u = document.documentElement.dataset.ui;
  return u === "swiss" || u === "japandi" || u === "hanami" ? u : "klasik";
}

export default function LatarKursor() {
  const ui = useSyncExternalStore<Gaya | null>(langganan, baca, () => null);
  if (ui === "swiss")
    return (
      <>
        <LatarSwiss />
        <KursorSwiss />
      </>
    );
  if (ui === "japandi")
    return (
      <>
        <LatarJapandi />
        <KursorJapandi />
      </>
    );
  if (ui === "hanami")
    return (
      <>
        <LatarHanami />
        <KursorHanami />
      </>
    );
  if (ui === "klasik")
    return (
      <>
        <Noise />
        <Kursor />
      </>
    );
  return null;
}
