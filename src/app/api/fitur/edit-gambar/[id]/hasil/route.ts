import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { mimeHasil } from "@/lib/hasil-edit";

export const runtime = "nodejs";

/* Hasil job AI Image Editor (r30): cuma PEMILIK job yang boleh
   (dari sesi — id job ny diambil dari path, user ny dari sesi,
   gak ada parameter userId dari client). ?unduh=1 = paksa
   unduhan (nama file dari hasilNama). Tanpa ?unduh=1 = inline
   (buat pratinjau di view). File ny gak pernah URL publik. */

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  const job = await db.editGambarJob.findUnique({ where: { id } });
  if (!job || job.userId !== sesi.id) {
    return NextResponse.json({ galat: "Hasil ny gak ketemu." }, { status: 404 });
  }
  if (job.status !== "COMPLETED" || !job.hasilJalur) {
    return NextResponse.json({ galat: "Job ini belum punya hasil." }, { status: 404 });
  }

  const jalurFisik = path.join(process.cwd(), job.hasilJalur);
  let ukuran = 0;
  try {
    ukuran = (await stat(jalurFisik)).size;
  } catch {
    /* File hasilny udah gak ada (misal dibersihin manual): status
       jelas buat history, bukan file rusak nyamar. */
    return NextResponse.json({ galat: "Hasil ny udah gak tersedia." }, { status: 404 });
  }

  const unduh = new URL(req.url).searchParams.get("unduh");
  const headers: Record<string, string> = {
    "content-type": job.hasilMime || mimeHasil(job.hasilNama || ""),
    "content-length": String(ukuran),
    "cache-control": "private, no-store",
  };
  if (unduh && job.hasilNama) {
    headers["content-disposition"] = "attachment; filename*=UTF-8''" + encodeURIComponent(job.hasilNama);
  }

  const stream = createReadStream(jalurFisik);
  return new Response(stream as unknown as ReadableStream, { status: 200, headers });
}
