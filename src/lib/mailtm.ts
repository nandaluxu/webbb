/* mail.tm client (r30, AM Premium V2): port REST publik mail.tm
   ke fetch Node. Dipake generator V2 buat bikin email sementara
   otomatis + nungguin email verifikasi masuk + dibuka ulang kapan
   aja (login ulang pakai sandi — ini yang bikin temp mail ny gak
   hilang walau user pindah halaman/refresh).

   API ny (dokumentasi publik mail.tm):
   - GET  /domains                 -> daftar domain aktif
   - POST /accounts {address,pwd}  -> bikin akun (201)
   - POST /token   {address,pwd}   -> {token} (JWT, umur ny lama)
   - GET  /messages (Bearer)       -> daftar pesan (subjek + intro)
   - GET  /messages/{id} (Bearer)  -> isi pesan lengkap (text/html)

   Umur akun mail.tm: lama (akun + sandi tetep bisa dipakai login
   ulang berminggu-minggu) — nyimpen kredensialny di DB server
   (model AmAkunV2) cukup aman buat kebutuhan re-access.

   Rate limit mail.tm: 8 request per detik — polling pakai jeda
   3-12 detik (exponential backoff), jauh di bawah batas. */

const BASE = "https://api.mail.tm";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

export type AkunTemp = {
  email: string;
  sandi: string;
  token: string;
};

export type PesanRingkas = {
  id: string;
  dari: string;
  subjek: string;
  intro: string;
  waktu: string;
};

export type PesanLengkap = PesanRingkas & {
  teks: string;
  html: string | null;
};

async function req(url: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; ok: boolean; data: any }> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": UA,
  };
  if (init.token) headers.authorization = "Bearer " + init.token;
  const res = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(25000),
    cache: "no-store",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

function sandiAcak(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return "Np" + [...b].map((x) => a[x % a.length]).join("");
}

function namaAcak(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  return "neyhra" + [...b].map((x) => a[x % a.length]).join("");
}

/* Bikin akun baru: domain aktif pertama yang kebaca. Balikin
   kredensialny (email + sandi + token) — SEMUANYA perlu disimpen
   kalau mau buka inbox ny lagi nanti. */
export async function bikinAkun(): Promise<AkunTemp> {
  const dmn = await req(BASE + "/domains");
  const daftar: { domain: string; isActive: boolean }[] = Array.isArray(dmn.data) ? dmn.data : [];
  const domain = daftar.find((x) => x.isActive && x.domain)?.domain || daftar[0]?.domain;
  if (!domain) throw new Error("Penyedia email sementara lagi gak bisa dihubungi.");

  const email = namaAcak() + "@" + domain;
  const sandi = sandiAcak();

  const buat = await req(BASE + "/accounts", {
    method: "POST",
    body: JSON.stringify({ address: email, password: sandi }),
  });
  if (buat.status !== 201 && buat.status !== 200) {
    throw new Error("Gagal bikin alamat email sementara. Coba lagi bentar.");
  }

  const tok = await mintaToken(email, sandi);
  return { email, sandi, token: tok };
}

/* Login ulang pakai kredensial yang disimpen (re-access inbox). */
export async function mintaToken(email: string, sandi: string): Promise<string> {
  const r = await req(BASE + "/token", {
    method: "POST",
    body: JSON.stringify({ address: email, password: sandi }),
  });
  const token = r.data?.token;
  if (!r.ok || !token) throw new Error("Gagal masuk ke kotak masuk email sementara.");
  return token as string;
}

/* Daftar pesan di inbox (ringkas). */
export async function bacaInbox(token: string): Promise<PesanRingkas[]> {
  const r = await req(BASE + "/messages", { token });
  if (!r.ok) return [];
  const isi: any[] = Array.isArray(r.data?.["hydra:member"]) ? r.data["hydra:member"] : Array.isArray(r.data) ? r.data : [];
  return isi.map((m) => ({
    id: String(m.id),
    dari: String(m.from?.address || m.from || ""),
    subjek: String(m.subject || ""),
    intro: String(m.intro || ""),
    waktu: String(m.createdAt || ""),
  }));
}

/* Isi satu pesan (buat ekstrak link verifikasi dari HTML ny). */
export async function bacaPesan(token: string, id: string): Promise<PesanLengkap | null> {
  const r = await req(BASE + "/messages/" + encodeURIComponent(id), { token });
  if (!r.ok || !r.data) return null;
  return {
    id: String(r.data.id),
    dari: String(r.data.from?.address || r.data.from || ""),
    subjek: String(r.data.subject || ""),
    intro: String(r.data.intro || ""),
    waktu: String(r.data.createdAt || ""),
    teks: String(r.data.text || ""),
    html: r.data.html ? String(r.data.html) : null,
  };
}

/* Cari link verifikasi (oobCode) di pesan inbox. DOMBAK dari
   pola bahan V2: email Firebase ny nyata ny nyimpan link ny
   KEBUNGKUS + TERENCODE di parameter link= (contoh nyata
   kejaring pas audit: href="...firebaseapp.com/__/auth/links?
   link=...%26mode%3DsignIn%26oobCode%3D6kSEp...") — jadi "oobCode="
   literal GAK pernah muncul di teks mentahny (yang muncul
   oobCode%3D). Makany: kumpulin semua URL kandidat (href + teks
   biasa), cek versi mentah ATAU terdecode-nya. URL kandidat yang
   lolos tetep diproses ekstraksi oobCode di lib am-premium
   (kodeOob ny V1 — udah biasa buka bungkusan link/q/url).

   abaikan = snapshot ID pesan yang UDAH ADA sebelum link baru
   dikirim (fix r31): link-hp kirim link BARU ke inbox yang masih
   nyimpen email verifikasi lama dari generate — link lama ny udah
   dipake auth(), tapi cariLinkVerifikasi ny tetep nyatuin dia
   (match oobCode) -> job "selesai" dengan link MATI. Snapshot
   ID dikerjain di am-v2 pas mau ngirim; di sini cuma skip ID ny
   (tahan clock-skew + urutan API, gak liat waktu).

   Cek dulu baru tidur: loop ny ngecek SEBELUM sleep pertama (di
   pola lama dia tidur dulu 3 detik baru cek — email ny udah ada
   pun tetep nunggu). */
function urlKandidat(s: string): string[] {
  const pola = /https:\/\/[^\s"'<>\\]+/gi;
  return [...s.matchAll(pola)].map((m) => m[0]);
}

function bawaOob(url: string): boolean {
  if (/oobCode=/i.test(url)) return true;
  try {
    return /oobCode=/i.test(decodeURIComponent(url));
  } catch {
    return false;
  }
}

export async function cariLinkVerifikasi(token: string, abaikan?: Set<string>): Promise<{ link: string; subjek: string } | null> {
  const daftar = await bacaInbox(token);
  for (const m of daftar) {
    /* Pesen lama (id udah ada sebelum link baru dikirim) di-skip:
    link ny udah kepake / kedaluwarsa — nyatuin dia = bikin job
    selesai pakai link mati. */
    if (abaikan && abaikan.has(m.id)) continue;
    /* Cek cepat dari intro + teks biasa (hemat request isi pesan). */
    const cocokCepat = urlKandidat(m.intro).find(bawaOob);
    if (cocokCepat) return { link: cocokCepat, subjek: m.subjek };
    const penuh = await bacaPesan(token, m.id);
    if (!penuh) continue;
    const cocok = urlKandidat((penuh.html || "") + " " + (penuh.teks || "") + " " + m.intro).find(bawaOob);
    if (cocok) return { link: cocok, subjek: m.subjek };
  }
  return null;
}

/* ---------- Ekstraktor link pintar (r31, smart link) ----------
   Buat tombol "deteksi link" di kotak masuk: baca SATU pesan
   lengkap, keruk SEMUA link ny (href dari HTML + URL di teks
   biasa, HTML entity di-decode dulu), balikin daftarnya yang
   unik. Urutan ny: href duluan (paling bisa dipercaya — itu
   link nyata yang dipasang pengirim ny), baru URL dari teks.
   Tanda baca nyangkut di ujung URL teks biasa ("lihat a.b.com.")
   dibuang biar gak ada link kopong. */
function tautanRapi(u: string): string {
  return u.replace(/[.,;:!?)\]]+$/g, "");
}

/* Entity HTML standar yang biasa nyangkut di URL email
   (&amp; paling sering — parameter query ny real ny kena
   escape). Di-decode SEBELUM masuk daftar biar gak dobel
   (versi mentah + versi decode nyatu jadi satu). */
function decodeEntitas(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function bacaPesanDenganLink(token: string, id: string): Promise<{ pesan: PesanLengkap; links: string[] } | null> {
  const pesan = await bacaPesan(token, id);
  if (!pesan) return null;

  const links: string[] = [];
  const lihat = new Set<string>();
  const masuk = (u: string) => {
    if (!/^https?:\/\//i.test(u)) return;
    if (lihat.has(u)) return;
    lihat.add(u);
    links.push(u);
  };

  /* 1. href nyata dari HTML email (entity ny di-decode dulu —
     href="...x=1&amp;y=2" real ny "...x=1&y=2"). */
  if (pesan.html) {
    for (const m of pesan.html.matchAll(/href=["']([^"']+)["']/gi)) {
      masuk(tautanRapi(decodeEntitas(m[1])));
    }
  }
  /* 2. URL di teks biasa + HTML yang udah di-decode entity ny
     (&amp; dll — email ny real ny HTML-escaped, URL ny kepotong
     kalo gak di-decode). */
  const gabung = decodeEntitas((pesan.html || "") + "\n" + (pesan.teks || ""));
  for (const m of gabung.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) {
    masuk(tautanRapi(m[0]));
  }

  return { pesan, links };
}
