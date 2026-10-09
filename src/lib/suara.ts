"use client";

/* Suara situs: backsound + efek suara (SFX).
   - Backsound utama: file audio di /aset/backsound (sejajar sama
     folder SFX /aset/suara). Konfigurasi ny di satu tempat (BACKSOUND
     di bawah) biar gampang diganti/ditambah belakapan tanpa refactor.
     Kalau file ny gak ada/rusak, otomatis balik ke drone sintesis
     Web Audio (bawaan lama) biar fitur ny tetep bunyi.
   - SFX pake file .mp3 kecil di public/aset/suara/ biar gampang
     diganti pemilik ny sendiri (tinggal timpa file ny, nama sama).
     Bunyi ny di-cache browser (header cache /aset/*), jadi gak
     diunduh ulang tiap pindah halaman.
   - Semua tombol/interaksi dapet bunyi click ringan lewat satu
     listener global; bunyi khusus (buka/tutup menu, sukses, error)
     ditandain lewat atribut data-sfx atau dipanggil langsung dari
     kode pas kejadian ny beneran terjadi.
   - Anti-spam: bunyi yang sama gak mau keputar dua kali dalam 70ms
     (nunggangin throttle per nama), jadi klik cepet / event dobel
     gak bikin berisik.
   - Preferensi (mute + volume) disimpen localStorage. Gak ada
     autoplay: backsound cuma nyala kalau user nyuruh. File
     backsound preload-ny "none": gak diunduh sama sekali sampai
     user nyalain (gak ganggu lazy loading media). */

import { useSyncExternalStore } from "react";

export type PrefSuara = { back: boolean; volume: number; sfx: boolean };

const KUNCI_PREF = "neyhra:suara";
const PREF_BAWAAN: PrefSuara = { back: false, volume: 0.4, sfx: true };

let pref: PrefSuara = PREF_BAWAAN;
const pendengar = new Set<() => void>();

try {
  const simpan = JSON.parse(localStorage.getItem(KUNCI_PREF) || "null");
  if (simpan && typeof simpan === "object") {
    pref = {
      back: !!simpan.back,
      volume: typeof simpan.volume === "number" ? Math.min(1, Math.max(0, simpan.volume)) : 0.4,
      sfx: simpan.sfx !== false,
    };
  }
} catch {}

function simpan() {
  try {
    localStorage.setItem(KUNCI_PREF, JSON.stringify(pref));
  } catch {}
  pendengar.forEach((f) => f());
}

function langganan(f: () => void) {
  pendengar.add(f);
  return () => pendengar.delete(f);
}

export function useSuara(): PrefSuara {
  /* getServerSnapshot balikin default konstan: pref localStorage cuma
     kebaca setelah hydration (render server ny gak boleh beda). */
  return useSyncExternalStore(langganan, () => pref, () => PREF_BAWAAN);
}

/* ---------- Mesin audio backsound (dibikin pas pertama kali dipake) ---------- */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let backNodes: { stop: () => void } | null = null;

/* ---------- Konfigurasi backsound (SATU tempat) ----------
   Sekarang 1 backsound doang. Mau ganti lagu: timpa file ny di
   public/aset/backsound/utama.mp3 ATAU ganti src di bawah. Mau
   nambah pilihan laen nanti: tambah baris di daftar + (kalau udah
   mau UI ny) ganti BACKSOUND_AKTIF jadi state. volume = bobot
   backsound di bawah volume utama (biar gak ngebras SFX). */
const BACKSOUND = {
  utama: { src: "/aset/backsound/utama.mp3", volume: 0.45 },
} as const;
const BACKSOUND_AKTIF: keyof typeof BACKSOUND = "utama";

/* Elemen <audio> buat file backsound: satu doang, di-loop, cuma
   diunduh pas pertama kali diputar (preload none). Gagal (file
   gak ada / codec) -> tandain + drone sintesis ambil alih. */
let backEl: HTMLAudioElement | null = null;
let backFade: ReturnType<typeof setInterval> | null = null;
let backPakaiSynth = false;

function elemenBack(): HTMLAudioElement {
  if (!backEl) {
    backEl = new Audio(BACKSOUND[BACKSOUND_AKTIF].src);
    backEl.loop = true;
    backEl.preload = "none";
    backEl.addEventListener(
      "error",
      () => {
        backPakaiSynth = true;
        /* Kalau user udah minta bunyi tapi file ny gak ada, drone
           sintesis nyambung biar backsound tetep jalan. */
        if (pref.back && !backNodes) mulaiBackSynth();
      },
      { once: true }
    );
  }
  return backEl;
}

/* Volume tujuan file backsound: volume utama x bobot backsound
   (SFX pake volume utama mentah, jadi backsound selalu duduk di
   bawah ny, seimbang di setting apapun). */
function volumeBack(): number {
  return Math.min(1, Math.max(0, pref.volume * BACKSOUND[BACKSOUND_AKTIF].volume));
}

/* Fade manual (HTMLAudio gak punya ramp sendiri): langkah 30ms.
   selesai? callback opsional (misal pause abis fade-out). */
function fadeBack(ke: number, ms: number, selesai?: () => void) {
  if (!backEl) return;
  if (backFade) clearInterval(backFade);
  const el = backEl;
  const dari = el.volume;
  const jumlah = Math.max(1, Math.round(ms / 30));
  let i = 0;
  backFade = setInterval(() => {
    i++;
    el.volume = Math.min(1, Math.max(0, dari + (ke - dari) * (i / jumlah)));
    if (i >= jumlah) {
      if (backFade) clearInterval(backFade);
      backFade = null;
      selesai?.();
    }
  }, 30);
}

function pastikanCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = pref.volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function buatNoise(c: AudioContext): AudioBufferSourceNode {
  const panjang = c.sampleRate * 2;
  const penyangga = c.createBuffer(1, panjang, c.sampleRate);
  const data = penyangga.getChannelData(0);
  for (let i = 0; i < panjang; i++) data[i] = Math.random() * 2 - 1;
  const sumber = c.createBufferSource();
  sumber.buffer = penyangga;
  sumber.loop = true;
  return sumber;
}

/* Drone sintesis (CADANGAN, kalau file backsound gak ada): pad dua
   nada detuned (A2 + E3) lewat lowpass, plus desis kertas nyaris
   gak kedengeran. Volume ny naik turun pelan biar hidup. */
function mulaiBackSynth() {
  const c = pastikanCtx();
  if (!c || !master) return;

  const pad = c.createGain();
  pad.gain.value = 0;
  const lowpass = c.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 340;
  pad.connect(lowpass).connect(master);

  const nada = [
    { f: 110, g: 0.5 },
    { f: 164.81, g: 0.34 },
    { f: 220.6, g: 0.18 },
  ].map(({ f, g }) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.detune.value = (Math.random() - 0.5) * 6;
    const gn = c.createGain();
    gn.gain.value = g;
    o.connect(gn).connect(pad);
    o.start();
    return o;
  });

  const desis = buatNoise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1400;
  band.Q.value = 0.6;
  const gDesis = c.createGain();
  gDesis.gain.value = 0.014;
  desis.connect(band).connect(gDesis).connect(master);
  desis.start();

  // masuk pelan, terus napas pelan (LFO 0.04 Hz)
  const t = c.currentTime;
  pad.gain.setValueAtTime(0.0001, t);
  pad.gain.linearRampToValueAtTime(0.075, t + 3);
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.04;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.02;
  lfo.connect(lfoG).connect(pad.gain);
  lfo.start();

  backNodes = {
    stop: () => {
      const t2 = c.currentTime;
      pad.gain.cancelScheduledValues(t2);
      pad.gain.setTargetAtTime(0.0001, t2, 0.4);
      gDesis.gain.setTargetAtTime(0.0001, t2, 0.4);
      setTimeout(() => {
        nada.forEach((o) => o.stop());
        desis.stop();
        lfo.stop();
      }, 1600);
    },
  };
}

function hentiBackSynth() {
  backNodes?.stop();
  backNodes = null;
}

/* ---------- Kontrol backsound (file utama, drone sintesis cadangan) ---------- */

function backFileMain(): boolean {
  return !!backEl && !backEl.paused && !backEl.ended;
}

/* Nyala: putar file backsound (fade-in panjang, masuknya pelan).
   Autoplay keblok? diam aja, nyala pas gesture berikutny. */
function mulaiBack() {
  const c = pastikanCtx();
  if (!c || !master) return;
  if (backFileMain() || backNodes) return; /* udah jalan */
  if (backPakaiSynth) {
    mulaiBackSynth();
    return;
  }
  const el = elemenBack();
  el.volume = 0;
  el.play()
    .then(() => fadeBack(volumeBack(), 2200))
    .catch(() => {});
}

/* Mati: fade-out dulu baru pause (gak dipotong kasar). */
function hentiBack() {
  if (backFileMain() && backEl) {
    const el = backEl;
    fadeBack(0, 900, () => el.pause());
    return;
  }
  hentiBackSynth();
}

/* ---------- Efek suara (file .mp3 di /aset/suara) ---------- */

export type NamaSfx =
  | "ui-button"
  | "ui-menu"
  | "ui-dissolve"
  | "digital-burst"
  | "failure"
  | "data-load"
  | "notification"
  | "system-alert";

const NAMA_SAH: NamaSfx[] = [
  "ui-button",
  "ui-menu",
  "ui-dissolve",
  "digital-burst",
  "failure",
  "data-load",
  "notification",
  "system-alert",
];

const pool = new Map<string, HTMLAudioElement>();
const rusak = new Set<string>();
const terakhirMain = new Map<string, number>();
const JEDA_MS = 70;

function ambilAudio(nama: NamaSfx): HTMLAudioElement | null {
  if (typeof window === "undefined" || rusak.has(nama)) return null;
  let a = pool.get(nama);
  if (!a) {
    a = new Audio("/aset/suara/" + nama + ".mp3");
    a.preload = "auto";
    a.addEventListener("error", () => rusak.add(nama), { once: true });
    pool.set(nama, a);
  }
  return a;
}

function bunyi(nama: NamaSfx) {
  if (!pref.sfx || typeof window === "undefined") return;
  const kini = performance.now();
  if (kini - (terakhirMain.get(nama) || 0) < JEDA_MS) return;
  terakhirMain.set(nama, kini);
  const a = ambilAudio(nama);
  if (!a) return;
  a.volume = Math.min(1, Math.max(0, pref.volume));
  a.currentTime = 0;
  a.play().catch(() => {});
}

/* Dipanggil dari kode pas kejadian ny beneran terjadi (sukses, error,
   notifikasi). Bunyi tekan-tombol biasa gak lewat sini (lihat
   listener global di bawah). */
export function mainkanSfx(nama: NamaSfx) {
  bunyi(nama);
}

/* ---------- Bunyi otomatis buat semua tombol/link ---------- */
/* Satu listener global (capture) nyambung ke dokumen: klik di elemen
   interaktif -> bunyi click ringan. Elemen bisa ngasih bunyi khusus
   lewat data-sfx="nama" atau matiin bunyi ny lewat data-sfx="diam".
   Keyboard (Enter/Space) ikut ke tangkep karena browser ny pun
   emiten event click. */

if (typeof window !== "undefined") {
  document.addEventListener(
    "click",
    (e) => {
      const sasaran = e.target as Element | null;
      if (!sasaran || typeof sasaran.closest !== "function") return;
      const el = sasaran.closest<HTMLElement>(
        'button, a, summary, label, [role="button"], [role="checkbox"], [role="switch"], [role="tab"], .pilih-file'
      );
      if (!el || el.hasAttribute("disabled")) return;
      const tanda = el.closest<HTMLElement>("[data-sfx]");
      const nilai = tanda?.dataset.sfx;
      if (nilai === "diam") return;
      if (nilai && (NAMA_SAH as string[]).includes(nilai)) {
        bunyi(nilai as NamaSfx);
        return;
      }
      bunyi("ui-button");
    },
    { capture: true, passive: true }
  );
}

/* ---------- Kontrol (dipanggil tombol / pengaturan) ---------- */

export function setBack(nyala: boolean) {
  pref = { ...pref, back: nyala };
  simpan();
  if (nyala) mulaiBack();
  else hentiBack();
}

export function setVolume(v: number) {
  const vol = Math.min(1, Math.max(0, v));
  pref = { ...pref, volume: vol };
  simpan();
  if (master) master.gain.setTargetAtTime(vol, ctx?.currentTime ?? 0, 0.05);
  /* File backsound ikut volume utama (fade cepet: ini slider,
     bukan on/off, gak perlu ramp panjan). */
  if (backFileMain()) fadeBack(volumeBack(), 120);
}

export function setSfx(nyala: boolean) {
  pref = { ...pref, sfx: nyala };
  simpan();
}

/* Dipanggil sekali pas pertama kali user megang kontrol suara:
   bikin context dulu (kebijakan autoplay browser) + panasin bunyi
   yang paling sering dipake biar responsif. */
export function bangunkanAudio() {
  pastikanCtx();
  /* mulaiBack punya penjaga sendiri (udah jalan/file vs synth),
     jadi gak perlu syarat !backNodes lagi: file backsound yang
     ke-pause gara-gara autoplay policy dilanjutin di sini. */
  if (pref.back) mulaiBack();
  if (pref.sfx) {
    ambilAudio("ui-button");
    ambilAudio("ui-menu");
  }
}

/* Browser ngeblok suara sebelum ada sentuhan user. Kalau user kemaren
   nyalain backsound, preferensi ny disimpen tapi bunyi ny baru mulai
   pas sentuhan pertama (pointerdown sekali), bukan autoplay. */
if (typeof window !== "undefined" && (pref.back || pref.sfx)) {
  window.addEventListener(
    "pointerdown",
    () => bangunkanAudio(),
    { capture: true, once: true }
  );
}

/* Kecil, buat ngecek keadaan audio dari console/devtools. */
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__suara = {
    konteks: () => ctx?.state ?? null,
    main: () => backFileMain() || backNodes !== null,
    mainFile: () => backFileMain(),
    mainSynth: () => backNodes !== null,
    pref: () => ({ ...pref }),
    sfxRusak: () => [...rusak],
  };
}
