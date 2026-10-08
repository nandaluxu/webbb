import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { pastiinTabelPermainan } from "@/lib/tabel-permainan";

/* /api/fitur/game (fix26): pencatat hasil permainan buat papan skor.
   Satu pintu POST, best-effort — dipanggil game pas TAMAT:

   - Tic Tac Toe : { game:"tictactoe", mode:"cpu", hasil:"menang",
                     langkah:7, catatan:"sempurna" }
     hasil dari sudut pandang pemain yang ngecatat (mode cpu = X,
     online = tanda sendiri). Mode lokal = tanda pemenang "x"|"o".
   - 2048        : { game:"2048", mode:"4", hasil:"buntu",
                     skor:20480, langkah:512, ubin:1024 }
     mode = ukuran papan. hasil "menang" = momen nyampe target
     (sekali per game), "buntu" = papan mati (skor final).

   Prinsip yang sama kayak catatMain Akinator: papan skor gak boleh
   ganggu jalanny game — client fire-and-forget, route gak pernah
   balas selain {ok:true}/400, dan identitas di-snapshot dari sesi
   (gak login = "Tamu"). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAME_VALID = new Set(["tictactoe", "2048"]);
const MODE_TTT = new Set(["cpu", "lokal", "online"]);
const HASIL_TTT = new Set(["menang", "kalah", "seri", "x", "o"]);
const LEVEL_TTT = new Set(["gampang", "sedang", "sempurna"]);
const HASIL_2048 = new Set(["menang", "buntu"]);
const UKURAN_2048 = new Set(["4", "5", "6"]);

const MAKS_SKOR = 10_000_000;
const MAKS_LANGKAH = 100_000;
const MAKS_UBIN = 1_048_576;

/* Throttle ringan per IP: cuma buat nahan spam curl/manual paste.
   Kuota 2 catatan per jendela 700ms — bukan 1 — karena game ONLINE
   nyatet DUA sisi sekaligus (host + guest, seringkali satu IP yang
   sama pas ngetes dua tab / se-NAT), dan dua-duany harus lolos.
   Game biasa tetep gak mungkin tamat dua kali secepat itu. */
const catatTerakhir = new Map<string, number[]>();
const JEDA_MS = 700;
const KUOTA = 2;

function ip(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "lokal";
}

function klem(v: unknown, maks: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, maks);
}

export async function POST(req: NextRequest) {
  let badan: Record<string, unknown> = {};
  try {
    badan = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, galat: "Isi permintaan gak kebaca." }, { status: 400 });
  }

  const game = String(badan.game ?? "");
  if (!GAME_VALID.has(game)) {
    return NextResponse.json({ ok: false, galat: "Game ny gak dikenal." }, { status: 400 });
  }

  const mode = String(badan.mode ?? "");
  const hasil = String(badan.hasil ?? "");
  let catatan = "";

  if (game === "tictactoe") {
    if (!MODE_TTT.has(mode) || !HASIL_TTT.has(hasil)) {
      return NextResponse.json({ ok: false, galat: "Mode/hasil Tic Tac Toe gak valid." }, { status: 400 });
    }
    /* Level CPU ceksara dicatat cuma pas mode cpu — field laen diabaain. */
    const lvl = String(badan.catatan ?? "");
    if (mode === "cpu" && LEVEL_TTT.has(lvl)) catatan = lvl;
  } else if (!UKURAN_2048.has(mode) || !HASIL_2048.has(hasil)) {
    return NextResponse.json({ ok: false, galat: "Mode/hasil 2048 gak valid." }, { status: 400 });
  }

  /* Throttle jendela geser: simpan cap waktu catatan yang lolos,
     buang yang udah keluar jendela, tolak kalau kuota abis. Client
     gak perlu ngulang — catatan ny emang gak krusial. */
  const kunciIp = ip(req);
  const kini = Date.now();
  const jendela = (catatTerakhir.get(kunciIp) ?? []).filter((t) => kini - t < JEDA_MS);
  if (jendela.length >= KUOTA) {
    return NextResponse.json({ ok: false, galat: "Kebanyakan catatan beruntun." }, { status: 429 });
  }
  jendela.push(kini);
  catatTerakhir.set(kunciIp, jendela);

  try {
    /* DB lama (pra-fix26) belum punya tabel Permainan — bikin dulu
       sebelum nyatet, biar menang kalah player gak ngumpet cuma
       gara-gara upgrade. Gagal bikin = gagal catat, tetep ok:true. */
    await pastiinTabelPermainan();
    const p = await bacaSesi();
    await db.permainan.create({
      data: {
        userId: p?.id ?? null,
        pemainNama: p?.nama ?? "Tamu",
        game,
        mode,
        hasil,
        skor: klem(badan.skor, MAKS_SKOR),
        langkah: klem(badan.langkah, MAKS_LANGKAH),
        ubin: klem(badan.ubin, MAKS_UBIN),
        catatan,
      },
    });
  } catch {
    /* DB lagi error: balas tetep ok — papan skor gak boleh bikin game
       kerasa gagal padahal udah kelar. (Kebalikannya: data hilang
       lebih bisa dimaapin daripada game ny rewel.) */
  }
  return NextResponse.json({ ok: true });
}
