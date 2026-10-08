/* Font emoji custom (NotoColorEmoji.ttf, 35MB) yang BENAR-BENAR
   opsional (r19):
   - DEFAULT = OFF. Selama OFF, browser gak minta file ny sama sekali
     (gak ada @font-face di CSS; font ny cuma ke-daftar lewat
     FontFace API dari sini, pas user nyala-in).
   - Nyalain: file ny diambil dari Cache API kalo udah pernah
     diunduh (gak unduh ulang); kalo belum, diunduh SEKALI (progres
     kebaca di Pengaturan) terus disimpen ke cache.
   - Matiin: FontFace ny dihapus dari document.fonts (emoji balik ke
     font sistem), tapi CACHE TETEP ADA (gak dihapus pas toggle OFF).
   - Status kesimpen di localStorage, jadi kunjungan berikutnya yang
     status ny ON langsung aktif dari cache tanpa unduh ulang.
   Nama keluarga "Noto Emoji Neyhra" ny nge-cocok sama stack font di
   globals.css: kalo font ny gak terdaftar, browser cuma ngeskip
   nama ny (gak ada request, gak nunggu apa pun).

   r20 — progres unduhan yang JUJUR:
   Dulu ny: content-length gak kebaca (proxy produksi / transfer
   chunked / respons ke-encode) -> kode jatuh ke res.arrayBuffer()
   yang gak ngasih event progres SAMA SEKALI -> UI nunjukin "0%"
   sepanjang unduhan (35MB = menit-menit), padahal unduhan jalan.
   Sekarang unduhan SELALU lewat stream reader, dan keadaan ny
   misah-misah fase:
   - "menyiapkan"   : fetch belum balas / baca cache (belum ada byte).
   - "terukur"      : total byte ketahuan -> persen ASLI (progres 0..1).
   - "tak-diketahui": total gak ada (atau content-encoding bikin
                      jumlah byte reader beda dari content-length —
                      persen ny bakal bohong) -> GAK ada persen
                      palsu: bar indeterminate + byte yang udah
                      nyampe (diterima) yang LIVE naek.
   Persen 100% (progres:1) cuma di-set SETELAH font ny beneran
   ke-daftar + aktif. */

const KUNCI = "neyhra:emoji";
const KUNCI_CACHE = "neyhra:aset";
const URL_FONT = "/aset/NotoColorEmoji.ttf";
const KELUARGA = "Noto Emoji Neyhra";
const RANGE =
  "U+1F000-1FAFF,U+2600-27BF,U+2B00-2BFF,U+2190-21FF,U+2300-23FF,U+25A0-25FF,U+FE0F,U+20E3,U+2049,U+203C";

/* State modul (di luar React biar gak dobel sumber kebenaran):
   - font: objek FontFace yang lagi terdaftar (null = mati).
   - unduhan: promise yang lagi jalan biar gak unduh 2x barengan. */
let font: FontFace | null = null;
let unduhan: Promise<void> | null = null;

export type StatusEmoji = "off" | "on";
export type FaseUnduh = "menyiapkan" | "terukur" | "tak-diketahui";
export type KeadaanEmoji = {
  /* Preferensi user (localStorage). */
  status: StatusEmoji;
  /* Font ny lagi ke-daftar di document.fonts? */
  aktif: boolean;
  /* Lagi diunduh/disiapkan sekarang? */
  mengunduh: boolean;
  /* Fase unduhan (null = gak lagi unduh): lihat header file. */
  fase: FaseUnduh | null;
  /* 0..1 — cuma BERMAKNA pas fase "terukur" (dan 1 pas selesai). */
  progres: number;
  /* Byte yang udah nyampe (jujur, naik live walau total gak
     ketahuan — dipake buat label "Mengunduh... X MB"). */
  diterima: number;
};

let keadaan: KeadaanEmoji = { status: statusAwal(), aktif: false, mengunduh: false, fase: null, progres: 0, diterima: 0 };

/* Snapshot awal (SSR + hydration): gak baca localStorage di server. */
const KEADAAN_AWAL: KeadaanEmoji = { status: "off", aktif: false, mengunduh: false, fase: null, progres: 0, diterima: 0 };

function statusAwal(): StatusEmoji {
  try {
    if (typeof window !== "undefined" && window.localStorage.getItem(KUNCI) === "on") return "on";
  } catch {}
  return "off";
}

function umpan() {
  window.dispatchEvent(new CustomEvent("emoji:ubah", { detail: { ...keadaan } }));
}

function ubahKeadaan(patch: Partial<KeadaanEmoji>) {
  keadaan = { ...keadaan, ...patch };
  umpan();
}

export function bacaStatus(): StatusEmoji {
  try {
    return window.localStorage.getItem(KUNCI) === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}

export function simpanStatus(s: StatusEmoji) {
  try {
    window.localStorage.setItem(KUNCI, s);
  } catch {}
  ubahKeadaan({ status: s });
}

export function bacaKeadaan(): KeadaanEmoji {
  /* Referensi stabil (dibaca useSyncExternalStore): object baru cuma
     dibikin pas keadaan ny beneran ganti (ubahKeadaan). */
  return keadaan;
}

/* Snapshot server buat hydration (gak baca localStorage). */
export function keadaanServer(): KeadaanEmoji {
  return KEADAAN_AWAL;
}

export function langgananEmoji(f: () => void) {
  window.addEventListener("emoji:ubah", f);
  return () => window.removeEventListener("emoji:ubah", f);
}

/* Apakah file ny udah ada di Cache API? (dipake buat misahin
   "nyalain dari cache" vs "perlu unduh"). */
export async function adaDiCache(): Promise<boolean> {
  try {
    if (!("caches" in window)) return false;
    const cache = await caches.open(KUNCI_CACHE);
    return !!(await cache.match(URL_FONT));
  } catch {
    return false;
  }
}

/* Info progres per-event dari stream unduhan. */
type InfoProgres = { fase: FaseUnduh; progres?: number; diterima: number };

async function ambilBuffer(progres?: (info: InfoProgres) => void): Promise<ArrayBuffer> {
  /* Cache dulu: kalo ada, ambil dari situ (0 request jaringan). */
  try {
    if ("caches" in window) {
      const cache = await caches.open(KUNCI_CACHE);
      const res = await cache.match(URL_FONT);
      if (res) return await res.arrayBuffer();
    }
  } catch {}

  /* Belum ada: unduh (SELALU lewat stream reader biar event progres
     hidup walau total gak ketahuan), terus simpan ke cache BIAR
     BESELL. */
  const res = await fetch(URL_FONT);
  if (!res.ok) throw new Error("Font emoji gak keunduh (" + res.status + ")");
  /* Total cuma bisa dipercaya buat persen kalo:
     - content-length ADA dan > 0, dan
     - GAK ada content-encoding (kalo ke-encode, content-length ny
       jumlah byte TERKOMPRES sedangkan reader ny ngasih byte
       TERDEKOMPRES — persen ny bakal bohong naek cepet/dobel). */
  const totalHeader = Number(res.headers.get("content-length")) || 0;
  const diencode = !!res.headers.get("content-encoding");
  const total = totalHeader > 0 && !diencode ? totalHeader : 0;

  let buf: ArrayBuffer;
  if (res.body) {
    const pembaca = res.body.getReader();
    const potongan: Uint8Array[] = [];
    let terkirim = 0;
    for (;;) {
      const { done, value } = await pembaca.read();
      if (done) break;
      potongan.push(value);
      terkirim += value.length;
      if (total > 0) {
        progres?.({ fase: "terukur", progres: Math.min(0.99, terkirim / total), diterima: terkirim });
      } else {
        progres?.({ fase: "tak-diketahui", diterima: terkirim });
      }
    }
    const gabung = new Uint8Array(terkirim);
    let offset = 0;
    for (const c of potongan) {
      gabung.set(c, offset);
      offset += c.length;
    }
    buf = gabung.buffer;
  } else {
    buf = await res.arrayBuffer();
  }
  try {
    if ("caches" in window) {
      const cache = await caches.open(KUNCI_CACHE);
      /* slice(0) = salinan independen (buf udah dipegang FontFace). */
      await cache.put(URL_FONT, new Response(buf.slice(0)));
    }
  } catch {}
  return buf;
}

/* Daftarin font ny ke document.fonts. Kalau font ny udah aktif,
    panggilan ny no-op. Progres unduhan ny kebagi lewat event
    emoji:ubah (dibaca Pengaturan), gak lewat callback. */
export async function aktifkanFontEmoji(): Promise<void> {
  if (font) return;
  if (unduhan) return unduhan;
  unduhan = (async () => {
    ubahKeadaan({ mengunduh: true, fase: "menyiapkan", progres: 0, diterima: 0 });
    try {
      const buf = await ambilBuffer((info) =>
        ubahKeadaan({ fase: info.fase, progres: info.progres ?? 0, diterima: info.diterima })
      );
      const f = new FontFace(KELUARGA, buf, { unicodeRange: RANGE, display: "swap" });
      await f.load();
      /* Sambil diunduh user bisa aja matiin ny: file ny udah
         ke-cache (sukur), tapi JANGAN di-daftar kalau preferensi ny
         udah gak ON lagi (gak boleh ada font nyala diam-diam).
         Nyalain lagi tinggal dari cache, murah. */
      if (keadaan.status !== "on") {
        ubahKeadaan({ mengunduh: false, fase: null, progres: 0, diterima: 0 });
        umpan();
        return;
      }
      document.fonts.add(f);
      font = f;
      /* 100% HANYA di sini: setelah cache keisi, FontFace ke-load,
         dan ke-daftar — proses beneran selesai. */
      ubahKeadaan({ aktif: true, mengunduh: false, fase: null, progres: 1, diterima: buf.byteLength });
      umpan();
    } catch (e) {
      ubahKeadaan({ mengunduh: false, fase: null, progres: 0, diterima: 0 });
      umpan();
      throw e;
    } finally {
      unduhan = null;
    }
  })();
  return unduhan;
}

/* Matiin custom emoji: hapus FontFace ny (emoji balik ke sistem),
    CACHE GAK DISENTUH. Kalau lagi diunduh, unduhanny diem-diem
    tetep beresin (file ny ke-cache buat sambilan), tapi FontFace ny
    GAK bakal di-daftar (guard status di aktifkanFontEmoji). */
export function matikanFontEmoji() {
  if (font) {
    document.fonts.delete(font);
    font = null;
  }
  ubahKeadaan({ aktif: false, mengunduh: false, fase: null, progres: 0, diterima: 0 });
}

/* Dipanggil sekali pas boot (Kerangka): kalo preferensi ny ON dan
    font ny ada di cache, langsung aktif dari cache (tanpa unduh).
    Kalo ON tapi cache ny ilang (ke-evict), unduh lagi di belakang:
    itu konsekuensi preferensi ny (dia minta custom emoji ny on). */
export async function bangunkanEmoji() {
  if (keadaan.status !== "on" || font) return;
  try {
    await aktifkanFontEmoji();
  } catch {
    /* Gagal pas boot (offline, file ilang): diem aja, gak ganggu
       halaman. Pengaturan bakal nunjukin keadaan ny. */
  }
}
