// sfile-wa.js — library sfile.co satu file (ESM, zero-deps)
// Gabungan: config + utils + md5 + http + scraper + uploader + downloader + index (facade)
//
//     import { Sfile, sfile } from './sfile-wa.js';
//     const res  = await sfile.search('moskov', { pages: 2 });   // 40 hasil
//     const info = await sfile.getFile('https://sfile.co/lb7TF76oUk6');
//     const dl   = await sfile.getDownloadUrl('lb7TF76oUk6');    // direct, tanpa nunggu
//     const buf  = await sfile.downloadFile('lb7TF76oUk6');      // → {buffer,...}
//     const up   = await sfile.uploadFile('./config.zip');       // guest upload

import http2 from 'node:http2';
import zlib from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

// ════════════════════════════════════════════════════════════════════════════
// CONFIG — konstanta hasil reverse-engineering sfile.co (2026-09-20)
// ════════════════════════════════════════════════════════════════════════════

export const BASE = 'https://sfile.co';

// Halaman publik
export const PATHS = {
  search: '/search',
  upload: '/upload/resume_v1_guest.php'
};

// Search
export const PAGE_SIZE = 20;          // hasil per halaman (terverifikasi)
export const MAX_PAGES_HARD_CAP = 50; // pengaman search { all: true }

// Download
export const VERIFY_RANGE = 'bytes=0-0'; // GET 1 byte untuk verifikasi direct URL

// Upload guest (persis window.uploadConfig di homepage)
export const UPLOAD = {
  endpoint: '/upload/resume_v1_guest.php',
  chunkSize: 1048576,              // 1 MB per chunk (flow.js)
  maxUploadBytes: 262144000,       // 250 MB
  maxUploadLabel: '250 MB',
  maxDescriptionLength: 550,
  // Ekstensi yang diizinkan server (mp4 TIDAK ada — emang sumpahin sfile)
  allowedExtensions: [
    'ktr', 'gif', 'jpg', 'png', 'bmp', 'jar', 'jad', 'apk', 'mid', 'jpeg',
    'gz', 'tar', 'txt', 'ttf', 'pdf', 'doc', 'docx', 'cab', 'bin', 'csv',
    'css', 'dll', 'dmg', 'dwg', 'psd', 'raw', 'svg', 'tiff', 'eps', 'ai',
    'indd', 'webp', 'ico', 'iso', 'js', 'ehi', 'ehil', 'midi', 'ktc', 'ktcu',
    'ktcf', 'acm', 'ovpn', 'epro', 'twk', 'vcf', 'swf', 'acl', 'xml', 'lua',
    'm3u', 'zip', 'otf', 'mcpack', 'mcworld', 'hc', 'tls', 'viz', 'json',
    'npv2', 'npv3', 'npv4', 'pnv4', 'tnl', 'garuda', 'hat', 'v2', 'nm',
    'bussidmod', 'ssh', 'sks', 'ssc', 'pptx', 'pb', 'ziv', 'srt', 'rar',
    'xlsx', 'rtf', 'xapk', 'apks', '7z', 'dark', 'epub'
  ]
};

// Kata yang diblokir server (window.banned) — dicek duluan biar ga buang-buang upload
export const BANNED_WORDS = [
  'spam', 'malware', 'brutal', 'gacor', 'sex', 'porn', 'bugil', 'ngewe',
  'bokep', 'fuck', 'bangsat', 'xxx', 'perkosa', 'perawan', 'edan', 'oplosan',
  'hack', 'memek', 'muncrat', 'ngentot', 'itil', 'telanjang', 'mesum',
  'kontol', 'montok', 'bacol', 'xvideos', 'xvideo', 'crot', 'tocil',
  'pentil', 'bocah', 'bocil', 'anak', 'adik', 'adek', 'dick', 'babi', 'toge',
  'sange', 'colmek', 'doge', 'faucet', 'viral', 'pink', 'hentai', 'mulus',
  'masturb', 'avengers', 'cewek', 'cheat', 'crack', 'hax', 'siswi', 'remas',
  'bitcoin', 'tante', 'abg', 'coli', 'selingkuh', 'klik', 'click', 'ngocok',
  'loli', 'jav', 'smp', 'toto', 'judi', 'lotre', 'dedek', 'ibispaint',
  'chat gpt', 'chatgpt', 'vsco', 'nurul', 'hidayah'
];

// HTTP
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
export const DEFAULTS = {
  throttleMs: 350,   // jeda antar request ke sfile.co (sopan + anti rate-limit)
  timeoutMs: 20000,  // timeout per request
  retries: 2         // retry network error / 5xx / 429
};

// ════════════════════════════════════════════════════════════════════════════
// UTILS — error, cookie jar, parser, helper
// ════════════════════════════════════════════════════════════════════════════

export class SfileError extends Error {
  /**
   * @param {string} message  pesan error (ramah user)
   * @param {string} code     kode error terklasifikasi
   * @param {object} [extra]  data tambahan (short, url, dsb.)
   */
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'SfileError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Session cookie sederhana (PHPSESSID + cookie Cloudflare) — cukup untuk sfile.co */
export class CookieJar {
  constructor() { this.map = new Map(); }

  absorb(res) {
    try {
      let list = [];
      if (typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie();
      else {
        const raw = res.headers.get('set-cookie');
        if (raw) list = String(raw).split(/,(?=[^;]+?=)/);
      }
      for (const c of list) {
        const m = /^\s*([^=;\s]+)=([^;]*)/.exec(c);
        if (m) this.map.set(m[1], m[2]);
      }
    } catch { /* best effort */ }
  }

  header() { return [...this.map].map(([k, v]) => `${k}=${v}`).join('; '); }
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
export function decodeEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, m => ENTITIES[m]);
}

/** "28.59 MB" → 29980944 | "55 bytes" → 55 | "1.47 MB" → 1541407 (sfile pakai satuan biner) */
export function parseSizeToBytes(label) {
  if (!label) return null;
  const m = /^\s*([\d.,]+)\s*(B|bytes|KB|MB|GB|TB)?\s*$/i.exec(String(label));
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] || 'B').toUpperCase();
  const mult = { B: 1, BYTES: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] || 1;
  return Math.round(num * mult);
}

/** "19.960" / "1,234" → 19960 / 1234 (angka hasil, bukan desimal) */
export function parseCountLabel(s) {
  if (s == null) return null;
  const digits = String(s).replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "19 Sep 2026" / "19 September 2026" → Date (best-effort, null kalau gagal) */
export function parseUploadedLabel(label) {
  if (!label) return null;
  const m = /(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/.exec(String(label).trim());
  if (!m) return null;
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (mon == null) return null;
  const d = new Date(Date.UTC(Number(m[3]), mon, Number(m[1])));
  return isNaN(d.getTime()) ? null : d;
}

const RESERVED = new Set(['search', 'category', 'user', 'download', 'terms', 'privacy', 'contact', 'upload', 'icon', 'includes', 'memberpayment', 'v1', 'cdn-cgi', 'csp-report']);

/**
 * Terima apa aja → short code file sfile.co.
 * @param {string|{short?:string,url?:string}} input  "lb7TF76oUk6" | "https://sfile.co/lb7TF76oUk6" | {url|short}
 * @returns {string|null}
 */
export function extractShort(input) {
  if (input == null) return null;
  if (typeof input === 'object') {
    if (typeof input.short === 'string' && input.short) return extractShort(input.short);
    if (typeof input.url === 'string' && input.url) return extractShort(input.url);
    return null;
  }
  let s = String(input).trim();
  if (!s) return null;
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname;
  } catch { return null; }
  const seg = s.split('/').filter(Boolean)[0];
  if (!seg || !/^[A-Za-z0-9]{6,16}$/.test(seg)) return null;
  if (RESERVED.has(seg.toLowerCase())) return null;
  return seg;
}

export function fileUrlFromShort(short) { return `${BASE}/${short}`; }

/** Balikin escape JS/HTML dalam URL hasil scrape: "\/" → "/", "&amp;" → "&" */
export function unescapeUrl(u) {
  return String(u).replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/&amp;/g, '&');
}

/** Parse header Content-Disposition → { filename } */
export function parseContentDisposition(header) {
  if (!header) return { filename: null };
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try { return { filename: decodeURIComponent(star[1].trim()) }; } catch { /* lanjut */ }
  }
  const plain = /filename="([^"]*)"/i.exec(header);
  if (plain) return { filename: plain[1] };
  const bare = /filename=([^;]+)/i.exec(header);
  if (bare) return { filename: bare[1].trim().replace(/^["']|["']$/g, '') };
  return { filename: null };
}

/** Ambil ekstensi dari nama file, lowercase */
export function extOf(name) {
  if (!name) return null;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1].toLowerCase() : null;
}

/** Cek kata terlarang (filename + description) sebelum upload → kata yang kena, atau null */
export function findBannedWord(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const low = String(t).toLowerCase();
    for (const w of BANNED_WORDS) {
      if (low.includes(w)) return w;
    }
  }
  return null;
}

/** Ekstensi diizinkan upload? */
export function isAllowedExtension(name, allowed) {
  const ext = extOf(name);
  return !!ext && allowed.includes(ext);
}

// ════════════════════════════════════════════════════════════════════════════
// MD5 — pure JavaScript (zero-deps), untuk file_hash upload sfile.co
// Dipakai pre-flight intent=check-hash (dedup 409 + deteksi kata terlarang lebih awal).
// ════════════════════════════════════════════════════════════════════════════

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];

const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

/**
 * Hitung MD5.
 * @param {Uint8Array|Buffer|string} input
 * @returns {string} hex digest (32 karakter)
 */
export function md5hex(input) {
  const buf = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const len = buf.length;
  const total = (((len + 8) >> 6) + 1) << 6;
  const m = new Uint8Array(total);
  m.set(buf);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  const bitLenLo = (len * 8) >>> 0;
  const bitLenHi = Math.floor((len * 8) / 4294967296);
  dv.setUint32(total - 8, bitLenLo, true);
  dv.setUint32(total - 4, bitLenHi, true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);

  for (let off = 0; off < total; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
  let hex = '';
  for (const b of out) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// ════════════════════════════════════════════════════════════════════════════
// HTTP — HTTP/2 native (node:http2) untuk sfile.co, dengan FINGERPRINT MIMIC curl
//
// KENAPA BUKAN fetch()? fetch/undici Node jalan di HTTP/1.1 dan LANGSUNG kena
// challenge Cloudflare sfile.co (403 "Just a moment") — terverifikasi live.
//
// KENAPA MIMIC curl? node:http2 default PASSES untuk GET polos, tapi request yang bawa
// header `referer` kena challenge CF (fingerprint h2 node dianggap bot).
// Terverifikasi live: dengan SETTINGS + urutan pseudo-header PERSIS curl/nghttp2
// (enablePush:false, initialWindowSize:65536, maxConcurrentStreams:100,
//  :method :scheme :authority :path), request + referer LOLOS CF —
// dan app sfile WAJIB referer di POST /upload (invalid_origin tanpa itu).
//
// Zero dependencies (module bawaan Node), jalan di Pterodactyl tanpa playwright.
// ════════════════════════════════════════════════════════════════════════════

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// SETTINGS frame persis curl/nghttp2 (fingerprint anti-challenge — hasil eksperimen)
const CURL_LIKE_SETTINGS = { enablePush: false, initialWindowSize: 65536, maxConcurrentStreams: 100 };

export class SfileHttp {
  /**
   * @param {object} [opts]
   * @param {number} [opts.throttleMs]  jeda antar request (default 350ms)
   * @param {number} [opts.timeoutMs]   timeout per request (default 20s)
   * @param {number} [opts.retries]     retry network/5xx/429 (default 2)
   * @param {CookieJar} [opts.jar]      cookie jar external (shared antar modul)
   */
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.jar = opts.jar instanceof CookieJar ? opts.jar : new CookieJar();
    this._lastReq = 0;
    this._sessions = new Map(); // origin → http2 session (keep-alive, multiplexed)
  }

  async _throttle() {
    const wait = this.opts.throttleMs - (Date.now() - this._lastReq);
    if (wait > 0) await sleep(wait);
    this._lastReq = Date.now();
  }

  _session(origin) {
    let c = this._sessions.get(origin);
    if (!c || c.destroyed || c.closed) {
      c = http2.connect(origin, { settings: CURL_LIKE_SETTINGS });
      c.on('error', () => { try { c.close(); } catch { /* ignore */ } this._sessions.delete(origin); });
      this._sessions.set(origin, c);
    }
    return c;
  }

  close() {
    for (const c of this._sessions.values()) { try { c.close(); } catch { /* ignore */ } }
    this._sessions.clear();
  }

  _absorbCookies(setCookies) {
    for (const c of setCookies || []) {
      const m = /^\s*([^=;\s]+)=([^;]*)/.exec(c);
      if (m) this.jar.map.set(m[1], m[2]);
    }
  }

  _mergedHeaders(extra) {
    // Urutan header disusun meniru curl (user-agent → accept → referer → cookie → sisanya)
    // supaya fingerprint request konsisten dengan SETTINGS curl-like di _session().
    const h = { 'user-agent': UA };
    const e = {};
    for (const [k, v] of Object.entries(extra || {})) {
      if (v != null) e[String(k).toLowerCase()] = String(v);
    }
    if (e.accept != null) { h.accept = e.accept; delete e.accept; }
    if (e.referer != null) { h.referer = e.referer; delete e.referer; }
    const ck = this.jar.header();
    if (ck) h.cookie = ck;
    Object.assign(h, e);
    return h;
  }

  /** Satu request HTTP/2 mentah (tanpa redirect/retry). */
  _raw(url, { method = 'GET', headers = {}, body = null, timeoutMs, idleTimeoutMs, onChunk, maxBytes } = {}) {
    return new Promise((resolve, reject) => {
      let u;
      try { u = new URL(url); } catch { return reject(new SfileError(`URL tidak valid: ${url}`, 'INVALID_URL')); }
      let client;
      try { client = this._session(u.origin); } catch (e) { return reject(new SfileError(`Gagal sambungan ke ${u.origin}: ${e.message}`, 'NETWORK')); }

      try { client.socket?.ref?.(); } catch { /* ignore */ }

      const flat = this._mergedHeaders(headers);
      // Pseudo-header urutan curl: :method :scheme :authority :path — bagian dari
      // fingerprint h2 yang lolos Cloudflare (jangan diubah urutannya!).
      const u2 = { protocol: u.protocol.replace(':', ''), host: u.host };
      const h2h = {
        ':method': method.toUpperCase(),
        ':scheme': u2.protocol,
        ':authority': u2.host,
        ':path': u.pathname + u.search,
        ...flat
      };
      if (body != null && flat['content-length'] == null) h2h['content-length'] = String(body.length);

      let req;
      try { req = client.request(h2h); } catch (e) { return reject(new SfileError(`Request gagal: ${e.message}`, 'NETWORK')); }

      const timer = setTimeout(() => req.destroy(new SfileError(`Timeout setelah ${timeoutMs ?? this.opts.timeoutMs}ms`, 'TIMEOUT')), timeoutMs ?? this.opts.timeoutMs);
      if (idleTimeoutMs > 0) req.setTimeout(idleTimeoutMs, () => req.destroy(new SfileError(`Idle timeout ${idleTimeoutMs}ms saat transfer data`, 'TIMEOUT')));

      let status = 0, resHeaders = {}, setCookies = [], total = null;
      const chunks = [];
      let received = 0;
      let settled = false;

      const finish = (err, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { client.socket?.unref?.(); } catch { /* ignore */ }
        if (err) reject(err);
        else resolve({ status, headers: resHeaders, setCookies, body: Buffer.concat(chunks), url, total });
      };

      req.on('response', rh => {
        status = rh[':status'];
        const sc = rh['set-cookie'];
        if (sc) for (const c of Array.isArray(sc) ? sc : [sc]) setCookies.push(c);
        delete rh['set-cookie'];
        resHeaders = rh;
        total = Number(rh['content-length']) || null;
      });
      req.on('data', c => {
        chunks.push(c);
        received += c.length;
        if (onChunk) onChunk(c, received, total);
        if (maxBytes && received > maxBytes) {
          req.destroy(new SfileError(`Melebihi batas ${Math.round(maxBytes / 1048576)} MB`, 'TOO_LARGE'));
        }
      });
      req.on('end', () => finish(null));
      req.on('error', e => finish(e instanceof SfileError ? e : new SfileError(`Network: ${e.message}`, 'NETWORK')));

      if (body != null) req.end(body);
      else req.end();
    });
  }

  /** Request + ikutin redirect (≤6) + decompress + cookie. */
  async _follow(url, opts = {}) {
    let current = url;
    let method = opts.method || 'GET';
    let body = opts.body ?? null;
    for (let hop = 0; hop <= 6; hop++) {
      await this._throttle();
      const res = await this._raw(current, { ...opts, method, body });
      this._absorbCookies(res.setCookies);

      if (res.status === 403) {
        const sample = res.body.subarray(0, 2048).toString('utf8');
        if (/Just a moment\.\.\.|challenges\.cloudflare\.com|_cf_chl_opt/.test(sample)) {
          throw new SfileError('sfile.co menantang Cloudflare untuk IP ini (403). Coba lagi nanti atau ganti IP.', 'CF_CHALLENGED', { url: current });
        }
      }

      if (REDIRECTS.has(res.status) && res.headers['location']) {
        const next = new URL(res.headers['location'], current).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== 'GET')) {
          method = 'GET';
          body = null;
        }
        current = next;
        continue;
      }

      // decompress (kalau server kirim encoding padahal gak diminta)
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc && res.body.length) {
        try {
          if (enc === 'gzip' || enc === 'x-gzip') res.body = zlib.gunzipSync(res.body);
          else if (enc === 'deflate') res.body = zlib.inflateSync(res.body);
          else if (enc === 'br') res.body = zlib.brotliDecompressSync(res.body);
        } catch { /* biarkan mentah */ }
      }
      return { ...res, finalUrl: current };
    }
    throw new SfileError('Terlalu banyak redirect (loop?)', 'TOO_MANY_REDIRECTS', { url });
  }

  /**
   * Request utama: throttle + redirect + retry network/429/5xx + cookie.
   * 5xx yang body-nya JSON {"status":"error"} TIDAK di-retry (penolakan app, bukan glitch).
   * @param {object} opts { method, headers, body(Buffer|string), timeoutMs, idleTimeoutMs, onChunk, maxBytes, retries }
   * @returns {Promise<{status,headers:object,body:Buffer,finalUrl:string}>}
   */
  async request(url, opts = {}) {
    const retries = opts.retries ?? this.opts.retries;
    let bodyBuf = opts.body == null ? null : Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body));
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await this._follow(url, { ...opts, body: bodyBuf });
        const isAppRejection = res.status >= 400 && res.body.subarray(0, 64).toString('utf8').trimStart().startsWith('{"status":"error"');
        if (!isAppRejection && (res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        return res;
      } catch (e) {
        if (e instanceof SfileError && ['CF_CHALLENGED', 'TOO_LARGE', 'TOO_MANY_REDIRECTS', 'INVALID_URL'].includes(e.code)) throw e;
        lastErr = e;
        if (attempt < retries) { await sleep(800 * (attempt + 1)); continue; }
        throw e;
      }
    }
    throw lastErr || new SfileError('Request gagal', 'NETWORK');
  }

  /**
   * Request halaman/endpoint → teks. Dipakai search, file page, wait page, check-hash, chunk upload.
   * @returns {Promise<{status:number,url:string,contentType:string,html:string}>}
   */
  async page(url, { method = 'GET', body, contentType, referer, timeoutMs, headers } = {}) {
    const res = await this.request(url, {
      method,
      body,
      timeoutMs,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,id;q=0.8',
        ...(referer ? { referer } : {}),
        ...(contentType ? { 'content-type': contentType } : {}),
        ...(headers || {})
      }
    });
    return {
      status: res.status,
      url: res.finalUrl,
      contentType: String(res.headers['content-type'] || ''),
      html: res.body.toString('utf8')
    };
  }

  /**
   * Probe kecil (Range GET) untuk verifikasi direct URL.
   * @returns {Promise<{ok:boolean,status:number,headers:object|null}>}
   */
  async probe(url, { referer, range, timeoutMs } = {}) {
    try {
      const res = await this.request(url, {
        method: 'GET',
        timeoutMs,
        headers: { accept: '*/*', ...(range ? { range } : {}), ...(referer ? { referer } : {}) }
      });
      const ok = res.status >= 200 && res.status < 300;
      return { ok, status: res.status, headers: ok ? res.headers : null };
    } catch {
      return { ok: false, status: 0, headers: null };
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SCRAPER — engine utama: search, info file, direct download URL
//
// Hasil reverse-engineering (2026-09-20, terverifikasi live dari IP datacenter):
// - Search: GET /search?q=<q>&page=<n> → 20 kartu/halaman; total di halaman itu FAKE
//   (selalu (page+1)×20) → pagination berhenti saat halaman kosong.
// - File page: JSON-LD MediaObject + breadcrumb + data-dw-url (link download bertanda tangan fid).
// - Flow download: GET data-dw-url (wajib bawa session cookie) → halaman "Please wait"
//   yang SUDAH berisi direct URL (downloadNNNN.sfile.co/downloadfile/...?k=...) →
//   direct URL bisa langsung diakses TANPA nunggu countdown (timer cuma JS client-side).
// ════════════════════════════════════════════════════════════════════════════

// Kartu hasil search: <a ... class="...search-result-link..." data-file-url="URL">NAMA</a> <p ...>28.59 MB • 19 Sep 2026</p>
const CARD_RE = /<a\s+(?=[^>]*class="[^"]*search-result-link)(?=[^>]*data-file-url="([^"]+)")[^>]*>\s*([^<]+?)\s*<\/a>\s*<p\s[^>]*>\s*([^<]+?)\s*<\/p>/g;

// Direct URL di halaman "Please wait" — toleran terhadap escape "\/" (string JS) dan &amp; (atribut HTML)
const DIRECT_RE = /https?:\\?\/\\?\/(?:download\d+\.sfile\.co|sfile\.co)\\?\/(?:downloadfile|download)\\?\/\d+\\?\/\d+\\?\/[a-f0-9]{32}\\?\/[^"'\s<>]+/gi;

export class SfileScraper {
  constructor(opts = {}) {
    this.http = opts.http instanceof SfileHttp ? opts.http : new SfileHttp(opts);
  }

  // ---------------------------------------------------------------- SEARCH

  /**
   * Ambil SATU halaman hasil search.
   * @param {string} query
   * @param {number} [page=1]
   * @returns {Promise<{query:string,page:number,results:Array,showingLabel:string|null,totalFake:number|null,hasMore:boolean}>}
   */
  async searchPage(query, page = 1) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new SfileError('Query search tidak boleh kosong', 'EMPTY_QUERY');
    }
    const url = `${BASE}${PATHS.search}?q=${encodeURIComponent(query.trim())}${page > 1 ? `&page=${page}` : ''}`;
    const { status, html } = await this.http.page(url, { referer: `${BASE}/` });
    if (status === 404) {
      return { query, page, results: [], showingLabel: null, totalFake: null, hasMore: false };
    }
    const results = parseCards(html);
    const showingLabel = (/(Showing[^<]{0,80}?results[^\n<]{0,30})/i.exec(html) || [])[1]?.trim() || null;
    const totalFake = parseCountLabel((/([\d.,]+)\s+results?\s+for\s+/i.exec(html) || [])[1]);
    return { query, page, results, showingLabel, totalFake, hasMore: results.length >= PAGE_SIZE };
  }

  /**
   * Search dengan kontrol jumlah hasil.
   * @param {string} query
   * @param {object} [opts]
   * @param {number} [opts.pages=1]  jumlah halaman (1 page = 20 hasil)
   * @param {number} [opts.max]      berhenti setelah N hasil (prioritas di atas pages)
   * @param {boolean} [opts.all]     kumpulkan sampai halaman kosong (cap MAX_PAGES_HARD_CAP)
   * @param {number} [opts.startPage] halaman mulai (default 1)
   * @param {number} [opts.maxPages] cap halaman saat all:true (default 50)
   */
  async search(query, opts = {}) {
    const startPage = Math.max(1, opts.startPage || 1);
    const all = opts.all === true;
    const maxPagesCap = Math.max(1, opts.maxPages || MAX_PAGES_HARD_CAP);

    let targetCount, pageLimit;
    if (all) {
      targetCount = Infinity;
      pageLimit = startPage + maxPagesCap - 1;
    } else if (Number.isFinite(opts.max) && opts.max > 0) {
      targetCount = Math.floor(opts.max);
      pageLimit = startPage + Math.ceil(targetCount / PAGE_SIZE) - 1;
    } else {
      const pages = Math.max(1, opts.pages || 1);
      targetCount = pages * PAGE_SIZE;
      pageLimit = startPage + pages - 1;
    }

    const results = [];
    const seen = new Set();
    const pages = [];
    let totalFake = null;
    let hasMore = false;
    let capped = false;
    let page = startPage;

    while (page <= pageLimit) {
      const p = await this.searchPage(query, page);
      if (p.totalFake != null) totalFake = p.totalFake;

      const fresh = p.results.filter(r => !seen.has(r.short));
      const repeated = p.results.length > 0 && fresh.length === 0; // pengaman loop
      for (const r of fresh) {
        if (results.length < targetCount) { results.push(r); seen.add(r.short); }
      }
      pages.push({
        page, count: p.results.length,
        from: results.length - Math.min(fresh.length, results.length) + 1 || null,
        to: results.length || null,
        totalFake: p.totalFake, showingLabel: p.showingLabel
      });
      hasMore = p.hasMore;

      if (p.results.length === 0 || repeated) { hasMore = false; break; }
      if (results.length >= targetCount) break;
      page++;
    }
    if (all && hasMore && page > pageLimit) capped = true;

    return {
      query,
      results,
      count: results.length,
      pages,
      pagesFetched: pages.length,
      pageSize: PAGE_SIZE,
      totalFake,
      hasMore,
      capped,
      note: 'Total dari sfile.co itu FAKE (selalu (page+1)×20) — percaya hasMore/hasil kosong saja.'
    };
  }

  // ---------------------------------------------------------------- FILE INFO

  /**
   * Ambil metadata lengkap file.
   * @param {string|object} input  URL / short code / object {url|short}
   * @returns {Promise<object>} { short,url,name,nameClean,ext,mime,sizeLabel,sizeBytes,
   *   uploader:{name,url,id},category:{name,url},uploadedAt,uploadedLabel,downloads,
   *   description,fileId,iconUrl,dwUrl,waitSeconds }
   */
  async getFile(input) {
    const short = extractShort(input);
    if (!short) {
      throw new SfileError(
        'Input bukan link/kode file sfile.co yang valid (contoh: https://sfile.co/luUuawBiQMb atau luUuawBiQMb)',
        'INVALID_INPUT', { input: String(input) }
      );
    }
    const url = fileUrlFromShort(short);
    const { status, html } = await this.http.page(url, { referer: `${BASE}/` });
    if (status === 404 || /<title>File not found/i.test(html)) {
      throw new SfileError(`File "${short}" tidak ditemukan (404 — mungkin sudah dihapus)`, 'NOT_FOUND', { short });
    }
    return parseFilePage(html, short);
  }

  // ---------------------------------------------------------------- DIRECT DOWNLOAD URL

  /**
   * Dapatkan direct download URL — TANPA nunggu countdown sfile.
   * @param {string|object} input URL / short / object hasil search / hasil getFile
   * @param {object} [opts]
   * @param {boolean} [opts.verify=true] verifikasi link (GET 1 byte) + ambil filename/size/mime asli
   * @returns {Promise<object>} { short,name,filename,directUrl,alternates,dwUrl,waitSeconds,
   *   sizeBytes,mime,verified,shareableNote }
   */
  async getDownloadUrl(input, opts = {}) {
    const verify = opts.verify !== false;
    const info = typeof input === 'object' && input.directUrl ? input : await this.getFile(input);
    if (!info.dwUrl) {
      throw new SfileError(
        'Tombol download tidak ketemu di halaman file — mungkin file kena moderasi/dihapus',
        'NO_DOWNLOAD_BUTTON', { short: info.short }
      );
    }

    // Step 2: halaman "Please wait" (wajib session cookie yang sama)
    const dw = await this.http.page(info.dwUrl, { referer: info.url, headers: { accept: '*/*' } });

    // Kasus langka: server langsung streaming file (bukan HTML)
    if (dw.contentType && !/text\/html/i.test(dw.contentType)) {
      return {
        short: info.short, name: info.name, filename: info.name,
        directUrl: dw.url, alternates: [], dwUrl: info.dwUrl,
        waitSeconds: info.waitSeconds || 0, sizeBytes: info.sizeBytes ?? null,
        mime: info.mime ?? null, verified: false,
        note: 'Server langsung streaming file tanpa halaman wait.'
      };
    }

    if (/Expired Download Link/i.test(dw.html)) {
      throw new SfileError(
        'Link download sfile kedaluwarsa (fid token mati). Panggil getDownloadUrl lagi dengan fresh session.',
        'DIRECT_EXPIRED', { short: info.short }
      );
    }

    const candidates = rankDirectUrls(extractDirectUrls(dw.html));
    if (!candidates.length) {
      throw new SfileError(
        'Direct URL tidak ketemu di halaman download (struktur berubah?)',
        'PARSE', { short: info.short }
      );
    }

    if (!verify) {
      return {
        short: info.short, name: info.name, filename: info.name,
        directUrl: candidates[0], alternates: candidates.slice(1),
        dwUrl: info.dwUrl, waitSeconds: info.waitSeconds || 0,
        sizeBytes: info.sizeBytes ?? null, mime: info.mime ?? null,
        verified: null
      };
    }

    // Step 3: verifikasi (GET 1 byte) — coba maksimal 3 kandidat
    let chosen = null, vinfo = null;
    for (const c of candidates.slice(0, 3)) {
      const p = await this.http.probe(c, { referer: info.dwUrl, range: VERIFY_RANGE });
      if (p.ok) {
        chosen = c;
        const h = p.headers || {};
        const cr = h['content-range']; // bytes 0-0/29981005
        const total = cr ? Number(/\/(\d+)$/.exec(cr)?.[1]) : Number(h['content-length']) || null;
        vinfo = {
          sizeBytes: Number.isFinite(total) ? total : null,
          mime: String(h['content-type'] || '').split(';')[0] || null,
          filename: parseContentDisposition(h['content-disposition']).filename
        };
        break;
      }
    }

    if (!chosen) {
      return {
        short: info.short, name: info.name, filename: info.name,
        directUrl: candidates[0], alternates: candidates.slice(1),
        dwUrl: info.dwUrl, waitSeconds: info.waitSeconds || 0,
        sizeBytes: info.sizeBytes ?? null, mime: info.mime ?? null,
        verified: false,
        warning: 'Direct URL belum terverifikasi (server menolak range-check) — coba dipakai langsung.'
      };
    }

    return {
      short: info.short,
      name: info.name,
      filename: vinfo.filename || info.name,
      directUrl: chosen,
      alternates: candidates.filter(c => c !== chosen),
      dwUrl: info.dwUrl,
      waitSeconds: info.waitSeconds || 0,
      sizeBytes: vinfo.sizeBytes ?? info.sizeBytes ?? null,
      mime: (vinfo.mime || info.mime) ?? null,
      verified: true,
      shareableNote: 'Direct URL terverifikasi bisa diakses tanpa cookie/referer — aman dikirim ke user.'
    };
  }
}

// ---------------------------------------------------------------- parser internal

export function parseCards(html) {
  const out = [];
  CARD_RE.lastIndex = 0;
  let m;
  while ((m = CARD_RE.exec(html)) !== null) {
    const url = decodeEntities(m[1]).trim();
    const name = decodeEntities(m[2]).trim();
    const meta = decodeEntities(m[3]).trim();
    const short = extractShort(url);
    if (!short || !name) continue;
    const parts = meta.split(/[•·]/).map(s => s.trim()).filter(Boolean);
    const sizeLabel = parts.find(p => /[\d.,]+\s*(B|bytes|KB|MB|GB|TB)$/i.test(p)) || null;
    const uploadedLabel = parts.find(p => p !== sizeLabel) || null;
    out.push({
      short,
      url,
      name,
      ext: extOf(name),
      sizeLabel,
      sizeBytes: parseSizeToBytes(sizeLabel),
      uploadedLabel,
      uploadedAt: parseUploadedLabel(uploadedLabel)
    });
  }
  return out;
}

export function parseFilePage(html, short) {
  // --- JSON-LD (sumber utama, paling stabil) ---
  let media = null, crumbs = [];
  const ld = /<script\s+type="application\/ld\+json"\s*>([\s\S]*?)<\/script>/.exec(html);
  if (ld) {
    try {
      const arr = JSON.parse(ld[1]);
      media = arr.find(x => x && x['@type'] === 'MediaObject') || null;
      crumbs = (arr.find(x => x && x['@type'] === 'BreadcrumbList') || {}).itemListElement || [];
    } catch { /* fallback HTML di bawah */ }
  }

  const name = media?.name
    || decodeEntities((/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '').trim()
    || decodeEntities((/property="og:title"\s+content="([^"]*)"/.exec(html) || [])[1] || '').trim()
    || null;

  // --- fallback meta description: "Download X uploaded by Y on Z in folder W with size S." ---
  let metaUp = null, metaDate = null, metaFolder = null, metaSize = null;
  const md = /name="description"\s+content="([^"]*)"/.exec(html);
  if (md) {
    const mm = /uploaded by (.+?) on (.+?) in folder (.+?) with size ([^.]+)\./i.exec(decodeEntities(md[1]));
    if (mm) { [, metaUp, metaDate, metaFolder, metaSize] = mm; }
  }

  const sizeLabel = media?.contentSize || metaSize || null;
  const uploaderMatch = /href="(https?:\/\/[^"']*\/user\/(\d+))"/.exec(html);
  const cat = crumbs.length >= 2 && crumbs[1]
    ? { name: crumbs[1].name || null, url: crumbs[1].item || null }
    : (metaFolder ? { name: metaFolder, url: null } : null);

  const ext = extOf(name);
  return {
    short,
    url: fileUrlFromShort(short),
    name,
    nameClean: name ? name.replace(/\.[A-Za-z0-9]{1,8}$/, '') : null,
    ext,
    mime: media?.encodingFormat || null,
    sizeLabel,
    sizeBytes: parseSizeToBytes(sizeLabel),
    uploader: {
      name: media?.author?.name || metaUp || null,
      url: uploaderMatch?.[1] || null,
      id: uploaderMatch ? Number(uploaderMatch[2]) : null
    },
    category: cat,
    uploadedAt: media?.uploadDate || null,
    uploadedLabel: (/:\s*<span[^>]*>([^<]+)<\/span>/.exec(/Uploaded:[\s\S]{0,120}?/.exec(html)?.[0] || '') || [])[1]?.trim() || metaDate || null,
    downloads: parseCountLabel((/Downloads:\s*<span[^>]*>\s*([\d.,]+)/.exec(html) || [])[1]),
    description: media?.description || null,
    fileId: Number((/name="file_id"\s+value="(\d+)"/.exec(html) || [])[1]) || null,
    iconUrl: (/(?:class="h-8 w-8"\s+src|src)="(\/icon\/smallicon\/[^"]+)"/.exec(html) || [])[1]
      ? `${BASE}${/(?:class="h-8 w-8"\s+src|src)="(\/icon\/smallicon\/[^"]+)"/.exec(html)[1]}`
      : null,
    dwUrl: decodeEntities((/data-dw-url="([^"]+)"/.exec(html) || [])[1] || '') || null,
    waitSeconds: Number((/data-wait-seconds="(\d+)"/.exec(html) || [])[1] || 0) || null
  };
}

/** Kumpulin semua direct URL dari halaman wait (data-attr + string JS), unescape, unik */
export function extractDirectUrls(html) {
  const found = new Set();
  DIRECT_RE.lastIndex = 0;
  let m;
  while ((m = DIRECT_RE.exec(html)) !== null) {
    found.add(unescapeUrl(m[0]));
  }
  return [...found];
}

/** Urutin: downloadNNNN.sfile.co/downloadfile (CDN murni) → ada ?k= → sisany */
export function rankDirectUrls(urls) {
  return [...urls].sort((a, b) => scoreUrl(a) - scoreUrl(b));
}

function scoreUrl(u) {
  let s = 0;
  if (!/\/downloadfile\//.test(u)) s += 10;          // CDN subdomain paling bagus
  if (!/[?&]k=/.test(u)) s += 5;                      // k= token = direct asli
  if (!/\?/.test(u)) s += 3;                          // url&is= (smartlink wrap) — jelek
  return s;
}

// ════════════════════════════════════════════════════════════════════════════
// UPLOADER — upload guest (anonymous) ke sfile.co via protokol flow.js
//
// Terverifikasi live: POST multipart /upload/resume_v1_guest.php dengan field flow.js
// + des/file_hash/desired_name → respons JSON {status,share_url,file:{...}}.
// Pre-flight intent=check-hash (urlencoded, WAJIB md5 valid): 200 fresh / 409 duplicate /
// 403 banned / 400 kalau hash kosong (makanya hash kosong = skip pre-flight).
// ════════════════════════════════════════════════════════════════════════════

export class SfileUploader {
  constructor(opts = {}) {
    this.http = opts.http instanceof SfileHttp ? opts.http : new SfileHttp(opts);
    this.opts = {
      chunkSize: UPLOAD.chunkSize,
      maxUploadBytes: UPLOAD.maxUploadBytes,
      computeHash: true,
      hashMaxBytes: 128 * 1024 * 1024, // md5 pure-js masih cepat sampai ~128MB
      timeoutMs: 120000,
      retries: 3,
      ...opts
    };
  }

  /**
   * Upload file sebagai GUEST (anonymous).
   * @param {string|Buffer|Uint8Array|{path?:string,buffer?:Buffer}} source path file / buffer
   * @param {object} [opts]
   * @param {string} [opts.filename]    wajib kalau source Buffer
   * @param {string} [opts.description] deskripsi (max 550 char, opsional)
   * @param {function} [opts.onProgress] ({phase:'hash'|'check'|'upload', pct, chunk, totalChunks})
   * @returns {Promise<{duplicate:boolean,shareUrl:string,shareCode:string,fileId:number|null,
   *   name:string,sizeBytes:number,sizeLabel:string|null,hash:string,message:string|null}>}
   */
  async uploadFile(source, opts = {}) {
    // --- resolve sumber → { buffer, filename } ---
    let buffer, filename = opts.filename || null;
    if (typeof source === 'string') {
      try { buffer = await readFile(source); } catch (e) {
        throw new SfileError(`Gagal baca file "${source}": ${e.message}`, 'FILE_READ');
      }
      filename ||= basename(source);
    } else if (Buffer.isBuffer(source)) {
      buffer = source;
    } else if (source instanceof Uint8Array) {
      buffer = Buffer.from(source);
    } else if (source && typeof source === 'object' && Buffer.isBuffer(source.buffer)) {
      buffer = source.buffer;
      filename ||= source.path ? basename(source.path) : null;
    } else {
      throw new SfileError('Sumber upload harus path (string) atau Buffer', 'INVALID_INPUT');
    }
    if (!filename) {
      throw new SfileError('filename wajib diberikan kalau upload dari Buffer', 'INVALID_INPUT');
    }

    // --- validasi ekstensi (mp4/video emang ditolak sfile) ---
    const ext = extOf(filename);
    if (!ext || !isAllowedExtension(filename, UPLOAD.allowedExtensions)) {
      throw new SfileError(
        `Ekstensi ".${ext || '(tanpa ekstensi)'}" tidak diizinkan sfile.co (mp4/video memang dilarang). ` +
        `Yang lolos: zip, rar, 7z, apk, pdf, txt, json, dll — total ${UPLOAD.allowedExtensions.length} tipe.`,
        'INVALID_TYPE', { ext, allowed: UPLOAD.allowedExtensions }
      );
    }
    if (buffer.length === 0) {
      throw new SfileError('File kosong (0 byte) tidak bisa diupload', 'INVALID_INPUT');
    }
    if (buffer.length > this.opts.maxUploadBytes) {
      throw new SfileError(
        `Ukuran ${(buffer.length / 1048576).toFixed(2)} MB melebihi batas upload sfile (${UPLOAD.maxUploadLabel})`,
        'TOO_LARGE', { sizeBytes: buffer.length }
      );
    }

    const description = String(opts.description || '').trim().slice(0, UPLOAD.maxDescriptionLength);

    // --- cek kata terlarang duluan (hemat upload sia-sia) ---
    const banned = findBannedWord(filename, description);
    if (banned) {
      throw new SfileError(
        `Kata "${banned}" diblokir sfile.co (ada di nama file / deskripsi) — upload pasti ditolak server`,
        'UPLOAD_BLOCKED', { word: banned }
      );
    }

    // --- md5 (pre-flight check-hash + dedup server) ---
    let hash = '';
    if (this.opts.computeHash && buffer.length <= this.opts.hashMaxBytes) {
      hash = md5hex(buffer);
      if (typeof opts.onProgress === 'function') opts.onProgress({ phase: 'hash', pct: 100 });
    }

    // pastiin ada session cookie (mirror alur browser: buka homepage dulu)
    if (!this.http.jar.header()) {
      await this.http.page(`${BASE}/`, { referer: `${BASE}/` });
    }

    // --- pre-flight check-hash (hanya kalau ada hash valid) ---
    let desiredName = filename;
    if (hash) {
      const check = await this._checkHash(hash, filename);
      if (typeof opts.onProgress === 'function') opts.onProgress({ phase: 'check', pct: 100 });
      if (check.duplicate) {
        return {
          duplicate: true,
          shareUrl: check.shareUrl,
          shareCode: check.shareUrl ? check.shareUrl.split('/').pop() : null,
          fileId: check.fileId ?? null,
          name: check.fileName || filename,
          sizeBytes: buffer.length,
          sizeLabel: null,
          hash,
          message: check.message || 'File ini udah pernah diupload — link lama dikembalikan.'
        };
      }
      if (check.blocked) {
        throw new SfileError(check.message || 'Upload ditolak sfile.co (403)', 'UPLOAD_BLOCKED', { reason: check.reason });
      }
      if (check.fileName) desiredName = check.fileName;
    }

    // --- chunked upload ala flow.js (multipart dibangun manual — zero-deps) ---
    const chunkSize = this.opts.chunkSize;
    const totalChunks = Math.max(1, Math.ceil(buffer.length / chunkSize));
    const identifier = `${buffer.length}-${desiredName}`;
    let finalPayload = null;
    let lastText = '';

    for (let n = 1; n <= totalChunks; n++) {
      const start = (n - 1) * chunkSize;
      const end = Math.min(n * chunkSize, buffer.length);
      const chunk = buffer.subarray(start, end);

      const fields = {
        flowChunkNumber: String(n),
        flowChunkSize: String(chunkSize),
        flowCurrentChunkSize: String(end - start),
        flowTotalSize: String(buffer.length),
        flowIdentifier: identifier,
        flowFilename: filename,
        flowRelativePath: filename,
        flowTotalChunks: String(totalChunks),
        des: description,
        file_hash: hash,
        desired_name: desiredName
      };

      const { buffer: body, contentType } = buildMultipart(fields, 'file', chunk, filename);
      const r = await this.http.page(`${BASE}${UPLOAD.endpoint}`, {
        method: 'POST',
        body,
        contentType,
        referer: `${BASE}/`,
        headers: { accept: 'application/json, text/plain, */*' },
        timeoutMs: this.opts.timeoutMs
      });
      lastText = r.html;
      const json = tryParseJson(r.html);

      if (r.status >= 400 && !json) {
        throw new SfileError(`Upload chunk ${n}/${totalChunks} gagal: HTTP ${r.status}`, 'UPLOAD_FAILED', { chunk: n, status: r.status });
      }
      if (json && json.status === 'error') {
        throw new SfileError(json.message || 'Upload ditolak server', 'UPLOAD_FAILED', { reason: json.reason, chunk: n });
      }
      if (json && json.share_url) finalPayload = json;

      if (typeof opts.onProgress === 'function') {
        opts.onProgress({
          phase: 'upload',
          pct: Math.round((n / totalChunks) * 1000) / 10,
          chunk: n, totalChunks, received: end, total: buffer.length
        });
      }
    }

    if (!finalPayload || !finalPayload.share_url) {
      throw new SfileError(
        'Upload selesai tapi server tidak mengembalikan share_url (respons tidak dikenali)',
        'UPLOAD_FAILED', { lastResponse: lastText.slice(0, 200) }
      );
    }

    return {
      duplicate: false,
      shareUrl: finalPayload.share_url,
      shareCode: finalPayload.share_code || finalPayload.share_url.split('/').pop(),
      fileId: finalPayload.file?.id ?? null,
      name: finalPayload.file?.name || filename,
      sizeBytes: finalPayload.file?.size_bytes ?? buffer.length,
      sizeLabel: finalPayload.file?.size_label ?? null,
      hash: finalPayload.file?.hash || hash,
      message: finalPayload.message || null
    };
  }

  async _checkHash(hash, filename) {
    const body = `intent=check-hash&file_hash=${encodeURIComponent(hash)}&file_name=${encodeURIComponent(filename)}`;
    const r = await this.http.page(`${BASE}${UPLOAD.endpoint}`, {
      method: 'POST',
      body,
      contentType: 'application/x-www-form-urlencoded',
      referer: `${BASE}/`
    });
    const j = tryParseJson(r.html);
    if (r.status === 409) {
      const short = j?.file_short || null;
      return {
        duplicate: true,
        shareUrl: short ? `${BASE}/${short}` : null,
        message: j?.message || 'File sudah pernah diupload.',
        fileId: j?.file_id ?? null,
        fileName: j?.file_name || null
      };
    }
    if (r.status === 403) {
      return { blocked: true, message: j?.message || 'Upload ditolak (403).', reason: j?.reason || 'blocked' };
    }
    if (r.status === 200 && j) {
      if (j.status === 'error') return { blocked: true, message: j.message, reason: j.reason || 'error' };
      if (j.status === 'success') return { fileName: j.file_name || null };
    }
    return {}; // ambigu → lanjut upload aja
  }
}

/** Bangun multipart/form-data manual (pengganti FormData — zero-deps, jalan di HTTP/2 layer). */
export function buildMultipart(fields, fileField, fileBuffer, filename) {
  const boundary = '----sfilewa' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    'utf8'
  ));
  parts.push(Buffer.from(fileBuffer));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  return {
    buffer: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function tryParseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// ════════════════════════════════════════════════════════════════════════════
// DOWNLOADER — streaming download dari direct URL sfile + progress
// (jalan di atas SfileHttp HTTP/2 — bukan fetch)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Download penuh dari direct URL → Buffer.
 * @param {string} url direct URL hasil getDownloadUrl()
 * @param {object} opts
 * @param {SfileHttp} opts.http instance SfileHttp (WAJIB — bawa cookie session)
 * @param {string} [opts.referer] referer (dwUrl) — server makin senang
 * @param {function} [opts.onProgress] ({pct, received, total}) => void
 * @param {number} [opts.timeoutMs=30000]     timeout header response
 * @param {number} [opts.idleTimeoutMs=30000] timeout tanpa data
 * @param {number} [opts.maxBytes=314572800]  batas ukuran (default 300 MB; sfile max 250 MB)
 * @returns {Promise<{buffer:Buffer,filename:string|null,mime:string,sizeBytes:number,url:string}>}
 */
export async function downloadFromUrl(url, opts = {}) {
  const {
    http, referer, onProgress,
    timeoutMs = 30000, idleTimeoutMs = 30000,
    maxBytes = 300 * 1024 * 1024
  } = opts;

  if (!http) throw new SfileError('downloadFromUrl butuh opts.http (instance SfileHttp)', 'INVALID_INPUT');

  const res = await http.request(url, {
    method: 'GET',
    headers: { accept: '*/*', ...(referer ? { referer } : {}) },
    timeoutMs,
    idleTimeoutMs,
    maxBytes,
    onChunk: (_chunk, received, total) => {
      if (typeof onProgress === 'function') {
        onProgress({
          pct: total ? Math.round((received / total) * 1000) / 10 : null,
          received, total
        });
      }
    }
  });

  if (res.status < 200 || res.status >= 300) {
    throw new SfileError(`Download gagal: HTTP ${res.status}`, 'DOWNLOAD_FAILED', { url, status: res.status });
  }

  const mime = String(res.headers['content-type'] || '').split(';')[0].trim() || 'application/octet-stream';
  const { filename } = parseContentDisposition(res.headers['content-disposition']);
  return {
    buffer: res.body,
    filename,
    mime,
    sizeBytes: res.body.length,
    url: res.finalUrl
  };
}

// ════════════════════════════════════════════════════════════════════════════
// INDEX — facade sfile-wa
// ════════════════════════════════════════════════════════════════════════════

export class Sfile {
  /**
   * @param {object} [opts]
   * @param {number} [opts.throttleMs]  jeda antar request (default 350ms)
   * @param {number} [opts.timeoutMs]   timeout request (default 20s)
   * @param {number} [opts.retries]     retry network/5xx (default 2)
   * @param {boolean} [opts.computeHash] hitung md5 utk upload (default true)
   */
  constructor(opts = {}) {
    this.http = new SfileHttp(opts);
    this.scraper = new SfileScraper({ http: this.http });
    this.uploader = new SfileUploader({ http: this.http, ...opts });
  }

  /**
   * Search file sfile.co.
   * @param {string} query
   * @param {object} [opts] { pages=1 } | { max } | { all:true, maxPages } | { startPage }
   * @returns {Promise<{query,results,count,pages,pagesFetched,pageSize,totalFake,hasMore,capped,note}>}
   *   results[i] = { short,url,name,ext,sizeLabel,sizeBytes,uploadedLabel,uploadedAt }
   */
  search(query, opts) { return this.scraper.search(query, opts); }

  /** Satu halaman search (20 hasil). */
  searchPage(query, page = 1) { return this.scraper.searchPage(query, page); }

  /**
   * Metadata file: nama, mime, ukuran, uploader, kategori, tanggal, jumlah download, dll.
   * @param {string|object} input URL / short / object {url|short}
   */
  getFile(input) { return this.scraper.getFile(input); }

  /**
   * DIRECT download URL tanpa nunggu timer sfile.
   * @param {string|object} input URL / short / object hasil search|getFile
   * @param {object} [opts] { verify=true }
   * @returns {Promise<{short,name,filename,directUrl,alternates,dwUrl,waitSeconds,sizeBytes,mime,verified}>}
   */
  getDownloadUrl(input, opts) { return this.scraper.getDownloadUrl(input, opts); }

  /**
   * Download file → Buffer.
   * @param {string|object} input URL / short / object hasil search|getFile|getDownloadUrl
   * @param {object} [opts] { onProgress, maxBytes, timeoutMs }
   * @returns {Promise<{buffer:Buffer,filename:string,mime:string,sizeBytes:number,url:string}>}
   */
  async downloadFile(input, opts = {}) {
    let directUrl, referer, fallbackName;
    if (typeof input === 'object' && typeof input.directUrl === 'string') {
      directUrl = input.directUrl;
      referer = input.dwUrl || null;
      fallbackName = input.filename || input.name || null;
    } else {
      const dl = await this.getDownloadUrl(input, { verify: true });
      directUrl = dl.directUrl;
      referer = dl.dwUrl;
      fallbackName = dl.filename || dl.name || null;
    }
    const out = await downloadFromUrl(directUrl, {
      http: this.http,
      referer,
      onProgress: opts.onProgress,
      maxBytes: opts.maxBytes,
      timeoutMs: opts.timeoutMs
    });
    if (!out.filename) out.filename = fallbackName || 'sfile-download.bin';
    return out;
  }

  /**
   * Upload guest (anonymous). Ekstensi mp4/video ditolak sfile — error jelas.
   * @param {string|Buffer|{path?:string,buffer?:Buffer}} source
   * @param {object} [opts] { filename, description, onProgress }
   * @returns {Promise<{duplicate,shareUrl,shareCode,fileId,name,sizeBytes,sizeLabel,hash,message}>}
   */
  uploadFile(source, opts) { return this.uploader.uploadFile(source, opts); }
}

/** Instance default siap pakai. */
export const sfile = new Sfile();

export default sfile;
