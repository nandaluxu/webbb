import type { Metadata } from "next";
import AdminDashboard from "@/views/AdminDashboard";

export const metadata: Metadata = {
  title: "Dashboard Admin - Neyhra Playground",
};

export default function HalamanAdmin() {
  return <AdminDashboard />;
}
