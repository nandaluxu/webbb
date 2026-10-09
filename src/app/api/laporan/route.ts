import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";

export const runtime = "nodejs";

/* Kirim laporan (report) konten: pesan chat, komentar, post,
   jawaban AI, atau AKUN USER (r28). Login wajib (pelapor diambil
   dari sesi, gak bisa dipalsuin).

   Konten ny di-SNAPSHOT server-side dari database (bukan dari
   client), jadi laporan gak bisa dipalsuin isiny. Kecuali jenis
   "ai": riwayat AI ny cuma ada di browser user, jadi konteks ny
   dikirim client (maks 2000 karakter, dipotong di sini).

   User gak dapet apa-apa balikan selain "tersimpan": daftar, status,
   dan riwayat laporan cuma kebaca admin (/api/admin/laporan). */

const JENIS = ["pesan", "komentar", "media", "ai", "user"] as const;
type Jenis = (typeof JENIS)[number];

function jenisValid(j: string): j is Jenis {
  return (JENIS as readonly string[]).includes(j);
}

export async function POST(req: NextRequest) {
  const sesi = await bacaSesi();
  if (!sesi) {
    return NextResponse.json({ galat: "Login dulu biar bisa lapor." }, { status: 401 });
  }

  let badan: { jenis?: unknown; targetId?: unknown; konteks?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  const jenis = String(badan.jenis ?? "");
  if (!jenisValid(jenis)) {
    return NextResponse.json({ galat: "Jenis laporan ny gak dikenal." }, { status: 400 });
  }
  const targetId = typeof badan.targetId === "string" && badan.targetId ? badan.targetId.slice(0, 64) : null;

  let konteks = "";
  let pemilikNama = "";
  let targetKet = "";

  if (jenis === "pesan") {
    if (!targetId) return NextResponse.json({ galat: "Pesan ny gak ketemu." }, { status: 400 });
    const p = await db.pesan.findUnique({ where: { id: targetId } });
    if (!p) return NextResponse.json({ galat: "Pesan ny udah gak ada (mungkin udah kehapus)." }, { status: 404 });
    konteks = p.teks.slice(0, 2000);
    pemilikNama = p.nama;
    targetKet = "Chat global";
  } else if (jenis === "komentar") {
    if (!targetId) return NextResponse.json({ galat: "Komentar ny gak ketemu." }, { status: 400 });
    const k = await db.komentar.findUnique({ where: { id: targetId }, include: { user: true, media: true } });
    if (!k) return NextResponse.json({ galat: "Komentar ny udah gak ada (mungkin udah kehapus)." }, { status: 404 });
    konteks = k.teks.slice(0, 2000);
    pemilikNama = k.user.nama;
    targetKet = "Komentar di post " + (k.media.judul || k.media.nama);
  } else if (jenis === "media") {
    if (!targetId) return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 400 });
    const m = await db.media.findUnique({ where: { id: targetId }, include: { user: true } });
    if (!m) return NextResponse.json({ galat: "Post ny udah gak ada (mungkin udah kehapus)." }, { status: 404 });
    konteks = (m.judul || m.nama).slice(0, 2000);
    pemilikNama = m.user?.nama || "dari arsip";
    targetKet = "Post galeri";
  } else if (jenis === "user") {
    /* Laporan akun (r28): target = id user ny. Konteks ny = bio ny
       (aktivitas user ny kebaca dari akun ny — snapshot ny itu).
       User nyangkut di pemilikNama biar admin langsung tau siapa. */
    if (!targetId) return NextResponse.json({ galat: "User ny gak ketemu." }, { status: 400 });
    const u = await db.pengguna.findUnique({ where: { id: targetId } });
    if (!u) return NextResponse.json({ galat: "User ny udah gak ada." }, { status: 404 });
    konteks = (u.bio || "(tanpa bio)").slice(0, 2000);
    pemilikNama = u.nama;
    targetKet = "Profil " + (u.username ? "@" + u.username : u.nama);
  } else {
    /* AI: konten ny di browser user, jadi teks ny dibawa client
       (dipotong + dibersihin di sini). */
    konteks = String(badan.konteks ?? "")
      .slice(0, 2000)
      .trim();
    pemilikNama = "Ney (AI)";
    targetKet = "Jawaban Ney AI";
    if (!konteks) return NextResponse.json({ galat: "Isi yang dilapor kosong." }, { status: 400 });
  }

  await db.laporan.create({
    data: {
      jenis,
      targetId,
      targetKet: targetKet || null,
      pelaporId: sesi.id,
      konteks,
      pemilikNama,
    },
  });

  /* Sengaja gak ada id/tanggal yang kebalikin: user gak perlu (dan
     gak boleh) ngitung-ngitung laporan ny sendiri. */
  return NextResponse.json({ ok: true }, { status: 201 });
}
