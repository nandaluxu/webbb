/* Format angka/durasi tampilan (r27 / P1-4). Dipake AIO + tempat
   lain yang butuh format Indonesia yang konsisten.

   Kontrak yang KEDAFTAR LIVE pas audit:
   - j2download YouTube: duration STRING "3:33", viewCount STRING
     digit "1823722672".
   - j2download TikTok: duration ANGKA MILIDETIK (24564 = 24.40
     detik, kebukti lewat ffprobe video asliny), viewCount null.
   - lengthSeconds (fallback j2): ANGKA DETIK (nama field ny
     detik, dan itu kontrak API ny).

   Aturan formatter:
   - formatJumlah: CUMA buat angka penonton/viewer. Angka biasa ->
     Intl.NumberFormat("id-ID") (165656 -> "165.656"). String digit
     dibaca dulu jadi angka. Yang bukan angka sama sekali -> null
     (pemanggil ny skip barisny).
   - formatDurasi: 0 -> "0:00", 5 -> "0:05", 65 -> "1:05",
     655 -> "10:55", >=1 jam -> "1:05:33". Input DETIK (unit
     dikonfirmasi dulu sama pemanggilny — jangan asal bagi 1000). */

const pembagi = new Intl.NumberFormat("id-ID");

/* Angka penonton: 165656 -> "165.656". null kalau bukan angka. */
export function formatJumlah(nilai: unknown): string | null {
  if (nilai == null || nilai === "") return null;
  const bersih = typeof nilai === "number" ? String(nilai) : String(nilai).replace(/[^\d-]/g, "");
  /* String kosong setelah dikerok = gak ada angka sama sekali
     (Number("") = 0, jangan kehitung jadi nol). */
  if (!bersih || /^-+$/.test(bersih)) return null;
  const n = Number(bersih);
  if (!Number.isFinite(n)) return null;
  return pembagi.format(n);
}

function dua(n: number): string {
  return String(Math.floor(n)).padStart(2, "0");
}

/* Detik -> "M:SS" (atau "H:MM:SS" kalau >= 1 jam). */
export function formatDurasiDetik(totalDetik: number): string {
  const detik = Math.max(0, Math.round(totalDetik));
  const jam = Math.floor(detik / 3600);
  const sisa = detik % 3600;
  const menit = Math.floor(sisa / 60);
  const detikSisa = sisa % 60;
  if (jam > 0) return jam + ":" + dua(menit) + ":" + dua(detikSisa);
  return menit + ":" + dua(detikSisa);
}

/* Milidetik -> format durasi (pembagi 1000 DI SINI, karena unit ny
   emang udah kekonfirmasi ms dari kontrak API). */
export function formatDurasiMs(ms: number): string {
  return formatDurasiDetik(ms / 1000);
}

/* Parser durasi "3:33" / "1:05:33" -> total detik (buat normalisasi
   jalur lama yang masih string). null kalau bentukny gak dikenal. */
export function durasiKeDetik(teks: string): number | null {
  const bagian = teks.trim().split(":").map((b) => Number(b));
  if (!bagian.length || bagian.some((b) => !Number.isFinite(b))) return null;
  return bagian.reduce((tot, b) => tot * 60 + b, 0);
}
