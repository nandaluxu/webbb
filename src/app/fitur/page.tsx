import type { Metadata } from "next";
import FiturMenu from "@/views/FiturMenu";

export const metadata: Metadata = {
  title: "Fitur · Neyhra Playground",
};

export default function HalamanFitur() {
  return <FiturMenu />;
}
