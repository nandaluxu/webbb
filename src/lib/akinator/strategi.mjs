/* Strategi transport Akinator (r24): nentuin URUTAN percobaan buat
   nembus Cloudflare, dari yang paling ringan:
     1. HTTP langsung (curl) — paling murah, coba duluan.
     2. Proxy dari ENV (AKINATOR_PROXY / AKINATOR_PROXY_LIST) — cuma
        dipakai kalau ENV ny diisi pemilik; rotasi HANYA saat gagal.
     3. Playwright (browser) — paling berat, lazy, cuma kalau semua
        di atasny gagal (lihat playwright.mjs).

   Modul ny MURNI (baca ENV + balikin daftar) biar bisa dites
   terpisah tanpa server. Jangan hardcode proxy publik: daftar ny
   100% dari ENV pemilik.

   AKINATOR_FORCE_TRANSPORT=direct|proxy|playwright bisa dipakai
   buat mastiin satu mode (ops/debug), default: urutan normal. */

function bacaYa(env, nama) {
  const v = String(env[nama] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Daftar proxy dari ENV (dibersihin, unik, urutan tetap). */
export function daftarProxy(env = process.env) {
  const isi = [
    String(env.AKINATOR_PROXY ?? '').trim(),
    ...String(env.AKINATOR_PROXY_LIST ?? '')
      .split(/[,\n;]+/)
      .map((s) => s.trim()),
  ].filter(Boolean);
  return [...new Set(isi)];
}

/** Timeout (detik) per request HTTP. Default 60 kayak sebelum ny. */
export function bacaTimeout(env = process.env) {
  const n = Number(env.AKINATOR_TIMEOUT);
  return Number.isFinite(n) && n >= 5 && n <= 300 ? Math.round(n) : 60;
}

/** Maks retry transport per request (curl level). Default 3. */
export function bacaMaksRetry(env = process.env) {
  const n = Number(env.AKINATOR_MAX_RETRIES);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : 3;
}

/** Playwright di-izinkan sebagai lapisan terakhir? */
export function playwrightDiizinkan(env = process.env) {
  if (bacaYa(env, 'AKINATOR_PLAYWRIGHT_DISABLE')) return false;
  return String(env.AKINATOR_PLAYWRIGHT ?? '').trim() === '' || bacaYa(env, 'AKINATOR_PLAYWRIGHT');
}

/**
 * Urutan strategi. Balikin array of { mode, proxy }:
 *   { mode: 'direct' }                      — curl tanpa proxy
 *   { mode: 'proxy', proxy: 'http://...' }  — curl lewat proxy
 *   { mode: 'playwright' }                  — browser (lazy)
 */
export function urutanStrategi(env = process.env) {
  const paksa = String(env.AKINATOR_FORCE_TRANSPORT ?? '').trim().toLowerCase();
  if (paksa === 'playwright') return [{ mode: 'playwright' }];
  if (paksa === 'proxy') {
    const d = daftarProxy(env);
    return d.length ? d.map((proxy) => ({ mode: 'proxy', proxy })) : [{ mode: 'direct' }];
  }
  if (paksa === 'direct') return [{ mode: 'direct' }];

  const isi = [{ mode: 'direct' }];
  for (const proxy of daftarProxy(env)) isi.push({ mode: 'proxy', proxy });
  if (playwrightDiizinkan(env)) isi.push({ mode: 'playwright' });
  return isi;
}
