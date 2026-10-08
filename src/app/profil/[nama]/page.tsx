import type { Metadata } from "next";
import ProfilOrang from "@/views/ProfilOrang";

type Params = { params: Promise<{ nama: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { nama } = await params;
  return { title: "Profil " + decodeURIComponent(nama) + " · Neyhra Playground" };
}

export default async function HalamanProfilOrang({ params }: Params) {
  const { nama } = await params;
  return <ProfilOrang nama={decodeURIComponent(nama)} />;
}
