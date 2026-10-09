import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";
import { hapusMedia } from "@/lib/hapus-media";

/* Hapus post galeri: pemilik post sendiri, atau owner. */

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  const media = await db.media.findUnique({ where: { id } });
  if (!media) return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 404 });

  const boleh = media.userId === sesi.id || apaOwner(sesi);
  if (!boleh) return NextResponse.json({ galat: "Cuma pemilik post ini yang bisa hapus." }, { status: 403 });

  const jadi = await hapusMedia(id);
  if (!jadi) return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
