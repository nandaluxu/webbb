/* MESIN 2048 — logika murni, tanpa React, tanpa DOM.
   ------------------------------------------------------------
   Dipisah dari tampilan (views/Game2048.tsx) biar gampang dites dan
   gak ada logika game yang nyelip di JSX.

   Model: tiap ubin punya id tetap (`id`) selama hidupnya. Tampilan
   nge-key ubin pake id, jadi pas posisi berubah, DOM ny SAMA dan
   CSS transition yang nggeser — bukan render ulang dari nol.

   Pas dua ubin bergabung:
   - dua ubin asal geser ke kotak tujuan dan ditandai `mati`
     (tampilan ngilangin ny habis transisi),
   - satu ubin BARU (id baru, nilai x2) lahir di kotak tujuan dengan
     tanda `gabung` (buat animasi denyut).
   Ubin `mati` dibuang di awal langkah berikutny (lihat hidup()).

   Aturan yang dipake (sama kayak 2048 asli):
   - tiap ubin cuma boleh gabung SEKALI per geseran,
   - 2 4 8 ... gabung dengan yang sama persis,
   - habis geseran yang beneran ngubah papan, muncul satu ubin baru
     (90% nilai 2, 10% nilai 4) di kotak kosong acak,
   - kalah = papan penuh + gak ada tetangga yang nilainya sama. */

export type Arah = "atas" | "bawah" | "kiri" | "kanan";

export type Ubin = {
  id: number;
  v: number;
  x: number;
  y: number;
  /* Tanda animasi satu langkah (dibuang di langkah berikutny). */
  baru?: boolean;
  gabung?: boolean;
  mati?: boolean;
};

export type Keadaan = {
  n: number;
  ubin: Ubin[];
  skor: number;
  langkah: number;
  idBerikut: number;
  /* Target udah pernah kecapai di game ini (stempel menang cuma
     muncul SEKALI; abis itu pemain bebas lanjut). */
  menang: boolean;
  selesai: boolean;
};

export type HasilGeser = {
  keadaan: Keadaan;
  gerak: boolean;
  tambah: number;
  /* Nilai tiap penggabungan di langkah ini (buat bunyi + efek). */
  gabungan: number[];
  baruMenang: boolean;
};

export const UKURAN_PILIHAN = [4, 5, 6] as const;
export type Ukuran = (typeof UKURAN_PILIHAN)[number];

/* Target tiap ukuran: papan lebih lebar = ubin lebih gampang
   numpuk, jadi targetny ikut naik biar tetep ada tantangan. */
export const TARGET: Record<number, number> = { 4: 2048, 5: 4096, 6: 8192 };

export type Acak = () => number;

/* Ubin hidup = yang masih kepake di papan (buang yang `mati`) dan
   bersihin semua tanda animasi langkah sebelumny. */
export function hidup(ubin: Ubin[]): Ubin[] {
  return ubin.filter((u) => !u.mati).map(({ id, v, x, y }) => ({ id, v, x, y }));
}

function kosong(ubin: Ubin[], n: number): [number, number][] {
  const isi = new Set(ubin.filter((u) => !u.mati).map((u) => u.y * n + u.x));
  const hasil: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!isi.has(y * n + x)) hasil.push([x, y]);
  return hasil;
}

function lahirkan(k: Keadaan, acak: Acak): Keadaan {
  const sisa = kosong(k.ubin, k.n);
  if (!sisa.length) return k;
  const [x, y] = sisa[Math.floor(acak() * sisa.length)];
  const baru: Ubin = { id: k.idBerikut, v: acak() < 0.9 ? 2 : 4, x, y, baru: true };
  return { ...k, ubin: [...k.ubin, baru], idBerikut: k.idBerikut + 1 };
}

export function mulai(n: number, acak: Acak = Math.random): Keadaan {
  let k: Keadaan = { n, ubin: [], skor: 0, langkah: 0, idBerikut: 1, menang: false, selesai: false };
  k = lahirkan(k, acak);
  k = lahirkan(k, acak);
  return k;
}

/* Masih ada langkah? Ada kotak kosong, atau ada dua tetangga sama. */
export function adaLangkah(ubin: Ubin[], n: number): boolean {
  const peta: number[] = Array(n * n).fill(0);
  for (const u of ubin) if (!u.mati) peta[u.y * n + u.x] = u.v;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = peta[y * n + x];
      if (!v) return true;
      if (x + 1 < n && peta[y * n + x + 1] === v) return true;
      if (y + 1 < n && peta[(y + 1) * n + x] === v) return true;
    }
  }
  return false;
}

export function geser(awal: Keadaan, arah: Arah, acak: Acak = Math.random): HasilGeser {
  const n = awal.n;
  const target = TARGET[n] ?? 2048;
  const asal = hidup(awal.ubin);
  const mendatar = arah === "kiri" || arah === "kanan";
  const dariUjungAwal = arah === "kiri" || arah === "atas";

  /* Kelompokkan per baris (mendatar) / per kolom (menurun). */
  const garis: Ubin[][] = Array.from({ length: n }, () => []);
  for (const u of asal) garis[mendatar ? u.y : u.x].push(u);

  const hasil: Ubin[] = [];
  const gabungan: number[] = [];
  let tambah = 0;
  let gerak = false;
  let idBerikut = awal.idBerikut;

  garis.forEach((g, indeksGaris) => {
    /* Urut dari sisi tujuan: ubin terdekat ke tepi diproses duluan. */
    g.sort((a, b) => {
      const p = mendatar ? a.x - b.x : a.y - b.y;
      return dariUjungAwal ? p : -p;
    });
    let slot = 0;
    for (let i = 0; i < g.length; i++) {
      const a = g[i];
      const b = g[i + 1];
      const tujuan = dariUjungAwal ? slot : n - 1 - slot;
      const tx = mendatar ? tujuan : indeksGaris;
      const ty = mendatar ? indeksGaris : tujuan;
      if (b && a.v === b.v) {
        const nilai = a.v * 2;
        hasil.push({ ...a, x: tx, y: ty, mati: true });
        hasil.push({ ...b, x: tx, y: ty, mati: true });
        hasil.push({ id: idBerikut++, v: nilai, x: tx, y: ty, gabung: true });
        tambah += nilai;
        gabungan.push(nilai);
        gerak = true;
        i++;
      } else {
        if (a.x !== tx || a.y !== ty) gerak = true;
        hasil.push({ ...a, x: tx, y: ty });
      }
      slot++;
    }
  });

  if (!gerak) return { keadaan: awal, gerak: false, tambah: 0, gabungan: [], baruMenang: false };

  let k: Keadaan = {
    ...awal,
    ubin: hasil,
    skor: awal.skor + tambah,
    langkah: awal.langkah + 1,
    idBerikut,
  };
  k = lahirkan(k, acak);

  const baruMenang = !awal.menang && gabungan.some((v) => v >= target);
  k = { ...k, menang: awal.menang || baruMenang, selesai: !adaLangkah(k.ubin, n) };
  return { keadaan: k, gerak: true, tambah, gabungan, baruMenang };
}

export function ubinTertinggi(ubin: Ubin[]): number {
  let m = 0;
  for (const u of ubin) if (!u.mati && u.v > m) m = u.v;
  return m;
}

/* Validasi data dari localStorage — jangan percaya mentah-mentah:
   data rusak/diedit tangan gak boleh bikin game crash atau curang
   ngisi ubin di luar papan. Balikin null kalau ada yang janggal. */
export function validasi(data: unknown, n: number): Keadaan | null {
  try {
    const d = data as Partial<Keadaan> | null;
    if (!d || typeof d !== "object" || d.n !== n || !Array.isArray(d.ubin)) return null;
    const dipakai = new Set<number>();
    const ubin: Ubin[] = [];
    let idMaks = 0;
    for (const u of d.ubin) {
      if (!u || typeof u !== "object") return null;
      const { id, v, x, y } = u as Ubin;
      if (![id, v, x, y].every((t) => Number.isInteger(t))) return null;
      if (x < 0 || y < 0 || x >= n || y >= n) return null;
      if (v < 2 || (v & (v - 1)) !== 0) return null;
      if (dipakai.has(y * n + x)) return null;
      dipakai.add(y * n + x);
      idMaks = Math.max(idMaks, id);
      ubin.push({ id, v, x, y });
    }
    if (!ubin.length) return null;
    const skor = Number.isFinite(d.skor) && (d.skor as number) >= 0 ? Math.floor(d.skor as number) : 0;
    const langkah = Number.isFinite(d.langkah) && (d.langkah as number) >= 0 ? Math.floor(d.langkah as number) : 0;
    return {
      n,
      ubin,
      skor,
      langkah,
      idBerikut: Math.max(idMaks + 1, Number.isInteger(d.idBerikut) ? (d.idBerikut as number) : 0),
      menang: !!d.menang,
      selesai: !adaLangkah(ubin, n),
    };
  } catch {
    return null;
  }
}
