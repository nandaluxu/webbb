import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { bikinPratinjau, bolehLihat, bacaItem, jalurAsli } from "@/lib/media-server";

/* Pratinjau low-res (webp 480px, di-cache immutable) item ke-N
   (?item=N, default 0). Buat video: poster frame pertama; kalau
   ffmpeg gagal -> 404, grid nampilin lapisan video aja.
   PRIVATE cuma pemilik ny (cek sesi server-side). */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const baris = await db.media.findUnique({ where: { id } });
  if (!baris) return NextResponse.json({ galat: "Media gak ketemu." }, { status: 404 });

  const sesi = await bacaSesi();
  if (!bolehLihat(baris, sesi?.id ?? null)) {
    return NextResponse.json({ galat: "Media gak ketemu." }, { status: 404 });
  }

  const nomor = Number(new URL(_req.url).searchParams.get("item")) || 0;
  const item = (await bacaItem(baris)).find((i) => i.urutan === nomor);
  const jenis = item ? item.jenis : baris.jenis;
  const sumber = jalurAsli(item ? { dari: baris.dari, pathAsli: item.pathAsli } : { dari: baris.dari, pathAsli: baris.pathAsli });

  /* Cache key per item biar file ny gak ketuker antar slide. */
  const suffix = item && item.urutan > 0 ? "-" + item.urutan : "";
  const jalur = await bikinPratinjau(baris.id + suffix, jenis, sumber);
  if (!jalur) return NextResponse.json({ galat: "Pratinjau gak tersedia." }, { status: 404 });

  let penyangga: Buffer;
  try {
    penyangga = await readFile(jalur);
  } catch {
    return NextResponse.json({ galat: "Pratinjau gak kebaca." }, { status: 404 });
  }
  return new Response(new Uint8Array(penyangga), {
    headers: {
      "content-type": "image/webp",
      "cache-control": baris.visibilitas === "PRIVATE" ? "private, no-store" : "public, max-age=31536000, immutable",
    },
  });
}
