import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { unggahKeUguu } from "@/lib/uguu";
import { cariFilter, panggil, simpanHasil, hapusHasil, lagiProses, tandaiMulai, tandaiSelesai, udahLewatUmur, tungguGiliran, FILTER } from "@/lib/faa";

export const runtime = "nodejs";

/* AI Image Editor (r30): job server-side.
   POST (multipart): file + filter (+ nama artis buat filter yang
   butuh) -> foto diunggah ke penyimpanan sementara server-side ->
   row job dibikin (QUEUED) -> worker background ny ngerjain ny.
   Respons CEPAT (gak nunggu proses selesai — provider ny bisa
   40-180 detik, browser request gak boleh gantung).

   GET: status job aktif + riwayat user (polling dari view).
   - Expiry lazy: QUEUED/PROCESSING yang udah lewat 30 menit
     sejak mulai -> EXPIRED (diitung server, bukan dari kapan
     user ninggalin halaman).
   - Pemulihan restart: job QUEUED/PROCESSING yang gak ada di
     memori worker (server ke-restart) + masih segar -> masuk
     antrean LAGI (recovery refresh/restart).

   POST ada dua bentuk (r34):
   - JSON { aksi: "hapus", id }: hapus SATU riwayat (row + file
     hasil ny di disk). Cuma job yang udah terminal — yang
     masih jalan ditolak 409.
   - multipart (file + filter): submit job baru seperti biasa.

   Isolasi: semua query ny dari SESI (gak ada parameter userId
   dari client). Duplicate protection: satu job aktif per user
   (409 + id ny biar UI ny balik ke job yang sama, gak dobel
   submission walau tombol di-double-click). */

const TIPE_BOLEH = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const BATAS_BESAR = 32 * 1024 * 1024;

type BarisJob = {
  id: string;
  filter: string;
  namaFilter: string;
  artis: string | null;
  status: string;
  sumberNama: string;
  sumberUrl: string | null;
};

/* Worker: ngerjain SATU job sampai selesai (di-fire-and-forget dari
   POST / GET). Antrean serial ada di lib/faa (tungguGiliran). */
async function kerjakan(baris: BarisJob) {
  const def = cariFilter(baris.filter);
  if (!def || !baris.sumberUrl) {
    await db.editGambarJob.update({
      where: { id: baris.id },
      data: { status: "FAILED", pesan: "Job ny gak lengkap (data sumberny ilang).", selesai: new Date() },
    });
    return;
  }
  tandaiMulai(baris.id);
  try {
    await tungguGiliran();
    /* Patokan 30 menit = waktu job BENERAN mulai dikerjain. */
    const mulai = new Date();
    await db.editGambarJob.update({ where: { id: baris.id }, data: { status: "PROCESSING", mulai } });
    /* Lewat umur pas nunggu antrean terlalu lama: gak usah
       dikerjain lagi (EXPIRED, bukan FAILED). */
    if (udahLewatUmur(mulai, mulai)) {
      await db.editGambarJob.update({ where: { id: baris.id }, data: { status: "EXPIRED", selesai: new Date() } });
      return;
    }
    const hasil = await panggil(def, baris.sumberUrl, baris.artis ?? undefined);
    if (hasil.ok) {
      const jalur = await simpanHasil(baris.id, hasil.buffer, hasil.ext);
      const namaHasil = namaHasilUntuk(baris.sumberNama, def.label, hasil.ext);
      await db.editGambarJob.update({
        where: { id: baris.id },
        data: { status: "COMPLETED", hasilJalur: jalur, hasilMime: hasil.mime, hasilNama: namaHasil, selesai: new Date() },
      });
    } else {
      await db.editGambarJob.update({
        where: { id: baris.id },
        data: { status: "FAILED", pesan: hasil.pesan, selesai: new Date() },
      });
    }
  } catch (e) {
    const pesan = e instanceof Error && /timeout|abort/i.test(e.message) ? "Pemrosesan ny kelamaan, dibatalin." : "Pemrosesan gagal. Coba lagi.";
    await db.editGambarJob.update({ where: { id: baris.id }, data: { status: "FAILED", pesan, selesai: new Date() } }).catch(() => {});
  } finally {
    tandaiSelesai(baris.id);
  }
}

function namaHasilUntuk(sumber: string, label: string, ext: string): string {
  const dasar = (sumber || "foto")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return (dasar || "foto") + "-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "." + ext;
}

function bentukJob(j: {
  id: string;
  filter: string;
  namaFilter: string;
  artis: string | null;
  status: string;
  sumberNama: string;
  hasilNama: string | null;
  hasilMime: string | null;
  pesan: string | null;
  dibuat: Date;
  mulai: Date | null;
  selesai: Date | null;
}) {
  return {
    id: j.id,
    filter: j.filter,
    namaFilter: j.namaFilter,
    artis: j.artis,
    status: j.status,
    sumberNama: j.sumberNama,
    hasil: j.status === "COMPLETED" ? "/api/fitur/edit-gambar/" + j.id + "/hasil" : null,
    hasilNama: j.hasilNama,
    pesan: j.pesan,
    dibuat: j.dibuat.toISOString(),
    mulai: j.mulai?.toISOString() ?? null,
    selesai: j.selesai?.toISOString() ?? null,
  };
}

export async function GET() {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  /* Expiry lazy + pemulihan restart: job aktif yang gak lagi
     dikerjain worker -> kalo udah lewat umur: EXPIRED; kalo masih
     segar (server ke-restart di tengah jalan): masuk antrean lagi. */
  const aktifRows = await db.editGambarJob.findMany({
    where: { userId: sesi.id, status: { in: ["QUEUED", "PROCESSING"] } },
    orderBy: { dibuat: "desc" },
  });
  for (const j of aktifRows) {
    if (lagiProses(j.id)) continue;
    if (udahLewatUmur(j.mulai, j.dibuat)) {
      await db.editGambarJob.update({ where: { id: j.id }, data: { status: "EXPIRED", selesai: new Date() } }).catch(() => {});
    } else {
      void kerjakan({
        id: j.id,
        filter: j.filter,
        namaFilter: j.namaFilter,
        artis: j.artis,
        status: j.status,
        sumberNama: j.sumberNama,
        sumberUrl: j.sumberUrl,
      });
    }
  }

  const semua = await db.editGambarJob.findMany({
    where: { userId: sesi.id },
    orderBy: { dibuat: "desc" },
    take: 30,
  });
  const aktif = semua.find((j) => j.status === "QUEUED" || j.status === "PROCESSING") ?? null;
  return NextResponse.json({
    aktif: aktif ? bentukJob(aktif) : null,
    riwayat: semua.map(bentukJob),
    filter: FILTER.map((f) => ({ id: f.id, label: f.label, grup: f.grup, artis: !!f.artis })),
  });
}

export async function POST(req: NextRequest) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  /* Aksi JSON: hapus riwayat (menu klik kanan / tahan di item
     riwayat). Dipisah dari multipart upload biar dua bentuk
     request ny gak campur aduk di satu parser. */
  if ((req.headers.get("content-type") || "").includes("application/json")) {
    let badan: { aksi?: unknown; id?: unknown };
    try {
      badan = await req.json();
    } catch {
      return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
    }
    if (String(badan.aksi ?? "") !== "hapus") {
      return NextResponse.json({ galat: "Aksi ny gak dikenal." }, { status: 400 });
    }
    const id = String(badan.id ?? "").trim();
    if (!id) return NextResponse.json({ galat: "Riwayat ny belum dipilih." }, { status: 400 });

    /* Isolasi: id + userId — row milik sesi doang yang bisa
       diapus (id orang laen = 404, bukan kehapus). */
    const row = await db.editGambarJob.findFirst({ where: { id, userId: sesi.id } });
    if (!row) return NextResponse.json({ galat: "Riwayat ny gak ketemu." }, { status: 404 });
    if (row.status === "QUEUED" || row.status === "PROCESSING") {
      return NextResponse.json({ galat: "Tunggu proses ny selesai dulu, baru bisa dihapus." }, { status: 409 });
    }

    await db.editGambarJob.delete({ where: { id: row.id } }).catch(() => {});
    /* File hasil ny di disk ikut dibuang (kalo ada) — biar gak
       numpuk sampah di server. */
    await hapusHasil(row.hasilJalur);
    return NextResponse.json({ ok: true });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ galat: "Data ny gak kebaca." }, { status: 400 });
  }

  const filterId = String(form.get("filter") || "");
  const def = cariFilter(filterId);
  if (!def) return NextResponse.json({ galat: "Filter ny gak dikenal." }, { status: 400 });

  let artis: string | null = null;
  if (def.artis) {
    artis = String(form.get("artis") || "").trim().slice(0, 60);
    if (!artis) return NextResponse.json({ galat: "Nama artis ny belum diisi." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ galat: "Pilih fotonya dulu." }, { status: 400 });
  }
  if (file.size > BATAS_BESAR) {
    return NextResponse.json({ galat: "Fotonya kegedean (maks 32 MB)." }, { status: 413 });
  }
  if (file.type && !TIPE_BOLEH.includes(file.type)) {
    return NextResponse.json({ galat: "Cuma foto JPG/PNG/WEBP/GIF yang bisa diproses." }, { status: 415 });
  }

  /* Duplicate submission: satu job aktif per user. 409 + job ny
     biar UI balik ke job yang sama (bukan error mentah). */
  const sibukSama = await db.editGambarJob.findFirst({
    where: { userId: sesi.id, status: { in: ["QUEUED", "PROCESSING"] } },
    orderBy: { dibuat: "desc" },
  });
  if (sibukSama) {
    return NextResponse.json({ galat: "Masih ada proses yang jalan. Nungguin yang itu dulu.", id: sibukSama.id }, { status: 409 });
  }

  /* Upload sumber ke penyimpanan sementara (server-side; user gak
     lihat layanan ny apa). Ini bagian "Mengunggah..." di UI. */
  let sumberUrl: string;
  try {
    sumberUrl = await unggahKeUguu(file);
  } catch (e) {
    const pesan = e instanceof Error ? e.message : "Gagal menyiapkan foto ny.";
    return NextResponse.json({ galat: pesan }, { status: 502 });
  }

  const baru = await db.editGambarJob.create({
    data: {
      userId: sesi.id,
      filter: def.id,
      namaFilter: def.label,
      artis,
      status: "QUEUED",
      sumberNama: (file.name || "foto").slice(0, 120),
      sumberUrl,
    },
  });

  /* Fire-and-forget: worker ny jalan di background proses server —
     browser bebas refresh/pindah halaman, job tetep jalan. */
  void kerjakan({
    id: baru.id,
    filter: baru.filter,
    namaFilter: baru.namaFilter,
    artis: baru.artis,
    status: baru.status,
    sumberNama: baru.sumberNama,
    sumberUrl: baru.sumberUrl,
  });

  return NextResponse.json({ id: baru.id, status: "QUEUED" });
}
