import { NextResponse } from "next/server";
import { sfile } from "@/lib/sfile-wa.js";

/* Cari file di sfile.co. Semua jalanin server-side (browser gak bisa
   nyentuh sfile.co langsung: CORS + butuh sesi http2 khusus). */

export const runtime = "nodejs";

export async function POST(req: Request) {
  let badan: { q?: unknown; jumlah?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  const q = String(badan.q ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ galat: "Minimal 2 karakter." }, { status: 400 });

  const jumlah = Math.max(1, Math.min(Number(badan.jumlah) || 10, 50));

  try {
    const res = await sfile.search(q, { max: jumlah });
    const daftar = (res.results || []).slice(0, jumlah).map((r: any) => ({
      nama: String(r.name || r.short || "file"),
      url: String(r.url || ""),
      ukuran: r.sizeLabel || null,
      waktu: r.uploadedLabel || null,
    }));
    if (!daftar.length) {
      return NextResponse.json({ galat: 'Gak ada hasil buat "' + q + '". Coba kata kunci lain.' }, { status: 404 });
    }
    return NextResponse.json({ daftar, total: daftar.length });
  } catch (e: any) {
    return NextResponse.json(
      { galat: e?.message ? "sfile: " + e.message : "Gagal nyari di sfile. Coba lagi bentar." },
      { status: 502 }
    );
  }
}
