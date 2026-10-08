/* Lib media server-side: scan galeri publik, generate pratinjau
   low-res (sharp / ffmpeg), dan nyusun bentuk JSON buat client.
   File unggahan disimpen di data/media, pratinjau di data/pratinjau,
   hasil scan tetap di public/galeri. */

import { readdir, stat, readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import sharp from "sharp";
import { db } from "@/lib/db";
import type { MediaPublik, MediaItemPublik, Visibilitas } from "@/lib/tipe-media";

export type { MediaPublik };
export const AKAR = process.cwd();
export const DIR_MEDIA = path.join(AKAR, "data", "media");
export const DIR_PRATINJAU = path.join(AKAR, "data", "pratinjau");
export const DIR_GALERI_PUBLIK = path.join(AKAR, "public", "galeri");
export const BATAS_UNGGAH = 10 * 1024 * 1024;
/* Multi-foto per post (r24): jumlah file maks di SATU post. */
export const BATAS_ITEM = 10;

export const VISIBILITAS_VALID: readonly Visibilitas[] = ["PUBLIC", "PROFILE", "PRIVATE"] as const;

export function visibilitasAman(v: unknown): Visibilitas {
  const s = String(v ?? "").trim().toUpperCase();
  return (VISIBILITAS_VALID as readonly string[]).includes(s) ? (s as Visibilitas) : "PUBLIC";
}

const MINE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
};

export function mimeDariNama(nama: string): string {
  const e = nama.toLowerCase().split(".").pop() || "";
  return MINE[e] || "application/octet-stream";
}

export function jenisDariMime(mime: string): "foto" | "video" | null {
  if (mime.startsWith("image/")) return "foto";
  if (mime.startsWith("video/")) return "video";
  return null;
}

export function amanNama(nama: string): string {
  const bersih = nama
    .replace(/[\/\\]+/g, "")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return bersih || "file";
}

type BarisMedia = {
  id: string;
  jenis: string;
  dari: string;
  pathAsli: string;
  nama: string;
  judul: string | null;
  ukuran: number | null;
  lebar: number | null;
  tinggi: number | null;
  waktu: Date;
  userId: string | null;
  visibilitas?: string | null;
  bolehUnduh?: boolean | null;
};

type BarisItem = {
  urutan: number;
  jenis: string;
  pathAsli: string;
  nama: string;
  ukuran: number | null;
  lebar: number | null;
  tinggi: number | null;
};

/* Semua item satu post (urut slide), plus backfill: post lama
   (sebelum tabel MediaItem ada, r24) belum punya item — dibikinin
   SATU item dari data parent ny pas pertama kebaca. Jalan sekali
   per post lama, gak ada data yang berubah atau ilang. */
export async function bacaItem(baris: BarisMedia): Promise<BarisItem[]> {
  let item = await db.mediaItem.findMany({
    where: { mediaId: baris.id },
    orderBy: { urutan: "asc" },
  });
  if (!item.length) {
    await db.mediaItem
      .create({
        data: {
          mediaId: baris.id,
          urutan: 0,
          jenis: baris.jenis,
          pathAsli: baris.pathAsli,
          nama: baris.nama,
          ukuran: baris.ukuran,
          lebar: baris.lebar,
          tinggi: baris.tinggi,
        },
      })
      .catch(() => null);
    item = await db.mediaItem.findMany({ where: { mediaId: baris.id }, orderBy: { urutan: "asc" } });
  }
  return item.map((i) => ({
    urutan: i.urutan,
    jenis: i.jenis,
    pathAsli: i.pathAsli,
    nama: i.nama,
    ukuran: i.ukuran,
    lebar: i.lebar,
    tinggi: i.tinggi,
  }));
}

/* Authorization visibility (r24) — dipake endpoint file/pratinjau/
   komentar/suka supaya PRIVATE gak bocor lewat URL langsung:
   - PUBLIC / PROFILE: siapa aja boleh (PROFILE cuma dibatasi dari
     daftar Gallery, bukan private).
   - PRIVATE: cuma pemilik ny (sesi server-side, gak bisa dipalsuin
     dari parameter client). */
export function bolehLihat(baris: { visibilitas?: string | null; userId: string | null }, sesiId: string | null): boolean {
  const v = baris.visibilitas || "PUBLIC";
  if (v === "PRIVATE") return !!sesiId && sesiId === baris.userId;
  return true;
}

/* Dimensi media asli (piksel). Foto: baca metadata sharp (cuma
   header, cepat). Video: ffprobe stream pertama. Hasilny dipakai
   client buat jatah tinggi kartu masonry SEBELUM gambar muat,
   jadi gak ada lonjakan layout; null kalau gak kebaca. */
export async function bacaDimensi(jalur: string, jenis: string): Promise<{ lebar: number; tinggi: number } | null> {
  try {
    if (jenis === "video") {
      return await new Promise((selesai) => {
        execFile(
          "ffprobe",
          ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", jalur],
          { timeout: 10000 },
          (galat, stdout) => {
            try {
              const s = JSON.parse(String(stdout)).streams?.[0];
              selesai(s?.width && s?.height ? { lebar: s.width, tinggi: s.height } : null);
            } catch {
              selesai(null);
            }
          }
        );
      });
    }
    const meta = await sharp(jalur).metadata();
    return meta.width && meta.height ? { lebar: meta.width, tinggi: meta.height } : null;
  } catch {
    return null;
  }
}

export async function susunPublik(baris: BarisMedia, idSaya: string | null): Promise<MediaPublik> {
  const [suka, komentar, user, item, dilihat] = await Promise.all([
    db.suka.count({ where: { mediaId: baris.id } }),
    db.komentar.count({ where: { mediaId: baris.id } }),
    baris.userId ? db.pengguna.findUnique({ where: { id: baris.userId }, select: { id: true, nama: true, username: true, pfp: true, verified: true } }) : null,
    bacaItem(baris),
    /* Penonton unik (r28): jumlah row LihatMedia — 1 user = 1 view
       (constraint database), bukan hitungan GET. */
    db.lihatMedia.count({ where: { mediaId: baris.id } }),
  ]);
  const disukai = idSaya ? !!(await db.suka.findUnique({ where: { mediaId_userId: { mediaId: baris.id, userId: idSaya } } })) : false;
  const itemPublik: MediaItemPublik[] = item.map((i) => ({
    jenis: i.jenis === "video" ? "video" : "foto",
    nama: i.nama,
    rasio: i.lebar && i.tinggi ? i.lebar / i.tinggi : null,
    pratinjau: "/api/media/" + baris.id + "/pratinjau?item=" + i.urutan,
    file: "/api/media/" + baris.id + "/file?item=" + i.urutan,
  }));
  const v: Visibilitas = baris.visibilitas === "PROFILE" || baris.visibilitas === "PRIVATE" ? baris.visibilitas : "PUBLIC";
  return {
    id: baris.id,
    jenis: baris.jenis === "video" ? "video" : "foto",
    dari: baris.dari,
    nama: baris.nama,
    judul: baris.judul,
    ukuran: baris.ukuran,
    /* Rasio lebar/tinggi dari dimensi asli (bukan pratinjau): dipake
       grid buat jatah tinggi kartu duluan. null = gak kebaca, client
       fallback ke rasio pas gambar ny kebaca (perilaku lama). */
    rasio: baris.lebar && baris.tinggi ? baris.lebar / baris.tinggi : null,
    visibilitas: v,
    bolehUnduh: baris.bolehUnduh !== false,
    waktu: baris.waktu.toISOString(),
    user: user ? { id: user.id, nama: user.nama, username: user.username, pfp: user.pfp, verified: user.verified } : null,
    suka,
    disukai,
    komentar,
    dilihat,
    /* Kompatibilitas tampilan lama: pratinjau/file utama = item
       pertama (post 1 file sama kayak dulu). */
    pratinjau: itemPublik[0]?.pratinjau ?? "/api/media/" + baris.id + "/pratinjau",
    file: itemPublik[0]?.file ?? "/api/media/" + baris.id + "/file",
    item: itemPublik,
  };
}

/* ---------- Scan folder public/galeri ----------
   File baru kedeteksi otomatis jadi post galeri (tanpa judul, tanpa
   pemilik). File yang dihapus dari folder ny ilang dari daftar juga. */

export async function scanGaleri(): Promise<void> {
  await mkdir(DIR_GALERI_PUBLIK, { recursive: true });
  const files = (await readdir(DIR_GALERI_PUBLIK)).filter((f) => /\.(jpe?g|png|webp|gif|avif|mp4|webm|mov|m4v)$/i.test(f));

  /* Baris yang udah ada dicek duluan: dimensi cuma dibaca SEKALI
     (backfill buat file lama), bukan tiap scan, biar GET galeri
     tetep enteng. */
  const barisAda = await db.media.findMany({
    where: { dari: "scan" },
    select: { pathAsli: true, lebar: true, tinggi: true },
  });
  const petaAda = new Map(barisAda.map((b) => [b.pathAsli, b]));

  for (const f of files) {
    const jalur = "/galeri/" + f;
    const info = await stat(path.join(DIR_GALERI_PUBLIK, f));
    const jenis = jenisDariMime(mimeDariNama(f));
    if (!jenis) continue;
    const ada = petaAda.get(jalur);
    const dims = !ada || (!ada.lebar && !ada.tinggi) ? await bacaDimensi(path.join(DIR_GALERI_PUBLIK, f), jenis) : null;
    await db.media.upsert({
      where: { dari_pathAsli: { dari: "scan", pathAsli: jalur } },
      create: {
        jenis,
        dari: "scan",
        pathAsli: jalur,
        nama: f,
        ukuran: info.size,
        waktu: info.mtime,
        ...(dims ? { lebar: dims.lebar, tinggi: dims.tinggi } : {}),
      },
      update: {
        ukuran: info.size,
        waktu: info.mtime,
        ...(dims ? { lebar: dims.lebar, tinggi: dims.tinggi } : {}),
      },
    });
  }

  const hidup = new Set(files.map((f) => "/galeri/" + f));
  const mati = [...petaAda.keys()].filter((p) => !hidup.has(p));
  if (mati.length) {
    await db.media.deleteMany({
      where: { dari: "scan", pathAsli: { in: mati } },
    });
  }
}

/* ---------- Pratinjau low-res ----------
   Foto: sharp 480px webp. Video: frame pertama lewat ffmpeg, terus
   di-sharp jadi webp. Hasil di-cache di data/pratinjau/<id>.webp,
   cuma dibikin sekali per media (immutable). */

async function pastikanDirPratinjau() {
  await mkdir(DIR_PRATINJAU, { recursive: true });
}

async function frameVideo(jalurAsli: string): Promise<Buffer | null> {
  return new Promise((selesai) => {
    execFile(
      "ffmpeg",
      ["-i", jalurAsli, "-ss", "0.5", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"],
      { maxBuffer: 20 * 1024 * 1024, timeout: 15000, encoding: "buffer" },
      (galat, stdout, stderr) => {
        if (galat || !stdout?.length) {
          if (galat) console.error("ffmpeg frame gagal:", String(stderr).slice(0, 200) || String(galat));
          selesai(null);
          return;
        }
        selesai(stdout);
      }
    );
  });
}

export async function bikinPratinjau(id: string, jenis: string, sumberJalur: string): Promise<string | null> {
  const tujuan = path.join(DIR_PRATINJAU, id + ".webp");
  try {
    await stat(tujuan);
    return tujuan;
  } catch {}
  await pastikanDirPratinjau();

  let penyangga: Buffer | null = null;
  if (jenis === "video") {
    penyangga = await frameVideo(sumberJalur);
  } else {
    try {
      penyangga = await readFile(sumberJalur);
    } catch {
      return null;
    }
  }
  if (!penyangga) return null;
  try {
    /* Muat dalam kotak 480x854 (bukan cuma lebar 480): foto portrait
       tetep dapet 480px LEBAR, jadi pas ngeisi lebar frame post di HP
       gak blur. Tanpa enlargement: file kecil tetep gak dibesarin. */
    await writeFile(tujuan, await sharp(penyangga).resize({ width: 480, height: 854, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer());
    return tujuan;
  } catch (e) {
    console.error("pratinjau gagal:", id, e);
    return null;
  }
}

/* Jalur file asli di disk dari baris media. */
export function jalurAsli(baris: { dari: string; pathAsli: string }): string {
  if (baris.dari === "scan") return path.join(AKAR, "public", baris.pathAsli.replace(/^\//, ""));
  return path.join(AKAR, baris.pathAsli);
}
