import type { Metadata } from "next";
import Profil from "@/views/Profil";

export const metadata: Metadata = {
  title: "Profil · Neyhra Playground",
};

export default function HalamanProfil() {
  return <Profil />;
}
