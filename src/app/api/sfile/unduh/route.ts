import { NextResponse } from "next/server";
import { sfile } from "@/lib/sfile-wa.js";

/* Unduh file sfile lewat server (proxy): ambil direct URL pakai sesi
   http2 khusus, terus salurkan ke browser dengan nama file beneran.
   Browser gak bisa ambil langsung: CDN sfile ngecek cookie + referer.
   GET biar bisa dipake <a download> biasa.
   Batas web: 100 MB (server sfile sendiri 250 MB). */

export const runtime = "nodejs";
export const maxDuration = 120;

const BATAS = 100 * 1024 * 1024;

export async function GET(req: Request) {
  const url = (new URL(req.url).searchParams.get("url") || "").trim().slice(0, 300);
  if (!url || !/(^|\.)sfile\.(co|mobi)\//i.test(url.replace(/^https?:\/\//, ""))) {
    return NextResponse.json({ galat: "Link sfile ny gak valid." }, { status: 400 });
  }

  try {
    const hasil = await sfile.downloadFile(url, { maxBytes: BATAS + 1 });
    if (hasil.sizeBytes > BATAS) {
      return NextResponse.json(
        { galat: "File ny " + (hasil.sizeBytes / 1048576).toFixed(1) + " MB, batas unduhan lewat web 100 MB." },
        { status: 413 }
      );
    }
    const nama = encodeURIComponent(hasil.filename || "sfile.bin");
    return new Response(new Uint8Array(hasil.buffer), {
      headers: {
        "content-type": hasil.mime || "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${nama}`,
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { galat: e?.message ? "sfile: " + e.message : "Gagal ngambil file. Coba lagi." },
      { status: 502 }
    );
  }
}
