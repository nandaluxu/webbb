"use client";

/* Ruang Obrol: chat global untuk siapa aja yang mampir.
   - Pesan kesimpen di server (Prisma/SQLite) lewat /api/chat, jadi
     tetap ada walau server mati lalu idup lagi.
   - Realtime lewat mini-service socket.io; polling jadi cadangan.
     Event "hapus" nyiarin pesan yang kehapus ke semua client.
   - Jam + pemisah hari dihitung dari waktu device masing-masing
     (server nyimpen UTC, biar fleksibel buat zona beda).
   - Timestamp GROUPING: jam cuma nongol di bubble TERAKHIR sebuah
     kelompok (pengirim sama + jeda antar pesen <= 5 menit), sebagai
     footer terpisah DI DALAM bubble. Jeda > 5 menit / ganti pengirim
     = kelompok baru. Bubble tiap pesan tetep kepisah (gak ada
     pesan yang digabung jadi satu bubble).
   - Balas chat: geser gelembung ke kiri (di HP), tombol balas di
     desktop, atau lewat menu aksi.
   - Menu aksi pesan: long-press (HP) / klik kanan (desktop):
     Balas, Salin, Pilih, Hapus (izin ny yang beres), Lapor.
   - Multi-select: mode pilih dari menu, tap baris buat nandain
     (tanda centang ny di GUTER — slot tombol balas, gak nempel di
     bubble lagi: r18, gak ada tabrakan sama nama/bubble atas), bar
     aksi di bawah (Salin, Balas kalo pas 1, Hapus kalo semua
     boleh, Batal). Lapor sengaja gak ada di multi biar gak ada
     laporan nggak sengaja banyak-banyak.
   - Copy: format [DD/MM, HH:mm] nama: teks (helper lib/salin-chat,
     sama kayak chat AI + komentar). */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Merek, BalasIkon, KirimIkon, TutupIkon, Panah, SalinIkon, HapusIkon, LaporIkon, PilihIkon, CentangIkon } from "@/components/ikon";
import MenuAksi, { useTekanLama, type AksiItem } from "@/components/MenuAksi";
import Konfirmasi from "@/components/Konfirmasi";
import { useSesi, bukaPintu, keluar } from "@/lib/sesi-pengguna";
import { mainkanSfx } from "@/lib/suara";
import { formatSalinBanyak, salinTeks } from "@/lib/salin-chat";
import { bacaCacheChat, simpanCacheChat, type CacheChat } from "@/lib/cache-chat";

type Pesan = {
  id: string;
  nama: string;
  teks: string;
  waktu: string;
  balasan: { id: string; nama: string; teks: string; waktu: string } | null;
  /* r19 optimistic: klienId nyambungin pesan sambil-an sama pesan
     resmi dari server (di-echo balik sama API + broadcast socket).
     status cuma ada di lokal: "kirim" = lagi dikirim, "gagal" =
     gagal + bisa diulang. Pesan dari server gak punya status. */
  klienId?: string;
  status?: "kirim" | "gagal";
};

/* Jeda maksimum biar dua pesan dianggap satu kelompok waktu. */
const CELAH_KELOMPOK_MS = 5 * 60 * 1000;

const pemisahJam = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" });

function jam(waktu: string) {
  return pemisahJam.format(new Date(waktu));
}

function labelHari(d: Date) {
  const kini = new Date();
  const hariIni = new Date(kini.getFullYear(), kini.getMonth(), kini.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const selisih = Math.round((hariIni.getTime() - target.getTime()) / 86400000);
  if (selisih <= 0) return "Hari ini";
  if (selisih === 1) return "Kemarin";
  return new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
}

/* Avatar inisial (tema Ruang Obrol): huruf/emoji pertama nama. Pake
   Intl.Segmenter kalo ada biar emoji gabungan gak kepotong separo. */
function inisial(nama: string): string {
  const t = nama.trim().replace(/^@/, "");
  if (!t) return "?";
  try {
    const Seg = (Intl as unknown as {
      Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> };
    }).Segmenter;
    if (Seg) {
      for (const x of new Seg(undefined, { granularity: "grapheme" }).segment(t)) return x.segment;
    }
  } catch {}
  return Array.from(t)[0] ?? "?";
}

/* Satu nama selalu dapet varian warna avatar yang sama (0-4). Warna
   aslinya ditentuin CSS per tema (ruang-obrol.css). */
function indeksWarna(nama: string): number {
  let h = 0;
  for (let i = 0; i < nama.length; i++) h = (h * 31 + nama.charCodeAt(i)) >>> 0;
  return h % 5;
}

/* Ilustrasi per tema: semua versi dirender, CSS (.hias-<tema>) yang
   nampilin satu sesuai html[data-ui]. Ganti tema di Pengaturan = ikut
   ganti langsung tanpa state React. Dipake buat lencana kepala ruang
   + gambar "belum ada pesan". */
function HiasTema() {
  return (
    <>
      <svg className="hias hias-klasik" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <rect x="6" y="8" width="36" height="26" />
        <path d="M13 34v9l10-9" />
        <rect x="24" y="22" width="34" height="26" fill="currentColor" stroke="none" />
        <path d="M51 48v9l-10-9z" fill="currentColor" stroke="none" />
        <rect className="bg" x="31" y="33" width="4" height="4" stroke="none" />
        <rect className="bg" x="39" y="33" width="4" height="4" stroke="none" />
        <rect className="bg" x="47" y="33" width="4" height="4" stroke="none" />
      </svg>
      <svg className="hias hias-swiss" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <path d="M8 8h48v48H8z" />
        <path d="M24 8v48M40 8v48M8 24h48M8 40h48" />
        <rect x="24" y="24" width="16" height="16" fill="currentColor" stroke="none" />
      </svg>
      <svg className="hias hias-japandi" viewBox="0 0 64 64" aria-hidden="true">
        <circle className="matahari" cx="47" cy="15" r="5" />
        <path className="garis" d="M9 55h46" fill="none" strokeWidth="1.6" strokeLinecap="round" />
        <ellipse className="batu1" cx="32" cy="47.5" rx="19" ry="7" />
        <ellipse className="batu2" cx="32" cy="35.5" rx="13" ry="6" />
        <ellipse className="batu3" cx="31" cy="25.5" rx="8" ry="5" />
      </svg>
      <svg className="hias hias-hanami" viewBox="0 0 64 64" aria-hidden="true">
        <g transform="translate(32 32)">
          {[0, 72, 144, 216, 288].map((r) => (
            <path
              key={r}
              className="kelopak-hias"
              d="M0 -5C-11 -13 -11 -25 -3 -29L0 -26L3 -29C11 -25 11 -13 0 -5Z"
              transform={`rotate(${r})`}
            />
          ))}
          <circle className="putik" r="3.4" />
        </g>
      </svg>
    </>
  );
}

export default function Obrolan() {
  const [siap, setSiap] = useState(false);
  const [pesan, setPesan] = useState<Pesan[]>([]);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [nilai, setNilai] = useState("");
  const [balasan, setBalasan] = useState<Pesan | null>(null);
  const [menulis, setMenulis] = useState<string | null>(null);
  const [daring, setDaring] = useState({ jumlah: 0, nama: [] as string[] });
  const [nyambung, setNyambung] = useState(false);
  const [kirimGalat, setKirimGalat] = useState<string | null>(null);
  const [adaBaru, setAdaBaru] = useState(false);
  /* Menu aksi: posisi layar + pesan target ny. */
  const [menu, setMenu] = useState<{ x: number; y: number; p: Pesan } | null>(null);
  /* Mode pilih: null = mati, Set isi id pesan yang kepilih. */
  const [pilih, setPilih] = useState<Set<string> | null>(null);
  /* Konfirmasi (hapus / hapus banyak / lapor). */
  const [konfirm, setKonfirm] = useState<{ jenis: "hapus"; p: Pesan } | { jenis: "hapusBanyak"; ids: string[] } | { jenis: "lapor"; p: Pesan } | null>(null);
  const [sibukAksi, setSibukAksi] = useState(false);
  /* Umpan balik kecil (tersalin / lapor terkirim) di posisi chip. */
  const [umpan, setUmpan] = useState<string | null>(null);
  const umpanTimer = useRef(0);

  const soketRef = useRef<Socket | null>(null);
  const daftarRef = useRef<HTMLDivElement>(null);
  const ids = useRef<Set<string>>(new Set());
  /* Cermin daftar pesan (sumber hitungan rekonsiliasi) biar updater
     React tetep murni: logika baca-tulis di luar setPesan. */
  const pesanRef = useRef<Pesan[]>([]);
  const waktuAkhir = useRef<string | null>(null);
  const timerMenulis = useRef(0);
  const terakhirKetik = useRef(0);
  const terakhirKirim = useRef(0);

  /* ---------- Pagination riwayat (r28) ----------
     Initial load: 20 TERBARU (bukan seluruh riwayat). Scroll ke atas
     -> batch lama berikutny lewat kursor (waktu+id). Guard anti
     request berulang + dedupe id (Set ids). */
  const [lagiLama, setLagiLama] = useState(true);
  const [muatLama, setMuatLama] = useState(false);
  const kursorLama = useRef<{ waktu: string; id: string } | null>(null);
  const sibukLama = useRef(false);
  /* Posisi gulir pas prepend: scrollHeight+scrollTop dicatat SEBELUM
     daftar nambah, dibenerin abis DOM ke-update (layout effect) —
     posisi baca gak loncat. */
  const jagaGulir = useRef<{ tinggi: number; atas: number } | null>(null);
  /* Cache chat (r28): render instan dari browser dulu, server ny
     revalidate di belakang. Per-user (isolasi nama login). */
  const dariCache = useRef(false);

  /* r20: komposer pake textarea — desktop (pointer fine) Enter =
     KIRIM, Shift+Enter = baris baru (r28); HP (pointer coarse) Enter
     tetep baris baru (paling natural buat keyboard mobile, kirim ny
     lewat tombol). Auto-grow tetap jalan. */
  const [enterKirim, setEnterKirim] = useState(false);
  const teksArea = useRef<HTMLTextAreaElement | null>(null);
  const timerHapusMenulis = useRef(0);
  const diBawah = useRef(true);
  const sudahGulirRuang = useRef(false);

  const { siap: sesiSiap, masuk, pengguna } = useSesi();
  const nama = pengguna?.nama ?? null;
  const isAdmin = !!pengguna?.admin;

  useEffect(() => {
    setSiap(true);
    /* Enter=kirim cuma di perangkat pointer-fine (desktop). Di HP,
    keyboard on-screen + tombol kirim ny lebih natural (Enter di
    keyboard mobile biasany malah nge-trigger newline/next). */
    setEnterKirim(window.matchMedia("(pointer: fine)").matches);
  }, []);

  /* Auto-grow textarea komposer (r20): tinggi nutur jumlah baris,
     maks 132px abis ny elemen ny gulir sendiri. Nilai dikosongin
     (abis kirim) -> tinggi balik 1 baris. Di-set langsung ke
     style: gak ada state React baru, gak ada re-render. */
  useEffect(() => {
    const el = teksArea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
    el.style.overflowY = el.scrollHeight > 132 ? "auto" : "hidden";
  }, [nilai]);

  /* Umpan balik singkat (2.4 detik), dipake sama salin + lapor. */
  const kabar = useCallback((teks: string) => {
    setUmpan(teks);
    clearTimeout(umpanTimer.current);
    umpanTimer.current = window.setTimeout(() => setUmpan(null), 2400);
  }, []);

  /* Satu pintu ganti daftar: state + cermin ny sinkron. */
  const pasangDaftar = useCallback((daftar: Pesan[]) => {
    pesanRef.current = daftar;
    setPesan(daftar);
  }, []);

  /* Simpan cache (debounce 600ms): cuma pesan RESMI (pending gak
     ikut), maks 100, bareng kursor paginasi + flag lagi. Server
     tetep sumber kebenaran — cache gak pernah dipake buat mutasi. */
  const simpanCache = useCallback(
    (n: string) => {
      const resmi = pesanRef.current.filter((p) => !p.status);
      if (!resmi.length) return;
      simpanCacheChat(n, resmi, kursorLama.current, lagiLama);
    },
    [lagiLama]
  );

  useEffect(() => {
    if (!nama) return;
    const t = window.setTimeout(() => simpanCache(nama), 600);
    return () => window.clearTimeout(t);
  }, [pesan, nama, simpanCache]);

  /* Rekonsiliasi pesan SERVER (socket / POST / polling):
     1. id udah ada -> skip (dedup biasa).
     2. bawa klienId -> ganti pesan sambil-an yang nunggu (in-place,
        key React stabil, gak ada bubble dobel).
     3. tanpa klienId ( polling gak tau klienId) tapi dari kita sendiri
        + ada pesan sambil-an yang teks ny sama (jendela 90 detik) ->
        itu konfirmasi ny juga (server nyimpen dulu, respons ny
        nyasar/timeout). Yang paling lama yang di-match.
     4. sisanya -> nempel di belakang.
     Urutan tetep nurut server (socket nyiarin urutan tulis DB);
     kalo ketemu pembalikan antara dua pesan resmi, diurutkan stabil
        (pesanan sambil-an tetep di bawah, gak loncat). */
  const tambah = useCallback(
    (datang: Pesan[]) => {
      if (!datang.length) return;
      const lama = pesanRef.current;
      const hasil = [...lama];
      let berubah = false;
      for (const x of datang) {
        if (ids.current.has(x.id)) continue;
        let idx = -1;
        if (x.klienId) idx = hasil.findIndex((m) => m.klienId === x.klienId);
        if (idx < 0 && x.nama === nama) {
          const batas = Date.now() - 90_000;
          idx = hasil.findIndex(
            (m) => (m.status === "kirim" || m.status === "gagal") && m.teks === x.teks && new Date(m.waktu).getTime() > batas
          );
        }
        ids.current.add(x.id);
        if (idx >= 0) {
          hasil[idx] = x;
        } else {
          hasil.push(x);
        }
        berubah = true;
      }
      if (!berubah) return;
      /* Pembalikan antar pesan resmi (kalo ada) -> urut stabil.
         Pesan sambil-an dijemin di ekor (punyany paling baru). */
      let balik = false;
      for (let i = 1; i < hasil.length; i++) {
        if (!hasil[i - 1].status && !hasil[i].status && new Date(hasil[i].waktu).getTime() < new Date(hasil[i - 1].waktu).getTime()) {
          balik = true;
          break;
        }
      }
      if (balik) {
        const sambil = hasil.filter((m) => m.status);
        const resmi = hasil.filter((m) => !m.status);
        resmi.sort((a, b) => (a.waktu === b.waktu ? (a.id < b.id ? -1 : 1) : a.waktu < b.waktu ? -1 : 1));
        hasil.splice(0, hasil.length, ...resmi, ...sambil);
      }
      const terakhir = hasil[hasil.length - 1];
      if (terakhir && !terakhir.status) waktuAkhir.current = terakhir.waktu;
      pasangDaftar(hasil);
    },
    [nama, pasangDaftar]
  );

  /* Pesan kehapus (dari socket event "hapus", dikirim server pas
     ada yang delete): buang dari daftar lokal + daftar id. */
  const buang = useCallback(
    (id: string) => {
      if (!ids.current.has(id)) return;
      ids.current.delete(id);
      pasangDaftar(pesanRef.current.filter((p) => p.id !== id));
      setPilih((p) => (p ? new Set([...p].filter((x) => x !== id)) : p));
    },
    [pasangDaftar]
  );

  /* ---------- Muat awal: cache dulu -> revalidate -> merge ----------
     Buka chat: render CACHE browser (instan) kalo ada, terus ambil 20
     TERBARU dari server di belakang. Merge: versi server MENANG buat
     id yang sama, pesan cache yang LEBIH LAMA dari jendela server
     tetep kepegang (riwayat hasil scroll-up kemarin), pending lokal
     gak pernah kebuang. Pesan cache yang lebih baru dari jendela
     server tapi gak ada di respons = kehapus di server -> dibuang. */
  const gabungAwal = useCallback(
    (server: Pesan[], lagi: boolean, sebelum: { waktu: string; id: string } | null) => {
      const sumber = pesanRef.current;
      const serverIds = new Set(server.map((p) => p.id));
      const batas = server.length ? new Date(server[0].waktu).getTime() : Number.POSITIVE_INFINITY;
      /* lagi=false = udah paling awal semua: pesan cache "lebih lama"
         pasti udah kehapus di server (jendela server = seluruh
         history) — dibiarin kebuang. */
      const tetap = sumber.filter((m) => {
        if (m.status) return true;
        if (serverIds.has(m.id)) return false;
        return lagi && new Date(m.waktu).getTime() < batas;
      });
      const gabungan = [...tetap, ...server];
      /* Urutan resmi stabil (waktu, id); pending nempel di ekor. */
      const resmi = gabungan.filter((p) => !p.status).sort((a, b) => (a.waktu === b.waktu ? (a.id < b.id ? -1 : 1) : a.waktu < b.waktu ? -1 : 1));
      const sambil = gabungan.filter((p) => p.status);
      const akhir = [...resmi, ...sambil];
      for (const p of server) ids.current.add(p.id);
      pasangDaftar(akhir);
      const terlama = resmi[0];
      kursorLama.current = terlama ? { waktu: terlama.waktu, id: terlama.id } : sebelum;
      setLagiLama(terlama ? lagi : false);
      const ekor = akhir[akhir.length - 1];
      if (ekor && !ekor.status) waktuAkhir.current = ekor.waktu;
      dariCache.current = false;
    },
    [pasangDaftar]
  );

  useEffect(() => {
    if (!nama) return;
    let hidup = true;
    /* Bayangan error jaringan buat listener pemulihan (P0-1). */
    let gagalMuat = false;

    /* 1. Cache dulu (r28): render instan, server ny nyusul. */
    const cache = bacaCacheChat(nama);
    if (cache && cache.pesan.length) {
      const daftar = cache.pesan as Pesan[];
      ids.current = new Set(daftar.map((p) => p.id));
      pasangDaftar(daftar);
      kursorLama.current = cache.sebelum;
      setLagiLama(cache.lagi);
      const ekor = daftar[daftar.length - 1];
      if (ekor) waktuAkhir.current = ekor.waktu;
      dariCache.current = true;
    }

    async function muatAwal() {
      try {
        const res = await fetch("/api/chat?terbaru=1", {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!hidup) return;
        gabungAwal(data.pesan ?? [], !!data.lagi, data.sebelum ?? null);
        setGalatMuat(null);
        gagalMuat = false;
      } catch {
        gagalMuat = true;
        if (hidup && !ids.current.size) setGalatMuat("Gak bisa ngambil riwayat chat. Cek koneksi ny, gw coba lagi tiap beberapa detik.");
      }
    }

    muatAwal();
    const poll = setInterval(() => ambilBaru(), 5000);
    async function ambilBaru() {
      try {
        const res = await fetch("/api/chat" + (waktuAkhir.current ? "?after=" + encodeURIComponent(waktuAkhir.current) : "?terbaru=1"), {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!hidup) return;
        tambah(data.pesan ?? []);
        setGalatMuat(null);
        gagalMuat = false;
      } catch {
        gagalMuat = true;
        if (hidup && !ids.current.size) setGalatMuat("Gak bisa ngambil riwayat chat. Cek koneksi ny, gw coba lagi tiap beberapa detik.");
      }
    }
    /* P0-1: koneksi balik + riwayat masih gagal -> ambil ulang
       duluan (gak nunggu tick polling berikutny). */
    const cobaBalik = () => {
      if (gagalMuat) void muatAwal();
    };
    window.addEventListener("jaringan:balik", cobaBalik);

    return () => {
      hidup = false;
      clearInterval(poll);
      window.removeEventListener("jaringan:balik", cobaBalik);
    };
  }, [nama, tambah, gabungAwal, pasangDaftar]);

  /* ---------- Scroll ke atas = muat riwayat lebih lama (r28) ----------
     Guard: satu request jalan dalam satu waktu (sibukLama), kursor
     (waktu+id pesan tertua), lagiLama=false = mentok. Dedupe lewat Set
     ids (id pesan = kunci stabil). Posisi baca dijaga: scrollHeight +
     scrollTop dicatat sebelum prepend, dibenerin di layout effect. */
  const muatLebihLama = useCallback(async () => {
    const kursor = kursorLama.current;
    if (!nama || sibukLama.current || !lagiLama || !kursor) return;
    sibukLama.current = true;
    setMuatLama(true);
    const el = daftarRef.current;
    const tinggiAwal = el ? el.scrollHeight : 0;
    const atasAwal = el ? el.scrollTop : 0;
    try {
      const res = await fetch(
        "/api/chat?sw=" + encodeURIComponent(kursor.waktu) + "&sid=" + encodeURIComponent(kursor.id),
        { cache: "no-store", signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      const halaman: Pesan[] = data.pesan ?? [];
      const baru = halaman.filter((p) => !ids.current.has(p.id));
      for (const p of baru) ids.current.add(p.id);
      if (baru.length) {
        jagaGulir.current = { tinggi: tinggiAwal, atas: atasAwal };
        pasangDaftar([...baru, ...pesanRef.current]);
      }
      const lagiBaru = !!data.lagi;
      setLagiLama(lagiBaru);
      if (!lagiBaru || !data.sebelum) {
        /* Mentok atau kursor gak kekirim: matiin paginasi biar gak
           request berulang. */
        if (!lagiBaru) kursorLama.current = null;
      } else {
        kursorLama.current = data.sebelum;
      }
    } catch {
      /* gagal: biarin (gak ada pesan galat permanen — coba lagi pas
         user scroll lagi; guard sibukLama udah kelepas). */
    } finally {
      sibukLama.current = false;
      setMuatLama(false);
    }
  }, [nama, lagiLama, pasangDaftar]);

  /* Perbaikan posisi gulir abis prepend: jalan sebelum paint biar gak
     ada kedipan "loncat ke bawah lalu balik". */
  useLayoutEffect(() => {
    if (!jagaGulir.current) return;
    const el = daftarRef.current;
    if (el) el.scrollTop = el.scrollHeight - jagaGulir.current.tinggi + jagaGulir.current.atas;
    jagaGulir.current = null;
  }, [pesan]);

  /* Sambungan realtime. */
  useEffect(() => {
    if (!nama) return;
    const soket = io({
      path: "/socket.io",
      /* Polling duluan biar nyambung di proxy apa pun, engine.io bakal
         nyoba upgrade ke websocket otomatis kalau jalurnya support. */
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    soketRef.current = soket;

    soket.on("connect", () => {
      setNyambung(true);
      soket.emit("gabung", { nama });
    });
    soket.on("disconnect", () => setNyambung(false));
    soket.on("pesan", (p: Pesan) => {
      /* Bunyi notifikasi cuma buat pesan orang laen (punya sendiri ny
         udah kedengeran dari tombol kirim). */
      if (p.nama !== nama) mainkanSfx("notification");
      tambah([p]);
    });
    soket.on("hapus", (d: { id?: string }) => {
      if (d?.id) buang(d.id);
    });
    soket.on("menulis", (d: { nama: string }) => {
      if (d.nama === nama) return;
      setMenulis(d.nama);
      clearTimeout(timerHapusMenulis.current);
      timerHapusMenulis.current = window.setTimeout(() => setMenulis(null), 2800);
    });
    soket.on("daring", (d: { jumlah: number; nama: string[] }) => setDaring(d));

    return () => {
      clearTimeout(timerHapusMenulis.current);
      soket.disconnect();
      soketRef.current = null;
    };
  }, [nama, tambah, buang]);

  /* Penanda gulir PROGRAMATIK (r28): auto-scroll smooth ke bawah
     LEWAT posisi scrollTop rendah dulu — tanpa penanda, handler
     scroll nyangkutan di tengah jalan dan salah nyangka "user lagi
     di atas" -> nge-muat batch lama yang gak diminta (bug ketemu di
     uji: buka chat = 40 pesan padahal initial 20). Penanda ny mati
     pas scroll ny nyampe bawah (mepet) atau lewat fallback timer. */
  const gulirProgram = useRef(false);
  const timerGulirProgram = useRef(0);
  const turun = useCallback((halus = true) => {
    const el = daftarRef.current;
    if (!el) return;
    gulirProgram.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: halus ? "smooth" : "auto" });
    clearTimeout(timerGulirProgram.current);
    timerGulirProgram.current = window.setTimeout(() => {
      gulirProgram.current = false;
    }, halus ? 900 : 150);
    setAdaBaru(false);
    diBawah.current = true;
  }, []);
  useEffect(() => () => clearTimeout(timerGulirProgram.current), []);

  /* Autoscroll kalau user lagi ada di bawah; kalau lagi baca ke atas,
     munculin chip "pesan baru". r28: cuma kalo EKOR daftar ny ganti
     (pesan baru masuk di bawah) — prepend riwayat lama ke atas GAK
     boleh mindain bacaan user / nyulutin chip "pesan baru" palsu. */
  const ekorRef = useRef<string | null>(null);
  useEffect(() => {
    const ekor = pesan.length ? (pesan[pesan.length - 1].klienId ?? pesan[pesan.length - 1].id) : null;
    const gantiEkor = ekor !== ekorRef.current;
    ekorRef.current = ekor;
    if (!gantiEkor) return;
    if (diBawah.current) turun(pesan.length > 4);
    else setAdaBaru(true);
  }, [pesan, turun]);

  /* Pas pertama kali buka, gulir halaman ke ruang obrolan biar pesan
     terbaru + komposer langsung keliatan (di HP, ruang ny di bawah intro). */
  useEffect(() => {
    if (!pesan.length || sudahGulirRuang.current) return;
    sudahGulirRuang.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelector(".ruang")?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [pesan]);

  /* Esc di mode pilih = batal (sebelum nutup apa pun yang laen). */
  useEffect(() => {
    if (!pilih) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pilih) {
        e.stopPropagation();
        setPilih(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [pilih]);

  function cekPosisiScroll() {
    const el = daftarRef.current;
    if (!el) return;
    const mepet = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    if (mepet) {
      diBawah.current = true;
      /* Gulir programatik ny "sampai" -> penanda ny boleh mati. */
      gulirProgram.current = false;
      setAdaBaru(false);
    } else {
      diBawah.current = false;
    }
    /* Nyaris di paling atas + masih ada riwayat + BUKAN gulir
       programatik -> muat batch lama (r28). Guard dobel (state +
       ref) biar scroll event nyangkutan gak nge-double request. */
    if (!gulirProgram.current && el.scrollTop < 60 && lagiLama && !muatLama && !sibukLama.current) {
      void muatLebihLama();
    }
  }

  function onKetik(v: string) {
    setNilai(v);
    setKirimGalat(null);
    const kini = Date.now();
    if (v && kini - terakhirKetik.current > 1500) {
      terakhirKetik.current = kini;
      soketRef.current?.emit("menulis", { nama });
    }
  }

  /* ---------- Kirim optimistic (r19) ----------
     Bubble langsung nongol pake id sambil-an (gak nunggu server),
     POST jalan di belakang. Konfirmasi dateng dari respons POST
     ATAU socket (dua-duanya bawa klienId) -> diganti in-place.
     Gagal (termasuk timeout 8 detik) -> ditandain + tombol Ulangi,
     gak ada pesan yang ilang diam-diam. Bisa kirim pesan laen
     walau yang sebelumnya masih dikirim (tiap pesan punya klienId). */
  async function kirimPost(teks: string, balasanId: string | null, klienId: string): Promise<{ ok: boolean; galat?: string; pesan?: Pesan }> {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teks, balasanId, klienId }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, galat: data.galat ?? "Gagal kirim pesan. Coba lagi." };
      return { ok: true, pesan: data.pesan as Pesan };
    } catch {
      return { ok: false, galat: "Gak bisa nyambung ke server." };
    } finally {
      clearTimeout(timer);
    }
  }

  /* Tandain status pesan sambil-an (kirim/gagal) di posisi ny. */
  const setStatus = useCallback(
    (klienId: string, status: "kirim" | "gagal") => {
      const idx = pesanRef.current.findIndex((m) => m.klienId === klienId);
      if (idx < 0) return;
      const hasil = [...pesanRef.current];
      hasil[idx] = { ...hasil[idx], status };
      pasangDaftar(hasil);
    },
    [pasangDaftar]
  );

  /* Kirim dari form ATAU dari keydown Enter (r28 — dibikin dua pintu
     yang nyambung ke SATU logika; guard terakhirKirim ny masih
     nahan dobel-kirim). */
  async function kirim(e?: React.FormEvent) {
    e?.preventDefault();
    const teks = nilai.trim().slice(0, 500);
    if (!teks || !nama) return;
    /* Guard lokal nyaris sama kayak jeda rate-limit server (350ms):
      cegah 429 "kep cepet" buat ketikan gila, TAPI gak nunggu
      network: POST yang lama gak ngeblok kirim pesan baru. */
    const kini = Date.now();
    if (kini - terakhirKirim.current < 400) return;
    terakhirKirim.current = kini;
    const klienId = (crypto.randomUUID && crypto.randomUUID()) || "k-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    const sambil: Pesan = {
      id: "sambil-" + klienId,
      nama,
      teks,
      waktu: new Date().toISOString(),
      balasan: balasan ? { id: balasan.id, nama: balasan.nama, teks: balasan.teks, waktu: balasan.waktu } : null,
      klienId,
      status: "kirim",
    };
    /* UI LANGSUNG: bubble muncul detik ini juga. */
    pasangDaftar([...pesanRef.current, sambil]);
    setNilai("");
    setBalasan(null);
    setKirimGalat(null);
    const balasanId = sambil.balasan?.id ?? null;
    const hasil = await kirimPost(teks, balasanId, klienId);
    if (hasil.ok && hasil.pesan) {
      tambah([hasil.pesan]);
    } else {
      /* Kecuali: server sebenernya udah nyimpen (respons nyasar
         tapi socket/polling udah ngganti pesan ny) -> jangan
         nandain gagal. */
      const udahResmi = pesanRef.current.some((m) => m.klienId === klienId && !m.status);
      if (udahResmi) return;
      setStatus(klienId, "gagal");
      setKirimGalat(hasil.galat ?? "Pesan gagal kekirim. Bisa diulang dari pesanny.");
      mainkanSfx("failure");
    }
  }

  /* Ulangi kirim pesan yang gagal: pakai klienId + teks yang sama,
     status balik "kirim" dulu (bubble tetep keliatan). */
  async function ulangKirim(p: Pesan) {
    if (!p.klienId || !nama || p.status !== "gagal") return;
    setStatus(p.klienId, "kirim");
    setKirimGalat(null);
    const hasil = await kirimPost(p.teks, p.balasan?.id ?? null, p.klienId);
    if (hasil.ok && hasil.pesan) {
      tambah([hasil.pesan]);
    } else {
      const udahResmi = pesanRef.current.some((m) => m.klienId === p.klienId && !m.status);
      if (!udahResmi) setStatus(p.klienId, "gagal");
    }
  }

  function balas(p: Pesan) {
    setBalasan(p);
    setNilai((v) => v);
    /* Fokus ke komposer biar langsung bisa ngetik. */
    const input = document.getElementById("inputObrolan") as HTMLTextAreaElement | null;
    input?.focus();
  }

  function lompatKe(id: string) {
    const el = document.getElementById("pesan-" + id);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.classList.add("sorot");
    setTimeout(() => el.classList.remove("sorot"), 2900);
  }

  /* ---------- Aksi pesan ---------- */

  const bisaHapus = useCallback(
    (p: Pesan) => p.nama === nama || isAdmin,
    [nama, isAdmin]
  );

  async function salin(p: Pesan[]) {
    const teks = formatSalinBanyak(p.map((x) => ({ nama: x.nama, teks: x.teks, waktu: x.waktu })));
    const ok = await salinTeks(teks);
    if (ok) {
      kabar(p.length > 1 ? p.length + " pesan tersalin" : "Pesan tersalin");
      mainkanSfx("notification");
    } else {
      kabar("Clipboard ny keblokir browser");
      mainkanSfx("failure");
    }
  }

  async function jalankanHapus() {
    if (!konfirm) return;
    setSibukAksi(true);
    const daftarId = konfirm.jenis === "hapus" ? [konfirm.p.id] : konfirm.jenis === "hapusBanyak" ? konfirm.ids : [];
    try {
      for (const id of daftarId) {
        const r = await fetch("/api/chat/hapus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (r.ok) buang(id);
      }
      mainkanSfx("ui-dissolve");
    } catch {
      mainkanSfx("failure");
      kabar("Gagal hapus pesan, coba lagi");
    } finally {
      setSibukAksi(false);
      setKonfirm(null);
      setPilih(null);
    }
  }

  async function jalankanLapor() {
    if (!konfirm || konfirm.jenis !== "lapor") return;
    setSibukAksi(true);
    try {
      const r = await fetch("/api/laporan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jenis: "pesan", targetId: konfirm.p.id }),
      });
      if (r.ok) {
        kabar("Laporan terkirim ke owner");
        mainkanSfx("notification");
      } else {
        const d = await r.json().catch(() => ({}));
        kabar(d.galat || "Gagal kirim laporan");
        mainkanSfx("failure");
      }
    } catch {
      kabar("Gak nyambung ke server");
      mainkanSfx("failure");
    } finally {
      setSibukAksi(false);
      setKonfirm(null);
    }
  }

  function bukaMenu(p: Pesan) {
    return (x: number, y: number) => {
      if (pilih) return;
      setMenu({ x, y, p });
      mainkanSfx("ui-menu");
    };
  }

  function itemMenu(p: Pesan): AksiItem[] {
    const isi: AksiItem[] = [
      { id: "balas", label: "Balas", ikon: <BalasIkon ukuran={15} />, onKlik: () => balas(p) },
      { id: "salin", label: "Salin", ikon: <SalinIkon ukuran={15} />, onKlik: () => salin([p]) },
      { id: "pilih", label: "Pilih", ikon: <PilihIkon ukuran={15} />, onKlik: () => setPilih(new Set([p.id])) },
    ];
    if (bisaHapus(p)) {
      isi.push({ id: "hapus", label: "Hapus", ikon: <HapusIkon ukuran={15} />, bahaya: true, onKlik: () => setKonfirm({ jenis: "hapus", p }) });
    }
    if (p.nama !== nama) {
      isi.push({ id: "lapor", label: "Laporkan", ikon: <LaporIkon ukuran={15} />, onKlik: () => setKonfirm({ jenis: "lapor", p }) });
    }
    return isi;
  }

  /* Item bar aksi mode pilih. */
  const pilihanDaftar = useMemo(() => (pilih ? pesan.filter((p) => pilih.has(p.id)) : []), [pilih, pesan]);
  const semuaBisaHapus = pilih !== null && pilihanDaftar.length > 0 && pilihanDaftar.every(bisaHapus);

  if (!siap || !sesiSiap) return null;

  if (!nama) {
    return (
      <section className="pintu obrol-pintu">
        <span className="merek">
          <Merek ukuran={24} />
          Neyhra Playground
        </span>
        <h2>Masuk Ruang Obrol</h2>
        <p>Login dulu biar orang lain tau siapa yang ngomong. Setelah itu langsung bisa ikutan ngobrol.</p>
        <p>
          <button type="button" className="btn primary" onClick={bukaPintu}>
            Masuk
            <Panah />
          </button>
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="head">
        <h1>Ruang Obrol</h1>
        <p className="lede">
          GC global ni bos, siapa aja yang buka web enih bisa ikutan ngobrol jugaw. Tahan pesan (long-press / klik
          kanan) buat balas, salin, hapus, atau lapor. btw chat ny kesimpen, jadi klo lu off, chatny masi ada.
        </p>
      </section>

      <div className="tamu-bar obrol-tamu">
        <span className="siapa">
          <Merek ukuran={18} />
          Masuk sebagai <b>{nama}</b>
        </span>
        <button
          type="button"
          className="ganti"
          onClick={() => {
            keluar();
            setPesan([]);
            setBalasan(null);
            ids.current.clear();
            pesanRef.current = [];
            waktuAkhir.current = null;
            setPilih(null);
            /* Reset paginasi + cache-marker (r28): cache ny sendiri
               tetep ke simpan di kunci user ny (isolasi per akun). */
            kursorLama.current = null;
            setLagiLama(true);
            setMuatLama(false);
            dariCache.current = false;
          }}
        >
          keluar
        </button>
      </div>

      <div className="ruang ruang-obrol">
        <div className="ruang-kepala">
          <div className="judul">
            <span className="obrol-lencana" aria-hidden="true">
              <HiasTema />
            </span>
            <h2>Obrolan Global</h2>
            <p>Siapa aja yang mampir, boleh ikutan chat sini</p>
          </div>
          <div className="status-kanan">
            <span className={"daring" + (nyambung ? " nyala" : "")} title={daring.nama.join(", ") || "Belum ada yang online"}>
              <span className="titik" aria-hidden="true" />
              {daring.jumlah > 0 ? daring.jumlah + " daring" : nyambung ? "nyambung" : "sambung ulang..."}
            </span>
          </div>
        </div>

        <div className="daftar-chat" ref={daftarRef} onScroll={cekPosisiScroll}>
          {galatMuat && (
            <div className="gagal" role="alert">
              <h2>Riwayat belum kebaca</h2>
              <p>{galatMuat}</p>
            </div>
          )}
          {/* Status paginasi ke atas (r28): lagi ngambil batch lama /
              mentok paling awal. */}
          {!galatMuat && muatLama && (
            <p className="muat-lama" role="status">
              <span className="bar" aria-hidden="true" /> Nyari pesan lama...
            </p>
          )}
          {!galatMuat && !muatLama && !lagiLama && pesan.length > 0 && (
            <p className="awal-obrolan">Ini udah paling atas — obrolan dimulai dari sini.</p>
          )}
          {!galatMuat && pesan.length === 0 && (
            <div className="kosong">
              <span className="kosong-hias" aria-hidden="true">
                <HiasTema />
              </span>
              Belum ada yang ngomong. Jadilah yang pertama, <b>ketik apa aja</b> di bawah.
            </div>
          )}
          <DaftarPesan
            pesan={pesan}
            nama={nama}
            pilih={pilih}
            onBalas={balas}
            onLompat={lompatKe}
            onMenu={bukaMenu}
            onUlang={ulangKirim}
            onTogel={(id) => {
              setPilih((p) => {
                if (!p) return p;
                const baru = new Set(p);
                if (baru.has(id)) baru.delete(id);
                else baru.add(id);
                return baru;
              });
            }}
          />
          {menulis && (
            <p className="bar-menulis">
              {menulis} lagi nulis
              <span className="ketik" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </p>
          )}
          {(adaBaru || umpan) && (
            <div className="chip-turun">
              {umpan ? (
                <span className="chip-umpan" role="status">
                  <CentangIkon ukuran={12} />
                  {umpan}
                </span>
              ) : (
                <button type="button" onClick={() => turun()}>
                  Pesan baru <Panah ukuran={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {pilih ? (
          /* Bar aksi mode pilih: nempel di tempat komposer (footprint
             ny stabil, gak loncat layout). Balas cuma pas 1 pesan.
             Hapus cuma kalo SEMUA yang kepilih boleh dihapus. Lapor
             sengaja gak ada (cuma buat 1 pesan, lewat menu ny). */
          <div className="bar-pilih" role="toolbar" aria-label={"Pesan terpilih: " + pilih.size}>
            <span className="bp-ket">
              <PilihIkon ukuran={13} />
              {pilih.size} dipilih
            </span>
            <div className="bp-aksi">
              <button type="button" className="btn kecil" onClick={() => salin(pilihanDaftar)} disabled={!pilih.size}>
                <SalinIkon ukuran={13} />
                <span className="label">Salin</span>
              </button>
              {pilih.size === 1 && (
                <button type="button" className="btn kecil" onClick={() => balas(pilihanDaftar[0])}>
                  <BalasIkon ukuran={13} />
                  <span className="label">Balas</span>
                </button>
              )}
              {semuaBisaHapus && (
                <button
                  type="button"
                  className="btn kecil bahaya"
                  onClick={() => setKonfirm({ jenis: "hapusBanyak", ids: [...pilih] })}
                >
                  <HapusIkon ukuran={13} />
                  <span className="label">Hapus</span>
                </button>
              )}
              <button type="button" className="btn kecil" onClick={() => setPilih(null)}>
                <TutupIkon ukuran={13} />
                <span className="label">Batal</span>
              </button>
            </div>
          </div>
        ) : (
          balasan && (
            /* R20/R21: bar balasan 2 baris — baris 1 label "Membalas
               <nama>" + tombol batal, baris 2 isi quote TEPAT 1 baris.
               Teks gak dipotong di JS (gak ada substring); kepotongny
               murni CSS (nowrap + overflow:hidden + ellipsis), ngikut
               lebar komposer yang tersedia. Newline di pesan asli
               collapse jadi spasi di preview (HTML), tetap 1 baris. */
            <div className="balas-bar" role="group" aria-label="Pratinjau balasan">
              <div className="balas-bar-atas">
                <span className="balas-bar-label">
                  Membalas <b>{balasan.nama}</b>
                </span>
                <button type="button" className="balas-bar-tutup" onClick={() => setBalasan(null)} aria-label="Batal balas">
                  <TutupIkon />
                </button>
              </div>
              <p className="balas-bar-teks">{balasan.teks}</p>
            </div>
          )
        )}

        <form className="komposer" onSubmit={kirim} noValidate>
          {/* r28: desktop Enter = KIRIM, Shift+Enter = baris baru.
              HP (pointer coarse): Enter tetep baris baru (natural buat
              keyboard mobile, kirim lewat tombol). IME (ketik Korea/
              Cina/dll): isComposing / keyCode 229 gak diganggu — Enter
              ny milih kandidat, bukan kirim. */}
          <textarea
            id="inputObrolan"
            ref={teksArea}
            rows={1}
            value={nilai}
            onChange={(e) => onKetik(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !enterKirim) return;
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.shiftKey) return; /* Shift+Enter: newline (default) */
              e.preventDefault();
              void kirim();
            }}
            placeholder={
              pilih
                ? "Mode pilih nyala, pilih pesan dulu..."
                : enterKirim
                  ? "Ketik pesan... (Enter kirim · Shift+Enter baris baru)"
                  : "Ketik pesan..."
            }
            aria-label="Pesan kamu"
            maxLength={500}
            autoComplete="off"
            disabled={!!pilih}
          />
          <button type="submit" className="btn primary" disabled={!nilai.trim() || !!pilih} aria-label="Kirim pesan">
            <KirimIkon />
          </button>
        </form>
        {kirimGalat && (
          <p className="hint" role="alert" style={{ padding: "0 18px 12px", color: "var(--tanda)" }}>
            {kirimGalat}
          </p>
        )}
      </div>

      {menu && <MenuAksi x={menu.x} y={menu.y} items={itemMenu(menu.p)} onTutup={() => setMenu(null)} />}

      {konfirm && (
        <Konfirmasi
          judul={
            konfirm.jenis === "lapor"
              ? "Laporkan pesan ini?"
              : konfirm.jenis === "hapusBanyak"
                ? "Hapus " + konfirm.ids.length + " pesan?"
                : "Hapus pesan ini?"
          }
          pesan={
            konfirm.jenis === "lapor"
              ? "Laporan ny langsung nyampe ke owner, lengkap sama isi pesan ny. Gak ada yang tau pelapor ny kecuali owner."
              : konfirm.jenis === "hapusBanyak"
                ? "Pesan-pesan terpilih bakal ilang buat semua orang yang buka chat ni. Gak bisa dibalikin."
                : "Pesan ny bakal ilang buat semua orang. Gak bisa dibalikin."
          }
          labelYakin={konfirm.jenis === "lapor" ? "Laporkan" : "Hapus"}
          sibuk={sibukAksi}
          onYakin={konfirm.jenis === "lapor" ? jalankanLapor : jalankanHapus}
          onBatal={() => setKonfirm(null)}
        />
      )}
    </>
  );
}

/* ---------- Daftar pesan + pemisah hari ---------- */

function DaftarPesan({
  pesan,
  nama,
  pilih,
  onBalas,
  onLompat,
  onMenu,
  onTogel,
  onUlang,
}: {
  pesan: Pesan[];
  nama: string;
  pilih: Set<string> | null;
  onBalas: (p: Pesan) => void;
  onLompat: (id: string) => void;
  onMenu: (p: Pesan) => (x: number, y: number) => void;
  onTogel: (id: string) => void;
  onUlang: (p: Pesan) => void;
}) {
  const elemen = useMemo(() => {
    const hasil: React.ReactNode[] = [];
    let hariSebelumnya = "";
    let pengirimSebelumnya = "";
    let waktuSebelumnya = 0;
    pesan.forEach((p, i) => {
      const d = new Date(p.waktu);
      const kunciHari = d.toDateString();
      if (kunciHari !== hariSebelumnya) {
        hasil.push(
          <div className="pemisah" key={"hari-" + p.id} role="presentation">
            <span>{labelHari(d)}</span>
          </div>
        );
        hariSebelumnya = kunciHari;
        pengirimSebelumnya = "";
        waktuSebelumnya = 0;
      }
      /* Nyambung = kelompok visual (pengirim sama, jeda <= 5 menit,
         masih hari yang sama): margin rapet + nama gak diulang. */
      const nyambung = p.nama === pengirimSebelumnya && d.getTime() - waktuSebelumnya < CELAH_KELOMPOK_MS;
      pengirimSebelumnya = p.nama;
      waktuSebelumnya = d.getTime();
      /* Jam kaki: muncul cuma di bubble TERAKHIR kelompok (pesan
         berikutny beda pengirim, jeda ny > 5 menit, atau gak ada
         pesan berikutny). Ini yang bikin timestamp gak nongol di
         tiap-tiap bubble. */
      const berikut = pesan[i + 1];
      const jamKaki = !berikut || berikut.nama !== p.nama || new Date(berikut.waktu).getTime() - d.getTime() > CELAH_KELOMPOK_MS;
      hasil.push(
        <BarisPesan
          key={p.klienId ?? p.id}
          p={p}
          aku={p.nama === nama}
          nyambung={nyambung}
          jamKaki={jamKaki}
          modePilih={!!pilih}
          terpilih={!!pilih?.has(p.id)}
          onBalas={onBalas}
          onLompat={onLompat}
          onMenu={onMenu(p)}
          onTogel={onTogel}
          onUlang={onUlang}
        />
      );
    });
    return hasil;
  }, [pesan, nama, pilih, onBalas, onLompat, onMenu, onTogel, onUlang]);

  return <>{elemen}</>;
}

/* ---------- Satu baris pesan (gelembung + swipe balas + aksi) ---------- */

function BarisPesan({
  p,
  aku,
  nyambung,
  jamKaki,
  modePilih,
  terpilih,
  onBalas,
  onLompat,
  onMenu,
  onTogel,
  onUlang,
}: {
  p: Pesan;
  aku: boolean;
  nyambung: boolean;
  jamKaki: boolean;
  modePilih: boolean;
  terpilih: boolean;
  onBalas: (p: Pesan) => void;
  onLompat: (id: string) => void;
  onMenu: (x: number, y: number) => void;
  onTogel: (id: string) => void;
  onUlang: (p: Pesan) => void;
}) {
  const awal = useRef<{ x: number; y: number; aktif: boolean; dx: number } | null>(null);
  const gelembungRef = useRef<HTMLDivElement>(null);
  const barisRef = useRef<HTMLDivElement>(null);
  const tekan = useTekanLama(onMenu);

  function mulai(e: React.TouchEvent) {
    if (modePilih) return;
    awal.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, aktif: false, dx: 0 };
  }

  function gerak(e: React.TouchEvent) {
    const a = awal.current;
    if (!a) return;
    const dx = e.touches[0].clientX - a.x;
    const dy = e.touches[0].clientY - a.y;
    if (!a.aktif) {
      if (Math.abs(dy) > 12) {
        awal.current = null;
        return;
      }
      if (dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        a.aktif = true;
        barisRef.current?.classList.add("menggeser");
      } else return;
    }
    a.dx = dx;
    const g = gelembungRef.current;
    if (g) g.style.transform = `translateX(${Math.max(-84, Math.min(0, dx))}px)`;
  }

  function selesai() {
    const a = awal.current;
    barisRef.current?.classList.remove("menggeser");
    const g = gelembungRef.current;
    if (g) g.style.transform = "";
    if (a && a.aktif && a.dx < -48) onBalas(p);
    awal.current = null;
  }

  return (
    <div
      className={
        "baris-pesan" +
        (aku ? " sendiri" : "") +
        (nyambung ? " nyambung" : "") +
        " baru" +
        (p.status === "kirim" ? " sambil" : "") +
        (p.status === "gagal" ? " gagal" : "") +
        (terpilih ? " terpilih" : "") +
        (modePilih ? " mode-pilih" : "")
      }
      id={"pesan-" + p.id}
      ref={barisRef}
      /* Mode pilih: seluruh BARIS jadi area togel (gak cuma gelembung,
      bubble pendek ny sempit). Klik biasa gak ngapa-ngapain. */
      onClick={modePilih ? () => onTogel(p.id) : undefined}
      /* Satu set handler sentuh yang ngerangkap dua-dua ny: geser-kiri
         buat balas + tahan 480ms buat menu aksi. Gerakan > 10px
         maturin timer tahan (di dalem useTekanLama), jadi dua ny
         gak pernah kepancing barengan. */
      onTouchStart={(e) => {
        if (modePilih) return;
        mulai(e);
        tekan.onTouchStart(e);
      }}
      onTouchMove={(e) => {
        if (modePilih) return;
        gerak(e);
        tekan.onTouchMove(e);
      }}
      onTouchEnd={(e) => {
        if (modePilih) return;
        selesai();
        tekan.onTouchEnd();
      }}
      onTouchCancel={() => {
        if (modePilih) return;
        selesai();
        tekan.onTouchCancel();
      }}
      onContextMenu={modePilih ? undefined : tekan.onContextMenu}
    >
      {/* Tombol balas + tanda pilih: dua-duanya ABSOLUTE di slot
          sisi luar baris (CSS .baris-pesan r19), di sisi yang bebas
          (badan-pesan max 78/86%), jadi gak pernah nggeser anchor
          gelembung pas ganti mode DAN gak pernah nimpa konten.
          Klik togel keurus di level baris (tanda pointer-events:
          none, cuma visual). */}
      {!modePilih && (
        <button
          type="button"
          className="tombol-balas"
          aria-label={"Balas pesan dari " + p.nama}
          onClick={() => onBalas(p)}
        >
          <BalasIkon />
        </button>
      )}
      {modePilih && (
        <span className="tanda-pilih" aria-hidden="true">
          <span className="tanda-kotak">{terpilih ? <CentangIkon ukuran={12} /> : null}</span>
        </span>
      )}
      {/* Avatar inisial: cuma buat pesan orang lain. Nongol di gelembung
          TERAKHIR kelompok (sejajar jam-kaki); sisanya spacer kosong biar
          kolom gelembung tetep lurus. Bentuk + warna ditentuin tema. */}
      {!aku && (
        <span className={"avatar-pesan" + (jamKaki ? "" : " kosong")} data-w={indeksWarna(p.nama)} aria-hidden="true">
          {jamKaki ? inisial(p.nama) : null}
        </span>
      )}
      <div className="badan-pesan">
        {!aku && !nyambung && (
          <div className="kepala-pesan">
            <span className="nama">{p.nama}</span>
          </div>
        )}
        <div
          className="gelembung"
          ref={gelembungRef}
          /* Keyboard buat mode pilih: gelembung bisa difokus + Enter/Space
             togel (klik udah keurus di level baris). */
          role={modePilih ? "button" : undefined}
          tabIndex={modePilih ? 0 : undefined}
          aria-pressed={modePilih ? terpilih : undefined}
          onKeyDown={
            modePilih
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onTogel(p.id);
                  }
                }
              : undefined
          }
        >
          {p.balasan && (
            /* R20/R21: konteks reply di dalem gelembung — full teks,
               gak ada substring JS; 1 baris via CSS ellipsis (lihat
               .balas-konteks). */
            <button
              type="button"
              className="balas-konteks"
              onClick={(e) => {
                e.stopPropagation();
                onLompat(p.balasan!.id);
              }}
              aria-label={"Lihat pesan yang dibalas dari " + p.balasan!.nama}
            >
              <b>{p.balasan.nama}</b>: {p.balasan.teks}
            </button>
          )}
          <span className="isi-pesan">{p.teks}</span>
          {/* Footer jam / status kirim: kaki TERPISAH dari area konten
              + reply (r17), jadi ikon balas gak pernah katarik tinggi
              ny. Gagal kirim -> footer ny jadi pemberitahuan + tombol
              Ulangi (tampil walau bukan ekor kelompok: kegagalan
              harus keliatan + bisa diterjang). */}
          {(jamKaki || p.status === "gagal") && (
            <span className="jam-kaki">
              {p.status === "gagal" ? (
                <>
                  Gagal kekirim
                  <button type="button" className="kirim-ulang" onClick={() => onUlang(p)}>
                    Ulangi
                  </button>
                  {jamKaki && <span aria-hidden="true">· {jam(p.waktu)}</span>}
                </>
              ) : (
                jam(p.waktu)
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
