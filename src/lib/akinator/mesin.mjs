/**
 * mesin.mjs - Mesin Akinator (port dari akinator.mjs v3.0.0, scraper
 * akinator.com tanpa browser, murni curl).
 *
 * Yang dipertahanin dari modul asli (logika udah teruji):
 *  - protokol situs baru Okt 2026: POST /game, /answer, /exclude,
 *    /choice, /cancel_answer, /soundlike, /soundlike_list, /list_vote,
 *    TANPA parameter signature (dihapus situs).
 *  - retry KO (completion=KO = transient load-balancer, aman retry),
 *    deteksi challenge Cloudflare (ukuran body + penanda), primer
 *    cookie per 10 menit, auto-resume (sesi mati = game baru + replay
 *    jawaban), auto-heal step loncat (jawaban dobel).
 *  - mesin ekspresi genie (Akitude) persis situs: moodStack +
 *    WAITING_TABLE + trouvitudesReponses.
 *
 * Yang dibuang (gak dipakai di web): proxy pool, bot WhatsApp, CLI,
 * download gambar ekspresi (UI nyari sendiri), saveState/loadState.
 *
 * Dipanggil dari server Next.js aja (route /api/akinator) - pake
 * node:child_process (curl), jangan diimpor ke komponen client.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bacaTimeout, bacaMaksRetry } from './strategi.mjs';
import * as pwTransport from './playwright.mjs';

const execFileP = promisify(execFile);

export const MODULE_VERSION = '3.0.1-web';

const DEFAULT_UA =
  process.env.AKINATOR_UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

export const LOCALES = [
  'ar', 'cn', 'de', 'en', 'es', 'fr', 'id', 'il', 'it', 'jp',
  'kr', 'nl', 'pl', 'pt', 'ru', 'tr', 'vi', 'fa',
];

export const ANSWER_LABELS = {
  id: ['Iya', 'Tidak', 'Tidak tahu', 'Mungkin', 'Mungkin tidak'],
  en: ['Yes', 'No', "Don't know", 'Probably', 'Probably not'],
};

export function answerLabels(locale = 'id') {
  return ANSWER_LABELS[locale] || ANSWER_LABELS.id;
}

export class AkinatorError extends Error {
  constructor(message, code = 'ERROR', detail = null) {
    super(message);
    this.name = 'AkinatorError';
    this.code = code;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbg = (...a) => { if (process.env.AKINATOR_DEBUG) console.error('[akinator]', ...a); };

// ==================== KO / RESUME / LIMITS ====================
// KO = server gak kenal sesi (routing LB) - transient, aman di-retry.
const KO_RETRY_DELAYS = [600, 1400, 2600];
const RESUMABLE_CODES = new Set(['KO', 'SESSION_EXPIRED', 'EMPTY_RESPONSE']);
const RESUME_MIN_GAP_MS = 15_000;   // jeda minimal antar auto-resume
const RESUME_MAX_HISTORY = 80;      // riwayat sepanjang ini masih di-replay

// ==================== COOLDOWN CHALLENGE CF ====================
const CHALLENGE_COOLDOWN_MS = Math.max(
  30_000,
  Number(process.env.AKINATOR_CHALLENGE_COOLDOWN_MS) || 180_000
);
const _challengeUntil = new Map(); // "proxy@host" -> epoch ms

function _hostOf(state) {
  try { return new URL(state.baseUrl).host; } catch { return state.locale || '?'; }
}
function _cdKey(state) {
  const ident = state.proxy || (state.transport === 'playwright' ? 'playwright' : 'direct');
  return `${ident}@${_hostOf(state)}`;
}
function _markChallenge(state) {
  _challengeUntil.set(_cdKey(state), Date.now() + CHALLENGE_COOLDOWN_MS);
}

/** Sisa cooldown challenge (ms). 0 = bebas. */
export function challengeCooldown(state) {
  if (!state) return 0;
  const until = _challengeUntil.get(_cdKey(state)) || 0;
  return Math.max(0, until - Date.now());
}

// ==================== LAPISAN JARINGAN ====================

const NET_RETRY_CODES = new Set([6, 7, 16, 18, 28, 35, 52, 55, 56]);
// Mode aman utk POST mutasi: hanya retry bila gagal SEBELUM request terkirim.
const SAFE_RETRY_CODES = new Set([6, 7, 35]);
// Status HTTP sementara yang layak diretry (read-only).
const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504, 521, 522, 523, 524]);

// Penanda halaman challenge Cloudflare. Halaman asli >= 40 KB,
// challenge CF ~3-8 KB. 'challenge-platform' TIDAK dipakai (beacon CF
// juga ada di halaman normal Akinator).
const CF_STRONG = ['just a moment', '__cf_chl', 'cf_chl_', 'cf-error-details', 'attention required'];
const CF_WEAK = ['enable javascript', 'checking your browser', 'ddos protection'];

function isChallengeBody(body) {
  if (!body || body.length > 20000) return false;
  const low = body.toLowerCase();
  if (CF_STRONG.some((m) => low.includes(m))) return true;
  let weak = 0;
  for (const m of CF_WEAK) if (low.includes(m)) weak++;
  return weak >= 2;
}

function curlBaseArgs({ ua = DEFAULT_UA, proxy } = {}) {
  const args = [
    '-sS',
    '--max-time', String(bacaTimeout()),
    '--connect-timeout', String(Math.min(15, bacaTimeout())),
    '--compressed',
    '--http1.1', // HTTP/2 sering reset stream di tengah - paksa HTTP/1.1
    '-A', ua,
    '-H', 'Accept-Language: id-ID,id;q=0.9,en;q=0.8',
  ];
  // Client-hints ala Chrome - fingerprint header konsisten dengan UA.
  if (/Chrome\/\d+/.test(ua)) {
    const v = (ua.match(/Chrome\/(\d+)/) || [])[1] || '152';
    args.push(
      '-H', `sec-ch-ua: "Chromium";v="${v}", "Not_A Brand";v="24", "Google Chrome";v="${v}"`,
      '-H', 'sec-ch-ua-mobile: ?0',
      '-H', 'sec-ch-ua-platform: "Windows"',
    );
  }
  if (proxy) args.push('--proxy', proxy);
  return args;
}

async function curlOnce(args) {
  const args2 = [...args, '-w', '\n__AKI_HTTP__%{http_code}'];
  try {
    const { stdout } = await execFileP('curl', args2, { maxBuffer: 32 * 1024 * 1024 });
    const m = stdout.match(/\n__AKI_HTTP__(\d{3})\s*$/);
    const status = m ? Number(m[1]) : 0;
    const body = m ? stdout.slice(0, m.index) : stdout;
    return { status, body };
  } catch (e) {
    const first = (s) => String(s || '').split('\n')[0].trim();
    const err = new AkinatorError(
      `curl gagal (exit ${e.code ?? '?'})${e.stderr ? ': ' + first(e.stderr) : ': ' + first(e.message)}`,
      'CURL_FAIL', e.code
    );
    err.curlCode = Number(e.code);
    throw err;
  }
}

async function curlRetry(args, { label = 'request', mode = 'aggressive', allowEmpty = false } = {}) {
  const codes = mode === 'safe' ? SAFE_RETRY_CODES : NET_RETRY_CODES;
  const attempts = mode === 'safe' ? 2 : bacaMaksRetry();
  const delays = mode === 'safe' ? [900] : [700, 1800];
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delays[Math.min(i - 1, delays.length - 1)]);
    let res;
    try {
      res = await curlOnce(args);
    } catch (e) {
      lastErr = e;
      if (codes.has(Number(e.curlCode))) {
        dbg(`${label}: curl exit ${e.curlCode}, retry ${i + 1}/${attempts - 1}`);
        continue;
      }
      throw e;
    }
    const { status, body } = res;
    if (mode === 'aggressive') {
      if (!allowEmpty && !body.trim()) {
        lastErr = new AkinatorError(`Respons kosong dari ${label} (HTTP ${status})`, 'EMPTY_RESPONSE');
        dbg(`${label}: kosong, retry ${i + 1}/${attempts - 1}`);
        continue;
      }
      if (TRANSIENT_HTTP.has(status)) {
        lastErr = new AkinatorError(`HTTP ${status} (sementara) dari ${label}`, 'HTTP_TRANSIENT', status);
        dbg(`${label}: HTTP ${status}, retry ${i + 1}/${attempts - 1}`);
        continue;
      }
    }
    return res;
  }
  throw lastErr || new AkinatorError(`Gagal berulang kali: ${label}`, 'RETRY_EXHAUSTED');
}

function jarPath(state) {
  return path.join(state._jarDir || DEFAULT_JAR_DIR(), `akinator-${state.gameId}.jar`);
}

function DEFAULT_JAR_DIR() {
  return process.env.AKINATOR_JAR_DIR || path.join(process.cwd(), 'data', 'akinator');
}

// ==================== PRIMER COOKIE (cache warm-up) ====================
// GET / (warm-up) cukup SEKALI per (proxy, host) per 10 menit.
const PRIMER_TTL_MS = 10 * 60_000;

function _primerKey(state) { return _cdKey(state); }
function _primerPath(state) {
  const dir = state._jarDir || DEFAULT_JAR_DIR();
  const h = createHash('md5').update(_primerKey(state)).digest('hex').slice(0, 12);
  return path.join(dir, `akinator-primer-${h}.jar`);
}

async function _getPrimerCookies(state) {
  try {
    const f = _primerPath(state);
    const st = await stat(f);
    if (Date.now() - st.mtimeMs > PRIMER_TTL_MS) return null;
    const c = await readFile(f, 'utf8');
    return c.trim() ? c : null;
  } catch { return null; }
}

async function _savePrimer(state) {
  try {
    if (!state.cookies || !state.cookies.trim()) return;
    const f = _primerPath(state);
    await mkdir(path.dirname(f), { recursive: true });
    const tmp = `${f}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    await writeFile(tmp, state.cookies, 'utf8');
    await rename(tmp, f);
  } catch { /* best effort */ }
}

// Best-effort refresh cookie dengan GET halaman depan.
async function reprime(state) {
  try {
    const jar = jarPath(state);
    const base = state.baseUrl || `https://${state.locale}.akinator.com`;
    const args = [
      ...curlBaseArgs({ proxy: state.proxy }),
      '-b', jar, '-c', jar, '-L',
      '-H', 'Accept: text/html,application/xhtml+xml,*/*;q=0.8',
      '-H', 'Sec-Fetch-Dest: document', '-H', 'Sec-Fetch-Mode: navigate', '-H', 'Sec-Fetch-Site: none',
      '-e', `${base}/theme-selection`,
      `${base}/`,
    ];
    await curlOnce(args);
    try { state.cookies = await readFile(jar, 'utf8'); } catch { }
    await _savePrimer(state);
  } catch { /* best effort */ }
}

/**
 * Satu request HTTP ke server Akinator dengan seluruh lapisan
 * ketahanan: retry transport + deteksi challenge + re-prime cookie.
 * Transport playwright (browser) nyala kalau state.transport ny
 * 'playwright' — diputuskan ruangan.ts dari strategi (direct →
 * proxy → playwright), SEMUA request game ituikut lewat browser.
 */
async function request(state, {
  method = 'POST',
  urlPath,
  form = '',
  xhr = true,
  referer = null,
  raw = false,
  allowEmpty = false,
  mutating = false,
  noCooldownMark = false,
  label = null,
} = {}) {
  if (state.transport === 'playwright') {
    return pwRequest(state, { method, urlPath, form, xhr, referer, allowEmpty, mutating, label });
  }
  const base = state.baseUrl || `https://${state.locale}.akinator.com`;
  const url = base + urlPath;
  label = label || `${method} ${urlPath}`;
  const jar = jarPath(state);
  const attempts = mutating ? 2 : 3; // mutasi: maksimal 2x kirim
  const retryDelay = [4000, 10000];
  let lastErr = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelay[Math.min(attempt - 1, retryDelay.length - 1)]);
      await reprime(state);
    }
    if (state.cookies) {
      try { await writeFile(jar, state.cookies, 'utf8'); } catch { }
    }

    const args = [
      ...curlBaseArgs({ proxy: state.proxy }),
      '-b', jar, '-c', jar,
    ];
    if (method === 'POST') {
      args.push(
        '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
        '-H', `Origin: ${base}`,
      );
    } else {
      args.push(
        '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        '-L',
      );
    }
    if (xhr) {
      args.push(
        '-H', 'X-Requested-With: XMLHttpRequest',
        '-H', 'Accept: application/json, text/javascript, */*; q=0.01',
        '-H', 'Sec-Fetch-Dest: empty', '-H', 'Sec-Fetch-Mode: cors', '-H', 'Sec-Fetch-Site: same-origin',
      );
    } else {
      args.push(
        '-H', 'Sec-Fetch-Dest: document', '-H', 'Sec-Fetch-Mode: navigate', '-H', 'Sec-Fetch-Site: same-origin',
      );
    }
    args.push('-e', referer || `${base}/game`);
    if (method === 'POST') args.push('-X', 'POST', '--data', form);
    args.push(url);

    let res;
    res = await curlRetry(args, { label, mode: mutating ? 'safe' : 'aggressive', allowEmpty });
    const { status, body } = res;
    try { state.cookies = await readFile(jar, 'utf8'); } catch { }

    const challenge = isChallengeBody(body) || status === 403 || status === 503;
    if (challenge) {
      if (attempt < attempts - 1) {
        dbg(`${label}: challenge (HTTP ${status}), tunggu lalu coba sekali lagi...`);
        lastErr = new AkinatorError(`Diblokir proteksi server saat ${label}`, 'CHALLENGE', status);
        continue;
      }
      if (!noCooldownMark) _markChallenge(state);
      const retryAfterMs = noCooldownMark ? 0 : challengeCooldown(state);
      throw new AkinatorError(
        `Diblokir proteksi server (Cloudflare) saat ${label}. Ini cooldown sementara - ` +
        `request berulang hanya memperpanjang blokir. Coba lagi dalam ~${Math.ceil(retryAfterMs / 1000)} detik.`,
        'CHALLENGE', { status, retryAfterMs }
      );
    }

    if (mutating && TRANSIENT_HTTP.has(status) && attempt < attempts - 1) {
      dbg(`${label}: HTTP ${status} pada POST mutasi, coba sekali lagi...`);
      lastErr = new AkinatorError(`HTTP ${status} dari ${label}`, 'HTTP_TRANSIENT', status);
      continue;
    }

    if (!body.trim() && !allowEmpty) {
      if (attempt < attempts - 1) {
        dbg(`${label}: respons kosong (HTTP ${status}), coba lagi...`);
        lastErr = new AkinatorError('Server membalas kosong', 'EMPTY_RESPONSE');
        continue;
      }
      const hint = urlPath === '/answer'
        ? ' Catatan: jawaban mungkin tetap terkirim - coba kirim jawaban yang sama sekali lagi; jika pertanyaan terasa melompat, jalankan undoAnswer.'
        : '';
      throw new AkinatorError(
        `Server membalas kosong saat ${label} - kemungkinan sesi kedaluwarsa atau server sibuk. Mulai game baru.${hint}`,
        'EMPTY_RESPONSE'
      );
    }

    return { body, status };
  }
  throw lastErr || new AkinatorError(`Gagal ${label}`, 'RETRY_EXHAUSTED');
}

/* Request lewat browser (fallback Cloudflare, r24). Cookie ny dipegang
 * context browser (bukan file jar), jadi semua logika jar dilewati.
 * Challenge = goto ulang halaman depan (browser ngeresain JS
 * challenge ny sendiri, gak ada bypass aneh-aneh). */
async function pwRequest(state, {
  method = 'POST',
  urlPath,
  form = '',
  xhr = true,
  referer = null,
  allowEmpty = false,
  mutating = false,
  label = null,
} = {}) {
  const base = state.baseUrl || `https://${state.locale}.akinator.com`;
  const url = base + urlPath;
  const label2 = label || `${method} ${urlPath}`;
  const attempts = mutating ? 2 : bacaMaksRetry();
  const retryDelay = [4000, 10000];
  let lastErr = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelay[Math.min(attempt - 1, retryDelay.length - 1)]);
      await pwTransport.primeUlang(state).catch(() => {});
    }
    await pwTransport.pastiSesi(state);

    let res;
    try {
      res = await pwTransport.minta(state, { url, method, form, xhr: xhr !== false, referer });
    } catch (e) {
      lastErr = e;
      dbg(`${label2}: transport browser gagal (${e.message})`);
      if (attempt < attempts - 1) continue;
      throw new AkinatorError(
        `Transport browser gagal saat ${label2}: ${e.message}`,
        'PW_FAIL', String(e?.message || '').slice(0, 200)
      );
    }
    const { status, body } = res;

    const challenge = isChallengeBody(body) || status === 403 || status === 503;
    if (challenge) {
      if (attempt < attempts - 1) {
        dbg(`${label2}: challenge (HTTP ${status}) via browser, prime ulang lalu coba lagi...`);
        lastErr = new AkinatorError(`Diblokir proteksi server saat ${label2}`, 'CHALLENGE', status);
        continue;
      }
      if (!state._pwNoCooldown) _markChallenge(state);
      const retryAfterMs = state._pwNoCooldown ? 0 : challengeCooldown(state);
      throw new AkinatorError(
        `Diblokir proteksi server (Cloudflare) saat ${label2}. Coba lagi dalam ~${Math.ceil(retryAfterMs / 1000)} detik.`,
        'CHALLENGE', { status, retryAfterMs }
      );
    }

    if (!body.trim() && !allowEmpty) {
      if (attempt < attempts - 1) {
        dbg(`${label2}: respons kosong (HTTP ${status}) via browser, coba lagi...`);
        lastErr = new AkinatorError('Server membalas kosong', 'EMPTY_RESPONSE');
        continue;
      }
      throw new AkinatorError(
        `Server membalas kosong saat ${label2} - kemungkinan sesi kedaluwarsa atau server sibuk. Mulai game baru.`,
        'EMPTY_RESPONSE'
      );
    }

    return { body, status };
  }
  throw lastErr || new AkinatorError(`Gagal ${label2}`, 'RETRY_EXHAUSTED');
}

/**
 * POST JSON + retry KO. completion=KO itu SEBAGIAN BESAR TRANSIENT
 * (load-balancer) - retry request sama persis langsung OK, dan AMAN
 * karena KO = request tidak diproses server.
 */
async function postJson(state, reqOpts, { koRetries = null } = {}) {
  const maxKo = koRetries ?? state.koRetries ?? 3;
  const label = reqOpts.label || 'POST';
  let lastKo = null;
  for (let i = 0; i <= maxKo; i++) {
    if (i > 0) await sleep(KO_RETRY_DELAYS[Math.min(i - 1, KO_RETRY_DELAYS.length - 1)]);
    const { body: raw } = await request(state, reqOpts);
    let d;
    try {
      d = JSON.parse(raw);
    } catch {
      throw new AkinatorError(
        `Balasan ${label} bukan JSON - sesi kemungkinan mati.`,
        'SESSION_EXPIRED', String(raw).slice(0, 120)
      );
    }
    if (d && d.completion === 'KO') {
      lastKo = d;
      dbg(`${label}: completion KO (percobaan ${i + 1}/${maxKo + 1}) - transient, retry...`);
      continue;
    }
    return d;
  }
  throw new AkinatorError(`Server berkali-kali membalas KO saat ${label}.`, 'KO', lastKo);
}

// ============================ LOCKING ============================
// Mutex per-game: request dalam satu game selalu serial.
const _locks = new Map();
function withLock(key, fn) {
  const prev = _locks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  _locks.set(key, run.catch(() => { }));
  return run;
}

// ============================ PARSER ============================

const enc = encodeURIComponent;
const formEncode = (obj) =>
  Object.entries(obj).map(([k, v]) => `${k}=${enc(String(v ?? ''))}`).join('&');

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// ==================== MESIN EKSPRESI GENIE ("Akitude") ====================
// Replika mesin ekspresi resmi akinator.com (animation-v2.js, Okt 2026).
// Situs pake Lottie, fallback PNG statis 670x1096:
//   /assets/img/akitudes_670x1096/{akitude}.png

/** URL gambar ekspresi genie (PNG statis, 670x1096). */
export function expressionImageUrl(akitude, { locale = 'id' } = {}) {
  return `https://${locale}.akinator.com/assets/img/akitudes_670x1096/${akitude}.png`;
}

/** Label mood genie (bahasa Indonesia). */
export const MOOD_LABELS = {
  'confiant': 'Yakin banget',
  'serein+': 'Tenang',
  'serein-': 'Cukup tenang',
  'inquiet+': 'Mulai cemas',
  'inquiet-': 'Pusing berat',
};

/** Label ekspresi/akitude (bahasa Indonesia). */
export const AKITUDE_LABELS = {
  mobile: 'Mantap',
  serein_1: 'Santai',
  serein_2: 'Santai banget',
  inquiet: 'Cemas',
  espoir_anxieux: 'Berharap gelisah',
  confiant: 'Percaya diri',
  surprise: 'Kaget',
  concentration: 'Konsentrasi',
  concentration_intense: 'Konsentrasi penuh',
  inspiration_legere: 'Dapat ide',
  inspiration_forte: 'Terinspirasi',
  leger_decouragement: 'Agak kecewa',
  decouragement: 'Kecewa berat',
  espiegle: 'Jail',
  deception: 'Tertipu',
  felicitations: 'Memberi selamat',
  triomphe: 'Berpose kemenangan',
  merci: 'Berterima kasih',
};

/** Daftar semua nama akitude (utk pre-download asset). */
export const AKITUDE_NAMES = Object.keys(AKITUDE_LABELS);

/** Mood berikutnya dari (trouvitude, step). trouvitude = perkiraan
 *  progression berikutnya kalau jawaban itu dipilih. */
function _thinkingMood(trouvitude, step) {
  const s = Number(step) || 0;
  const t = Number(trouvitude) || 0;
  if (s <= 30) {
    if (t >= 50 + s * 1.4) return 'confiant';
    if (t >= 15 + s * 2.3) return 'serein+';
    if (t >= -15 + s * 3) return 'serein-';
    if (t >= -25 + s * 2.5) return 'inquiet+';
    return 'inquiet-';
  }
  if (t >= 90) return 'confiant';
  if (t >= 85) return 'serein+';
  if (t >= 75) return 'serein-';
  if (t >= 50) return 'inquiet+';
  return 'inquiet-';
}

/** determineWaitingNoAnim: akitude menunggu dari transisi mood (lama:baru). */
const WAITING_TABLE = {
  'confiant:confiant': 'mobile',
  'confiant:serein+': 'surprise',
  'confiant:serein-': 'surprise',
  'confiant:inquiet+': 'surprise',
  'confiant:inquiet-': 'surprise',
  'serein+:serein+': 'serein_1',
  'serein+:serein-': 'concentration',
  'serein-:serein-': 'serein_2',
  'serein-:serein+': 'inspiration_legere',
  'serein+:inquiet+': 'surprise',
  'serein+:inquiet-': 'surprise',
  'serein-:inquiet+': 'concentration',
  'serein-:inquiet-': 'surprise',
  'inquiet+:serein+': 'inspiration_forte',
  'inquiet+:serein-': 'concentration',
  'inquiet-:serein+': 'inspiration_forte',
  'inquiet-:serein-': 'inspiration_forte',
  'inquiet+:inquiet+': 'inquiet',
  'inquiet+:inquiet-': 'leger_decouragement',
  'inquiet-:inquiet+': 'concentration_intense',
  'inquiet-:inquiet-': 'decouragement',
  'serein+:confiant': 'inspiration_forte',
  'serein-:confiant': 'inspiration_forte',
  'inquiet+:confiant': 'inspiration_forte',
  'inquiet-:confiant': 'inspiration_forte',
};

function _advanceExpression(state, trouvitude, stepAtAnswer, progressionOld) {
  const mood = _thinkingMood(trouvitude, stepAtAnswer);
  const prevMood = state.moodStack[state.moodStack.length - 1] || 'serein+';
  let akitude = WAITING_TABLE[`${prevMood}:${mood}`] || 'serein_2';
  // Aturan khusus situs (no-anim): masih inquiet- dan trouvitude melesat
  // >= 10 poin dari progression lama -> tampil "inquiet".
  if (
    Number(trouvitude) - Number(progressionOld) >= 10 &&
    prevMood === 'inquiet-' && mood === 'inquiet-'
  ) {
    akitude = 'inquiet';
  }
  // Jangan mengulang akitude serein yang sama dua kali berturut-turut.
  const last = state.akitudeStack[state.akitudeStack.length - 1] || 'serein_2';
  if (akitude === 'serein_1' && akitude === last) akitude = 'serein_2';
  else if (akitude === 'serein_2' && akitude === last) akitude = 'serein_1';
  state.moodStack.push(mood);
  state.akitudeStack.push(akitude);
  return _setExpression(state, akitude, mood);
}

/** Mundurkan mesin ekspresi satu langkah (undo / cancel_answer). */
function _popExpression(state) {
  if (state.moodStack.length > 1) state.moodStack.pop();
  if (state.akitudeStack.length > 1) state.akitudeStack.pop();
  const mood = state.moodStack[state.moodStack.length - 1] || 'serein+';
  const akitude = state.akitudeStack[state.akitudeStack.length - 1] || 'serein_2';
  return _setExpression(state, akitude, mood);
}

/** Akitude saat Akinator mengajukan tebakan (getProposeAkitude situs). */
function _proposeAkitude(mood) {
  return (mood === 'inquiet+' || mood === 'inquiet-') ? 'espoir_anxieux' : 'confiant';
}

function _setExpression(state, akitude, mood) {
  state.expression = {
    akitude,
    mood,
    akitudeLabel: AKITUDE_LABELS[akitude] || akitude,
    moodLabel: MOOD_LABELS[mood] || mood,
    imageUrl: expressionImageUrl(akitude, { locale: state.locale }),
  };
  return state.expression;
}

/** Ekspresi genie saat ini (akitude, mood, label, imageUrl) atau null. */
export function currentExpression(state) {
  return state?.expression ? { ...state.expression } : null;
}

// ==================== PARSER HALAMAN ====================

function parseGameHtml(html) {
  const pick = (patterns, what) => {
    for (const re of patterns) {
      const m = html.match(re);
      if (m) return m[1];
    }
    throw new AkinatorError(`Gagal mengekstrak ${what} dari halaman game`, 'PARSE_FAIL');
  };
  const session = pick([
    /localStorage\.setItem\(['"]session['"],\s*['"]([^'"]+)['"]\)/,
    /['"]session['"]\s*:\s*['"]([A-Za-z0-9+/=_-]{8,})['"]/i,
  ], 'session');
  // v3 (Okt 2026): parameter `signature` sudah DIHAPUS situs. Parse
  // kalau masih ada (kompatibilitas mundur), jangan gagalkan start.
  const signature = (html.match(/localStorage\.setItem\(['"]signature['"],\s*['"]([^'"]+)['"]\)/) || [])[1] || null;
  const identifiant = (html.match(/localStorage\.setItem\(['"]identifiant['"],\s*['"]([^'"]*)['"]\)/) || [])[1] || '';
  // trouvitudesReponses = perkiraan progression per tombol jawaban
  // (5 float) - bahan bakar mesin ekspresi genie. state = mood awal.
  let trouvitudes = [];
  const tm = html.match(/localStorage\.setItem\(['"]trouvitudesReponses['"],\s*['"](\[[^\]]*\])['"\)]/);
  if (tm) {
    try { trouvitudes = JSON.parse(tm[1]).map((x) => Number(x) || 0); } catch { trouvitudes = []; }
  }
  const mood = (html.match(/localStorage\.setItem\(['"]state['"],\s*['"]([^'"]+)['"]\)/) || [])[1] || 'serein+';
  // v3.0.1 FIX KRITIS: situs baru embed step & progression awal via
  // localStorage.setItem('step','1') - TIDAK lagi via step_number.
  // Jawaban pertama WAJIB pakai step ini; step=0 = server selalu KO.
  const step = Number((html.match(/localStorage\.setItem\(['"]step['"],\s*['"](\d+)['"]\)/) || [])[1] || 1) || 1;
  const progression = (html.match(/localStorage\.setItem\(['"]progression['"],\s*['"]([\d.]+)['"]\)/) || [])[1] || '0';
  const numQuestion = Number((html.match(/localStorage\.setItem\(['"]num_question['"],\s*['"](\d+)['"]\)/) || [])[1] || 0);
  let question = null;
  for (const re of [
    /<p class="question-text"[^>]*>([\s\S]*?)<\/p>/i,
    /<(?:p|div|span)[^>]*id="question-label"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i,
    /id="question-label"[^>]*>([^<]{2,300})/i,
    /class="question-text"[^>]*>([^<]{2,300})/i,
  ]) {
    const m = html.match(re);
    if (m) { question = decodeEntities(m[1]).replace(/\s+/g, ' ').trim(); break; }
  }
  if (!question) throw new AkinatorError('Pertanyaan pertama tidak ditemukan di halaman game', 'PARSE_FAIL');
  return { session, signature, identifiant, question, trouvitudes, mood, step, progression, numQuestion };
}

function parseGuess(d) {
  return {
    pid: d.id_proposition,
    pidBase: d.id_base_proposition,
    name: d.name_proposition ? decodeEntities(d.name_proposition) : '',
    desc: d.description_proposition ? decodeEntities(d.description_proposition) : '',
    photo: d.photo || null,
    pseudo: d.pseudo && d.pseudo !== 'none' ? decodeEntities(d.pseudo) : null,
    flagPhoto: d.flag_photo,
    noQuestion: d.no_question,
    nbElements: d.nb_elements,
    valideContrainte: d.valide_contrainte,
    step: d.step,
    hasPhoto: !!(d.photo && !/\/none\.jpe?g/.test(d.photo) && Number(d.flag_photo) !== 0),
  };
}

function parseSoundlikeOptions(html) {
  const opts = [];
  // v3 (Okt 2026, situs baru): <a class="anim soundlike-acceptance"
  //    data-id=".." data-pid=".." data-name=".." data-desc="..">Nama (desc)</a>
  const reV3 = /class="[^"]*soundlike-acceptance[^"]*"([\s\S]*?)data-id="(\d+)"([\s\S]*?)data-pid="(\d+)"([\s\S]*?)data-name="([^"]*)"([\s\S]*?)data-desc="([^"]*)"/g;
  let m;
  while ((m = reV3.exec(html))) {
    opts.push({ id: m[2], pid: m[4], flag: '', name: decodeEntities(m[6]), desc: decodeEntities(m[8]) });
  }
  if (opts.length) return opts;
  // Fallback: format lama (dengan data-flag, urutan rapat).
  const reV2 = /class="[^"]*soundlike-acceptance[^"]*"[^>]*data-id="(\d+)"\s+data-pid="(\d+)"\s+data-flag="([^"]*)"\s+data-name="([^"]*)"\s+data-desc="([^"]*)"/g;
  while ((m = reV2.exec(html))) {
    opts.push({ id: m[1], pid: m[2], flag: m[3], name: decodeEntities(m[4]), desc: decodeEntities(m[5]) });
  }
  return opts;
}

function parseChoicePage(html, status = 0) {
  if (isChallengeBody(html) || status === 403 || status === 503) {
    return { text: '', cfChallenge: true };
  }
  const sec = html.match(/<section id="base-section">[\s\S]*?<\/section>/);
  const src = sec ? sec[0] : html;
  const text = src
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const out = { text: text.slice(0, 700), cfChallenge: false };
  const m = text.match(/dimainkan[^0-9]{0,20}([\d.,\s]+)\s*kali/i) ||
            text.match(/([\d.,\s]+)\s*kali[^.]{0,25}dimainkan/i) ||
            text.match(/dimainkan di\s*([\d.,\s]+)/i);
  if (m) out.timesPlayed = m[1].trim();
  return out;
}

// ============================ GAME API ============================

/** Tutup resource transport game ini (context browser playwright).
 *  Dipanggil ruangan.ts pas sesi dibuang. */
export async function tutupTransport(state) {
  if (state?.transport === 'playwright') {
    await pwTransport.tutupSesi(state).catch(() => {});
  }
}

export async function startGame(opts = {}) {
  const locale = (opts.locale || 'id').toLowerCase();
  if (!LOCALES.includes(locale)) {
    throw new AkinatorError(`Locale "${locale}" tidak dikenal. Pilihan: ${LOCALES.join(', ')}`, 'BAD_LOCALE');
  }
  const gameId = opts.gameId || `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const state = {
    v: 2,
    gameId,
    locale,
    baseUrl: opts.baseUrl || `https://${locale}.akinator.com`,
    sid: '1',
    cm: opts.childMode ? 'true' : 'false',
    /* Transport diputuskan ruangan.ts (strategi direct→proxy→
     * playwright). proxy null = curl langsung; 'playwright' = semua
     * request game lewat browser (lazy, lihat playwright.mjs). */
    proxy: opts.proxy !== undefined ? opts.proxy : (process.env.AKINATOR_PROXY || null),
    transport: opts.transport || null,
    _ua: DEFAULT_UA,
    cookies: '',
    session: null,
    signature: null,     // v3: parameter ini sudah dihapus situs (selalu null)
    identifiant: '',
    trouvitudes: [],    // perkiraan progression per tombol jawaban (server)
    lastTrouvitude: null,
    moodStack: ['serein+'],   // mesin ekspresi: tumpukan mood (undo-able)
    akitudeStack: ['serein_2'],
    expression: null,   // diisi _setExpression() saat start
    step: 0,
    progression: '0.00000',
    stepLastProposition: '',
    status: 'question',
    question: null,
    questionId: null,
    guess: null,
    soundlikeOptions: [],
    history: [],       // riwayat jawaban (utk replay auto-resume + undo)
    refusals: [],      // riwayat tolak-tebakan (informasional, utk replay)
    resumes: [],       // catatan auto-resume yang pernah terjadi
    resumeDepth: opts._resumeDepth || 0,
    autoResume: opts.autoResume !== false,
    maxAutoResumes: opts.maxAutoResumes > 0 ? opts.maxAutoResumes : 3,
    koRetries: opts.koRetries >= 0 ? opts.koRetries : 3,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (opts.jarDir) state._jarDir = opts.jarDir;
  if (opts.onResume) state._onResume = opts.onResume;

  return withLock(gameId, async () => {
    // Cooldown aktif utk IP ini? Gagal-cepat (spam start saat diblokir
    // CF hanya memperpanjang challenge).
    const cooling = challengeCooldown(state);
    if (cooling > 0 && !opts.forceStart) {
      throw new AkinatorError(
        `Cloudflare masih cooldown untuk ${state.proxy || 'IP langsung'} - coba lagi dalam ~${Math.ceil(cooling / 1000)} detik ` +
        '(jangan dipaksa start terus-menerus, itu memperpanjang blokir).',
        'CHALLENGE', { retryAfterMs: cooling }
      );
    }

    // Warm-up: GET halaman depan dulu (meniru urutan browser asli).
    // Cukup SEKALI per (proxy,host)/10 mnt - game baru tinggal pakai
    // cookie primer.
    const primer = opts.fastStart !== false ? await _getPrimerCookies(state) : null;
    if (primer) {
      state.cookies = primer;
      dbg('startGame: pakai primer cookie - skip warm-up');
    } else {
      try {
        await request(state, {
          method: 'GET', urlPath: '/', xhr: false, raw: true, allowEmpty: true,
          noCooldownMark: true,
          label: 'GET / (warm-up)',
        });
      } catch { /* best effort */ }
      await _savePrimer(state);
      // Jeda manusiawi antara GET dan POST (pacing, bukan spam bot).
      await sleep(500 + Math.floor(Math.random() * 500));
    }

    let html = '';
    let parsed = null;
    for (let i = 0; i < 3; i++) {
      const res = await request(state, {
        method: 'POST',
        urlPath: '/game',
        form: formEncode({ sid: state.sid, cm: state.cm, anim: 'true' }),
        xhr: false,
        referer: `${state.baseUrl}/theme-selection`,
        raw: true,
        label: 'POST /game',
      });
      html = res.body;
      if (/Erreur technique/i.test(html) && i < 2) {
        dbg('startGame: "Erreur technique", coba sekali lagi...');
        await sleep(1500);
        continue;
      }
      try {
        parsed = parseGameHtml(html);
        break;
      } catch (e) {
        // Server kadang membalas halaman landing TANPA session (soft
        // rate-limit). Tahan: tunggu lalu coba lagi.
        if (e.code === 'PARSE_FAIL' && i < 2) {
          dbg(`startGame: halaman tanpa session (percobaan ${i + 1}/3), tunggu lalu coba lagi...`);
          await sleep(1200 + i * 1200);
          continue;
        }
        throw e;
      }
    }
    if (!parsed) {
      throw new AkinatorError(
        'Server tidak memberi sesi game setelah beberapa percobaan - coba lagi beberapa saat.',
        'SERVER_ERROR'
      );
    }
    state.session = parsed.session;
    state.signature = parsed.signature || null;
    state.identifiant = parsed.identifiant;
    state.question = parsed.question;
    state.step = parsed.step || 1;
    state.progression = parsed.progression || '0';
    state.trouvitudes = parsed.trouvitudes || [];
    state.moodStack = [parsed.mood || 'serein+'];
    state.akitudeStack = ['serein_2'];
    _setExpression(state, 'serein_2', parsed.mood || 'serein+');
    state.updatedAt = Date.now();
    return state;
  });
}

/** Bisa auto-resume sekarang? (guard: belum kebanyakan, jeda cukup,
 *  depth 0, riwayat masih masuk akal untuk di-replay) */
function _canResume(state) {
  if (state.autoResume === false) return false;
  if ((state.resumeDepth || 0) > 0) return false; // replay tidak boleh nested
  if ((state.resumes?.length || 0) >= (state.maxAutoResumes || 3)) return false;
  const last = state.resumes?.[state.resumes.length - 1];
  if (last && Date.now() - last.at < RESUME_MIN_GAP_MS) return false;
  if ((state.history?.length || 0) > RESUME_MAX_HISTORY) return false;
  return true;
}

/**
 * AUTO-RESUME: sesi mati persisten di tengah game -> mulai game baru
 * diam-diam, replay seluruh riwayat jawaban, lalu terapkan jawaban
 * yang tadi gagal. Pemain lanjut seolah tidak terjadi apa-apa (state
 * object tetap sama - aman untuk referensi yang dipegang manager).
 */
async function _resumeAndAnswer(state, answer, cause) {
  const history = state.history || [];
  const replayCount = history.length;
  try { state._onResume?.({ reason: cause.code, replayCount }); } catch { }
  dbg(`auto-resume: sesi mati (${cause.code}) - game baru + replay ${replayCount} jawaban`);

  const newSt = await startGame({
    locale: state.locale,
    baseUrl: state.baseUrl,
    proxy: state.proxy,
    transport: state.transport,
    childMode: state.cm === 'true',
    jarDir: state._jarDir,
    _onResume: state._onResume,
    _resumeDepth: (state.resumeDepth || 0) + 1,
    fastStart: true,
  });

  // ---- replay riwayat jawaban (dengan retry KO per-jawaban) ----
  for (const h of history) {
    let done = false;
    for (let t = 0; t < 3 && !done; t++) {
      if (t > 0) await sleep(1500);
      try {
        const r = await answerQuestion(newSt, h.answer);
        if (r.type === 'propose') {
          // Mesin nebak di tengah replay - tolak dulu biar alur lanjut.
          await refuseGuess(newSt);
        }
        done = true;
      } catch (e) {
        if (RESUMABLE_CODES.has(e.code) && t < 2) continue;
        throw e; // resume gagal total - lempar error asli ke caller
      }
    }
  }

  // ---- terapkan jawaban yang tadi gagal terkirim ----
  const r = await answerQuestion(newSt, answer);

  // ---- swap isi state (identitas objek tetap - referensi aman) ----
  const oldGameId = state.gameId;
  const resumes = state.resumes || [];
  const refusals = state.refusals || [];
  Object.assign(state, newSt);
  state.resumes = resumes;
  state.refusals = refusals;
  state.resumes.push({ at: Date.now(), reason: cause.code, replayed: replayCount });
  state.updatedAt = Date.now();
  _locks.delete(oldGameId);
  rm(jarPath({ ...state, gameId: oldGameId, _jarDir: state._jarDir }), { force: true }).catch(() => { });
  return { ...r, resumed: true, replayed: replayCount };
}

export async function answerQuestion(state, answer) {
  return withLock(state.gameId, async () => {
    if (state.status !== 'question') {
      const hint = state.status === 'propose'
        ? '. Balas tebakan dulu (acceptGuess / refuseGuess).'
        : state.status === 'soundlike'
          ? '. Pilih salah satu opsi soundlike dulu (pickSoundlike).'
          : '';
      throw new AkinatorError(`Tidak bisa menjawab sekarang - status game "${state.status}"${hint}`, 'WRONG_STATE');
    }
    if (!Number.isInteger(answer) || answer < 0 || answer > 4) {
      throw new AkinatorError('answer harus 0..4', 'BAD_ANSWER');
    }

    const form = formEncode({
      step: state.step,
      progression: state.progression,
      sid: state.sid,
      cm: state.cm,
      answer,
      step_last_proposition: state.stepLastProposition,
      session: state.session,
    });
    // trouvitude jawaban INI (bahan mesin ekspresi) disimpan sebelum kirim.
    const trouvitude = Number(state.trouvitudes?.[answer]);
    const stepAtAnswer = state.step;
    const progressionOld = state.progression;

    let d;
    try {
      d = await postJson(state, {
        urlPath: '/answer', form, xhr: true, mutating: true, label: 'POST /answer',
      });
    } catch (e) {
      // KO persisten / sesi mati / respons kosong -> selamatkan game.
      if (RESUMABLE_CODES.has(e.code) && _canResume(state)) {
        try {
          return await _resumeAndAnswer(state, answer, e);
        } catch (e2) {
          state.status = 'over';
          throw new AkinatorError(
            `Sesi mati (${e.code}) dan gagal disambung ulang: ${e2.message}`,
            'RESUME_FAIL', { cause: e.code, resumeError: e2.code ?? null }
          );
        }
      }
      if (e.code === 'KO') {
        state.status = 'over';
        throw new AkinatorError('Akinator menyerah / sesi bermasalah (completion KO). Mulai game baru.', 'KO');
      }
      throw e;
    }

    // Jawaban SUKSES terkirim - catat ke riwayat sekali (replay & undo).
    state.history.push({
      step: state.step,
      question: state.question,
      answer,
      answerLabel: answerLabels(state.locale)[answer],
    });
    if (Number.isFinite(trouvitude)) state.lastTrouvitude = trouvitude;

    if (d.completion === 'SOUNDLIKE') {
      state.stepLastProposition = String(Number(state.step) + 1);
      state.status = 'soundlike';
      await _fetchSoundlike(state, { viaGet: true });
      state.updatedAt = Date.now();
      return { type: 'soundlike', options: state.soundlikeOptions };
    }

    if (d.id_proposition) {
      if (Number(d.valide_contrainte) === 0) {
        throw new AkinatorError('Karakter yang ditebak tersaring mode anak (valide_contrainte=0).', 'CHILD_FILTER');
      }
      state.guess = parseGuess(d);
      state.step = d.step;
      state.stepLastProposition = String(d.step);
      state.status = 'propose';
      // Ekspresi saat mengajukan tebakan (persis getProposeAkitude situs).
      const moodNow = state.moodStack[state.moodStack.length - 1] || 'serein+';
      _setExpression(state, _proposeAkitude(moodNow), moodNow);
      state.updatedAt = Date.now();
      return { type: 'propose', guess: state.guess, expression: currentExpression(state) };
    }

    // ---- Auto-heal: retry saat koneksi putus bisa membuat jawaban
    // terkirim 2x. Tanda: step loncat lebih dari 1.
    if (d.question && Number(d.step) > Number(state.step) + 1) {
      dbg(`answer: step loncat ${state.step} -> ${d.step}; coba cancel 1 langkah (heal)`);
      try {
        const d2 = await _cancelAnswer(state, { step: d.step, progression: d.progression });
        if (d2 && d2.question) {
          state.step = d2.step;
          state.progression = d2.progression;
          state.question = d2.question;
          state.questionId = d2.question_id ?? null;
          state.status = 'question';
          state.updatedAt = Date.now();
          return {
            type: 'question', question: d2.question, progression: d2.progression,
            step: d2.step, healed: true,
          };
        }
      } catch (e) {
        dbg('answer: heal gagal, lanjut normal:', e.message);
      }
    }

    state.step = d.step;
    state.progression = d.progression;
    state.question = d.question;
    state.questionId = d.question_id ?? null;
    state.status = 'question';
    // Majukan mesin ekspresi genie + simpan trouvitudes pertanyaan baru.
    if (Number.isFinite(trouvitude)) {
      _advanceExpression(state, trouvitude, stepAtAnswer, progressionOld);
    }
    if (Array.isArray(d.trouvitudesReponses)) {
      state.trouvitudes = d.trouvitudesReponses.map((x) => Number(x) || 0);
    } else {
      state.trouvitudes = [];
    }
    state.updatedAt = Date.now();
    return {
      type: 'question', question: d.question, progression: d.progression,
      step: d.step, expression: currentExpression(state),
    };
  });
}

async function _cancelAnswer(state, { step, progression } = {}) {
  const form = formEncode({
    step: step ?? state.step,
    progression: progression ?? state.progression,
    sid: state.sid,
    cm: state.cm,
    session: state.session,
  });
  return postJson(state, {
    urlPath: '/cancel_answer', form, xhr: true, mutating: true, label: 'POST /cancel_answer',
  });
}

export async function undoAnswer(state) {
  return withLock(state.gameId, async () => {
    if (state.status !== 'question') {
      throw new AkinatorError('Undo hanya bisa saat status "question"', 'WRONG_STATE');
    }
    const d = await _cancelAnswer(state);
    const prev = state.history.pop() || null;
    state.step = d.step;
    state.progression = d.progression;
    state.question = d.question;
    state.questionId = d.question_id ?? null;
    state.status = 'question';
    // Expression ikut mundur + trouvitudes pertanyaan yang muncul lagi.
    _popExpression(state);
    if (Array.isArray(d.trouvitudesReponses)) {
      state.trouvitudes = d.trouvitudesReponses.map((x) => Number(x) || 0);
    }
    state.updatedAt = Date.now();
    return {
      type: 'question', question: d.question, progression: d.progression,
      step: d.step, undone: prev, expression: currentExpression(state),
    };
  });
}

export async function refuseGuess(state) {
  return withLock(state.gameId, async () => {
    if (state.status !== 'propose') {
      throw new AkinatorError('Tidak ada tebakan yang bisa ditolak - status bukan "propose"', 'WRONG_STATE');
    }
    const g = state.guess;
    const d = await postJson(state, {
      urlPath: '/exclude',
      form: formEncode({
        step: state.step,
        sid: state.sid,
        cm: state.cm,
        progression: state.progression,
        session: state.session,
        forward_answer: '1',
      }),
      xhr: true, mutating: true, label: 'POST /exclude (refuse)',
    });
    state.refusals.push({ at: Date.now(), step: state.step, guessName: g?.name || null });
    state.guess = null;
    // Setelah tebakan ditolak: situs memutar transisi 'merci' lalu maju
    // ke akitude menunggu berikutnya.
    if (Number.isFinite(state.lastTrouvitude)) {
      _advanceExpression(state, state.lastTrouvitude, state.step, state.progression);
    }
    state.step = d.step;
    state.progression = d.progression;
    state.question = d.question;
    state.questionId = d.question_id ?? null;
    state.status = 'question';
    if (Array.isArray(d.trouvitudesReponses)) {
      state.trouvitudes = d.trouvitudesReponses.map((x) => Number(x) || 0);
    }
    state.updatedAt = Date.now();
    return {
      type: 'question', question: d.question, progression: d.progression,
      step: d.step, expression: currentExpression(state),
    };
  });
}

export async function acceptGuess(state) {
  return withLock(state.gameId, async () => {
    if (state.status !== 'propose' || !state.guess) {
      throw new AkinatorError('Tidak ada tebakan aktif - status bukan "propose"', 'WRONG_STATE');
    }
    const g = state.guess;
    let pageBody = '', pageStatus = 0;

    if (Number(g.flagPhoto) === 4) {
      const res = await request(state, {
        urlPath: '/list_vote',
        form: formEncode({
          sid: state.sid,
          pidbase: g.pidBase,
          session: state.session,
          step: state.step,
          pid: g.pid,
          pflag_photo: g.flagPhoto,
          charac_name: g.name,
          charac_desc: g.desc,
          already_vote: '',
        }), // v3: parameter `signature` sudah dihapus situs - jangan dikirim
        xhr: false, raw: true, allowEmpty: true, label: 'POST /list_vote',
      });
      if (!res.body.trim()) {
        const res2 = await request(state, { method: 'GET', urlPath: '/choice', xhr: false, label: 'GET /choice' });
        pageBody = res2.body; pageStatus = res2.status;
      }
    } else {
      await request(state, {
        urlPath: '/choice',
        form: formEncode({
          session: state.session,
          identifiant: state.identifiant,
          step: state.step,
          sid: state.sid,
          pid: g.pid,
          pflag_photo: g.flagPhoto,
          charac_name: g.name,
          charac_desc: g.desc,
        }), // v3: tanpa signature (dihapus situs) - persis form browser
        xhr: false, raw: true, allowEmpty: true, label: 'POST /choice',
      });
      const res = await request(state, { method: 'GET', urlPath: '/choice', xhr: false, label: 'GET /choice' });
      pageBody = res.body; pageStatus = res.status;
    }

    const page = parseChoicePage(pageBody, pageStatus);
    state.status = 'won';
    // Saat menang, genie berpose kemenangan (persis layar menang situs).
    const moodWin = state.moodStack[state.moodStack.length - 1] || 'confiant';
    _setExpression(state, 'triomphe', moodWin);
    state.updatedAt = Date.now();
    return {
      type: 'won',
      guess: g,
      timesPlayed: page.timesPlayed || null,
      pageText: page.text || '',
      expression: currentExpression(state),
    };
  });
}

export async function giveUp(state) {
  return withLock(state.gameId, async () => {
    if (state.status !== 'question' && state.status !== 'propose') {
      throw new AkinatorError('Give up hanya bisa saat masih main', 'WRONG_STATE');
    }
    await request(state, {
      urlPath: '/exclude',
      form: formEncode({
        step: state.step,
        sid: state.sid,
        cm: state.cm,
        progression: state.progression,
        session: state.session,
        forward_answer: '0',
      }), // v3: tanpa signature (dihapus situs)
      xhr: true, raw: true, allowEmpty: true, mutating: true, label: 'POST /exclude (give up)',
    });

    await _fetchSoundlike(state, { viaPost: true });
    state.guess = null;
    state.status = 'soundlike';
    // Menyerah -> genie kecewa berat (momen "Akinator nyerah" di situs).
    _setExpression(state, 'decouragement', state.moodStack[state.moodStack.length - 1] || 'inquiet-');
    state.updatedAt = Date.now();
    return {
      type: 'soundlike', options: state.soundlikeOptions,
      expression: currentExpression(state),
    };
  });
}

export async function pickSoundlike(state, index) {
  return withLock(state.gameId, async () => {
    if (state.status !== 'soundlike' || !state.soundlikeOptions.length) {
      throw new AkinatorError('Tidak ada daftar soundlike aktif', 'WRONG_STATE');
    }
    const opt = typeof index === 'number'
      ? state.soundlikeOptions[index]
      : state.soundlikeOptions.find((o) => o.name === index);
    if (!opt) throw new AkinatorError(`Pilihan tidak ada (0..${state.soundlikeOptions.length - 1})`, 'BAD_PICK');

    // v3: form /choice tanpa signature; pflag_photo hanya kalau ada nilainya.
    const choiceForm = {
      session: state.session,
      identifiant: state.identifiant,
      step: state.step,
      sid: state.sid,
      pid: opt.pid,
      charac_name: opt.name,
      charac_desc: opt.desc,
    };
    if (opt.flag) choiceForm.pflag_photo = opt.flag;
    await request(state, {
      urlPath: '/choice',
      form: formEncode(choiceForm),
      xhr: false, raw: true, allowEmpty: true, label: 'POST /choice (soundlike)',
    });
    const res = await request(state, { method: 'GET', urlPath: '/choice', xhr: false, label: 'GET /choice' });
    const parsed = parseChoicePage(res.body, res.status);
    state.status = 'over';
    // Pemain memilih dari daftar soundlike -> genie berterima kasih.
    _setExpression(state, 'merci', state.moodStack[state.moodStack.length - 1] || 'serein+');
    state.updatedAt = Date.now();
    return { type: 'picked', pick: opt, pageText: parsed.text, expression: currentExpression(state) };
  });
}

async function _fetchSoundlike(state, { viaGet = false, viaPost = false } = {}) {
  let html = '';
  if (viaGet) {
    try {
      const res = await request(state, { method: 'GET', urlPath: '/soundlike', xhr: false, allowEmpty: true, label: 'GET /soundlike' });
      html = res.body;
    } catch {
      html = '';
    }
    if (!parseSoundlikeOptions(html).length) {
      const res = await request(state, {
        urlPath: '/soundlike_list',
        form: formEncode({
          step: state.step, sid: state.sid, session: state.session,
        }),
        xhr: false, raw: true, label: 'POST /soundlike_list',
      });
      html = res.body;
    }
  } else if (viaPost) {
    const res = await request(state, {
      urlPath: '/soundlike_list',
      form: formEncode({
        step: state.step, sid: state.sid, session: state.session,
      }),
      xhr: false, raw: true, label: 'POST /soundlike_list',
    });
    html = res.body;
  }
  state.soundlikeOptions = parseSoundlikeOptions(html);
  return state.soundlikeOptions;
}

export function getProgress(state) {
  const p = Math.max(0, Math.min(100, parseFloat(state.progression) || 0));
  return {
    percent: Math.round(p * 10) / 10,
    label: p >= 90 ? 'hampir yakin' : p >= 60 ? 'mulai yakin' : p >= 30 ? 'masih mikir' : 'belum apa-apa',
  };
}
