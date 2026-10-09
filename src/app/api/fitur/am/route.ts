import { NextRequest, NextResponse } from "next/server";
import { auth, catatSesi, emailValid, link, pro, sesiCocok } from "@/lib/am-premium";

export const runtime = "nodejs";

/* AM Premium Generator: dua aksi.
   - kirim     : { email } -> magic link dikirim ke email ny + sesi
                 email ny dicatet (30 menit).
   - aktivasi  : { email, url } -> email HARUS sama dengan yang dipake
                 pas request (dicek server-side juga, bukan cuma UI),
                 link ny dituker jadi token, terus pembelian premium
                 diverifikasi. Kode order (NeyhraPlayground-XXXX)
                 dibalikin buat popup sukses. */

export async function POST(req: NextRequest) {
  let badan: { aksi?: unknown; email?: unknown; url?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ ok: false, pesan: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  const aksi = String(badan.aksi ?? "");
  const email = String(badan.email ?? "").trim().slice(0, 254);

  if (!emailValid(email)) {
    return NextResponse.json({ ok: false, pesan: "Email ny belum bener. Tulis alamat email lengkap, misal: nama@contoh.com" }, { status: 400 });
  }

  if (aksi === "kirim") {
    const hasil = await link(email);
    if (!hasil.ok) {
      return NextResponse.json(
        { ok: false, pesan: "Magic link gagal dikirim. Server ny lagi sibuk atau email ny nolak, tunggu bentar, coba lagi." },
        { status: 502 }
      );
    }
    catatSesi(email);
    return NextResponse.json({ ok: true, email });
  }

  if (aksi === "aktivasi") {
    const url = String(badan.url ?? "").trim();
    if (!url) {
      return NextResponse.json({ ok: false, pesan: "Link dari email ny belum ditempel di kotak aktivasi." }, { status: 400 });
    }
    if (!sesiCocok(email)) {
      return NextResponse.json(
        { ok: false, pesan: "Email ny beda dari yang dipake pas minta magic link (atau sesi ny udah lewat 30 menit). Balikin email ny, atau kirim ulang magic link." },
        { status: 400 }
      );
    }
    const masuk = await auth(email, url);
    if (!masuk.ok) {
      return NextResponse.json({ ok: false, pesan: masuk.why }, { status: 400 });
    }
    const premium = await pro(masuk.id);
    if (!premium.ok) {
      return NextResponse.json({ ok: false, pesan: "Login ny berhasil tapi verifikasi premium ny gagal. Coba lagi bentar." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, email: masuk.email, kode: premium.order, baru: masuk.baru });
  }

  return NextResponse.json({ ok: false, pesan: "Aksi ny gak dikenal." }, { status: 400 });
}
