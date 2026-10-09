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
import { KirimIkon, KiriIkon, OrangIkon, CentangIkon, TutupIkon, LencanaVerified, ObrolanIkon, Panah } from "@/components/ikon";
import { useSesi, bukaPintu } from "@/lib/sesi-pengguna";
import { useChatPribadi, tutupChat } from "@/lib/chat-pribadi";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";

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
    };
    nempelBawah.current = true;
    gabung([sementara]);
    setGalatKirim("");
    try {
      const r = await fetch("/api/teman/pesan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dengan: lg.id, teks, klienId }),
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
           komposer biar gak ilang. */
        setPesan((lama) => lama.filter((p) => p.klienId !== klienId));
        ta.value = teks;
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
      setGalatKirim("Gak nyambung ke server.");
      mainkanSfx("failure");
    }
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
                  const sendiri = p.dariId === pengguna?.id;
                  return (
                    <div key={p.id} className="cp-baris-hari">
                      {bedaHari && (
                        <div className="cp-pemisah" role="presentation">
                          <span>{labelHari(d)}</span>
                        </div>
                      )}
                      <div className={"cp-m" + (sendiri ? " sendiri" : "")}>
                        <div className="cp-gelembung">
                          <p>{p.teks}</p>
                          <span className="cp-jam">
                            {sendiri && (
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

              <div className="cp-komposer">
                <textarea
                  ref={taRef}
                  rows={1}
                  placeholder={"Pesan buat " + lawan.nama}
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
    </div>
  );
}
