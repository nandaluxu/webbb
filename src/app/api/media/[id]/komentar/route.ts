import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { bolehLihat } from "@/lib/media-server";
import { sebutkanKomentar } from "@/lib/sebut";

/* Komentar post galeri. GET -> daftar, POST (login) -> nulis.
   Komentar bisa jadi balasan: balasanId ny harus komentar di media
   yang sama (gak boleh nyasar ke post laen). Nama yang dibalas
   kekirim dari data user asli, jadi sapaan "@nama" di UI gak
   mungkin ngawur.
   PRIVATE (r24): komentar cuma kebaca/kenulis buat pemilik post
   (cek sesi server-side; 404 biar keberadaan ny gak bocor).
   r29: teks komentar pertahanin NEWLINE (dulu ny di-collapse jadi
   spasi) + dukung @mention (resolve server-side -> relasi
   KomentarSebut + notifikasi MENTION_KOMENTAR). */

const MAKS_KOMENTAR = 500;

/* Normalisasi teks komentar (r29): newline dipertahanin, tiap baris
   di-trim spasi ny, baris kosong di ujung dibuang. Emojis + karakter
   apapun tetep lolos — ini bukan sanitizer, cuma perapikan bentuk. */
function rapikanKomentar(v: unknown): string {
  const mentah = String(v ?? "").replace(/\r\n?/g, "\n").slice(0, MAKS_KOMENTAR);
  const baris = mentah.split("\n").map((b) => b.replace(/[ \t]+/g, " ").trim());
  while (baris.length && !baris[baris.length - 1]) baris.pop();
  return baris.join("\n").trim();
}

async function daftarKomentar(mediaId: string) {
  const baris = await db.komentar.findMany({
    where: { mediaId },
    orderBy: { waktu: "asc" },
    take: 100,
    include: {
      user: { select: { id: true, nama: true, username: true, pfp: true, verified: true } },
      balasan: { select: { id: true, user: { select: { nama: true } } } },
    },
  });
  return baris.map((k) => ({
    id: k.id,
    teks: k.teks,
    waktu: k.waktu.toISOString(),
    user: k.user,
    balasan: k.balasan ? { id: k.balasan.id, nama: k.balasan.user.nama } : null,
  }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const media = await db.media.findUnique({ where: { id } });
  if (!media) return NextResponse.json({ galat: "Media gak ketemu." }, { status: 404 });
  const sesi = await bacaSesi();
  if (!bolehLihat(media, sesi?.id ?? null)) {
    return NextResponse.json({ galat: "Media gak ketemu." }, { status: 404 });
  }
  return NextResponse.json({ daftar: await daftarKomentar(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesi = await bacaSesi();
  if (!sesi) {
    return NextResponse.json({ galat: "Login dulu buat nulis komentar." }, { status: 401 });
  }
  const media = await db.media.findUnique({ where: { id } });
  if (!media) return NextResponse.json({ galat: "Media gak ketemu." }, { status: 404 });
  if (!bolehLihat(media, sesi.id)) {
    return NextResponse.json({ galat: "Media gak ketemu." }, { status: 404 });
  }

  let badan: { teks?: unknown; balasanId?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }
  const teks = rapikanKomentar(badan.teks);
  if (!teks) return NextResponse.json({ galat: "Komentar ny gak boleh kosong." }, { status: 400 });

  /* Balasan: cek targetny beneran komentar di post ini. */
  let balasanId: string | null = null;
  if (typeof badan.balasanId === "string" && badan.balasanId) {
    const target = await db.komentar.findUnique({ where: { id: badan.balasanId } });
    if (!target || target.mediaId !== id) {
      return NextResponse.json({ galat: "Komentar yang dibalas gak ketemu." }, { status: 400 });
    }
    balasanId = target.id;
  }

  const baru = await db.komentar.create({ data: { mediaId: id, userId: sesi.id, teks, balasanId } });

  /* Mention @username di komentar (r29): resolve SERVER-side jadi
     relasi KomentarSebut + notifikasi. Best-effort — gak boleh
     gagalin komentarny. */
  void sebutkanKomentar(baru.id, id, teks, sesi.id);

  return NextResponse.json({ daftar: await daftarKomentar(id) }, { status: 201 });
}
