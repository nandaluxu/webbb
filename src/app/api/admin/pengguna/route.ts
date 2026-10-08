import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";
import { hapusUser } from "@/lib/hapus-media";

/* Kelola user dari dashboard admin.
   GET    -> daftar semua user + jumlah post ny
   DELETE -> hapus user (beserta media yang dia unggah) */

export async function GET() {
  const sesi = await bacaSesi();
  if (!sesi || !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Khusus owner." }, { status: 403 });
  }

  const semua = await db.pengguna.findMany({
    orderBy: { dibuat: "desc" },
    select: {
      id: true,
      nama: true,
      jenis: true,
      pfp: true,
      verified: true,
      admin: true,
      bio: true,
      dibuat: true,
      _count: { select: { media: true, komentar: true, suka: true } },
    },
  });
  return NextResponse.json({
    daftar: semua.map((u) => ({
      id: u.id,
      nama: u.nama,
      jenis: u.jenis,
      pfp: u.pfp,
      verified: u.verified,
      admin: u.admin,
      bio: u.bio,
      dibuat: u.dibuat.toISOString(),
      post: u._count.media,
      komentar: u._count.komentar,
      suka: u._count.suka,
    })),
  });
}

export async function DELETE(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi || !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Khusus owner." }, { status: 403 });
  }

  let badan: { userId?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }
  const userId = String(badan.userId ?? "");
  if (!userId || userId === sesi.id) {
    return NextResponse.json({ galat: "Gak bisa hapus akun sendiri dari sini." }, { status: 400 });
  }

  const jadi = await hapusUser(userId);
  if (!jadi) return NextResponse.json({ galat: "User ny gak ketemu." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
