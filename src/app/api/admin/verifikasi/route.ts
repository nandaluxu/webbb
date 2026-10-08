import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";

/* Kasih / cabut badge terverifikasi (owner doang). Status ny
   nempel di data user, bukan tempelan di tampilan. */

export async function POST(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi || !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Khusus owner." }, { status: 403 });
  }

  let badan: { userId?: unknown; nilai?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }
  const userId = String(badan.userId ?? "");
  const nilai = badan.nilai === true;
  if (!userId) return NextResponse.json({ galat: "User ny gak ketemu." }, { status: 400 });

  const user = await db.pengguna.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ galat: "User ny gak ketemu." }, { status: 404 });
  if (user.admin || user.nama === "Neyhra") {
    return NextResponse.json({ galat: "Badge owner gak bisa dicabut." }, { status: 400 });
  }

  const baru = await db.pengguna.update({
    where: { id: userId },
    data: { verified: nilai },
    select: { id: true, nama: true, verified: true },
  });
  return NextResponse.json({ user: baru });
}
