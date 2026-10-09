import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";
import type { Visibilitas } from "@/lib/tipe-media";

/* Ubah privasi post (r27 / P1-6): cuma PEMILIK post (atau owner) yang
   boleh. Keputusan visibilitas tetep satu sumber di server — client
   cuma minta, gak ada yang bisa dipalsuin dari luar.
   Efek ny: galeri (hanya PUBLIC), profil orang lain (tanpa PRIVATE),
   akses file/pratinjau/komentar/suka PRIVATE tetep 404 buat orang
   lain — semua udah kecek di masing-masing route (r24), tinggal
   nilainy yang keganti di sini. */

const BOLEH: Visibilitas[] = ["PUBLIC", "PROFILE", "PRIVATE"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  let badan: { visibilitas?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  const baru = String(badan.visibilitas ?? "");
  if (!BOLEH.includes(baru as Visibilitas)) {
    return NextResponse.json({ galat: "Pilihan privasi ny gak dikenal." }, { status: 400 });
  }

  const media = await db.media.findUnique({ where: { id } });
  if (!media) return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 404 });

  const boleh = media.userId === sesi.id || apaOwner(sesi);
  if (!boleh) return NextResponse.json({ galat: "Cuma pemilik post ini yang bisa ganti privasi." }, { status: 403 });

  if (media.visibilitas === baru) {
    return NextResponse.json({ ok: true, visibilitas: baru });
  }

  await db.media.update({ where: { id }, data: { visibilitas: baru } });
  return NextResponse.json({ ok: true, visibilitas: baru });
}
