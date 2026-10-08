/* Pastiin akun OWNER (Neyhra) ada — jalan otomatis tiap mulai.sh.
   Kenapa: db bisa kehapus/keganti (pindah versi, install ulang), dan
   owner yang ilang = Dashboard Admin kekunci tanpa jalan balik.
   Script ini idempoten: jalan berulang kali aman, cuma bikin kalo
   belum ada — sandi yang udah diganti manual GAK disentuh.

   Cara pakai:
     node scripts/bikin-admin.mjs            -> biasa (dipanggil mulai.sh)
     node scripts/bikin-admin.mjs --reset    -> paksa sandi balik ke default
                                                (kelupaan sandi owner)
     node scripts/bikin-admin.mjs --ambil    -> username "neyhra" udah
                                                keduluan akun laen? akun
                                                itu dijadiin owner (nama
                                                diganti "Neyhra" + sandi
                                                default) — buat kasus
                                                keburu daftar salah nama.

   Identitas owner di app ini = NAMA "Neyhra" (huruf N gede, lihat
   apaOwner di src/lib/autentikasi.ts). Username cuma identitas login.
   Hash sandi + salinan terenkripsi ny sama persis kayak route daftar
   (scrypt + aes-256-gcm, kunci di data/kunci.txt), jadi akun hasil
   seed gak beda sama akun daftar manual. */

import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync, createCipheriv } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const NAMA = "Neyhra"; // display name owner (case-sensitive!)
const USERNAME = "neyhra"; // identifier login
const SANDI = process.env.SANDI_OWNER || "nanda";

/* --- Sama kayak hashSandi di src/lib/autentikasi.ts --- */
function hashSandi(sandi) {
  const garam = randomBytes(16).toString("hex");
  const hash = scryptSync(sandi, garam, 64).toString("hex");
  return garam + ":" + hash;
}

/* --- Sama kayak bacaKunci di src/lib/kunci.ts (data/kunci.txt) --- */
async function bacaKunci() {
  const jalur = path.join(process.cwd(), "data", "kunci.txt");
  let simpanan = null;
  try {
    simpanan = Buffer.from((await readFile(jalur, "utf8")).trim(), "hex");
    if (simpanan.length === 32) return simpanan;
  } catch {}
  simpanan = randomBytes(32);
  await mkdir(path.dirname(jalur), { recursive: true });
  await writeFile(jalur, simpanan.toString("hex"), { mode: 0o600 });
  return simpanan;
}

/* --- Sama kayak enkSandiAsli di src/lib/autentikasi.ts --- */
async function enkSandiAsli(sandi) {
  const kunci = await bacaKunci();
  const iv = randomBytes(12);
  const a = createCipheriv("aes-256-gcm", kunci, iv);
  const isi = Buffer.concat([a.update(sandi, "utf8"), a.final()]);
  return iv.toString("hex") + ":" + a.getAuthTag().toString("hex") + ":" + isi.toString("hex");
}

/* Fallback .env: prisma biasanya baca .env sendiri, tapi gak ada
   salahnya mastiin (jalan di luar mulai.sh pun tetep nyambung). */
if (!process.env.DATABASE_URL) {
  try {
    const isi = await readFile(".env", "utf8");
    const m = isi.match(/^DATABASE_URL=(.*)$/m);
    if (m) process.env.DATABASE_URL = m[1].trim();
  } catch {}
}

const db = new PrismaClient();
try {
  const reset = process.argv.includes("--reset");
  const ambil = process.argv.includes("--ambil");

  // Owner = akun yang namanya "Neyhra" (nama unik di schema).
  const neyhra = await db.pengguna.findUnique({ where: { nama: NAMA } });

  if (neyhra) {
    /* ---- Akun owner udah ada ---- */
    const data = {};
    if (!neyhra.sandi || reset) {
      // anonim nyasar / reset sandi -> isi ulang sandi + salinan ny
      data.sandi = hashSandi(SANDI);
      data.sandiAsli = await enkSandiAsli(SANDI);
    }
    if (neyhra.jenis !== "akun") data.jenis = "akun";
    if (!neyhra.admin || !neyhra.verified || !neyhra.username) {
      // flag owner nempel otomatis (kayak bacaSesi), dijamin sekali lagi
      data.admin = true;
      data.verified = true;
      if (!neyhra.username) data.username = USERNAME;
    }
    if (Object.keys(data).length) {
      const u = await db.pengguna.update({ where: { id: neyhra.id }, data });
      console.log(">> akun owner di-update: @" + u.username + (reset ? " (sandi direset)" : ""));
    } else {
      console.log(">> akun owner udah ada: @" + neyhra.username + " — gak ada yang diubah");
    }
  } else {
    /* ---- Belum ada akun bernama "Neyhra" ---- */
    const pegang = await db.pengguna.findUnique({ where: { username: USERNAME } });
    if (pegang) {
      // username keduluan akun laen. Tanpa --ambil: JANGAN otomatis
      // promote (bisa jadi orang laen di deploy publik) — bilang aja.
      if (ambil) {
        const u = await db.pengguna.update({
          where: { id: pegang.id },
          data: {
            nama: NAMA,
            sandi: hashSandi(SANDI),
            sandiAsli: await enkSandiAsli(SANDI),
            jenis: "akun",
            admin: true,
            verified: true,
          },
        });
        console.log(">> akun @" + u.username + " dijadiin owner (nama: " + u.nama + ", sandi direset)");
      } else {
        console.log("!! username @" + USERNAME + " udah dipake akun laen (" + pegang.nama + ").");
        console.log("   Kalau itu punya lo sendiri: jalanin lagi pake --ambil");
        console.log("   (node scripts/bikin-admin.mjs --ambil). Kalau bukan, gak ada yang diubah.");
        process.exit(1);
      }
    } else {
      /* Db baru / owner belum pernah daftar: bikin akun owner segar
         — persis kayak daftar manual (username + nama + sandi) tapi
         langsung admin + terverifikasi. */
      const u = await db.pengguna.create({
        data: {
          nama: NAMA,
          username: USERNAME,
          sandi: hashSandi(SANDI),
          sandiAsli: await enkSandiAsli(SANDI),
          jenis: "akun",
          admin: true,
          verified: true,
        },
      });
      console.log(">> akun owner dibikin: @" + u.username + " (nama \"" + u.nama + "\", sandi: " + SANDI + ")");
    }
  }
} finally {
  await db.$disconnect();
}
