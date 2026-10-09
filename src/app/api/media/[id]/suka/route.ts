import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { bolehLihat } from "@/lib/media-server";
import { catatNotifikasi } from "@/lib/notifikasi";

/* Toggle like. Harus login. Satu orang satu like per media.
   PRIVATE: cuma pemilik ny yang bisa (server-side).
   r28: like baru -> notifikasi ke pemilik post (anti-spam: like-unlike-
   like = SATU notifikasi yang di-revive, bukan numpuk — lihat
   lib/notifikasi). Unlike gak nghapus notifikasi (aktivitas tetep
   pernah kejadian). */

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesi = await bacaSesi();
  if (!sesi) {
    return NextResponse.json({ galat: "Login dulu buat nyukain post." }, { status: 401 });
  }
  const media = await db.media.findUnique({ where: { id } });
  if (!media) return NextResponse.json({ galat: "Media gak ketemu." }, { status: 404 });
  if (!bolehLihat(media, sesi.id)) {
    return NextResponse.json({ galat: "Media gak ketemu." }, { status: 404 });
  }

  const ada = await db.suka.findUnique({ where: { mediaId_userId: { mediaId: id, userId: sesi.id } } });
  if (ada) {
    await db.suka.delete({ where: { id: ada.id } });
  } else {
    await db.suka.create({ data: { mediaId: id, userId: sesi.id } });
    /* Notifikasi ke pemilik post (post scan tanpa pemilik = gak ada
       yang nerima — dilewatin). Gagalan ny gak ganggu like ny. */
    if (media.userId) void catatNotifikasi(media.userId, sesi.id, "LIKE", media.id);
  }
  const jumlah = await db.suka.count({ where: { mediaId: id } });
  return NextResponse.json({ suka: jumlah, disukai: !ada });
}
