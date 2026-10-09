import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { catatNotifikasi } from "@/lib/notifikasi";
import { tokenSebut } from "@/lib/sebut";
import {
  scanGaleri,
  susunPublik,
  bikinPratinjau,
  amanNama,
  bacaDimensi,
  jenisDariMime,
  BATAS_UNGGAH,
  BATAS_ITEM,
  DIR_MEDIA,
  jalurAsli,
  visibilitasAman,
} from "@/lib/media-server";

/* /api/galeri
   GET  (publik)  -> daftar post PUBLIC (Gallery = discovery public
                     doang; PROFILE cuma dibatasi dari sini, PRIVATE
                     cuma pemilik ny).
                     ?urut=waktu|suka|dilihat|komentar (default waktu,
                     DESC semua — r28 sort server-side biar konsisten
                     walau daftar makin panjang).
                     ?jenis=semua|foto|video (default semua).
   POST (login)   -> upload 1 post: bisa BANYAK file dalam satu post
                     (maks BATAS_ITEM, masing-maks 10MB) + judul +
                     visibility (divalidasi server, default PUBLIC). */

const URUT_VALID = ["waktu", "suka", "dilihat", "komentar"] as const;
const JENIS_VALID = ["semua", "foto", "video"] as const;

export async function GET(req: Request) {
  const sesi = await bacaSesi();
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") || undefined;
  const urutRaw = url.searchParams.get("urut") || "waktu";
  const jenisRaw = url.searchParams.get("jenis") || "semua";
  const urut = (URUT_VALID as readonly string[]).includes(urutRaw) ? urutRaw : "waktu";
  const jenis = (JENIS_VALID as readonly string[]).includes(jenisRaw) ? jenisRaw : "semua";

  await scanGaleri().catch(() => {});
  const baris = await db.media.findMany({
    where: {
      visibilitas: "PUBLIC",
      ...(userId ? { userId } : {}),
      /* Filter jenis (r28): server-side, jadi gak ada kartu video
         nyasar ke "Foto only". */
      ...(jenis === "foto" || jenis === "video" ? { jenis } : {}),
    },
    orderBy: { waktu: "desc" },
    take: 200,
  });
  const daftar = await Promise.all(baris.map((b) => susunPublik(b, sesi?.id ?? null)));
  /* Sort server-side (r28): suka/dilihat/komentar dihitung dari data
     ny sama (susunPublik), tie-break = terbaru duluan (stabil). */
  if (urut !== "waktu") {
    daftar.sort((a, b) => {
      const d =
        urut === "suka" ? b.suka - a.suka : urut === "dilihat" ? b.dilihat - a.dilihat : b.komentar - a.komentar;
      if (d !== 0) return d;
      return a.waktu < b.waktu ? 1 : a.waktu > b.waktu ? -1 : 0;
    });
  }
  return NextResponse.json({ daftar });
}

export async function POST(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi) {
    return NextResponse.json({ galat: "Login dulu buat upload." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ galat: "Data upload ny gak kebaca." }, { status: 400 });
  }
  const judul = String(form.get("judul") || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const visibilitas = visibilitasAman(form.get("visibilitas"));
  /* r30: izin unduhan uploader. Form ny kirim "1"/"0" (checkbox
     HTML cuma ngasih "1" pas nyala). Default ny TRUE (perilaku
     lama: semua post bisa diunduh). */
  const bolehUnduh = form.get("bolehUnduh") !== "0";

  /* Multi-file (r24): SATU post = beberapa media. Semua file yang
     kekirim di-field "file" jadi item post yang sama (urut urutan
     form). Validasi per-file sama kayak dulu (jenis + ukuran). */
  const fileSemua = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!fileSemua.length) {
    return NextResponse.json({ galat: "Pilih file foto atau video dulu." }, { status: 400 });
  }
  if (fileSemua.length > BATAS_ITEM) {
    return NextResponse.json({ galat: "Maksimal " + BATAS_ITEM + " file dalam satu post." }, { status: 400 });
  }

  const itemValid: { file: File; jenis: "foto" | "video" }[] = [];
  for (const file of fileSemua) {
    if (file.size > BATAS_UNGGAH) {
      return NextResponse.json(
        { galat: fileSemua.length > 1 ? `Salah satu file ny ${(file.size / 1048576).toFixed(1)} MB, batasnya 10 MB per media.` : `File ny ${(file.size / 1048576).toFixed(1)} MB, batasnya 10 MB per media.` },
        { status: 413 }
      );
    }
    const jenis = jenisDariMime(file.type || "");
    if (!jenis) {
      return NextResponse.json({ galat: "Cuma foto atau video yang bisa diupload ke galeri." }, { status: 415 });
    }
    itemValid.push({ file, jenis });
  }

  /* Simpan file dulu (id per item), baru bikin row parent + items. */
  await mkdir(DIR_MEDIA, { recursive: true });
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const dataItem: {
    urutan: number;
    jenis: string;
    pathAsli: string;
    nama: string;
    ukuran: number;
    lebar?: number;
    tinggi?: number;
  }[] = [];

  for (let i = 0; i < itemValid.length; i++) {
    const { file, jenis } = itemValid[i];
    const namaAsli = amanNama(file.name || (jenis === "foto" ? "foto.jpg" : "video.mp4"));
    const ekstensi = namaAsli.toLowerCase().split(".").pop() || (jenis === "foto" ? "jpg" : "mp4");
    const jalurSimpan = path.join("data", "media", `${id}-${i}.${ekstensi}`);
    const penyangga = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(process.cwd(), jalurSimpan), penyangga);
    const dims = await bacaDimensi(path.join(process.cwd(), jalurSimpan), jenis).catch(() => null);
    dataItem.push({
      urutan: i,
      jenis,
      pathAsli: jalurSimpan,
      nama: namaAsli,
      ukuran: file.size,
      ...(dims ? { lebar: dims.lebar, tinggi: dims.tinggi } : {}),
    });
  }

  const pertama = dataItem[0];
  const baru = await db.media.create({
    data: {
      jenis: pertama.jenis,
      dari: "unggah",
      /* Parent tetep nyimpen file PERTAMA (kompatibilitas data lama +
         unique constraint); file beneran dibaca dari MediaItem. */
      pathAsli: pertama.pathAsli,
      nama: pertama.nama,
      judul: judul || null,
      ukuran: pertama.ukuran,
      userId: sesi.id,
      visibilitas,
      bolehUnduh,
      ...(pertama.lebar && pertama.tinggi ? { lebar: pertama.lebar, tinggi: pertama.tinggi } : {}),
      item: {
        create: dataItem.map((d) => ({
          urutan: d.urutan,
          jenis: d.jenis,
          pathAsli: d.pathAsli,
          nama: d.nama,
          ukuran: d.ukuran,
          ...(d.lebar && d.tinggi ? { lebar: d.lebar, tinggi: d.tinggi } : {}),
        })),
      },
    },
  });

  // pratinjau item pertama dibikin duluan biar kartu langsung siap
  await bikinPratinjau(baru.id, pertama.jenis, jalurAsli({ dari: "unggah", pathAsli: pertama.pathAsli })).catch(() => null);

  /* Mention @username di caption (r28): di-RESOLVE di server (bukan
     cuma teks), nyimpen user ID lewat MediaSebut (username ganti ->
     relasi + notifikasi tetep valid), satu user sekali per post
     (unique constraint), notifikasi MENTION cuma buat user laen
     (nyebut diri sendiri = gak ada notifikasi). Gagal sebagian gak
     boleh gagalin upload ny. Parser token ny di lib/sebut (SATU
     sumber, dipake bareng komentar r29). */
  try {
    for (const u of tokenSebut(judul)) {
      const target = await db.pengguna.findUnique({ where: { username: u }, select: { id: true } });
      if (!target) continue; /* username gak ada: tetep teks biasa */
      if (target.id === sesi.id) continue; /* nyebut diri sendiri: teks
        doang — gak ada relasi, gak ada notifikasi */
      try {
        await db.mediaSebut.create({ data: { mediaId: baru.id, userId: target.id } });
        void catatNotifikasi(target.id, sesi.id, "MENTION", baru.id);
      } catch {
        /* Bentrok unique (P2002) = udah ke-mention di post ini —
           idempoten. Lain ny diemin: mention best-effort, upload udah
           sukses dan gak boleh gagal gara-gara ini. */
      }
    }
  } catch {}

  return NextResponse.json({ media: await susunPublik(baru, sesi.id) }, { status: 201 });
}
