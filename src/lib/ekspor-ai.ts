"use client";

/* Ekspor riwayat Ney AI ke .TXT (r29).

   Audit penyimpanan dulu: riwayat chat Ney AI nyimpan di BROWSER
   (localStorage `neyhra:ai-riwayat` — lihat lib/pengguna), SATU
   percakapan aktif (maks 120 pesan), peran "aku"/"ney" + teks +
   waktu (epoch ms, entri lama boleh gak punya). Gak ada data
   server buat chat AI — makany:
   - Ekspor = BLOB client-side + download langsung (dataset kecil,
     gak butuh render server).
   - Keamanan: data ny cuma punya browser user ini (fiturny cuma
     kebuka pas login). GAK ADA userId dari client ke server sama
     sekali — gak mungkin minta data orang lain.

   Format (readable, oldest -> newest):
     Ney AI Chat Export
     ==================

     Conversation: ...
     Exported: 06/10/2026 20:10
     Messages: 12

     ----------------------------------------

     [06/10/2026 20:10] User:
     isi pesan (newline ny UTUH)

     [06/10/2026 20:12] Ney AI:
     isi jawaban

   - Isi pesan gak diubah sama sekali (newline dipertahanin).
   - Metadata internal (sessionId/parentMessageId/chatId/cookie) gak
     ikut — itu bukan bagian percakapan user.
   - Struktur builder ny nerima BEBERAPA percakapan (heading jelas
     tiap percakapan) — arsitektur sekarang cuma punya satu, tapi
     kalau nanti multi, formatny udah siap. */

import type { RiwayatAI } from "@/lib/pengguna";

type Percakapan = {
  judul: string;
  pesan: RiwayatAI[];
};

function dua(n: number): string {
  return String(n).padStart(2, "0");
}

/* Stempel "06/10/2026 20:10" (DD/MM/YYYY HH:mm, zona device user —
   sama kayak jam yang dia liat di UI). */
function stempelWaktu(waktu: number): string {
  const d = new Date(waktu);
  if (isNaN(d.getTime())) return "";
  return `${dua(d.getDate())}/${dua(d.getMonth() + 1)}/${d.getFullYear()} ${dua(d.getHours())}:${dua(d.getMinutes())}`;
}

export function buatTeksEksporAI(daftarPercakapan: Percakapan[], tanggalEkspor: Date): string {
  const totalPesan = daftarPercakapan.reduce((n, p) => n + p.pesan.length, 0);
  const baris: string[] = [];
  baris.push("Ney AI Chat Export");
  baris.push("==================");
  baris.push("");
  baris.push("Exported: " + stempelWaktu(tanggalEkspor.getTime()));
  baris.push("Conversations: " + daftarPercakapan.length);
  baris.push("Messages: " + totalPesan);
  baris.push("");

  daftarPercakapan.forEach((p, i) => {
    baris.push("----------------------------------------");
    baris.push("");
    baris.push("Conversation: " + p.judul + (daftarPercakapan.length > 1 ? " (" + (i + 1) + " dari " + daftarPercakapan.length + ")" : ""));
    baris.push("Messages: " + p.pesan.length);
    baris.push("");
    if (p.pesan.length === 0) {
      baris.push("(Percakapan kosong)");
      baris.push("");
      return;
    }
    for (const m of p.pesan) {
      const nama = m.peran === "aku" ? "User" : "Ney AI";
      const stempel = typeof m.waktu === "number" && !isNaN(m.waktu) ? stempelWaktu(m.waktu) : "";
      baris.push((stempel ? "[" + stempel + "] " : "") + nama + ":");
      /* Isi pesan UTUH — gak di-trim, newline ny gak disentuh. */
      baris.push(m.teks);
      baris.push("");
    }
  });

  return baris.join("\n");
}

/* Nama file: ney-ai-chat-export-YYYY-MM-DD.txt (tanggal HARI INI,
   zona device user). */
export function namaFileEksporAI(d: Date): string {
  return `ney-ai-chat-export-${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}.txt`;
}

/* Download .txt lewat Blob + <a download> (GAK buka tab baru —
   klik ny nyatu sama halaman). URL object ny dibersihin abis dipake. */
export function unduhTxt(namaFile: string, isi: string): boolean {
  try {
    const blob = new Blob([isi], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = namaFile;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}
