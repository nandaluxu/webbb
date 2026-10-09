import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";

export const runtime = "nodejs";

/* Dashboard laporan (khusus owner):
   - GET: daftar semua laporan, terbaru duluan, lengkap sama snapshot
     konten ny, pelapor ny, pemilik konten ny, waktu + tempat ny.
   - DELETE: dua aksi.
     aksi "selesai" -> tandain beres (row laporan ny dihapus, konten
     ny dibiarkan).
     aksi "hapus"  -> konten ny yang dihapus (pesan chat / komentar /
     post) + semua laporan ny ikut kehapus.
   User biasa gak pernah nyampe sini (403 dari pengecekan sesi). */

async function bersihkanLaporanKonten(jenis: string, targetId: string | null) {
  if (!targetId) return false;
  if (jenis === "pesan") {
    const r = await db.pesan.deleteMany({ where: { id: targetId } });
    return r.count > 0;
  }
  if (jenis === "komentar") {
    const r = await db.komentar.deleteMany({ where: { id: targetId } });
    return r.count > 0;
  }
  if (jenis === "media") {
    const r = await db.media.deleteMany({ where: { id: targetId } });
    return r.count > 0;
  }
  /* AI: gak ada konten di server buat dihapus. */
  return false;
}

export async function GET() {
  const sesi = await bacaSesi();
  if (!sesi || !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Khusus owner." }, { status: 403 });
  }
  const daftar = await db.laporan.findMany({
    orderBy: { waktu: "desc" },
    take: 200,
    include: { pelapor: { select: { id: true, nama: true, pfp: true, verified: true } } },
  });
  return NextResponse.json({
    daftar: daftar.map((l) => ({
      id: l.id,
      jenis: l.jenis,
      targetId: l.targetId,
      tempat: l.targetKet,
      konteks: l.konteks,
      pemilikNama: l.pemilikNama,
      waktu: l.waktu.toISOString(),
      pelapor: l.pelapor,
    })),
  });
}

export async function DELETE(req: NextRequest) {
  const sesi = await bacaSesi();
  if (!sesi || !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Khusus owner." }, { status: 403 });
  }

  let badan: { laporanId?: unknown; aksi?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }
  const laporanId = String(badan.laporanId ?? "");
  const aksi = String(badan.aksi ?? "");
  if (!laporanId || (aksi !== "selesai" && aksi !== "hapus")) {
    return NextResponse.json({ galat: "Permintaan ny gak lengkap." }, { status: 400 });
  }

  const laporan = await db.laporan.findUnique({ where: { id: laporanId } });
  if (!laporan) return NextResponse.json({ galat: "Laporan ny gak ketemu." }, { status: 404 });

  if (aksi === "hapus") {
    await bersihkanLaporanKonten(laporan.jenis, laporan.targetId);
    /* Kalau konten ny pesan chat, kabarin client lain juga. */
    if (laporan.jenis === "pesan" && laporan.targetId) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 400);
        await fetch("http://localhost:3004/hapus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: laporan.targetId }),
          signal: ctrl.signal,
        }).catch(() => {});
        clearTimeout(timer);
      } catch {
        /* diam aja */
      }
    }
  }

  await db.laporan.delete({ where: { id: laporanId } });
  return NextResponse.json({ ok: true });
}
