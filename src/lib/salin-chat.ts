"use client";

/* Formatter salin chat: SATU helper buat semua tempat yang bisa
   disalin (chat global, chat AI, komentar post), biar format ny
   konsisten: [5/10, 08:01] Nanda: Woy Suki😂✌️

   - Tanggal bulan TANPA nol depan (5/10, bukan 05/10), jam + menit
     DENGAN nol depan (08:01), persis contoh yang diminta.
   - Waktu ny zona device user (sama kayak jam yang dia lihat di UI).
   - Banyak pesan: dipisah newline, urut apa adany.
   - Yang ke salin CUMA teks ny. Icon reply, reaction, timestamp UI,
     tombol aksi, metadata lain gak ikut (mereka emang gak dioper ke
     sini). */

export type ItemSalin = {
  nama: string;
  teks: string;
  waktu: string | Date | number;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function stempel(waktu: string | Date | number): string {
  const d = new Date(waktu);
  if (isNaN(d.getTime())) return "";
  return `${d.getDate()}/${d.getMonth() + 1}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* Satu pesan -> "[5/10, 08:01] Nanda: Woy Suki" */
export function formatSalin(item: ItemSalin): string {
  const s = stempel(item.waktu);
  const nama = item.nama.trim();
  const teks = item.teks.replace(/\s+/g, " ").trim();
  return (s ? "[" + s + "] " : "") + (nama ? nama + ": " : "") + teks;
}

/* Banyak pesan -> tiap baris formatSalin, dipisah newline. */
export function formatSalinBanyak(items: ItemSalin[]): string {
  return items.map(formatSalin).filter(Boolean).join("\n");
}

/* Salin ke clipboard dengan cadangan execCommand (konteks non-secure /
   browser lama). Balikin true kalau berhasil. */
export async function salinTeks(teks: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(teks);
      return true;
    }
  } catch {
    /* lanjut ke cadangan */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = teks;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
