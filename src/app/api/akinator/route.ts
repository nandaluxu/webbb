import { NextRequest, NextResponse } from "next/server";
import { mulaiGame, ambilGame, tandaiSelesai, tutupGame, mesin } from "@/lib/akinator/ruangan";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";

/* API Akinator: SATU pintu POST dengan "aksi".
   - mulai    (game baru)
   - jawab    {gameId, jawaban: 0..4}
   - tolak    {gameId}  (tebakan salah, lanjut ditanya)
   - terima   {gameId}  (tebakan bener = menang)
   - undo     {gameId}  (batalin jawaban terakhir)
   - menyerah {gameId}  (berhenti, akinator ngasih daftar soundlike)
   - pilih    {gameId, pilihan: index}  (pilih dari daftar soundlike)
   - tutup    {gameId}  (buang sesi sekarang — r26, idempotent)

   Balaman bentukny disatukan biar gampang digambar di client:
   { ok, gameId, status, pertanyaan?, tebakan?, opsi?, step?, persen?,
     labelProgres?, riwayat, ekspresi, catatan? }

   Ekspresi genie dikirim lengkap (akitude + label + path gambar lokal
   + URL jauh sebagai cadangan). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Hasil = Record<string, unknown> & { ok: true; gameId: string; status: string };

function ekspresi(state: Record<string, any>) {
  const e = mesin.currentExpression(state);
  if (!e) return null;
  return {
    akitude: e.akitude,
    label: e.akitudeLabel,
    mood: e.mood,
    moodLabel: e.moodLabel,
    gambar: `/aset/akinator/${e.akitude}.png`,
    gambarJauh: e.imageUrl,
  };
}

function dasar(state: Record<string, any>): Hasil {
  const prog = mesin.getProgress(state);
  return {
    ok: true,
    gameId: state.gameId,
    status: state.status,
    step: Number(state.step) || 0,
    persen: prog.percent,
    labelProgres: prog.label,
    riwayat: (state.history?.length ?? 0),
    bisaUndo: state.status === "question" && (state.history?.length ?? 0) > 0,
    ekspresi: ekspresi(state),
  };
}

function bentukTebakan(g: Record<string, any> | null | undefined) {
  if (!g) return null;
  return {
    nama: g.name ?? "",
    deskripsi: g.desc ?? "",
    foto: g.hasPhoto ? g.photo : null,
    adaFoto: !!g.hasPhoto,
  };
}

/* Rate limit start ringan: game baru makan resource (warm-up + POST
   /game ke akinator.com), jangan bisa dispam per-IP. */
const mulaiTerakhir = new Map<string, number>();
const JEDA_MULAI_MS = 6000;

function ip(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "lokal";
}

/* Rekam game yang selesai ke leaderboard (r26). Best effort: kalau DB
   lagi error, game tetep kebalas normal — papan skor gak boleh bikin
   geni ny kena hambat. Identitas pemain disnapshot dari sesi login
   (kalau gak login = "Tamu"). */
async function catatMain(state: Record<string, any>, hasil: "kena" | "pilih", charNama: string) {
  try {
    const p = await bacaSesi();
    await db.akinatorMain.create({
      data: {
        userId: p?.id ?? null,
        pemainNama: p?.nama ?? "Tamu",
        charNama: charNama?.slice(0, 120) || null,
        hasil,
        jumlahJawab: state.history?.length ?? 0,
      },
    });
  } catch {
    /* papan skor gak krusial buat jalanny game */
  }
}

export async function POST(req: NextRequest) {
  let badan: { aksi?: unknown; gameId?: unknown; jawaban?: unknown; pilihan?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ ok: false, kode: "BAD_JSON", galat: "Isi permintaan gak kebaca." }, { status: 400 });
  }

  const aksi = String(badan.aksi ?? "");

  try {
    if (aksi === "mulai") {
      const kunci = ip(req);
      const kini = Date.now();
      const terakhir = mulaiTerakhir.get(kunci) ?? 0;
      if (kini - terakhir < JEDA_MULAI_MS) {
        return NextResponse.json(
          { ok: false, kode: "CEPAT", galat: "Sabar bentar, game baru ny lagi disiapin.", cobaLagiMs: JEDA_MULAI_MS - (kini - terakhir) },
          { status: 429 }
        );
      }
      mulaiTerakhir.set(kunci, kini);

      const state = await mulaiGame();
      const hasil = dasar(state);
      hasil.pertanyaan = state.question;
      return NextResponse.json(hasil);
    }

    const gameId = typeof badan.gameId === "string" ? badan.gameId : "";

    /* Tutup sesi manual (r26): dipanggil tombol "mulai dari awal" di
       web. Idempotent — sesi udah kebersihin / gak pernah ada tetep
       balik ok, jadi client gak perlu tau umur sesi ny. Gak kena rate
       limit: ini justru ngurangin beban server. */
    if (aksi === "tutup") {
      await tutupGame(gameId).catch(() => false);
      return NextResponse.json({ ok: true, gameId, status: "tutup" });
    }

    const state = ambilGame(gameId);
    if (!state) {
      return NextResponse.json(
        { ok: false, kode: "SESI_HILANG", galat: "Sesi game ny udah gak ada (kelamaan nganggur atau udah selesai). Mulai game baru." },
        { status: 404 }
      );
    }

    if (aksi === "jawab") {
      const jawaban = Number(badan.jawaban);
      if (!Number.isInteger(jawaban) || jawaban < 0 || jawaban > 4) {
        return NextResponse.json({ ok: false, kode: "JAWABAN_SALAH", galat: "Jawaban harus 0..4." }, { status: 400 });
      }
      const r = await mesin.answerQuestion(state, jawaban);
      const hasil = dasar(state);
      if (r.type === "question") {
        hasil.pertanyaan = state.question;
        if (r.healed) hasil.catatan = "Jawaban dobel ke-rapiin otomatis.";
        if (r.resumed) hasil.catatan = "Sesi nyambung ulang, " + r.replayed + " jawaban lo gak ilang.";
      } else if (r.type === "propose") {
        hasil.tebakan = bentukTebakan(state.guess);
      } else if (r.type === "soundlike") {
        hasil.opsi = state.soundlikeOptions.map((o: Record<string, any>) => ({ nama: o.name, deskripsi: o.desc }));
      }
      return NextResponse.json(hasil);
    }

    if (aksi === "tolak") {
      const r = await mesin.refuseGuess(state);
      const hasil = dasar(state);
      hasil.pertanyaan = state.question;
      if (r.resumed) hasil.catatan = "Sesi nyambung ulang.";
      return NextResponse.json(hasil);
    }

    if (aksi === "terima") {
      const r = await mesin.acceptGuess(state);
      tandaiSelesai(state);
      await catatMain(state, "kena", state.guess?.name ?? "");
      const hasil = dasar(state);
      hasil.status = "won";
      hasil.tebakan = bentukTebakan(state.guess);
      hasil.timesPlayed = r.timesPlayed ?? null;
      return NextResponse.json(hasil);
    }

    if (aksi === "undo") {
      await mesin.undoAnswer(state);
      const hasil = dasar(state);
      hasil.pertanyaan = state.question;
      return NextResponse.json(hasil);
    }

    if (aksi === "menyerah") {
      const r = await mesin.giveUp(state);
      tandaiSelesai(state);
      const hasil = dasar(state);
      hasil.status = "soundlike";
      hasil.opsi = state.soundlikeOptions.map((o: Record<string, any>) => ({ nama: o.name, deskripsi: o.desc }));
      return NextResponse.json(hasil);
    }

    if (aksi === "pilih") {
      const pilihan = Number(badan.pilihan);
      if (!Number.isInteger(pilihan)) {
        return NextResponse.json({ ok: false, kode: "PILIHAN_SALAH", galat: "Pilihan harus nomor urut opsi." }, { status: 400 });
      }
      const r = await mesin.pickSoundlike(state, pilihan);
      tandaiSelesai(state);
      await catatMain(state, "pilih", r.pick?.name ?? "");
      const hasil = dasar(state);
      hasil.status = "picked";
      hasil.pilihan = { nama: r.pick.name, deskripsi: r.pick.desc };
      return NextResponse.json(hasil);
    }

    return NextResponse.json({ ok: false, kode: "AKSI_SALAH", galat: "Aksi gak dikenal." }, { status: 400 });
  } catch (e: unknown) {
    const kode = (e as { code?: string })?.code ?? "ERROR";
    const galat = e instanceof Error ? e.message : "Kesalahan gak terduga.";
    const detail = (e as { detail?: unknown })?.detail;

    if (kode === "WRONG_STATE" || kode === "BAD_ANSWER" || kode === "BAD_PICK" || kode === "CHILD_FILTER") {
      return NextResponse.json({ ok: false, kode, galat }, { status: 400 });
    }
    if (kode === "CHALLENGE") {
      const retryAfterMs = (detail as { retryAfterMs?: number } | null)?.retryAfterMs ?? 60_000;
      return NextResponse.json(
        { ok: false, kode, galat, cobaLagiMs: retryAfterMs },
        { status: 503, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }
    /* r25: semua transport mati / budget waktu habis / lapisaan browser
       gak ada. Pesen ny udah diracik jelas di ruangan (solusi + penyebab),
       balikin 503 biar client gak salah ngira "server app ny mati". */
    if (kode === "SEMUA_TRANSPORT_GAGAL" || kode === "MULAI_LAMA" || kode === "PW_UNAVAILABLE") {
      const cobaLagiMs = (detail as { retryAfterMs?: number } | null)?.retryAfterMs ?? 30_000;
      return NextResponse.json(
        { ok: false, kode, galat, cobaLagiMs },
        { status: 503, headers: { "Retry-After": String(Math.ceil(cobaLagiMs / 1000)) } }
      );
    }
    if (kode === "KO" || kode === "RESUME_FAIL" || kode === "SERVER_ERROR" || kode === "SESSION_EXPIRED") {
      return NextResponse.json(
        { ok: false, kode, galat, matiSesi: true },
        { status: 410 }
      );
    }
    return NextResponse.json({ ok: false, kode, galat }, { status: 502 });
  }
}
