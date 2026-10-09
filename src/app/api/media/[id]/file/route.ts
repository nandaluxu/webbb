import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { bolehLihat, bacaItem, jalurAsli, mimeDariNama } from "@/lib/media-server";

/* File asli (resolusi penuh) satu post. ?item=N buat post multi-foto
   (urutan slide; default 0 = file pertama). ?unduh=1 -> paksa unduhan.
   PRIVATE cuma pemilik ny yang boleh (cek server-side dari sesi,
   gak bisa dipalsuin) — 404 biar keberadaan post ny aja gak bocor.

   VIDEO: dukung HTTP Range (206 + Content-Range) biar seek/jeda/
   lanjut muter jalan. Tanpa ini, browser gak bisa loncat waktu di
   video (set currentTime ke-reset ke 0) dan Chrome minta range
   buat moov atom mp4 yang ke taruh di ujung file. */

function bacaRange(header: string | null, ukuran: number): { awal: number; akhir: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let awal = m[1] === "" ? 0 : Number(m[1]);
  let akhir = m[2] === "" ? ukuran - 1 : Number(m[2]);
  if (Number.isNaN(awal) || Number.isNaN(akhir)) return null;
  if (akhir >= ukuran) akhir = ukuran - 1;
  if (awal > akhir) return null;
  return { awal, akhir };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const baris = await db.media.findUnique({ where: { id } });
  if (!baris) return NextResponse.json({ galat: "Media gak ketemu." }, { status: 404 });

  const sesi = await bacaSesi();
  if (!bolehLihat(baris, sesi?.id ?? null)) {
    return NextResponse.json({ galat: "Media gak ketemu." }, { status: 404 });
  }

  /* r30: unduhan = keputusan SERVER, gak cuma UI. ?unduh=1 cuma
     boleh kalau uploader ny ngizinin (bolehUnduh) ATAU yang minta
     pemilik ny sendiri. Nyari file ny (tanpa ?unduh) tetep boleh —
     itu jalur penampilan ny (dipake pratinjau/post/galeri). Jadi
     yang gak berizin tetap bisa LIHAT tapi gak bisa unduh lewat
     endpoint ny, sekalipun nyebut URL ny langsung. */
  const unduh = new URL(req.url).searchParams.get("unduh");
  if (unduh && !baris.bolehUnduh && baris.userId !== sesi?.id) {
    return NextResponse.json({ galat: "Pemilik post ini gak ngizinin unduhan." }, { status: 403 });
  }

  /* Item ke-N dari post (post lama/backfill = 1 item). */
  const nomor = Number(new URL(req.url).searchParams.get("item")) || 0;
  const item = (await bacaItem(baris)).find((i) => i.urutan === nomor);
  const jalurBaris = item
    ? { dari: baris.dari, pathAsli: item.pathAsli, nama: item.nama }
    : { dari: baris.dari, pathAsli: baris.pathAsli, nama: baris.nama };

  const jalurFisik = jalurAsli(jalurBaris);
  let ukuran = 0;
  try {
    ukuran = (await stat(jalurFisik)).size;
  } catch {
    return NextResponse.json({ galat: "File ny udah gak ada di server." }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "content-type": mimeDariNama(jalurBaris.nama),
    "accept-ranges": "bytes",
    "cache-control": baris.visibilitas === "PRIVATE" ? "private, no-store" : "public, max-age=31536000, immutable",
  };
  if (unduh) {
    const nama = encodeURIComponent(jalurBaris.nama);
    headers["content-disposition"] = `attachment; filename*=UTF-8''${nama}`;
  }

  const rentang = bacaRange(req.headers.get("range"), ukuran);
  if (rentang) {
    /* 206 Partial Content: stream potonganny (node stream, gak
       kebaca sekaligus ke memori — file video bisa gede). */
    headers["content-range"] = `bytes ${rentang.awal}-${rentang.akhir}/${ukuran}`;
    headers["content-length"] = String(rentang.akhir - rentang.awal + 1);
    const stream = createReadStream(jalurFisik, { start: rentang.awal, end: rentang.akhir });
    return new Response(stream as unknown as ReadableStream, { status: 206, headers });
  }

  headers["content-length"] = String(ukuran);
  const stream = createReadStream(jalurFisik);
  return new Response(stream as unknown as ReadableStream, { status: 200, headers });
}
