"use client";

/* Store sesi pengguna global (client). Sama pola kayak tema.js:
   singleton modul + langganan event, jadi semua view bisa baca
   status login + buka modal login dari mana aja tanpa prop drilling. */

import { useSyncExternalStore } from "react";

export type PenguseSesi = {
  id: string;
  nama: string;
  username: string | null;
  jenis: string;
  pfp: string | null;
  verified: boolean;
  admin: boolean;
  bio: string | null;
};

type State = {
  siap: boolean;
  masuk: boolean;
  pengguna: PenguseSesi | null;
  pintuTerbuka: boolean;
  galat: string;
  /* fix31: kode galat terstruktur dari server ("belum-terdaftar",
     "sudah-terdaftar") — biar UI bisa ngasih tombol aksi langsung
     (pindah tab) tanpa nebak-nebak dari teksny. */
  galatKode: string;
  sibuk: boolean;
};

let state: State = { siap: false, masuk: false, pengguna: null, pintuTerbuka: false, galat: "", galatKode: "", sibuk: false };
const pendengar = new Set<() => void>();

/* P0-1: percobaan muatSesi terakhir gagal (jaringan)? Dipake sentinel
   jaringan buat mutusin perlu cek ulang atau gak. */
let gagalTerakhir = false;
let lagiMuat = false;

export function sesiGagal(): boolean {
  return gagalTerakhir;
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  pendengar.forEach((f) => f());
}

function langganan(f: () => void) {
  pendengar.add(f);
  return () => pendengar.delete(f);
}

const ambilSnapshot = () => state;

export function useSesi(): State {
  return useSyncExternalStore(langganan, ambilSnapshot, ambilSnapshot);
}

/* Load status sesi. Dipanggil di boot + pas jaringan balik (lewat
   lib/jaringan). In-flight guard: panggilan nyasar pas lagi jalan
   gak ngebut nge fetch kembar — cukup nunggu yang lagi jalan. */
export async function muatSesi() {
  if (lagiMuat) return;
  lagiMuat = true;
  try {
    const r = await fetch("/api/akun", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    set({ siap: true, masuk: !!d.masuk, pengguna: d.pengguna ?? null, galat: "" });
    gagalTerakhir = false;
  } catch {
    /* Gak nyambung = gagal JARINGAN (bukan "logged out"): state sesi
       sebelumny dipertahanin (jangan palsuin logout), cuma ditandain
       perlu dicek ulang pas jaringan balik. */
    set({ siap: true });
    gagalTerakhir = true;
  } finally {
    lagiMuat = false;
  }
}

/* Respons 401 dari aksi mana pun = cookie sesi udah mati di tengah
   jalan. Sinkronin state (biar gak nampak logged-in palsu) + buka
   pintu login biar user langsung bisa masuk lagi tanpa refresh. */
export function tolakSesi() {
  if (state.masuk) set({ masuk: false, pengguna: null });
  bukaPintu();
}

export function bukaPintu() {
  set({ pintuTerbuka: true, galat: "", galatKode: "" });
}

/* Bersihin galat (dipake pas ganti tab/login modal biar pesan
   dari alur sebelumny gak nyasar nempel). */
export function bersihkanGalat() {
  set({ galat: "", galatKode: "" });
}

export function tutupPintu() {
  set({ pintuTerbuka: false });
}

/* Masuk / daftar (fix31: kirim niat ny eksplisit lewat aksi).
   mode "anonim": nama doang (alur lama). mode "akun":
   - aksi "masuk": username + sandi — username gak ketemu = gagal
     (server nolak; bikin akun itu lewat aksi "daftar").
   - aksi "daftar": username + sandi + displayName opsional.
   Username boleh diketik pake "@" — dinormalisasi di server,
   database gak nyimpen @. */
export async function masuk(mode: "akun" | "anonim", identitas: string, sandi: string, displayName?: string, aksi?: "masuk" | "daftar"): Promise<boolean> {
  set({ sibuk: true, galat: "", galatKode: "" });
  try {
    const r = await fetch("/api/akun", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        mode === "anonim" ? { mode, nama: identitas } : { mode, aksi: aksi ?? "masuk", username: identitas, displayName, sandi }
      ),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      set({ sibuk: false, galat: d.galat || "Gagal masuk. Coba lagi.", galatKode: typeof d.kode === "string" ? d.kode : "" });
      return false;
    }
    set({ sibuk: false, masuk: true, pengguna: d.pengguna, pintuTerbuka: false, galat: "", galatKode: "" });
    return true;
  } catch {
    set({ sibuk: false, galat: "Gak bisa nyambung ke server. Cek koneksi ny.", galatKode: "" });
    return false;
  }
}

export async function keluar() {
  try {
    await fetch("/api/akun", { method: "DELETE" });
  } catch {}
  set({ masuk: false, pengguna: null });
}

/* Ganti bio profil sendiri (maks 200 karakter). */
export async function simpanBio(bio: string): Promise<boolean> {
  set({ sibuk: true, galat: "" });
  try {
    const r = await fetch("/api/akun", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bio }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      set({ sibuk: false, galat: d.galat || "Gagal nyimpen bio." });
      return false;
    }
    set({ sibuk: false, galat: "", pengguna: d.pengguna ?? state.pengguna });
    return true;
  } catch {
    set({ sibuk: false, galat: "Gak bisa nyambung ke server." });
    return false;
  }
}

/* Ganti PFP: upload file, server nyimpen versi 256px webp. */
export async function pasangPfp(file: File): Promise<boolean> {
  set({ sibuk: true, galat: "" });
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/akun/pfp", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      set({ sibuk: false, galat: d.galat || "Ganti foto profil gagal." });
      return false;
    }
    set({
      sibuk: false,
      galat: "",
      pengguna: state.pengguna ? { ...state.pengguna, pfp: d.pfp } : null,
    });
    return true;
  } catch {
    set({ sibuk: false, galat: "Gak bisa nyambung ke server." });
    return false;
  }
}

/* Edit profil sendiri (r29, menu "Edit profile"): username + nama
   tampilan. Validasi beneran ada di SERVER (bentuk + ketersediaan);
   balikan ny pengguna segar -> state sesi langsung sinkron (profil
   ganti tanpa reload). Gagal = galat ny kebaca modal. */
export async function simpanProfil(username: string, displayName: string): Promise<boolean> {
  set({ sibuk: true, galat: "" });
  try {
    const r = await fetch("/api/akun", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, displayName }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      set({ sibuk: false, galat: d.galat || "Gagal nyimpen profil." });
      return false;
    }
    set({ sibuk: false, galat: "", pengguna: d.pengguna ?? state.pengguna });
    return true;
  } catch {
    set({ sibuk: false, galat: "Gak bisa nyambung ke server." });
    return false;
  }
}
