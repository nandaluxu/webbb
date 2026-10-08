import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";

/* /api/notifikasi (r28, diperluas r29): pusat notifikasi milik user
   yang login.

   GET    -> 30 notifikasi terbaru (milik ny SENDIRI — penerimaId dari
             sesi server, gak bisa baca punya orang laen) + jumlah
             belum-dibaca. Aktor kebaca penuh (pfp/username/verified)
             kalau akunny masih ada; kalau udah kehapus, nama snapshot
             ny tetep kepake (tanpa link).
   PATCH  -> { id } tandai satu dibaca, { semua: true } tandai semua.
             Cuma bisa nyentuh punya sendiri (where penerimaId sesi).
   DELETE -> { ids: [...] } hapus banyak (mode pilih r29). Filter
             penerimaId sesi: id milik orang lain diemin aja (gak
             error, gak kehapus). Balikin jumlah kehapus + belum-
             dibaca terbaru biar badge ny sinkron. */

export async function GET() {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  const [baris, belum] = await Promise.all([
    db.notifikasi.findMany({
      where: { penerimaId: sesi.id },
      orderBy: { waktu: "desc" },
      take: 30,
      include: {
        aktor: { select: { id: true, nama: true, username: true, pfp: true, verified: true } },
        media: { select: { id: true, judul: true, nama: true } },
      },
    }),
    db.notifikasi.count({ where: { penerimaId: sesi.id, dibaca: null } }),
  ]);

  const daftar = baris.map((n) => ({
    id: n.id,
    jenis: n.jenis,
    waktu: n.waktu.toISOString(),
    dibaca: n.dibaca ? n.dibaca.toISOString() : null,
    /* aktor null = akunny udah kehapus: nama snapshot ny masih ada,
       link profil ny gak kebentuk (client ngecek). */
    aktor: n.aktor
      ? { id: n.aktor.id, nama: n.aktor.nama, username: n.aktor.username, pfp: n.aktor.pfp, verified: n.aktor.verified }
      : null,
    aktorNama: n.aktorNama,
    mediaId: n.mediaId,
    mediaJudul: n.media ? n.media.judul || n.media.nama : null,
  }));

  return NextResponse.json({ daftar, belum });
}

export async function DELETE(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  let badan: { ids?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  const ids = Array.isArray(badan.ids)
    ? badan.ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 100)
    : [];
  if (!ids.length) return NextResponse.json({ galat: "Gak ada notifikasi yang dipilih." }, { status: 400 });

  /* where penerimaId = sesi: id punya orang lain gak mungkin kehapus
     dari sini (deleteMany cuma nyocokin punya sendiri). */
  const hasil = await db.notifikasi.deleteMany({
    where: { id: { in: ids }, penerimaId: sesi.id },
  });
  const belum = await db.notifikasi.count({ where: { penerimaId: sesi.id, dibaca: null } });
  return NextResponse.json({ ok: true, terhapus: hasil.count, belum });
}

export async function PATCH(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  let badan: { id?: unknown; semua?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  const kini = new Date();
  if (badan.semua === true) {
    await db.notifikasi.updateMany({
      where: { penerimaId: sesi.id, dibaca: null },
      data: { dibaca: kini },
    });
    return NextResponse.json({ ok: true });
  }

  const id = typeof badan.id === "string" && badan.id ? badan.id : null;
  if (!id) return NextResponse.json({ galat: "Id notifikasiny kurang." }, { status: 400 });
  /* where penerimaId = sesi: id orang laen gak bisa ditandai dari
     sini (updateMany cocokin 0 row -> idempoten aman). */
  await db.notifikasi.updateMany({
    where: { id, penerimaId: sesi.id },
    data: { dibaca: kini },
  });
  return NextResponse.json({ ok: true });
}
