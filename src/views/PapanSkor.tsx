"use client";

/* PapanSkor: halaman leaderboard di /dashboard (r26, fix26).
   - Semua rata tengah: judul "Leaderboard", dropdown kategori, box daftar.
   - fix26: dropdown kategori (PilihOpsi — modul dropdown situs) buat
     ganti arena: Akinator (tebak), Tic Tac Toe + 2048 (games). Tiap
     arena bawa dua seksi ny sendiri; pilihan terakhir diinget di
     localStorage biar balik ke arena yang sama pas dibuka lagi.
   - Tiap box: 10 baris per halaman, isiny bisa di-scroll kalau
     layar sempit, paging ‹ › buat nyari peringkat berikutny.
   - Data dari /api/leaderboard?arena=<id>&seksi=<id> (agregasi di
     server: AkinatorMain utk akinator, Permainan utk games). */

import { useCallback, useEffect, useRef, useState } from "react";
import PilihOpsi, { type GrupOpsi } from "@/components/PilihOpsi";

const PER_HALAMAN = 10;
const KUNCI_ARENA = "neyhra:lb-arena";

/* Baris leaderboard: nomor + nama + kolom bebas per seksi (stat ny
   sendiri yang tahu field apa aja). */
type Baris = { peringkat: number; nama: string } & Record<string, unknown>;
type Muatan = { halaman: number; totalHalaman: number; total: number; baris: Baris[] };

function fmt(n: unknown) {
  return Number(n ?? 0).toLocaleString("id-ID");
}

/* ---------- Stat per seksi: teks kecil di kanan nama ---------- */

function statChar(b: Baris): string {
  const bagian: string[] = [];
  bagian.push(b.lolos + "× lolos");
  if (Number(b.kena) > 0) bagian.push(b.kena + "× kena");
  if (Number(b.jawabMax) > 0) bagian.push(b.jawabMax + " tanya maks");
  return bagian.join(" · ");
}

function statPemain(b: Baris): string {
  const bagian: string[] = [];
  bagian.push(b.totalJawab + " pertanyaan");
  bagian.push(b.main + " game");
  if (Number(b.kena) > 0) bagian.push(b.kena + "× kena");
  return bagian.join(" · ");
}

function statTttCpu(b: Baris): string {
  const bagian: string[] = [];
  bagian.push(b.menang + "× menang");
  if (Number(b.sempurna) > 0) bagian.push(b.sempurna + " di Sempurna");
  if (Number(b.kalah) > 0) bagian.push(b.kalah + "× kalah");
  if (Number(b.seri) > 0) bagian.push(b.seri + "× seri");
  return bagian.join(" · ");
}

function statTttOnline(b: Baris): string {
  const bagian: string[] = [];
  bagian.push(b.menang + "× menang");
  if (Number(b.kalah) > 0) bagian.push(b.kalah + "× kalah");
  if (Number(b.seri) > 0) bagian.push(b.seri + "× seri");
  return bagian.join(" · ");
}

function stat2048Skor(b: Baris): string {
  const bagian: string[] = [];
  bagian.push("skor " + fmt(b.skor));
  if (Number(b.ubin) > 0) bagian.push("ubin " + b.ubin);
  if (b.papan) bagian.push("papan " + b.papan + "×" + b.papan);
  if (b.hasil === "menang") bagian.push("capai target");
  else if (b.hasil === "buntu") bagian.push("buntu");
  return bagian.join(" · ");
}

function stat2048Menang(b: Baris): string {
  const bagian: string[] = [];
  bagian.push(b.menang + "× capai target");
  if (Number(b.ubinTerbaik) > 0) bagian.push("ubin terbaik " + b.ubinTerbaik);
  return bagian.join(" · ");
}

/* ---------- Daftar arena (kategori di dropdown) ---------- */

type Seksi = { id: string; judul: string; sub: string; kosong: string; stat: (b: Baris) => string };
type ArenaCfg = { id: string; lede: string; seksi: Seksi[] };

const ARENA: Record<string, ArenaCfg> = {
  akinator: {
    id: "akinator",
    lede: "Papan peringkat Neyhra Playground. Arena Akinator: dari karakter yang paling susah ditebak genie, sampe pemain yang paling rajin ngejawab pertanyaanny.",
    seksi: [
      {
        id: "char",
        judul: "Char tersulit ditebak",
        sub: "Paling sering bikin genie nyerah — nyampe daftar mirip pun gak kekena.",
        kosong: "Belum ada karakter yang lolos dari tebakan genie. Main sampe nyerah terus pilih charny, nanti nyangkut di sini.",
        stat: statChar,
      },
      {
        id: "pemain",
        judul: "Paling rajin nanya",
        sub: "Siapa yang paling banyak ngasih pertanyaan (jawaban) ke akinator.",
        kosong: "Belum ada yang rajin nanya. Tiap jawaban yang lo kasih pas main ikut dihitung.",
        stat: statPemain,
      },
    ],
  },
  tictactoe: {
    id: "tictactoe",
    lede: "Arena Tic Tac Toe: siapa yang paling jago ngalahin CPU (level Sempurna dihitung terpisah), dan siapa yang paling sering menang duel online.",
    seksi: [
      {
        id: "menang-cpu",
        judul: "Paling jago ngalahin CPU",
        sub: "Menang terbanyak lawan CPU — makin jarang kalah, makin tinggi. Menang di level Sempurna kehitung khusus.",
        kosong: "Belum ada yang ngalahin CPU. Main di /fitur/tictactoe mode Lawan CPU, menangnya kecatat otomatis di sini.",
        stat: statTttCpu,
      },
      {
        id: "menang-online",
        judul: "Duel online terbanyak dimenangin",
        sub: "Menang terbanyak pas nyabar lawan pemain beneran lewat room code.",
        kosong: "Belum ada duel online yang kelar. Bikin room di /fitur/tictactoe, ajak temen, menang kalah kecatat di sini.",
        stat: statTttOnline,
      },
    ],
  },
  "2048": {
    id: "2048",
    lede: "Arena 2048: skor tertinggi sepanjang waktu (papan sekecil apa pun sah) dan siapa yang paling sering nyampe target ubin.",
    seksi: [
      {
        id: "skor",
        judul: "Skor tertinggi",
        sub: "Skor akhir terbaik per pemain, sekali catat buat selamany — papan + ubin tertingginy ikut kecatat.",
        kosong: "Belum ada skor yang kecatat. Main di /fitur/game-2048 sampe buntu (atau nyampe target), skorny nyangkut di sini.",
        stat: stat2048Skor,
      },
      {
        id: "menang",
        judul: "Paling sering nyampe target",
        sub: "Serius ngejar ubin target (2048 di 4×4, dst) — bukan cuma sekali lewat.",
        kosong: "Belum ada yang nyampe target. Kumpulin ubin nyampe angka target di 2048, catetanny masuk sini.",
        stat: stat2048Menang,
      },
    ],
  },
};

const GRUP_ARENA: GrupOpsi[] = [
  { judul: "Tebak", opsi: [{ nilai: "akinator", teks: "Akinator" }] },
  { judul: "Games", opsi: [{ nilai: "tictactoe", teks: "Tic Tac Toe" }, { nilai: "2048", teks: "2048" }] },
];

function Chevron({ arah }: { arah: -1 | 1 }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden="true">
      {arah === -1 ? <path d="M15 5l-7 7 7 7" /> : <path d="M9 5l7 7-7 7" />}
    </svg>
  );
}

function BoksSkor({ arena, id, judul, sub, kosong, stat }: { arena: string; id: string; judul: string; sub: string; kosong: string; stat: (b: Baris) => string }) {
  const [muat, setMuat] = useState<Muatan | null>(null);
  const [galat, setGalat] = useState(false);
  const [halaman, setHalaman] = useState(1);

  const ambil = useCallback(
    async (h: number) => {
      setGalat(false);
      try {
        const res = await fetch(`/api/leaderboard?arena=${arena}&seksi=${id}&halaman=${h}`, {
          signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error();
        setMuat({ halaman: data.halaman, totalHalaman: data.totalHalaman, total: data.total, baris: data.baris });
      } catch {
        setGalat(true);
      }
    },
    [arena, id]
  );

  useEffect(() => {
    void ambil(halaman);
  }, [halaman, ambil]);

  /* P0-1: jaringan balik + papan lagi gagal -> muat ulang sendiri
     (halaman terakhir yang kepake, bukan balik ke halaman 1). */
  const galatRef = useRef(false);
  useEffect(() => {
    galatRef.current = galat;
  }, [galat]);
  useEffect(() => {
    const cobaBalik = () => {
      if (galatRef.current) void ambil(halaman);
    };
    window.addEventListener("jaringan:balik", cobaBalik);
    return () => window.removeEventListener("jaringan:balik", cobaBalik);
  }, [ambil, halaman]);

  const baris = muat?.baris ?? [];
  const totalHalaman = muat?.totalHalaman ?? 1;

  return (
    <section className="lb-boks" aria-label={judul}>
      <header className="lb-boks-kepala">
        <h2>{judul}</h2>
        <p>{sub}</p>
        {/* fix31: stempel jumlah di pojok — kepala box gak polos lagi. */}
        {muat && muat.total > 0 && <span className="lb-jumlah">{muat.total} tercatat</span>}
      </header>

      {galat ? (
        <div className="lb-isi">
          <p className="lb-isi-kosong">Papan skorny gak kebaca. Sambungan ny lagi bete kali.</p>
          <button type="button" className="btn kecil" onClick={() => void ambil(halaman)}>
            Coba lagi
          </button>
        </div>
      ) : !muat ? (
        <p className="lb-isi-kosong" aria-live="polite">
          Nyiapin papan...
        </p>
      ) : baris.length === 0 ? (
        <p className="lb-isi-kosong">{kosong}</p>
      ) : (
        <ol className="lb-daftar">
          {baris.map((b) => (
            <li key={b.peringkat + "-" + b.nama} className={"lb-baris" + (b.peringkat <= 3 ? " top" : "")}>
              <span className="lb-rang">#{b.peringkat}</span>
              <b className="lb-nama">{b.nama}</b>
              <span className="lb-stat">{stat(b)}</span>
            </li>
          ))}
        </ol>
      )}

      {muat && muat.total > PER_HALAMAN && (
        <nav className="lb-halaman" aria-label={"Halaman " + judul}>
          <button
            type="button"
            data-sfx="ui-menu"
            onClick={() => setHalaman((h) => Math.max(1, h - 1))}
            disabled={halaman <= 1}
            aria-label="Halaman sebelumny"
          >
            <Chevron arah={-1} />
          </button>
          <span className="lb-status" aria-live="polite">
            Halaman {halaman} dari {totalHalaman}
          </span>
          <button
            type="button"
            data-sfx="ui-menu"
            onClick={() => setHalaman((h) => Math.min(totalHalaman, h + 1))}
            disabled={halaman >= totalHalaman}
            aria-label="Halaman berikutny"
          >
            <Chevron arah={1} />
          </button>
        </nav>
      )}
    </section>
  );
}

export default function PapanSkor() {
  const [arena, setArena] = useState("akinator");

  /* Kategori terakhir diinget (efek, biar render server = render
     awal client — gak ada bedanya yang keliatan pas flash). */
  useEffect(() => {
    try {
      const simpan = localStorage.getItem(KUNCI_ARENA);
      if (simpan && ARENA[simpan]) setArena(simpan);
    } catch {}
  }, []);

  function gantiArena(nilai: string) {
    if (!ARENA[nilai]) return;
    setArena(nilai);
    try {
      localStorage.setItem(KUNCI_ARENA, nilai);
    } catch {}
  }

  const cfg = ARENA[arena] ?? ARENA.akinator;

  return (
    <>
      <section className="head lb-kepala">
        <h1>Leaderboard</h1>
        <p className="lede">{cfg.lede}</p>
      </section>

      <div className="lb-papan masuk on">
        <div className="lb-pilih">
          <PilihOpsi id="lb-arena" label="Kategori" grup={GRUP_ARENA} value={arena} onChange={gantiArena} />
        </div>
        <div className="lb-grid">
          {cfg.seksi.map((s) => (
            <BoksSkor key={cfg.id + "-" + s.id} arena={cfg.id} id={s.id} judul={s.judul} sub={s.sub} kosong={s.kosong} stat={s.stat} />
          ))}
        </div>
      </div>
    </>
  );
}
