"use client";

/* Profil user lain (r27): pfp, nama + badge, @username, bio (mention
   ke-link), stats (Post | Pengikut | Mengikuti | Like diterima +
   section aktivitas lainnya), tombol Ikuti/Henti Ikuti (optimistic,
   login-gated), post galeri ny.
   r32: tombol ikut makin ngerti keadaan — kalau DIA yang udah ikutin
   penonton duluan, label ny "Follow balik"; setelah dibalas (mutual
   follow) status ny jadi TEMAN + muncul tombol Chat pribadi yang
   langsung buka obrolan sama dia. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { OrangIkon, Panah, LencanaVerified, PanahBawahIkon, TitikTigaIkon, SalinIkon, LaporIkon, CentangIkon } from "@/components/ikon";
import KisiProfil from "@/components/KisiProfil";
import MenuAksi, { type AksiItem } from "@/components/MenuAksi";
import Konfirmasi from "@/components/Konfirmasi";
import { BioSebut } from "@/components/SebutOtomatis";
import { useSesi, bukaPintu, tolakSesi } from "@/lib/sesi-pengguna";
import { bukaChat } from "@/lib/chat-pribadi";
import { mainkanSfx } from "@/lib/suara";
import { salinTeks } from "@/lib/salin-chat";
import type { MediaPublik, Visibilitas } from "@/lib/tipe-media";

type DataProfil = {
  user: { id: string; nama: string; username: string | null; jenis: string; pfp: string | null; bio: string | null; verified: boolean; dibuat: string };
  media: MediaPublik[];
  jumlahSuka: number;
  sukaDiberikan: number;
  sukaDiterima: number;
  jumlahKomentar: number;
  jumlahPengikut: number;
  jumlahMengikuti: number;
  ikutiSaya: boolean;
  /* r32: dia ikut aku? (pemicu "Follow balik") + status teman. */
  mengikutiSaya: boolean;
  teman: boolean;
  punyaProfilSendiri: boolean;
};

/* Hasil muat profil orang: bedain "user ny gak ada" (gak boleh
   diulang) dari "jaringan ny mati" (boleh diulang pas online). */
type HasilAmbil = { ok: true; data: DataProfil } | { ok: false; jaringan: boolean; pesan: string };

async function ambilProfilOrang(x: string): Promise<HasilAmbil> {
  try {
    const r = await fetch("/api/pengguna/" + encodeURIComponent(x), {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, jaringan: false, pesan: d.galat || "User ny gak ketemu." };
    return { ok: true, data: d as DataProfil };
  } catch {
    return { ok: false, jaringan: true, pesan: "Gak nyambung ke server." };
  }
}

export default function ProfilOrang({ nama }: { nama: string }) {
  const { masuk, siap } = useSesi();
  const [data, setData] = useState<DataProfil | null>(null);
  const [status, setStatus] = useState<"muat" | "gagal" | "siap" | "kosong">("muat");
  const [pesan, setPesan] = useState("");
  const [ikut, setIkut] = useState(false);
  const [diaIkutAku, setDiaIkutAku] = useState(false);
  const [jumlahPengikut, setJumlahPengikut] = useState(0);
  const [sibukIkut, setSibukIkut] = useState(false);
  const [aktivitasBuka, setAktivitasBuka] = useState(false);
  /* Menu titik-tiga profil (r28): Salin link + Laporkan user. */
  const [menuProfil, setMenuProfil] = useState<{ x: number; y: number } | null>(null);
  const [konfirmLaporUser, setKonfirmLaporUser] = useState(false);
  const [sibukAksi, setSibukAksi] = useState(false);
  /* Umpan balik singkat (link tersalin / lapor terkirim). */
  const [umpan, setUmpan] = useState<string | null>(null);
  const umpanTimer = useRef(0);
  /* Bayangan status buat listener jaringan:balik. */
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    let hidup = true;
    const muat = () => {
      ambilProfilOrang(nama).then((hasil) => {
        if (!hidup) return;
        if (!hasil.ok) {
          setPesan(hasil.pesan);
          setStatus(hasil.jaringan ? "gagal" : "kosong");
          return;
        }
        setData(hasil.data);
        setIkut(hasil.data.ikutiSaya);
        setDiaIkutAku(!!hasil.data.mengikutiSaya);
        setJumlahPengikut(hasil.data.jumlahPengikut);
        setStatus("siap");
      });
    };
    muat();
    /* P0-1: jaringan balik + profil orang gagal muat -> ulang sendiri. */
    const cobaBalik = () => {
      if (statusRef.current === "gagal") muat();
    };
    window.addEventListener("jaringan:balik", cobaBalik);
    return () => {
      hidup = false;
      window.removeEventListener("jaringan:balik", cobaBalik);
    };
  }, [nama]);

  /* ---------- Menu titik-tiga profil (r28) ----------
     Salin link: canonical URL /profil/<username> (bukan URL
     search/preview — route ny sendiri). Origin dari window.location,
     gak hardcode domain.
     Laporkan user: jenis "user" di /api/laporan (konten ny
     di-snapshot server-side), login-gated, dengan konfirmasi. */
  function kabar(teks: string) {
    setUmpan(teks);
    clearTimeout(umpanTimer.current);
    umpanTimer.current = window.setTimeout(() => setUmpan(null), 2400);
  }

  async function salinLinkProfil() {
    if (!data) return;
    const tujuan = data.user.username ?? data.user.nama;
    const url = new URL("/profil/" + encodeURIComponent(tujuan), window.location.origin).toString();
    const ok = await salinTeks(url);
    if (ok) {
      kabar("Link disalin");
      mainkanSfx("notification");
    } else {
      kabar("Clipboard ny keblokir browser");
      mainkanSfx("failure");
    }
  }

  async function laporUser() {
    if (!data) return;
    setSibukAksi(true);
    try {
      const r = await fetch("/api/laporan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jenis: "user", targetId: data.user.id }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.status === 401) {
        tolakSesi();
        return;
      }
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
      setKonfirmLaporUser(false);
    }
  }

  function itemMenuProfil(): AksiItem[] {
    return [
      { id: "salinlink", label: "Salin link", ikon: <SalinIkon ukuran={15} />, onKlik: () => void salinLinkProfil() },
      {
        id: "lapor",
        label: "Laporkan user",
        ikon: <LaporIkon ukuran={15} />,
        onKlik: () => (masuk ? setKonfirmLaporUser(true) : bukaPintu()),
      },
    ];
  }

  function ubahMedia(id: string, ubah: { suka?: number; disukai?: boolean; komentar?: number; hapus?: boolean; visibilitas?: Visibilitas; bolehUnduh?: boolean }) {
    setData((p) => {
      if (!p) return p;
      if (ubah.hapus) return { ...p, media: p.media.filter((m) => m.id !== id) };
      /* Profil orang lain: post yang jadi PRIVATE ilang dari
         daftarny (server juga gak ngirimin PRIVATE buat orang
         lain — sinkron). PROFILE tetep keliatan di profil. */
      if (ubah.visibilitas === "PRIVATE") {
        return { ...p, media: p.media.filter((m) => m.id !== id) };
      }
      return { ...p, media: p.media.map((m) => (m.id === id ? { ...m, ...ubah } : m)) };
    });
  }

  /* Ikuti/henti: optimistic (angka + label langsung ganti), server
     ny yang divalidasi ulang; gagal -> balik ke keadaan server. */
  async function toggleIkut() {
    if (!data) return;
    if (!masuk) {
      bukaPintu();
      return;
    }
    const aksi = ikut ? "lepas" : "ikut";
    const sebelum = { ikut, jumlah: jumlahPengikut };
    setIkut(!ikut);
    setJumlahPengikut((n) => Math.max(0, n + (ikut ? -1 : 1)));
    mainkanSfx(ikut ? "ui-dissolve" : "notification");
    setSibukIkut(true);
    try {
      const r = await fetch("/api/ikuti", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId: data.user.id, aksi }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.status === 401) {
        /* sesi mati di tengah jalan — balikin + pintu login */
        setIkut(sebelum.ikut);
        setJumlahPengikut(sebelum.jumlah);
        setSibukIkut(false);
        tolakSesi();
        return;
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setIkut(sebelum.ikut);
        setJumlahPengikut(sebelum.jumlah);
        mainkanSfx("failure");
        return;
      }
      setJumlahPengikut(d.jumlahPengikut ?? sebelum.jumlah);
      /* r32: follow balik yang sukses = langsung jadi teman —
         kasih kabar + pintasan ke obrolan pribadi. */
      if (aksi === "ikut" && diaIkutAku) {
        kabar("Jadi teman sama " + data.user.nama + " — chat pribadi kebuka");
      } else if (aksi === "lepas" && diaIkutAku) {
        kabar("Udah gak teman sama " + data.user.nama);
      }
    } catch {
      setIkut(sebelum.ikut);
      setJumlahPengikut(sebelum.jumlah);
      mainkanSfx("failure");
    } finally {
      setSibukIkut(false);
    }
  }

  if (status === "muat") {
    return (
      <div className="profil-skeleton" aria-busy="true" aria-label={"Memuat profil " + nama}>
        <span className="sk-bulat" />
        <span className="profil-skeleton-badan">
          <span className="garis-skeleton" style={{ width: "38%", height: 28 }} />
          <span className="garis-skeleton" style={{ width: "62%", height: 14 }} />
          <span className="garis-skeleton" style={{ width: "45%", height: 14 }} />
        </span>
      </div>
    );
  }

  if (status !== "siap" || !data) {
    return (
      <section className="head">
        <h1 className="masuk on">{status === "kosong" ? "User ny gak ketemu" : "Gagal muat"}</h1>
        <p className="lede">{pesan}</p>
        {status === "gagal" && (
          <p style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setStatus("muat")}>
              Coba lagi
            </button>
          </p>
        )}
        <p style={{ marginTop: 24 }}>
          <Link className="btn" href="/profil">
            Cari user laen
            <Panah />
          </Link>
        </p>
      </section>
    );
  }

  const { user } = data;
  const sejak = new Date(user.dibuat).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const sendiri = data.punyaProfilSendiri;

  return (
    <>
      <section className="head profil-kepala">
        <div className="pfp-wrap">
          {user.pfp ? (
            <img
              className="pfp-besar"
              src={"/api/pfp/" + user.id + "?v=" + encodeURIComponent(user.pfp)}
              alt={"Foto profil " + user.nama}
              width={96}
              height={96}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="pfp-besar pfp-kosong" aria-hidden="true">
              <OrangIkon ukuran={40} />
            </span>
          )}
        </div>
        <div className="profil-info">
          <div className="profil-baris-atas">
            <h1>
              {user.nama}
              {user.verified && <LencanaVerified />}
            </h1>
            {/* Menu titik-tiga (r28): cuma di profil ORANG LAIN (profil
                sendiri udah punya tombol kelola sendiri — gak ada yang
                perlu dilaporin/salin dari sini). */}
            {!sendiri && (
              <button
                type="button"
                className="post-menu profil-menu"
                aria-haspopup="menu"
                aria-expanded={!!menuProfil}
                aria-label="Menu profil"
                onClick={(e) => {
                  const kotak = e.currentTarget.getBoundingClientRect();
                  setMenuProfil({ x: kotak.right, y: kotak.bottom + 6 });
                  mainkanSfx("ui-menu");
                }}
              >
                <TitikTigaIkon ukuran={16} />
              </button>
            )}
          </div>
          <p className="lede profil-handle">
            {user.username ? "@" + user.username + " · " : ""}
            {user.jenis === "anonim" ? "Akun anonim" : "Akun ber-sandi"} - mampir sejak {sejak}
          </p>
          {user.bio && (
            <p className="bio-teks">
              <BioSebut teks={user.bio} />
            </p>
          )}
          <ul className="profil-stat">
            <li>
              <b>{data.media.length}</b> post
            </li>
            <li>
              <b>{jumlahPengikut}</b> pengikut
            </li>
            <li>
              <b>{data.jumlahMengikuti}</b> mengikuti
            </li>
            <li>
              <b>{data.sukaDiterima}</b> like
            </li>
          </ul>

          <div className="aktivitas-kecil">
            <button
              type="button"
              className="aktivitas-tombol"
              aria-expanded={aktivitasBuka}
              onClick={() => setAktivitasBuka((v) => !v)}
            >
              <span>Aktivitas lainnya</span>
              <span className={"aktivitas-panah" + (aktivitasBuka ? " buka" : "")} aria-hidden="true">
                <PanahBawahIkon ukuran={14} />
              </span>
            </button>
            {aktivitasBuka && (
              <ul className="aktivitas-daftar">
                <li>
                  <b>{data.sukaDiberikan}</b> suka diberikan
                </li>
                <li>
                  <b>{data.jumlahKomentar}</b> komentar
                </li>
              </ul>
            )}
          </div>

          {siap && !sendiri && (
            <div className="profil-aksi">
              {/* r32: label ny nurut keadaan relasi.
                  - "Follow balik": dia udah ikutin aku duluan, aku
                    belum — sekali klik = mutual = TEMAN.
                  - udah teman (mutual): status "Teman" + pintasan
                    langsung buka obrolan pribadi sama dia. */}
              {ikut && diaIkutAku && (
                <span className="profil-teman" title="Saling follow">
                  <CentangIkon ukuran={12} /> Teman
                </span>
              )}
              <button
                type="button"
                className={"btn kecil" + (ikut ? "" : " primary")}
                onClick={toggleIkut}
                disabled={sibukIkut}
                aria-pressed={ikut}
              >
                {ikut ? "Henti ikutin" : diaIkutAku ? "Follow balik" : "Ikutin"}
              </button>
              {ikut && diaIkutAku && (
                <button type="button" className="btn kecil primary profil-chat" onClick={() => bukaChat(user.id)}>
                  Chat pribadi
                </button>
              )}
            </div>
          )}
          {sendiri && (
            <p className="hint">
              Ini profil lu sendiri.{" "}
              <Link className="tautan-kecil" href="/profil">
                Kelola dari sini
              </Link>
            </p>
          )}

          {umpan && (
            <p className="umpan-baris" role="status">
              <CentangIkon ukuran={12} /> {umpan}
            </p>
          )}
        </div>
      </section>

      {menuProfil && <MenuAksi x={menuProfil.x} y={menuProfil.y} items={itemMenuProfil()} onTutup={() => setMenuProfil(null)} />}

      {konfirmLaporUser && (
        <Konfirmasi
          judul="Laporkan user ini?"
          pesan={"Laporan ny nyampe ke owner lengkap sama profil " + (user.username ? "@" + user.username : user.nama) + ". Owner ny yang mroses."}
          labelYakin="Laporkan"
          sibuk={sibukAksi}
          onYakin={laporUser}
          onBatal={() => setKonfirmLaporUser(false)}
        />
      )}

      <h2 className="judul-blok">Post galeri ny</h2>
      {status === "siap" && data.media.length > 0 && <KisiProfil daftar={data.media} onUbah={ubahMedia} />}
      {status === "siap" && data.media.length === 0 && (
        <div className="status">
          <div className="kosong">{user.nama} belum pernah upload apa-apa.</div>
        </div>
      )}
    </>
  );
}
