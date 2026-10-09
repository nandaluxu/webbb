import { db } from "@/lib/db";

/* lib/tabel-permainan (fix27): tabel Permainan itu pendatang baru
   (fix26). DB lama — hasil unzip webb_2 dkk yang cuma di-restart
   pakai kode baru tanpa `prisma db push` — belum punya tabel ny,
   dan arena games di papan skor langsung 502 (keliatan kayak
   leaderboard ny ilang).

   Jadi tabel ny dibikin SENDIRI pas pertama kali dibutuhkan:
   idempotent (IF NOT EXISTS), jalan sekali per proses (dijanjikan,
   bukan di-race), dan bentuk ny persis output prisma db push —
   biar push berikutny gak ngeliat structure drift. Dipanggil dari
   /api/leaderboard (baca) + /api/fitur/game (catat). */

const BIKIN_TABEL = `CREATE TABLE IF NOT EXISTS "Permainan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "pemainNama" TEXT NOT NULL DEFAULT 'Tamu',
    "game" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT '',
    "hasil" TEXT NOT NULL DEFAULT '',
    "skor" INTEGER NOT NULL DEFAULT 0,
    "langkah" INTEGER NOT NULL DEFAULT 0,
    "ubin" INTEGER NOT NULL DEFAULT 0,
    "catatan" TEXT NOT NULL DEFAULT '',
    "waktu" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Permainan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Pengguna" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)`;

/* Sekali per proses: caller pertama yang nyalain, sisany nunggu
   janji yang sama. Gagal → janji dibuang, biar percobaan berikutny
   (misal db ny lagi kunci) punya kesempatan lagi. */
let janji: Promise<void> | undefined;

async function bikin() {
  await db.$executeRawUnsafe(BIKIN_TABEL);
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Permainan_waktu_idx" ON "Permainan"("waktu")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Permainan_game_idx" ON "Permainan"("game")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Permainan_pemainNama_idx" ON "Permainan"("pemainNama")');
}

export function pastiinTabelPermainan(): Promise<void> {
  if (!janji) {
    janji = bikin().catch((e) => {
      janji = undefined;
      throw e;
    });
  }
  return janji;
}
