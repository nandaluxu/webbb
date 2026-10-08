import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";
import { susunPublik } from "@/lib/media-server";

/* Statistik dashboard admin: total user, post, komentar, user
   terverifikasi, laporan masuk, + aktivitas terbaru (post paling
   baru). */

export async function GET() {
  const sesi = await bacaSesi();
  if (!sesi || !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Khusus owner." }, { status: 403 });
  }

  const [user, media, komentar, verified, laporan, terbaru] = await Promise.all([
    db.pengguna.count(),
    db.media.count(),
    db.komentar.count(),
    db.pengguna.count({ where: { verified: true } }),
    db.laporan.count(),
    db.media.findMany({ orderBy: { waktu: "desc" }, take: 10 }),
  ]);

  return NextResponse.json({
    total: { user, media, komentar, verified, laporan },
    terbaru: await Promise.all(terbaru.map((m) => susunPublik(m, sesi.id))),
  });
}
