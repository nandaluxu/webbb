/* MESIN TIC TAC TOE — murni, gak kenal React/DOM.
   ------------------------------------------------------------
   - Deteksi menang: 8 pola (3 baris, 3 kolom, 2 diagonal), dicek
     sekali jalan tiap langkah (satu klik = langsung keliatan, gak
     nunggu klik kedua).
   - Minimax + alpha-beta pruning + transposition table (memo per
     posisi+giliran). Nilai yang disimpan cuma nilai EKSAK — kalau
     pemangkasan kejadian di node itu, node ny GAK masuk memo
     (nilai batas atas/bawah gak boleh dicampur nilai pasti, itu
     sumber bug klasik alpha-beta + memo).
   - Skor menang dibobot kecepatan: menang cepet > menang lama,
     kalah lama > kalah cepet — biar AI ngusahain nutup game dan
     nunda kekalahanny kalau udah kalah posisi.
   - Variasi pembuka: langkah sebaik apapun yang nilainy SAMA
     dikumpulin jadi kandidat, dipilih acak — jadi AI sempurna gak
     monoton main persis sama tiap game (tetep gak bisa dikalahkan,
     cuma jalurny bervariasi).
   - Tiga level (keputusan desain di view, mesin ny nurunin fungsi
     mentahny):
       gampang  : ambil menang langsung kalau ada, blok 50%, sisany
                  acak — bodoh tapi gak ngeyel.
       sedang   : 70% langkah optimal + 30% acak — bisa dikalahkan
                  tapi gak gampang.
       sempurna : minimax penuh — gak bisa dikalahkan, hasil terbaik
                  lawanny cuma seri. */

export type Tanda = "X" | "O";
export type Isi = Tanda | null;

/* 9 kotak, indeks 0..8 baris demi baris:
   0 1 2
   3 4 5
   6 7 8 */
export type Papan = Isi[];

export const POLA_MENANG: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export type HasilMenang = { tanda: Tanda; pola: [number, number, number] } | null;

export function cekMenang(papan: Papan): HasilMenang {
  for (const pola of POLA_MENANG) {
    const [a, b, c] = pola;
    const v = papan[a];
    if (v && v === papan[b] && v === papan[c]) return { tanda: v, pola: [a, b, c] };
  }
  return null;
}

export function selKosong(papan: Papan): number[] {
  const hasil: number[] = [];
  for (let i = 0; i < 9; i++) if (!papan[i]) hasil.push(i);
  return hasil;
}

/* Kunci memo: PERSPEKTIF (aku) + isi papan + giliran + KEDALAMAN.
   - Perspektif wajib: nilai posisi sama dari sudut X vs O = dua hal
     beda; tanpa aku di kunci, nilai terbalik bisa ketuker.
   - Kedalaman wajib: skor ny bobot kecepatan (10-kedalaman), jadi
     posisi yang sama di kedalaman beda = nilai beda. Dengan
     kedalaman di kunci, transposisi urutan langkah (papan sama,
     jumlah langkah sama = kedalaman sama) tetap ke-cache — itu
     memang guna utamany — tapi hasil konteks beda gak bisa
     nyampur. */
function kunciMemo(papan: Papan, aku: Tanda, giliran: Tanda, kedalaman: number): string {
  let s = aku + giliran + kedalaman;
  for (let i = 0; i < 9; i++) s += papan[i] ?? ".";
  return s;
}

/* Transposition table level modul: dipake lintas game biar posisi
   yang sama gak dihitung ulang tiap CPU mikir. Dibatasi jumlah
   entri (papan 3x3 cuma punya 5.478 posisi legal, jadi cap gede
   ny mustahil kena — nyata ny cuma jaga-jaga). */
const MEMO = new Map<string, number>();

export function lawanDari(t: Tanda): Tanda {
  return t === "X" ? "O" : "X";
}

/* Nilai minimax dari sudut pandang `aku` (positif = bagus buat aku).
   Kedalaman dipake buat bobot kecepatan menang/kalah. */
function nilai(
  papan: Papan,
  aku: Tanda,
  giliran: Tanda,
  alpha: number,
  beta: number,
  kedalaman: number
): number {
  const menang = cekMenang(papan);
  if (menang) return menang.tanda === aku ? 10 - kedalaman : kedalaman - 10;

  const kosong = selKosong(papan);
  if (kosong.length === 0) return 0;

  const kunci = kunciMemo(papan, aku, giliran, kedalaman);
  const tersimpan = MEMO.get(kunci);
  if (tersimpan !== undefined) return tersimpan;

  const maksimalkan = giliran === aku;
  let terbaik = maksimalkan ? -Infinity : Infinity;
  /* Window AWAL node — dipake buat tes eksak di bawah. alpha/beta
     sendiri sempit kepingin selama loop (itu memang cara kerja
     alpha-beta), jadi salin dulu sebelum disentuh. */
  const alphaAwal = alpha;
  const betaAwal = beta;

  for (const i of kosong) {
    papan[i] = giliran;
    const v = nilai(papan, aku, lawanDari(giliran), alpha, beta, kedalaman + 1);
    papan[i] = null;

    if (maksimalkan) {
      if (v > terbaik) terbaik = v;
      if (terbaik > alpha) alpha = terbaik;
    } else {
      if (v < terbaik) terbaik = v;
      if (terbaik < beta) beta = terbaik;
    }
    if (beta <= alpha) break;
  }

  /* Teorema alpha-beta: nilai balikan EKSAK cuma kalau dia jatuh
     DI DALAM window AWAL node (alphaAwal < nilai < betaAwal). Di
     luar itu, dia cuma batas atas/bawah — masukin batas ke memo
     = ngeracun posisi itu buat pencarian berikutny (bug nyebabin
     Sempurna milih seri padahal ada jalan menang). Jadi cuma nilai
     eksak yang ke-simpen; batas dibiarin lewat. */
  if (alphaAwal < terbaik && terbaik < betaAwal) MEMO.set(kunci, terbaik);
  return terbaik;
}

/* Semua langkah bernilai terbaik (buat variasi pembuka: pilih acak
   di antarany). Balikin [indeks, nilai] biar pemanggil bisa liat
   skornya juga kalau mau. */
export function langkahTerbaik(papan: Papan, aku: Tanda): { indeks: number; nilai: number } | null {
  const kosong = selKosong(papan);
  if (kosong.length === 0) return null;

  let terbaik = -Infinity;
  let kandidat: number[] = [];
  for (const i of kosong) {
    papan[i] = aku;
    const v = nilai(papan, aku, lawanDari(aku), -Infinity, Infinity, 1);
    papan[i] = null;
    if (v > terbaik) {
      terbaik = v;
      kandidat = [i];
    } else if (v === terbaik) {
      kandidat.push(i);
    }
  }
  const pilihan = kandidat[Math.floor(Math.random() * kandidat.length)] ?? kosong[0] ?? -1;
  return pilihan >= 0 ? { indeks: pilihan, nilai: terbaik } : null;
}

/* Menang satu langkah: kotak yang bikin `tanda` menang SEKARANG. */
function menangLangsung(papan: Papan, tanda: Tanda): number | null {
  for (const i of selKosong(papan)) {
    papan[i] = tanda;
    const menang = cekMenang(papan);
    papan[i] = null;
    if (menang && menang.tanda === tanda) return i;
  }
  return null;
}

export type Level = "gampang" | "sedang" | "sempurna";

/* Pilihan langkah CPU per level. `papan` GAK boleh penuh/beres pas
   dipanggil (cek status game dulu di pemanggil). */
export function pilihLangkah(papan: Papan, aku: Tanda, level: Level): number {
  const kosong = selKosong(papan);
  if (kosong.length === 0) return -1;

  const acak = kosong[Math.floor(Math.random() * kosong.length)] ?? -1;
  if (acak < 0) return -1;

  if (level === "sempurna") {
    return langkahTerbaik(papan, aku)?.indeks ?? acak;
  }

  if (level === "sedang") {
    /* 70% optimal, 30% acak: cukup pintar biar serius, cukup bocor
       biar bisa dikalahkan (brief: campuran random dan optimal). */
    if (Math.random() < 0.7) return langkahTerbaik(papan, aku)?.indeks ?? acak;
    return acak;
  }

  /* gampang: selalu ambil menang langsung (kalau gak, boro-boro),
     blok 50% kalau lawan tinggal satu langkah, sisany acak. */
  const menang = menangLangsung(papan, aku);
  if (menang !== null) return menang;
  if (Math.random() < 0.5) {
    const blok = menangLangsung(papan, lawanDari(aku));
    if (blok !== null) return blok;
  }
  return acak;
}
