import { NextResponse } from "next/server";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";
import { hapusMedia } from "@/lib/hapus-media";

/* Hapus post dari dashboard admin. */

export async function DELETE(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi || !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Khusus owner." }, { status: 403 });
  }

  let badan: { mediaId?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }
  const mediaId = String(badan.mediaId ?? "");
  if (!mediaId) return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 400 });

  const jadi = await hapusMedia(mediaId);
  if (!jadi) return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
