import { NextRequest, NextResponse } from "next/server";

/* /api/ttt: relay room Tic Tac Toe online (lintas device).
   Server cuma jadi "kotak surat": nyimpen log pesan per room di memori,
   klien polling GET ?kode=XXXX&after=<seq>. Protokol game (hadir/sambut/
   keadaan/ping/...) tetap di klien — server gak ngerti isi pesan.
   Memori proses: cukup buat satu instance Next (mulai.sh / standalone).
   POST {aksi:"bikin"|"cek"|"kirim", kode, dari?, pesan?} */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Room = { seq: number; log: { seq: number; data: unknown }[]; terakhir: number };
const g = globalThis as unknown as { __tttRooms?: Map<string, Room> };
const rooms = (g.__tttRooms ??= new Map<string, Room>());

const TTL = 30 * 60 * 1000;
const MAX_LOG = 300;
const KODE = /^[A-Z]{4}$/;

function bersihkan() {
  const now = Date.now();
  for (const [k, r] of rooms) if (now - r.terakhir > TTL) rooms.delete(k);
}

export async function GET(req: NextRequest) {
  const kode = (req.nextUrl.searchParams.get("kode") || "").toUpperCase();
  const after = Math.max(0, Number(req.nextUrl.searchParams.get("after")) || 0);
  const r = KODE.test(kode) ? rooms.get(kode) : undefined;
  if (!r) return NextResponse.json({ galat: "Room gak ada" }, { status: 404 });
  r.terakhir = Date.now();
  return NextResponse.json({ seq: r.seq, pesan: r.log.filter((m) => m.seq > after) });
}

export async function POST(req: NextRequest) {
  bersihkan();
  let b: { aksi?: string; kode?: string; pesan?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ galat: "Body rusak" }, { status: 400 });
  }
  const kode = String(b.kode || "").toUpperCase();
  if (!KODE.test(kode)) return NextResponse.json({ galat: "Kode room gak valid" }, { status: 400 });

  if (b.aksi === "bikin") {
    if (rooms.has(kode)) return NextResponse.json({ galat: "Kode kepake" }, { status: 409 });
    rooms.set(kode, { seq: 0, log: [], terakhir: Date.now() });
    return NextResponse.json({ ok: true, seq: 0 });
  }
  const r = rooms.get(kode);
  if (!r) return NextResponse.json({ galat: "Room gak ada" }, { status: 404 });
  r.terakhir = Date.now();
  if (b.aksi === "cek") return NextResponse.json({ ok: true, seq: r.seq });
  if (b.aksi === "kirim") {
    if (!b.pesan || typeof b.pesan !== "object" || JSON.stringify(b.pesan).length > 4000) {
      return NextResponse.json({ galat: "Pesan gak valid" }, { status: 400 });
    }
    r.seq++;
    r.log.push({ seq: r.seq, data: b.pesan });
    if (r.log.length > MAX_LOG) r.log.splice(0, r.log.length - MAX_LOG);
    return NextResponse.json({ ok: true, seq: r.seq });
  }
  return NextResponse.json({ galat: "Aksi gak dikenal" }, { status: 400 });
}
