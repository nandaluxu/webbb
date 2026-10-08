/* Bio helper (r28): normalisasi + validasi bio, DIPAKE BARENGAN sama
   client (UX) + server (security) — logika ny SATU sumber biar gak
   bisa geser mesra antara dua tempat.

   - Newline \n dipertahanin beneran (dulu ny ke-collapse jadi spasi
     gara-gara replace(/\s+/g," ") — itu root cause bug "bio Enter ny
     ilang abis disimpan").
   - Maks 4 baris (dihitung dari newline eksplisit; baris kosong di
     ujung gak dihitung).
   - Maks 200 karakter (batas lama, tetep). */

export const MAKS_BARIS_BIO = 4;
export const MAKS_KARAKTER_BIO = 200;

export function rapikanBio(v: unknown): { bio: string | null; galat: string | null } {
  const mentah = String(v ?? "").replace(/\r\n?/g, "\n");
  const baris = mentah.split("\n").map((b) => b.replace(/\s+/g, " ").trim());
  while (baris.length && !baris[baris.length - 1]) baris.pop();
  if (baris.length > MAKS_BARIS_BIO) {
    return { bio: null, galat: "Bio maksimal " + MAKS_BARIS_BIO + " baris. Dikurangin dulu ya." };
  }
  const bio = baris.join("\n").slice(0, MAKS_KARAKTER_BIO).trim();
  return { bio: bio || null, galat: null };
}

/* Jumlah baris buat UX live (tampil di editor bio): nurut aturan yang
   sama kayak server, jadi gak ada kejutan "katanya 4 ternyata
   ditolak". */
export function hitungBarisBio(v: string): number {
  const baris = v.replace(/\r\n?/g, "\n").split("\n").map((b) => b.trim());
  while (baris.length && !baris[baris.length - 1]) baris.pop();
  return Math.max(1, baris.length);
}
