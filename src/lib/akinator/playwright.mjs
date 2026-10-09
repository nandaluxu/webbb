/* Transport Playwright buat Akinator (r24) — LAPISAN TERAKHIR, lazy:
   cuma disentuh kalau HTTP langsung + proxy gagal kena Cloudflare
   (diputus mesin.mjs/ruangan.ts dari strategi.mjs).

   Dua backend, dipilih otomatis, dua-duany LAZY:
   1. Playwright Node (dynamic import) — dicoba berururutan:
      'playwright' (kalau pemilik ny nginstall sendiri) terus
      'playwright-core' (r25: ada di package.json, GAK
      ngunduh browser pas install, jadi ringan buat semua orang).
      Pilihan bisa dipaksa lewat AKINATOR_PLAYWRIGHT_MODULE.
   2. Worker Python (pw-worker.py) — lewat interpreter dari ENV
      AKINATOR_PLAYWRIGHT_PYTHON (default python3), cuma jalan kalau
      python + playwright ny kepasang di mesin ny.

   Browser ny sendiri dicari otomatis (r25) biar lapisan ini NYALA
   di mesin pemilik tanpa setup manual:
     a. AKINATOR_PLAYWRIGHT_EXECUTABLE_PATH (ENV, prioritas tinggi)
     b. Browser kepasang di sistem: Windows (Chrome / Edge — Edge
        bawaan Win10+ / Brave / Chromium), macOS, Linux+Termux
        (chromium / google-chrome / brave-browser / dll lewat PATH)
     c. Chromium bundled milik modul 'playwright' penuh (kalau ada)
   Path hasil deteksi diturunin ke worker python lewat ENV.

   Browser di-launch PAS REQUEST PERTAMA (bukan pas server boot),
   di-share antar game; satu context per game (cookie keisolasi),
   ditutup pas sesi ny selesai (tutupSesi). Gak ada path browser
   yang di-hardcode permanen: kandidat ny cuma lokasi standar
   pabrik + PATH.

   Gak ada bypass challenge aneh-aneh: cuma browser beneran yang
   nunggu challenge JS ny selesai sendiri. */

import { spawn, execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = (cmd, args) =>
  new Promise((selesai) => {
    execFile(cmd, args, { timeout: 3000 }, (e, stdout) => selesai(e ? null : String(stdout || '')));
  });

const _dir = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PY = path.join(_dir, 'pw-worker.py');

const g = globalThis;
if (!g.__akinatorPw) {
  g.__akinatorPw = {
    backend: null,          // 'node' | 'python' | null (belum dicek)
    modulNode: null,        // modul playwright/playwright-core hasil dynamic import
    namaModul: null,        // 'playwright' | 'playwright-core'
    browserNode: null,
    deteksi: undefined,     // undefined=belum, { jalur, sumber } | null = gak ada
    konteksNode: new Map(), // gameId -> context
    halamanNode: new Map(), // gameId -> page
    worker: null,           // child process python
    antre: null,            // promise tunggu response worker
    tunggu: new Map(),      // id -> { selesai, tolak }
    urut: 0,
  };
}
const pw = g.__akinatorPw;

function headless() {
  return !String(process.env.AKINATOR_PLAYWRIGHT_HEADLESS ?? 'true').trim().toLowerCase().match(/^(0|false|no|off)$/);
}

async function adaFile(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Deteksi browser sistem (r25) ----------
   Cari engine Chromium yang KEINSTALL di mesin ini, urut dari yang
   paling umum. Windows duluan soalny Edge kepasang default di
   Win10/11 — artiny lapisan browser nyala otomatis buat mayoritas
   pemilik tanpa setup apa pun. */

const KANDIDAT_WINDOWS = () => {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const la = process.env.LOCALAPPDATA;
  return [
    [`${pf}\\Google\\Chrome\\Application\\chrome.exe`, 'chrome'],
    [`${pf86}\\Google\\Chrome\\Application\\chrome.exe`, 'chrome'],
    ...(la ? [[`${la}\\Google\\Chrome\\Application\\chrome.exe`, 'chrome']] : []),
    [`${pf}\\Microsoft\\Edge\\Application\\msedge.exe`, 'edge'],
    [`${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, 'edge'],
    [`${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, 'brave'],
    [`${pf86}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, 'brave'],
    ...(la ? [[`${la}\\Chromium\\Application\\chrome.exe`, 'chromium']] : []),
  ];
};

const KANDIDAT_MAC = () => [
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'chrome'],
  ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'edge'],
  ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', 'brave'],
  ['/Applications/Chromium.app/Contents/MacOS/Chromium', 'chromium'],
];

const KANDIDAT_UNIX_PATH = [
  'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable',
  'brave-browser', 'msedge', 'chrome', 'snap/bin/chromium',
];

const KANDIDAT_UNIX_FIX = [
  ['/usr/bin/chromium', 'chromium'],
  ['/usr/bin/chromium-browser', 'chromium'],
  ['/usr/bin/google-chrome', 'chrome'],
  ['/usr/bin/google-chrome-stable', 'chrome'],
  ['/usr/bin/brave-browser', 'brave'],
  ['/snap/bin/chromium', 'chromium'],
];

async function cariDiUnix() {
  for (const [p, sumber] of KANDIDAT_UNIX_FIX) {
    if (await adaFile(p)) return { jalur: p, sumber };
  }
  const keluar = await execFileP('which', KANDIDAT_UNIX_PATH);
  if (keluar) {
    for (const baris of keluar.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const nama = path.basename(baris);
      return { jalur: baris, sumber: nama };
    }
  }
  return null;
}

/** Browser yang kedeteksi di mesin ini (cache). Balikin
 *  { jalur, sumber } atau null. ENV tetap prioritas tertinggi. */
export async function cariBrowser() {
  if (pw.deteksi !== undefined) return pw.deteksi;
  let hasil = null;
  const env = String(process.env.AKINATOR_PLAYWRIGHT_EXECUTABLE_PATH ?? '').trim();
  if (env) {
    hasil = { jalur: env, sumber: 'env' };
  } else if (process.platform === 'win32') {
    for (const [p, sumber] of KANDIDAT_WINDOWS()) {
      if (await adaFile(p)) {
        hasil = { jalur: p, sumber };
        break;
      }
    }
  } else if (process.platform === 'darwin') {
    for (const [p, sumber] of KANDIDAT_MAC()) {
      if (await adaFile(p)) {
        hasil = { jalur: p, sumber };
        break;
      }
    }
  } else {
    hasil = await cariDiUnix();
  }
  pw.deteksi = hasil;
  if (hasil) {
    /* Turunin ke worker python: detection ny cuma sekali, biar kedua
       backend makai engine yang sama. */
    if (!process.env.AKINATOR_PLAYWRIGHT_EXECUTABLE_PATH) {
      process.env.AKINATOR_PLAYWRIGHT_EXECUTABLE_PATH = hasil.jalur;
    }
  }
  return hasil;
}

function timeoutDetik() {
  const n = Number(process.env.AKINATOR_TIMEOUT);
  return Number.isFinite(n) && n >= 5 && n <= 300 ? Math.round(n) : 60;
}

/* ---------- Backend 1: Playwright Node (kalau kepasang) ---------- */

async function pastiNode() {
  if (pw.modulNode) return pw.modulNode;
  /* Import HARUS opsional buat bundler: kandidat modul GAK boleh
     ke-bundle (harus runtime-resolve ke node_modules mesin ny).
     Tanpa komentar ignore, webpack/turbopack matiin build "Module
     not found" walau ada .catch ny (build-time error, bukan runtime).
     Urutan (r25): ENV paksa -> 'playwright' (kalau pemilik ny
     nginstall sendiri) -> 'playwright-core' (ada di package.json,
     ringan, GAK ngunduh browser pas install). */
  const kandidat = [
    String(process.env.AKINATOR_PLAYWRIGHT_MODULE ?? '').trim(),
    'playwright',
    'playwright-core',
  ].filter(Boolean);
  for (const nama of kandidat) {
    const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ nama).catch(() => null);
    if (mod) {
      pw.modulNode = mod;
      pw.namaModul = nama;
      return mod;
    }
  }
  return null;
}

/* Path engine buat launch: browser sistem kalau kedeteksi; kalau
   gak, cek chromium bundled milik modul 'playwright' penuh.
   Balikin: string = path engine, undefined = pakai bundled,
   null = gak ada engine sama sekali. */
async function jalurEngine(mod) {
  const deteksi = await cariBrowser();
  if (deteksi) return deteksi.jalur;
  try {
    const bundled = mod.chromium.executablePath?.();
    if (bundled && (await adaFile(bundled))) return undefined;
  } catch { /* playwright-core tanpa browser: executablePath ny lempar */ }
  return null;
}

/* Error 'lapisaan gak tersedia' dengan code biar ruangan.ts tau itu
   bukan bug — cuma kondisi lingkungan (gak ada browser/modul).
   Pesen ny langsung ngasih solusi, gak nyasar. */
function errorTidakTersedia(detail) {
  const e = new Error(
    `Mode browser gak tersedia di server ini (${detail}). ` +
    'Solusi: pasang Chrome atau Edge di mesin server (kedeteksi otomatis), ' +
    'atau set AKINATOR_PLAYWRIGHT_EXECUTABLE_PATH, atau isi proxy di AKINATOR_PROXY.',
  );
  e.code = 'PW_UNAVAILABLE';
  return e;
}

async function bukaNode(gameId, baseUrl, ua) {
  const mod = await pastiNode();
  if (!mod) throw errorTidakTersedia('modul playwright/playwright-core gak ke-resolve');
  if (!pw.browserNode) {
    const engine = await jalurEngine(mod);
    if (engine === null) {
      throw errorTidakTersedia(
        'gak ada browser engine (Chrome/Edge/Chromium) yang kedeteksi di mesin ini',
      );
    }
    pw.browserNode = await mod.chromium.launch({
      executablePath: engine,
      headless: headless(),
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    });
  }
  if (pw.halamanNode.has(gameId)) return;
  const konteks = await pw.browserNode.newContext({ userAgent: ua || undefined, viewport: { width: 1280, height: 800 } });
  const halaman = await konteks.newPage();
  await lewatinCfNode(halaman, baseUrl);
  pw.konteksNode.set(gameId, konteks);
  pw.halamanNode.set(gameId, halaman);
}

async function lewatinCfNode(halaman, baseUrl) {
  await halaman.goto(baseUrl.replace(/\/$/, '') + '/', { waitUntil: 'domcontentloaded', timeout: timeoutDetik() * 1000 });
  const tanda = ['just a moment', '__cf_chl', 'cf_chl_', 'cf-error-details', 'attention required'];
  for (let i = 0; i < 15; i++) {
    const isi = (await halaman.content()).toLowerCase();
    if (!tanda.some((t) => isi.includes(t))) return;
    await halaman.waitForTimeout(1000);
  }
  const isi = (await halaman.content()).toLowerCase();
  if (tanda.some((t) => isi.includes(t))) throw new Error('challenge cloudflare gak kelewatin (node)');
}

async function mintaNode(gameId, { url, method, form, xhr, referer }) {
  const halaman = pw.halamanNode.get(gameId);
  if (!halaman) throw new Error('sesi browser node belum dibuka');
  const headers = { 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8' };
  if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  if (xhr) {
    headers['X-Requested-With'] = 'XMLHttpRequest';
    headers['Accept'] = 'application/json, text/javascript, */*; q=0.01';
  } else {
    headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  }
  const hasil = await halaman.evaluate(
    async (p) => {
      const r = await fetch(p.url, { method: p.method, headers: p.headers, body: p.form || undefined, credentials: 'include' });
      return { status: r.status, body: await r.text() };
    },
    { url, method, form: form || null, headers },
  );
  return hasil;
}

/* ---------- Backend 2: worker Python ---------- */

async function pastiPython() {
  const kandidat = [String(process.env.AKINATOR_PLAYWRIGHT_PYTHON ?? '').trim(), 'python3', 'python'].filter(Boolean);
  for (const exe of kandidat) {
    const ok = await new Promise((selesai) => {
      const p = spawn(exe, ['-c', 'import playwright'], { stdio: 'ignore' });
      p.on('error', () => selesai(false));
      p.on('exit', (kode) => selesai(kode === 0));
    });
    if (ok) return exe;
  }
  return null;
}

async function pastiWorker() {
  if (pw.worker) return pw.worker;
  const exe = await pastiPython();
  if (!exe) throw new Error('playwright python gak ketemu (set AKINATOR_PLAYWRIGHT_PYTHON)');
  const w = spawn(exe, [WORKER_PY], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env } });
  w.on('exit', () => {
    pw.worker = null;
    const galat = new Error('worker playwright mati');
    pw.tunggu.forEach((t) => t.tolak(galat));
    pw.tunggu.clear();
  });
  const antre = [];
  let buf = '';
  w.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      antre.push(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
    for (const baris of antre.splice(0)) {
      try {
        const b = JSON.parse(baris);
        const t = pw.tunggu.get(b.id);
        if (t) {
          pw.tunggu.delete(b.id);
          if (b.ok) t.selesai(b);
          else t.tolak(new Error(b.error || 'worker error'));
        }
      } catch { /* baris rusak diabaikan */ }
    }
  });
  pw.worker = w;
  return w;
}

async function perintahWorker(cmd) {
  const w = await pastiWorker();
  const id = ++pw.urut;
  const janji = new Promise((selesai, tolak) => pw.tunggu.set(id, { selesai, tolak }));
  const timer = setTimeout(() => {
    if (pw.tunggu.has(id)) {
      pw.tunggu.delete(id);
      tolak(new Error('worker playwright timeout'));
    }
  }, (timeoutDetik() + 10) * 1000);
  w.stdin.write(JSON.stringify({ id, ...cmd }) + '\n');
  try {
    return await janji;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Pintu bersama (dipake mesin.mjs) ---------- */

/** Backend yang bakal kepake ('node' | 'python' | null). Dicek lazy,
 *  hasilny di-cache. 'node' cuma dianggap ada kalau modul ny
 *  ke-resolve DAN ada engine (browser sistem / chromium bundled) —
 *  playwright-core doang tanpa browser gak guna (r25). */
export async function backendTersedia() {
  if (pw.backend) return pw.backend;
  const mod = await pastiNode();
  if (mod && (await jalurEngine(mod)) !== null) {
    pw.backend = 'node';
    return 'node';
  }
  if (await pastiPython()) {
    pw.backend = 'python';
    return 'python';
  }
  pw.backend = 'tidak-ada';
  return null;
}

/** Info deteksi engine buat telemetri owner (gak buka apa-apa,
 *  cuma baca cache). */
export async function infoDeteksi() {
  const mod = pw.modulNode ? pw.namaModul : null;
  let deteksi = pw.deteksi;
  if (deteksi === undefined) {
    deteksi = mod ? await cariBrowser() : null;
  }
  return {
    modul: mod,
    browser: deteksi ? { jalur: deteksi.jalur, sumber: deteksi.sumber } : null,
    backend: pw.backend === 'tidak-ada' ? null : pw.backend,
    headless: headless(),
  };
}

/** Buka sesi browser buat game ini (goto halaman depan + tunggu CF). */
export async function pastiSesi(state) {
  const base = state.baseUrl || `https://${state.locale}.akinator.com`;
  const ua = state._ua || null;
  const backend = await backendTersedia();
  if (backend === 'node') return bukaNode(state.gameId, base, ua);
  if (backend === 'python') return perintahWorker({ cmd: 'buka', gameId: state.gameId, baseUrl: base, ua });
  throw errorTidakTersedia('gak ada modul playwright/playwright-core + browser yang bisa dipake');
}

/** Satu request HTTP lewat browser. Balikin {status, body}. */
export async function minta(state, { url, method = 'POST', form = '', xhr = true, referer = null }) {
  const backend = await backendTersedia();
  if (backend === 'node') return mintaNode(state.gameId, { url, method, form, xhr, referer });
  if (backend === 'python') {
    const r = await perintahWorker({ cmd: 'minta', gameId: state.gameId, url, method, form, xhr, referer });
    return { status: r.status, body: r.body };
  }
  throw errorTidakTersedia('gak ada modul playwright/playwright-core + browser yang bisa dipake');
}

/** Re-prime (goto ulang halaman depan, misalny pas challenge). */
export async function primeUlang(state) {
  const base = state.baseUrl || `https://${state.locale}.akinator.com`;
  const backend = await backendTersedia();
  if (backend === 'node') {
    const halaman = pw.halamanNode.get(state.gameId);
    if (!halaman) return pastiSesi(state);
    await lewatinCfNode(halaman, base).catch(() => {});
    return;
  }
  if (backend === 'python') {
    await perintahWorker({ cmd: 'tutup', gameId: state.gameId }).catch(() => {});
    await perintahWorker({ cmd: 'buka', gameId: state.gameId, baseUrl: base, ua: state._ua || null });
    return;
  }
}

/** Tutup context halaman game ini (browser tetep nyala buat reuse). */
export async function tutupSesi(state) {
  if (pw.backend === 'node') {
    const k = pw.konteksNode.get(state.gameId);
    if (k) {
      await k.close().catch(() => {});
      pw.konteksNode.delete(state.gameId);
      pw.halamanNode.delete(state.gameId);
    }
    return;
  }
  if (pw.backend === 'python' && pw.worker) {
    await perintahWorker({ cmd: 'tutup', gameId: state.gameId }).catch(() => {});
  }
}

/** Matiin semuany (browser + worker) — dipake pas idle banget. */
export async function tutupSemua() {
  if (pw.browserNode) {
    await pw.browserNode.close().catch(() => {});
    pw.browserNode = null;
  }
  pw.konteksNode.clear();
  pw.halamanNode.clear();
  if (pw.worker) {
    pw.worker.kill();
    pw.worker = null;
  }
}
