/* AM Premium Generator (server-side): port dari lib yang dikasih
   pemilik web, dibikin pake fetch native (axios gak terpasang di
   project ini), endpoint, header, dan bentuk body ny persis sama.

   Alur ny:
   1. link(email)   -> Identity Toolkit ngirim email magic link ke
                       alamat ny (requestType 6, klien Android).
   2. kodeOob(url)  -> narik oobCode dari URL yang user salin dari
                       email ny (dukung link ny kebungkus param
                       link/q/url juga).
   3. auth(email,   -> tuker oobCode jadi idToken (emailLinkSignin)
       url)            + ngambil info akun.
   4. pro(idToken)  -> verifikasi pembelian dengan orderId custom
                       prefix NeyhraPlayground -> akun jadi premium.

   Sesi email (Map modul): nyatet email yang udah request magic link.
   Dipake buat jaga syarat "email ny gak boleh berubah" antara
   request dan aktivasi, dicocokin server-side juga, bukan cuma UI. */

import { randomBytes, randomInt } from "crypto";

const cfg = {
  key: "AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0",
  idt: "https://www.googleapis.com/identitytoolkit/v3/relyingparty",
  stk: "https://securetoken.googleapis.com/v1/token",
  vfy: "https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase",
};

const ORDER_PREFIX = "NeyhraPlayground";

/* Sesi email yang udah minta magic link (dibagi antar request di
   proses server yang sama). Umur ny 30 menit. */
export const sesiAm = new Map<string, { waktu: number }>();
const UMUR_SESI_MS = 30 * 60 * 1000;

function sesiSegar() {
  const kini = Date.now();
  for (const [k, v] of sesiAm) if (kini - v.waktu > UMUR_SESI_MS) sesiAm.delete(k);
}

export function catatSesi(email: string) {
  sesiAm.set(email.toLowerCase(), { waktu: Date.now() });
}

export function sesiCocok(email: string): boolean {
  sesiSegar();
  return sesiAm.has(email.toLowerCase());
}

/* ---------- Helper (pola sama kayak lib asli) ---------- */

const dip = () => [randomInt(1, 255), randomInt(0, 255), randomInt(0, 255), randomInt(1, 255)].join(".");

const sp = (h: Record<string, string>) => ({
  ...h,
  "x-forwarded-for": dip(),
  "x-real-ip": dip(),
  "client-ip": dip(),
  "x-client-ip": dip(),
  "x-originating-ip": dip(),
  "x-cluster-client-ip": dip(),
});

const h1 = {
  "content-type": "application/json",
  "x-android-package": "com.alightcreative.motion",
  "x-android-cert": "ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8",
  "user-agent": "dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)",
};

const h2 = {
  "content-type": "application/json; charset=utf-8",
  "user-agent": "okhttp/3.12.1",
  "accept-encoding": "gzip",
};

type GalatAm = { ok: false; why: string };

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: sp(headers),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const teks = await res.text();
  let data: any = null;
  try {
    data = teks ? JSON.parse(teks) : null;
  } catch {
    data = teks;
  }
  if (!res.ok) {
    const why = data ? (typeof data === "object" ? JSON.stringify(data) : String(data)) : "HTTP " + res.status;
    throw new Error(why);
  }
  return data;
}

function galat(e: unknown): GalatAm {
  return { ok: false, why: e instanceof Error ? e.message : "Kesalahan gak terduga" };
}

/* ---------- Kirim link verifikasi ---------- */

export async function link(email: string): Promise<{ ok: true } | GalatAm> {
  const c1 = { identifier: email, continueUri: "http://localhost" };
  const c2 = {
    requestType: 6,
    email: email,
    androidInstallApp: true,
    canHandleCodeInApp: true,
    continueUrl: "https://alightcreative.com?ui_sid=0366624874&ui_sd=0",
    iosBundleId: "com.alightcreative.motion",
    androidPackageName: "com.alightcreative.motion",
    androidMinimumVersion: "585",
    clientType: "CLIENT_TYPE_ANDROID",
  };
  try {
    await postJson(`${cfg.idt}/createAuthUri?key=${cfg.key}`, c1, h1);
    await postJson(`${cfg.idt}/getOobConfirmationCode?key=${cfg.key}`, c2, h1);
    return { ok: true };
  } catch (e) {
    return galat(e);
  }
}

/* ---------- Extract oobCode dari URL email ---------- */

export function kodeOob(raw: string): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* biarkan apa adany */
  }
  try {
    const u = new URL(s);
    let c = u.searchParams.get("oobCode");
    if (!c) {
      const n = u.searchParams.get("link") || u.searchParams.get("q") || u.searchParams.get("url");
      if (n) {
        try {
          c = new URL(n).searchParams.get("oobCode");
        } catch {
          /* biarkan null */
        }
      }
    }
    if (c) return c.replace(/[^a-zA-Z0-9_-]/g, "");
  } catch {
    /* bukan URL: coba pola mentah di bawah */
  }
  const m = s.match(/oobCode=([a-zA-Z0-9_-]+)/i);
  if (m) return m[1];
  const t = s.trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(t) && !t.includes("://")) return t;
  return null;
}

/* ---------- Login pakai oobCode ---------- */

export async function auth(
  email: string,
  raw: string
): Promise<{ ok: true; email: string; id: string; ref: string; uid: string; baru: boolean } | GalatAm> {
  const c = kodeOob(raw);
  if (!c) return { ok: false, why: "Kode verifikasi gak ketemu di link ny. Salin ulang link lengkap dari email ny." };
  try {
    const a = await postJson(`${cfg.idt}/emailLinkSignin?key=${cfg.key}`, {
      email: email,
      oobCode: c,
      clientType: "CLIENT_TYPE_ANDROID",
    }, h1);
    return {
      ok: true,
      email: email,
      id: a.idToken,
      ref: a.refreshToken,
      uid: a.localId,
      baru: !!a.isNewUser,
    };
  } catch (e) {
    return galat(e);
  }
}

/* ---------- Promosikan premium (orderId prefix custom) ---------- */

export async function pro(id: string): Promise<{ ok: true; order: string; r: unknown } | (GalatAm & { order: string })> {
  const o = `${ORDER_PREFIX}-${randomBytes(6).toString("hex").toUpperCase()}`;
  const b = {
    data: {
      productId: "am.full.sub.annual.19q4",
      token: "mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw",
      skuType: "subs",
      orderId: o,
    },
  };
  const h = {
    ...h2,
    authorization: "Bearer " + id,
    "firebase-instance-id-token":
      "cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI",
  };
  try {
    const r = await postJson(cfg.vfy, b, h);
    return { ok: true, order: o, r };
  } catch (e) {
    const g = galat(e);
    return { ...g, order: o };
  }
}

/* ---------- Refresh token (disimpen buat kelengkapan lib) ---------- */

export async function re(ref: string): Promise<{ ok: true; id: string; ref: string } | GalatAm> {
  try {
    const r = await postJson(`${cfg.stk}?key=${cfg.key}`, {
      grant_type: "refresh_token",
      refresh_token: ref,
    }, h2);
    return { ok: true, id: r.id_token, ref: r.refresh_token };
  } catch (e) {
    return galat(e);
  }
}

/* Validasi email: bebas domainny (bukan cuma gmail), cukup bentuk
   lokal@domain.tld yang masuk akal. */
export function emailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}
