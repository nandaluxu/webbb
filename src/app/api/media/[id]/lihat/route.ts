import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { bolehLihat } from "@/lib/media-server";

/* /api/media/[id]/lihat (r28): catat "post ini dilihat user ini".

   1 USER = 1 VIEW per post — dijamin DI DATABASE:
   - Model LihatMedia punya @@unique([mediaId, userId]).
   - Route ny nangkep bentrok (P2002) dari dua tab / dua request
     barengan -> dianggap udah kehitung, BUKAN error.
   - Anonymous: kebijakan existing — sesi anonim = user beneran
     (Pengguna row), jadi tetep 1 view per akun anonim. Yang beneran
     gak punya sesi (gak pernah login/anonim) gak direkam: gak ada
     identitas = gak dihitung (gak bisa diblow-up unlimited).
   - Akses tetap divalidasi (PRIVATE cuma pemilik — gak boleh nambah
     view sambil nyolong-lihat).

   Respons: { dilihat: N } (jumlah penonton unik sekarang). */

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesi = await bacaSesi();
  if (!sesi) {
    /* Logged out beneran: gak direkam. Balik jumlah doang biar client
       gak beda perilaku. */
    const dilihat = await db.lihatMedia.count({ where: { mediaId: id } }).catch(() => 0);
    return NextResponse.json({ dilihat: dilihat ?? 0, dicatat: false });
  }

  const media = await db.media.findUnique({ where: { id } });
  if (!media) return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 404 });
  if (!bolehLihat(media, sesi.id)) {
    return NextResponse.json({ galat: "Post ny gak ketemu." }, { status: 404 });
  }

  let dicatat = true;
  try {
    await db.lihatMedia.create({ data: { mediaId: id, userId: sesi.id } });
  } catch (e) {
    /* Bentrok unique constraint = user ny udah pernah lihat post ini
       (bisa dari tab laen / request kembar yang nyaris barengan).
       Idempoten: gak error, angka gak dobel. */
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      dicatat = false;
    } else {
      throw e;
    }
  }

  const dilihat = await db.lihatMedia.count({ where: { mediaId: id } });
  return NextResponse.json({ dilihat, dicatat });
}
