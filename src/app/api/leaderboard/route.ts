import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pastiinTabelPermainan } from "@/lib/tabel-permainan";

/* /api/leaderboard: data papan skor buat /dashboard (r26, fix26).
   GET ?arena=<akinator|tictactoe|2048>&seksi=<id>&halaman=1
   (10 baris per halaman; arena kosong/ngawur = akinator, jadi link
   lama tetep jalan).

   Tiap arena punya seksi ny sendiri (kategory di halaman ny pilih
   lewat dropdown PilihOpsi):
   - akinator : char (karakter tersulit ditebak) + pemain (paling
     rajin nanya) — agregasi AkinatorMain, nggak berubah.
   - tictactoe: menang-cpu (paling jago ngalahin CPU, level
     sempurna dihitung terpisah) + menang-online (duel online).
   - 2048     : skor (skor tertinggi + ubin tertinggi game itu) +
     menang (paling sering nyampe target).

   Pola hitung sama semua: groupBy di DB → digabung + diurut di
   memori (skala playground, rows game ratusan, gak ada guna
   ngejar query SQL murni buat sesuatu yang kebaca mata). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_HALAMAN = 10;

type Arena = "akinator" | "tictactoe" | "2048";
const ARENA_VALID = new Set<Arena>(["akinator", "tictactoe", "2048"]);

/* Potong hasil jadi halaman + kasih nomor peringkat. */
function halamankan(urut: [string, Record<string, unknown>][], halaman: number) {
  const total = urut.length;
  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const h = Math.min(halaman, totalHalaman);
  const baris = urut.slice((h - 1) * PER_HALAMAN, h * PER_HALAMAN).map(([nama, b], i) => ({
    peringkat: (h - 1) * PER_HALAMAN + i + 1,
    nama,
    ...b,
  }));
  return { halaman: h, total, totalHalaman, baris };
}

function balas(arena: Arena, seksi: string, hasil: ReturnType<typeof halamankan>) {
  return NextResponse.json({ ok: true, arena, seksi, ...hasil, perHalaman: PER_HALAMAN });
}

/* Seksi yang dibalas buat arena+param ny — dipake juga pas jalur
   darurat (tabel gak ada → papan kosong), biar konsisten sama
   jalur normal. */
function seksiDefault(arena: Arena, seksi: string): string {
  if (arena === "tictactoe") return seksi === "menang-online" ? "menang-online" : "menang-cpu";
  if (arena === "2048") return seksi === "menang" ? "menang" : "skor";
  return seksi === "pemain" ? "pemain" : "char";
}

export async function GET(req: NextRequest) {
  const paramArena = req.nextUrl.searchParams.get("arena") ?? "";
  const arena: Arena = ARENA_VALID.has(paramArena as Arena) ? (paramArena as Arena) : "akinator";
  const seksi = req.nextUrl.searchParams.get("seksi") ?? "";
  const halaman = Math.max(1, Math.floor(Number(req.nextUrl.searchParams.get("halaman")) || 1));

  /* Arena games butuh tabel Permainan (pendatang fix26). DB lama
     yang belum di-db push dapet tabel ny dibikin otomatis di sini —
     papan games gak boleh "ilang" cuma gara-gara upgrade. */
  if (arena !== "akinator") {
    try {
      await pastiinTabelPermainan();
    } catch {
      /* Gagal kebikin (fs read-only / db kuncian) — query di bawah
         yang bakal cerita, nanti ke-catch jadi papan kosong. */
    }
    /* Prisma client lawas (folder lama yang gak di `npm install`
       ulang) gak kenal model permainan — papan games kebaca kosong
       aja; abis di-install ulang + db push, datany nyambung
       sendiri, gak ada yang kehilangan. */
    if (!(db as { permainan?: unknown }).permainan) {
      return balas(arena, seksiDefault(arena, seksi), halamankan([], halaman));
    }
  }

  try {
    /* ===================== ARENA TIC TAC TOE ===================== */
    if (arena === "tictactoe") {
      if (seksi === "menang-online") {
        const grup = await db.permainan.groupBy({
          by: ["pemainNama", "hasil"],
          _count: { _all: true },
          where: { game: "tictactoe", mode: "online" },
        });
        const gabung = new Map<string, { menang: number; kalah: number; seri: number }>();
        for (const g of grup) {
          const b = gabung.get(g.pemainNama) ?? { menang: 0, kalah: 0, seri: 0 };
          if (g.hasil === "menang") b.menang += g._count._all;
          else if (g.hasil === "kalah") b.kalah += g._count._all;
          else if (g.hasil === "seri") b.seri += g._count._all;
          gabung.set(g.pemainNama, b);
        }
        /* Papan ngurut MENANG — pemain yang belum pernah menang sama
           sekali gak dimunculin (baris "0× menang" cuma dengeran
           buat yang liat, bukan info). Kalau nyerah semua, kosong ny
           sendiri yang ngajakin main. */
        const urut = [...gabung.entries()]
          .filter(([, b]) => b.menang > 0)
          .sort((a, b) => {
            /* Juara duel = menang terbanyak; seri = yang paling jarang
               kalah, terus yang paling sering seri. */
            const dMenang = b[1].menang - a[1].menang;
            if (dMenang !== 0) return dMenang;
            const dKalah = a[1].kalah - b[1].kalah;
            if (dKalah !== 0) return dKalah;
            const dSeri = b[1].seri - a[1].seri;
            if (dSeri !== 0) return dSeri;
            return a[0].localeCompare(b[0]);
          });
        return balas(arena, seksi, halamankan(urut, halaman));
      }

      /* Seksi default arena tictactoe: menang-cpu. */
      const grup = await db.permainan.groupBy({
        by: ["pemainNama", "hasil", "catatan"],
        _count: { _all: true },
        where: { game: "tictactoe", mode: "cpu" },
      });
      const gabung = new Map<string, { menang: number; kalah: number; seri: number; sempurna: number }>();
      for (const g of grup) {
        const b = gabung.get(g.pemainNama) ?? { menang: 0, kalah: 0, seri: 0, sempurna: 0 };
        if (g.hasil === "menang") b.menang += g._count._all;
        else if (g.hasil === "kalah") b.kalah += g._count._all;
        else if (g.hasil === "seri") b.seri += g._count._all;
        if (g.hasil === "menang" && g.catatan === "sempurna") b.sempurna += g._count._all;
        gabung.set(g.pemainNama, b);
      }
      /* Baris "0× menang" = dengeran doang, bukan info (liat seksi
         online) — yang belum pernah menang gak dimunculin, kosong ny
         sendiri yang ngajakin main. */
      const urut = [...gabung.entries()]
        .filter(([, b]) => b.menang > 0)
        .sort((a, b) => {
          /* Jago ngalahin CPU = menang terbanyak; seri = jarang kalah,
             terus sering seri, terus nama. Menang di level Sempurna
             cuma jadi kolom embel-embel (gak ngaruh urutan). */
          const dMenang = b[1].menang - a[1].menang;
          if (dMenang !== 0) return dMenang;
          const dKalah = a[1].kalah - b[1].kalah;
          if (dKalah !== 0) return dKalah;
          const dSeri = b[1].seri - a[1].seri;
          if (dSeri !== 0) return dSeri;
          return a[0].localeCompare(b[0]);
        });
      return balas(arena, "menang-cpu", halamankan(urut, halaman));
    }

    /* ======================== ARENA 2048 ======================== */
    if (arena === "2048") {
      if (seksi === "menang") {
        const grup = await db.permainan.groupBy({
          by: ["pemainNama", "hasil"],
          _count: { _all: true },
          _max: { ubin: true },
          where: { game: "2048" },
        });
        const gabung = new Map<string, { menang: number; total: number; ubinTerbaik: number }>();
        for (const g of grup) {
          const b = gabung.get(g.pemainNama) ?? { menang: 0, total: 0, ubinTerbaik: 0 };
          b.total += g._count._all;
          if (g.hasil === "menang") b.menang += g._count._all;
          b.ubinTerbaik = Math.max(b.ubinTerbaik, g._max.ubin ?? 0);
          gabung.set(g.pemainNama, b);
        }
        /* Sekali aja cukup: yang belum pernah nyampe target gak
           dimunculin ("0× capai target" bukan info, cuma dengeran). */
        const urut = [...gabung.entries()]
          .filter(([, b]) => b.menang > 0)
          .sort((a, b) => {
            /* Rajin ngejar target = sering nyampe; seri = ubin terbaik
               lebih tinggi (nyaris-nyaris), terus yang rajin main. */
            const dMenang = b[1].menang - a[1].menang;
            if (dMenang !== 0) return dMenang;
            const dUbin = b[1].ubinTerbaik - a[1].ubinTerbaik;
            if (dUbin !== 0) return dUbin;
            const dTotal = b[1].total - a[1].total;
            if (dTotal !== 0) return dTotal;
            return a[0].localeCompare(b[0]);
          });
        return balas(arena, "menang", halamankan(urut, halaman));
      }

      /* Seksi default arena 2048: skor tertinggi. Butuh baris utuh
         per pemain (skor + ubin + papan + hasil game terbaik ny),
         jadi findMany lalu merge di memori — urut di SQL biar row
         pertama per nama langsung jadi yang terbaik. */
      const mentah = await db.permainan.findMany({
        where: { game: "2048" },
        select: { pemainNama: true, skor: true, ubin: true, mode: true, hasil: true },
        orderBy: [{ skor: "desc" }, { ubin: "desc" }, { waktu: "desc" }],
      });
      const gabung = new Map<string, { skor: number; ubin: number; papan: string; hasil: string }>();
      for (const r of mentah) {
        if (gabung.has(r.pemainNama)) continue; /* udah ketemu terbaik ny */
        gabung.set(r.pemainNama, { skor: r.skor, ubin: r.ubin, papan: r.mode, hasil: r.hasil });
      }
      const urut = [...gabung.entries()].sort((a, b) => {
        const dSkor = b[1].skor - a[1].skor;
        if (dSkor !== 0) return dSkor;
        const dUbin = b[1].ubin - a[1].ubin;
        if (dUbin !== 0) return dUbin;
        return a[0].localeCompare(b[0]);
      });
      return balas(arena, "skor", halamankan(urut, halaman));
    }

    /* ====================== ARENA AKINATOR ====================== */
    if (seksi === "pemain") {
      const grup = await db.akinatorMain.groupBy({
        by: ["pemainNama", "hasil"],
        _count: { _all: true },
        _sum: { jumlahJawab: true },
      });
      const gabung = new Map<string, { main: number; kena: number; totalJawab: number }>();
      for (const g of grup) {
        const b = gabung.get(g.pemainNama) ?? { main: 0, kena: 0, totalJawab: 0 };
        b.main += g._count._all;
        if (g.hasil === "kena") b.kena += g._count._all;
        b.totalJawab += g._sum.jumlahJawab ?? 0;
        gabung.set(g.pemainNama, b);
      }
      const urut = [...gabung.entries()].sort((a, b) => {
        /* Rajin nanya = total pertanyaan terbanyak; seri = yang lebih
           sering bikin genie kena, terus yang lebih sering main. */
        const dJawab = b[1].totalJawab - a[1].totalJawab;
        if (dJawab !== 0) return dJawab;
        const dKena = b[1].kena - a[1].kena;
        if (dKena !== 0) return dKena;
        const dMain = b[1].main - a[1].main;
        if (dMain !== 0) return dMain;
        return a[0].localeCompare(b[0]);
      });
      return balas(arena, "pemain", halamankan(urut, halaman));
    }

    /* Seksi char: satu karakter bisa muncul berkali-kali (kena/lolos),
       digabung per nama, diurut dari yang paling sering nyerang genie. */
    const grup = await db.akinatorMain.groupBy({
      by: ["charNama", "hasil"],
      _count: { _all: true },
      _max: { jumlahJawab: true },
      where: { charNama: { not: null } },
    });
    const gabung = new Map<string, { main: number; lolos: number; kena: number; jawabMax: number }>();
    for (const g of grup) {
      if (!g.charNama) continue;
      const b = gabung.get(g.charNama) ?? { main: 0, lolos: 0, kena: 0, jawabMax: 0 };
      b.main += g._count._all;
      if (g.hasil === "pilih") b.lolos += g._count._all;
      else if (g.hasil === "kena") b.kena += g._count._all;
      b.jawabMax = Math.max(b.jawabMax, g._max.jumlahJawab ?? 0);
      gabung.set(g.charNama, b);
    }
    const urut = [...gabung.entries()].sort((a, b) => {
      /* Tersulit = paling sering lolos dari tebakan; seri = char yang
         butuh pertanyaan terbanyak, terus yang paling sering main. */
      const dLolos = b[1].lolos - a[1].lolos;
      if (dLolos !== 0) return dLolos;
      const dJawab = b[1].jawabMax - a[1].jawabMax;
      if (dJawab !== 0) return dJawab;
      const dMain = b[1].main - a[1].main;
      if (dMain !== 0) return dMain;
      return a[0].localeCompare(b[0]);
    });
    return balas(arena, "char", halamankan(urut, halaman));
  } catch (e) {
    /* P2021/P2022 = tabel/kolom Permainan gak ada di DB lama DAN
       gagal kebikin otomatis — balas papan kosong, bukan error:
       papan ny gak boleh keliatan "ilang" gara-gara upgrade. */
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2021" || e.code === "P2022")) {
      return balas(arena, seksiDefault(arena, seksi), halamankan([], halaman));
    }
    return NextResponse.json({ ok: false, galat: "Papan skorny gak kebaca sekarang." }, { status: 502 });
  }
}
