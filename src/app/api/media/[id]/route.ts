import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { scanGaleri, susunPublik, bolehLihat } from "@/lib/media-server";

/* /api/media/[id] GET (r28): SATU post (buat halaman detail /post/[id]
   + canonical link). Akses mengikuti visibilitas: PRIVATE cuma
   pemilik (404 buat orang laen — gak bocor keberadaan ny). */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesi = await bacaSesi();
  await scanGaleri().catch(() => {});
  const media = await db.media.findUnique({ where: { id } });
  if (!media) return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 404 });
  if (!bolehLihat(media, sesi?.id ?? null)) {
    return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 404 });
  }
  return NextResponse.json({ media: await susunPublik(media, sesi?.id ?? null) });
}
