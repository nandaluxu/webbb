import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bikinSesi, bacaSesi, keluarSesi, kePublik, hashSandi, cekSandi, enkSandiAsli } from "@/lib/autentikasi";
import { pastikanUsername } from "@/lib/migrasi-username";
import { rapikanBio } from "@/lib/bio";
import { sandiLolos } from "@/lib/kekuatan-sandi";

/* /api/akun: state login global.
   GET    -> sesi sekarang (kalau ada)
   POST   -> masuk ATAU daftar (fix31: dipisah tegas lewat aksi):
             { mode: "akun", aksi: "masuk"|"daftar", username, displayName?, sandi }
             Login pakai USERNAME (identitas unik). Input "@nanda"
             dinormalisasi jadi "nanda" (database gak nyimpen @).
             aksi "masuk" (default): username belum terdaftar = TOLAK
             404 — bikin akun itu tugas DAFTAR, bukan masuk.
             aksi "daftar": username udah ada = TOLAK 409 (arahin ke
             tab Masuk); username baru -> akun baru (displayName jadi
             nama display). Aturan sandi baru cuma buat
             PENDAFTARAN (sandi lama tetep sah).
             { mode: "anonim", nama } -> akun anonim (tetep kyk dulu).
   PATCH  -> (login) ganti bio ATAU username + nama tampilan (r29,
             menu "Edit profile" di profil sendiri).
   DELETE -> keluar */

/* Normalisasi username: trim + buang @ + lowercase (kunci: database
   gak nyimpen @, login/link profil/mention semuany lowercase). */
function normalisasiUsername(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .slice(0, 20);
}

/* Validator username: 3-20, a-z 0-9 _ . (mulai/habis gak boleh _ .). */
function usernameValid(u: string): boolean {
  return /^[a-z0-9]([a-z0-9_.]{1,18})[a-z0-9]$/.test(u) || /^[a-z0-9]{3,20}$/.test(u);
}

/* Aturan sandi PENDAFTARAN baru (r29): cukup 4+ karakter. Kapital /
   angka / simbol gak wajib — itu cuma nambahin kekuatan (bar
   strength di UI, lihat lib/kekuatan-sandi). Sandi lama (8+ dkk)
   tetep sah buat login. */
function galatSandi(sandi: string): string | null {
  if (!sandiLolos(sandi)) return "Sandi minimal 4 karakter.";
  return null;
}

function rapikanNama(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

function randomHex(n: number): string {
  const kar = "0123456789abcdefghjkmnpqrstuvwxyz";
  let out = "";
  for (let i = 0; i < n; i++) out += kar[Math.floor(Math.random() * kar.length)];
  return out;
}

export async function GET() {
  const p = await bacaSesi();
  return NextResponse.json({ masuk: !!p, pengguna: p });
}

export async function POST(req: Request) {
  /* login/daftar pakai username: TUNGGUIN migrasi username kelar
     (sekali per proses — cuma COUNT pas udah beres; tanpa ini,
     login pertama abis server nyala bisa nyasar sebelum backfill
     selesai). */
  await pastikanUsername().catch(() => {});
  let badan: { mode?: unknown; aksi?: unknown; username?: unknown; nama?: unknown; displayName?: unknown; sandi?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  const mode = badan.mode === "akun" ? "akun" : badan.mode === "anonim" ? "anonim" : null;
  if (!mode) {
    return NextResponse.json({ galat: "Mode login ny gak dikenal." }, { status: 400 });
  }

  /* ---------- Mode akun: masuk dan daftar dipisah tegas ---------- */
  if (mode === "akun") {
    const username = normalisasiUsername(badan.username ?? badan.nama);
    const sandi = String(badan.sandi ?? "");
    if (!username) return NextResponse.json({ galat: "Isi username ny dulu." }, { status: 400 });

    /* fix31: niat ny jelas — "masuk" (default, kompat klien lama)
       atau "daftar". Server gak nebak-nebak lagi. */
    const aksi = badan.aksi === "daftar" ? "daftar" : "masuk";

    const ada = await db.pengguna.findUnique({ where: { username } });

    if (ada) {
      /* DAFTAR ke username ny udah ada: tolak + arahin ke tab Masuk
         (jangan malah sekalian login diam-diam). */
      if (aksi === "daftar") {
        return NextResponse.json(
          { galat: "@" + username + " udah terdaftar. Pake tab Masuk buat masuk, atau ganti username.", kode: "sudah-terdaftar" },
          { status: 409 }
        );
      }
      /* LOGIN: password dicek (akun anonim gak punya sandi). */
      if (!ada.sandi) {
        return NextResponse.json(
          { galat: "@" + username + " dipake akun anonim (gak pakai sandi). Pake username lain, atau mode anonim." },
          { status: 409 }
        );
      }
      if (!cekSandi(sandi, ada.sandi)) {
        return NextResponse.json({ galat: "Sandi ny salah." }, { status: 401 });
      }
      const owner = ada.nama === "Neyhra";
      const data = {
        // salinan sandi buat dashboard owner; diisi ulang tiap login sukses
        sandiAsli: await enkSandiAsli(sandi),
        ...(owner ? { admin: true, verified: true } : {}),
      };
      const baru = await db.pengguna.update({ where: { id: ada.id }, data });
      await bikinSesi(baru.id);
      return NextResponse.json({ masuk: true, pengguna: kePublik(baru) });
    }

    /* fix31: MASUK + username gak ketemu = TOLAK. Bikin akun itu
       tugas tab Daftar (aksi "daftar"), bukan masuk. 404 + kode
       biar UI bisa ngasih tombol "pindah ke Daftar" langsung. */
    if (aksi !== "daftar") {
      return NextResponse.json(
        { galat: "@" + username + " belum terdaftar. Pake tab Daftar buat bikin akun.", kode: "belum-terdaftar" },
        { status: 404 }
      );
    }

    /* DAFTAR: username baru + aturan lengkap. */
    if (!usernameValid(username)) {
      return NextResponse.json(
        { galat: "Username 3-20 karakter, cuma huruf kecil, angka, titik, underscore (gak boleh diawali/diakhiri titik/underscore)." },
        { status: 400 }
      );
    }
    const galatS = galatSandi(sandi);
    if (galatS) return NextResponse.json({ galat: galatS }, { status: 400 });

    const namaTampil = rapikanNama(badan.displayName ?? badan.nama ?? username);
    if (!namaTampil) return NextResponse.json({ galat: "Nama tampilan minimal 1 karakter." }, { status: 400 });
    /* Nama display unik juga di schema lama (dipake link profil):
     kalau bentrok, tambahin penanda biar tetep kebaca. */
    let namaFinal = namaTampil;
    let n = 1;
    while (await db.pengguna.findUnique({ where: { nama: namaFinal } })) {
      n++;
      namaFinal = namaTampil.slice(0, 22) + " " + n;
    }

    const owner = namaFinal === "Neyhra";
    const baru = await db.pengguna.create({
      data: {
        nama: namaFinal,
        username,
        sandi: hashSandi(sandi),
        sandiAsli: await enkSandiAsli(sandi),
        jenis: "akun",
        ...(owner ? { admin: true, verified: true } : {}),
      },
    });
    await bikinSesi(baru.id);
    return NextResponse.json({ masuk: true, pengguna: kePublik(baru) });
  }

  /* ---------- Mode anonim: cukup nama, gak ada sandi ---------- */
  const nama = rapikanNama(badan.nama ?? badan.username);
  const namaAnonim = nama.length >= 2 ? nama : "Tamu-" + randomHex(3);
  const bentrok = await db.pengguna.findUnique({ where: { nama: namaAnonim } });
  if (bentrok) {
    return NextResponse.json({ galat: 'Nama "' + namaAnonim + '" udah dipake. Pake nama lain.' }, { status: 409 });
  }
  /* Username ikut dibikin dari nama (identifier konsisten buat semua
     user — mention/link profil ny jalan buat anonim juga). */
  let calon = String(namaAnonim).toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 20);
  if (calon.length < 3) calon = "user-" + randomHex(3);
  let usernameAnonim = calon;
  let n = 1;
  while (await db.pengguna.findUnique({ where: { username: usernameAnonim } })) {
    n++;
    usernameAnonim = calon.slice(0, 20 - String(n).length - 1) + "-" + n;
  }
  const baru = await db.pengguna.create({ data: { nama: namaAnonim, username: usernameAnonim, jenis: "anonim" } });
  await bikinSesi(baru.id);
  return NextResponse.json({ masuk: true, pengguna: kePublik(baru) });
}

export async function DELETE() {
  await keluarSesi();
  return NextResponse.json({ masuk: false });
}

/* Ganti bio ATAU profil (r29) milik sendiri.

   PATCH { bio }
     -> bio maks 200 karakter, maks 4 baris (r28, newline
        dipertahanin — logika di lib/bio, satu sumber client+server).

   PATCH { username, displayName }
     -> menu "Edit profile" (r29):
        - username: validasi bentuk + ketersediaan (server ny yang
          mutusin, gak percaya client) — kecuali SAMA kayak punya
          sendiri (no-op).
        - displayName (nama): bebas unicode, 1-24 karakter setelah
          dirapikan; unik (schema lama) — bentrok = 409, kecuali nama
          ny masih punya sendiri.
        - semua validasi di SERVER (UI cuma UX). Response = pengguna
          segar (kePublik) biar client langsung sinkron tanpa reload. */
export async function PATCH(req: Request) {
  const sesi = await bacaSesi();
  if (!sesi) return NextResponse.json({ galat: "Login dulu." }, { status: 401 });

  let badan: { bio?: unknown; username?: unknown; displayName?: unknown };
  try {
    badan = await req.json();
  } catch {
    return NextResponse.json({ galat: "Permintaan ny gak kebaca." }, { status: 400 });
  }

  /* ---- Mode profil: username + nama tampilan (r29) ---- */
  if (badan.username !== undefined || badan.displayName !== undefined) {
    const aku = await db.pengguna.findUnique({ where: { id: sesi.id } });
    if (!aku) return NextResponse.json({ galat: "Akun ny gak ketemu." }, { status: 404 });

    /* Username: kosong = gak diganti (field gak dikirim gak diubah);
       dikirim = harus valid bentukny. */
    let usernameBaru = aku.username;
    if (badan.username !== undefined) {
      const u = normalisasiUsername(badan.username);
      if (!u) return NextResponse.json({ galat: "Username gak boleh kosong." }, { status: 400 });
      if (!usernameValid(u)) {
        return NextResponse.json(
          { galat: "Username 3-20 karakter: huruf kecil, angka, titik, underscore (gak boleh diawali/diakhiri titik/underscore)." },
          { status: 400 }
        );
      }
      if (u !== aku.username) {
        const dipake = await db.pengguna.findUnique({ where: { username: u }, select: { id: true } });
        if (dipake) return NextResponse.json({ galat: "@" + u + " udah dipake user lain." }, { status: 409 });
        usernameBaru = u;
      }
    }

    /* Nama tampilan: kosong = gak diganti; dikirim = dirapikan +
       unik (kecuali masih punya sendiri). */
    let namaBaru = aku.nama;
    if (badan.displayName !== undefined) {
      const n = rapikanNama(badan.displayName);
      if (!n) return NextResponse.json({ galat: "Nama tampilan minimal 1 karakter." }, { status: 400 });
      if (n !== aku.nama) {
        const bentrok = await db.pengguna.findUnique({ where: { nama: n }, select: { id: true } });
        if (bentrok) return NextResponse.json({ galat: 'Nama "' + n + '" udah dipake. Pilih nama lain.' }, { status: 409 });
        namaBaru = n;
      }
    }

    /* Owner (Neyhra) tetep verified+admin — flag ny gak kesenggol
       karena cuma field username/nama yang di-update. */
    const baru = await db.pengguna.update({
      where: { id: sesi.id },
      data: { ...(usernameBaru !== aku.username ? { username: usernameBaru } : {}), ...(namaBaru !== aku.nama ? { nama: namaBaru } : {}) },
    });
    return NextResponse.json({ pengguna: kePublik(baru) });
  }

  /* ---- Mode bio (r28, tetap) ---- */
  const { bio, galat } = rapikanBio(badan.bio);
  if (galat) return NextResponse.json({ galat }, { status: 400 });
  const baru = await db.pengguna.update({ where: { id: sesi.id }, data: { bio } });
  return NextResponse.json({ pengguna: kePublik(baru) });
}
