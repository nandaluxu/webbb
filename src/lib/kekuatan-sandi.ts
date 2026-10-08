/* Kekuatan sandi (r29): helper PURE (bisa dipake client + server)
   buat hitung level kekuatan sandi — SATU sumber, gak ada library
   eksternal (cukup pake karakteristik sederhana).

   ATURAN SANDI (server, /api/akun): minimal 4 karakter. Kapital /
   angka / simbol BUKAN syarat — cuma nambahin kekuatan.

   Level 1-5:
     1 Sangat lemah  2 Lemah  3 Sedang  4 Kuat  5 Sangat kuat

   Poin:
     - panjang: 4-6 => +1, 7-9 => +2, 10+ => +3
     - huruf kapital => +1
     - angka => +1
     - simbol umum => +1
   Total di-cap di 5.

   Contoh (dari requirement):
     "abcd"      1 -> Sangat lemah (valid, cuma lemah)
     "Abcd"      2 -> Lemah
     "Abcd1234"  4 -> Kuat  (7-9:+2, kapital +1, angka +1)
     "Abcd1234!" 5 -> Sangat kuat

   Simbol umum: karakter ASCII yang bukan huruf/angka/spasi —
   whitelist eksplisit biar jelas (konsisten ama whitelist lama). */

export const SIMBOL_SANDI = "!@#$%^&*()_+-=[]{};':\",./?~<>|\\";

export const MAKS_SANDI_PENDEK = 4;

export const LABEL_LEVEL = ["", "Sangat lemah", "Lemah", "Sedang", "Kuat", "Sangat kuat"] as const;

export function poinSandi(sandi: string): number {
  if (!sandi) return 0;
  let poin = 0;
  const n = sandi.length;
  if (n >= 10) poin += 3;
  else if (n >= 7) poin += 2;
  else if (n >= 4) poin += 1;
  if (/[A-Z]/.test(sandi)) poin += 1;
  if (/[0-9]/.test(sandi)) poin += 1;
  if ([...sandi].some((c) => SIMBOL_SANDI.includes(c))) poin += 1;
  return Math.min(5, poin);
}

/* Level 0 = gak valid (kurang dari 4 karakter). */
export function levelSandi(sandi: string): number {
  if (sandi.length < MAKS_SANDI_PENDEK) return 0;
  return poinSandi(sandi);
}

/* Valid minimum buat daftar (server ny yang mutusin akhirnya). */
export function sandiLolos(sandi: string): boolean {
  return sandi.length >= MAKS_SANDI_PENDEK;
}
