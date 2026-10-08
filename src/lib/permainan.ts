/* lib/permainan (fix26): satu pintu buat game yang mau nyatet hasil
   ny ke leaderboard. Dipake views TicTacToe + Game2048.

   Best-effort sejati: kirim terus lupakan. Gagal kirim (offline,
   server lagi bete, ke-429 throttle) gak boleh kerasa sama sekali di
   game ny — papan skor itu bonus, bukan fitur yang nungguin. */

export type CatatanPermainan = {
  game: "tictactoe" | "2048";
  mode: string;
  hasil: string;
  langkah?: number;
  skor?: number;
  ubin?: number;
  catatan?: string;
};

export function catatPermainan(badan: CatatanPermainan) {
  try {
    void fetch("/api/fitur/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(badan),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* fetch bisa gak ada di lingkungan super tua — diam aja. */
  }
}
