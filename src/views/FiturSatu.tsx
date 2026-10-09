"use client";

/* Body halaman /fitur/<id>: resolusi entry dari KATALOG di sisi client
   (entry ny berisi fungsi, gak boleh nyebrang dari server component). */

import Link from "next/link";
import MesinUnduh from "@/views/MesinUnduh";
import ChatAI from "@/views/ChatAI";
import Obrolan from "@/views/Obrolan";
import SfileView from "@/views/SfileView";
import AMPremium from "@/views/AMPremium";
import AMPremiumV2 from "@/views/AMPremiumV2";
import EditGambar from "@/views/EditGambar";
import Akinator from "@/views/Akinator";
import TicTacToe from "@/views/TicTacToe";
import Game2048 from "@/views/Game2048";
import { cariFitur } from "@/lib/katalog";
import { Panah } from "@/components/ikon";

export default function FiturSatu({ id }: { id: string }) {
  const entry = cariFitur(id);

  if (!entry) {
    return (
      <section className="head">
        <h1 className="masuk on">Halamanny gak ketemu</h1>
        <p className="lede">Alamat ny udah gw ganti atau salah ketik. Balik aja ke menu utama.</p>
        <p style={{ marginTop: 24 }}>
          <Link className="btn" href="/fitur">
            Lihat semua fitur
            <Panah />
          </Link>
        </p>
      </section>
    );
  }

  if (entry.mode === "unduh" || entry.mode === "cari") return <MesinUnduh entry={entry} />;
  if (entry.mode === "ai") return <ChatAI />;
  if (entry.mode === "obrolan") return <Obrolan />;
  if (entry.mode === "am") return <AMPremium />;
  if (entry.mode === "amv2") return <AMPremiumV2 />;
  if (entry.mode === "editgambar") return <EditGambar />;
  if (entry.mode === "akinator") return <Akinator />;
  if (entry.mode === "tictactoe") return <TicTacToe />;
  if (entry.mode === "game2048") return <Game2048 />;
  return <SfileView entry={entry} />;
}
