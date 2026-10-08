import { NextResponse } from "next/server";
import { sfile } from "@/lib/sfile-wa.js";

/* Info satu file sfile (dari link): nama, ukuran, tanggal, jumlah unduhan.
   Dipanggil mode unduh (input = link sfile). */

export const runtime = "nodejs";

export function linkSfile(v: string): boolean {
  return /(^|\s|")https?:\/\/(www\.)?(sfile\.co|sfile\.mobi)\/\S+/i.test(v.trim()) || /(^|\/)(sfile\.co|sfile\.mobi)\/[A-Za-z0-9]+/i.test(v.trim());
}

export async function POST(req: Request) {
  let badan: { url?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }
  const url = String(badan.url ?? "").trim().slice(0, 300);
  if (!linkSfile(url)) {
    return NextResponse.json({ galat: "Link ny harus file sfile.co / sfile.mobi." }, { status: 400 });
  }

  try {
    const info = await sfile.getFile(url);
    return NextResponse.json({
      info: {
        nama: info?.name || info?.filename || "-",
        ukuran: info?.sizeLabel || null,
        waktu: info?.uploadedLabel || info?.uploadedAt || null,
        unduhan: typeof info?.downloads === "number" ? info.downloads : null,
        url: url,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { galat: e?.message ? "sfile: " + e.message : "File ny gak kebaca. Mungkin link ny salah atau fileny udah dihapus." },
      { status: 502 }
    );
  }
}
