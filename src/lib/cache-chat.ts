"use client";

/* Cache chat di browser (r28): biar buka chat gak selalu kerasa
   lambat — render cache dulu, revalidate di belakang, merge + dedupe,
   update cache. Server TETEP sumber kebenaran; cache cuma tampilan
   awal.

   - localStorage (cuma 20-100 pesan terakhir per user — kecil, gak
     perlu IndexedDB buat segini; seluruh history GAK pernah dicache).
   - Isolasi per PENGGUNA (key = nama login): ganti akun = cache beda,
     akun baru gak lihat cache akun lama. Riwayat ny sendiri global,
     tapi cache ny (termasuk sisa paginasi + kursor) milik per-user.
   - Pesan optimistic/pending GAK ikut dicache (status kirim/gagal
     cuma hidup di sesi).
   - MAX 100 pesan resmi (20 awal + hasil scroll-up), biar localStorage
     gak gebek. */

export type PesanCache = {
  id: string;
  nama: string;
  teks: string;
  waktu: string;
  balasan: { id: string; nama: string; teks: string; waktu: string } | null;
};

export type CacheChat = {
  ruang: "global";
  pesan: PesanCache[];
  sebelum: { waktu: string; id: string } | null;
  lagi: boolean;
  simpan: number;
};

const MAKS_PESAN = 100;

function kunci(nama: string): string {
  return "neyhra:chat:global:" + nama;
}

export function bacaCacheChat(nama: string): CacheChat | null {
  if (typeof window === "undefined" || !nama) return null;
  try {
    const mentah = window.localStorage.getItem(kunci(nama));
    if (!mentah) return null;
    const c = JSON.parse(mentah) as CacheChat;
    if (c.ruang !== "global" || !Array.isArray(c.pesan)) return null;
    return c;
  } catch {
    return null;
  }
}

export function simpanCacheChat(
  nama: string,
  pesan: PesanCache[],
  sebelum: { waktu: string; id: string } | null,
  lagi: boolean
): void {
  if (typeof window === "undefined" || !nama) return;
  try {
    const isi: CacheChat = {
      ruang: "global",
      pesan: pesan.slice(-MAKS_PESAN),
      sebelum,
      lagi,
      simpan: Date.now(),
    };
    window.localStorage.setItem(kunci(nama), JSON.stringify(isi));
  } catch {
    /* penyimpanan penuh/diblokir: biarin, chat tetep jalan tanpa cache */
  }
}
