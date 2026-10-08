import type { Metadata } from "next";
import Galeri from "@/views/Galeri";

export const metadata: Metadata = {
  title: "Photo Archive · Neyhra Playground",
};

export default function HalamanGaleri() {
  return <Galeri />;
}
