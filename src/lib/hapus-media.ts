/* Hapus media + file fisikny (unggahan + pratinjau). Dipake sama
   route hapus post sendiri sama dashboard admin. */

import { unlink } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { AKAR, DIR_PRATINJAU } from "@/lib/media-server";

export async function hapusMedia(id: string): Promise<boolean> {
  const media = await db.media.findUnique({ where: { id } });
  if (!media) return false;

  if (media.dari === "unggah") {
    await unlink(path.join(AKAR, media.pathAsli)).catch(() => {});
  }
  await unlink(path.join(DIR_PRATINJAU, media.id + ".webp")).catch(() => {});
  await db.media.delete({ where: { id: media.id } });
  return true;
}

/* Hapus user + semua jejak ny: media yang dia unggah (file + baris),
   komentar, suka, sesi. Media hasil scan cuma lepas pemilikny. */
export async function hapusUser(userId: string): Promise<boolean> {
  const user = await db.pengguna.findUnique({ where: { id: userId } });
  if (!user) return false;

  const milik = await db.media.findMany({ where: { userId }, select: { id: true, dari: true, pathAsli: true } });
  for (const m of milik) {
    if (m.dari === "unggah") {
      await unlink(path.join(AKAR, m.pathAsli)).catch(() => {});
    }
    await unlink(path.join(DIR_PRATINJAU, m.id + ".webp")).catch(() => {});
  }
  await db.media.deleteMany({ where: { userId, dari: "unggah" } });
  await db.media.updateMany({ where: { userId }, data: { userId: null } });
  await db.pengguna.delete({ where: { id: userId } });
  return true;
}