/* AI Image Editor adapter (r30): jembatan ke layanan pengolah
   gambar yang udah tersedia (endpoint to* di api-faa.my.id —
   di-audit live, bukan ngarang: daftar filter di bawah cuma
   endpoint yang beneran balas kontrak parameter ny).

   Kontrak respons (terverifikasi live):
   - SUKSES  : byte gambar langsung (image/png | image/jpeg |
               image/gif — animated GIF tetep apa adany, gak
               dikonversi paksa).
   - GAGAL   : JSON { status:false, error } -> FAILED.
   - RATE    : JSON { message:"Too fast (cooldown 500ms)",
               retryAfter } atau "Banned for N seconds" -> tunggu
               retryAfter, COBA SEKALI lagi (gak retry tanpa batas).
   - CF BAN  : HTML 403 (ban IP) -> FAILED dengan pesan jujur.

   Karena layanan ny: (1) lambet (40-180 detik per gambar), (2)
   agresif nge-ban IP yang nembak cepet — SEMUA panggilan lewat
   ANTREAN SERIAL di proses server dengan jeda minimum antar
   panggilan. Browser gak pernah nunggu request gantung: job ny
   dibikin server-side (row DB), UI polling status ny.

   Status job: QUEUED -> PROCESSING -> COMPLETED / FAILED / EXPIRED.
   EXPIRED = lewat 30 MENIT sejak job mulai dikerjain (bukan sejak
   user ninggalin halaman — status diitung server-side, job tetep
   jalan di background walau user refresh / pindah halaman).
   Hasil disimpen sebagai file di data/edit-gambar/<id>.<ext>. */

import { mkdir, writeFile, stat, rm } from "fs/promises";
import path from "path";

const BASE = "https://api-faa.my.id/faa/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

/* Jeda minimum antar panggilan provider (ms). Layanan ny kasih
   cooldown 500ms + strike kalau lewat — 5 detik ny aman banget
   plus tetep responsif buat antrean pendek. */
const JEDA_PROVIDER = 5000;
/* Batas total satu panggilan HTTP (provider ny bisa 40-180 detik). */
const TIMEOUT_PROVIDER = 180000;
/* Batas umur job: 30 menit sejak MULAI dikerjain. */
const BATAS_UMUR_MS = 30 * 60 * 1000;

/* ---------- Daftar filter (AUDIT live — diuji ULANG bersih, bukan
   dari respons rate-limiter yang bisa mutar) ----------
   Verifikasi final (masing2 dicek kontrak parameter ny + hasil
   nyata). Audit ulang 2026-10-07: +6 endpoint baru (tobabi,
   toblonde, tobotak, tochibi, todpr, todubai) dicek dua-tahap:
   (1) tanpa param url balas 400 "Parameter url wajib diisi"
   (bukan 404) = endpoint ny beneran ada, (2) panggilan nyata
   balikin image/png 992x992 = kontrak hasil ny sama kayak
   filter lama. Calon lain (tocartoon, towibu, tonaruto, tololi,
   togyatt, tojk, towallpaper, tophoto, tohd, tomagic, toart,
   todraw, tocharcoal) balas 404 Not Found bersih — ditaruh di
   sini = ngarang.
   label = nama yang manusiawi buat UI (gak nyebut API/endpoint).
   artis = endpoint yang butuh input nama artis tambahan.
   grup "Latar" = filter yang ganti latar belakang (bukan muka). */
export type DefFilter = {
  id: string;
  label: string;
  grup: string;
  artis?: boolean;
};

export const FILTER: DefFilter[] = [
  { id: "toanime", label: "Anime", grup: "Gaya" },
  { id: "tochibi", label: "Chibi", grup: "Gaya" },
  { id: "tobrewok", label: "Brewok", grup: "Gaya" },
  { id: "tozombie", label: "Zombie", grup: "Gaya" },
  { id: "tobabi", label: "Babi", grup: "Gaya" },
  { id: "toblonde", label: "Blonde", grup: "Gaya" },
  { id: "tobotak", label: "Botak", grup: "Gaya" },
  { id: "todpr", label: "DPR", grup: "Latar" },
  { id: "todubai", label: "Dubai", grup: "Latar" },
  { id: "tobersama", label: "Bareng Artis", grup: "Bareng", artis: true },
];

export function cariFilter(id: string): DefFilter | undefined {
  return FILTER.find((f) => f.id === id);
}

/* ---------- Bentuk hasil normalisasi (adapter layer) ----------
   Frontend gak pernah lihat bentuk mentah provider: semua hasil
   dinormalisasi ke {ok, buffer, mime, ext} atau {ok:false, pesan,
   tunggu?}. */
export type HasilPanggil = {
  ok: true;
  buffer: Buffer;
  mime: string;
  ext: string;
} | {
  ok: false;
  pesan: string;
  /* Rate-limited: berapa lama harus nunggu sebelum nyoba lagi (ms). */
  tungguMs?: number;
};

function ekstensiDariMime(mime: string): string {
  if (mime.includes("gif")) return "gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

async function panggilSekali(def: DefFilter, url: string, artis?: string): Promise<HasilPanggil> {
  const u = new URL(BASE + def.id);
  u.searchParams.set("url", url);
  if (def.artis) u.searchParams.set("nama-artis", (artis || "").trim());
  const res = await fetch(u.toString(), {
    headers: { "user-agent": UA, accept: "*/*" },
    signal: AbortSignal.timeout(TIMEOUT_PROVIDER),
    cache: "no-store",
  });

  const tipe = res.headers.get("content-type") || "";
  if (res.ok && tipe.startsWith("image/")) {
    const buffer = Buffer.from(await res.arrayBuffer());
    return { ok: true, buffer, mime: tipe.split(";")[0].trim(), ext: ekstensiDariMime(tipe) };
  }

  /* Bukan gambar: parse JSON error / rate-limit / HTML CF. */
  let mentah = "";
  try {
    mentah = (await res.text()).slice(0, 600);
  } catch {}
  let j: any = null;
  try {
    j = JSON.parse(mentah);
  } catch {}
  if (j && typeof j.retryAfter === "number") {
    const dilarang = /banned/i.test(String(j.message || ""));
    return {
      ok: false,
      pesan: dilarang ? "Server gambar ny lagi sibuk banget. Coba lagi nanti." : "Server gambar ny lagi rame, antre sebentar.",
      tungguMs: Math.min((j.retryAfter + 1) * 1000, 90000),
    };
  }
  if (j && j.error) {
    const e = String(j.error);
    if (/status code 5\d\d/i.test(e)) {
      return { ok: false, pesan: "Pemrosesan gambar ny gagal di server ny. Coba foto laen atau filter laen." };
    }
    return { ok: false, pesan: e };
  }
  if (res.status === 403) {
    return { ok: false, pesan: "Server gambar ny lagi ngeblokir sementara. Coba lagi beberapa menit lagi." };
  }
  return { ok: false, pesan: "Gagal memproses gambar (HTTP " + res.status + "). Coba lagi." };
}

/* Panggil provider + 1 retry khusus rate-limit (bounded, gak
   infinite): "Too fast"/"Banned" -> tunggu tungguMs -> coba LAGI
   SEKALI. Gagal laen (500/403) -> langsung FAILED. */
export async function panggil(def: DefFilter, url: string, artis?: string): Promise<HasilPanggil> {
  const pertama = await panggilSekali(def, url, artis);
  if (pertama.ok || pertama.tungguMs === undefined) return pertama;
  await new Promise((r) => setTimeout(r, pertama.tungguMs));
  return panggilSekali(def, url, artis);
}

/* ---------- Antrean serial (proses server) ----------
   Satu panggilan provider pada satu waktu + jeda minimum antar
   panggilan (rate limit ny agresif — antrean ny yang jagain IP
   server gak kena ban). Implementasi: rantai promise (pola
   mutex serial klasik) — tiap giliran nunggu giliran SEBELUMNYA
   mulai, terus nunggu sisa jeda provider. Gak ada state manual
   yang bisa nyangkut. */
const sedangJalan = new Set<string>();
let ekor: Promise<void> = Promise.resolve();
let terakhirMulai = 0;

function tungguGiliran(): Promise<void> {
  const giliranSaya = ekor.then(
    () =>
      new Promise<void>((selesai) => {
        const tunggu = Math.max(0, terakhirMulai + JEDA_PROVIDER - Date.now());
        setTimeout(() => {
          terakhirMulai = Date.now();
          selesai();
        }, tunggu);
      })
  );
  ekor = giliranSaya.then(() => undefined, () => undefined);
  return giliranSaya;
}

/* Simpan hasil ke data/edit-gambar/<id>.<ext>. Balikin jalur
   relatif ny (disimpen di DB). */
export async function simpanHasil(id: string, buffer: Buffer, ext: string): Promise<string> {
  const dir = path.join(process.cwd(), "data", "edit-gambar");
  await mkdir(dir, { recursive: true });
  const jalur = path.join(dir, id + "." + ext);
  await writeFile(jalur, buffer);
  return path.join("data", "edit-gambar", id + "." + ext);
}

export async function cekHasilAda(jalurRelatif: string | null | undefined): Promise<boolean> {
  if (!jalurRelatif) return false;
  try {
    await stat(path.join(process.cwd(), jalurRelatif));
    return true;
  } catch {
    return false;
  }
}

export async function hapusHasil(jalurRelatif: string | null | undefined): Promise<void> {
  if (!jalurRelatif) return;
  try {
    await rm(path.join(process.cwd(), jalurRelatif), { force: true });
  } catch {}
}

export function lagiProses(id: string): boolean {
  return sedangJalan.has(id);
}

export function tandaiMulai(id: string) {
  sedangJalan.add(id);
}

export function tandaiSelesai(id: string) {
  sedangJalan.delete(id);
}

/* Status umur: apakah job udah lewat 30 menit sejak mulai ny. */
export function udahLewatUmur(mulai: Date | null, dibuat: Date): boolean {
  const patokan = mulai ?? dibuat;
  return Date.now() - patokan.getTime() > BATAS_UMUR_MS;
}

export { tungguGiliran };
