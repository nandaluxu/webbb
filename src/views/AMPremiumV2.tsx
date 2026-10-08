"use client";

/* AM Prem Generator V2 (r34): alur otomatis 1-klik — temp mail
   dibikinin, magic link dikirimin, email verifikasi ditemuin
   sendiri, premium langsung diaktifin. Nggak ada lagi "salin link
   dari email terus tempel" kayak V1 (V1 tetep ada di fitur
   terpisah).

   Bagian-bagian ny:
   1. GENERATOR: tombol Generate -> job server-side (state:
      Menyiapkan / Membuat account / Menunggu / Berhasil / Gagal —
      selalu ada info, gak ada spinner kosong).
   2. KOTAK MASUK: email sementara + isiny bisa dibuka ulang kapan
      aja (kredensial ny disimpen server, nempel ke akun lu —
      pindah halaman/refresh gak ilang). Link login buat aplikasi
      HP ny diambil dari sini juga (tombol "Deteksi link" di
      tiap pesan). Tombol email ny bisa ditahan (HP) / diklik
      kanan (desktop) -> Salin email + Hapus dari daftar (r34).
   3. 5MB CONVERTER: link preset alight.link -> file XML + audio
      ny (kalau ada) siap diunduh.
   4. BULK ACCOUNT (cuma owner/admin): beberapa akun sekaligus +
      progres ny per akun. Tiap akun hasil ny dapet baris
      ringkas (r33): [Salin email] + [Salin magic link] — link
      ny dikerjaain job link-hp (kirim link BARU ke email ny,
      dijemput, otomatis ke-salin), gak usah buka-buka inbox.

   Layout (r32, khusus desktop >= 1100px): dua kolom — panel
   AM Prem 1 Tahun (generator + kotak masuk) di kiri, 5MB
   Converter + Bulk Account numpuk di kanan, jadi space kanan
   gak nganggur. Layar lebih sempit tetep satu kolom kebawah. */

import { useCallback, useEffect, useRef, useState } from "react";
import { AsetIkon, CentangIkon, SalinIkon, Merek, Panah, UnduhIkon, SuratIkon, TutupIkon, FotoIkon, TautanIkon, HapusIkon } from "@/components/ikon";
import MenuAksi, { useTekanLama, type AksiItem } from "@/components/MenuAksi";
import Konfirmasi from "@/components/Konfirmasi";
import { mainkanSfx } from "@/lib/suara";
import { salinTeks } from "@/lib/salin-chat";
import { useSesi } from "@/lib/sesi-pengguna";
import { waktuRelatif, useDetakWaktu } from "@/lib/waktu";

type AkunV2 = { email: string; uid: string | null; kode: string | null; status: string; waktu: string };

type JobGenerate = {
  id: string;
  jenis: "generate";
  tahap: string;
  pesan: string;
  email: string | null;
  hasil: { email: string; uid: string | null; kode: string | null } | null;
};

type JobBulk = {
  id: string;
  jenis: "bulk";
  tahap: string;
  pesan: string;
  total: number;
  selesaiN: number;
  berhasilN: number;
  gagalN: number;
  log: string[];
  hasil: { email: string; kode: string | null; loginUrl?: string }[];
};

/* Job link-hp (r33): dipake BULK doang sekarang — tiap akun hasil
   bulk punya tombol "Salin magic link" ny sendiri. Satu job per
   user pada satu waktu; hasil ny (loginUrl) otomatis dicoba
   ke-salin ke clipboard. */
type JobLinkHP = {
  id: string;
  jenis: "linkhp";
  tahap: string;
  pesan: string;
  email: string | null;
  loginUrl: string | null;
};

type Preset = {
  judul: string;
  deskripsi: string;
  pratinjau: string | null;
  paketId: string;
  adaXml: boolean;
  adaAudio: boolean;
  unduhXml: string | null;
  unduhAudio: string | null;
};

type Inbox = { daftar: { id: string; dari: string; subjek: string; waktu: string; intro: string }[] };

/* Hasil deteksi link pintar (r31) dari satu pesan. */
type PesanLink = { id: string; subjek: string; links: string[] };

const TEKS_TAHAP: Record<string, string> = {
  menyiapkan: "Menyiapkan...",
  "buat-mail": "Membuat account...",
  "kirim-link": "Mengirim magic link...",
  "nunggu-email": "Menunggu...",
  verifikasi: "Memverifikasi...",
  aktivasi: "Mengaktifkan premium...",
  selesai: "Berhasil",
  gagal: "Gagal",
};

function tahapTeks(t: string): string {
  return TEKS_TAHAP[t] || t;
}

export default function AMPremiumV2() {
  const { siap, masuk, pengguna } = useSesi();
  const detak = useDetakWaktu(30000);
  const owner = !!pengguna?.admin;

  const [job, setJob] = useState<JobGenerate | null>(null);
  const [akun, setAkun] = useState<AkunV2[]>([]);
  const [sibukMulai, setSibukMulai] = useState(false);
  const [galat, setGalat] = useState("");

  /* Kotak masuk (re-access). */
  const [inboxBuka, setInboxBuka] = useState<{ email: string; daftar: Inbox["daftar"] } | null>(null);
  const [inboxGalat, setInboxGalat] = useState("");
  const [inboxSibuk, setInboxSibuk] = useState(false);

  /* Deteksi link pintar (r31): satu pesan dibuka lengkap,
     semua link ny dikeruk server-side. Pesan aktif = id ny;
     hasil ny di-cache per pesan biar bolak-balik gak nembak
     ulang. */
  const [pesanLink, setPesanLink] = useState<PesanLink | null>(null);
  const [pesanSibuk, setPesanSibuk] = useState<string | null>(null);
  const [pesanGalat, setPesanGalat] = useState("");

  /* Salin (kode pembelian / link hasil deteksi). */
  const [tersalin, setTersalin] = useState<string | null>(null);
  const salinTimer = useRef(0);

  /* 5MB Converter. */
  const [presetUrl, setPresetUrl] = useState("");
  const [preset, setPreset] = useState<Preset | null>(null);
  const [presetSibuk, setPresetSibuk] = useState(false);
  const [presetGalat, setPresetGalat] = useState("");

  /* Bulk (owner). */
  const [bulkJumlah, setBulkJumlah] = useState("3");
  const [bulk, setBulk] = useState<JobBulk | null>(null);
  const [bulkSibuk, setBulkSibuk] = useState(false);
  const [bulkGalat, setBulkGalat] = useState("");

  /* Magic link buat akun bulk (r33): satu job link-hp aktif,
    dikendaliin tombol ringkas di tiap baris hasil bulk. */
  const [linkHp, setLinkHp] = useState<JobLinkHP | null>(null);

  /* Menu aksi riwayat akun (r34): klik kanan (desktop) / tahan
     (HP) di tombol email -> Salin email + Hapus (lewat konfirmasi
     dulu — akun ny arsip ny, bukan premium ny). */
  const [menuAkun, setMenuAkun] = useState<{ x: number; y: number; email: string } | null>(null);
  const [konfirmAkun, setKonfirmAkun] = useState<string | null>(null);
  const [hapusSibuk, setHapusSibuk] = useState(false);
  /* Email yang udah dihapus di sesi ini — biar chip hasil generate
     fresh (yang belum masuk daftar server) juga ilang. */
  const [emailDihapus, setEmailDihapus] = useState<Set<string>>(new Set());

  /* ---------- Muat ringkasan (recovery: job aktif ny ketemu lagi
     pas refresh / balik dari halaman laen). ---------- */
  const muat = useCallback(async () => {
    try {
      const r = await fetch("/api/fitur/am-v2", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (r.status === 401) return;
      const d = await r.json();
      setAkun(Array.isArray(d.akun) ? d.akun : []);
      if (d.aktif?.generate) {
        const jr = await fetch("/api/fitur/am-v2?job=" + encodeURIComponent(d.aktif.generate), { cache: "no-store" });
        if (jr.ok) {
          const jd = await jr.json();
          if (jd.job?.jenis === "generate") setJob(jd.job);
        }
      }
      if (owner && d.bulk) setBulk(d.bulk);
    } catch {
      /* jaringan recovery global yang urus */
    }
  }, [owner]);

  useEffect(() => {
    if (!siap || !masuk) return;
    void muat();
  }, [siap, masuk, muat]);

  /* ---------- Polling job generator (2.5 detik): ringkasan +
     status job aktif; berhenti pas terminal + SFX pas ganti
     tahap (feedback ny jelas, gak cuma spinner). ---------- */
  const jobJalan = !!job && job.tahap !== "selesai" && job.tahap !== "gagal";
  useEffect(() => {
    if (!job || !jobJalan) return;
    const t = window.setInterval(async () => {
      try {
        const r = await fetch("/api/fitur/am-v2", { cache: "no-store", signal: AbortSignal.timeout(12000) });
        if (!r.ok) return;
        const d = await r.json();
        setAkun(Array.isArray(d.akun) ? d.akun : []);
        if (!d.aktif?.generate) {
          /* Job udah gak aktif = terminal. Ambil status FINAL ny
             sekali lagi (kode pembelian + pesan ny ada di situ),
             baru segarkan daftar akun. */
          if (job.id) {
            const jr = await fetch("/api/fitur/am-v2?job=" + encodeURIComponent(job.id), { cache: "no-store" });
            if (jr.ok) {
              const jd = await jr.json();
              if (jd.job?.jenis === "generate") {
                setJob(jd.job);
                mainkanSfx(jd.job.tahap === "gagal" ? "failure" : "digital-burst");
              }
            }
          }
          void muat();
          return;
        }
        const jr = await fetch("/api/fitur/am-v2?job=" + encodeURIComponent(d.aktif.generate), { cache: "no-store" });
        if (jr.ok) {
          const jd = await jr.json();
          if (jd.job?.jenis === "generate") {
            setJob((p) => {
              if (!p) return jd.job;
              if (p.tahap !== jd.job.tahap) {
                mainkanSfx(jd.job.tahap === "gagal" ? "failure" : "ui-menu");
              }
              return jd.job;
            });
          }
        }
      } catch {
        /* bentar lagi */
      }
    }, 2500);
    return () => window.clearInterval(t);
  }, [job, jobJalan, muat]);

  /* Polling bulk (owner). */
  const bulkJalan = !!bulk && bulk.tahap === "jalan";
  useEffect(() => {
    if (!owner || !bulkJalan) return;
    const t = window.setInterval(async () => {
      try {
        const r = await fetch("/api/fitur/am-v2", { cache: "no-store", signal: AbortSignal.timeout(12000) });
        if (!r.ok) return;
        const d = await r.json();
        setBulk(d.bulk ?? null);
        if (!d.bulk || d.bulk.tahap !== "jalan") mainkanSfx("notification");
      } catch {
        /* bentar lagi */
      }
    }, 3000);
    return () => window.clearInterval(t);
  }, [owner, bulkJalan]);

  /* Polling job link-hp (r33, magic link buat akun bulk): pas
     job ny selesai, link ny otomatis dicoba ke-salin (best
     effort — beberapa browser nolak clipboard tanpa interaksi
     baru) + baris link ny tetep ditampilin sebagai cadangan salin
     manual. */
  const linkHpJalan = !!linkHp && linkHp.tahap !== "selesai" && linkHp.tahap !== "gagal";
  useEffect(() => {
    if (!linkHp || !linkHpJalan) return;
    const t = window.setInterval(async () => {
      try {
        const r = await fetch("/api/fitur/am-v2", { cache: "no-store", signal: AbortSignal.timeout(12000) });
        if (!r.ok) return;
        const d = await r.json();
        if (!d.aktif?.linkhp) {
          /* Job udah gak aktif = terminal. Ambil status final ny
             (loginUrl ny ada di situ) sekali lagi. */
          if (linkHp.id) {
            const jr = await fetch("/api/fitur/am-v2?job=" + encodeURIComponent(linkHp.id), { cache: "no-store" });
            if (jr.ok) {
              const jd = await jr.json();
              if (jd.job?.jenis === "linkhp") {
                setLinkHp(jd.job);
                if (jd.job.tahap === "selesai" && jd.job.loginUrl) {
                  void salin(jd.job.loginUrl, "bulk-link-" + jd.job.email);
                } else if (jd.job.tahap === "gagal") {
                  mainkanSfx("failure");
                }
              }
            }
          }
          return;
        }
        const jr = await fetch("/api/fitur/am-v2?job=" + encodeURIComponent(d.aktif.linkhp), { cache: "no-store" });
        if (jr.ok) {
          const jd = await jr.json();
          if (jd.job?.jenis === "linkhp") {
            setLinkHp((p) => {
              if (!p) return jd.job;
              if (p.tahap !== jd.job.tahap) mainkanSfx("ui-menu");
              return jd.job;
            });
          }
        }
      } catch {
        /* bentar lagi */
      }
    }, 2500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkHp, linkHpJalan]);

  /* ---------- Aksi. ---------- */
  async function mulai() {
    if (sibukMulai || jobJalan) return;
    setSibukMulai(true);
    setGalat("");
    setJob({ id: "", jenis: "generate", tahap: "menyiapkan", pesan: "Menyiapkan...", email: null, hasil: null });
    try {
      const r = await fetch("/api/fitur/am-v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aksi: "mulai" }),
        signal: AbortSignal.timeout(20000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setGalat(d.galat || "Gagal mulai. Coba lagi.");
        setJob(null);
        mainkanSfx("failure");
        return;
      }
      void muat();
    } catch {
      setGalat("Gak nyambung ke server. Cek koneksi ny, coba lagi.");
      setJob(null);
      mainkanSfx("failure");
    } finally {
      setSibukMulai(false);
    }
  }

  async function bukaInbox(email: string) {
    setInboxSibuk(true);
    setInboxGalat("");
    setInboxBuka(null);
    setPesanLink(null);
    setPesanGalat("");
    try {
      const r = await fetch("/api/fitur/am-v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aksi: "inbox", email }),
        signal: AbortSignal.timeout(30000),
      });
      const d = await r.json();
      if (!r.ok) {
        setInboxGalat(d.galat || "Kotak masukny gak bisa dibuka.");
        return;
      }
      setInboxBuka({ email, daftar: Array.isArray(d.daftar) ? d.daftar : [] });
      mainkanSfx("ui-menu");
    } catch {
      setInboxGalat("Gak nyambung ke server.");
    } finally {
      setInboxSibuk(false);
    }
  }

  /* Deteksi link pintar (r31): buka SATU pesan di server, semua
     link ny (href + teks) dikeruk + dibalikin ke sini. Hasil ny
     dikasih label "Link 1, Link 2..." — tiap baris bisa disalin
     ATAU langsung dipencet (buka tab baru). */
  async function deteksiLink(email: string, id: string, subjek: string) {
    if (pesanSibuk) return;
    if (pesanLink?.id === id) {
      /* Klik ulang pesen yang sama = tutup (toggle). */
      setPesanLink(null);
      return;
    }
    setPesanSibuk(id);
    setPesanGalat("");
    try {
      const r = await fetch("/api/fitur/am-v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aksi: "pesan", email, id }),
        signal: AbortSignal.timeout(30000),
      });
      const d = await r.json();
      if (!r.ok) {
        setPesanGalat(d.galat || "Isi pesanny gak bisa dibuka.");
        mainkanSfx("failure");
        return;
      }
      setPesanLink({ id, subjek: d.subjek || subjek, links: Array.isArray(d.links) ? d.links : [] });
      mainkanSfx(d.links?.length ? "digital-burst" : "ui-menu");
    } catch {
      setPesanGalat("Gak nyambung ke server.");
      mainkanSfx("failure");
    } finally {
      setPesanSibuk(null);
    }
  }

  async function salin(teks: string, penanda: string) {
    const ok = await salinTeks(teks);
    if (ok) {
      setTersalin(penanda);
      mainkanSfx("digital-burst");
      clearTimeout(salinTimer.current);
      salinTimer.current = window.setTimeout(() => setTersalin(null), 2400);
    }
  }

  async function ambilPreset() {
    const url = presetUrl.trim();
    if (!url || presetSibuk) return;
    setPresetSibuk(true);
    setPresetGalat("");
    setPreset(null);
    try {
      const r = await fetch("/api/fitur/am-v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aksi: "preset", url }),
        signal: AbortSignal.timeout(40000),
      });
      const d = await r.json();
      if (!r.ok) {
        setPresetGalat(d.galat || "Gagal ngambil data preset ny.");
        mainkanSfx("failure");
        return;
      }
      setPreset(d);
      mainkanSfx("notification");
    } catch {
      setPresetGalat("Gak nyambung ke server. Cek koneksi ny.");
      mainkanSfx("failure");
    } finally {
      setPresetSibuk(false);
    }
  }

  /* Magic link buat SATU akun bulk (r33): kirim link login baru ke
     email ny (job server-side link-hp), link ny dijemput otomatis,
     terus ke-salin sendiri pas nyampe. Dipencet lagi setelah selesai
     = minta link TERBARU lagi. */
  async function bikinLinkBulk(email: string) {
    if (linkHpJalan) return;
    setLinkHp({ id: "", jenis: "linkhp", tahap: "menyiapkan", pesan: "Menyiapkan...", email, loginUrl: null });
    try {
      const r = await fetch("/api/fitur/am-v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aksi: "link-hp", email }),
        signal: AbortSignal.timeout(20000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLinkHp({ id: "", jenis: "linkhp", tahap: "gagal", pesan: d.galat || "Gagal bikin magic link.", email, loginUrl: null });
        mainkanSfx("failure");
        return;
      }
      /* id job ny disimpen biar status final ny bisa diambil pas
         job udah gak aktif lagi. */
      if (d.id) setLinkHp((p) => (p && p.email === email && !p.id ? { ...p, id: d.id } : p));
    } catch {
      setLinkHp({ id: "", jenis: "linkhp", tahap: "gagal", pesan: "Gak nyambung ke server.", email, loginUrl: null });
      mainkanSfx("failure");
    }
  }

  async function mulaiBulk() {
    if (bulkSibuk || bulkJalan) return;
    const n = parseInt(bulkJumlah, 10);
    if (!Number.isFinite(n) || n < 1) {
      setBulkGalat("Jumlahny minimal 1.");
      return;
    }
    setBulkSibuk(true);
    setBulkGalat("");
    try {
      const r = await fetch("/api/fitur/am-v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aksi: "bulk", jumlah: n }),
        signal: AbortSignal.timeout(20000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBulkGalat(d.galat || "Gagal mulai bulk.");
        mainkanSfx("failure");
        return;
      }
      void muat();
    } catch {
      setBulkGalat("Gak nyambung ke server.");
    } finally {
      setBulkSibuk(false);
    }
  }

  /* ---------- Menu aksi riwayat akun (r34): item ny + eksekusi
     hapus ny. Hapus lewat konfirmasi dulu (aksi destruktif —
     meskipun premium ny gak ikut kebatalin, arsip email ny
     gak bisa dibalikin). ---------- */
  function itemMenuAkun(email: string): AksiItem[] {
    return [
      { id: "salin", label: "Salin email", ikon: <SalinIkon ukuran={15} />, onKlik: () => void salin(email, "menu-akun-" + email) },
      { id: "hapus", label: "Hapus", ikon: <HapusIkon ukuran={15} />, bahaya: true, onKlik: () => setKonfirmAkun(email) },
    ];
  }

  async function jalankanHapusAkun() {
    const email = konfirmAkun;
    if (!email || hapusSibuk) return;
    setHapusSibuk(true);
    try {
      const r = await fetch("/api/fitur/am-v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aksi: "hapus-akun", email }),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setInboxGalat(d.galat || "Gagal hapus akun ny.");
        mainkanSfx("failure");
        return;
      }
      setAkun((p) => p.filter((a) => a.email !== email));
      setEmailDihapus((p) => (p.has(email) ? p : new Set(p).add(email)));
      /* Kotak masuk yang lagi kebuka kalau email ny yang diapus:
         ditutup juga (gak nyangkut nampilin arsip yang udah ilang). */
      if (inboxBuka?.email === email) setInboxBuka(null);
      mainkanSfx("ui-dissolve");
    } catch {
      setInboxGalat("Gak nyambung ke server.");
      mainkanSfx("failure");
    } finally {
      setHapusSibuk(false);
      setKonfirmAkun(null);
    }
  }

  /* ---------- Gerbang login. ---------- */
  if (siap && !masuk) {
    return (
      <section className="head">
        <h1 className="masuk on">AM Prem Generator V2</h1>
        <p className="lede">Login dulu, soalny email sementara + hasil generate ny nempel ke akun lu biar bisa dibuka lagi kapan aja.</p>
      </section>
    );
  }

  const hasilGenerate = job?.tahap === "selesai" ? job : null;
  const gagalGenerate = job?.tahap === "gagal" ? job : null;

  /* Daftar email yang kotak masukny bisa dibuka: akun fresh dari
     generate ny nangkring paling depan, sisany yang tersimpen. */
  const emailBaru = hasilGenerate?.hasil?.email ?? null;
  const emailTersedia = (
    emailBaru && !emailDihapus.has(emailBaru)
      ? [emailBaru, ...akun.filter((a) => a.email !== emailBaru).map((a) => a.email)]
      : akun.map((a) => a.email)
  ).slice(0, 8);

  return (
    <>
      <section className="head">
        <h1>AM Prem Generator V2</h1>
        <p className="lede">
          Versi 2.0: sekali klik, semua ny otomatis — email sementara dibikinin, magic link ny dijemput sendiri, premium 1 tahun
          langsung nempel. Hasil + kotak masuk ny tersimpen di akun lu.
        </p>
      </section>

      <div className="amv2-grid">
        <div className="am-panel">
          <div className="am-kepala">
            <span className="am-logo" aria-hidden="true">
              <AsetIkon nama="am" ukuran={40} />
            </span>
            <div className="am-judul">
              <h2>AM Premium · 1 Tahun</h2>
              <p>
                <Merek ukuran={12} /> Neyhra Playground
              </p>
            </div>
          </div>

          {/* ---------- Tombol utama + status. ---------- */}
          <div className="am-langkah">
            <button type="button" className="btn primary am-tombol" onClick={() => void mulai()} disabled={sibukMulai || jobJalan}>
              {jobJalan ? tahapTeks(job!.tahap) : "Generate Akun"}
            </button>

            {job && jobJalan && (
              <div className="eg-status jalan" role="status">
                <span className="eg-status-titik" aria-hidden="true" />
                <div>
                  <b>{tahapTeks(job.tahap)}</b>
                  <p>
                    {job.pesan}
                    {job.email ? " (" + job.email + ")" : ""}. Ini jalan di server — boleh ditinggal, balik lagi aja nanti, proses ny
                    tetep lanjut.
                  </p>
                </div>
              </div>
            )}

            {hasilGenerate && (
              <div className="am-berhasil" role="status">
                <span className="am-berhasil-ikon" aria-hidden="true">
                  <CentangIkon ukuran={34} />
                </span>
                <h2>Selamat!</h2>
                <p>
                  AM Premium <b>1 tahun</b> aktif buat <b>{hasilGenerate.hasil?.email || hasilGenerate.email}</b>. Link login buat aplikasi
                  HP ny ada di kotak masuk — langkah 2 di bawah: buka email ny, pencet "Deteksi link", terus salin/buka dari HP.
                </p>
                {hasilGenerate.hasil?.kode && (
                  <div className="am-kode">
                    <span className="ket">Kode pembelian</span>
                    <code>{hasilGenerate.hasil.kode}</code>
                    <button type="button" className="btn kecil" onClick={() => void salin(hasilGenerate.hasil!.kode!, "kode")}>
                      <SalinIkon ukuran={13} />
                      {tersalin === "kode" ? "Tersalin" : "Salin kode"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {gagalGenerate && (
              <div className="eg-status gagal" role="alert">
                <b>Gagal</b>
                <p>{gagalGenerate.pesan}</p>
              </div>
            )}

            {galat && (
              <p className="eg-galat" role="alert">
                {galat}
              </p>
            )}
          </div>

          {/* ---------- Kotak masuk (re-access + sumber link login
              buat HP — pakai "Deteksi link" di tiap pesan). ---------- */}
          {(hasilGenerate || akun.length > 0) && (
            <div className="am-langkah">
              <div className="am-baris-judul">
                <span className="am-nomor">2</span>
                <label>Kotak masuk</label>
                <span className="am-ket">email sementara + isiny; link login HP diambil dari sini — tahan / klik kanan buat hapus</span>
              </div>

              <div className="amv2-aksi-akun">
                {emailTersedia.map((email) => (
                  <ChipAkun
                    key={email}
                    email={email}
                    sibuk={inboxSibuk}
                    onBuka={(e) => void bukaInbox(e)}
                    onMenu={(x, y, emailnya) => {
                      setMenuAkun({ x, y, email: emailnya });
                      mainkanSfx("ui-menu");
                    }}
                  />
                ))}
              </div>

              {inboxGalat && (
                <p className="eg-galat" role="alert">
                  {inboxGalat}
                </p>
              )}
              {inboxSibuk && <p className="amv2-ket-akun">Masuk kotak masukny...</p>}
              {inboxBuka && (
                <div className="amv2-inbox">
                  <div className="amv2-inbox-kepala">
                    <b>{inboxBuka.email}</b>
                    <button type="button" className="post-tutup sisa-tutup" aria-label="Tutup kotak masuk" onClick={() => setInboxBuka(null)}>
                      <TutupIkon />
                    </button>
                  </div>
                  {inboxBuka.daftar.length === 0 ? (
                    <p className="amv2-ket-akun">Masih kosong.</p>
                  ) : (
                    <ul>
                      {inboxBuka.daftar.map((m, i) => (
                        <li key={m.id || i}>
                          <div className="amv2-pesan-kepala">
                            <b>{m.subjek || "(tanpa subjek)"}</b>
                            <button
                              type="button"
                              className="btn kecil amv2-btn-link"
                              onClick={() => void deteksiLink(inboxBuka.email, m.id, m.subjek)}
                              disabled={!!pesanSibuk}
                              title="Deteksi semua link di email ini"
                            >
                              <TautanIkon ukuran={13} />
                              {pesanSibuk === m.id ? "Mendeteksi..." : pesanLink?.id === m.id ? "Tutup" : "Deteksi link"}
                            </button>
                          </div>
                          <span>{m.dari}</span>
                          <p>{m.intro}</p>
                          <time>{waktuRelatif(m.waktu, detak)}</time>

                          {/* Hasil deteksi link buat pesen ini. */}
                          {pesanLink?.id === m.id && (
                            <div className="amv2-link-list">
                              {pesanLink.links.length === 0 ? (
                                <p className="amv2-ket-akun">Gak ada link yang kedeteksi di email ini.</p>
                              ) : (
                                pesanLink.links.map((u, j) => (
                                  <div key={j} className="amv2-link-baris">
                                    <span className="amv2-link-nomor">Link {j + 1}</span>
                                    <code>{u}</code>
                                    <button type="button" className="btn kecil" onClick={() => void salin(u, "pesan-" + j)}>
                                      <SalinIkon ukuran={13} />
                                      {tersalin === "pesan-" + j ? "Tersalin" : "Salin"}
                                    </button>
                                    <a className="btn kecil" href={u} target="_blank" rel="noopener noreferrer">
                                      Buka
                                      <Panah />
                                    </a>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {pesanGalat && (
                    <p className="eg-galat" role="alert">
                      {pesanGalat}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="amv2-sisi-kanan">
        {/* ---------- 5MB Converter (desktop: kolom kanan). ---------- */}
        <div className="am-panel amv2-panel-kedua">
          <div className="am-kepala">
            <span className="am-logo" aria-hidden="true">
              <FotoIkon ukuran={22} />
            </span>
            <div className="am-judul">
              <h2>5MB Converter</h2>
              <p>link preset ke file XML + audio ny</p>
            </div>
          </div>

          <div className="am-langkah">
            <div className="am-baris-judul">
              <label htmlFor="amv2-preset">Link preset</label>
              <span className="am-ket">tempel link yang dibagikan (alight.link)</span>
            </div>
            <div className="am-kotak-input">
              <input
                id="amv2-preset"
                type="text"
                inputMode="url"
                spellCheck={false}
                autoComplete="off"
                value={presetUrl}
                onChange={(e) => {
                  setPresetUrl(e.target.value);
                  setPresetGalat("");
                }}
                placeholder="https://alight.link/..."
                disabled={presetSibuk}
              />
            </div>
            <button type="button" className="btn primary am-tombol" onClick={() => void ambilPreset()} disabled={!presetUrl.trim() || presetSibuk}>
              {presetSibuk ? "Mengambil..." : "Ambil file ny"}
              {!presetSibuk && <Panah />}
            </button>

            {presetGalat && (
              <p className="eg-galat" role="alert">
                {presetGalat}
              </p>
            )}

            {preset && (
              <div className="amv2-preset-hasil">
                {preset.pratinjau && <img src={preset.pratinjau} alt="" loading="lazy" decoding="async" />}
                <div className="amv2-preset-info">
                  <b>{preset.judul}</b>
                  {preset.deskripsi && <p>{preset.deskripsi}</p>}
                  <div className="amv2-preset-unduh">
                    {preset.unduhXml && (
                      <a className="btn kecil" href={preset.unduhXml}>
                        <UnduhIkon ukuran={13} />
                        Unduh XML
                      </a>
                    )}
                    {preset.unduhAudio && (
                      <a className="btn kecil" href={preset.unduhAudio}>
                        <UnduhIkon ukuran={13} />
                        Unduh audio
                      </a>
                    )}
                    {!preset.adaXml && !preset.adaAudio && <span className="amv2-ket-akun">File ny gak ketemu di halaman preset ini.</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---------- Bulk Account (owner/admin doang). ---------- */}
        {owner && (
          <div className="am-panel amv2-panel-kedua">
            <div className="am-kepala">
              <span className="am-logo" aria-hidden="true">
                <AsetIkon nama="am" ukuran={26} />
              </span>
              <div className="am-judul">
                <h2>Bulk Account</h2>
                <p>khusus owner: beberapa akun sekaligus</p>
              </div>
            </div>

            <div className="am-langkah">
              <div className="am-baris-judul">
                <label htmlFor="amv2-bulk">Jumlah akun</label>
                <span className="am-ket">1 sampai 20 per sekali jalan</span>
              </div>
              <div className="am-kotak-input amv2-bulk-input">
                <input
                  id="amv2-bulk"
                  type="number"
                  min={1}
                  max={20}
                  value={bulkJumlah}
                  onChange={(e) => setBulkJumlah(e.target.value)}
                  disabled={bulkJalan}
                />
              </div>
              <button type="button" className="btn primary am-tombol" onClick={() => void mulaiBulk()} disabled={bulkJalan || bulkSibuk}>
                {bulkJalan ? "Jalan... (" + bulk!.selesaiN + "/" + bulk!.total + ")" : "Mulai bulk"}
              </button>

              {bulkGalat && (
                <p className="eg-galat" role="alert">
                  {bulkGalat}
                </p>
              )}

              {bulk && (
                <div className="amv2-bulk-status">
                  <div className="amv2-bulk-ringkas">
                    <span className="amv2-bulk-angka">
                      <b>{bulk.berhasilN}</b> berhasil
                    </span>
                    <span className="amv2-bulk-angka">
                      <b>{bulk.gagalN}</b> gagal
                    </span>
                    <span className="amv2-bulk-angka">
                      <b>{bulk.selesaiN}</b>/{bulk.total} selesai
                    </span>
                  </div>
                  {bulk.tahap === "jalan" && (
                    <div className="progres-unggah" role="status">
                      <span className="progres-bar" style={{ width: Math.round((bulk.selesaiN / Math.max(1, bulk.total)) * 100) + "%" }} />
                    </div>
                  )}
                  {bulk.tahap !== "jalan" && <p className="amv2-ket-akun">{bulk.pesan}</p>}
                  {bulk.log.length > 0 && (
                    <ul className="amv2-bulk-log">
                      {bulk.log.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  )}
                  {bulk.hasil.length > 0 && (
                    <div className="amv2-bulk-daftar">
                      {bulk.hasil.map((h) => {
                        const linkSiap = linkHp?.email === h.email && linkHp.tahap === "selesai" && linkHp.loginUrl;
                        const linkGagal = linkHp?.email === h.email && linkHp.tahap === "gagal";
                        return (
                          <div key={h.email} className="amv2-bulk-baris">
                            <div className="amv2-bulk-identitas">
                              <b>{h.email}</b>
                              {h.kode && <span className="amv2-bulk-kode">{h.kode}</span>}
                            </div>
                            <div className="amv2-bulk-aksi">
                              <button type="button" className="btn kecil" onClick={() => void salin(h.email, "bulk-email-" + h.email)}>
                                <SalinIkon ukuran={13} />
                                {tersalin === "bulk-email-" + h.email ? "Tersalin" : "Salin email"}
                              </button>
                              <button
                                type="button"
                                className="btn kecil"
                                onClick={() => void bikinLinkBulk(h.email)}
                                disabled={linkHpJalan}
                                title="Kirim magic link baru ke email ny, dijemput otomatis, terus disalin"
                              >
                                <TautanIkon ukuran={13} />
                                {linkHp?.email === h.email && linkHpJalan ? tahapTeks(linkHp.tahap) : "Salin magic link"}
                              </button>
                            </div>
                            {linkSiap && linkHp.loginUrl && (
                              <div className="amv2-link-baris">
                                <code>{linkHp.loginUrl}</code>
                                <button
                                  type="button"
                                  className="btn kecil"
                                  onClick={() => void salin(linkHp.loginUrl!, "bulk-link-" + h.email)}
                                >
                                  <SalinIkon ukuran={13} />
                                  {tersalin === "bulk-link-" + h.email ? "Tersalin" : "Salin"}
                                </button>
                                <a className="btn kecil" href={linkHp.loginUrl} target="_blank" rel="noopener noreferrer">
                                  Buka
                                  <Panah />
                                </a>
                              </div>
                            )}
                            {linkGagal && <p className="amv2-bulk-galat">{linkHp.pesan}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* ---------- Menu aksi + konfirmasi hapus riwayat akun (r34). ---------- */}
      {menuAkun && <MenuAksi x={menuAkun.x} y={menuAkun.y} items={itemMenuAkun(menuAkun.email)} onTutup={() => setMenuAkun(null)} />}

      {konfirmAkun && (
        <Konfirmasi
          judul="Hapus akun ny dari daftar?"
          pesan={"Email " + konfirmAkun + " sama kotak masukny ilang dari daftar lu. Premium ny yang udah aktif gak ikut kebatalin — cuma arsip ny yang dibuang."}
          labelYakin="Hapus"
          sibuk={hapusSibuk}
          onYakin={jalankanHapusAkun}
          onBatal={() => setKonfirmAkun(null)}
        />
      )}
    </>
  );
}

/* Tombol email di daftar kotak masuk (r34): klik = buka inbox,
   tahan (HP) / klik kanan (desktop) = menu aksi (Salin email,
   Hapus). Pola tahan ny sama kayak baris pesan Ruang Obrol
   (useTekanLama); klik synthetic yang nembak abis long-press
   diemin pakai patokan waktu — gak ada state yang nyangkut kalo
   klik ny gak pernah dateng. */
function ChipAkun({
  email,
  sibuk,
  onBuka,
  onMenu,
}: {
  email: string;
  sibuk: boolean;
  onBuka: (email: string) => void;
  onMenu: (x: number, y: number, email: string) => void;
}) {
  const tahan = useRef(0);
  const tekan = useTekanLama((x, y) => {
    tahan.current = Date.now();
    onMenu(x, y, email);
  });
  return (
    <button
      type="button"
      className="btn kecil"
      onClick={() => {
        if (Date.now() - tahan.current < 600) return;
        onBuka(email);
      }}
      onTouchStart={tekan.onTouchStart}
      onTouchMove={tekan.onTouchMove}
      onTouchEnd={tekan.onTouchEnd}
      onTouchCancel={tekan.onTouchCancel}
      onContextMenu={tekan.onContextMenu}
      disabled={sibuk}
    >
      <SuratIkon ukuran={13} />
      {email}
    </button>
  );
}
