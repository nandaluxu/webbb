"use client";

/* 2048 — game geser-gabung (fitur /fitur/game-2048).
   ------------------------------------------------------------
   Pembagian kerja:
   - lib/g2048-mesin.ts : semua aturan game (murni, tanpa DOM).
   - views/Game2048.tsx : tampilan, input, animasi, penyimpanan.

   Alur satu langkah (input apapun: keyboard / swipe / tombol):
     gerakkan(arah) -> geser() di mesin -> kalau papan berubah:
     simpan snapshot undo, pasang keadaan baru (state + ref),
     lalu efek samping (skor +n, bunyi, rekor, statistik, menang,
     buntu). Ref `kRef` jadi sumber kebenaran sinkron — tekan panah
     cepat berkali-kali gak pernah baca state basi.

   Animasi: ubin di-key pake id. Posisi lewat CSS var --x/--y +
   transition transform, jadi ubin yang sama BENERAN geser (bukan
   dirender ulang). Ubin lahir/gabung punya keyframe sendiri.

   Penyimpanan (localStorage, semua di-validasi pas dibaca):
   - neyhra:2048-papan-<n> : game yang lagi jalan per ukuran, jadi
     tutup tab pun bisa dilanjut,
   - neyhra:2048-data      : rekor per ukuran + statistik,
   - neyhra:2048-ukuran    : ukuran papan terakhir.
   Render awal sengaja KOSONG (papan belum diisi) sampai mount:
   ubin pertama acak, kalau dirender di server hydration-ny beda.

   Input: panah / WASD, geser jari (pointer events), U = undo.
   Papan touch-action:none biar swipe gak ikut nge-scroll halaman.
   Gerak dihormatin: prefers-reduced-motion matiin animasi + konfeti. */

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as KeyEv, type PointerEvent as PtrEv } from "react";
import {
  TARGET,
  UKURAN_PILIHAN,
  geser,
  hidup,
  mulai,
  ubinTertinggi,
  validasi,
  type Arah,
  type Keadaan,
  type Ubin,
} from "@/lib/g2048-mesin";
import { mainkanSfx } from "@/lib/suara";
import { catatPermainan } from "@/lib/permainan";
import Konfirmasi from "@/components/Konfirmasi";
import { ResetIkon } from "@/components/ikon";

/* ---------- Tipe + konstanta ---------- */

type Data = {
  terbaik: Record<number, number>;
  main: number;
  menang: number;
  tertinggi: number;
  langkah: number;
};

const DATA_AWAL: Data = { terbaik: {}, main: 0, menang: 0, tertinggi: 0, langkah: 0 };

const KUNCI_DATA = "neyhra:2048-data";
const KUNCI_UKURAN = "neyhra:2048-ukuran";
const kunciPapan = (n: number) => "neyhra:2048-papan-" + n;

const BATAS_UNDO = 50;
const AMBANG_SWIPE = 22;

function muatData(): Data {
  try {
    const d = JSON.parse(localStorage.getItem(KUNCI_DATA) || "null");
    if (!d || typeof d !== "object") return DATA_AWAL;
    const angka = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    const terbaik: Record<number, number> = {};
    for (const n of UKURAN_PILIHAN) terbaik[n] = angka(d.terbaik?.[n]);
    return { terbaik, main: angka(d.main), menang: angka(d.menang), tertinggi: angka(d.tertinggi), langkah: angka(d.langkah) };
  } catch {
    return DATA_AWAL;
  }
}

function simpanData(d: Data) {
  try {
    localStorage.setItem(KUNCI_DATA, JSON.stringify(d));
  } catch {}
}

function muatPapan(n: number): Keadaan | null {
  try {
    return validasi(JSON.parse(localStorage.getItem(kunciPapan(n)) || "null"), n);
  } catch {
    return null;
  }
}

function simpanPapan(k: Keadaan) {
  try {
    const { n, skor, langkah, idBerikut, menang } = k;
    localStorage.setItem(kunciPapan(n), JSON.stringify({ n, ubin: hidup(k.ubin), skor, langkah, idBerikut, menang }));
  } catch {}
}

function fmt(n: number) {
  return n.toLocaleString("id-ID");
}

function tingkat(v: number) {
  return Math.min(13, Math.max(1, Math.round(Math.log2(v))));
}

/* ---------- Konfeti: keping kertas bergaris tinta, cuma pas menang ---------- */

function ledakKonfeti(kanvas: HTMLCanvasElement, pusat: { x: number; y: number }): () => void {
  const ctx = kanvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  kanvas.width = Math.floor(window.innerWidth * dpr);
  kanvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const gaya = getComputedStyle(document.documentElement);
  const tinta = gaya.getPropertyValue("--ink").trim() || "#0A0A0A";
  const kertas = gaya.getPropertyValue("--bg").trim() || "#FAFAF7";

  const keping = Array.from({ length: 110 }, () => {
    const sudut = Math.random() * Math.PI * 2;
    const laju = 4 + Math.random() * 10;
    return {
      x: pusat.x,
      y: pusat.y,
      vx: Math.cos(sudut) * laju,
      vy: Math.sin(sudut) * laju - 6,
      w: 6 + Math.random() * 8,
      h: 3 + Math.random() * 5,
      r: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.45,
      isi: Math.random() < 0.5,
    };
  });

  const DURASI = 2600;
  const mulaiT = performance.now();
  let raf = 0;
  const putar = (t: number) => {
    const umur = t - mulaiT;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (umur >= DURASI) return;
    ctx.globalAlpha = umur > DURASI - 700 ? Math.max(0, (DURASI - umur) / 700) : 1;
    for (const p of keping) {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.3;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = tinta;
      ctx.fillStyle = p.isi ? tinta : kertas;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    raf = requestAnimationFrame(putar);
  };
  raf = requestAnimationFrame(putar);
  return () => {
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  };
}

/* ---------- Komponen kecil ---------- */

function UndoIkon({ ukuran = 15 }: { ukuran?: number }) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function Segmen({ label, nilai, opsi, onGanti }: { label: string; nilai: number; opsi: { n: number; teks: string }[]; onGanti: (n: number) => void }) {
  const urut = Math.max(0, opsi.findIndex((o) => o.n === nilai));
  const tombolRef = useRef<(HTMLButtonElement | null)[]>([]);

  function tekan(e: KeyEv<HTMLDivElement>) {
    let i = urut;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") i = (urut + 1) % opsi.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = (urut - 1 + opsi.length) % opsi.length;
    else return;
    e.preventDefault();
    onGanti(opsi[i].n);
    tombolRef.current[i]?.focus();
  }

  return (
    <div className="g48-seg" role="radiogroup" aria-label={label} style={{ "--n": opsi.length, "--i": urut } as CSSProperties} onKeyDown={tekan}>
      {opsi.map((o, i) => (
        <button
          key={o.n}
          ref={(el) => {
            tombolRef.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.n === nilai}
          tabIndex={o.n === nilai ? 0 : -1}
          className={o.n === nilai ? "aktif" : ""}
          onClick={() => onGanti(o.n)}
        >
          {o.teks}
        </button>
      ))}
    </div>
  );
}

/* ---------- Halaman ---------- */

export default function Game2048() {
  const [ukuran, setUkuran] = useState<number>(4);
  const [k, setK] = useState<Keadaan | null>(null);
  const [data, setData] = useState<Data>(DATA_AWAL);
  const [tirai, setTirai] = useState<null | "menang" | "buntu">(null);
  const [bisaUndo, setBisaUndo] = useState(0);
  const [pop, setPop] = useState({ n: 0, k: 0 });
  const [getar, setGetar] = useState(0);
  const [kembali, setKembali] = useState(0);
  const [rekorBaru, setRekorBaru] = useState(false);
  const [konfirmasi, setKonfirmasi] = useState<null | "baru" | "reset">(null);
  const [terpasang, setTerpasang] = useState(false);

  const kRef = useRef<Keadaan | null>(null);
  const dataRef = useRef<Data>(DATA_AWAL);
  const undoRef = useRef<Keadaan[]>([]);
  const rekorRef = useRef(false);
  /* Rekor yang HARUS dilewati supaya "Rekor baru" nyala (0 = gak
     ada pembanding yang jelas, jadi gak dirayain). Dikunci di awal
     game: skor terbaik di DATA ikut naik tiap langkah, jadi gak bisa
     dipake langsung buat bandingin. */
  const pembandingRef = useRef(0);
  const timerTirai = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kunciRef = useRef(false);
  const konfRef = useRef(false);
  const papanRef = useRef<HTMLDivElement>(null);
  const konfetiRef = useRef<HTMLCanvasElement>(null);
  const hentiKonfeti = useRef<(() => void) | null>(null);
  const sentuh = useRef<{ x: number; y: number; id: number } | null>(null);
  /* fix26: apakah game di slot ukuran ini UDAH kecatat ke leaderboard.
    Per SLOT (4/5/6), bukan global — tiap ukuran punya simpananny
   sendiri, jadi ganti ukuran bolak-balik gak bisa nge-double catet
   game yang sama. Dua tiket terpisah: "menang" (momen nyampe target,
   sekali per game — undo di bawah target terus ngejar lagi gak ngitung
   dua kali) dan "buntu" (papan mati). Reset pas game BARU dimulai di
   slot itu. */
  const dicatatMenang = useRef<Record<number, boolean>>({});
  const dicatatBuntu = useRef<Record<number, boolean>>({});

  const target = TARGET[ukuran] ?? 2048;

  /* ----- pemasangan keadaan (state + ref sinkron) ----- */

  const pasang = useCallback((baru: Keadaan) => {
    kRef.current = baru;
    setK(baru);
  }, []);

  const ubahData = useCallback((fn: (d: Data) => Data) => {
    dataRef.current = fn(dataRef.current);
    setData(dataRef.current);
    simpanData(dataRef.current);
  }, []);

  const batalTirai = useCallback(() => {
    if (timerTirai.current) clearTimeout(timerTirai.current);
    timerTirai.current = null;
  }, []);

  const tampilTirai = useCallback(
    (jenis: "menang" | "buntu", tunda: number) => {
      batalTirai();
      timerTirai.current = setTimeout(() => setTirai(jenis), tunda);
    },
    [batalTirai]
  );

  /* Game baru: pembandingnya skor terbaik saat ini. Game yang dimuat
     dari simpanan: kalau skor-nya udah >= terbaik, game ini sendiri
     pemegang rekor dan kita gak tau rekor sebelumnya, jadi 0. */
  const aturPembanding = useCallback((kk: Keadaan) => {
    const terbaik = dataRef.current.terbaik[kk.n] ?? 0;
    pembandingRef.current = kk.skor >= terbaik ? 0 : terbaik;
  }, []);

  const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----- mount: muat data, ukuran terakhir, dan game yang jalan ----- */

  useEffect(() => {
    let n = 4;
    try {
      const u = Number(localStorage.getItem(KUNCI_UKURAN));
      if ((UKURAN_PILIHAN as readonly number[]).includes(u)) n = u;
    } catch {}
    const d = muatData();
    dataRef.current = d;
    setData(d);
    setUkuran(n);
    const awal = muatPapan(n) ?? mulai(n);
    aturPembanding(awal);
    kRef.current = awal;
    setK(awal);
    if (awal.selesai) setTirai("buntu");
    setTerpasang(true);
    return () => {
      if (timerTirai.current) clearTimeout(timerTirai.current);
      hentiKonfeti.current?.();
    };
  }, [aturPembanding]);

  /* Simpan game yang lagi jalan tiap keadaan berubah. */
  useEffect(() => {
    if (terpasang && k) simpanPapan(k);
  }, [k, terpasang]);

  useEffect(() => {
    kunciRef.current = !!tirai || !!konfirmasi;
    konfRef.current = !!konfirmasi;
  }, [tirai, konfirmasi]);

  /* ----- aksi game ----- */

  const baruMain = useCallback(
    (n: number) => {
      batalTirai();
      undoRef.current = [];
      setBisaUndo(0);
      rekorRef.current = false;
      setRekorBaru(false);
      setTirai(null);
      setKembali(0);
      /* fix26: game baru di slot ini = tiket catatanny kosong lagi. */
      dicatatMenang.current[n] = false;
      dicatatBuntu.current[n] = false;
      const baru = mulai(n);
      aturPembanding(baru);
      pasang(baru);
    },
    [batalTirai, pasang, aturPembanding]
  );

  const gantiUkuran = useCallback(
    (n: number) => {
      if (n === ukuran) return;
      batalTirai();
      undoRef.current = [];
      setBisaUndo(0);
      rekorRef.current = false;
      setRekorBaru(false);
      setKembali(0);
      setUkuran(n);
      try {
        localStorage.setItem(KUNCI_UKURAN, String(n));
      } catch {}
      const simpan = muatPapan(n) ?? mulai(n);
      aturPembanding(simpan);
      pasang(simpan);
      setTirai(simpan.selesai ? "buntu" : null);
      papanRef.current?.focus({ preventScroll: true });
    },
    [ukuran, batalTirai, pasang, aturPembanding]
  );

  const gerakkan = useCallback(
    (arah: Arah) => {
      const sekarang = kRef.current;
      if (!sekarang || sekarang.selesai || kunciRef.current) return;
      const h = geser(sekarang, arah);
      if (!h.gerak) {
        setGetar((g) => g + 1);
        return;
      }
      undoRef.current.push({ ...sekarang, ubin: hidup(sekarang.ubin) });
      if (undoRef.current.length > BATAS_UNDO) undoRef.current.shift();
      setBisaUndo(undoRef.current.length);
      setKembali(0);
      pasang(h.keadaan);

      if (h.tambah > 0) setPop((p) => ({ n: h.tambah, k: p.k + 1 }));
      if (h.gabungan.length) mainkanSfx("ui-button");

      const maks = ubinTertinggi(h.keadaan.ubin);
      const rekorLama = dataRef.current.terbaik[h.keadaan.n] ?? 0;
      const lewatiRekor = h.keadaan.skor > rekorLama;
      const pertamaKali = sekarang.langkah === 0;
      ubahData((d) => ({
        terbaik: lewatiRekor ? { ...d.terbaik, [h.keadaan.n]: h.keadaan.skor } : d.terbaik,
        main: d.main + (pertamaKali ? 1 : 0),
        menang: d.menang + (h.baruMenang ? 1 : 0),
        tertinggi: Math.max(d.tertinggi, maks),
        langkah: d.langkah + 1,
      }));
      /* Rekor baru cuma dirayain kalau game INI melewati rekor yang
         udah ada sebelum game dimulai (lihat pembandingRef). */
      if (lewatiRekor && pembandingRef.current > 0 && h.keadaan.skor > pembandingRef.current && !rekorRef.current) {
        rekorRef.current = true;
        setRekorBaru(true);
        mainkanSfx("notification");
      }

      if (h.baruMenang) {
        /* fix26: momen langka ny kecatat langsung — game yang dimuat
           ulang udah bawa flag menang, jadi gak ada nanah dobel. */
        if (!dicatatMenang.current[h.keadaan.n]) {
          dicatatMenang.current[h.keadaan.n] = true;
          catatPermainan({
            game: "2048",
            mode: String(h.keadaan.n),
            hasil: "menang",
            skor: h.keadaan.skor,
            langkah: h.keadaan.langkah,
            ubin: maks,
          });
        }
        mainkanSfx("digital-burst");
        tampilTirai("menang", 520);
        const kotak = papanRef.current?.getBoundingClientRect();
        if (kotak && konfetiRef.current && !reduceMotion()) {
          hentiKonfeti.current?.();
          hentiKonfeti.current = ledakKonfeti(konfetiRef.current, { x: kotak.left + kotak.width / 2, y: kotak.top + kotak.height / 2 });
        }
      } else if (h.keadaan.selesai) {
        /* fix26: buntu = skor final game slot ini. Undo dari balik
           tirai lalu buntu lagi gak boleh nyatet dua kali. */
        if (!dicatatBuntu.current[h.keadaan.n]) {
          dicatatBuntu.current[h.keadaan.n] = true;
          catatPermainan({
            game: "2048",
            mode: String(h.keadaan.n),
            hasil: "buntu",
            skor: h.keadaan.skor,
            langkah: h.keadaan.langkah,
            ubin: maks,
          });
        }
        mainkanSfx("failure");
        tampilTirai("buntu", 650);
      }
    },
    [pasang, ubahData, tampilTirai]
  );

  const undo = useCallback(() => {
    const sebelum = undoRef.current.pop();
    const kini = kRef.current;
    if (!sebelum || !kini) return;
    batalTirai();
    setTirai(null);
    setBisaUndo(undoRef.current.length);
    setKembali((x) => (x % 2) + 1);
    pasang({ ...sebelum, idBerikut: Math.max(sebelum.idBerikut, kini.idBerikut) });
  }, [batalTirai, pasang]);

  const lanjutSetelahMenang = useCallback(() => {
    const kini = kRef.current;
    setTirai(kini?.selesai ? "buntu" : null);
    papanRef.current?.focus({ preventScroll: true });
  }, []);

  const mintaBaru = useCallback(() => {
    const kini = kRef.current;
    if (kini && kini.langkah > 0 && !kini.selesai) setKonfirmasi("baru");
    else baruMain(kini?.n ?? 4);
  }, [baruMain]);

  /* ----- input: keyboard ----- */

  useEffect(() => {
    const PETA: Record<string, Arah> = {
      ArrowUp: "atas",
      ArrowDown: "bawah",
      ArrowLeft: "kiri",
      ArrowRight: "kanan",
      w: "atas",
      s: "bawah",
      a: "kiri",
      d: "kanan",
    };
    function tekan(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      /* Target bisa bukan Element (window/document, event sintetis
         dari ekstensi) — yang begitu gak punya .closest. */
      if (el instanceof HTMLElement && (el.closest("input, textarea, select, [contenteditable='true'], [role='radiogroup']") || el.isContentEditable)) return;
      const tombol = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (tombol === "u") {
        /* Undo boleh pas tirai "buntu" kebuka, tapi jangan di balik
           modal konfirmasi atau pas tirai menang. */
        if (konfRef.current || (kunciRef.current && !kRef.current?.selesai)) return;
        e.preventDefault();
        undo();
        return;
      }
      const arah = PETA[tombol];
      if (!arah) return;
      e.preventDefault();
      gerakkan(arah);
    }
    window.addEventListener("keydown", tekan);
    return () => window.removeEventListener("keydown", tekan);
  }, [gerakkan, undo]);

  /* ----- input: geser jari ----- */

  function sentuhMulai(e: PtrEv<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    /* Tombol di tirai (Lanjut / Main baru / Undo) bukan awal geseran. */
    if ((e.target as HTMLElement).closest(".g48-tirai")) return;
    const awal = { x: e.clientX, y: e.clientY, id: e.pointerId };
    sentuh.current = awal;

    /* Dengerin di window: jari yang lepas di luar papan (swipe cepat
       sampai ke tepi) tetep kebaca. Dilepas sendiri begitu kelar. */
    const lepas = (ev: PointerEvent) => {
      if (ev.pointerId !== awal.id) return;
      window.removeEventListener("pointerup", lepas);
      window.removeEventListener("pointercancel", batal);
      if (sentuh.current !== awal) return;
      sentuh.current = null;
      const dx = ev.clientX - awal.x;
      const dy = ev.clientY - awal.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AMBANG_SWIPE) return;
      if (Math.abs(dx) > Math.abs(dy)) gerakkan(dx > 0 ? "kanan" : "kiri");
      else gerakkan(dy > 0 ? "bawah" : "atas");
    };
    const batal = (ev: PointerEvent) => {
      if (ev.pointerId !== awal.id) return;
      window.removeEventListener("pointerup", lepas);
      window.removeEventListener("pointercancel", batal);
      if (sentuh.current === awal) sentuh.current = null;
    };
    window.addEventListener("pointerup", lepas);
    window.addEventListener("pointercancel", batal);
  }

  /* ----- turunan buat render ----- */

  const maks = k ? ubinTertinggi(k.ubin) : 0;
  const terbaikIni = data.terbaik[ukuran] ?? 0;
  const skorTampil = k?.skor ?? 0;
  const persen = maks ? Math.min(100, (Math.log2(maks) / Math.log2(target)) * 100) : 0;

  const tangga = useMemo(() => {
    const a: number[] = [];
    for (let v = 2; v <= target; v *= 2) a.push(v);
    return a;
  }, [target]);

  const pengumuman = k ? "Skor " + skorTampil + ". Ubin tertinggi " + maks + ". Langkah " + k.langkah + "." : "";

  const sel = useMemo(() => Array.from({ length: ukuran * ukuran }, (_, i) => i), [ukuran]);

  const kelasUbin = (u: Ubin) =>
    "g48-ubin l" +
    tingkat(u.v) +
    " d" +
    String(u.v).length +
    (u.baru ? " baru" : "") +
    (u.gabung ? " gabung" : "") +
    (u.mati ? " mati" : "") +
    (kembali ? " kembali" + kembali : "");

  /* ---------- Render ---------- */

  return (
    <>
      <section className="head">
        <h1>2048</h1>
        <p className="lede">
          Geser semua ubin ke satu arah. Dua ubin yang angkanya sama bakal gabung jadi dua kali lipat. Capai {target} buat
          menang, terus lanjut sampai papan buntu. Ada undo, rekor tersimpan, dan tiga ukuran papan.
        </p>
      </section>

      <div className="g48-arena">
        {/* ---------- Kolom kiri: panggung game ---------- */}
        <div className="g48-kiri">
          <div className="g48-mode">
            <Segmen
              label="Ukuran papan"
              nilai={ukuran}
              onGanti={gantiUkuran}
              opsi={UKURAN_PILIHAN.map((n) => ({ n, teks: n + "×" + n }))}
            />
          </div>

          <div className="g48-hud">
            <div className="g48-skor-sel">
              <span>Skor</span>
              <b key={skorTampil}>{fmt(skorTampil)}</b>
              {pop.k > 0 && (
                <i key={pop.k} className="g48-pop" aria-hidden="true">
                  +{fmt(pop.n)}
                </i>
              )}
            </div>
            <div className="g48-skor-sel">
              <span>Terbaik</span>
              <b key={terbaikIni}>{fmt(terbaikIni)}</b>
              {rekorBaru && <em className="g48-rekor">Rekor baru</em>}
            </div>
            <div className="g48-skor-sel">
              <span>Langkah</span>
              <b>{fmt(k?.langkah ?? 0)}</b>
            </div>
          </div>

          <div className="g48-progres" aria-hidden="true">
            <div className="g48-progres-teks">
              <span>
                Ubin tertinggi <b>{maks ? maks : "—"}</b>
              </span>
              <span>
                Target <b>{target}</b>
              </span>
            </div>
            <div className="g48-bar">
              <i style={{ width: persen + "%" }} />
            </div>
          </div>

          <div className="g48-kertas">
            <div
              ref={papanRef}
              className={"g48-papan" + (getar ? " getar" + (getar % 2) : "")}
              data-n={ukuran}
              data-selesai={k?.selesai ? "1" : undefined}
              style={{ "--n": ukuran } as CSSProperties}
              tabIndex={0}
              role="group"
              aria-label={"Papan 2048 ukuran " + ukuran + " kali " + ukuran + ". Geser pakai tombol panah atau WASD."}
              onPointerDown={sentuhMulai}
            >
              <div className="g48-lapis g48-latar" aria-hidden="true">
                {sel.map((i) => (
                  <i key={i} />
                ))}
              </div>
              <div className="g48-lapis g48-ubin-lapis" aria-hidden="true">
                {k?.ubin.map((u) => (
                  <div key={u.id} className={kelasUbin(u)} style={{ "--x": u.x, "--y": u.y } as CSSProperties}>
                    <span>{u.v}</span>
                  </div>
                ))}
              </div>

              {tirai && k && (
                <div className="g48-tirai" role="dialog" aria-modal="false" aria-label={tirai === "menang" ? "Kamu menang" : "Permainan selesai"}>
                  <div className={"g48-stempel " + tirai}>
                    <b>{tirai === "menang" ? target + "." : "Buntu."}</b>
                    <p>
                      {tirai === "menang"
                        ? "Nyampe di langkah " + fmt(k.langkah) + " dengan skor " + fmt(k.skor) + "."
                        : "Gak ada langkah lagi. Skor " + fmt(k.skor) + ", ubin tertinggi " + maks + "."}
                    </p>
                    <div className="g48-stempel-aksi">
                      {tirai === "menang" ? (
                        <>
                          <button type="button" className="btn kecil primary" onClick={lanjutSetelahMenang} autoFocus>
                            Lanjut main
                          </button>
                          <button type="button" className="btn kecil" onClick={() => baruMain(k.n)}>
                            Main baru
                          </button>
                        </>
                      ) : (
                        <>
                          {bisaUndo > 0 && (
                            <button type="button" className="btn kecil" onClick={undo}>
                              <UndoIkon ukuran={14} />
                              Undo
                            </button>
                          )}
                          <button type="button" className="btn kecil primary" onClick={() => baruMain(k.n)} autoFocus>
                            Main baru
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="g48-aksi">
            <button type="button" className="btn kecil" onClick={undo} disabled={bisaUndo === 0}>
              <UndoIkon />
              Undo{bisaUndo > 0 ? " (" + bisaUndo + ")" : ""}
            </button>
            <button type="button" className="btn kecil" onClick={mintaBaru}>
              <ResetIkon ukuran={15} />
              Main baru
            </button>
          </div>

          <p className="g48-hint">
            <b>Panah</b> atau <b>WASD</b> di keyboard, <b>geser jari</b> di layar. Tekan <b>U</b> buat undo. Game yang lagi jalan
            kesimpen otomatis, jadi bisa ditutup dan dilanjut nanti.
          </p>

          <p className="sr-only" aria-live="polite">
            {pengumuman}
          </p>
        </div>

        {/* ---------- Kolom kanan: statistik + panduan ---------- */}
        <div className="g48-kanan">
          <section>
            <h2 className="g48-judul-sisi">Tangga ubin</h2>
            <ul className="g48-tangga" aria-label="Ubin yang udah dicapai di game ini">
              {tangga.map((v) => (
                <li key={v} className={"g48-mini l" + tingkat(v) + " d" + String(v).length + (maks >= v ? " capai" : " belum")}>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="g48-judul-sisi">Statistik</h2>
            <div className="g48-stat">
              <div>
                <b>{fmt(data.main)}</b>
                <span>Permainan</span>
              </div>
              <div>
                <b>{fmt(data.menang)}</b>
                <span>Menang</span>
              </div>
              <div>
                <b>{data.tertinggi ? data.tertinggi : "—"}</b>
                <span>Ubin tertinggi</span>
              </div>
              <div>
                <b>{fmt(data.langkah)}</b>
                <span>Total langkah</span>
              </div>
            </div>
            <ul className="g48-rekor-daftar" aria-label="Skor terbaik per ukuran papan">
              {UKURAN_PILIHAN.map((n) => (
                <li key={n} className={n === ukuran ? "ini" : ""}>
                  <span>
                    {n}×{n}
                  </span>
                  <b>{data.terbaik[n] ? fmt(data.terbaik[n]) : "—"}</b>
                </li>
              ))}
            </ul>
            <button type="button" className="btn kecil g48-reset" onClick={() => setKonfirmasi("reset")}>
              Hapus rekor + statistik
            </button>
          </section>

          <section>
            <h2 className="g48-judul-sisi">Cara main</h2>
            <ul className="g48-cara">
              <li>
                <b>Gabung</b>
                <p>Dua ubin dengan angka sama yang saling nabrak jadi satu, nilainya dobel dan nambah ke skor.</p>
              </li>
              <li>
                <b>Satu kali</b>
                <p>Ubin hasil gabungan gak bisa gabung lagi di geseran yang sama.</p>
              </li>
              <li>
                <b>Ukuran</b>
                <p>
                  Papan lebih lebar lebih longgar, makanya target naik: {TARGET[4]} di 4×4, {TARGET[5]} di 5×5,{" "}
                  {TARGET[6]} di 6×6.
                </p>
              </li>
            </ul>
          </section>
        </div>
      </div>

      {konfirmasi === "baru" && (
        <Konfirmasi
          judul="Mulai game baru?"
          pesan="Game yang lagi jalan bakal hilang. Skor terbaik lu tetap aman."
          labelYakin="Main baru"
          onYakin={() => {
            setKonfirmasi(null);
            baruMain(ukuran);
          }}
          onBatal={() => setKonfirmasi(null)}
        />
      )}
      {konfirmasi === "reset" && (
        <Konfirmasi
          judul="Hapus rekor dan statistik?"
          pesan="Skor terbaik semua ukuran dan statistik direset ke nol. Game yang lagi jalan tetap lanjut."
          labelYakin="Hapus"
          onYakin={() => {
            setKonfirmasi(null);
            rekorRef.current = false;
            pembandingRef.current = 0;
            setRekorBaru(false);
            ubahData(() => DATA_AWAL);
          }}
          onBatal={() => setKonfirmasi(null)}
        />
      )}

      {terpasang && createPortal(<canvas ref={konfetiRef} className="g48-konfeti" aria-hidden="true" />, document.body)}
    </>
  );
}
