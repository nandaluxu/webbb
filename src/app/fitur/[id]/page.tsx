import type { Metadata } from "next";
import FiturSatu from "@/views/FiturSatu";
import { cariFitur } from "@/lib/katalog";

/* /fitur/<id>: halaman satu fitur. Id dari URL (bukan hash), jadi
   refresh + direct link jalan normal. Judul tab dari generateMetadata,
   body ny dirender FiturSatu (client) biar entry KATALOG gak perlu
   nyebrang batas server-client. */

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const entry = cariFitur(id);
  return { title: entry ? entry.judul + " · Neyhra Playground" : "Neyhra Playground" };
}

export default async function HalamanFiturSatu({ params }: Params) {
  const { id } = await params;
  return <FiturSatu id={id} />;
}
