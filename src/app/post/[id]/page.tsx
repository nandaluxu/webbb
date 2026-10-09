import type { Metadata } from "next";
import { db } from "@/lib/db";
import HalamanPost from "./HalamanPost";

/* /post/<id>: halaman detail post (canonical URL buat Salin link).
   Metadata ny nyari judul/nama post dari DB (server-side) biar judul
   tab bener; halaman ny sendiri ngambil data lewat /api/media/[id]
   di client biar visibilitas (PRIVATE) tetep dicek dari sesi. */

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const m = await db.media.findUnique({ where: { id }, select: { judul: true, nama: true } }).catch(() => null);
  return {
    title: ((m?.judul || m?.nama || "Post") + " · Neyhra Playground").slice(0, 70),
    robots: { index: false },
  };
}

export default async function HalamanPostRoute({ params }: Params) {
  const { id } = await params;
  return <HalamanPost id={id} />;
}
