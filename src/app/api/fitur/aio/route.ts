import { NextResponse } from "next/server";
import crypto from "crypto";
import { formatDurasiDetik, formatDurasiMs } from "@/lib/format";

/* /api/fitur/aio — AIO Downloader (jembatan ke j2download.com)
   ------------------------------------------------------------
   Kenapa lewat server: j2download ny butuh header browser (bot
   detection: halaman ny cuma ngasih window.__BOOTSTRAP__ ke request
   yang bawa client hints sec-ch-ua dll) + CORS ny gak kebuka buat
   /api/auth, jadi bootstrap + PoW + token HARUS dijalanin dari
   Node. Medias ny balik berupa URL stream SSE (progress render);
   stream + unduh file ny dilakuin langsung dari browser (CDN ny
   CORS terbuka, lihat selesaikanSse di MesinUnduh).
   Alur: [1] ambil bootstrap -> [2] selesaikan Proof-of-Work ->
   [3] tukar token -> [4] minta link (autolink). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/* Client hints ini yang bikin server ngasih __BOOTSTRAP__ — tanpa ny
   halaman ny kekirim versi "polos" tanpa challenge (40KB HTML tanpa
   script inline ny). */
const HEADERS_BROWSA: Record<string, string> = {
  "User-Agent": UA,
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "upgrade-insecure-requests": "1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const TIMEOUT = 20000;
const BATAS_POW_MS = 12000; /* difficulty biasany 3 (~4-9rb iterasi, <50ms). Kalau ny naik, jangan gantung request. */

function punyaNibbleNol(bytes: Buffer, difficulty: number): boolean {
  const bytePenuh = (difficulty / 2) | 0;
  const setengah = (difficulty & 1) === 1;
  for (let i = 0; i < bytePenuh; i++) if (bytes[i] !== 0) return false;
  if (setengah && (bytes[bytePenuh] & 0xf0) !== 0) return false;
  return true;
}

function selesaikanPow(challenge: string, nonce: string, difficulty: number, tipe: string): string | null {
  const prefix = tipe === "alt" ? `pow:${nonce}:` : `pow:${challenge}:`;
  const suffix = tipe === "alt" ? `:${challenge}` : `:${nonce}:${challenge.length}`;
  const mulai = Date.now();
  for (let n = 0; n < 10000000; n++) {
    const hash = crypto.createHash("sha256").update(`${prefix}${n}${suffix}`).digest();
    if (punyaNibbleNol(hash, difficulty)) return String(n);
    if ((n & 8191) === 0 && Date.now() - mulai > BATAS_POW_MS) return null;
  }
  return null;
}

async function ambilJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = (url.searchParams.get("url") || "").trim();

  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(target)) {
    return NextResponse.json(
      { status: false, message: "Linkny belum kayak link video. Tempel link lengkap, misal: https://youtube.com/watch?v=..." },
      { status: 400 }
    );
  }

  try {
    /* [1] bootstrap: challenge + nonce dari halaman utama. */
    const beranda = await fetch("https://j2download.com", {
      headers: { ...HEADERS_BROWSA, Referer: "https://j2download.com/", Origin: "https://j2download.com" },
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
    const kuki = (beranda.headers.get("set-cookie") || "").split(";")[0];
    const html = await beranda.text();
    const cocok = html.match(/window\.__BOOTSTRAP__\s*=\s*(\{.*?\});/);
    if (!cocok) {
      return NextResponse.json(
        { status: false, message: "Server j2download lagi gak ngasih challenge (mungkin lagi sibuk atau lagi ganti sistem). Coba lagi beberapa menit." },
        { status: 502 }
      );
    }
    const bootstrap = JSON.parse(cocok[1]);

    /* [2] Proof-of-Work. */
    const solusi = selesaikanPow(
      bootstrap.powChallenge,
      bootstrap.nonce,
      bootstrap.powDifficulty || 3,
      bootstrap.challengeType || "classic"
    );
    if (!solusi) {
      return NextResponse.json(
        { status: false, message: "Challenge ny keberat buat diselesaikan sekarang. Coba lagi bentar." },
        { status: 502 }
      );
    }

    /* [3] tukar solusi jadi access token. */
    const auth = await fetch("https://j2download.com/api/auth/issue", {
      method: "POST",
      headers: {
        ...HEADERS_BROWSA,
        Referer: "https://j2download.com/",
        Origin: "https://j2download.com",
        ...(kuki ? { Cookie: kuki } : {}),
        "X-Page-Nonce": bootstrap.nonce,
        "X-Pow-Solution": solusi,
        Accept: "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const dataAuth = await ambilJson(auth);
    const token = dataAuth?.accessToken;
    if (!token) {
      return NextResponse.json(
        { status: false, message: dataAuth?.message || "Token aksesny gak keluar dari server j2download. Coba lagi." },
        { status: 502 }
      );
    }

    /* [4] minta link media. */
    const autolink = await fetch("https://j2download.com/api/autolink", {
      method: "POST",
      headers: {
        ...HEADERS_BROWSA,
        Referer: "https://j2download.com/",
        Origin: "https://j2download.com",
        ...(kuki ? { Cookie: kuki } : {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify({ data: { url: target, unlock: true } }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const hasil = await ambilJson(autolink);

    if (!hasil || hasil.error) {
      return NextResponse.json(
        { status: false, message: hasil?.message || "Server j2download nolak linkny. Mungkin linkny salah, videony private, atau platformny belum didukung." },
        { status: 502 }
      );
    }
    if (!Array.isArray(hasil.medias) || !hasil.medias.length) {
      return NextResponse.json(
        { status: false, message: "Linkny kebaca, tapi gak ada satupun versi media yang bisa diambil. Coba link lain." },
        { status: 502 }
      );
    }

    /* Durasi dinormalisasi di sini (unit PER FIELD udah kekonfirmasi
       dari kontrak j2download, jangan nebak-nebak di client):
       - hasil.duration: STRING "3:33" (YouTube) atau ANGKA
         MILIDETIK (TikTok — 24564 = 24.40 detik, kebukti ffprobe).
       - hasil.lengthSeconds (fallback): ANGKA DETIK (nama = kontrak).
       Keluaranny selalu STRING siap tampil atau null. */
    const durasiTampil =
      typeof hasil.duration === "number"
        ? formatDurasiMs(hasil.duration)
        : typeof hasil.duration === "string" && hasil.duration.trim()
          ? hasil.duration.trim()
          : typeof hasil.lengthSeconds === "number"
            ? formatDurasiDetik(hasil.lengthSeconds)
            : null;

    return NextResponse.json({
      status: true,
      videoId: hasil.videoId,
      title: hasil.title,
      author: hasil.author,
      duration: durasiTampil,
      thumbnail: hasil.thumbnail,
      viewCount: hasil.viewCount,
      medias: hasil.medias,
    });
  } catch (err: any) {
    const pesan =
      err?.name === "TimeoutError"
        ? "Server j2download kelamaan ngerespon. Coba lagi sebentar lagi."
        : err?.message || "Ada yang salah pas ngambil data dari j2download.";
    return NextResponse.json({ status: false, message: pesan }, { status: 502 });
  }
}
