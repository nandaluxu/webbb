"use client";

/* TIC TAC TOE — game klasik sembilan kotak (r35).
   ------------------------------------------------------------
   Arsitektur (nurut brief integrasi, diadaptasi ke React):

   - SATU sumber kebenaran: state `posisi` (useReducer). SEMUA
     perubahan game (klik kotak, undo, reset, replay, pesan online)
     lewat satu jalur pusat: hitung `peredam(posisi, aksi)` dulu,
     baru dispatch. Urutan satu langkah: state diupdate (menang
     kedeteksi DI REDUCER — satu klik langsung keliatan, gak nunggu
     klik kedua) -> React render (DOM) -> effect (bunyi, konfeti,
     garis menang, skor) -> giliran udah pindah di state yang sama
     -> CPU dijadwalkan oleh effect giliran O.

   - Tiga mode: "cpu" (offline, minimax), "lokal" (dua orang gantian
     satu device), "online" (room code 4 huruf, sinkronisasi
     relay server /api/ttt + polling — lintas device).

   - Sinkronisasi online STATE-BASED: tiap pesan bawa posisi penuh.
     Penerima gak percaya board mentahny — dia BANGUN ULANG state
     dari riwayat langkah (susunDariRiwayat), jadi pesan rusak/nyasar
     gak bisa ngerusak game. (Brief nyebut version number buat deteksi
     pesan gak berurutan; karena tiap pesan bawa SELURUH posisi,
     pesan lawan selalu lebih baru dari apapun yang telat — gak ada
     yang bisa di-apply dua kali.)

   - Undo: cpu = pop sampai giliran balik ke pemain (biasanya 2
     langkah: langkah lo + langkah CPU), lokal = 1 langkah,
     online = DIMATIIN (sesuai brief: biar adil, gak ada negosiasi
     undo antar dua device).

   - Replay: loop async + token pembatal (tokenPutar di-increment
     tiap reset/replay baru/undo/ganti mode) — replay lama mati
     sendiri di titik jeda berikutny, gak pernah nyangkut.

   - Skor per mode (menang X / menang O / seri), localStorage, reset
     lewat komponen Konfirmasi situs.

   - Suara: disintesis Web Audio (zero file, zero request eksternal),
     ngikut preferensi suara situs (mute + volume dari useSuara).
     Kotak papan diberi data-sfx="diam" biar gak dobel sama bunyi
     klik tombol global.

   - Konfeti: canvas partikel mono (tinta + keping kertas bergaris
     tinta), gravitasi + drag, cuma pas pemain menang. Reduced-motion:
     dilewatin.

   - Garis menang: endpoint dihitung dari getBoundingClientRect dua
     kotak (bukan persen CSS) -> sudut Math.atan2, panjang Math.sqrt,
     plus overhang dikit biar garisny nembus pusat mark. */

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent as KeyEv } from "react";
import { cekMenang, pilihLangkah, type Level, type Papan, type Tanda } from "@/lib/ttt-mesin";
import { catatPermainan } from "@/lib/permainan";
import { useSuara } from "@/lib/suara";
import Konfirmasi from "@/components/Konfirmasi";
import { CentangIkon, Panah, PanahKeluar, PutarIkon, ResetIkon, SalinIkon } from "@/components/ikon";

/* ---------- Tipe ---------- */

type Mode = "cpu" | "lokal" | "online";
type FaseOnline = "lobi" | "menunggu" | "menyambung" | "nyambung" | "putus";

type Posisi = {
  papan: Papan;
  giliran: Tanda;
  riwayat: number[];
  status: "jalan" | "menang" | "seri";
  pemenang: Tanda | null;
  pola: number[] | null;
};

type Aksi = { t: "mainkan"; indeks: number } | { t: "muat"; posisi: Posisi };

/* Pesan antar pemain (lewat /api/ttt). dari = id tab pengirim,
   dipake buat mastiin pesan sendiri gak keproses ulang. Omit biasa
   gak distribute di union — makany dipake helper TanpaDari. */
type Pesan =
  | { t: "hadir"; dari: string }
  | { t: "sambut"; dari: string; posisi: Posisi; ronde: number }
  | { t: "tolak"; dari: string; alasan: string }
  | { t: "keadaan"; dari: string; posisi: Posisi; ronde: number }
  | { t: "lagi"; dari: string; ronde: number }
  | { t: "ping"; dari: string }
  | { t: "pong"; dari: string }
  | { t: "pergi"; dari: string };

type TanpaDari<T> = T extends { dari: string } ? Omit<T, "dari"> : never;
type Kiriman = TanpaDari<Pesan>;

type Skor = { x: number; o: number; seri: number };
type KantongSkor = Record<Mode, Skor>;

/* ---------- Konstanta ---------- */

const POSISI_AWAL: Posisi = {
  papan: Array<Papan[number]>(9).fill(null),
  giliran: "X",
  riwayat: [],
  status: "jalan",
  pemenang: null,
  pola: null,
};

const SKOR_AWAL: KantongSkor = {
  cpu: { x: 0, o: 0, seri: 0 },
  lokal: { x: 0, o: 0, seri: 0 },
  online: { x: 0, o: 0, seri: 0 },
};

const LABEL_MODE: Record<Mode, string> = { cpu: "Lawan CPU", lokal: "Dua Pemain", online: "Online" };
const LABEL_LEVEL: Record<Level, string> = { gampang: "Gampang", sedang: "Sedang", sempurna: "Sempurna" };

const KUNCI_SKOR = "neyhra:ttt-skor";
const KUNCI_LEVEL = "neyhra:ttt-level";

/* Huruf kode room: tanpa I, L, O biar gak ketuker angka/warna mirip
   pas diketik manual. 4 huruf = 23^4 = 279.841 kombinasi, cukup
   buat MVP antar tab. */
const HURUF_KODE = "ABCDEFGHJKMNPQRSTUVWXYZ";

function kodeAcak(): string {
  let k = "";
  for (let i = 0; i < 4; i++) k += HURUF_KODE[Math.floor(Math.random() * HURUF_KODE.length)];
  return k;
}

/* Kanal lintas device lewat /api/ttt: antarmukanya meniru BroadcastChannel
   (postMessage / onmessage / close) biar protokol game gak berubah. Kirim
   diantrekan berurutan; terima lewat polling tiap ~700ms. */
class KanalServer {
  onmessage: ((e: MessageEvent) => void) | null = null;
  private tutup = false;
  private kursor: number;
  private antre: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private kode: string, awal: number) {
    this.kursor = awal;
    this.poll();
  }

  private async poll() {
    if (this.tutup) return;
    try {
      const res = await fetch("/api/ttt?kode=" + this.kode + "&after=" + this.kursor, { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as { seq: number; pesan: { seq: number; data: unknown }[] };
        for (const m of j.pesan) {
          this.kursor = Math.max(this.kursor, m.seq);
          if (!this.tutup) this.onmessage?.({ data: m.data } as MessageEvent);
        }
      }
    } catch {
      /* jaringan putus sebentar — coba lagi, watchdog yang nentuin putus */
    }
    if (!this.tutup) this.timer = setTimeout(() => void this.poll(), 700);
  }

  postMessage(pesan: unknown) {
    if (this.tutup) return;
    const kode = this.kode;
    this.antre = this.antre.then(() =>
      fetch("/api/ttt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "kirim", kode, pesan }),
        keepalive: true,
      }).catch(() => {})
    );
  }

  close() {
    this.tutup = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

async function panggilRoom(aksi: "bikin" | "cek", kode: string): Promise<{ status: number; seq: number }> {
  try {
    const res = await fetch("/api/ttt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aksi, kode }),
    });
    const j = (await res.json().catch(() => ({}))) as { seq?: number };
    return { status: res.status, seq: j.seq ?? 0 };
  } catch {
    return { status: 0, seq: 0 };
  }
}

/* Getar HP (Android/Chrome); diam-diam gak ngapa-ngapain di tempat laen. */
function getarHP(pola: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pola);
  } catch {}
}

const jeda = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ---------- Reducer: satu pintu semua perubahan game ---------- */

function peredam(s: Posisi, a: Aksi): Posisi {
  switch (a.t) {
    case "mainkan": {
      if (s.status !== "jalan") return s;
      if (!Number.isInteger(a.indeks) || a.indeks < 0 || a.indeks > 8) return s;
      if (s.papan[a.indeks]) return s;
      const papan = s.papan.slice();
      papan[a.indeks] = s.giliran;
      const riwayat = [...s.riwayat, a.indeks];
      const menang = cekMenang(papan);
      if (menang) {
        return { papan, giliran: s.giliran, riwayat, status: "menang", pemenang: menang.tanda, pola: [...menang.pola] };
      }
      if (riwayat.length >= 9) {
        return { papan, giliran: s.giliran, riwayat, status: "seri", pemenang: null, pola: null };
      }
      return { papan, giliran: s.giliran === "X" ? "O" : "X", riwayat, status: "jalan", pemenang: null, pola: null };
    }
    case "muat":
      return a.posisi;
  }
}

/* Bangun ulang posisi dari daftar langkah — dipake buat UNDO (potong
  ekor riwayat terus replay) dan buat validasi pesan online (penerima
  gak percaya papan mentah, dia replay sendiri). Langkah ngawur
  (bukan angka 0-8 / kotak udah isi) ke-skip aman sama peredam. */
function susunDariRiwayat(langkah: unknown): Posisi {
  let s = POSISI_AWAL;
  if (!Array.isArray(langkah)) return s;
  for (const i of langkah) {
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i > 8) continue;
    s = peredam(s, { t: "mainkan", indeks: i });
  }
  return s;
}

function skorSah(s: unknown): s is Skor {
  return (
    !!s &&
    typeof s === "object" &&
    typeof (s as Skor).x === "number" &&
    typeof (s as Skor).o === "number" &&
    typeof (s as Skor).seri === "number"
  );
}

/* Salin teks: clipboard API dulu, fallback textarea+execCommand buat
   context gak aman / browser lawas. */
async function salinTeks(teks: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(teks);
    return true;
  } catch {
    /* lanjut fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = teks;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ---------- Suara: disintesis Web Audio, zero file ----------
   Bunyi game spesifik (naro mark, menang, kalah, seri) dibikin di
   sini — bukan file mp3 — biar modulny gak nambah request eksternal
   apa pun. Volume + on/off ngikut preferensi suara situs lewat
   callback baca() (dipanggil tiap mau bunyi, jadi slider volume
   langsung kerasa tanpa reload). */

type SuaraTtt = {
  tanda: (t: Tanda) => void;
  menang: () => void;
  kalah: () => void;
  seri: () => void;
  tolak: () => void;
};

function buatSuaraTtt(baca: () => { nyala: boolean; volume: number }): SuaraTtt {
  let ctx: AudioContext | null = null;

  function siapkan(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  }

  function nada(freq: number, saat: number, durasi: number, bobot: number, jenis: OscillatorType = "triangle") {
    const c = siapkan();
    if (!c) return;
    const { nyala, volume } = baca();
    if (!nyala || volume <= 0) return;
    const t = c.currentTime + saat;
    const puncak = Math.max(0.0015, 0.22 * volume * bobot);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = jenis;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(puncak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durasi);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + durasi + 0.04);
  }

  return {
    /* X = pling tinggi + ngetem (baja), O = lebih rendah + lembut —
       tiap tandany kedengeran beda. */
    tanda: (t) => (t === "X" ? nada(680, 0, 0.09, 0.85, "triangle") : nada(432, 0, 0.11, 0.8, "sine")),
    menang: () => {
      nada(523.25, 0, 0.12, 0.7);
      nada(659.25, 0.095, 0.12, 0.7);
      nada(783.99, 0.19, 0.12, 0.7);
      nada(1046.5, 0.285, 0.22, 0.75);
    },
    kalah: () => {
      nada(392, 0, 0.14, 0.7);
      nada(261.63, 0.15, 0.26, 0.7);
    },
    seri: () => {
      nada(440, 0, 0.1, 0.65);
      nada(440, 0.14, 0.2, 0.6);
    },
    /* Ketukan rendah pendek: "gak bisa" tanpa nada marah. */
    tolak: () => nada(196, 0, 0.09, 0.55, "triangle"),
  };
}

/* ---------- Konfeti kertas & tinta (canvas) ----------
   Dua meriam dari sisi kiri-kanan papan, bukan satu ledakan. Isinya:
   kotak tinta, keping kertas bergaris tinta, pita keriting, dan
   potongan X / O kecil (tema game). Tiap keping berputar + "ngepak"
   (skala sumbu-Y berosilasi) kayak kertas beneran. Physics: drag +
   gravitasi + goyang horizontal pelan.

   KENAPA canvas ini di-portal ke <body>: dulu dia anak papan, dan papan
   punya animasi transform (geter, tumbuk) — elemen position:fixed di
   dalam ancestor ber-transform jadi relatif ke ancestor itu, bukan
   viewport, makanya konfeti "nyasar" / kepotong di sekitar papan.
   Sekarang canvas selalu full viewport, koordinat meriam diambil dari
   getBoundingClientRect papan pas ledakan.

   Reduced-motion: gak jalan. Balikin fungsi stop: batalin frame +
   bersihin canvas (dipanggil pas ada ledakan baru, game di-reset,
   ganti mode, atau unmount). */

function ledakkanKonfeti(canvas: HTMLCanvasElement, papan?: DOMRect): () => void {
  let raf = 0;
  const ctx = canvas.getContext("2d");
  const bersih = () => {
    cancelAnimationFrame(raf);
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };
  if (typeof window === "undefined" || !ctx) return bersih;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return bersih;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const akar = getComputedStyle(document.documentElement);
  const tinta = akar.getPropertyValue("--ink").trim() || "#0A0A0A";
  const kertas = akar.getPropertyValue("--bg").trim() || "#FAFAF7";
  const abu = akar.getPropertyValue("--muted").trim() || "#6F6F6A";

  type Jenis = "kotak" | "kertas" | "pita" | "x" | "o";
  type Partikel = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    vr: number;
    ukuran: number;
    pipih: number;
    fase: number;
    umur: number;
    awal: number;
    jenis: Jenis;
    warna: string;
  };

  const pusat = papan ? { x: papan.left + papan.width / 2, y: papan.top + papan.height / 2 } : { x: w / 2, y: h * 0.45 };
  /* Meriam: kiri-bawah & kanan-bawah papan, nembak miring ke atas-tengah. */
  const meriam = papan
    ? [
        { x: papan.left - 6, y: papan.bottom - papan.height * 0.12, arah: -Math.PI / 2 + 0.55 },
        { x: papan.right + 6, y: papan.bottom - papan.height * 0.12, arah: -Math.PI / 2 - 0.55 },
      ]
    : [{ x: pusat.x, y: pusat.y, arah: -Math.PI / 2 }];

  const jenisPool: Jenis[] = ["kotak", "kotak", "kertas", "kertas", "pita", "x", "o"];
  const partikel: Partikel[] = [];
  for (const m of meriam) {
    const jumlah = papan ? 64 : 110;
    for (let i = 0; i < jumlah; i++) {
      const sudut = m.arah + (Math.random() - 0.5) * 0.95;
      const laju = 9 + Math.random() * 11;
      const jenis = jenisPool[Math.floor(Math.random() * jenisPool.length)];
      partikel.push({
        x: m.x,
        y: m.y,
        vx: Math.cos(sudut) * laju,
        vy: Math.sin(sudut) * laju,
        r: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        ukuran: jenis === "x" || jenis === "o" ? 9 + Math.random() * 7 : jenis === "pita" ? 16 + Math.random() * 12 : 5 + Math.random() * 6,
        pipih: Math.random() < 0.4 ? 0.45 : 1,
        fase: Math.random() * Math.PI * 2,
        umur: 0,
        awal: 130 + Math.floor(Math.random() * 70),
        jenis,
        warna: Math.random() < 0.7 ? tinta : abu,
      });
    }
  }

  const langkah = () => {
    let ada = false;
    ctx.clearRect(0, 0, w, h);
    for (const p of partikel) {
      if (p.umur >= p.awal || p.y > h + 60) continue;
      ada = true;
      p.umur++;
      p.vx *= 0.978;
      p.vy = p.vy * 0.978 + 0.3;
      p.x += p.vx + Math.sin(p.umur * 0.09 + p.fase) * 0.55;
      p.y += p.vy;
      p.r += p.vr;
      const sisa = 1 - p.umur / p.awal;
      const ngepak = Math.cos(p.umur * 0.2 + p.fase);
      ctx.save();
      ctx.globalAlpha = sisa < 0.25 ? sisa / 0.25 : 1;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.scale(1, 0.25 + Math.abs(ngepak) * 0.75);
      ctx.strokeStyle = p.warna;
      ctx.fillStyle = p.warna;
      ctx.lineCap = "round";
      const u = p.ukuran;
      if (p.jenis === "kotak") {
        ctx.fillRect(-u / 2, (-u * p.pipih) / 2, u, u * p.pipih);
      } else if (p.jenis === "kertas") {
        ctx.fillStyle = kertas;
        ctx.strokeStyle = tinta;
        ctx.lineWidth = 1;
        ctx.fillRect(-u / 2, (-u * p.pipih) / 2, u, u * p.pipih);
        ctx.strokeRect(-u / 2, (-u * p.pipih) / 2, u, u * p.pipih);
      } else if (p.jenis === "pita") {
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let t = 0; t <= 1.001; t += 0.125) ctx.lineTo((t - 0.5) * u, Math.sin(t * Math.PI * 2 + p.fase) * u * 0.18);
        ctx.stroke();
      } else if (p.jenis === "x") {
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-u / 2, -u / 2);
        ctx.lineTo(u / 2, u / 2);
        ctx.moveTo(u / 2, -u / 2);
        ctx.lineTo(-u / 2, u / 2);
        ctx.stroke();
      } else {
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, u / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (ada) raf = requestAnimationFrame(langkah);
    else ctx.clearRect(0, 0, w, h);
  };
  raf = requestAnimationFrame(langkah);
  return bersih;
}

/* ---------- Komponen utama ---------- */

export default function TicTacToe() {
  const [posisi, dispatch] = useReducer(peredam, POSISI_AWAL);
  const [mode, setMode] = useState<Mode>("cpu");
  const [level, setLevel] = useState<Level>("sedang");
  const [skor, setSkor] = useState<KantongSkor>(SKOR_AWAL);
  const [putar, setPutar] = useState({ aktif: false, sampai: 0 });

  /* Online */
  const [faseOnline, setFaseOnline] = useState<FaseOnline>("lobi");
  const [kode, setKode] = useState("");
  const [masukKode, setMasukKode] = useState("");
  const [galatJoin, setGalatJoin] = useState("");
  const [tandaKu, setTandaKu] = useState<Tanda>("X");
  const [disalin, setDisalin] = useState(false);
  const [nyerahNunggu, setNyerahNunggu] = useState(false);

  const [terpasang, setTerpasang] = useState(false);
  const [peringatan, setPeringatan] = useState("");
  const [getar, setGetar] = useState(0);
  const [beruntun, setBeruntun] = useState(0);
  const timerPeringatan = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [konfirmSkor, setKonfirmSkor] = useState(false);
  const [garis, setGaris] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  /* Preferensi suara situs (mute + volume) — dibaca lewat ref biar
     synth-nya gak pernah dibikin ulang tapi selalu kerasa nilainy
     yang terbaru. */
  const pref = useSuara();
  const prefRef = useRef(pref);
  const suaraRef = useRef<SuaraTtt | null>(null);

  /* Synth suara dibikin MALES pas pertama kali dibutuhin (bukan di
     render): AudioContext cuma kebikin pas beneran mau bunyi, dan
     preferensi (mute/volume) selalu kebaca pas bunyi ny kejadian. */
  function bunyiAja(): SuaraTtt {
    if (!suaraRef.current) {
      suaraRef.current = buatSuaraTtt(() => ({ nyala: prefRef.current.sfx, volume: prefRef.current.volume }));
    }
    return suaraRef.current;
  }

  /* Id tab: pembeda pesan sendiri vs pesan lawan di kanal yang sama. */
  const idKu = useMemo(() => Math.random().toString(36).slice(2, 10), []);

  const kanalRef = useRef<KanalServer | null>(null);
  const tokenPutar = useRef(0);
  const papanRef = useRef<HTMLDivElement | null>(null);
  const selRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const konfetiRef = useRef<HTMLCanvasElement | null>(null);
  const konfetiStopRef = useRef<(() => void) | null>(null);
  const dengarRef = useRef(0);
  const usahaJoinRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skorMuatRef = useRef(false);
  const selesaiTandaiRef = useRef(false);
  const panjangLamaRef = useRef(0);
  const klikSelRef = useRef<(i: number) => void>(() => {});

  /* Cermin state buat handler kanal (closure-nya gak boleh basi).
     Nilainy di-update di effect (bukan pas render) — pembacaany
     semua dari event/effect yang jalan abis commit, jadi tetep segar. */
  const faseRef = useRef(faseOnline);
  const posisiRef = useRef(posisi);
  const tandaKuRef = useRef(tandaKu);
  /* Nomor ronde: naik tiap "Ulang/Main lagi". Pesan dari ronde lama
     (mis. langkah yang telat nyampe setelah lawan reset) dibuang, biar
     dua sisi gak pernah beda papan. */
  const rondeRef = useRef(0);

  /* ---------- Kanal online ---------- */

  const kirimPesan = useCallback(
    (m: Kiriman) => {
      const k = kanalRef.current;
      if (!k) return;
      try {
        k.postMessage({ ...m, dari: idKu });
      } catch {
        /* kanal udah ketutup di tengah jalan — diam aja */
      }
    },
    [idKu]
  );

  const tutupKanal = useCallback(() => {
    const k = kanalRef.current;
    kanalRef.current = null;
    if (k) {
      k.onmessage = null;
      try {
        k.close();
      } catch {}
    }
  }, []);

  const terimaRef = useRef<(e: MessageEvent) => void>(() => {});

  const bukaKanal = useCallback(
    (kodeBaru: string, awal = 0) => {
      tutupKanal();
      const k = new KanalServer(kodeBaru, awal);
      k.onmessage = (e) => terimaRef.current(e);
      kanalRef.current = k;
      return true;
    },
    [tutupKanal]
  );

  /* Handler pesan masuk. Semua keputusan pakai cermin ref (faseRef
     dll.) biar selalu baca keadaan terbaru. Pesan keadaan/sambut
     GAK dipercaya mentah-mentah: papan dibangun ulang dari riwayat
     (susunDariRiwayat), jadi pesan rusak gak bisa ngerusak game. */
  function terima(e: MessageEvent) {
    const m = e.data as Pesan | null;
    if (!m || typeof m !== "object" || m.dari === idKu) return;
    const dengarLama = dengarRef.current;
    dengarRef.current = Date.now();

    switch (m.t) {
      case "hadir": {
        if (tandaKuRef.current !== "X") return; /* cuma host yang nyambutin */
        const f = faseRef.current;
        if (f === "menunggu" || f === "putus") {
          kirimPesan({ t: "sambut", posisi: posisiRef.current, ronde: rondeRef.current });
          setFaseOnline("nyambung");
          setNyerahNunggu(false);
        } else if (f === "nyambung" && Date.now() - dengarLama < 2500) {
          /* Ada tab laen nyoba masuk padahal lawan asli masih aktif. */
          kirimPesan({ t: "tolak", alasan: "Roomny udah keduluan diisi orang laen." });
        } else {
          /* Lawan asli yang ke-refresh/glitch — sambut lagi + sinkron. */
          kirimPesan({ t: "sambut", posisi: posisiRef.current, ronde: rondeRef.current });
        }
        break;
      }
      case "sambut": {
        if (tandaKuRef.current !== "O" || faseRef.current !== "menyambung") return;
        if (usahaJoinRef.current) {
          clearTimeout(usahaJoinRef.current);
          usahaJoinRef.current = null;
        }
        rondeRef.current = typeof m.ronde === "number" ? m.ronde : 0;
        dispatch({ t: "muat", posisi: susunDariRiwayat(m.posisi?.riwayat) });
        setFaseOnline("nyambung");
        break;
      }
      case "tolak": {
        if (faseRef.current !== "menyambung") return;
        if (usahaJoinRef.current) {
          clearTimeout(usahaJoinRef.current);
          usahaJoinRef.current = null;
        }
        tutupKanal();
        setFaseOnline("lobi");
        setGalatJoin(m.alasan || "Roomny nolak.");
        break;
      }
      case "keadaan": {
        if (faseRef.current !== "nyambung" && faseRef.current !== "putus") return;
        const ronde = typeof m.ronde === "number" ? m.ronde : 0;
        if (ronde < rondeRef.current) return; /* pesan basi dari ronde lama */
        rondeRef.current = ronde;
        dispatch({ t: "muat", posisi: susunDariRiwayat(m.posisi?.riwayat) });
        if (faseRef.current === "putus") {
          setFaseOnline("nyambung");
          setNyerahNunggu(false);
        }
        break;
      }
      case "lagi": {
        if (faseRef.current !== "nyambung" && faseRef.current !== "putus") return;
        const ronde = typeof m.ronde === "number" ? m.ronde : 0;
        if (ronde < rondeRef.current) return;
        rondeRef.current = ronde;
        konfetiStopRef.current?.();
        tokenPutar.current++;
        setPutar({ aktif: false, sampai: 0 });
        dispatch({ t: "muat", posisi: POSISI_AWAL });
        if (faseRef.current === "putus") {
          setFaseOnline("nyambung");
          setNyerahNunggu(false);
        }
        break;
      }
      case "ping":
        kirimPesan({ t: "pong" });
        /* Lawan masih hidup — keluar dari status putus (mis. tab-nya
           sempat di-throttle browser). Tanpa ini papan nyangkut disabled. */
        if (faseRef.current === "putus") {
          setFaseOnline("nyambung");
          setNyerahNunggu(false);
        }
        break;
      case "pong":
        if (faseRef.current === "putus") {
          setFaseOnline("nyambung");
          setNyerahNunggu(false);
        }
        break;
      case "pergi":
        if (faseRef.current === "nyambung") setFaseOnline("putus");
        break;
    }
  }

  /* ---------- Aksi game ---------- */

  function gantiMode(m: Mode) {
    if (m === mode) return;
    /* Keluar dari online: kabarin lawan + tutup kanal (dia gak perlu
       nunggu timeout heartbeat). */
    if (mode === "online" && kanalRef.current) kirimPesan({ t: "pergi" });
    konfetiStopRef.current?.();
    if (usahaJoinRef.current) {
      clearTimeout(usahaJoinRef.current);
      usahaJoinRef.current = null;
    }
    tutupKanal();
    setKode("");
    setMasukKode("");
    setGalatJoin("");
    setFaseOnline("lobi");
    setNyerahNunggu(false);
    tokenPutar.current++;
    setPutar({ aktif: false, sampai: 0 });
    setBeruntun(0);
    setPeringatan("");
    setMode(m);
    dispatch({ t: "muat", posisi: POSISI_AWAL });
  }

  /* Klik yang gak boleh: papan geter sebentar + satu kalimat yang
     bilang kenapa (bukan diem aja). */
  function tolakKlik(teks: string) {
    setPeringatan(teks);
    setGetar((g) => g + 1);
    bunyiAja().tolak();
    if (timerPeringatan.current) clearTimeout(timerPeringatan.current);
    timerPeringatan.current = setTimeout(() => setPeringatan(""), 1900);
  }

  function klikSel(i: number) {
    if (putar.aktif || posisi.status !== "jalan") return;
    if (posisi.papan[i]) return tolakKlik("Kotak itu sudah terisi");
    if (mode === "cpu" && posisi.giliran !== "X") return tolakKlik("CPU masih mikir, tunggu sebentar");
    if (mode === "online") {
      if (faseOnline !== "nyambung") return tolakKlik("Belum nyambung ke lawan");
      if (posisi.giliran !== tandaKu) return tolakKlik("Belum giliran kamu, lawan lagi jalan");
    }
    if (peringatan) setPeringatan("");
    const baru = peredam(posisi, { t: "mainkan", indeks: i });
    dispatch({ t: "muat", posisi: baru });
    if (mode === "online") kirimPesan({ t: "keadaan", posisi: baru, ronde: rondeRef.current });
  }

  /* Cermin state + handler di-update tiap render lewat effect:
     gak ada akses ref pas render, tapi semua pembaca tetep dapet
     nilai terbaru (event/effect selalu jalan abis commit). */
  useEffect(() => {
    prefRef.current = pref;
    faseRef.current = faseOnline;
    posisiRef.current = posisi;
    tandaKuRef.current = tandaKu;
    terimaRef.current = terima;
    klikSelRef.current = klikSel;
  });

  /* Undo. CPU: pop 1, kalau sisany jadi giliran CPU pop sekali lagi
     (dua langkah sekaligus — giliran tetep di pemain). Lokal: 1
     langkah. Online: dimatiin (biar adil, gak ada debat undo). */
  function batalkan() {
    if (mode === "online" || !posisi.riwayat.length || putar.aktif) return;
    konfetiStopRef.current?.();
    tokenPutar.current++;
    setPutar({ aktif: false, sampai: 0 });
    let n = 1;
    if (mode === "cpu" && posisi.riwayat.length >= 2) {
      const cek = susunDariRiwayat(posisi.riwayat.slice(0, -1));
      if (cek.giliran === "O") n = 2;
    }
    dispatch({ t: "muat", posisi: susunDariRiwayat(posisi.riwayat.slice(0, posisi.riwayat.length - n)) });
  }

  /* Ulang dari awal (Main lagi). Online: kedua sisi ke-reset —
     satu klik "lagi" di satu sisi, sisi satunya ikut. */
  function mulaiBaru() {
    konfetiStopRef.current?.();
    tokenPutar.current++;
    setPutar({ aktif: false, sampai: 0 });
    dispatch({ t: "muat", posisi: POSISI_AWAL });
    if (mode === "online" && kanalRef.current) {
      rondeRef.current++;
      kirimPesan({ t: "lagi", ronde: rondeRef.current });
    }
  }

  async function putarUlang() {
    if (!posisi.riwayat.length) return;
    konfetiStopRef.current?.();
    const token = ++tokenPutar.current;
    setPutar({ aktif: true, sampai: 0 });
    for (let i = 1; i <= posisi.riwayat.length; i++) {
      await jeda(i === 1 ? 520 : 640);
      if (tokenPutar.current !== token) return;
      setPutar({ aktif: true, sampai: i });
      bunyiAja().tanda(i % 2 === 1 ? "X" : "O");
    }
    await jeda(1050);
    if (tokenPutar.current !== token) return;
    setPutar({ aktif: false, sampai: 0 });
  }

  function stopPutar() {
    tokenPutar.current++;
    setPutar({ aktif: false, sampai: 0 });
  }

  function gantiLevel(l: Level) {
    setLevel(l);
    try {
      localStorage.setItem(KUNCI_LEVEL, l);
    } catch {}
  }

  function resetSkor() {
    setSkor((s) => ({ ...s, [mode]: { x: 0, o: 0, seri: 0 } }));
    setKonfirmSkor(false);
  }

  /* ---------- Aksi room online ---------- */

  async function bikinRoom() {
    setGalatJoin("");
    let k = "";
    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) {
      k = kodeAcak();
      const h = await panggilRoom("bikin", k);
      if (h.status === 200) ok = true;
      else if (h.status !== 409) break;
    }
    if (!ok) {
      setGalatJoin("Gak bisa bikin room — servernya gak kejangkau. Coba lagi bentar.");
      return;
    }
    setKode(k);
    setTandaKu("X");
    setNyerahNunggu(false);
    rondeRef.current = 0;
    dispatch({ t: "muat", posisi: POSISI_AWAL });
    if (bukaKanal(k)) setFaseOnline("menunggu");
  }

  async function gabungRoom() {
    const k = masukKode.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(k)) {
      setGalatJoin("Kode room 4 huruf kapital (huruf I, L, O gak dipake biar gak ketuker). Contoh: BKXP.");
      return;
    }
    setGalatJoin("");
    const h = await panggilRoom("cek", k);
    if (h.status === 404) {
      setGalatJoin("Roomny gak ketemu. Pastiin kode ny bener dan room ny belum kadaluarsa (room mati kalau gak aktif 30 menit).");
      return;
    }
    if (h.status !== 200) {
      setGalatJoin("Gak bisa nyambung ke server. Cek koneksi lu terus coba lagi.");
      return;
    }
    setKode(k);
    setTandaKu("O");
    setNyerahNunggu(false);
    rondeRef.current = 0;
    if (!bukaKanal(k, h.seq)) return;
    setFaseOnline("menyambung");
    kirimPesan({ t: "hadir" });
    if (usahaJoinRef.current) clearTimeout(usahaJoinRef.current);
    usahaJoinRef.current = setTimeout(() => {
      usahaJoinRef.current = null;
      if (faseRef.current === "menyambung") {
        tutupKanal();
        setFaseOnline("lobi");
        setGalatJoin("Room ada, tapi pembuatnya gak nyahut. Minta dia buka ulang halaman room ny atau bikin room baru.");
      }
    }, 8000);
  }

  function batalRoom() {
    if (usahaJoinRef.current) {
      clearTimeout(usahaJoinRef.current);
      usahaJoinRef.current = null;
    }
    tutupKanal();
    setKode("");
    setMasukKode("");
    setGalatJoin("");
    setFaseOnline("lobi");
    dispatch({ t: "muat", posisi: POSISI_AWAL });
  }

  async function salinKode() {
    const ok = await salinTeks(kode);
    setDisalin(ok);
    setTimeout(() => setDisalin(false), 1800);
  }

  async function bagikanKode() {
    const teks = "Main Tic Tac Toe bareng gw! Kode room: " + kode;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Tic Tac Toe · Neyhra Playground", text: teks });
        return;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      /* share gagal lintas alasan -> fallback salin */
    }
    const ok = await salinTeks(kode);
    setDisalin(ok);
    setTimeout(() => setDisalin(false), 1800);
  }

  /* ---------- Efek ---------- */

  /* Canvas konfeti di-portal ke body (lihat catatan di ledakkanKonfeti):
     baru ada setelah mount supaya render server = render client awal. */
  useEffect(() => setTerpasang(true), []);

  /* Muat skor + level tersimpan (efek, biar render server = render
     client pertama gak pernah beda). */
  useEffect(() => {
    try {
      const mentah: unknown = JSON.parse(localStorage.getItem(KUNCI_SKOR) || "null");
      if (mentah && typeof mentah === "object") {
        const m = mentah as Record<string, unknown>;
        setSkor({
          cpu: skorSah(m.cpu) ? m.cpu : SKOR_AWAL.cpu,
          lokal: skorSah(m.lokal) ? m.lokal : SKOR_AWAL.lokal,
          online: skorSah(m.online) ? m.online : SKOR_AWAL.online,
        });
      }
    } catch {}
    skorMuatRef.current = true;
    try {
      const l = localStorage.getItem(KUNCI_LEVEL);
      if (l === "gampang" || l === "sedang" || l === "sempurna") setLevel(l);
    } catch {}
  }, []);

  useEffect(() => {
    if (!skorMuatRef.current) return;
    try {
      localStorage.setItem(KUNCI_SKOR, JSON.stringify(skor));
    } catch {}
  }, [skor]);

  /* CPU jalan pas giliran O di mode cpu. Timer dibatalin otomatis
     tiap posisi/level/mode berubah (cleanup effect) — undo, reset,
     ganti level, semuany aman, gak ada langkah CPU nyasar. */
  useEffect(() => {
    if (mode !== "cpu" || posisi.status !== "jalan" || posisi.giliran !== "O") return;
    const t = setTimeout(
      () => {
        const langkah = pilihLangkah(posisi.papan, "O", level);
        if (langkah >= 0) dispatch({ t: "muat", posisi: peredam(posisi, { t: "mainkan", indeks: langkah }) });
      },
      480 + Math.random() * 420
    );
    return () => clearTimeout(t);
  }, [mode, level, posisi]);

  /* Bunyi tiap mark kepasang (naikny panjang riwayat). */
  useEffect(() => {
    const n = posisi.riwayat.length;
    if (n > panjangLamaRef.current) {
      bunyiAja().tanda(n % 2 === 1 ? "X" : "O");
      getarHP(9);
    }
    panjangLamaRef.current = n;
  }, [posisi.riwayat.length]);

  /* Game barusan beres: skor +1, bunyi, konfeti (cuma pas yang
     menang adalah "sisi lo": mode cpu = X, online = tandaKu, lokal
     = siapa aja — game santai, siapapun menang layak pesta). */
  useEffect(() => {
    if (posisi.status === "jalan") {
      selesaiTandaiRef.current = false;
      return;
    }
    if (selesaiTandaiRef.current) return;
    selesaiTandaiRef.current = true;

    /* fix26: game tamat -> nyangkut di leaderboard, dari sudut pandang
       sisi LOKAL: cpu = X (menang = ngalahin CPU), online = tanda
       sendiri, lokal = tanda pemenang (dua pemain satu device, gak
       bisa diatribusin — papan ny pun gak ngurut mode ini). Level
       CPU ikut kecatat biar "menang di Sempurna" keliatan istimewa. */
    catatPermainan({
      game: "tictactoe",
      mode,
      hasil:
        posisi.status === "seri"
          ? "seri"
          : mode === "cpu"
            ? posisi.pemenang === "X"
              ? "menang"
              : "kalah"
            : mode === "online"
              ? posisi.pemenang === tandaKu
                ? "menang"
                : "kalah"
              : posisi.pemenang === "X"
                ? "x"
                : "o",
      langkah: posisi.riwayat.length,
      catatan: mode === "cpu" ? level : "",
    });

    if (mode === "cpu") setBeruntun((b) => (posisi.status === "menang" && posisi.pemenang === "X" ? b + 1 : 0));
    if (posisi.status === "seri") {
      getarHP(30);
      setSkor((s) => ({ ...s, [mode]: { ...s[mode], seri: s[mode].seri + 1 } }));
      bunyiAja().seri();
      return;
    }
    const kunci = posisi.pemenang === "X" ? "x" : "o";
    setSkor((s) => ({ ...s, [mode]: { ...s[mode], [kunci]: s[mode][kunci] + 1 } }));
    const akuMenang = mode === "cpu" ? posisi.pemenang === "X" : mode === "online" ? posisi.pemenang === tandaKu : true;
    if (akuMenang) {
      getarHP([20, 50, 20, 50, 90]);
      bunyiAja().menang();
      /* Meriam nembak pas stempel "jatuh" (~0.7 dtk setelah menang),
         posisi papan dibaca saat itu juga biar akurat. */
      konfetiStopRef.current?.();
      let hentikan: (() => void) | null = null;
      const tunda = setTimeout(() => {
        const k = konfetiRef.current;
        const p = papanRef.current?.getBoundingClientRect();
        if (k) hentikan = ledakkanKonfeti(k, p);
      }, 700);
      konfetiStopRef.current = () => {
        clearTimeout(tunda);
        hentikan?.();
      };
    } else {
      getarHP(140);
      bunyiAja().kalah();
    }
  }, [posisi.status, posisi.pemenang, posisi.riwayat.length, mode, tandaKu, level]);

  /* Garis menang: dihitung dari posisi piksel ASLI dua kotak ujung
     (getBoundingClientRect), sudut Math.atan2, panjang Math.sqrt,
     plus overhang. Diulang pas papan ke-resize (ResizeObserver).
     Replay jalan -> garisny disembunyiin dulu. */
  useEffect(() => {
    const pola = posisi.pola;
    if (!pola || putar.aktif) return;
    const hitung = () => {
      const kotak = papanRef.current?.getBoundingClientRect();
      const a = pola[0] ?? 0;
      const c = pola[pola.length - 1] ?? 8;
      const elA = selRefs.current[a];
      const elC = selRefs.current[c];
      if (!kotak || !elA || !elC) return;
      const ra = elA.getBoundingClientRect();
      const rc = elC.getBoundingClientRect();
      const ax = ra.left + ra.width / 2 - kotak.left;
      const ay = ra.top + ra.height / 2 - kotak.top;
      const cx = rc.left + rc.width / 2 - kotak.left;
      const cy = rc.top + rc.height / 2 - kotak.top;
      const dx = cx - ax;
      const dy = cy - ay;
      const sudut = Math.atan2(dy, dx);
      const panjang = Math.sqrt(dx * dx + dy * dy);
      const lebih = Math.min(16, panjang * 0.14);
      setGaris({
        x1: ax - Math.cos(sudut) * lebih,
        y1: ay - Math.sin(sudut) * lebih,
        x2: cx + Math.cos(sudut) * lebih,
        y2: cy + Math.sin(sudut) * lebih,
      });
    };
    const raf = requestAnimationFrame(hitung);
    const ro = new ResizeObserver(hitung);
    if (papanRef.current) ro.observe(papanRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [posisi.pola, putar.aktif]);

  /* Heartbeat + watchdog koneksi: ping tiap 2 detik, dianggap putus
     kalau 6 detik gak ada kabar. Pas putus, ping tetap jalan — kalau
     lawanny balik (tab ke-buka lagi), game nyambung otomatis. */
  useEffect(() => {
    if (mode !== "online" || !kanalRef.current) return;
    if (faseOnline !== "nyambung" && faseOnline !== "putus") return;
    const id = setInterval(() => {
      kirimPesan({ t: "ping" });
      if (faseRef.current === "nyambung" && Date.now() - dengarRef.current > 6000) setFaseOnline("putus");
    }, 2000);
    return () => clearInterval(id);
  }, [mode, faseOnline, kode, kirimPesan]);

  /* Bilang pergi pas tab ketutup/ke-refresh + pas komponen bongkar. */
  useEffect(() => {
    if (mode !== "online") return;
    const pergi = () => kirimPesan({ t: "pergi" });
    window.addEventListener("pagehide", pergi);
    return () => {
      window.removeEventListener("pagehide", pergi);
      pergi();
    };
  }, [mode, kirimPesan]);

  /* Bersih-bersih total pas unmount. */
  useEffect(() => {
    return () => {
      tutupKanal();
      konfetiStopRef.current?.();
      if (timerPeringatan.current) clearTimeout(timerPeringatan.current);
    };
  }, [tutupKanal]);

  /* Online + tab lagi disembunyiin + giliran kamu: judul tab berubah
     biar kamu tau lawan udah jalan. */
  const giliranKuOnline = mode === "online" && faseOnline === "nyambung" && posisi.status === "jalan" && posisi.giliran === tandaKu;
  useEffect(() => {
    const awal = document.title.replace(/^● Giliranmu · /, "");
    const pasang = () => {
      document.title = giliranKuOnline && document.hidden ? "● Giliranmu · " + awal : awal;
    };
    pasang();
    document.addEventListener("visibilitychange", pasang);
    return () => {
      document.removeEventListener("visibilitychange", pasang);
      document.title = awal;
    };
  }, [giliranKuOnline]);

  /* Ketik 1-9 = isi kotak (numpad kebaca juga). Gak jalan pas lagi
     ngetik di input kode room. Handler-nya lewat ref biar selalu
     dapet versi klikSel terbaru tanpa daftar ulang listener. */
  useEffect(() => {
    function tombol(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 9) {
        e.preventDefault();
        klikSelRef.current(n - 1);
      }
    }
    window.addEventListener("keydown", tombol);
    return () => window.removeEventListener("keydown", tombol);
  }, []);

  /* ---------- Nilai turunan buat render ---------- */

  /* Pas replay, papan yang keliatan = potongan riwayat sampai
     langkah ke-n (bukan papan final). */
  const papanTampil = putar.aktif ? susunDariRiwayat(posisi.riwayat.slice(0, putar.sampai)).papan : posisi.papan;
  const polaTampil = putar.aktif ? null : posisi.pola;

  const aktifKah =
    posisi.status === "jalan" &&
    !putar.aktif &&
    (mode === "lokal" || (mode === "cpu" && posisi.giliran === "X") || (mode === "online" && faseOnline === "nyambung" && posisi.giliran === tandaKu));

  const labelX = mode === "cpu" ? "Kamu (X)" : mode === "online" ? (tandaKu === "X" ? "Kamu (X)" : "Lawan (X)") : "X";
  const labelO = mode === "cpu" ? "CPU (O)" : mode === "online" ? (tandaKu === "O" ? "Kamu (O)" : "Lawan (O)") : "O";
  const namaX = mode === "cpu" ? "Kamu" : mode === "online" ? (tandaKu === "X" ? "Kamu" : "Lawan") : "Pemain X";
  const namaO = mode === "cpu" ? "CPU" : mode === "online" ? (tandaKu === "O" ? "Kamu" : "Lawan") : "Pemain O";

  const bisaUndo = mode !== "online" && posisi.riwayat.length > 0 && !putar.aktif;
  const mainOnline = mode === "online" && (faseOnline === "nyambung" || faseOnline === "putus");
  const selesai = posisi.status !== "jalan" && !putar.aktif;
  const terakhir = posisi.riwayat.length ? posisi.riwayat[posisi.riwayat.length - 1] : -1;

  /* Yang lagi "dinanti": CPU mikir, atau lawan online lagi jalan. */
  const nungguLawan =
    posisi.status === "jalan" && !putar.aktif && ((mode === "cpu" && posisi.giliran === "O") || (mode === "online" && faseOnline === "nyambung" && posisi.giliran !== tandaKu));

  /* Hasil dari sudut pandang kamu: nentuin gaya stempel. */
  const hasil: "menang" | "kalah" | "seri" | "netral" | null =
    posisi.status === "seri"
      ? "seri"
      : posisi.status === "menang"
        ? mode === "lokal"
          ? "netral"
          : (mode === "cpu" ? posisi.pemenang === "X" : posisi.pemenang === tandaKu)
            ? "menang"
            : "kalah"
        : null;
  const teksStempel =
    posisi.status === "seri"
      ? "Seri"
      : (posisi.pemenang === "X" ? namaX : namaO) + " menang";

  function teksStatus(): string {
    if (putar.aktif) return "Replay, langkah " + putar.sampai + " dari " + posisi.riwayat.length;
    if (mode === "online" && faseOnline === "menunggu") return "Nunggu lawan masuk";
    if (mode === "online" && faseOnline === "menyambung") return "Nyambungin ke room";
    if (mode === "online" && faseOnline !== "nyambung" && faseOnline !== "putus") return "Bikin atau gabung room dulu";
    if (posisi.status === "menang") return (posisi.pemenang === "X" ? labelX : labelO) + " menang";
    if (posisi.status === "seri") return "Seri, papan penuh";
    if (mode === "cpu") return posisi.giliran === "X" ? "Giliran kamu" : "CPU lagi mikir";
    if (mode === "lokal") return "Giliran " + posisi.giliran;
    return posisi.giliran === tandaKu ? "Giliran kamu" : "Giliran lawan";
  }

  function navPanah(e: KeyEv) {
    const idx = selRefs.current.findIndex((el) => el === document.activeElement);
    if (idx < 0) return;
    let br = Math.floor(idx / 3);
    let kl = idx % 3;
    if (e.key === "ArrowLeft") kl = (kl + 2) % 3;
    else if (e.key === "ArrowRight") kl = (kl + 1) % 3;
    else if (e.key === "ArrowUp") br = (br + 2) % 3;
    else if (e.key === "ArrowDown") br = (br + 1) % 3;
    else return;
    e.preventDefault();
    selRefs.current[br * 3 + kl]?.focus();
  }

  /* ---------- Render ---------- */

  return (
    <>
      <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
        <filter id="ttt-tinta" filterUnits="userSpaceOnUse" x="-5" y="-5" width="110" height="110">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <section className="head">
        <h1>Tic Tac Toe</h1>
        <p className="lede">
          Sembilan kotak, garis satu piksel, lawan yang gak ngasih ampun. Lawan CPU dari level Gampang sampai Sempurna (yang
          terakhir gak bisa dikalahkan — seri udah lumayan), dua orang gantian satu HP, atau bikin room online pake kode.
        </p>
      </section>

      <div className="ttt-arena">
        {/* ---------- Kolom kiri: panggung game ---------- */}
        <div className="ttt-kiri">
          <div className="ttt-mode">
            <Segmen
              label="Mode permainan"
              nilai={mode}
              onGanti={gantiMode}
              opsi={[
                { n: "cpu", teks: "Lawan CPU" },
                { n: "lokal", teks: "Dua Pemain" },
                { n: "online", teks: "Online" },
              ]}
            />
          </div>

          {/* ----- Lobi online: bikin / gabung room ----- */}
          {mode === "online" && faseOnline === "lobi" && (
            <div className="ttt-lobi">
              <button type="button" className="btn primary ttt-btn-bikin" onClick={bikinRoom}>
                Bikin room
                <Panah />
              </button>
              <div className="ttt-gabung">
                <input
                  value={masukKode}
                  onChange={(e) => setMasukKode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
                  onKeyDown={(e) => e.key === "Enter" && gabungRoom()}
                  placeholder="KODE"
                  aria-label="Kode room (4 huruf)"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4}
                />
                <button type="button" className="btn" onClick={gabungRoom}>
                  Gabung
                </button>
              </div>
              {galatJoin && (
                <p className="ttt-galat" role="alert">
                  {galatJoin}
                </p>
              )}
              <p className="ttt-hint">
                Bikin room, terus kasih kode 4 huruf ny ke temen lu — dia buka web ini di device mana aja, pilih Online,
                masukin kode ny. Tanpa I/L/O biar gak ketuker.
              </p>
            </div>
          )}

          {/* ----- Nunggu lawan: kode gede + salin/bagikan ----- */}
          {mode === "online" && (faseOnline === "menunggu" || faseOnline === "menyambung") && (
            <div className="ttt-nunggu">
              {faseOnline === "menunggu" ? (
                <>
                  <p className="ttt-kode-label">Kode room</p>
                  <p className="ttt-kode" aria-label={"Kode room " + kode}>
                    {kode.split("").map((h, i) => (
                      <span key={i} style={{ animationDelay: i * 90 + "ms" }} aria-hidden="true">
                        {h}
                      </span>
                    ))}
                  </p>
                  <div className="ttt-nunggu-aksi">
                    <button type="button" className="btn kecil" onClick={salinKode}>
                      {disalin ? <CentangIkon ukuran={13} /> : <SalinIkon ukuran={13} />}
                      {disalin ? "Tersalin" : "Salin kode"}
                    </button>
                    <button type="button" className="btn kecil" onClick={bagikanKode}>
                      <PanahKeluar ukuran={13} />
                      Bagikan
                    </button>
                    <button type="button" className="btn kecil" onClick={batalRoom}>
                      Batal
                    </button>
                  </div>
                  <p className="ttt-tunggu">
                    Nunggu lawan masuk. Suruh dia buka web ini, pilih Online, terus masukin kode di atas.
                  </p>
                </>
              ) : (
                <p className="ttt-tunggu">Nyambungin ke room {kode}...</p>
              )}
            </div>
          )}

          {/* ----- Papan + status (mode lokal/cpu, atau online yang udah nyambung) ----- */}
          {(mode !== "online" || mainOnline) && (
            <>
              {mode === "online" && faseOnline === "putus" && !nyerahNunggu && (
                <div className="ttt-putus" role="status">
                  <b>Koneksiny keputus.</b>
                  <p>Tab lawanny ketutup atau ke-refresh. Kalau dia balik, game ny lanjut otomatis dari posisi terakhir.</p>
                  <div className="ttt-putus-aksi">
                    <button type="button" className="btn kecil" onClick={() => setNyerahNunggu(true)}>
                      Nunggu aja
                    </button>
                    <button type="button" className="btn kecil primary" onClick={() => gantiMode("cpu")}>
                      Lawan CPU
                    </button>
                  </div>
                </div>
              )}

              <div className="ttt-pemain">
                <Plat tanda="X" nama={namaX} aktif={posisi.status === "jalan" && posisi.giliran === "X" && !putar.aktif} nunggu={nungguLawan && posisi.giliran === "X"} menang={posisi.status === "menang" && posisi.pemenang === "X" && !putar.aktif} />
                <Plat tanda="O" nama={namaO} aktif={posisi.status === "jalan" && posisi.giliran === "O" && !putar.aktif} nunggu={nungguLawan && posisi.giliran === "O"} menang={posisi.status === "menang" && posisi.pemenang === "O" && !putar.aktif} />
              </div>

              <p className={"ttt-status" + (peringatan ? " peringatan" : "")} aria-live="polite">
                <span key={peringatan || teksStatus()} className="ttt-status-teks">
                  {peringatan || teksStatus()}
                </span>
                {mode === "cpu" && beruntun >= 2 && !peringatan && <span className="ttt-rantai">{beruntun} menang beruntun</span>}
              </p>

              <div className="ttt-kertas">
                <div
                  key={"g" + getar}
                  className={"ttt-papan" + (putar.aktif ? " putar" : "") + (getar ? " getar" + (getar % 2) : "")}
                  ref={papanRef}
                  role="group"
                  aria-label="Papan Tic Tac Toe"
                  data-giliran={posisi.giliran}
                  data-aktif={aktifKah ? "1" : "0"}
                  data-selesai={selesai ? posisi.status : undefined}
                  onKeyDown={navPanah}
                >
                  {papanTampil.map((isi, i) => (
                    <button
                      key={i}
                      ref={(el) => {
                        selRefs.current[i] = el;
                      }}
                      type="button"
                      data-sfx="diam"
                      className={
                        "ttt-sel" +
                        (isi ? " isi" : "") +
                        (polaTampil && polaTampil.includes(i) ? " menang" : "") +
                        (!putar.aktif && i === terakhir ? " terakhir" : "")
                      }
                      onClick={() => klikSel(i)}
                      aria-disabled={!aktifKah || !!isi}
                      aria-label={"Kotak " + (i + 1) + (isi ? ", sudah " + isi : ", kosong")}
                    >
                      {!isi && (
                        <span className="ttt-no" aria-hidden="true">
                          {i + 1}
                        </span>
                      )}
                      {isi && <TandaSVG tanda={isi} benih={i * 11 + Math.max(0, posisi.riwayat.indexOf(i)) * 5 + 1} />}
                      {!isi && (
                        <>
                          <span className="ttt-hantu ttt-hantu-x" aria-hidden="true">
                            <TandaSVG tanda="X" hantu />
                          </span>
                          <span className="ttt-hantu ttt-hantu-o" aria-hidden="true">
                            <TandaSVG tanda="O" hantu />
                          </span>
                        </>
                      )}
                    </button>
                  ))}

                  {garis && !putar.aktif && posisi.pola && (
                    <svg className="ttt-garis" aria-hidden="true">
                      <line x1={garis.x1} y1={garis.y1} x2={garis.x2} y2={garis.y2} pathLength={1} />
                    </svg>
                  )}
                  
                </div>

                {selesai && hasil && (
                  <div key={"st" + posisi.riwayat.length + posisi.status} className={"ttt-stempel " + hasil} role="img" aria-label={teksStempel}>
                    <b>{teksStempel}</b>
                    <small>{posisi.riwayat.length} langkah</small>
                  </div>
                )}
              </div>

              {posisi.riwayat.length > 0 && (
                <div className="ttt-jejak" role="img" aria-label={"Urutan langkah: " + posisi.riwayat.map((v) => v + 1).join(", ")}>
                  {Array.from({ length: 9 }, (_, n) => {
                    const ada = n < posisi.riwayat.length && (!putar.aktif || n < putar.sampai);
                    const t: Tanda = n % 2 === 0 ? "X" : "O";
                    return (
                      <i key={n} className={(ada ? "ada" : "") + (putar.aktif && n === putar.sampai - 1 ? " kini" : "")}>
                        {ada && <TandaSVG tanda={t} hantu />}
                      </i>
                    );
                  })}
                </div>
              )}

              <div className="ttt-aksi">
                <button
                  type="button"
                  className="btn kecil"
                  onClick={batalkan}
                  disabled={!bisaUndo}
                  title={mode === "online" ? "Undo dimatiin di mode online biar adil" : "Batalkan langkah terakhir"}
                >
                  Mundur
                </button>
                <button type="button" className="btn kecil" onClick={mulaiBaru}>
                  <ResetIkon ukuran={14} />
                  Ulang
                </button>
                {putar.aktif ? (
                  <button type="button" className="btn kecil" onClick={stopPutar}>
                    Stop replay
                  </button>
                ) : (
                  posisi.status !== "jalan" &&
                  posisi.riwayat.length > 0 && (
                    <>
                      <button type="button" className="btn kecil" onClick={() => void putarUlang()}>
                        <PutarIkon ukuran={14} />
                        Replay
                      </button>
                      <button type="button" className="btn kecil primary" onClick={mulaiBaru}>
                        Main lagi
                        <Panah />
                      </button>
                    </>
                  )
                )}
              </div>

              <p className="ttt-hint">
                Ketik <b>1–9</b> buat ngisi kotak{mode === "cpu" ? " — Mundur ngebalikin langkah lo + CPU sekaligus" : ""}
                {mode === "online" ? " — main bergantian sesuai giliran, klik Main lagi buat rematch di dua sisi" : ""}.
              </p>
            </>
          )}
        </div>

        {/* ---------- Kolom kanan: level, koneksi, skor ---------- */}
        <aside className="ttt-kanan">
          {mode === "cpu" && (
            <section>
              <h2 className="ttt-judul-sisi">Level CPU</h2>
              <Segmen
                label="Level CPU"
                nilai={level}
                onGanti={gantiLevel}
                opsi={[
                  { n: "gampang", teks: LABEL_LEVEL.gampang },
                  { n: "sedang", teks: LABEL_LEVEL.sedang },
                  { n: "sempurna", teks: LABEL_LEVEL.sempurna },
                ]}
              />
              <p className="ttt-hint">
                {level === "gampang"
                  ? "Asal comot dikit: ambil menang kalau ketemu, blok kadang-kadang, sisany ngawur."
                  : level === "sedang"
                    ? "70% main optimal, 30% ngawur — bisa dikalahkan kalau lo pinter naruh."
                    : "Minimax penuh + alpha-beta: gak mungkin dikalahkan. Seri = hasil terbaik yang lo bisa."}
              </p>
            </section>
          )}

          {mode === "online" && mainOnline && (
            <section>
              <h2 className="ttt-judul-sisi">Koneksi</h2>
              <div className={"ttt-sambung " + (faseOnline === "nyambung" ? "nyala" : "putus")}>
                {faseOnline === "nyambung" ? "Nyambung — lawan online" : "Keputus — nunggu lawan balik"}
                <span className="ttt-kode-mini">Room {kode}</span>
              </div>
              <p className="ttt-hint">
                Lo main sebagai <b>{tandaKu}</b> ({tandaKu === "X" ? "pembuat room, jalan duluan" : "penggabung"}). Host selalu
                X, tamu selalu O — di-lock di awal biar gak ada debat.
              </p>
            </section>
          )}

          <section>
            <h2 className="ttt-judul-sisi">Skor · {LABEL_MODE[mode]}</h2>
            <div className="ttt-skor">
              <div className="ttt-sel-skor">
                <b key={"x" + skor[mode].x}>{skor[mode].x}</b>
                <Tally n={skor[mode].x} />
                <span>{labelX}</span>
              </div>
              <div className="ttt-sel-skor">
                <b key={"s" + skor[mode].seri}>{skor[mode].seri}</b>
                <Tally n={skor[mode].seri} />
                <span>Seri</span>
              </div>
              <div className="ttt-sel-skor">
                <b key={"o" + skor[mode].o}>{skor[mode].o}</b>
                <Tally n={skor[mode].o} />
                <span>{labelO}</span>
              </div>
            </div>
            <button type="button" className="tautan-kecil ttt-reset-skor" onClick={() => setKonfirmSkor(true)}>
              Reset skor
            </button>
          </section>

        </aside>
      </div>

      {terpasang && createPortal(<canvas ref={konfetiRef} className="ttt-konfeti" aria-hidden="true" />, document.body)}

      {konfirmSkor && (
        <Konfirmasi
          judul="Reset skor?"
          pesan={"Semua skor mode " + LABEL_MODE[mode] + " (menang X, menang O, seri) bakal balik ke nol. Game ny yang lagi jalan gak kena."}
          labelYakin="Reset skor"
          onYakin={resetSkor}
          onBatal={() => setKonfirmSkor(false)}
        />
      )}
    </>
  );
}

/* ---------- Segmen: kontrol pilihan sejajar (radio group) ---------- */

function Segmen<T extends string>({
  label,
  nilai,
  onGanti,
  opsi,
}: {
  label: string;
  nilai: T;
  onGanti: (n: T) => void;
  opsi: { n: T; teks: string }[];
}) {
  const urut = Math.max(0, opsi.findIndex((o) => o.n === nilai));
  return (
    <div className="ttt-seg" role="radiogroup" aria-label={label} style={{ "--n": opsi.length, "--i": urut } as CSSProperties}>
      {opsi.map((o) => (
        <button
          key={o.n}
          type="button"
          role="radio"
          aria-checked={o.n === nilai}
          className={o.n === nilai ? "aktif" : ""}
          onClick={() => onGanti(o.n)}
        >
          {o.teks}
        </button>
      ))}
    </div>
  );
}

/* ---------- Plat pemain: siapa yang lagi jalan ----------
   Plat aktif = terisi tinta + bayangan offset (bahasa tombol situs).
   Titik tiga berdenyut = lagi nunggu (CPU mikir / lawan online). */

function Plat({ tanda, nama, aktif, nunggu, menang }: { tanda: Tanda; nama: string; aktif: boolean; nunggu: boolean; menang: boolean }) {
  return (
    <div className={"ttt-plat" + (aktif ? " aktif" : "") + (menang ? " menang" : "")}>
      <span className="ttt-plat-tanda">
        <TandaSVG tanda={tanda} hantu />
      </span>
      <span className="ttt-plat-nama">{nama}</span>
      {nunggu && (
        <span className="ttt-titik" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

/* ---------- Tally: skor digaris kayak di kertas ----------
   Empat garis tegak + satu coret diagonal = lima. Maksimal 3 kelompok
   (15) yang digambar, sisanya "+" biar gak melebar. Garis terbaru
   digores ulang pas skor naik (key = jumlah). */

function Tally({ n }: { n: number }) {
  const tampil = Math.min(n, 15);
  const kelompok = Math.max(1, Math.ceil(tampil / 5));
  const garis: React.ReactElement[] = [];
  for (let k = 0; k < kelompok; k++) {
    const isi = Math.min(5, tampil - k * 5);
    for (let j = 0; j < Math.min(isi, 4); j++) {
      const idx = k * 5 + j;
      const x = k * 34 + (34 - Math.min(isi, 4) * 6) / 2 + 1.5 + j * 6;
      garis.push(<line key={"t" + idx} className={idx === tampil - 1 ? "baru" : ""} x1={x} y1={3} x2={x + 0.6} y2={19} pathLength={1} />);
    }
    if (isi === 5) {
      const idx = k * 5 + 4;
      garis.push(<line key={"t" + idx} className={idx === tampil - 1 ? "baru" : ""} x1={k * 34 + 1} y1={16} x2={k * 34 + 31} y2={6} pathLength={1} />);
    }
  }
  return (
    <svg className="ttt-tally" viewBox={"0 0 " + (kelompok * 34) + " 22"} aria-hidden="true" data-lebih={n > 15 ? "1" : "0"}>
      {garis}
    </svg>
  );
}

/* ---------- Mark X / O (goresan tangan) ----------
   Tiap mark digambar beda: posisi ujung, lengkung, dan sudut miring
   diacak DETERMINISTIK dari `benih` (indeks kotak + urutan langkah),
   jadi dua device di room online ngeliat goresan yang sama persis.
   O = satu goresan spiral yang nutup dengan sedikit overshoot, bukan
   lingkaran sempurna. Filter feTurbulence (id ttt-tinta, didefinisi
   sekali di komponen utama) bikin tepi goresan sedikit kasar kayak
   tinta di kertas. pathLength=1 + dasharray 1 = animasi "nulis".
   Versi hantu (preview hover / plat / jejak): tanpa animasi + lurus. */

function acak(benih: number) {
  let a = (Math.imul(benih + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bentukTanda(tanda: Tanda, benih: number): { d: string[]; miring: number } {
  const r = acak(benih);
  const j = (k: number) => (r() - 0.5) * k;
  const f = (n: number) => n.toFixed(1);
  const miring = j(9);
  if (tanda === "X") {
    const g1 = "M" + f(22 + j(5)) + " " + f(22 + j(5)) + " Q" + f(50 + j(7)) + " " + f(50 + j(7)) + " " + f(78 + j(5)) + " " + f(78 + j(5));
    const g2 = "M" + f(78 + j(5)) + " " + f(22 + j(5)) + " Q" + f(50 + j(7)) + " " + f(50 + j(7)) + " " + f(22 + j(5)) + " " + f(78 + j(5));
    return { d: [g1, g2], miring };
  }
  const titik: string[] = [];
  const mulai = r() * Math.PI * 2;
  const sapuan = Math.PI * 2 * 1.06;
  const n = 40;
  const rx = 31 + j(3);
  const ry = 31 + j(3);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const ang = mulai + u * sapuan;
    const geser = 1 + u * 0.075 + (r() - 0.5) * 0.025;
    titik.push(f(50 + Math.cos(ang) * rx * geser) + " " + f(50 + Math.sin(ang) * ry * geser));
  }
  return { d: ["M" + titik.join(" L")], miring };
}

function TandaSVG({ tanda, hantu, benih = 0 }: { tanda: Tanda; hantu?: boolean; benih?: number }) {
  const bentuk = useMemo(() => (hantu ? null : bentukTanda(tanda, benih)), [tanda, hantu, benih]);
  if (hantu || !bentuk) {
    return (
      <svg className="ttt-coret" data-tanda={tanda} viewBox="0 0 100 100" aria-hidden="true">
        {tanda === "X" ? (
          <>
            <path d="M22 22 78 78" pathLength={1} />
            <path d="M78 22 22 78" pathLength={1} />
          </>
        ) : (
          <circle cx="50" cy="50" r="33" pathLength={1} />
        )}
      </svg>
    );
  }
  return (
    <svg className="ttt-mark" data-tanda={tanda} viewBox="0 0 100 100" aria-hidden="true" style={{ transform: "rotate(" + bentuk.miring.toFixed(1) + "deg)" }}>
      <g filter="url(#ttt-tinta)">
        {bentuk.d.map((d, i) => (
          <path key={i} d={d} pathLength={1} />
        ))}
      </g>
    </svg>
  );
}
