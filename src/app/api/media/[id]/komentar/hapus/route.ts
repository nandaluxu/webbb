import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";

export const runtime = "nodejs";

/* Hapus komentar (beneran dari database, bukan cuma ngumpetin dari
   UI). Permission ngikut sistem yang udah ada: pemilik komentar ny,
   pemilik post ny, atau owner.
   Balasan ke komentar yang kehapus balik jadi komentar biasa
   (balasanId di-set null, sudah dari schema). Balikin daftar
   komentar terbaru biar UI langsung sinkron + jumlah komentar di
   kartu ikut ke-update. */

async function daftarKomentar(mediaId: string) {
  const baris = await db.komentar.findMany({
    where: { mediaId },
    orderBy: { waktu: "asc" },
    take: 100,
    include: {
      user: { select: { id: true, nama: true, pfp: true, verified: true } },
      balasan: { select: { id: true, user: { select: { nama: true } } } },
    },
  });
  return baris.map((k) => ({
    id: k.id,
    teks: k.teks,
    waktu: k.waktu.toISOString(),
    user: k.user,
    balasan: k.balasan ? { id: k.balasan.id, nama: k.balasan.user.nama } : null,
  }));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesi = await bacaSesi();
  if (!sesi) {
    return NextResponse.json({ galat: "Login dulu." }, { status: 401 });
  }

  let badan: { komentarId?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }
  const komentarId = String(badan.komentarId ?? "");
  if (!komentarId) return NextResponse.json({ galat: "Komentar ny gak ketemu." }, { status: 400 });

  const komentar = await db.komentar.findUnique({ where: { id: komentarId }, include: { media: { include: { user: true } } } });
  if (!komentar || komentar.mediaId !== id) {
    return NextResponse.json({ galat: "Komentar ny gak ketemu." }, { status: 404 });
  }

  const pemilikKomentar = komentar.userId === sesi.id;
  const pemilikPost = !!komentar.media.user && komentar.media.user.id === sesi.id;
  if (!pemilikKomentar && !pemilikPost && !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Cuma yang nulis, pemilik post, atau owner yang bisa hapus." }, { status: 403 });
  }

  await db.komentar.delete({ where: { id: komentarId } });
  return NextResponse.json({ daftar: await daftarKomentar(id) });
}
