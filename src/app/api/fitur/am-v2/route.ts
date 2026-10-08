import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";
import { mulaiGenerate, mulaiLinkHP, mulaiBulk, bukaInbox, bacaPesanUser, statusJob, jobAktifUser, statusBulkOwner, ambilPreset, bolehPreset, simpanTokenPreset, tahapKeTeks, hapusAkunUser } from "@/lib/am-v2";

export const runtime = "nodejs";

/* AM Premium V2 (r30): route gerbang ny. Aksi (POST body JSON):
   - mulai      : generate akun otomatis 1-klik (temp mail -> magic
                  link -> verifikasi -> premium). Job background,
                  UI polling GET.
   - link-hp    : { email } kirim link login BARU ke akun tersimpan
                  (claim/login buat aplikasi HP).
   - inbox      : { email } buka ulang kotak masuk akun tersimpan.
   - pesan      : { email, id } (r31) deteksi link pintar — baca
                  SATU pesan lengkap di server, keruk SEMUA link
                  ny (href + teks), balikin ke UI buat disalin /
                  dipencet. Kredensial mail.tm gak nyebrang ke
                  client.
   - preset     : { url } 5MB Converter — ekstrak XML + audio dari
                  link preset alight.link (token buat unduhan).
   - bulk       : { jumlah } khusus owner/admin (server yang
                  mutusin, bukan UI).
   - hapus-akun : { email } (r34) buang SATU akun dari daftar
                  riwayat user (menu klik kanan / tahan di tombol
                  email). Cuma arsip ny — premium ny gak
                  kebatalin.

   GET: status job aktif user + daftar akun V2 ny (+ status bulk
   kalo owner yang lagi jalanin). Semua ny dari SESI — gak ada
   parameter userId dari client, gak bisa baca punya orang laen. */

export async function GET(req: NextRequest) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  const url = new URL(req.url);
  const idJob = url.searchParams.get("job");

  /* Polling satu job (progress generator / link-hp / bulk). */
  if (idJob) {
    const j = statusJob(idJob);
    if (!j) return NextResponse.json({ galat: "Job ny gak ketemu (mungkin udah lama selesai)." }, { status: 404 });
    return NextResponse.json({
      job: j,
      teksTahap: j.jenis === "generate" || j.jenis === "linkhp" ? tahapKeTeks(j.tahap) : null,
    });
  }

  /* Default: ringkasan (job aktif buat recovery + akun tersimpan
     + status bulk kalo owner yang lagi jalanin). Semua ny dari
     sesi — gak bisa nyipir punya orang laen. */
  const akun = await db.amAkunV2.findMany({
    where: { userId: sesi.id, dariBulk: false },
    orderBy: { dibuat: "desc" },
    take: 20,
    select: { email: true, uid: true, kode: true, status: true, dibuat: true },
  });
  return NextResponse.json({
    aktif: jobAktifUser(sesi.id),
    bulk: apaOwner(sesi) ? statusBulkOwner(sesi.id) : null,
    akun: akun.map((a) => ({ email: a.email, uid: a.uid, kode: a.kode, status: a.status, waktu: a.dibuat.toISOString() })),
  });
}

export async function POST(req: NextRequest) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  let badan: { aksi?: unknown; email?: unknown; id?: unknown; url?: unknown; jumlah?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  const aksi = String(badan.aksi ?? "");

  if (aksi === "mulai") {
    const r = await mulaiGenerate(sesi.id);
    if ("galat" in r) return NextResponse.json({ galat: r.galat }, { status: 400 });
    return NextResponse.json({ id: r.id });
  }

  if (aksi === "link-hp") {
    const email = String(badan.email ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ galat: "Email akun ny belum dipilih." }, { status: 400 });
    const r = await mulaiLinkHP(sesi.id, email);
    if ("galat" in r) return NextResponse.json({ galat: r.galat }, { status: 400 });
    return NextResponse.json({ id: r.id });
  }

  if (aksi === "inbox") {
    const email = String(badan.email ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ galat: "Email akun ny belum dipilih." }, { status: 400 });
    const r = await bukaInbox(sesi.id, email);
    if ("galat" in r) return NextResponse.json({ galat: r.galat }, { status: 400 });
    return NextResponse.json(r);
  }

  if (aksi === "pesan") {
    const email = String(badan.email ?? "").trim().toLowerCase();
    const idPesan = String(badan.id ?? "").trim();
    if (!email || !idPesan) return NextResponse.json({ galat: "Pesan ny belum dipilih." }, { status: 400 });
    const r = await bacaPesanUser(sesi.id, email, idPesan);
    if ("galat" in r) return NextResponse.json({ galat: r.galat }, { status: 400 });
    return NextResponse.json(r);
  }

  if (aksi === "preset") {
    const url = String(badan.url ?? "").trim();
    if (!url) return NextResponse.json({ galat: "Tempel link preset ny dulu." }, { status: 400 });
    if (!bolehPreset(url)) {
      return NextResponse.json({ galat: "Link ny gak valid. Pakai link yang bener dari preset (alight.link)." }, { status: 400 });
    }
    const hasil = await ambilPreset(url);
    if ("galat" in hasil) return NextResponse.json({ galat: hasil.galat }, { status: 502 });
    const token = simpanTokenPreset(hasil);
    return NextResponse.json({
      judul: hasil.judul,
      deskripsi: hasil.deskripsi,
      pratinjau: hasil.pratinjau,
      paketId: hasil.paketId,
      adaXml: !!hasil.xmlUrl,
      adaAudio: !!hasil.audioUrl,
      /* Unduhan lewat server (token) — client gak pegang URL target. */
      unduhXml: hasil.xmlUrl ? "/api/fitur/am-v2/preset?token=" + token + "&jenis=xml" : null,
      unduhAudio: hasil.audioUrl ? "/api/fitur/am-v2/preset?token=" + token + "&jenis=audio" : null,
    });
  }

  if (aksi === "hapus-akun") {
    const email = String(badan.email ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ galat: "Email akun ny belum dipilih." }, { status: 400 });
    const r = await hapusAkunUser(sesi.id, email);
    if ("galat" in r) return NextResponse.json({ galat: r.galat }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (aksi === "bulk") {
    if (!apaOwner(sesi)) {
      return NextResponse.json({ galat: "Khusus owner." }, { status: 403 });
    }
    const jumlah = Number(badan.jumlah) || 0;
    if (!Number.isFinite(jumlah) || jumlah < 1) {
      return NextResponse.json({ galat: "Jumlah akun ny minimal 1." }, { status: 400 });
    }
    const r = await mulaiBulk(sesi.id, Math.min(20, Math.floor(jumlah)));
    if ("galat" in r) return NextResponse.json({ galat: r.galat }, { status: 409 });
    return NextResponse.json({ id: r.id });
  }

  return NextResponse.json({ galat: "Aksi ny gak dikenal." }, { status: 400 });
}
