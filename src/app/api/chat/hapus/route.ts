import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";

export const runtime = "nodejs";

/* Hapus pesan chat global. Permission: pengirim ny sendiri atau owner.
   Id pengirim gak nyimpen di pesan (schema lama cuma nyatet nama), jadi
   kecocokan ny nama + sesi login server-side: nama di sesi = nama di
   pesan = pemilik ny (nama unik di sistem akun).
   Abis kehapus: balasanny jadi yatim (balasanId ke-set null, kasih
   SetNull di schema) + di-broadcast ke semua yang online biar client
   laen langsung ngapus dari daftar ny (event "hapus" lewat mini-service,
   sama kayak "pesan" baru). */

export async function POST(req: NextRequest) {
  const sesi = await bacaSesi();
  if (!sesi) {
    return NextResponse.json({ galat: "Login dulu." }, { status: 401 });
  }

  let badan: { id?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }
  const id = String(badan.id ?? "");
  if (!id) return NextResponse.json({ galat: "Pesan ny gak ketemu." }, { status: 400 });

  const pesan = await db.pesan.findUnique({ where: { id } });
  if (!pesan) return NextResponse.json({ galat: "Pesan ny gak ketemu." }, { status: 404 });

  if (pesan.nama !== sesi.nama && !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Cuma yang ngirim (atau owner) yang bisa hapus pesan ni." }, { status: 403 });
  }

  await db.pesan.delete({ where: { id } });

  /* Umpan ke mini-service: broadcast "hapus" biar semua client yang
     online langsung ngapus pesan ny dari daftar (tanpa reload). Gagal
     broadcast gak boleh gagalin penghapusan. */
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 400);
    await fetch("http://localhost:3004/hapus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      signal: ctrl.signal,
    }).catch(() => {});
    clearTimeout(timer);
  } catch {
    /* diam aja */
  }

  return NextResponse.json({ ok: true, id });
}
