"use client";

/* Store chat pribadi (r32) — paling polos: cuma ngatur overlay ny
   buka/tutup + lawan bicara yang diminta. Sama pola kayak
   sesi-pengguna (singleton modul + langganan), biar komponen mana
   pun bisa buka chat tanpa prop drilling:
   - MenuSisa (menu samping): buka tanpa target -> daftar teman.
   - ProfilOrang (tombol Chat pribadi): buka langsung sama user itu.
   Target ny cuma "niatan" awal — komponen ChatPribadi yang pegang
   navigasi beneran (ganti lawan dari dalam panel gak lewat sini). */

import { useSyncExternalStore } from "react";

type State = {
  terbuka: boolean;
  target: string | null;
};

let state: State = { terbuka: false, target: null };
const pendengar = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  pendengar.forEach((f) => f());
}

function langganan(f: () => void) {
  pendengar.add(f);
  return () => pendengar.delete(f);
}

const ambilSnapshot = () => state;

export function useChatPribadi(): State {
  return useSyncExternalStore(langganan, ambilSnapshot, ambilSnapshot);
}

/* Buka panel chat. target = id user (kalau dari profil) atau null
   (buka daftar teman dulu). */
export function bukaChat(target?: string | null) {
  set({ terbuka: true, target: target ?? null });
}

export function tutupChat() {
  set({ terbuka: false, target: null });
}
