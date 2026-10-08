import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bacaSesi } from "@/lib/autentikasi";
import { catatNotifikasi, hapusNotifikasiIkut } from "@/lib/notifikasi";

/* /api/ikuti (r27 / P2-7): follow / unfollow.
   POST { targetId, aksi: "ikut" | "lepas" }
   - Wajib login (sesi server-side).
   - Target harus ada.
   - Follow diri sendiri DITOLAK di sini (bukan cuma di UI).
   - "ikut" dobel = idempoten (gak error, gak nambah row kembar —
     unique constraint juga ngejaga); "lepas" kalau gak ada relasi =
     tetep ok. Jadi optimistic UI di client gak perlu takut race.
   r28: ikut -> notifikasi ke target; lepas -> notifikasi follow ny
   kehapus (keadaan jujur). */

export async function POST(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu buat ikutin orang." }, { status: 401 });

  let badan: { targetId?: unknown; aksi?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  const targetId = String(badan.targetId ?? "");
  const aksi = badan.aksi === "lepas" ? "lepas" : badan.aksi === "ikut" ? "ikut" : null;
  if (!targetId || !aksi) {
    return NextResponse.json({ galat: "Target atau aksi ny kurang." }, { status: 400 });
  }

  const target = await db.pengguna.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) return NextResponse.json({ galat: "User ny gak ketemu." }, { status: 404 });

  if (target.id === sesi.id) {
    return NextResponse.json({ galat: "Gak bisa ngikutin diri sendiri." }, { status: 400 });
  }

  if (aksi === "ikut") {
    await db.ikuti.upsert({
      where: { pengikutId_diikutiId: { pengikutId: sesi.id, diikutiId: target.id } },
      create: { pengikutId: sesi.id, diikutiId: target.id },
      update: {},
    });
    void catatNotifikasi(target.id, sesi.id, "FOLLOW");
  } else {
    await db.ikuti.deleteMany({ where: { pengikutId: sesi.id, diikutiId: target.id } });
    void hapusNotifikasiIkut(sesi.id, target.id);
  }

  const [pengikut, mengikuti] = await Promise.all([
    db.ikuti.count({ where: { diikutiId: target.id } }),
    db.ikuti.count({ where: { pengikutId: sesi.id } }),
  ]);
  return NextResponse.json({ ok: true, ikut: aksi === "ikut", jumlahPengikut: pengikut, jumlahMengikutiKu: mengikuti });
}
