import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { scanGaleri, susunPublik } from "@/lib/media-server";

/* Profil satu user + media ny. Dipake halaman /profil/[x].
   x = USERNAME (r27, bentuk baru) atau NAMA display (link lama —
   tetep kebaca biar bookmark/link lama gak mati).
   Stats yang dikirim:
   - jumlahPost: post yang keliatan buat penonton ny
   - sukaDiterima: SUM like di post milik user (BUKAN like yang
     user kasih) — ini angka "Like" di profil.
   - sukaDiberikan + jumlahKomentar: masuk section "Aktivitas
     lainnya" (optional, di-collapse).
   - jumlahPengikut / jumlahMengikuti: dari relasi Ikuti.
   - ikutiSaya: apakah penonton (kalau login) nge-follow user ini. */

async function cariUser(x: string) {
  const kunci = decodeURIComponent(x).replace(/\s+/g, " ").trim();
  const kecil = kunci.toLowerCase().replace(/^@+/, "");
  return (
    (await db.pengguna.findUnique({
      where: { username: kecil },
      select: { id: true, nama: true, username: true, jenis: true, pfp: true, bio: true, verified: true, dibuat: true },
    })) ??
    (await db.pengguna.findUnique({
      where: { nama: kunci },
      select: { id: true, nama: true, username: true, jenis: true, pfp: true, bio: true, verified: true, dibuat: true },
    }))
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ nama: string }> }) {
  const { nama } = await params;
  const user = await cariUser(nama);
  if (!user) return NextResponse.json({ galat: "User ny gak ketemu." }, { status: 404 });

  const sesi = await bacaSesi();
  await scanGaleri().catch(() => {});

  /* Visibility (r24), diputusin SERVER (client gak ngirim apa-apa):
     - profil sendiri: PUBLIC + PROFILE + PRIVATE (semuany)
     - profil orang lain: PUBLIC + PROFILE (PROFILE = cuma
       dibatasi dari Gallery, profil tetep keliatan orang lain;
       PRIVATE gak). */
  const pemilikSendiri = !!sesi && sesi.id === user.id;
  const [media, sukaDiberikan, jumlahKomentar, sukaDiterima, jumlahPengikut, jumlahMengikuti, ikutSaya] = await Promise.all([
    db.media.findMany({
      where: {
        userId: user.id,
        ...(pemilikSendiri ? {} : { visibilitas: { in: ["PUBLIC", "PROFILE"] } }),
      },
      orderBy: { waktu: "desc" },
      take: 100,
    }),
    db.suka.count({ where: { userId: user.id } }),
    db.komentar.count({ where: { userId: user.id } }),
    /* Like yang DITERIMA: like nempel di post milik user. */
    db.suka.count({ where: { media: { userId: user.id } } }),
    db.ikuti.count({ where: { diikutiId: user.id } }),
    db.ikuti.count({ where: { pengikutId: user.id } }),
    sesi && !pemilikSendiri
      ? db.ikuti.findUnique({ where: { pengikutId_diikutiId: { pengikutId: sesi.id, diikutiId: user.id } }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    user: { ...user, dibuat: user.dibuat.toISOString() },
    media: await Promise.all(media.map((m) => susunPublik(m, sesi?.id ?? null))),
    jumlahSuka: sukaDiberikan,
    sukaDiberikan,
    sukaDiterima,
    jumlahKomentar,
    jumlahPengikut,
    jumlahMengikuti,
    ikutiSaya: !!ikutSaya,
    punyaProfilSendiri: pemilikSendiri,
  });
}
