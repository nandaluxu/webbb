/* Helper client: nama login (cuma di browser, gak ada database ny)
   dan sesi/riwayat chat AI. */

const KUNCI_NAMA = "neyhra:nama";
const KUNCI_SESI_AI = "neyhra:ai-sesi";
const KUNCI_RIWAYAT_AI = "neyhra:ai-riwayat";

export type SesiAILokal = {
  cookie: string;
  deviceId: string;
  parentMessageId: string;
  chatId: string | null;
};

export type RiwayatAI = {
  peran: "aku" | "ney";
  teks: string;
  /* Kapan pesan ny kekirim (epoch ms). Entri lama sebelum kolom ny
     ada gak punya: salin-chat otomatis skip stempel waktu ny. */
  waktu?: number;
};

function bacaJSON<T>(kunci: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(kunci);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function simpanJSON(kunci: string, nilai: unknown) {
  try {
    localStorage.setItem(kunci, JSON.stringify(nilai));
  } catch {
    /* penyimpanan penuh/diblokir: biarin, fitur tetap jalan tanpa simpen */
  }
}

export function bacaNama(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(KUNCI_NAMA);
  } catch {
    return null;
  }
}

export function simpanNama(nama: string) {
  try {
    localStorage.setItem(KUNCI_NAMA, nama);
  } catch {}
}

export function hapusNama() {
  try {
    localStorage.removeItem(KUNCI_NAMA);
  } catch {}
}

export function bacaSesiAI(): SesiAILokal | null {
  return bacaJSON<SesiAILokal>(KUNCI_SESI_AI);
}

export function simpanSesiAI(sesi: SesiAILokal) {
  simpanJSON(KUNCI_SESI_AI, sesi);
}

export function hapusSesiAI() {
  try {
    localStorage.removeItem(KUNCI_SESI_AI);
    localStorage.removeItem(KUNCI_RIWAYAT_AI);
  } catch {}
}

export function bacaRiwayatAI(): RiwayatAI[] {
  return bacaJSON<RiwayatAI[]>(KUNCI_RIWAYAT_AI) ?? [];
}

export function simpanRiwayatAI(riwayat: RiwayatAI[]) {
  simpanJSON(KUNCI_RIWAYAT_AI, riwayat.slice(-120));
}
