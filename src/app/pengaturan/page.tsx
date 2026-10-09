import type { Metadata } from "next";
import Pengaturan from "@/views/Pengaturan";

export const metadata: Metadata = {
  title: "Pengaturan - Neyhra Playground",
};

export default function HalamanPengaturan() {
  return <Pengaturan />;
}
