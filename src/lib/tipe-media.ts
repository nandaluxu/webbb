/* Bentuk data media buat client + server. Ditaruh file sendiri biar
   view gak ngimpor modul server (sharp/fs). */

export type UserMini = { id: string; nama: string; username: string | null; pfp: string | null; verified: boolean };

/* Link profil user: pakai username (identifier r27) kalau ada,
   fallback nama display (user super-lawas sebelum backfill). */
export function urlProfil(u: { nama: string; username?: string | null }): string {
  return "/profil/" + encodeURIComponent(u.username ?? u.nama);
}

/* Handle tampilan: @username (identifier), fallback nama. */
export function sebutanUser(u: { nama: string; username?: string | null }): string {
  return u.username ? "@" + u.username : u.nama;
}

/* Satu file di dalem post (r24): urutan nentuin slide ny di carousel.
   pratinjau/file udah bawa nomor item (?item=N) buat multi-foto. */
export type MediaItemPublik = {
  jenis: "foto" | "video";
  nama: string;
  rasio: number | null;
  pratinjau: string;
  file: string;
};

export type Visibilitas = "PUBLIC" | "PROFILE" | "PRIVATE";

export type MediaPublik = {
  id: string;
  jenis: "foto" | "video";
  dari: string;
  nama: string;
  judul: string | null;
  ukuran: number | null;
  /* Rasio lebar/tinggi asli dari server (lebar/tinggi). Dipake grid
     buat jatah tinggi kartu duluan (masonry rapat, gak loncat). null
     = belum kebaca, fallback ke rasio pas gambar muat. */
  rasio: number | null;
  /* Siapa yang boleh lihat post (r24): PUBLIC / PROFILE / PRIVATE.
     Server yang mutusin daftar apa yang dikirim; client cuma
     nampilin label ny. */
  visibilitas: Visibilitas;
  /* r30: boleh gak orang lain ngunduh post ini (keputusan
     uploader; server juga ngecek di route file ny). */
  bolehUnduh: boolean;
  waktu: string;
  user: UserMini | null;
  suka: number;
  disukai: boolean;
  komentar: number;
  /* Penonton unik (r28): 1 user = 1 view (relation LihatMedia dengan
     unique constraint di server, bukan hitungan buka-halaman). */
  dilihat: number;
  pratinjau: string;
  file: string;
  /* Semua file di post ini (urut slide). Post 1 file = 1 item
     (post lama ke-backfill otomatis), post multi-foto = banyak. */
  item: MediaItemPublik[];
};

export type KomentarPublik = {
  id: string;
  teks: string;
  waktu: string;
  user: UserMini;
  /* Kalau ini balasan: siapa yang dibalas (dari data asli, bukan
     tempelan teks), buat nampilin "@nama" + sapaan di UI. */
  balasan: { id: string; nama: string } | null;
};
