/* Migrasi malas username (r27 / P2-9) — SERVER SIDE doang.
   Kenapa di sini: mesin pemilik ny jalanin mulai.sh (prisma db push
   ngebangun kolom baru), tapi data lama gak otomatis keisi. Tanpa
   backfill, user lama gak bisa login (login ny sekarang pakai
   username) + mention/profile handle ny kosong.
   Jalaninnya SEKALI per proses (single-flight promise), dipanggil
   dari bacaSesi (autentikasi) — route mana pun yang baca sesi udah
   kejamin migrasiny jalan duluan. Idempoten + aman dipanggil
   berbarengan (unique check per user; bentrok dapet suffix). */

import { db } from "@/lib/db";

let janji: Promise<void> | null = null;

function bersih(nama: string): string {
  return String(nama || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 20);
}

async function jalankan(): Promise<void> {
  const kurang = await db.pengguna.count({ where: { username: null } });
  if (!kurang) return;
  const semua = await db.pengguna.findMany({ where: { username: null }, select: { id: true, nama: true } });
  const udah = new Set(
    (await db.pengguna.findMany({ where: { NOT: { username: null } }, select: { username: true } }))
      .map((u) => u.username)
      .filter((u): u is string => !!u)
  );
  for (const u of semua) {
    let calon = bersih(u.nama);
    if (calon.length < 3) calon = "user-" + calon;
    if (udah.has(calon)) {
      let n = 1;
      let kandidat = calon;
      do {
        n++;
        kandidat = calon.slice(0, 20 - String(n).length - 1) + "-" + n;
      } while (udah.has(kandidat));
      calon = kandidat;
    }
    udah.add(calon);
    await db.pengguna.update({ where: { id: u.id }, data: { username: calon } }).catch(() => {});
  }
}

/* Panggil ini (tanpa await wajib — balikin promise yang sama). */
export function pastikanUsername(): Promise<void> {
  if (!janji) {
    janji = jalankan().catch(() => {
      /* gagal (misal kolom belum ada pas transisi) — reset biar
         bisa nyoba lagi proses berikutny, gak ngeblok login. */
      janji = null;
    });
  }
  return janji;
}
