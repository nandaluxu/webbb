import type { Metadata } from "next";
import Beranda from "@/views/Beranda";

export const metadata: Metadata = {
  title: "Neyhra Playground",
};

export default function HalamanUtama() {
  return <Beranda />;
}
