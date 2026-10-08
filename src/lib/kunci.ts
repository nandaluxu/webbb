/* Kunci enkripsi sandi (aes-256-gcm). Disimpen di data/kunci.txt,
   otomatis dibikin pas pertama kali. Kunci gak ikut kebawa pas
   project dipindahin, jadi salinan sandi terenkripsi lama gak
   kebaca di tempat baru (sandi tetap bisa dipake, cek ny pake hash). */

import { randomBytes } from "crypto";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

let simpanan: Buffer | null = null;

export async function bacaKunci(): Promise<Buffer> {
  if (simpanan) return simpanan;
  const jalur = path.join(process.cwd(), "data", "kunci.txt");
  try {
    simpanan = Buffer.from((await readFile(jalur, "utf8")).trim(), "hex");
    if (simpanan.length === 32) return simpanan;
  } catch {}
  simpanan = randomBytes(32);
  await mkdir(path.dirname(jalur), { recursive: true });
  await writeFile(jalur, simpanan.toString("hex"), { mode: 0o600 });
  return simpanan;
}
