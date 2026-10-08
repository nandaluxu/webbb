import { NextRequest, NextResponse } from "next/server";
import { bacaTokenPreset } from "@/lib/am-v2";

export const runtime = "nodejs";

/* 5MB Converter (r30): proxy unduhan file preset (XML / audio).
   Client gak pernah nyempain URL target: ny tempel link halaman
   preset -> POST ambilPreset -> token session (umur 30 menit) ->
   unduhan lewat sini pakai token + jenis. URL target ny gak
   dikirim balik ke client buat dipakai manggil langsung. */

const JENIS: Record<string, { ext: string; mime: string }> = {
  xml: { ext: "xml", mime: "application/xml" },
  audio: { ext: "mp3", mime: "audio/mpeg" },
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const jenis = url.searchParams.get("jenis") || "";
  const def = JENIS[jenis];
  if (!def) return NextResponse.json({ galat: "Jenis file ny gak dikenal." }, { status: 400 });

  const target = bacaTokenPreset(token, jenis as "xml" | "audio");
  if (!target) {
    return NextResponse.json({ galat: "Sesi unduhan ny udah habis (30 menit). Ambil ulang datanya dari link preset ny." }, { status: 404 });
  }

  try {
    const res = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(60000),
      cache: "no-store",
    });
    if (!res.ok || !res.body) {
      return NextResponse.json({ galat: "File ny gak bisa diunduh dari server ny." }, { status: 502 });
    }
    /* Nama file dari URL target (dibersihin), fallback jenis ny. */
    const namaAsli = decodeURIComponent(target.split("?")[0].split("/").pop() || "") || "preset";
    const namaAman = namaAsli.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
    const mime = res.headers.get("content-type") || def.mime;
    const headers: Record<string, string> = {
      "content-type": mime,
      "content-disposition": 'attachment; filename="' + namaAman + '"',
      "cache-control": "no-store",
    };
    const panjang = res.headers.get("content-length");
    if (panjang) headers["content-length"] = panjang;
    return new Response(res.body, { status: 200, headers });
  } catch {
    return NextResponse.json({ galat: "Gagal ngambil file ny. Coba lagi." }, { status: 502 });
  }
}
