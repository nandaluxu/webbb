import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";

/* Ubah izin unduhan post (r30): cuma PEMILIK post (atau owner) yang
   boleh — keputusan ny di server, sama kayak privasi. Efek ny:
   ?unduh=1 di route file langsung ditolak (403) buat orang lain
   selama izin ny mati; pemilik tetep bisa unduh post ny sendiri. */

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  let badan: { boleh?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  if (typeof badan.boleh !== "boolean") {
    return NextResponse.json({ galat: "Nilai izin ny gak valid." }, { status: 400 });
  }

  const media = await db.media.findUnique({ where: { id } });
  if (!media) return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 404 });

  const boleh = media.userId === sesi.id || apaOwner(sesi);
  if (!boleh) {
    return NextResponse.json({ galat: "Cuma pemilik post ini yang bisa ganti izin unduhan." }, { status: 403 });
  }

  if (media.bolehUnduh === badan.boleh) {
    return NextResponse.json({ ok: true, bolehUnduh: badan.boleh });
  }

  await db.media.update({ where: { id }, data: { bolehUnduh: badan.boleh } });
  return NextResponse.json({ ok: true, bolehUnduh: badan.boleh });
}
