"use client";

/* Chat pribadi (r32) — panel ala WhatsApp.
   - Daftar kotak teman (kiri, desktop / layar penuh HP) + obrolan
     satu lawan satu (kanan / tumpuk di HP).
   - Dibuka dari menu samping (tanpa target) atau tombol "Chat
     pribadi" di profil teman (langsung nyangkut ke obrolanny).
   - Realtime lewat mini-service socket.io (ruang per pasangan,
     "pv:" + dua id ke-sort — sama kayak yang dipake API umpan);
     polling 6 detik jadi cadangan kalau socket ny gak nyampe.
   - Teman = mutual follow. Bukan teman = gak bisa kirim (server
     yang nolak); pesan lama tetep kebaca.
   - Kunci klien (klienId): pesan yang dikirim langsung nongol
     (optimistic), diganti sama versi resmi pas respons/ socket ny
     nyampe — persis pola chat global. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { KirimIkon, KiriIkon, OrangIkon, CentangIkon, TutupIkon, LencanaVerified, ObrolanIkon, Panah, BalasIkon, SalinIkon } from "@/components/ikon";
import MenuAksi, { useTekanLama, type AksiItem } from "@/components/MenuAksi";
import { useSesi, bukaPintu } from "@/lib/sesi-pengguna";
import { useChatPribadi, tutupChat } from "@/lib/chat-pribadi";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";
import { formatSalinBanyak, salinTeks } from "@/lib/salin-chat";

type KotakTeman = {
  id: string;
  nama: string;
  username: string | null;
  pfp: string | null;
  verified: boolean;
  terakhir: { teks: string; waktu: string; dariSaya: boolean } | null;
  belumBaca: number;
};
type Saran = { id: string; nama: string; username: string | null; pfp: string | null; verified: boolean };
type Lawan = { id: string; nama: string; username: string | null; pfp: string | null; verified: boolean };
type Pesan = {
  id: string;
  teks: string;
  waktu: string;
  dariId: string;
  keId: string;
  baca: string | null;
  klienId?: string;
  /* r33: pesan yang di-quote (id, teks, waktu, + dariId buat
     mastiin label ny "Lu" atau nama lawan). */
  balasan: { id: string; teks: string; waktu: string; dariId: string } | null;
};

const pemisahJam = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" });
const jam = (w: string) => pemisahJam.format(new Date(w));

function labelHari(d: Date) {
  const kini = new Date();
  const hariIni = new Date(kini.getFullYear(), kini.getMonth(), kini.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const selisih = Math.round((hariIni.getTime() - target.getTime()) / 86400000);
  if (selisih <= 0) return "Hari ini";
  if (selisih === 1) return "Kemarin";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

function inisial(nama: string): string {
  const t = nama.trim().replace(/^@/, "");
  if (!t) return "?";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = [...new Intl.Segmenter().segment(t)];
    return (seg[0]?.["segment"] ?? "?").toUpperCase();
  }
  return t[0].toUpperCase();
}

/* Avatar kotak: img pfp atau inisial. data-w = varian warna stabil
   per nama (nyambung sama gaya ruang obrol). */
function Avatar({ user, ukuran = 44 }: { user: { id: string; nama: string; pfp: string | null }; ukuran?: number }) {
  if (user.pfp) {
    return (
      <img
        className="cp-ava"
        src={"/api/pfp/" + user.id + "?v=" + encodeURIComponent(user.pfp)}
        alt=""
        width={ukuran}
        height={ukuran}
        loading="lazy"
        decoding="async"
      />
    );
  }
  const w = (Math.abs([...(user.nama || "?")].reduce((a, c) => a + c.charCodeAt(0), 0)) % 5).toString();
  return (
    <span className="cp-ava cp-ava-kosong" data-w={w} aria-hidden="true">
      {inisial(user.nama)}
    </span>
  );
}

export default function ChatPribadi() {
  const { terbuka, target } = useChatPribadi();
  const { siap, masuk, pengguna } = useSesi();

  const [daftar, setDaftar] = useState<KotakTeman[] | null>(null);
  const [saran, setSaran] = useState<Saran[]>([]);
  const [lawan, setLawan] = useState<Lawan | null>(null);
  const [pesan, setPesan] = useState<Pesan[]>([]);
  const [lagi, setLagi] = useState(false);
  const [galatKirim, setGalatKirim] = useState("");
  const [menulis, setMenulis] = useState(false);
  const [sibukIkut, setSibukIkut] = useState<string | null>(null);
  /* r33: pesan yang lagi di-quote (bar balasan di atas komposer). */
  const [balasan, setBalasan] = useState<Pesan | null>(null);
  /* r34: menu aksi pesan (tahan di HP / klik kanan di desktop) —
     komponen MenuAksi sama kayak ruang obrolan. */
  const [menu, setMenu] = useState<{ x: number; y: number; p: Pesan } | null>(null);
  /* Umpan balik singkat ("Pesan tersalin") di dasar panel. */
  const [kabar, setKabar] = useState("");
  /* HP: pane yang keliatan (desktop dua-duany via CSS). */
  const [tampil, setTampil] = useState<"daftar" | "obrolan">("daftar");

  const soketRef = useRef<Socket | null>(null);
  const lawanRef = useRef<Lawan | null>(null);
  const daftarRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const nempelBawah = useRef(true);
  const timerMenulis = useRef(0);
  const terakhirMenulis = useRef(0);

  useEffect(() => {
    lawanRef.current = lawan;
  }, [lawan]);

  /* ---------- Muat daftar teman + saran ---------- */
  const muatDaftar = useCallback(() => {
    fetch("/api/teman", { cache: "no-store", signal: AbortSignal.timeout(12000) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setDaftar(d.teman ?? []);
        setSaran(d.pengikutBaru ?? []);
        window.dispatchEvent(new CustomEvent("cp:perbarui", { detail: { jumlahBelumBaca: d.jumlahBelumBaca ?? 0 } }));
      })
      .catch(() => {
        /* diam: coba lagi pas interval / buka ulang */
      });
  }, []);

  /* ---------- Gabung pesan (idempoten, urut waktu) ---------- */
  const gabung = useCallback((baru: Pesan[]) => {
    setPesan((lama) => {
      const peta = new Map<string, Pesan>();
      for (const p of lama) peta.set(p.klienId ? "k:" + p.klienId : "i:" + p.id, p);
      for (const p of baru) {
        const kunci = p.klienId ? "k:" + p.klienId : "i:" + p.id;
        const ada = peta.get(kunci);
        peta.set(kunci, ada ? { ...ada, ...p } : p);
        /* Pesan optimistis yang udah punya versi resmi (id server)
           pasti keganti lewat kunci klienId ny. */
        if (!p.klienId) {
          for (const [k, v] of peta) if (k.startsWith("k:") && v.id === p.id) peta.delete(k);
        }
      }
      const semua = [...peta.values()];
      semua.sort((a, b) => (a.waktu < b.waktu ? -1 : a.waktu > b.waktu ? 1 : a.id < b.id ? -1 : 1));
      return semua;
    });
  }, []);

  /* ---------- Buka obrolan sama satu teman ---------- */
  const bukaObrolan = useCallback(
    (t: { id: string; nama: string; username: string | null; pfp: string | null; verified?: boolean }) => {
      setLawan({ id: t.id, nama: t.nama, username: t.username, pfp: t.pfp, verified: !!t.verified });
      setPesan([]);
      setGalatKirim("");
      setBalasan(null);
      setTampil("obrolan");
      fetch("/api/teman/pesan?dengan=" + encodeURIComponent(t.id), { cache: "no-store", signal: AbortSignal.timeout(12000) })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          /* Guard: cuma nrima profil beneran (id + nama) — respons
             apapun yang ganjil gak boleh ngerusak header obrolan. */
          if (d.teman && typeof d.teman === "object" && d.teman.id && typeof d.teman.nama === "string") {
            setLawan(d.teman);
          }
          gabung(d.pesan ?? []);
          setLagi(!!d.lagi);
        })
        .catch(() => {
          /* diam: interval polling ny ambil alih */
        });
    },
    [gabung]
  );

  /* ---------- Buka/tutup panel ---------- */
  useEffect(() => {
    if (!terbuka) return;
    muatDaftar();
    if (target) {
      /* Dari profil: langsung ke obrolanny (info lawan ny dateng
         dari respons riwayat — sementara bikin kerangka dulu biar
         header gak kosong melompong). */
      setLawan(null);
      setTampil("obrolan");
      fetch("/api/teman/pesan?dengan=" + encodeURIComponent(target), { cache: "no-store", signal: AbortSignal.timeout(12000) })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (d.teman && typeof d.teman === "object" && d.teman.id && typeof d.teman.nama === "string") {
            setLawan(d.teman);
            gabung(d.pesan ?? []);
            setLagi(!!d.lagi);
          } else {
            setTampil("daftar");
          }
        })
        .catch(() => setTampil("daftar"));
    } else {
      setTampil("daftar");
    }
    /* r34: menu aksi dibubarkan pas panel ketutup / target ganti —
       di cleanup (bukan body) biar gak nge-trigger render berantai
       pas buka. */
    return () => setMenu(null);
    /*eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [terbuka, target]);

  /* Gulir: nempel bawah kalau user emang di bawah (gak nyulik pas
     lagi baca riwayat di atas). */
  useEffect(() => {
    nempelBawah.current = true;
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    /* r34: ganti lawan = menu aksi pesan lama gak relevan lagi. */
    return () => setMenu(null);
  }, [lawan?.id]);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (el && nempelBawah.current) el.scrollTop = el.scrollHeight;
  }, [pesan]);

  const diArea = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    nempelBawah.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  }, []);

  /* ---------- Socket realtime (nyala selama panel kebuka) ---------- */
  useEffect(() => {
    if (!terbuka || !masuk || !pengguna) return;
    const soket = io({ path: "/socket.io", transports: ["polling", "websocket"], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, timeout: 10000 });
    soketRef.current = soket;

    soket.on("pv-pesan", (p: Pesan) => {
      const lg = lawanRef.current;
      const nyambung = lg && (p.dariId === lg.id || p.keId === lg.id);
      if (nyambung) {
        gabung([p]);
        if (p.dariId === lg.id) {
          /* Lagi kebuka + dari dia = langsung ditandain dibaca. */
          fetch("/api/teman/pesan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dengan: p.dariId, aksi: "baca" }),
          }).catch(() => {});
        }
      } else if (p.keId === pengguna.id) {
        mainkanSfx("notification");
      }
      /* Kotak daftar iket segar (pesan terakhir + badge). */
      muatDaftar();
    });

    soket.on("pv-menulis", (d: { dari: string }) => {
      const lg = lawanRef.current;
      if (lg && d.dari === lg.id) {
        setMenulis(true);
        clearTimeout(timerMenulis.current);
        timerMenulis.current = window.setTimeout(() => setMenulis(false), 2800);
      }
    });

    /* ✓ -> ✓✓ live: dia buka obrolan (tanda baca dari server),
       semua pesan GUE ke dia ditandain udah kebaca. */
    soket.on("pv-baca", (d: { dari: string }) => {
      const lg = lawanRef.current;
      const aku = pengguna?.id;
      if (!lg || !aku || d.dari !== lg.id) return;
      const kini = new Date().toISOString();
      setPesan((lama) => lama.map((p) => (p.dariId === aku && p.keId === lg.id && !p.baca ? { ...p, baca: kini } : p)));
    });

    return () => {
      clearTimeout(timerMenulis.current);
      soket.disconnect();
      soketRef.current = null;
    };
    /*eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [terbuka, masuk, pengguna?.id, gabung, muatDaftar]);

  /* Join/leave ruang pasangan pas ganti lawan. */
  useEffect(() => {
    const soket = soketRef.current;
    if (!soket || !pengguna) return;
    if (lawan && soket.connected) {
      soket.emit("pv-gabung", { diri: pengguna.id, lawan: lawan.id });
    }
    return () => {
      if (lawan && soket.connected) soket.emit("pv-lepas", { diri: pengguna.id, lawan: lawan.id });
    };
  }, [lawan?.id, pengguna?.id, lawan, pengguna]);

  /* Kalau socket nyambung SETELAH lawan kepasang (race pas load),
     join pas connect. */
  useEffect(() => {
    const soket = soketRef.current;
    if (!soket) return;
    const saatNyambung = () => {
      const lg = lawanRef.current;
      if (lg && pengguna) soket.emit("pv-gabung", { diri: pengguna.id, lawan: lg.id });
    };
    soket.on("connect", saatNyambung);
    return () => {
      soket.off("connect", saatNyambung);
    };
  }, [pengguna?.id, pengguna]);

  /* ---------- Polling cadangan (socket gak nyampe = tetep jalan) ---------- */
  useEffect(() => {
    if (!terbuka || !masuk) return;
    const id = window.setInterval(() => {
      const lg = lawanRef.current;
      muatDaftar();
      if (lg) {
        fetch("/api/teman/pesan?dengan=" + encodeURIComponent(lg.id) + "&setelah=" + encodeURIComponent(new Date(Date.now() - 15000).toISOString()), {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        })
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((d) => {
            if ((d.pesan ?? []).length) gabung(d.pesan);
          })
          .catch(() => {});
      }
    }, 6000);
    return () => window.clearInterval(id);
  }, [terbuka, masuk, gabung, muatDaftar]);

  /* ---------- Tutup: Esc + kunci gulir + fokus ---------- */
  const tutupRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!terbuka) return;
    kunciGulir();
    const t = setTimeout(() => tutupRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        mainkanSfx("ui-dissolve");
        tutupChat();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      bukaKunciGulir();
    };
  }, [terbuka]);

  /* ---------- Kirim ---------- */
  async function kirim() {
    const ta = taRef.current;
    const lg = lawan;
    if (!ta || !lg || !pengguna) return;
    const teks = ta.value.trim();
    if (!teks) return;
    /* Quote ny kebawa sekalian (kalau ada), terus bar balasan
       langsung dicabut — kayak ruang obrolan. */
    const balasanKirim = balasan;
    const balasanId = balasanKirim ? balasanKirim.id : undefined;
    setBalasan(null);
    ta.value = "";
    ta.style.height = "auto";
    const klienId = "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const sementara: Pesan = {
      id: klienId,
      klienId,
      teks,
      waktu: new Date().toISOString(),
      dariId: pengguna.id,
      keId: lg.id,
      baca: null,
      balasan: balasanKirim
        ? { id: balasanKirim.id, teks: balasanKirim.teks, waktu: balasanKirim.waktu, dariId: balasanKirim.dariId }
        : null,
    };
    nempelBawah.current = true;
    gabung([sementara]);
    setGalatKirim("");
    try {
      const r = await fetch("/api/teman/pesan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dengan: lg.id, teks, klienId, balasanId }),
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 401) {
          tutupChat();
          bukaPintu();
          return;
        }
        if (d.kode === "BUKAN_TEMAN") {
          setGalatKirim(d.galat || "Kalian udah gak teman.");
          muatDaftar();
          return;
        }
        /* Gagal kirim: pesan optimistis dicopot, teks balik ke
           komposer biar gak ilang. Quote ny dibalikin juga. */
        setPesan((lama) => lama.filter((p) => p.klienId !== klienId));
        ta.value = teks;
        setBalasan(balasanKirim);
        setGalatKirim(d.galat || "Gagal kirim pesan.");
        mainkanSfx("failure");
        return;
      }
      mainkanSfx("notification");
      if (d.pesan) gabung([d.pesan]);
      muatDaftar();
    } catch {
      setPesan((lama) => lama.filter((p) => p.klienId !== klienId));
      ta.value = teks;
      setBalasan(balasanKirim);
      setGalatKirim("Gak nyambung ke server.");
      mainkanSfx("failure");
    }
  }

  /* r34: kabar singkat di dasar panel (2.4 detik, nyambung ke
     aksi salin). Tanpa ref: timeout ny cuma ngosongin kabar kalau
     teks ny masih puny ny sendiri (functional update) — kabar baru
     gak ketimpa timeout ny yang lama. */
  function beriKabar(t: string) {
    setKabar(t);
    window.setTimeout(() => setKabar((k) => (k === t ? "" : k)), 2400);
  }

  /* r34: salin satu pesan — format ny sama kayak chat global
     ([tanggal, jam] nama: teks), nama pengirim disesuaikan lawan
     obrolan ("Lu" di UI tetep "nama asli" di hasil salin).
     Sengaja baca state lawan (bukan lawanRef) biar fungsi ny
     bebas akses ref — dipanggil dari menu yang dibangun pas
     render (aturan react-hooks/refs). */
  async function salin(p: Pesan) {
    const nama = lawan ? (p.dariId === lawan.id ? lawan.nama : pengguna?.nama ?? "") : "";
    const ok = await salinTeks(formatSalinBanyak([{ nama, teks: p.teks, waktu: p.waktu }]));
    if (ok) {
      beriKabar("Pesan tersalin");
      mainkanSfx("notification");
    } else {
      beriKabar("Clipboard ny keblokir browser");
      mainkanSfx("failure");
    }
  }

  /* r34: buka menu aksi di titik (x, y) layar. */
  function bukaMenu(p: Pesan) {
    return (x: number, y: number) => {
      setMenu({ x, y, p });
      mainkanSfx("ui-menu");
    };
  }

  /* r34: isi menu aksi pesan pribadi — Balas + Salin aja (gak ada
     hapus/lapor: pesan pribadi gak punya endpoint hapus + lapor ny
     buat konten publik). */
  function itemMenu(p: Pesan): AksiItem[] {
    return [
      { id: "balas", label: "Balas", ikon: <BalasIkon ukuran={15} />, onKlik: () => balas(p) },
      { id: "salin", label: "Salin", ikon: <SalinIkon ukuran={15} />, onKlik: () => void salin(p) },
    ];
  }

  /* r33: mulai quote — bar balasan nongol di atas komposer.
     (r34) objek ny dibikin baru tiap kali biar EFEK fokus di
     bawah tetep kepancing walau nyasar pesan yang sama. */
  function balas(p: Pesan) {
    setBalasan({ ...p });
  }

  /* r34: fokus ke komposer tiap kali mulai balas — dulunya di dalem
     balas() (baca taRef), dipindah ke efek biar handler menu aksi
     (yang dibangun pas render) bebas akses ref. */
  useEffect(() => {
    if (balasan) requestAnimationFrame(() => taRef.current?.focus());
  }, [balasan]);

  /* r33: lompat ke pesan yang di-quote (klik chip quote) — scroll
     ke tengah + kedip 2x (kayak ruang obrolan). Pesannya gak
     ke-load (lebih lama dari 30 terakhir) = diem aja. */
  function lompatKe(id: string) {
    const el = document.getElementById("cp-pesan-" + id);
    if (!el) return;
    el.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    el.classList.add("sorot");
    window.setTimeout(() => el.classList.remove("sorot"), 2900);
    mainkanSfx("ui-menu");
  }

  /* Ketik: bunyi gak perlu; kasih tau lawan (di-throttle 2 detik). */
  function ketik() {
    const ta = taRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }
    const soket = soketRef.current;
    const lg = lawan;
    if (!soket || !lg || !pengguna) return;
    const kini = Date.now();
    if (kini - terakhirMenulis.current > 2000) {
      terakhirMenulis.current = kini;
      soket.emit("pv-menulis", { diri: pengguna.id, lawan: lg.id });
    }
  }

  /* ---------- Follow balik dari daftar saran ---------- */
  async function ikutiBalik(id: string) {
    setSibukIkut(id);
    try {
      const r = await fetch("/api/ikuti", {
        method: "POST",
        headers: { "Content-type": "application/json" },
        body: JSON.stringify({ targetId: id, aksi: "ikut" }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        mainkanSfx("notification");
        muatDaftar();
      } else {
        mainkanSfx("failure");
      }
    } catch {
      mainkanSfx("failure");
    } finally {
      setSibukIkut(null);
    }
  }

  /* ---------- Render ---------- */
  if (!terbuka) return null;

  /* Belum login: gerbang singket (bukan halaman kosong). */
  if (!masuk) {
    return (
      <div className="cp-lapis" role="presentation" onClick={(e) => e.target === e.currentTarget && tutupChat()}>
        <div className="cp-panel cp-panel-tamu" role="dialog" aria-modal="true" aria-label="Chat pribadi">
          <button type="button" ref={tutupRef} className="post-tutup cp-tutup" aria-label="Tutup chat pribadi" onClick={tutupChat}>
            <TutupIkon />
          </button>
          <span className="cp-tamu-ikon" aria-hidden="true">
            <ObrolanIkon ukuran={30} />
          </span>
          <h2>Chat pribadi</h2>
          <p>
            {siap ? "Fitur ny buat yang udah masuk. Masuk dulu, terus saling follow sama teman lu — otomatis kebuka obrolanny." : "Ngebaca status login..."}
          </p>
          <div className="cp-tamu-aksi">
            <button type="button" className="btn primary" onClick={bukaPintu}>
              Masuk
            </button>
            <button type="button" className="btn" onClick={tutupChat}>
              Nanti lagi
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cp-lapis" role="presentation" onClick={(e) => e.target === e.currentTarget && tutupChat()}>
      <div className="cp-panel" role="dialog" aria-modal="true" aria-label="Chat pribadi" data-tampil={tampil}>
        {/* ============ DAFTAR TEMAN ============ */}
        <aside className="cp-daftar" aria-label="Daftar teman">
          <div className="cp-kepala">
            <h2>Chat pribadi</h2>
            <button type="button" ref={tutupRef} className="post-tutup cp-tutup" aria-label="Tutup chat pribadi" onClick={tutupChat}>
              <TutupIkon />
            </button>
          </div>

          {/* Saran follow balik: pengikut yang belum dibalas */}
          {saran.length > 0 && (
            <div className="cp-saran">
              <p className="cp-saran-label">
                Nunggu dibalas <span>{saran.length}</span>
              </p>
              <ul>
                {saran.map((s) => (
                  <li key={s.id} className="cp-kotak cp-kotak-saran">
                    <Link href={"/profil/" + encodeURIComponent(s.username ?? s.nama)} className="cp-kotak-atas" onClick={tutupChat}>
                      <Avatar user={s} />
                      <span className="cp-kotak-nama">
                        <b>
                          {s.nama}
                          {s.verified && <LencanaVerified />}
                        </b>
                        <span className="cp-kotak-sub">Ikutin lo</span>
                      </span>
                    </Link>
                    <button type="button" className="btn kecil primary cp-balas-btn" onClick={() => void ikutiBalik(s.id)} disabled={sibukIkut === s.id}>
                      {sibukIkut === s.id ? "..." : "Follow balik"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="cp-daftar-isi" ref={daftarRef}>
            {daftar === null && <p className="cp-kosong">Ngitung teman lu...</p>}
            {daftar !== null && daftar.length === 0 && saran.length === 0 && (
              <div className="cp-kosong cp-kosong-penuh">
                <span className="cp-kosong-ikon" aria-hidden="true">
                  <OrangIkon ukuran={30} />
                </span>
                <b>Belum ada teman</b>
                <p>Teman = saling follow. Follow balik yang ikutin lo, atau mampir ke profil orang dan ikutin — pas dia balas, otomatis jadi teman dan kebuka chat ny.</p>
              </div>
            )}
            {daftar !== null && daftar.length > 0 && (
              <ul>
                {daftar.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={"cp-kotak" + (lawan?.id === t.id ? " aktif" : "") + (t.belumBaca > 0 ? " belum" : "")}
                      onClick={() => bukaObrolan(t)}
                      aria-current={lawan?.id === t.id ? "true" : undefined}
                    >
                      <Avatar user={t} />
                      <span className="cp-kotak-badan">
                        <span className="cp-kotak-baris">
                          <b className="cp-kotak-nama">
                            {t.nama}
                            {t.verified && <LencanaVerified />}
                          </b>
                          <span className="cp-kotak-waktu">{t.terakhir ? jam(t.terakhir.waktu) : ""}</span>
                        </span>
                        <span className="cp-kotak-baris">
                          <span className="cp-kotak-cuplik">
                            {t.terakhir ? (t.terakhir.dariSaya ? "Lu: " : "") + t.terakhir.teks : "Jadi teman — mulai ngobrol"}
                          </span>
                          {t.belumBaca > 0 && <span className="cp-badge">{t.belumBaca > 99 ? "99+" : t.belumBaca}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ============ OBROLAN ============ */}
        <section className="cp-obrolan" aria-label="Obrolan">
          {!lawan ? (
            <div className="cp-obrolan-kosong">
              <span className="cp-kosong-ikon" aria-hidden="true">
                <ObrolanIkon ukuran={34} />
              </span>
              <p>Pilih teman di kiri buat mulai ngobrol. Di HP: balik ke daftar pake tombol panah.</p>
              <button type="button" className="btn kecil cp-ke-daftar" onClick={() => setTampil("daftar")}>
                <KiriIkon ukuran={14} />
                Daftar teman
              </button>
            </div>
          ) : (
            <>
              <div className="cp-kepala cp-kepala-obrolan">
                <button type="button" className="cp-balik" aria-label="Balik ke daftar teman" onClick={() => setTampil("daftar")}>
                  <KiriIkon ukuran={18} />
                </button>
                <Link className="cp-lawan" href={"/profil/" + encodeURIComponent(lawan.username ?? lawan.nama)} onClick={tutupChat}>
                  <Avatar user={lawan} ukuran={34} />
                  <span className="cp-lawan-nama">
                    <b>
                      {lawan.nama}
                      {lawan.verified && <LencanaVerified />}
                    </b>
                    <span>{menulis ? "lagi nulis..." : lawan.username ? "@" + lawan.username : "Teman"}</span>
                  </span>
                </Link>
                <button type="button" className="post-tutup cp-tutup" aria-label="Tutup chat pribadi" onClick={tutupChat}>
                  <TutupIkon />
                </button>
              </div>

              <div className="cp-area" ref={areaRef} onScroll={diArea}>
                {pesan.length === 0 && (
                  <p className="cp-area-kosong">Belum ada obrolan. Sapa duluan gak dosa.</p>
                )}
                {pesan.map((p, i) => {
                  const d = new Date(p.waktu);
                  const bedaHari = i === 0 || labelHari(new Date(pesan[i - 1].waktu)) !== labelHari(d);
                  return (
                    <div key={p.id} className="cp-baris-hari">
                      {bedaHari && (
                        <div className="cp-pemisah" role="presentation">
                          <span>{labelHari(d)}</span>
                        </div>
                      )}
                      <BarisPesan
                        p={p}
                        aku={p.dariId === pengguna?.id}
                        idLawan={lawan.id}
                        namaLawan={lawan.nama}
                        onBalas={balas}
                        onLompat={lompatKe}
                        onMenu={bukaMenu(p)}
                      />
                    </div>
                  );
                })}
                {menulis && (
                  <div className="cp-m" aria-live="polite">
                    <div className="cp-gelembung cp-gelembung-menulis">
                      <span className="cp-titik">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {galatKirim && (
                <p className="cp-galat" role="alert">
                  {galatKirim}
                </p>
              )}

              {/* r33: bar balasan — muncul pas ada pesan yang lagi
                  di-quote. Dua baris: label "Membalas <nama>" + tombol
                  batal, terus cuplikan 1 baris (dipotong CSS doang). */}
              {balasan && (
                <div className="cp-balas-bar" role="group" aria-label="Pratinjau balasan">
                  <div className="cp-balas-bar-atas">
                    <span className="cp-balas-bar-label">
                      Membalas <b>{balasan.dariId === lawan.id ? lawan.nama : "Lu"}</b>
                    </span>
                    <button type="button" className="cp-balas-bar-tutup" onClick={() => setBalasan(null)} aria-label="Batal balas">
                      <TutupIkon />
                    </button>
                  </div>
                  <p className="cp-balas-bar-teks">{balasan.teks}</p>
                </div>
              )}

              <div className="cp-komposer">
                <textarea
                  ref={taRef}
                  rows={1}
                  placeholder={balasan ? "Balas pesan ny..." : "Pesan buat " + lawan.nama}
                  aria-label={"Pesan buat " + lawan.nama}
                  onChange={ketik}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void kirim();
                    }
                  }}
                />
                <button type="button" className="cp-kirim" aria-label="Kirim pesan" onClick={() => void kirim()}>
                  <KirimIkon ukuran={17} />
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {/* r34: menu aksi pesan (tahan / klik kanan) — fixed di posisi
          pointer, dijepit biar gak keluar viewport (urusan ny
          MenuAksi). Z-index ny diangkat di chat-pribadi.css biar
          di atas lapisan panel (cp-lapis 420 > menu-aksi 400). */}
      {menu && <MenuAksi x={menu.x} y={menu.y} items={itemMenu(menu.p)} onTutup={() => setMenu(null)} />}

      {/* r34: kabar singkat ("Pesan tersalin") di dasar panel. */}
      {kabar && (
        <p className="cp-kabar" role="status">
          {kabar}
        </p>
      )}
    </div>
  );
}

/* ---------- Satu baris pesan (r33): gelembung + quote + balas ----------
   Satu set interaksi buat nyalain quote (kayak BarisPesan di ruang
   obrolan, versi pribadi):
   - Geser-kiri di HP (dorong > 12px mulai, lepas pas lewat -48px)
   - Tombol balas: nongol pas hover/fokus (desktop) / lagi nggeser
   - Klik-dobel gelembung (desktop) = balas juga
   - Tahan 480ms (HP) / klik kanan (desktop) = menu aksi (r34):
     Balas + Salin — persis pola ruang obrol, pake hook useTekanLama
     yang sama; gerakan > 10px maturin timer, jadi swipe + tahan
     gak pernah kepancing barengan.
   - Chip quote di dalem gelembung: klik = lompat ke pesan aslinya
   Gerakan vertikal maturin swipe (lagi scroll) — handler ny pasif,
   browser tetep ngatur scroll. */
function BarisPesan({
  p,
  aku,
  idLawan,
  namaLawan,
  onBalas,
  onLompat,
  onMenu,
}: {
  p: Pesan;
  aku: boolean;
  idLawan: string;
  namaLawan: string;
  onBalas: (p: Pesan) => void;
  onLompat: (id: string) => void;
  onMenu: (x: number, y: number) => void;
}) {
  const awal = useRef<{ x: number; y: number; aktif: boolean; dx: number } | null>(null);
  const barisRef = useRef<HTMLDivElement | null>(null);
  const gelembungRef = useRef<HTMLDivElement | null>(null);
  const tekan = useTekanLama(onMenu);

  function mulai(e: React.TouchEvent) {
    awal.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, aktif: false, dx: 0 };
  }

  function gerak(e: React.TouchEvent) {
    const a = awal.current;
    if (!a) return;
    const dx = e.touches[0].clientX - a.x;
    const dy = e.touches[0].clientY - a.y;
    if (!a.aktif) {
      /* Gerakan vertikal lebih dominan = user lagi scroll, bukan
         nge-swipe — nyerahin ke browser. */
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

  /* Label pengirim quote: dari lawan = nama ny, dari sendiri = "Lu". */
  const namaQuote = p.balasan ? (p.balasan.dariId === idLawan ? namaLawan : "Lu") : "";

  return (
    <div
      className={"cp-m" + (aku ? " sendiri" : "")}
      ref={barisRef}
      id={"cp-pesan-" + p.id}
      /* Satu set handler sentuh ngerangkap dua-dua ny (pola ruang
         obrol): geser-kiri buat balas + tahan 480ms buat menu aksi.
         Gerakan > 10px maturin timer tahan (dalem useTekanLama). */
      onTouchStart={(e) => {
        mulai(e);
        tekan.onTouchStart(e);
      }}
      onTouchMove={(e) => {
        gerak(e);
        tekan.onTouchMove(e);
      }}
      onTouchEnd={(e) => {
        selesai();
        tekan.onTouchEnd();
      }}
      onTouchCancel={(e) => {
        selesai();
        tekan.onTouchCancel();
      }}
      onContextMenu={tekan.onContextMenu}
    >
      {/* Tombol balas: nempel di sisi bebas baris (kanan buat pesan
          dia, kiri buat pesan gue) — gak pernah nimpa gelembung. */}
      <button
        type="button"
        className="cp-tombol-balas"
        aria-label={"Balas pesan" + (aku ? " sendiri" : " dari " + namaLawan)}
        title="Balas (atau klik-dobel pesan)"
        onClick={() => onBalas(p)}
      >
        <BalasIkon />
      </button>
      <div
        className="cp-gelembung"
        ref={gelembungRef}
        onDoubleClick={() => onBalas(p)}
      >
        {p.balasan && (
          <button
            type="button"
            className="cp-balas-konteks"
            onClick={(e) => {
              e.stopPropagation();
              onLompat(p.balasan!.id);
            }}
            aria-label={"Lihat pesan yang dibalas dari " + namaQuote}
          >
            <b>{namaQuote}</b>: {p.balasan.teks}
          </button>
        )}
        <p>{p.teks}</p>
        <span className="cp-jam">
          {aku && (
            <span className="cp-cek" aria-label={p.baca ? "Dibaca" : "Terkirim"}>
              {p.baca ? (
                <>
                  <CentangIkon ukuran={11} />
                  <CentangIkon ukuran={11} />
                </>
              ) : (
                <CentangIkon ukuran={11} />
              )}
            </span>
          )}
          {jam(p.waktu)}
        </span>
      </div>
    </div>
  );
}
