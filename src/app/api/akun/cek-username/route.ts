import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/* /api/akun/cek-username?u= (r27 / P2-9): ketersediaan username buat
   validator live di form daftar. Murah (satu lookup, dibatesin sama
   debounce client 350ms — bukan tiap keypress). */

export const dynamic = "force-dynamic";

function normalisasiUsername(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .slice(0, 20);
}

function usernameValid(u: string): boolean {
  return /^[a-z0-9]([a-z0-9_.]{1,18})[a-z0-9]$/.test(u) || /^[a-z0-9]{3,20}$/.test(u);
}

export async function GET(req: Request) {
  const u = normalisasiUsername(new URL(req.url).searchParams.get("u"));
  if (!u) return NextResponse.json({ status: "invalid", pesan: "Isi username dulu." });

  if (!usernameValid(u)) {
    return NextResponse.json({
      status: "invalid",
      pesan: "3-20 karakter: huruf kecil, angka, titik, underscore.",
    });
  }

  const ada = await db.pengguna.findUnique({ where: { username: u }, select: { id: true } });
  return NextResponse.json({ status: ada ? "dipakai" : "tersedia" });
}
