import { NextResponse } from "next/server";

/* /api/proksi — jembatan media server-side
   ------------------------------------------------------------
   Kenapa perlu: CDN-CDN unduhan (tikcdn.io, tiktokcdn.com, dll)
   balikin header CORS yang fixed ke domain asalny (misal
   access-control-allow-origin: https://ssstik.io), jadi fetch()
   dari browser selalu keblokir padahal file ny beneran ada. Akibat
   ny tombol simpen nyerah ke window.open = tab baru (popup).
   Dengan proxy: browser tinggal minta ke route ini (same-origin,
   gak ada CORS), server ny yang ambil ke CDN (server gak kenal
   CORS), terus stream byteny langsung ke browser.

   Bonus: tikcdn.io ngasih content-type application/octet-stream
   walau isiny video mp4, itu yang bikin <video> gak mau mainin
   pratinjau TikTok. Lewat sini tipeny bisa di-override biar
   elemen video nge-buffer beneran.

   Query:
   - url   : target lengkap (http/https) — WAJIB
   - tipe  : override content-type: video (video/mp4) atau
             audio (audio/mpeg). Tanpa ny: ikut upstream.

   Range dari browser diterusin (video bisa seek), status 206 +
   content-range juga diterusin apa adany. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TIPE: Record<string, string> = {
  video: "video/mp4",
  audio: "audio/mpeg",
};

/* Guard SSRF dasar: jangan jadi pintu ke jaringan internal.
   Cukup buat playground ini — domain publik doang yang lolos. */
function hostBoleh(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "metadata.google.internal"
  ) {
    return false;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = (url.searchParams.get("url") || "").trim();
  const tipe = url.searchParams.get("tipe") || "";

  let tujuan: URL;
  try {
    tujuan = new URL(target);
  } catch {
    return NextResponse.json({ status: false, message: "URL target gak valid." }, { status: 400 });
  }
  if (!/^https?:$/.test(tujuan.protocol) || !hostBoleh(tujuan.hostname)) {
    return NextResponse.json({ status: false, message: "Cuma media http(s) publik yang bisa diproksi." }, { status: 403 });
  }

  /* Header minimal: beberapa CDN ngecek UA. Origin sengaja gak
     dikirim (tikcdn nolak request yang bawa Origin asing). */
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "*/*",
  };
  const range = req.headers.get("range");
  if (range) headers.Range = range;

  let upstream: Response;
  try {
    upstream = await fetch(tujuan, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(300000),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { status: false, message: "Server ny gak bisa nyampe file ny (CDN ny mati atau keblokir). Coba lagi." },
      { status: 502 }
    );
  }

  /* 204 = tikcdn bilang "error 093" (token/matot) — anggep gagal,
     jangan streamin body kosong ke video element. */
  if (!upstream.ok || upstream.status === 204) {
    return NextResponse.json(
      { status: false, message: "File ny gak keambil dari server sumber (HTTP " + upstream.status + ")." },
      { status: 502 }
    );
  }

  const h = new Headers();
  h.set("Content-Type", TIPE[tipe] || upstream.headers.get("content-type") || "application/octet-stream");

  /* Content-length cuma diterusin kalau body gak dikompres —
     fetch() auto-dekompres tapi panjangny jadi gak cocok. Kalau
     ragu, biarin chunked aja (video tetep jalan). */
  const dipadatkan = upstream.headers.get("content-encoding");
  if (!dipadatkan) {
    const len = upstream.headers.get("content-length");
    if (len) h.set("Content-Length", len);
    const cr = upstream.headers.get("content-range");
    if (cr) h.set("Content-Range", cr);
    const ar = upstream.headers.get("accept-ranges");
    if (ar) h.set("Accept-Ranges", ar);
  }

  /* Isi ny sensitif token di query: jangan di-cache share.
     Browser boleh simpen bentar (bantu seek video) — private. */
  h.set("Cache-Control", "private, max-age=600");

  return new Response(upstream.body, { status: upstream.status, headers: h });
}
