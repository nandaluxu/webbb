/* Autentikasi server: sandi scrypt + sesi token di database,
   cookie httpOnly di browser. Akun anonim = sandi null.
   Salinan sandi terenkripsi (buktiAdmin aja) disimpen biar owner
   bisa ngintip sandi user dari dashboard. Cek login tetap pake hash. */

import { cookies } from "next/headers";
import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from "crypto";
import { db } from "@/lib/db";
import { bacaKunci } from "@/lib/kunci";
import { pastikanUsername } from "@/lib/migrasi-username";

const NAMA_COOKIE = "neyhra-sesi";
const UMUR_SESI_HARI = 30;

export type PenggunaPublik = {
  id: string;
  nama: string;
  username: string | null;
  jenis: string;
  pfp: string | null;
  verified: boolean;
  admin: boolean;
  bio: string | null;
};

export function hashSandi(sandi: string): string {
  const garam = randomBytes(16).toString("hex");
  const hash = scryptSync(sandi, garam, 64).toString("hex");
  return garam + ":" + hash;
}

export function cekSandi(sandi: string, simpanan: string): boolean {
  const [garam, hash] = simpanan.split(":");
  if (!garam || !hash) return false;
  const coba = scryptSync(sandi, garam, 64);
  const asli = Buffer.from(hash, "hex");
  return coba.length === asli.length && timingSafeEqual(coba, asli);
}

type BarisAdmin = { id: string; nama: string; username: string | null; jenis: string; pfp: string | null; verified: boolean; admin: boolean; bio: string | null };

export function kePublik(p: BarisAdmin): PenggunaPublik {
  return { id: p.id, nama: p.nama, username: p.username, jenis: p.jenis, pfp: p.pfp, verified: p.verified, admin: p.admin, bio: p.bio };
}

/* Akun owner. Nama ny udah dipesan dari awal, makany status admin
   + badge terverifikasi ny nempel otomatis ke akun ini. */
export function apaOwner(p: { nama: string; admin?: boolean }): boolean {
  return p.admin === true || p.nama === "Neyhra";
}

/* SandiAsli = salinan terenkripsi (aes-256-gcm) buat dashboard admin. */
export async function enkSandiAsli(sandi: string): Promise<string> {
  const kunci = await bacaKunci();
  const iv = randomBytes(12);
  const a = createCipheriv("aes-256-gcm", kunci, iv);
  const isi = Buffer.concat([a.update(sandi, "utf8"), a.final()]);
  return iv.toString("hex") + ":" + a.getAuthTag().toString("hex") + ":" + isi.toString("hex");
}

export async function dekSandiAsli(simpanan: string | null): Promise<string | null> {
  if (!simpanan) return null;
  const [ivH, tagH, isiH] = simpanan.split(":");
  if (!ivH || !tagH || !isiH) return null;
  try {
    const kunci = await bacaKunci();
    const d = createDecipheriv("aes-256-gcm", kunci, Buffer.from(ivH, "hex"));
    d.setAuthTag(Buffer.from(tagH, "hex"));
    return Buffer.concat([d.update(Buffer.from(isiH, "hex")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* Bikin sesi baru + pasang cookie. Dipanggil setelah login berhasil. */
export async function bikinSesi(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const kadaluarsa = new Date(Date.now() + UMUR_SESI_HARI * 864e5);
  await db.sesi.create({ data: { token, penggunaId: userId, kadaluarsa } });
  const toples = await cookies();
  toples.set(NAMA_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: kadaluarsa,
  });
  return token;
}

/* Baca sesi dari cookie yang lagi aktif. Expired/valid ditangani sekalian.
   Akun owner (Neyhra) otomatis dikasih flag admin + verified biar gak
   ada jalur yang kelewat (login lama, data pindahan).
   Sekalian ngejamin migrasi username udah jalan (sekali per proses,
   murah abis ny: sekali COUNT pas server nyala). */
export async function bacaSesi(): Promise<PenggunaPublik | null> {
  void pastikanUsername();
  const toples = await cookies();
  const token = toples.get(NAMA_COOKIE)?.value;
  if (!token) return null;
  const sesi = await db.sesi.findUnique({
    where: { token },
    include: { pengguna: true },
  });
  if (!sesi) return null;
  if (sesi.kadaluarsa < new Date()) {
    await db.sesi.delete({ where: { id: sesi.id } }).catch(() => {});
    return null;
  }
  let p = sesi.pengguna;
  if (p.nama === "Neyhra" && (!p.admin || !p.verified)) {
    p = await db.pengguna.update({ where: { id: p.id }, data: { admin: true, verified: true } });
  }
  return kePublik(p);
}

export async function keluarSesi() {
  const toples = await cookies();
  const token = toples.get(NAMA_COOKIE)?.value;
  if (token) {
    await db.sesi.deleteMany({ where: { token } }).catch(() => {});
  }
  toples.delete(NAMA_COOKIE);
}
