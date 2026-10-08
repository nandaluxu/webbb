import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";

/* Ganti foto profil: di-resize jadi 256px webp (maks 5MB masukan). */

const BATAS = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ galat: "Data ny gak kebaca." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ galat: "Pilih foto profil dulu." }, { status: 400 });
  }
  if (file.size > BATAS) {
    return NextResponse.json({ galat: "Foto profil maks 5 MB." }, { status: 413 });
  }

  let webp: Buffer;
  try {
    webp = await sharp(Buffer.from(await file.arrayBuffer()))
      .resize({ width: 256, height: 256, fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return NextResponse.json({ galat: "File ny bukan gambar yang kebaca." }, { status: 415 });
  }

  const jalur = path.join("data", "pfp", sesi.id + ".webp");
  await mkdir(path.join(process.cwd(), "data", "pfp"), { recursive: true });
  await writeFile(path.join(process.cwd(), jalur), webp);
  await db.pengguna.update({ where: { id: sesi.id }, data: { pfp: jalur } });

  return NextResponse.json({ pfp: jalur });
}
