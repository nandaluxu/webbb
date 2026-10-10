import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";

/* /api/teman/pesan (r32): obrolan pribadi sama SATU teman.
   Kunci ruang realtime (harus sama kayak mini-service obrolan):
   "pv:" + dua id ke-sort.
   r33: dukung QUOTE (balasanId) — pola ny sama kayak /api/chat,
   tapi balasan ny wajib pesan di pasangan yang sama (dari/ke dua
   arah), divalidasi server biar gak bisa nyasar quote obrolan laen. */

export const runtime = "nodejs";

const UMPUK = process.env.OBROLAN_UMPUK_PORT || "3004";
const RUANG = (a: string, b: string) => "pv:" + [a, b].sort().join("+");

/* Umpan tanda-dibaca ke ruang pasangan: si pengirim tau ✓ ny
   barusan jadi ✓✓ tanpa nunggu buka ulang. Best-effort. */
async function umpanBaca(sayaId: string, lawanId: string) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 400);
    await fetch("http://localhost:" + UMPUK + "/terbit-pv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruangan: RUANG(sayaId, lawanId), baca: { dariId: sayaId } }),
      signal: ctrl.signal,
    }).catch(() => {});
    clearTimeout(timer);
  } catch {
    /* diam aja */
  }
}
const BATCH = 30;
const PANJANG_TEKS = 2000;

/* Kolom pesan yang di-QUOTE yang diambil (nama pengirim gak perlu
   disnapshot — tinggal bandingin dariId sama lawan.id di client). */
const PILIH_BALASAN = {
  id: true,
  teks: true,
  waktu: true,
  dariId: true,
} as const;

type PesanKirim = {
  id: string;
  teks: string;
  waktu: string;
  dariId: string;
  keId: string;
  baca: string | null;
  klienId?: string;
  balasan: { id: string; teks: string; waktu: string; dariId: string } | null;
};

function susun(p: {
  id: string;
  teks: string;
  waktu: Date;
  dariId: string;
  keId: string;
  baca: Date | null;
  klienId?: string;
  balasan: { id: string; teks: string; waktu: Date; dariId: string } | null;
}): PesanKirim {
  return {
    id: p.id,
    teks: p.teks,
    waktu: p.waktu.toISOString(),
    dariId: p.dariId,
    keId: p.keId,
    baca: p.baca ? p.baca.toISOString() : null,
    ...(p.klienId ? { klienId: p.klienId } : {}),
    balasan: p.balasan
      ? { id: p.balasan.id, teks: p.balasan.teks, waktu: p.balasan.waktu.toISOString(), dariId: p.balasan.dariId }
      : null,
  };
}

async function cekTeman(sayaId: string, lawanId: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    db.ikuti.findUnique({
      where: { pengikutId_diikutiId: { pengikutId: sayaId, diikutiId: lawanId } },
      select: { id: true },
    }),
    db.ikuti.findUnique({
      where: { pengikutId_diikutiId: { pengikutId: lawanId, diikutiId: sayaId } },
      select: { id: true },
    }),
  ]);
  return !!a && !!b;
}

/* ---------- GET: riwayat obrolan ----------
   ?dengan=<userId>            : BATCH pesan terbaru (urut naik) +
                                 `lagi` (masih ada yang lebih lama)
   ?dengan=<userId>&setelah=ISO: pesan BARU setelah waktu itu
                                 (polling cadangan kalau socket ny
                                 gak nyampe). Sekalian tandain yang
                                 belum baca jadi udah. */
export async function GET(req: NextRequest) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const dengan = sp.get("dengan");
  if (!dengan) return NextResponse.json({ galat: "Lawan bicarany kurang." }, { status: 400 });

  const lawan = await db.pengguna.findUnique({
    where: { id: dengan },
    select: { id: true, nama: true, username: true, pfp: true, verified: true },
  });
  if (!lawan) return NextResponse.json({ galat: "User ny gak ketemu." }, { status: 404 });
  if (lawan.id === sesi.id) return NextResponse.json({ galat: "Gak bisa chat sama diri sendiri." }, { status: 400 });

  const teman = await cekTeman(sesi.id, lawan.id);

  const setelah = sp.get("setelah");
  if (setelah) {
    const t = new Date(setelah);
    if (!isNaN(t.getTime())) {
      const baru = await db.pesanPribadi.findMany({
        where: {
          OR: [
            { dariId: sesi.id, keId: lawan.id },
            { dariId: lawan.id, keId: sesi.id },
          ],
          waktu: { gt: t },
        },
        orderBy: { waktu: "asc" },
        take: 100,
        include: { balasan: { select: PILIH_BALASAN } },
      });
      /* Pesan baru dari dia = langsung ditandain dibaca (dia lagi
         buka obrolanny juga). */
      if (baru.some((p) => p.keId === sesi.id && !p.baca)) {
        await db.pesanPribadi.updateMany({
          where: { dariId: lawan.id, keId: sesi.id, baca: null },
          data: { baca: new Date() },
        });
        void umpanBaca(sesi.id, lawan.id);
      }
      return NextResponse.json({ ok: true, teman: lawan, masihTeman: teman, pesan: baru.map(susun) });
    }
  }

  /* Riwayat utama: ambil BATCH terbaru (desc), dibalik jadi asc. */
  const ambil = await db.pesanPribadi.findMany({
    where: {
      OR: [
        { dariId: sesi.id, keId: lawan.id },
        { dariId: lawan.id, keId: sesi.id },
      ],
    },
    orderBy: { waktu: "desc" },
    take: BATCH + 1,
    include: { balasan: { select: PILIH_BALASAN } },
  });
  const lagi = ambil.length > BATCH;
  const pesan = (lagi ? ambil.slice(0, BATCH) : ambil).slice().reverse();

  /* Buka obrolan = pesan ny langsung kebaca (penerima ny gue). */
  const kebaca = await db.pesanPribadi.updateMany({
    where: { dariId: lawan.id, keId: sesi.id, baca: null },
    data: { baca: new Date() },
  });
  if (kebaca.count > 0) void umpanBaca(sesi.id, lawan.id);

  /* teman = PROFIL lawan (buat header obrolan), masihTeman = status
     relasi (boolean). Jangan ketuker kayak tadi: namany sama bikin
     lawan ny ke-set jadi true/false di client. */
  return NextResponse.json({ ok: true, teman: lawan, masihTeman: teman, pesan: pesan.map(susun), lagi });
}

/* ---------- POST: kirim pesan ----------
   { dengan, teks, klienId?, balasanId? } — WAJIB masih teman (mutual
   follow); bukan teman = 403 (galat ny manusiawi, UI ngarahin ke
   profil). balasanId = id pesan yang di-quote (r33); wajib pesan di
   PASANGAN obrolan yang sama — quote nyasar otomatis dibuang (jadi
   pesan biasa), bukan ditolak (pengirim gak perlu tau detail ny).
   { dengan, aksi: "baca" } — tandain pesan dari dia jadi udah
   kebaca (dipake pas pesan baru nyampe lewat socket pas obrolanny
   lagi kebuka: tanpa ini, pesanny kebaca di layar tapi angka belum-
   baca ny masih nyangkut sampe buka ulang). */
export async function POST(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  let badan: { dengan?: unknown; teks?: unknown; klienId?: unknown; aksi?: unknown; balasanId?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  const dengan = String(badan.dengan ?? "");
  if (!dengan) return NextResponse.json({ galat: "Lawan bicarany kurang." }, { status: 400 });

  const lawan = await db.pengguna.findUnique({ where: { id: dengan }, select: { id: true } });
  if (!lawan) return NextResponse.json({ galat: "User ny gak ketemu." }, { status: 404 });

  /* Khusus tandain dibaca: gak butuh teman (kalau barusan unfriend,
     pesan lama tetep boleh ditandain). */
  if (badan.aksi === "baca") {
    const n = await db.pesanPribadi.updateMany({
      where: { dariId: lawan.id, keId: sesi.id, baca: null },
      data: { baca: new Date() },
    });
    if (n.count > 0) void umpanBaca(sesi.id, lawan.id);
    return NextResponse.json({ ok: true, dibaca: n.count });
  }

  if (lawan.id === sesi.id) {
    return NextResponse.json({ galat: "Gak bisa kirim ke diri sendiri." }, { status: 400 });
  }

  const teks = String(badan.teks ?? "").trim();
  const klienId = typeof badan.klienId === "string" ? badan.klienId.slice(0, 64) : undefined;
  if (!teks) return NextResponse.json({ galat: "Pesan ny kosong." }, { status: 400 });
  if (teks.length > PANJANG_TEKS) {
    return NextResponse.json({ galat: "Pesan kepanjangan (maks " + PANJANG_TEKS + " huruf)." }, { status: 400 });
  }

  if (!(await cekTeman(sesi.id, lawan.id))) {
    return NextResponse.json(
      { galat: "Kalian udah gak teman. Follow balik dulu buat lanjut ngobrol.", kode: "BUKAN_TEMAN" },
      { status: 403 }
    );
  }

  /* r33: validasi quote — pesan yang dibalas HARUS milik pasangan
     obrolan ini (dua arah). Ini juga pagar privasi: id pesan dari
     obrolan laen gak bakal nyambung. Gak ketemu/gak sah = pesan
     tetep kesimpen sebagai pesan biasa (tanpa quote). */
  let balasanId: string | null = null;
  const mintaBalasan = typeof badan.balasanId === "string" && badan.balasanId ? badan.balasanId : null;
  if (mintaBalasan) {
    const b = await db.pesanPribadi.findUnique({
      where: { id: mintaBalasan },
      select: { id: true, dariId: true, keId: true },
    });
    if (
      b &&
      ((b.dariId === sesi.id && b.keId === lawan.id) || (b.dariId === lawan.id && b.keId === sesi.id))
    ) {
      balasanId = b.id;
    }
  }

  const p = await db.pesanPribadi.create({
    data: { dariId: sesi.id, keId: lawan.id, teks, balasanId },
    include: { balasan: { select: PILIH_BALASAN } },
  });
  const pesan = susun({ ...p, klienId });

  /* Umpan ke mini-service: broadcast ke ruang pasangan doang. Gagal
     (service mati) gak boleh gagalin penyimpanan — penerima tetep
     dapet pesanny pas buka/buka ulang obrolanny. */
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 400);
    await fetch("http://localhost:" + UMPUK + "/terbit-pv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruangan: RUANG(sesi.id, lawan.id), pesan }),
      signal: ctrl.signal,
    }).catch(() => {});
    clearTimeout(timer);
  } catch {
    /* diam aja */
  }

  return NextResponse.json({ ok: true, pesan });
}
