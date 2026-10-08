import { NextResponse } from "next/server";
import { bacaSesi, apaOwner } from "@/lib/autentikasi";
import { snapshotTelemetry } from "@/lib/akinator/telemetry.mjs";
import { statusTransport } from "@/lib/akinator/ruangan";
import { urutanStrategi } from "@/lib/akinator/strategi.mjs";

/* Telemetry internal Akinator (r24): mode transport yang kepake,
   latency, alasan gagal, urutan strategi aktif, ketersediaan
   fallback playwright. KHUSUS OWNER — detail teknis ini gak
   boleh kebaca user biasa. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sesi = await bacaSesi();
  if (!sesi || !apaOwner(sesi)) {
    return NextResponse.json({ galat: "Khusus owner." }, { status: 403 });
  }
  return NextResponse.json({
    telemetry: snapshotTelemetry(),
    strategi: urutanStrategi().map((s) => (s.mode === "proxy" ? { mode: s.mode, proxy: s.proxy } : { mode: s.mode })),
    transport: await statusTransport(),
  });
}
