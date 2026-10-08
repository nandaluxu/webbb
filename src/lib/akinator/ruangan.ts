/* Pengelola sesi Akinator di sisi server.

   Sesi game disimpen di memori (Map di globalThis biar gak ke-reset
   pas dev server hot-reload). Tiap aksi nyentuh sesi = waktu aktif
   ke-update; sesi nganggur > 30 menit dibersihin (jar cookie ikut
   dihapus dari data/akinator, context playwright ikut ditutup).
   Ada batas jumlah sesi hidup biar memori + akun Cortana-nya
   akinator gak dipake buang-buang.

   Mulai game (r24) nyoba transport BERTINGKAT dari yang paling
   ringan, diputuskan strategi.mjs dari ENV:
     HTTP langsung → proxy (rotasi cuma saat gagal) → Playwright
     (browser, lazy start). Game yang udah jalan SISTU lewat
     transport itu terus sampe selesai (cookie ny nempel di situ).
   Hasil tiap percobaan dicatat ke telemetry.mjs (dilihat owner
   lewat /api/admin/akinator, gak diekspos ke user biasa).

   Satu-satunya pintu masuk: /api/akinator (route.ts). */

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

// Impor mesin (murni Node: curl + jar file) - JANGAN diimpor dari
// komponen client. Tipe any: state ny bentukny dinamis dari mesin.
import * as mesin from "./mesin.mjs";
import { urutanStrategi } from "./strategi.mjs";
import { catatPercobaan } from "./telemetry.mjs";
import { backendTersedia, infoDeteksi } from "./playwright.mjs";

type StateAkinator = Record<string, any> & { gameId: string; status: string; updatedAt: number; _jarDir?: string; transport?: string | null; proxy?: string | null };

type Simpanan = {
  state: StateAkinator;
  terakhir: number;
};

const BATAS_SESI = 40; // sesi hidup maksimal
const IDLE_MS = 30 * 60_000; // 30 menit tanpa aktivitas = dibersihin

function peta(): Map<string, Simpanan> {
  const g = globalThis as unknown as { __akinatorSesi?: Map<string, Simpanan> };
  if (!g.__akinatorSesi) g.__akinatorSesi = new Map();
  return g.__akinatorSesi;
}

function jarDir(): string {
  return process.env.AKINATOR_JAR_DIR || path.join(process.cwd(), "data", "akinator");
}

async function buang(gameId: string, state?: StateAkinator) {
  peta().delete(gameId);
  if (state?.transport === "playwright") {
    await mesin.tutupTransport(state);
  }
  try {
    const dir = state?._jarDir || jarDir();
    await rm(path.join(dir, `akinator-${gameId}.jar`), { force: true });
  } catch {
    /* best effort */
  }
}

/** Buang sesi nganggur + sesi over (game selesai lama). */
export function bersihkanIdle() {
  const kini = Date.now();
  for (const [id, s] of peta()) {
    if (kini - s.terakhir > IDLE_MS || s.state.status === "over" && kini - s.terakhir > 60_000) {
      void buang(id, s.state);
    }
  }
}

/** Kalau penuh, lempar sesi paling nganggur duluan. */
function pastiKapasitas() {
  const p = peta();
  if (p.size < BATAS_SESI) return;
  const urut = [...p.entries()].sort((a, b) => a[1].terakhir - b[1].terakhir);
  for (let i = 0; i < Math.max(1, p.size - BATAS_SESI + 1); i++) {
    void buang(urut[i][0], urut[i][1].state);
  }
}

/* Error code yang layak nyobain transport berikutny (bukan salah
   input/logika). CHALLENGE = kena Cloudflare; CURL_FAIL/PW_FAIL =
   transport ny mati; PW_UNAVAILABLE = lapisaan browser gak ada
   di mesin ini (r25: gak bug, kondisi lingkungan — gak usah dilih
   mentah-mentah ke pemain). Kode laen (KO, PARSE_FAIL, dsb.)
   berarti transport ny SAMPE server dan server ny yang jawab —
   gak ada gunany ganti transport. */
const LAYAK_GANTI = new Set(["CHALLENGE", "CURL_FAIL", "PW_FAIL", "PW_UNAVAILABLE", "HTTP_TRANSIENT"]);

/* Budget waktu total buat mulai game (r25): tanpa ini, satu IP yang
   kebloir + retry bisa gantungin tombol "Mulai main" sampe menit-menit
   (curl max-time 60 detik PER percobaan, dikali retry). Setelah budget
   habis, pemain dapet error yang jelas + bisa coba lagi — gak spinner
   selamany. Default 45 detik: cukup buat lapisan browser launch +
   lewatin challenge. ENV: AKINATOR_START_BUDGET_MS (ms). */
const BUDGET_MULAI_MS = (() => {
  const n = Number(process.env.AKINATOR_START_BUDGET_MS);
  return Number.isFinite(n) && n >= 15000 && n <= 300000 ? Math.round(n) : 45000;
})();

function kodeError(e: unknown): string {
  return (e as { code?: string })?.code ?? "ERROR";
}

async function mulaiGameInterna(): Promise<StateAkinator> {
  bersihkanIdle();
  pastiKapasitas();
  const dir = jarDir();
  await mkdir(dir, { recursive: true });

  let galatAkhir: unknown = null;
  let kodeAkhir = "ERROR";
  const nyoba: string[] = [];
  for (const s of urutanStrategi()) {
    const mulai = Date.now();
    nyoba.push(s.mode);
    try {
      const state = (await mesin.startGame({
        locale: "id",
        jarDir: dir,
        proxy: s.mode === "proxy" ? (s as { proxy?: string }).proxy : undefined,
        transport: s.mode === "playwright" ? "playwright" : undefined,
      })) as StateAkinator;
      catatPercobaan(s.mode, { ok: true, ms: Date.now() - mulai, alasan: null });
      peta().set(state.gameId, { state, terakhir: Date.now() });
      return state;
    } catch (e) {
      galatAkhir = e;
      kodeAkhir = kodeError(e);
      catatPercobaan(s.mode, { ok: false, ms: Date.now() - mulai, alasan: kodeAkhir });
      if (!LAYAK_GANTI.has(kodeAkhir)) {
        // Server ny jawab (bukan masalah transport): ganti transport
        // gak akan ngebantu, langsung lempar ke pemain.
        throw e;
      }
      // else: coba strategi berikutny (proxy → playwright).
    }
  }
  /* Semua transport gagal: bungkus jadi SATU pesan yang jelas + ngasih
     solusi, jangan bocorin teks internal mentah-mentah. Detail teknis
     ny tetep ada di telemetry owner (/api/admin/akinator). */
  const petaKode: Record<string, string> = {
    CHALLENGE:
      "Server ny gak bisa ngobrol sama akinator.com — koneksi ny kena tantangan Cloudflare. " +
      "Itu sementara (cooldown ~3 menit), tapi kalau kejadian terus dari jaringan lu: " +
      "pastiin Chrome/Edge kepasang di mesin server (mode browser otomatis) atau isi AKINATOR_PROXY.",
    CURL_FAIL:
      "Server ny gak bisa nyampe akinator.com sama sekali (koneksi/DNS). Cek internet ny mesin server, " +
      "terus coba lagi — atau isi proxy di AKINATOR_PROXY.",
    PW_UNAVAILABLE:
      "Koneksi langsung kena blokir dan mode browser gak bisa nyala karena gak ada " +
      "Chrome/Edge/Chromium yang kedeteksi di mesin server. Pasang salah satunya (deteksi otomatis), " +
      "atau set AKINATOR_PLAYWRIGHT_EXECUTABLE_PATH, atau isi AKINATOR_PROXY.",
    PW_FAIL:
      "Koneksi langsung kena blokir dan mode browser ny juga gagal jalan. " +
      "Coba lagi bentar — kalau makin sering, isi proxy di AKINATOR_PROXY biar muter lewat jalur laen.",
  };
  const pesan =
    petaKode[kodeAkhir] ??
    "Gak bisa nyiapin game dari akinator.com sekarang (dicoba: " +
      nyoba.join(" → ") +
      "). Coba lagi beberapa saat — kalau nyambungny kepake tunnel dan lama banget, " +
      "naikin AKINATOR_START_BUDGET_MS.";
  const err = new Error(pesan) as Error & { code: string; detail: unknown };
  err.code = "SEMUA_TRANSPORT_GAGAL";
  err.detail = { kodeTerakhir: kodeAkhir, nyoba };
  throw err;
}

export async function mulaiGame(): Promise<StateAkinator> {
  /* Anggaran waktu: kalahny (timeout) tetep jalan di background tapi
     bounded curl max-time ny sendiri — gak numpuk jadi zombie. */
  const lempar = new Promise<never>((_, tolak) => {
    setTimeout(
      () =>
        tolak(
          (() => {
            const e = new Error(
              "Nyambung ke akinator.com kelamaan dari server lu (lebih dari " +
                Math.round(BUDGET_MULAI_MS / 1000) +
                " detik). Biasany kena blokir jaringan atau lagi sesak — coba lagi. " +
                "Kalau pake tunnel/HP, coba langsung dari localhost biar keliatan masalahny di mana.",
            ) as Error & { code: string };
            e.code = "MULAI_LAMA";
            return e;
          })(),
        ),
      BUDGET_MULAI_MS,
    );
  });
  return Promise.race([mulaiGameInterna(), lempar]);
}

/** Ambil sesi aktif (sekalian nyatat aktivitas + sweep). */
export function ambilGame(gameId: string): StateAkinator | null {
  if (typeof gameId !== "string" || !/^[a-z0-9-]{4,64}$/i.test(gameId)) return null;
  bersihkanIdle();
  const s = peta().get(gameId);
  if (!s) return null;
  s.terakhir = Date.now();
  return s.state;
}

/** Selesai (menang / nyerah / pilih soundlike): sesi ditandain over,
 *  dibersihin bentar lagi oleh sweep (kasi 1 menit buat layar hasil). */
export function tandaiSelesai(state: StateAkinator) {
  const s = peta().get(state.gameId);
  if (s) s.terakhir = Date.now();
}

/** Tutup sesi game SEKARANG (r26): tombol "mulai dari awal" di web
 *  manggil ini sebelum nyiapin game baru. Sebelumny sesi game lama
 *  cuma ditandain selesai dan tetep nyangkut sampe sweep (context
 *  browser + jar file + entri map idup 30 menit) — di mesin yang
 *  cuman muat sedikit sesi, ini bikin "main ulang" makin berat.
 *  Sekarang: transport playwright ditutup, jar dihapus, entri map
 *  dibuang saat itu juga. Idempotent — sesi udah gak ada juga sukses
 *  (balikin false biar route bisa bedain, tapi client gak wajib peduli). */
export async function tutupGame(gameId: string): Promise<boolean> {
  if (typeof gameId !== "string" || !/^[a-z0-9-]{4,64}$/i.test(gameId)) return false;
  const s = peta().get(gameId);
  if (!s) return false;
  await buang(gameId, s.state);
  return true;
}

/** Info transport buat dashboard owner (telemetry). */
export async function statusTransport() {
  return {
    backendPlaywright: await backendTersedia().catch(() => null),
    deteksi: await infoDeteksi().catch(() => null),
  };
}

export { mesin };
