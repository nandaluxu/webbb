import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pastikanUsername } from "@/lib/migrasi-username";

/* Cari user buat halaman profil: GET ?q= (nama ATAU username
   mengandung, maks 12). Nyari manual di JS biar huruf besar/kecil
   gak ngaruh — "Bayu" ketemu juga pas nyari "bayu" / "BAYU", dan
   @bayu nyampe juga (r27: sapaan pakai username). */

export async function GET(req: Request) {
  /* pencarian bisa nyari username — pastiin backfill udah jalan. */
  await pastikanUsername().catch(() => {});
  const q = (new URL(req.url).searchParams.get("q") || "").replace(/\s+/g, " ").trim().replace(/^@+/, "");
  if (q.length < 1) return NextResponse.json({ daftar: [] });

  const kecil = q.toLowerCase();
  const semua = await db.pengguna.findMany({
    orderBy: { dibuat: "desc" },
    select: { id: true, nama: true, username: true, jenis: true, pfp: true, verified: true },
  });
  const daftar = semua
    .filter((u) => u.nama.toLowerCase().includes(kecil) || (u.username ?? "").includes(kecil))
    .slice(0, 12)
    .map((u) => ({ ...u, href: u.username ?? u.nama }));
  return NextResponse.json({ daftar });
}
