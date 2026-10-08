import { db } from "@/lib/db";

/* Notifikasi aktivitas (r28, diperluas r29): helper server-side buat
   nyatet LIKE / FOLLOW / MENTION / MENTION_KOMENTAR.

   Prinsip:
   - Penerima = pemilik konten. Aksi ke diri sendiri = gak ada
     notifikasi (like post sendiri, mention diri sendiri).
   - ANTI-SPAM: satu pasangan (penerima, aktor, jenis, post) = SATU
     baris notifikasi. Like -> unlike -> like lagi = notifikasi yang
     sama di-revive (waktu baru + belum-dibaca), BUKAN baris baru.
     (Dedupe di kode, bukan unique constraint: SQLite ngeanggap NULL
     beda-beda, jadi index unique gak bisa nge-dedupe FOLLOW yang
     mediaId ny null.)
   - Unfollow = notifikasi follow ny kehapus (keadaan jujur).
   - Best-effort: kegagalan nyulis notifikasi GAK BOLEH gagalin aksi
     utama (like/follow/upload tetep sukses).
   - aktorNama di-snapshot pas create: akun aktor kehapus (SetNull)
     -> nama tetep kebaca, link profil ny gak kebentuk (aktor null). */

export type JenisNotifikasi = "LIKE" | "FOLLOW" | "MENTION" | "MENTION_KOMENTAR";

export async function catatNotifikasi(
  penerimaId: string,
  aktorId: string,
  jenis: JenisNotifikasi,
  mediaId?: string | null,
  /* r29: konteks mention di komentar — pas komentar ny kehapus
     (SetNull), mediaId ny tetep nyimpen post ny (klik tetep nyampe).
     Dipake juga buat dedupe: mention di komentar BEDA = notifikasi
     BEDA (bukan di-revive jadi satu). */
  komentarId?: string | null
): Promise<void> {
  if (!penerimaId || penerimaId === aktorId) return;
  try {
    const ada = await db.notifikasi.findFirst({
      where: { penerimaId, aktorId, jenis, mediaId: mediaId ?? null, komentarId: komentarId ?? null },
      select: { id: true },
    });
    if (ada) {
      await db.notifikasi.update({ where: { id: ada.id }, data: { waktu: new Date(), dibaca: null } });
      return;
    }
    const aktor = await db.pengguna.findUnique({ where: { id: aktorId }, select: { nama: true } });
    await db.notifikasi.create({
      data: {
        penerimaId,
        aktorId,
        aktorNama: aktor?.nama ?? "?",
        jenis,
        ...(mediaId ? { mediaId } : {}),
        ...(komentarId ? { komentarId } : {}),
      },
    });
  } catch {
    /* diam: aksi utama lebih penting */
  }
}

/* Unfollow: buang notifikasi follow dari aktor itu (keadaan jujur —
   gak ada "A mulai mengikuti kamu" padahal udah gak ngikut). */
export async function hapusNotifikasiIkut(pengikutId: string, diikutiId: string): Promise<void> {
  if (!pengikutId || !diikutiId) return;
  try {
    await db.notifikasi.deleteMany({
      where: { penerimaId: diikutiId, aktorId: pengikutId, jenis: "FOLLOW" },
    });
  } catch {}
}
