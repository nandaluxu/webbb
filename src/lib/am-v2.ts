/* AM Premium Generator V2 (r30): alur OTOMATIS 1-klik.
   Bahan ny: Alight_Motion_Suite_1.js (OmnifyLabs) — konsep ny
   diport ke arsitektur web ini:

   1. Bikin email sementara (mail.tm — REST publik, akun + sandi
      bisa dipakai login ulang kapan aja).
   2. Kirim magic link resmi ke email itu (REUSE lib V1 yang udah
      terbukti: link() — requestType 6, klien Android).
   3. Polling inbox (backoff 3s->12s, batas ~2 menit) sampai email
      verifikasi ny masuk, ekstrak link ny otomatis.
   4. Tuker jadi token (auth() V1) + aktivasi premium (pro() V1 —
      order ID tetap format V1: NeyhraPlayground-XXXXXX).

   Order/numbering + alur magic-link = V1 persis (requirement:
   jangan ngarang format baru). Yang baru cuma lapisan temp mail
   ny otomatis + state server-side.

   Kredensial temp mail (email + sandi) disimpen di DB (model
   AmAkunV2) nempel ke akun yang login — BUKAN localStorage —
   jadi inbox ny bisa dibuka ulang kapan aja (pindah halaman /
   refresh / balik lagi: tetep nyambung).

   Semua job (generate / link login HP / bulk) jalan di proses
   server dengan state in-memory (pola yang sama kayak sesi
   akinator) + hasil ny di DB. UI polling status ny (gak ada
   request yang ganteng di browser). */

import { db } from "@/lib/db";
import { link, auth, pro, emailValid } from "@/lib/am-premium";
import { bikinAkun, mintaToken, bacaInbox, bacaPesanDenganLink, cariLinkVerifikasi, type PesanRingkas } from "@/lib/mailtm";

/* ---------- State job in-memory ---------- */

export type TahapJob =
  | "menyiapkan"
  | "buat-mail"
  | "kirim-link"
  | "nunggu-email"
  | "verifikasi"
  | "aktivasi"
  | "selesai"
  | "gagal";

type JobGenerate = {
  id: string;
  jenis: "generate";
  userId: string;
  tahap: TahapJob;
  pesan: string;
  email: string | null;
  /* Akun yang berhasil dibikin (balikin ke UI + disimpen DB). */
  hasil: { email: string; uid: string | null; kode: string | null } | null;
  mulai: number;
};

type JobLinkHP = {
  id: string;
  jenis: "linkhp";
  userId: string;
  tahap: TahapJob;
  pesan: string;
  email: string | null;
  loginUrl: string | null;
  mulai: number;
};

type JobBulk = {
  id: string;
  jenis: "bulk";
  /* Email user (owner) yang ngejalanin. */
  userId: string;
  tahap: "jalan" | "selesai" | "gagal";
  pesan: string;
  total: number;
  selesaiN: number;
  berhasilN: number;
  gagalN: number;
  log: string[];
  hasil: { email: string; kode: string | null; loginUrl?: string }[];
  mulai: number;
};

const jobs = new Map<string, JobGenerate | JobLinkHP | JobBulk>();
/* Satu job aktif per user per jenis (anti dobel klik). */
const aktifGenerate = new Map<string, string>();
const aktifLinkHP = new Map<string, string>();
let bulkAktif: { userId: string; jobId: string } | null = null;

const UMUR_JOB_MS = 30 * 60 * 1000;

function bersihJobTua() {
  const kini = Date.now();
  for (const [id, j] of jobs) {
    if (kini - j.mulai > UMUR_JOB_MS * 2) jobs.delete(id);
  }
}

export function statusJob(id: string) {
  const j = jobs.get(id);
  if (!j) return null;
  return bentuk(j);
}

/* Job yang lagi aktif milik user ini (buat recovery: view ny
   balik dari refresh/pindah halaman, minta id job ny lagi dari
   sini — gak perlu nyimpen apa-apa di client). */
export function jobAktifUser(userId: string): { generate?: string; linkhp?: string } {
  const hasil: { generate?: string; linkhp?: string } = {};
  const idGen = aktifGenerate.get(userId);
  if (idGen) {
    const j = jobs.get(idGen) as JobGenerate | undefined;
    if (j && j.tahap !== "selesai" && j.tahap !== "gagal") hasil.generate = idGen;
  }
  const idHp = aktifLinkHP.get(userId);
  if (idHp) {
    const j = jobs.get(idHp) as JobLinkHP | undefined;
    if (j && j.tahap !== "selesai" && j.tahap !== "gagal") hasil.linkhp = idHp;
  }
  return hasil;
}

/* Status bulk buat owner (job terakhir yang masih relevan). */
export function statusBulkOwner(userId: string) {
  if (!bulkAktif) return null;
  if (bulkAktif.userId !== userId) return null;
  const j = jobs.get(bulkAktif.jobId) as JobBulk | undefined;
  if (!j) return null;
  return bentuk(j);
}

function bentuk(j: JobGenerate | JobLinkHP | JobBulk) {
  if (j.jenis === "generate") {
    return {
      id: j.id,
      jenis: "generate" as const,
      tahap: j.tahap,
      pesan: j.pesan,
      email: j.email,
      hasil: j.hasil,
      udahLama: Date.now() - j.mulai > UMUR_JOB_MS,
    };
  }
  if (j.jenis === "linkhp") {
    return {
      id: j.id,
      jenis: "linkhp" as const,
      tahap: j.tahap,
      pesan: j.pesan,
      email: j.email,
      loginUrl: j.loginUrl,
    };
  }
  return {
    id: j.id,
    jenis: "bulk" as const,
    tahap: j.tahap,
    pesan: j.pesan,
    total: j.total,
    selesaiN: j.selesaiN,
    berhasilN: j.berhasilN,
    gagalN: j.gagalN,
    log: j.log.slice(-12),
    hasil: j.hasil,
  };
}

function tahapKeTeks(t: TahapJob): string {
  switch (t) {
    case "menyiapkan":
      return "Menyiapkan...";
    case "buat-mail":
      return "Membuat alamat email sementara...";
    case "kirim-link":
      return "Mengirim magic link...";
    case "nunggu-email":
      return "Menunggu email verifikasi masuk...";
    case "verifikasi":
      return "Memverifikasi akun...";
    case "aktivasi":
      return "Mengaktifkan premium...";
    case "selesai":
      return "Berhasil";
    case "gagal":
      return "Gagal";
  }
}

export { tahapKeTeks };

function setJob(j: JobGenerate | JobLinkHP, tahap: TahapJob, pesan: string) {
  j.tahap = tahap;
  j.pesan = pesan;
}

/* ---------- Polling inbox (r31: flat 2 detik) ----------
   Dulu: backoff 3s -> 12s — email ny udah nyampe pun bisa kedeteksi
   sampe 12 detik kemudian, kerasa "menunggu lama banget". Padahal
   rate limit mail.tm 8 request per DETIK — polling tiap 2 detik
   cuma 0,5 req/detik, jauh banget di bawah batas. Sekarang: cek
   LANGSUNG (gak tidur dulu — email ny udah ada = langsung nemu),
   abis itu tiap 2 detik. abaikan = ID pesan lama (lihat
   cariLinkVerifikasi) — link-hp ny yang dipake biar link ny
   FRESH, bukan punya ny udah mati dari generate. */
async function tungguEmailVerifikasi(token: string, batasMs: number, abaikan?: Set<string>): Promise<{ link: string; subjek: string } | null> {
  const mulai = Date.now();
  while (Date.now() - mulai < batasMs) {
    try {
      const ketemu = await cariLinkVerifikasi(token, abaikan);
      if (ketemu) return ketemu;
    } catch {
      /* inbox keblokir bentar: lanjut polling (masih dalem batas). */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/* ---------- Job: generate akun otomatis ---------- */

export async function mulaiGenerate(userId: string): Promise<{ id: string } | { galat: string }> {
  bersihJobTua();
  if (aktifGenerate.has(userId)) {
    const id = aktifGenerate.get(userId)!;
    const j = jobs.get(id) as JobGenerate | undefined;
    if (j && j.tahap !== "selesai" && j.tahap !== "gagal") return { id };
    aktifGenerate.delete(userId);
  }
  const id = crypto.randomUUID();
  const job: JobGenerate = { id, jenis: "generate", userId, tahap: "menyiapkan", pesan: "Menyiapkan...", email: null, hasil: null, mulai: Date.now() };
  jobs.set(id, job);
  aktifGenerate.set(userId, id);
  void jalankanGenerate(id, job);
  return { id };
}

async function jalankanGenerate(id: string, job: JobGenerate) {
  try {
    /* 1. Email sementara. */
    setJob(job, "buat-mail", "Membuat alamat email sementara...");
    const akun = await bikinAkun();
    job.email = akun.email;

    /* 2. Magic link (lib V1 — alur + endpoint yang udah terbukti). */
    setJob(job, "kirim-link", "Mengirim magic link ke " + akun.email + "...");
    const kirim = await link(akun.email);
    if (!kirim.ok) {
      throw new Error("Magic link gagal dikirim. Server ny lagi sibuk atau nolak — coba lagi bentar.");
    }

    /* 3. Nunggu email masuk (paling lama 2 menit). */
    setJob(job, "nunggu-email", "Menunggu email verifikasi masuk ke " + akun.email + "...");
    const ketemu = await tungguEmailVerifikasi(akun.token, 120000);
    if (!ketemu) {
      throw new Error("Email verifikasi ny gak nyampe setelah 2 menit. Coba generate ulang.");
    }

    /* 4. Verifikasi (lib V1). */
    setJob(job, "verifikasi", "Memverifikasi akun...");
    const masuk = await auth(akun.email, ketemu.link);
    if (!masuk.ok) {
      throw new Error(masuk.why || "Verifikasi akun gagal.");
    }

    /* 5. Aktivasi premium (lib V1 — order NeyhraPlayground-XXXX). */
    setJob(job, "aktivasi", "Mengaktifkan premium 1 tahun...");
    const premium = await pro(masuk.id);
    if (!premium.ok) {
      throw new Error("Aktivasi premium gagal. Akun ny udah keverifikasi, coba lagi bentar.");
    }

    /* 6. Simpan kredensial temp mail ke DB (nempel ke user login). */
    const simpan = await db.amAkunV2
      .upsert({
        where: { userId_email: { userId: job.userId, email: akun.email } },
        create: {
          userId: job.userId,
          email: akun.email,
          sandiMail: akun.sandi,
          provider: "mailtm",
          uid: masuk.uid,
          kode: premium.order,
          status: "aktif",
        },
        update: { uid: masuk.uid, kode: premium.order, status: "aktif" },
      })
      .catch(() => null);
    if (!simpan) {
      /* Akun ny udah jadi; kagalan nyimpen kredensial gak boleh
         bikin proses ny "gagal" — inbox re-access ny aja yang gak
         kesimpen (dikasih tau jujur di pesan ny). */
      setJob(job, "selesai", "Premium aktif, tapi kotak masuk ny gak kesimpen (coba lagi nanti buat arsip email).");
    } else {
      setJob(job, "selesai", "Premium 1 tahun aktif buat " + akun.email);
    }
    job.hasil = { email: akun.email, uid: masuk.uid, kode: premium.order };
  } catch (e) {
    const pesan = e instanceof Error ? e.message : "Proses gagal. Coba lagi.";
    setJob(job, "gagal", pesan);
    job.hasil = null;
  } finally {
    setTimeout(() => {
      if (aktifGenerate.get(job.userId) === id) aktifGenerate.delete(job.userId);
    }, 15000);
  }
}

/* ---------- Job: link login HP (claim/login flow) ----------
   Kirim magic link BARU ke email akun yang udah tersimpan, tunggu
   masuk, ekstrak link ny — link itu yang dibuka di aplikasi HP. */

export async function mulaiLinkHP(userId: string, email: string): Promise<{ id: string } | { galat: string }> {
  bersihJobTua();
  const akun = await db.amAkunV2.findUnique({ where: { userId_email: { userId, email } } });
  if (!akun) return { galat: "Akun ny gak ketemu di daftar lu." };

  if (aktifLinkHP.has(userId)) {
    const id = aktifLinkHP.get(userId)!;
    const j = jobs.get(id) as JobLinkHP | undefined;
    if (j && j.tahap !== "selesai" && j.tahap !== "gagal") return { id };
    aktifLinkHP.delete(userId);
  }

  const id = crypto.randomUUID();
  const job: JobLinkHP = { id, jenis: "linkhp", userId, tahap: "menyiapkan", pesan: "Menyiapkan...", email, loginUrl: null, mulai: Date.now() };
  jobs.set(id, job);
  aktifLinkHP.set(userId, id);
  void jalankanLinkHP(id, job, akun.email, akun.sandiMail);
  return { id };
}

async function jalankanLinkHP(id: string, job: JobLinkHP, email: string, sandiMail: string) {
  try {
    /* Login ulang ke temp mail (kredensial dari DB — re-access). */
    setJob(job, "menyiapkan", "Masuk ke kotak masuk " + email + "...");
    const token = await mintaToken(email, sandiMail);

    /* Snapshot ID pesan yang udah ada SEBELUM link baru dikirim
       (fix r31): inbox ny masih nyimpen email verifikasi lama
       dari generate — link ny udah mati (kepake auth()). Tanpa
       snapshot, polling nemu link MATI itu dan job "selesai"
       pakai link kopong. Dengan snapshot: cuma email BARU yang
       dihitung, link ny fresh. */
    const lama = new Set<string>();
    try {
      for (const m of await bacaInbox(token)) lama.add(m.id);
    } catch {
      /* inbox kegagalan kebaca: lanjut tanpa snapshot (inibox
         biasany bisa kebaca lagi di polling berikutnya). */
    }

    setJob(job, "kirim-link", "Mengirim link login baru ke " + email + "...");
    const kirim = await link(email);
    if (!kirim.ok) {
      throw new Error("Link login gagal dikirim. Coba lagi bentar.");
    }

    setJob(job, "nunggu-email", "Menunggu email ny masuk (biasanya 10-60 detik) — link ny otomatis dijemput pas nyampe...");
    const ketemu = await tungguEmailVerifikasi(token, 120000, lama);
    if (!ketemu) {
      throw new Error("Email login ny gak nyampe setelah 2 menit. Coba lagi.");
    }

    /* Link fresh ketemu: LANGSUNG dilempar ke UI (loginUrl) —
       disalin / dipencet dari sononya, gak usah buka email ny. */
    job.loginUrl = ketemu.link;
    setJob(job, "selesai", "Link login siap. Buka di HP (bisa disalin).");
  } catch (e) {
    setJob(job, "gagal", e instanceof Error ? e.message : "Proses gagal.");
  } finally {
    setTimeout(() => {
      if (aktifLinkHP.get(job.userId) === id) aktifLinkHP.delete(job.userId);
    }, 15000);
  }
}

/* ---------- Kotak masuk (re-access, dari DB) ----------

   r31: daftar ny sekarang bawa ID pesan + intro ny dibersihin
   dari tag HTML yang nyangkut — ID ny yang dipake tombol
   "deteksi link" (aksi pesan) buat buka isi lengkap ny di
   server (kredensial mail.tm gak pernah nyebrang ke client). */
export async function bukaInbox(userId: string, email: string): Promise<{ daftar: { id: string; dari: string; subjek: string; waktu: string; intro: string }[] } | { galat: string }> {
  const akun = await db.amAkunV2.findUnique({ where: { userId_email: { userId, email } } });
  if (!akun) return { galat: "Akun ny gak ketemu di daftar lu." };
  try {
    const token = await mintaToken(akun.email, akun.sandiMail);
    const daftar: PesanRingkas[] = await bacaInbox(token);
    return {
      daftar: daftar.map((m) => ({ id: m.id, dari: m.dari, subjek: m.subjek, waktu: m.waktu, intro: bersihIntro(m.intro) })),
    };
  } catch {
    return { galat: "Kotak masukny gak bisa dibuka (mungkin udah kedaluwarsa di penyedia ny)." };
  }
}

/* ---------- Hapus akun dari daftar (r34) ----------
   Menu aksi di tombol email (klik kanan / tahan): buang SATU
   akun tersimpan milik sesi dari DB. Yang diapus cuma arsip ny
   (email + kredensial inbox) — premium ny yang udah aktif di
   aplikasi AM gak (dan gak bisa) dibatalin dari sini. */
export async function hapusAkunUser(userId: string, email: string): Promise<{ ok: true } | { galat: string }> {
  const r = await db.amAkunV2.deleteMany({ where: { userId, email } });
  if (r.count === 0) return { galat: "Akun ny gak ketemu di daftar lu." };
  return { ok: true };
}

/* Intro dari mail.tm kadang bawa sisa tag HTML kepotong
   ("<td>halo..." ) — dibersihin biar preview ny rapi. */
function bersihIntro(s: string): string {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

/* ---------- Baca SATU pesan + ekstraksi link pintar (r31) ----------
   Buat tombol "deteksi link" di kotak masuk: isi pesan dibuka
   server-side, SEMUA link ny dikeruk (href + teks), balikin ke
   UI buat disalin/dipencet. Isolasi sama kayak bukaInbox:
   akun harus milik sesi (userId_email), ID pesan ny di-cek
   ulang ke mail.tm pakai token milik inbox ny sendiri — ID
   nyangkut dari inbox laen cuma ketemu 404, gak ada yang bisa
   dicuri. */
export async function bacaPesanUser(userId: string, email: string, idPesan: string): Promise<{ subjek: string; dari: string; waktu: string; intro: string; teks: string; links: string[] } | { galat: string }> {
  const akun = await db.amAkunV2.findUnique({ where: { userId_email: { userId, email } } });
  if (!akun) return { galat: "Akun ny gak ketemu di daftar lu." };
  try {
    const token = await mintaToken(akun.email, akun.sandiMail);
    const hasil = await bacaPesanDenganLink(token, idPesan);
    if (!hasil) return { galat: "Pesan ny gak ketemu (mungkin udah dihapus penyediany)." };
    return {
      subjek: hasil.pesan.subjek,
      dari: hasil.pesan.dari,
      waktu: hasil.pesan.waktu,
      intro: bersihIntro(hasil.pesan.intro),
      teks: String(hasil.pesan.teks || "").slice(0, 2000),
      links: hasil.links.slice(0, 25),
    };
  } catch {
    return { galat: "Isi pesanny gak bisa dibuka. Coba lagi bentar." };
  }
}

/* ---------- Bulk account (owner/admin) ----------
   Port batchGenerateProAccounts bahan ny: maks 20 akun, jeda
   antar akun (>=10 akun -> 5 detik, dibawah ny 3 detik — aturan
   rate-limit bahan ny), 1 retry otomatis per akun, progress +
   hasil per akun. Satu bulk global pada satu waktu. */

export async function mulaiBulk(userId: string, jumlah: number): Promise<{ id: string } | { galat: string }> {
  if (bulkAktif) {
    if (bulkAktif.userId === userId) return { id: bulkAktif.jobId };
    return { galat: "Masih ada proses bulk yang jalan." };
  }
  const n = Math.max(1, Math.min(20, Math.floor(jumlah)));
  const id = crypto.randomUUID();
  const job: JobBulk = {
    id,
    jenis: "bulk",
    userId,
    tahap: "jalan",
    pesan: "Mulai " + n + " akun...",
    total: n,
    selesaiN: 0,
    berhasilN: 0,
    gagalN: 0,
    log: [],
    hasil: [],
    mulai: Date.now(),
  };
  jobs.set(id, job);
  bulkAktif = { userId, jobId: id };
  void jalankanBulk(id, job);
  return { id };
}

async function jalankanBulk(id: string, job: JobBulk) {
  const jeda = job.total >= 10 ? 5000 : 3000;
  try {
    for (let i = 0; i < job.total; i++) {
      job.pesan = "[" + (i + 1) + "/" + job.total + "] Generate akun...";
      const r = await satuAkunBulk();
      if (r) {
        job.berhasilN++;
        job.hasil.push({ email: r.email, kode: r.kode, loginUrl: r.loginUrl });
        job.log.push("[" + (i + 1) + "/" + job.total + "] Berhasil: " + r.email);
        /* Simpan kredensial ny ke DB (milik owner yang ngejalanin). */
        await db.amAkunV2
          .upsert({
            where: { userId_email: { userId: job.userId, email: r.email } },
            create: { userId: job.userId, email: r.email, sandiMail: r.sandi, provider: "mailtm", uid: r.uid, kode: r.kode, status: "aktif", dariBulk: true },
            update: { uid: r.uid, kode: r.kode, status: "aktif", dariBulk: true },
          })
          .catch(() => {});
      } else {
        job.gagalN++;
        job.log.push("[" + (i + 1) + "/" + job.total + "] Gagal, lanjut ke berikutnya");
      }
      job.selesaiN = i + 1;
      if (i < job.total - 1) {
        await new Promise((r) => setTimeout(r, jeda));
      }
    }
    job.tahap = "selesai";
    job.pesan = "Selesai: " + job.berhasilN + " berhasil, " + job.gagalN + " gagal.";
  } catch (e) {
    job.tahap = "gagal";
    job.pesan = e instanceof Error ? e.message : "Bulk gagal.";
  } finally {
    setTimeout(() => {
      if (bulkAktif?.jobId === id) bulkAktif = null;
    }, 60000);
  }
}

async function satuAkunBulk(): Promise<{ email: string; sandi: string; uid: string | null; kode: string | null; loginUrl?: string } | null> {
  /* 1 coba utama + 1 retry (pola bahan ny). */
  for (let percobaan = 0; percobaan < 2; percobaan++) {
    try {
      const akun = await bikinAkun();
      const kirim = await link(akun.email);
      if (!kirim.ok) throw new Error("kirim gagal");
      const ketemu = await tungguEmailVerifikasi(akun.token, 120000);
      if (!ketemu) throw new Error("email gak nyampe");
      const masuk = await auth(akun.email, ketemu.link);
      if (!masuk.ok) throw new Error("verifikasi gagal");
      const premium = await pro(masuk.id);
      if (!premium.ok) throw new Error("aktivasi gagal");
      return { email: akun.email, sandi: akun.sandi, uid: masuk.uid, kode: premium.order };
    } catch {
      if (percobaan === 0) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return null;
}

/* ---------- 5MB Converter: preset alight.link -> XML + audio ----------
   Port downloadPreset (bahan V2, bagian 15): buka halaman
   preset ny, ekstrak metadata og: + URL file XML (storage) +
   URL audio. Unduhan ny di-proxy dari server (token session —
   client GAK pernah ngasih URL unduhan langsung). */

type HasilPreset = {
  judul: string;
  deskripsi: string;
  pratinjau: string | null;
  xmlUrl: string | null;
  audioUrl: string | null;
  paketId: string;
};

/* Token hasil preset (in-memory, umur 30 menit): route unduhan ny
   cuma nerima token + jenis — URL target ny gak pernah dikirim
   balik ke client buat dipakai manggil. */
const tokenPreset = new Map<string, { data: HasilPreset; waktu: number }>();

export function bolehPreset(url: string): boolean {
  /* alight.link ATAU alightcreative.com (+ subdomain ny).
   Perbaikan r30: domain ny "alight.link" (alight TITIK link), bukan
   "alightlink" — regex lama nolak link yang bener. */
  return /^https?:\/\/([a-z0-9-]+\.)*(alight\.link|alightcreative\.com)\//i.test(url.trim());
}

export async function ambilPreset(url: string): Promise<HasilPreset | { galat: string }> {
  bersihPresetTua();
  try {
    const res = await fetch(url.trim(), {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    if (!res.ok) return { galat: "Halaman preset ny gak bisa dibuka (HTTP " + res.status + ")." };
    const html = await res.text();

    const judul = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] || /<title>([^<]*)<\/title>/i.exec(html)?.[1] || "Preset Alight Motion";
    const deskripsi = /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] || "";
    const pratinjau = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] || null;

    const xmlUrl = /https:\/\/storage\.googleapis\.com\/bsp-alight-creative-cms-public\/[^\s"'<>()]+/i.exec(html)?.[0] || null;
    const audioUrl = /https:\/\/[^\s"'<>]+\.(?:mp3|m4a|wav|aac)/i.exec(html)?.[0] || null;
    const paketId = /intent:\/\/alightcreative\.com\/am\/share\/u\/([^/]+)\/p\/([^?#"']+)/i.exec(html)?.[2] || "-";

    const data: HasilPreset = {
      judul: judul.replace(/\s+/g, " ").trim().slice(0, 120),
      deskripsi: deskripsi.replace(/\s+/g, " ").trim().slice(0, 300),
      pratinjau,
      xmlUrl,
      audioUrl,
      paketId,
    };
    return data;
  } catch {
    return { galat: "Gagal ngambil data preset ny. Cek link ny, terus coba lagi." };
  }
}

export function simpanTokenPreset(data: HasilPreset): string {
  const t = crypto.randomUUID();
  tokenPreset.set(t, { data, waktu: Date.now() });
  return t;
}

export function bacaTokenPreset(token: string, jenis: "xml" | "audio"): string | null {
  const simpan = tokenPreset.get(token);
  if (!simpan) return null;
  if (Date.now() - simpan.waktu > 30 * 60 * 1000) {
    tokenPreset.delete(token);
    return null;
  }
  return jenis === "xml" ? simpan.data.xmlUrl : simpan.data.audioUrl;
}

function bersihPresetTua() {
  const kini = Date.now();
  for (const [t, s] of tokenPreset) {
    if (kini - s.waktu > 30 * 60 * 1000) tokenPreset.delete(t);
  }
}

export { emailValid };
