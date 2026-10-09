import { NextResponse } from "next/server";
import { sfile } from "@/lib/sfile-wa.js";

/* Upload file ke sfile.co (guest). Catatan kebijakan server ny:
   mp4/video ditolak, batas 100 MB di web ini. */

export const runtime = "nodejs";
export const maxDuration = 300;

const BATAS = 100 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ galat: "Data upload ny gak kebaca." }, { status: 400 });
  }
  const file = form.get("file");
  const deskripsi = String(form.get("deskripsi") || "").replace(/\s+/g, " ").trim().slice(0, 550);

  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ galat: "Pilih file dulu." }, { status: 400 });
  }
  if (file.size > BATAS) {
    return NextResponse.json(
      { galat: "File ny " + (file.size / 1048576).toFixed(1) + " MB, batas upload sfile 100 MB." },
      { status: 413 }
    );
  }

  try {
    const hasil = await sfile.uploadFile(Buffer.from(await file.arrayBuffer()), {
      filename: file.name || "file.bin",
      description: deskripsi,
    });
    return NextResponse.json({
      shareUrl: hasil.shareUrl,
      shareCode: hasil.shareCode || null,
      nama: hasil.name || file.name,
      ukuran: hasil.sizeLabel || null,
      duplikat: !!hasil.duplicate,
      pesan: hasil.message || null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { galat: e?.message ? "sfile: " + e.message : "Upload gagal. Coba lagi." },
      { status: 502 }
    );
  }
}
