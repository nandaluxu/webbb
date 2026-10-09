import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";

/* /api/teman (r32): dapur fitur berteman.
   TEMAN = follow balik otomatis: relasi mutual di tabel Ikuti
   (aku ikut dia + dia ikut aku). Gak ada tabel teman sendiri —
   teman SELALU = irisan dua arah follow, jadi unfollow salah
   satu sisi = otomatis gak teman lagi (gak ada data nyangkut).

   GET ?ringkas=1  -> cuma angka buat badge menu:
     { ok, jumlahTeman, jumlahBelumBaca, jumlahIkutan }
   GET             -> daftar lengkap buat panel chat pribadi:
     { ok, teman[], pengikutBaru[], jumlahBelumBaca }
     - teman[]: mutual follow, tiap kotak bawa pesan terakhir
       (potongan) + jumlah belum baca dari dia. Urut dari obrolan
       yang paling segar (yang belum pernah chat ny = paling bawah,
       urut waktu jadi teman).
     - pengikutBaru[]: orang yang ikut aku tapi aku BELUM ikut
       balik -> saran "Follow balik" (sekali klik = langsung
       teman, persis permintaan fitur ny). */

export const runtime = "nodejs";

const PILIH_USER = {
  id: true,
  nama: true,
  username: true,
  pfp: true,
  verified: true,
} as const;

export async function GET(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  const ringkas = new URL(req.url).searchParams.get("ringkas") === "1";

  /* Dua arah follow di satu gempuran. */
  const [mengikuti, pengikut] = await Promise.all([
    db.ikuti.findMany({ where: { pengikutId: sesi.id }, select: { diikutiId: true, waktu: true } }),
    db.ikuti.findMany({ where: { diikutiId: sesi.id }, select: { pengikutId: true, waktu: true } }),
  ]);
  const setMengikuti = new Set(mengikuti.map((m) => m.diikutiId));
  const setPengikut = new Set(pengikut.map((p) => p.pengikutId));
  const waktuJadiTeman = new Map<string, Date>();
  for (const m of mengikuti) {
    if (setPengikut.has(m.diikutiId)) waktuJadiTeman.set(m.diikutiId, m.waktu);
  }

  /* Orang yang nge-follow aku tapi belum aku balas. */
  const idSaran = [...setPengikut].filter((id) => !setMengikuti.has(id));

  if (ringkas) {
    /* Badge menu: total pesan masuk yang belum dibaca dari SEMUA teman. */
    const jumlahBelumBaca = await db.pesanPribadi.count({
      where: { keId: sesi.id, baca: null },
    });
    return NextResponse.json({
      ok: true,
      jumlahTeman: waktuJadiTeman.size,
      jumlahIkutan: idSaran.length,
      jumlahBelumBaca,
    });
  }

  /* Profil teman + saran follow balik. */
  const idTeman = [...waktuJadiTeman.keys()];
  const [profilTeman, profilSaran] = await Promise.all([
    idTeman.length
      ? db.pengguna.findMany({ where: { id: { in: idTeman } }, select: PILIH_USER })
      : Promise.resolve([]),
    idSaran.length
      ? db.pengguna.findMany({ where: { id: { in: idSaran } }, select: PILIH_USER })
      : Promise.resolve([]),
  ]);

  /* Pesan terakhir tiap teman + yang belum dibaca: sekali ambil semua
     pesan ny yang nyangkut aku, terus dikelompokin di memori — gak
     N+1 query per teman. */
  const semua = await db.pesanPribadi.findMany({
    where: { OR: [{ dariId: sesi.id }, { keId: sesi.id }] },
    orderBy: { waktu: "desc" },
    select: { id: true, dariId: true, keId: true, teks: true, waktu: true, baca: true },
  });
  const terakhir = new Map<string, { teks: string; waktu: Date; dariSaya: boolean; baca: Date | null }>();
  const belumBaca = new Map<string, number>();
  for (const p of semua) {
    const lawan = p.dariId === sesi.id ? p.keId : p.dariId;
    if (!terakhir.has(lawan)) terakhir.set(lawan, { teks: p.teks, waktu: p.waktu, dariSaya: p.dariId === sesi.id, baca: p.baca });
    if (p.keId === sesi.id && !p.baca) belumBaca.set(lawan, (belumBaca.get(lawan) ?? 0) + 1);
  }

  const kotakTeman = profilTeman
    .map((t) => ({
      ...t,
      terakhir: terakhir.get(t.id) ?? null,
      belumBaca: belumBaca.get(t.id) ?? 0,
      jadiTeman: waktuJadiTeman.get(t.id) ?? null,
    }))
    .sort((a, b) => {
      const wa = a.terakhir?.waktu?.getTime() ?? a.jadiTeman?.getTime() ?? 0;
      const wb = b.terakhir?.waktu?.getTime() ?? b.jadiTeman?.getTime() ?? 0;
      return wb - wa;
    })
    .map((t) => ({
      id: t.id,
      nama: t.nama,
      username: t.username,
      pfp: t.pfp,
      verified: t.verified,
      terakhir: t.terakhir
        ? {
            teks: t.terakhir.teks.length > 120 ? t.terakhir.teks.slice(0, 117) + "..." : t.terakhir.teks,
            waktu: t.terakhir.waktu.toISOString(),
            dariSaya: t.terakhir.dariSaya,
          }
        : null,
      belumBaca: t.belumBaca,
    }));

  return NextResponse.json({
    ok: true,
    teman: kotakTeman,
    pengikutBaru: profilSaran,
    jumlahBelumBaca: [...belumBaca.values()].reduce((a, b) => a + b, 0),
  });
}
