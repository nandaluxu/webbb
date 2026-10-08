"use client";

/* Dashboard owner: statistik + kelola user + post terbaru.
   Hanya owner (admin) yang bisa buka: route API ny yang ngecek,
   tampilan ini cuma ngikutin. Sandi user cuma keliatan di sini,
   gak pernah kekirim ke tampilan user biasa. */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OrangIkon, Panah, LencanaVerified, MataIkon, MataTutupIkon, SukaOutlineIkon, KomentarAsetIkon, PlayIkon, LaporIkon, SalinIkon, HapusIkon, CentangIkon } from "@/components/ikon";
import Konfirmasi from "@/components/Konfirmasi";
import { useSesi } from "@/lib/sesi-pengguna";
import { salinTeks } from "@/lib/salin-chat";
import type { MediaPublik } from "@/lib/tipe-media";

type Statistik = {
  total: { user: number; media: number; komentar: number; verified: number; laporan: number };
  terbaru: MediaPublik[];
};

type LaporanAdmin = {
  id: string;
  jenis: "pesan" | "komentar" | "media" | "ai" | "user";
  targetId: string | null;
  tempat: string | null;
  konteks: string;
  pemilikNama: string;
  waktu: string;
  pelapor: { id: string; nama: string; pfp: string | null; verified: boolean };
};

const LABEL_JENIS: Record<LaporanAdmin["jenis"], string> = {
  pesan: "Pesan chat",
  komentar: "Komentar",
  media: "Post",
  ai: "Jawaban AI",
  user: "Akun user",
};

type UserAdmin = {
  id: string;
  nama: string;
  jenis: string;
  pfp: string | null;
  verified: boolean;
  admin: boolean;
  bio: string | null;
  dibuat: string;
  post: number;
  komentar: number;
  suka: number;
};

function urlPfp(id: string, pfp: string | null): string {
  return "/api/pfp/" + id + "?v=" + encodeURIComponent(pfp || "");
}

function waktuSingkat(iso: string): string {
  const d = new Date(iso);
  const hari = Math.floor((Date.now() - d.getTime()) / 864e5);
  if (hari <= 0) return "Hari ini";
  if (hari === 1) return "Kemarin";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function AdminDashboard() {
  const { siap, masuk, pengguna } = useSesi();
  const [stat, setStat] = useState<Statistik | null>(null);
  const [users, setUsers] = useState<UserAdmin[] | null>(null);
  const [laporan, setLaporan] = useState<LaporanAdmin[] | null>(null);
  const [galat, setGalat] = useState("");
  const [saring, setSaring] = useState("");
  const [konfirm, setKonfirm] = useState<
    | { jenis: "user"; user: UserAdmin }
    | { jenis: "media"; media: MediaPublik }
    | { jenis: "laporan"; laporan: LaporanAdmin; aksi: "selesai" | "hapus" }
    | null
  >(null);
  const [sibuk, setSibuk] = useState(false);
  const [sandiUser, setSandiUser] = useState<{ id: string; sandi: string | null; ket: string | null } | null>(null);

  const boleh = siap && masuk && !!pengguna?.admin;

  useEffect(() => {
    if (!boleh) return;
    let hidup = true;
    Promise.all([
      fetch("/api/admin/statistik", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/pengguna", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/laporan", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([s, u, l]) => {
        if (!hidup) return;
        if (s.total) setStat(s);
        if (u.daftar) setUsers(u.daftar);
        if (l.daftar) setLaporan(l.daftar);
      })
      .catch(() => hidup && setGalat("Gak nyambung ke server."));
    return () => {
      hidup = false;
    };
  }, [boleh]);

  async function ulang() {
    setStat(null);
    setUsers(null);
    setLaporan(null);
    setGalat("");
    const hasil = await Promise.all([
      fetch("/api/admin/statistik", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/pengguna", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/laporan", { cache: "no-store" }).then((r) => r.json()),
    ]).catch(() => null);
    if (!hasil) {
      setGalat("Gak nyambung ke server.");
      return;
    }
    const [s, u, l] = hasil;
    if (s.total) setStat(s);
    if (u?.daftar) setUsers(u.daftar);
    if (l?.daftar) setLaporan(l.daftar);
  }

  async function toggleVerifikasi(u: UserAdmin) {
    const r = await fetch("/api/admin/verifikasi", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: u.id, nilai: !u.verified }),
    }).catch(() => null);
    if (!r || !r.ok) return;
    setUsers((p) => (p ? p.map((x) => (x.id === u.id ? { ...x, verified: !x.verified } : x)) : p));
    setStat((p) => (p ? { ...p, total: { ...p.total, verified: p.total.verified + (u.verified ? -1 : 1) } } : p));
  }

  async function intipSandi(u: UserAdmin) {
    if (sandiUser?.id === u.id) {
      setSandiUser(null);
      return;
    }
    const r = await fetch("/api/admin/sandi?userId=" + encodeURIComponent(u.id), { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) return;
    const d = await r.json();
    setSandiUser({ id: u.id, sandi: d.sandi ?? null, ket: d.ket ?? null });
  }

  async function jalankanHapus() {
    if (!konfirm) return;
    setSibuk(true);
    if (konfirm.jenis === "laporan") {
      /* Aksi laporan: selesai (row ny doang) atau hapus (konten ny
         yang dihapus + laporan ny ikut ilang). */
      const r = await fetch("/api/admin/laporan", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ laporanId: konfirm.laporan.id, aksi: konfirm.aksi }),
      }).catch(() => null);
      setSibuk(false);
      if (!r || !r.ok) return;
      setKonfirm(null);
      await ulang();
      return;
    }
    const url = konfirm.jenis === "user" ? "/api/admin/pengguna" : "/api/admin/media";
    const badan = konfirm.jenis === "user" ? { userId: konfirm.user.id } : { mediaId: konfirm.media.id };
    const r = await fetch(url, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(badan),
    }).catch(() => null);
    setSibuk(false);
    if (!r || !r.ok) return;
    setKonfirm(null);
    await ulang();
  }

  const tersaring = useMemo(() => {
    if (!users) return null;
    const q = saring.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.nama.toLowerCase().includes(q));
  }, [users, saring]);

  if (!siap) {
    return (
      <div className="status">
        <div className="muat">
          <span className="bar" />
          <span>Cek sesi...</span>
        </div>
      </div>
    );
  }

  if (!boleh) {
    return (
      <section className="head">
        <h1 className="masuk on">Area owner</h1>
        <p className="lede">Halaman ini khusus pemilik web. Kalau ini web lu, masuk pake akun owner ny.</p>
        <p style={{ marginTop: 24 }}>
          <Link className="btn" href="/">
            Balik ke beranda
            <Panah />
          </Link>
        </p>
      </section>
    );
  }

  return (
    <>
      <header className="galeri-kepala">
        <h1>Dashboard</h1>
        <div className="kenalan">
          <p className="count">
            <b>{pengguna?.nama}</b> lagi megang kemudi
          </p>
        </div>
      </header>

      {galat && (
        <div className="status">
          <div className="gagal">
            <h2>Dashboard ny gak kebaca</h2>
            <p>{galat}</p>
            <p>
              <button type="button" className="btn" onClick={ulang}>
                Coba lagi
              </button>
            </p>
          </div>
        </div>
      )}

      {!stat && !galat && (
        <div className="status">
          <div className="muat">
            <span className="bar" />
            <span>Muat data dashboard...</span>
          </div>
        </div>
      )}

      {stat && (
        <ul className="stat-grid">
          <li>
            <b>{stat.total.user}</b>
            <span>user</span>
          </li>
          <li>
            <b>{stat.total.media}</b>
            <span>post</span>
          </li>
          <li>
            <b>{stat.total.komentar}</b>
            <span>komentar</span>
          </li>
          <li>
            <b>{stat.total.verified}</b>
            <span>terverifikasi</span>
          </li>
          <li>
            <b>{stat.total.laporan}</b>
            <span>laporan</span>
          </li>
        </ul>
      )}

      {stat && stat.terbaru.length > 0 && (
        <>
          <h2 className="judul-blok">Post terbaru</h2>
          <ul className="admin-media">
            {stat.terbaru.map((m) => (
              <li key={m.id}>
                <Link className="am-pratinjau" href="/galeri" aria-label={"Lihat " + (m.judul || m.nama)}>
                  <img src={m.pratinjau} alt="" loading="lazy" decoding="async" width={64} height={64} />
                  {m.jenis === "video" && (
                    <span className="am-play" aria-hidden="true">
                      <PlayIkon ukuran={12} />
                    </span>
                  )}
                </Link>
                <span className="am-badan">
                  <b>{m.judul || m.nama}</b>
                  <span className="am-meta">
                    {m.user ? (
                      <>
                        @{m.user.nama}
                        {m.user.verified && <LencanaVerified />}
                      </>
                    ) : (
                      "dari arsip"
                    )}{" "}
                    - {waktuSingkat(m.waktu)}
                  </span>
                  <span className="am-meta">
                    <SukaOutlineIkon ukuran={11} /> {m.suka} - <KomentarAsetIkon ukuran={11} /> {m.komentar}
                  </span>
                </span>
                <button type="button" className="btn kecil bahaya" onClick={() => setKonfirm({ jenis: "media", media: m })}>
                  Hapus
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="judul-blok">Laporan masuk</h2>
      {!laporan && (
        <div className="status">
          <div className="muat">
            <span className="bar" />
            <span>Muat laporan...</span>
          </div>
        </div>
      )}
      {laporan && laporan.length === 0 && (
        <div className="status">
          <div className="kosong">Belum ada yang lapor. Beres semua.</div>
        </div>
      )}
      {laporan && laporan.length > 0 && (
        <ul className="admin-laporan">
          {laporan.map((l) => (
            <li key={l.id}>
              <div className="al-badan">
                <span className="al-jenis">
                  <LaporIkon ukuran={13} />
                  {LABEL_JENIS[l.jenis]}
                  {l.tempat ? " \u00b7 " + l.tempat : ""}
                </span>
                <blockquote className="al-konteks">{l.konteks}</blockquote>
                <span className="al-meta">
                  Pemilik: <b>{l.pemilikNama}</b>{" \u00b7 "}dilapor sama{" "}
                  <b>
                    {l.pelapor.nama}
                    {l.pelapor.verified && <LencanaVerified />}
                  </b>{" \u00b7 "}
                  {waktuSingkat(l.waktu)}
                </span>
              </div>
              <div className="au-aksi">
                <button type="button" className="btn kecil" onClick={() => salinTeks(l.konteks)}>
                  <SalinIkon ukuran={13} />
                  <span className="label">Salin</span>
                </button>
                <button
                  type="button"
                  className={"btn kecil" + (l.jenis === "ai" ? " mati" : " bahaya")}
                  disabled={l.jenis === "ai"}
                  title={l.jenis === "ai" ? "Isi AI ny cuma di browser user, gak ada yang bisa dihapus di server" : undefined}
                  onClick={() => setKonfirm({ jenis: "laporan", laporan: l, aksi: "hapus" })}
                >
                  <HapusIkon ukuran={13} />
                  <span className="label">Hapus konten</span>
                </button>
                <button type="button" className="btn kecil" onClick={() => setKonfirm({ jenis: "laporan", laporan: l, aksi: "selesai" })}>
                  <CentangIkon ukuran={13} />
                  <span className="label">Selesai</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="judul-blok">Kelola user</h2>
      <div className="cari-user" role="search" aria-label="Saring user">
        <div className="row">
          <input
            type="search"
            value={saring}
            onChange={(e) => setSaring(e.target.value)}
            placeholder="Saring nama user..."
            aria-label="Nama yang disaring"
          />
        </div>
      </div>

      {!tersaring && (
        <div className="status">
          <div className="muat">
            <span className="bar" />
            <span>Muat daftar user...</span>
          </div>
        </div>
      )}
      {tersaring && tersaring.length === 0 && (
        <div className="status">
          <div className="kosong">Gak ada user yang namany cocok sama "{saring.trim()}".</div>
        </div>
      )}
      {tersaring && tersaring.length > 0 && (
        <ul className="admin-user">
          {tersaring.map((u) => (
            <li key={u.id}>
              <div className="au-kepala">
                {u.pfp ? (
                  <img src={urlPfp(u.id, u.pfp)} alt="" loading="lazy" decoding="async" width={40} height={40} />
                ) : (
                  <span className="au-inisial" aria-hidden="true">
                    <OrangIkon ukuran={18} />
                  </span>
                )}
                <span className="au-nama">
                  <b>
                    <Link href={"/profil/" + encodeURIComponent(u.nama)}>{u.nama}</Link>
                    {u.verified && <LencanaVerified />}
                    {u.admin && <span className="au-owner">owner</span>}
                  </b>
                  <span className="au-meta">
                    {u.jenis === "anonim" ? "anonim" : "ber-sandi"} - {u.post} post - {u.komentar} komentar - mampir {waktuSingkat(u.dibuat)}
                  </span>
                  {u.bio && <span className="au-meta au-bio">{u.bio}</span>}
                </span>
              </div>
              <div className="au-aksi">
                <button
                  type="button"
                  className={"btn kecil" + (u.verified ? " primary" : "")}
                  disabled={u.admin}
                  aria-pressed={u.verified}
                  onClick={() => toggleVerifikasi(u)}
                  title={u.admin ? "Badge owner gak bisa dicabut" : undefined}
                >
                  <LencanaVerified />
                  {u.verified ? "Cabut verified" : "Verified"}
                </button>
                {u.jenis !== "anonim" && (
                  <button type="button" className="btn kecil" onClick={() => intipSandi(u)} aria-expanded={sandiUser?.id === u.id}>
                    {sandiUser?.id === u.id ? <MataTutupIkon ukuran={14} /> : <MataIkon ukuran={14} />}
                    Sandi
                  </button>
                )}
                <Link className="btn kecil" href={"/profil/" + encodeURIComponent(u.nama)}>
                  Profil
                  <Panah />
                </Link>
                {!u.admin && (
                  <button type="button" className="btn kecil bahaya" onClick={() => setKonfirm({ jenis: "user", user: u })}>
                    Hapus
                  </button>
                )}
              </div>
              {sandiUser?.id === u.id && (
                <div className="au-sandi">
                  {sandiUser.sandi ? (
                    <code>{sandiUser.sandi}</code>
                  ) : (
                    <span>{sandiUser.ket || "Sandi ny gak kebaca."}</span>
                  )}
                  <span className="au-sandi-ket">Cuma lu yang lihat ini. Jangan dibagi-bagi.</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {konfirm && (
        <Konfirmasi
          judul={
            konfirm.jenis === "user"
              ? "Hapus " + konfirm.user.nama + "?"
              : konfirm.jenis === "media"
                ? "Hapus post ini?"
                : konfirm.aksi === "hapus"
                  ? "Hapus konten yang dilaporkan?"
                  : "Tandai laporan selesai?"
          }
          pesan={
            konfirm.jenis === "user"
              ? "Semua post yang dia unggah, komentar, sama sukany ikut kehapus. Gak bisa dibalikin."
              : konfirm.jenis === "media"
                ? "Post, komentar, sama sukany ikut kehapus. Gak bisa dibalikin."
                : konfirm.aksi === "hapus"
                  ? "Konten ny (" + LABEL_JENIS[konfirm.laporan.jenis] + ") kehapus permanen + laporan ny beres. Gak bisa dibalikin."
                  : "Konten ny dibiarkan, laporan ny aja yang dicabut dari daftar."
          }
          labelYakin={
            konfirm.jenis === "user" || konfirm.jenis === "media" || (konfirm.jenis === "laporan" && konfirm.aksi === "hapus")
              ? "Hapus"
              : "Selesai"
          }
          sibuk={sibuk}
          onYakin={jalankanHapus}
          onBatal={() => setKonfirm(null)}
        />
      )}
    </>
  );
}
