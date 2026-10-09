"use client";

/* Pemilih susunan grid: 4 mode (masonry, 2 kolom, 3 kolom, baris rapi).
   Dipake sama galeri dan grid hasil (IG / Pinterest) biar rasany konsisten.
   - Mode disimpen di localStorage, jadi pilihan ny kebawa antar halaman.
   - Pas ganti mode, kartu-kartu "terbang" dari posisi lama ke posisi baru
     (animasi FLIP). Kalau user minta gerakan dikurangi, langsung pindah.
   - Mode "baris rapi": baris sama tinggi, lebar tiap foto ngikut rasio
     asli ny, jadi gak ada foto yang kepotong. Item manggil catatRasio()
     pas gambarnya kebaca. */

import { useEffect, useSyncExternalStore } from "react";
import { GridMasonry, GridDua, GridTiga, GridBaris } from "@/components/ikon";

export type ModeGrid = "masonry" | "dua" | "tiga" | "baris";

const KUNCI = "neyhra:grid";

const MODES: { id: ModeGrid; judul: string; ikon: React.ReactNode }[] = [
  { id: "masonry", judul: "Masonry, ukuran campur (bawaan)", ikon: <GridMasonry /> },
  { id: "dua", judul: "2 kolom, kotak seragam", ikon: <GridDua /> },
  { id: "tiga", judul: "3 kolom, kotak seragam", ikon: <GridTiga /> },
  { id: "baris", judul: "Baris rapi, rasio asli (rekomendasi)", ikon: <GridBaris /> },
];

/* Nilai awal: di server pastiny "masonry" (localStorage gak ada di
   Node). Di client boleh langsung kebaca di sini karena tombol mode
   ke-render lewat useSyncExternalStore: pas hydration React makai
   snapshot server (konstan "masonry") dulu biar markup ny sama,
   baru setelah ny keganti snapshot client. Dulu ny state tombol ny
   diambil pakai useState(mode) langsung dari bacaan module: render
   client pertama langsung pakai mode tersimpen beda sama markup
   server -> hydration mismatch di className tombol. Pola store ini
   sama kayak lib/suara.ts. */
let mode: ModeGrid = "masonry";
try {
  if (typeof window !== "undefined") {
    const m = window.localStorage.getItem(KUNCI) as ModeGrid | null;
    if (MODES.some((x) => x.id === m)) mode = m as ModeGrid;
  }
} catch {}

const pendengar = new Set<() => void>();

function beriTahu() {
  pendengar.forEach((f) => f());
}

function langganan(f: () => void) {
  pendengar.add(f);
  return () => pendengar.delete(f);
}

const grids = new Set<HTMLElement>();
let timerSusun = 0;
let timerResize = 0;
let timerMasonry = 0;

/* ---------- Masonry rapat (layar sempit, <= 900px) ----------
   CSS Grid gak bisa interlock item beneran (row height = item
   tertinggi, item pendek kasih ruang kosong di bawah ny). Trik ny:
   baris implicit dijadiin unit KECIL (6px) + tiap item dapet
   grid-row:span N pas tinggi asli ny (dari rasio media), jadi item
   pendek bisa "nyelip" di samping item tinggi (auto-flow:dense)
   kayak masonry beneran. Sisa ruang per item maks 18px, kecil
   dibanding gap 12-20px, gak keliatan. Kelas .rapat cuma dipasang
   sama JS pas span ny kepasang, jadi kalau JS gagal grid balik ke
   perilaku baris biasa (fallback aman, gak ada item kepotong). */
const UNIT_MASONRY = 6;
const MQ_SEMPIT = "(max-width:900px)";

function masonryRapat(): boolean {
  return typeof window !== "undefined" && mode === "masonry" && window.matchMedia(MQ_SEMPIT).matches;
}

function susunMasonryHP(grid: HTMLElement) {
  if (!masonryRapat() || !grid.clientWidth) {
    lepasMasonryHP(grid);
    return;
  }
  const anak = [...grid.children] as HTMLElement[];
  if (!anak.length) {
    grid.classList.remove("rapat");
    return;
  }
  /* Kelas dipasang duluan baru diukur: row-gap (0) + margin-bottom
     (12/20) ny baru kebaca setelah .rapat aktif. Ukur sebelum ny
     bakal dapet nilai gap/margin lama -> span kekecilan -> item
     overlap. offsetHeight li gak kepengaruh margin/row-gap, aman. */
  grid.classList.add("rapat");
  const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
  const marginB = parseFloat(getComputedStyle(anak[0]).marginBottom) || 0;
  for (const li of anak) {
    const span = Math.max(1, Math.ceil((li.offsetHeight + marginB + gap) / (UNIT_MASONRY + gap)));
    li.style.gridRow = "span " + span;
  }
}

function lepasMasonryHP(grid: HTMLElement) {
  if (!grid.classList.contains("rapat")) return;
  grid.classList.remove("rapat");
  for (const li of grid.children as HTMLCollection) {
    (li as HTMLElement).style.gridRow = "";
  }
}

function susunBaris(grid: HTMLElement) {
  const items = [...grid.children].filter((li) => !(li as HTMLElement).classList.contains("empty")) as HTMLElement[];
  if (!items.length || !grid.clientWidth) return;

  const W = grid.clientWidth;
  let gap = 16;
  const gn = parseFloat(getComputedStyle(grid).columnGap || getComputedStyle(grid).gap || "16");
  if (isFinite(gn)) gap = gn;

  /* Tinggi baris target: ikut lebar layar biar di HP gak kegedean. */
  const targetH = Math.round(Math.max(150, Math.min(300, W / 3.2)));
  const rasio = items.map((li) => {
    const r = parseFloat(li.dataset.rasio ?? "");
    return isFinite(r) && r > 0.05 ? r : 0.8;
  });

  let i = 0;
  while (i < items.length) {
    let S = 0;
    let j = i;
    while (j < items.length) {
      const lebar = (S + rasio[j]) * targetH + gap * (j - i);
      if (lebar > W && j > i) break;
      S += rasio[j];
      j++;
    }
    const barisTerakhir = j >= items.length;
    const jumlah = j - i;
    /* Baris 1 item (item sebelah ny gak muat pas targetH): kalo bukan
       baris terakhir, foto ny ngisi LEBAR PENUH (tinggi = W / rasio,
       maks 640) kayak foto portrait di feed — bukan ditinggal tinggal
       150px bareng celah kosong gede di kanan ny (masalah "blank
       kanan" mode baris di HP). Baris terakhir tetep kecil, gak
       dipaksa isi. Multi-item: tinggi isi = (W - gap) / total rasio,
       clamp [120,420] (packing di targetH ngejamin isi >= targetH,
       jadi clamp 120 ny nyaris gak pernah kepake). */
    const isi = (W - gap * (jumlah - 1)) / S;
    let h: number;
    if (jumlah === 1 && !barisTerakhir) {
      h = Math.max(120, Math.min(640, W / rasio[i]));
    } else if (S > 0) {
      h = barisTerakhir ? Math.min(targetH, isi) : isi;
      h = Math.max(120, Math.min(420, h));
    } else {
      h = targetH;
    }
    h = Math.round(h);
    /* Lebar exact-fit: floor semua dulu (Math.round bisa bikin total
       lewat 1-2px dari W -> flex-wrap nyampahin item terakhir ke baris
       baru -> celah kosong gede di kanan). Kalo total natural ny udah
       nyaris isi W (baris emang disusun penuh, bukan baris terakhir
       yang sengaja nyisaan ruang), item TERAKHIR nyerap sisa
       pembulatan biar total + gap = W presisi. */
    const lebarArr: number[] = [];
    for (let k = i; k < j; k++) lebarArr.push(Math.floor(rasio[k] * h));
    const total = lebarArr.reduce((a, b) => a + b, 0) + gap * (jumlah - 1);
    if (total >= W - 2 && lebarArr.length) {
      const sisa = W - total;
      const baru = lebarArr[lebarArr.length - 1] + sisa;
      if (baru > 0) lebarArr[lebarArr.length - 1] = baru;
    }
    for (let k = i; k < j; k++) {
      const idx = k - i;
      const w = Math.max(24, Math.min(W, lebarArr[idx] ?? Math.floor(rasio[k] * h)));
      items[k].style.width = w + "px";
      items[k].style.height = h + "px";
      items[k].style.flex = "none";
    }
    i = j;
  }
}

function bersihkanBaris(grid: HTMLElement) {
  [...grid.children].forEach((li) => {
    const el = li as HTMLElement;
    el.style.width = "";
    el.style.height = "";
    el.style.flex = "";
  });
}

function terapkan(grid: HTMLElement, m: ModeGrid) {
  grid.dataset.grid = m;
  if (m === "baris") susunBaris(grid);
  else bersihkanBaris(grid);
  if (m === "masonry") susunMasonryHP(grid);
  else lepasMasonryHP(grid);
}

/* Grid ny nunggu data (galeri/profil/hasil cari) baru ke-render
   SETELAH komponen ini pasang efekny, jadi ref ny masih kosong pas
   efek jalan dan mode bento gak pernah ketulis. Solusiny: grid
   mendaftarin diri ny sendiri pas elemen <ul> ny bener-bener muncul
   (dipanggil dari ref callback di tempat grid di-render). */
export function pasangGrid(grid: HTMLElement) {
  grids.add(grid);
  terapkan(grid, mode);
}

export function lepasGrid(grid: HTMLElement) {
  grids.delete(grid);
}

function flip(grid: HTMLElement, aksi: () => void) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const items = [...grid.children].filter((li) => !(li as HTMLElement).classList.contains("empty")) as HTMLElement[];
  if (reduce || !items.length || typeof Element.prototype.animate !== "function") {
    aksi();
    return;
  }
  const sebelum = items.map((el) => el.getBoundingClientRect());
  aksi();
  const sesudah = items.map((el) => el.getBoundingClientRect());
  /* Dip opacity sekejap: pas ganti mode, bentuk kartu (rasio/crop)
     beda instan — FLIP mindahin posisiny, dip ny nyamarkin perubahan
     bentuk ny biar gak kerasa patah. 240ms doang, gak ganggu baca. */
  grid.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
  items.forEach((el, i) => {
    const b = sebelum[i];
    const a = sesudah[i];
    if (!a.width && !a.height) return;
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    const sx = b.width / Math.max(1, a.width);
    const sy = b.height / Math.max(1, a.height);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.03 && Math.abs(sy - 1) < 0.03) return;
    el.animate(
      [
        { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, transformOrigin: "top left" },
        { transform: "none", transformOrigin: "top left" },
      ],
      { duration: 460, delay: Math.min(i * 12, 200), easing: "cubic-bezier(.2,.8,.2,1)" }
    );
  });
}

export function catatRasio(li: Element | null, rasio: number) {
  if (!(rasio > 0.05) || !li) return;
  (li as HTMLElement).dataset.rasio = String(rasio);
  if (mode === "baris") {
    clearTimeout(timerSusun);
    timerSusun = window.setTimeout(() => grids.forEach(susunBaris), 130);
  } else if (mode === "masonry") {
    /* Tinggi item baru kebaca -> span ny kehitung ulang biar packing
       tetep rapat (item baru/gambar yang baru muat). */
    clearTimeout(timerMasonry);
    timerMasonry = window.setTimeout(() => grids.forEach(susunMasonryHP), 130);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    clearTimeout(timerResize);
    timerResize = window.setTimeout(() => {
      if (mode === "baris") grids.forEach(susunBaris);
      else if (mode === "masonry") grids.forEach(susunMasonryHP);
    }, 150);
  });
}

/* Pindahan mode + simpen preferensi ditaruh di lingkup modul biar badan
   komponen ny bersih dari efek samping. */
function ubahMode(m: ModeGrid) {
  mode = m;
  try {
    window.localStorage.setItem(KUNCI, m);
  } catch {}
  grids.forEach((grid) => flip(grid, () => terapkan(grid, m)));
  window.dispatchEvent(new CustomEvent("grid:ubah", { detail: { mode: m } }));
  beriTahu();
}

/* Mode aktif sekarang (dipake grid lain, misal KisiMedia, buat
   ngatur rasio-asli di masonry HP) + susun ulang span masonry dari
   luar (KisiMedia pasang rasio duluan dari data server). */
export function modeGridSekarang(): ModeGrid {
  return mode;
}

export function susunUlangMasonry(grid: HTMLElement | null | undefined) {
  if (grid) susunMasonryHP(grid);
}

export default function PemilihGrid({ gridRef }: { gridRef: React.RefObject<HTMLElement | null> }) {
  /* Tombol aktif kebaca dari store module: pas hydration pakai
     "masonry" (sama kayak server), setelah ny otomatis keganti mode
     tersimpen user tanpa setState di efek. */
  const aktif = useSyncExternalStore(langganan, () => mode, () => "masonry" as ModeGrid);

  useEffect(() => {
    const grid = gridRef.current;
    if (grid) {
      pasangGrid(grid);
      return () => lepasGrid(grid);
    }
  }, [gridRef]);

  function ganti(m: ModeGrid) {
    if (m === mode) return;
    ubahMode(m);
  }

  return (
    <div className="pilih-grid" role="group" aria-label="Susunan grid">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={"pg-btn" + (aktif === m.id ? " aktif" : "")}
          data-mode={m.id}
          title={m.judul}
          aria-label={m.judul}
          aria-pressed={aktif === m.id}
          onClick={() => ganti(m.id)}
        >
          {m.ikon}
        </button>
      ))}
    </div>
  );
}
