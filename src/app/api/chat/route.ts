import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";

export const runtime = "nodejs";

type PesanKirim = {
  id: string;
  nama: string;
  teks: string;
  waktu: string;
  /* r19 optimistic: di-echo balik ke pengirim (respons POST +
     broadcast socket) biar client bisa nyambungin pesan resmi ny
     sama pesan sambil-an lokal. GAK disimpen ke DB (gak dipake
     buat apa pun di server, cuma penghubung client). */
  klienId?: string;
  balasan: { id: string; nama: string; teks: string; waktu: string } | null;
};

function susunPesan(p: {
  id: string;
  nama: string;
  teks: string;
  waktu: Date;
  klienId?: string;
  balasanId: string | null;
  balasan: { id: string; nama: string; teks: string; waktu: Date } | null;
}): PesanKirim {
  return {
    id: p.id,
    nama: p.nama,
    teks: p.teks,
    waktu: p.waktu.toISOString(),
    ...(p.klienId ? { klienId: p.klienId } : {}),
    balasan: p.balasan
      ? { id: p.balasan.id, nama: p.balasan.nama, teks: p.balasan.teks, waktu: p.balasan.waktu.toISOString() }
      : null,
  };
}

const PILIH_BALASAN = {
  id: true,
  nama: true,
  teks: true,
  waktu: true,
} as const;

/* /api/chat GET modes:
   - ?after=<ISO>     : pesan baru setelah waktu itu (polling — lama).
   - ?terbaru=1       : 20 PESAN TERBARU (r28: bukan seluruh riwayat)
                        + `lagi` (masih ada yang lebih lama?) + kursor
                        `sebelum` (waktu+id pesan tertua di batch ini).
   - ?sw=<ISO>&sid=<id>: 20 pesan LEBIH LAMA sebelum kursor (pagination
                        ke atas, cursor-based — gak pake offset biar gak
                        ada dobel/hilang pas data berubah).
   - tanpa param      : perilaku lama (riwayat penuh, maks 300) —
                        kompatibilitas pemanggil lama/test.
   Cursor = (waktu, id) pair + tiebreaker id: urutan total yang stabil. */

const JUMLAH_BATCH = 20;

function kursorValid(v: string | null): Date | null {
  if (!v) return null;
  const t = new Date(v);
  return isNaN(t.getTime()) ? null : t;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  /* Mode polling lama: pesan baru setelah `after`. */
  const after = sp.get("after");
  if (after) {
    const t = kursorValid(after);
    if (t) {
      const pesan = await db.pesan.findMany({
        where: { waktu: { gt: t } },
        orderBy: { waktu: "asc" },
        take: 300,
        include: { balasan: { select: PILIH_BALASAN } },
      });
      return NextResponse.json({ pesan: pesan.map(susunPesan) });
    }
  }

  /* Mode halaman: 20 terbaru (terbaru=1) ATAU 20 sebelum kursor
     (sw + sid). Ambil JUMLAH_BATCH+1 buat tau masih ada sisany. */
  const mintaTerbaru = sp.get("terbaru");
  const sw = sp.get("sw");
  const sid = sp.get("sid");

  if (mintaTerbaru || (sw && sid)) {
    let where = {};
    if (sw && sid) {
      const t = kursorValid(sw);
      if (t) {
        /* Sebelum kursor: waktu lebih kecil, ATAU waktu sama tapi id
           lebih kecil (tiebreaker — urutan total stabil). */
        where = { OR: [{ waktu: { lt: t } }, { waktu: t, id: { lt: sid } }] };
      }
    }
    const rows = await db.pesan.findMany({
      where,
      orderBy: [{ waktu: "desc" }, { id: "desc" }],
      take: JUMLAH_BATCH + 1,
      include: { balasan: { select: PILIH_BALASAN } },
    });
    const lagi = rows.length > JUMLAH_BATCH;
    const halaman = rows.slice(0, JUMLAH_BATCH).reverse().map(susunPesan);
    /* Kursor halaman berikutny = pesan TERtua di halaman ini. */
    const terlama = halaman[0];
    return NextResponse.json({
      pesan: halaman,
      lagi,
      sebelum: terlama ? { waktu: terlama.waktu, id: terlama.id } : null,
    });
  }

  /* Default: riwayat penuh (perilaku lama). */
  const pesan = await db.pesan.findMany({
    orderBy: { waktu: "asc" },
    take: 300,
    include: { balasan: { select: PILIH_BALASAN } },
  });
  return NextResponse.json({ pesan: pesan.map(susunPesan) });
}

/* Rate limit ringan di memori: cukup buat nahan spam ketik cepet. */
const terakhir = new Map<string, number>();
const JEDA_MS = 350;

export async function POST(req: NextRequest) {
  /* Nama pengirim diambil dari sesi login (server-side, gak bisa
     dipalsuin dari client). */
  const sesi = await bacaSesi();
  if (!sesi) {
    return NextResponse.json({ galat: "Login dulu biar bisa kirim chat." }, { status: 401 });
  }

  let badan: { teks?: unknown; balasanId?: unknown; klienId?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Isi permintaanny gak kebaca." }, { status: 400 });
  }

  const nama = sesi.nama.slice(0, 24);
  const teks = String(badan.teks ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, 500);
  const balasanId = typeof badan.balasanId === "string" && badan.balasanId ? badan.balasanId : null;
  /* Penghubung optimistic: string bebas maksimal 64 char, cuma
     di-echo balik, gak disimpen. */
  const klienId = typeof badan.klienId === "string" && badan.klienId ? badan.klienId.slice(0, 64) : undefined;

  if (!teks) {
    return NextResponse.json({ galat: "Pesan ny masih kosong." }, { status: 400 });
  }

  const kunci = nama.toLowerCase();
  const kini = Date.now();
  const terakhirs = terakhir.get(kunci) ?? 0;
  if (kini - terakhirs < JEDA_MS) {
    return NextResponse.json({ galat: "Kep cepet wkwk. Tunggu bentar." }, { status: 429 });
  }
  terakhir.set(kunci, kini);

  let balasanAda = false;
  if (balasanId) {
    balasanAda = !!(await db.pesan.findUnique({ where: { id: balasanId }, select: { id: true } }));
  }

  const p = await db.pesan.create({
    data: {
      nama,
      teks,
      balasanId: balasanAda ? balasanId : null,
    },
    include: { balasan: { select: PILIH_BALASAN } },
  });
  const pesan = susunPesan({ ...p, klienId });

  /* Umpan ke mini-service biar langsung ke-broadcast ke semua yang online.
     Kalau mini-service mati gak masalah: polling jadi cadangan ny. */
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 400);
    await fetch("http://localhost:3004/terbit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pesan),
      signal: ctrl.signal,
    }).catch(() => {});
    clearTimeout(timer);
  } catch {
    /* diam aja: broadcast gagal gak boleh gagalin penyimpanan */
  }

  return NextResponse.json({ pesan });
}
