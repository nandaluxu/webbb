import { db } from "@/lib/db";
import { catatNotifikasi } from "@/lib/notifikasi";

/* Helper mention @username (r29): SATU sumber buat nge-parse token
   @username dari teks (caption post / komentar) — sebelumnya pola
   regex ny duplikat antara galeri route + render client (BioSebut).
   Server ny pake ini buat resolve mention ke USER ID asli.

   Pola: sama kayak BioSebut di client (biar teks yang ke-render
   sebagai link = teks yang ke-resolve jadi relasi):
   - @ di awal teks atau setelah spasi (bukan email@domain)
   - username: a-z0-9 mulai + 2-19 karakter [a-z0-9_.] + akhir a-z0-9
   - dibatesin lookahead (akhir teks / spasi / tanda baca umum)
   - case-insensitive (username disimpen lowercase) */

export const POLA_SEBUT = /(^|\s)@([a-z0-9][a-z0-9_.]{1,18}[a-z0-9])(?=$|[\s.,!?])/gi;

/* Semua token @username unik (lowercase) di sebuah teks. */
export function tokenSebut(teks: string): Set<string> {
  const token = new Set<string>();
  let m: RegExpExecArray | null;
  const pola = new RegExp(POLA_SEBUT.source, "gi");
  while ((m = pola.exec(teks))) token.add(m[2].toLowerCase());
  return token;
}

/* Sebutan di komentar (r29): resolve token -> relasi KomentarSebut +
   notifikasi MENTION_KOMENTAR. ATURAN NY SAMA kayak caption post
   (galeri route):
   - resolve di SERVER (userId dari database, gak percaya client)
   - user gak ada -> tetep teks biasa (gak error)
   - nyebut diri sendiri -> teks doang (gak ada relasi/notifikasi)
   - unique(komentarId,userId) = gak dobel relasi per komentar
   - best-effort: kegagalan mention GAK BOLEH gagalin komentar ny
   - komentar ny udah kebuat duluan (id ny harus ada) */
export async function sebutkanKomentar(komentarId: string, mediaId: string, teks: string, pengirimId: string): Promise<void> {
  try {
    for (const u of tokenSebut(teks)) {
      const target = await db.pengguna.findUnique({ where: { username: u }, select: { id: true } });
      if (!target) continue;
      if (target.id === pengirimId) continue;
      try {
        await db.komentarSebut.create({ data: { komentarId, userId: target.id } });
        void catatNotifikasi(target.id, pengirimId, "MENTION_KOMENTAR", mediaId, komentarId);
      } catch {
        /* Bentrok unique (P2002) = udah ke-sebut — idempoten. */
      }
    }
  } catch {}
}
