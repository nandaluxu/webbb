import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

/* Sajikan foto profil. Etag-free, cukup cache panjang + ?v= buat
   ganti foto (client nambahin versi waktu biar gak nyangkut cache lama). */

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]+$/i.test(id)) return new NextResponse(null, { status: 400 });

  try {
    const penyangga = await readFile(path.join(process.cwd(), "data", "pfp", id + ".webp"));
    return new NextResponse(new Uint8Array(penyangga), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=60",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
