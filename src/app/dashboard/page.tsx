import type { Metadata } from "next";
import PapanSkor from "@/views/PapanSkor";

/* /dashboard: halaman leaderboard publik (r26). Body ny client
   component (PapanSkor) karena datany diambil dari /api/leaderboard
   pas buka — isinya agregasi game Akinator yang selesai. */

export const metadata: Metadata = {
  title: "Leaderboard · Neyhra Playground",
};

export default function HalamanDashboard() {
  return <PapanSkor />;
}
