import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner, dekSandiAsli } from "@/lib/autentikasi";

/* Intip sandi user: khusus owner, buat dashboard. Sandi disimpen
   terenkripsi, dibuka cuma pas diminta. Gak pernah dikirim ke
   tampilan user biasa (route ny nolak kalau bukan owner). */

export async function GET(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi || !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Khusus owner." }, { status: 403 });
  }

  const userId = new URL(req.url).searchParams.get("userId") || "";
  const user = await db.pengguna.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ galat: "User ny gak ketemu." }, { status: 404 });

  if (!user.sandi) {
    return NextResponse.json({ sandi: null, ket: "Akun anonim, gak pakai sandi." });
  }
  const buka = await dekSandiAsli(user.sandiAsli);
  return NextResponse.json({
    sandi: buka,
    ket: buka ? null : "Sandi ny belum kebaca (akun ini dibuat sebelum fitur ini). Minta user ny login sekali lagi, nanti kebaca.",
  });
}
