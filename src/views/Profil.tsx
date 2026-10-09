"use client";

/* Profil sendiri (r27): foto profil (bisa diganti), bio (bisa diedit,
   dukung @username + autocomplete), stats utama:
     Post | Pengikut | Mengikuti | Like
   Like = TOTAL like yang DITERIMA di semua post milik user (BUKAN
   jumlah post yang di-like). "Suka diberikan" + "Komentar" jadi
   section AKTIVITAS LAINNYA (expand/collapse) — data lama gak ilang,
   cuma gak numpuk di barisan utama.
   r29: menu titik-tiga profil sendiri — Edit profile (username +
   nama tampilan, validasi server) + Salin link. Bio TETAP lewat
   tombol "Edit bio" ny yang udah ada (gak masuk menu).
   Belum login: ajakan login + pencarian tetap jalan. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { OrangIkon, KameraIkon, LencanaVerified, KirimIkon, PanahBawahIkon, TitikTigaIkon, SalinIkon, EditIkon, CentangIkon, TutupIkon } from "@/components/ikon";
import KisiProfil from "@/components/KisiProfil";
import CariUser from "@/components/CariUser";
import EditorPfp from "@/components/EditorPfp";
import MenuAksi, { type AksiItem } from "@/components/MenuAksi";
import { SebutOtomatis, BioSebut } from "@/components/SebutOtomatis";
import { useSesi, bukaPintu, keluar, pasangPfp, simpanBio, simpanProfil, type PenguseSesi } from "@/lib/sesi-pengguna";
import { hitungBarisBio, MAKS_BARIS_BIO } from "@/lib/bio";
import { salinTeks } from "@/lib/salin-chat";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";
import type { MediaPublik, Visibilitas } from "@/lib/tipe-media";

type DataProfil = {
  media: MediaPublik[];
  jumlahSuka: number;
  sukaDiberikan: number;
  sukaDiterima: number;
  jumlahKomentar: number;
  jumlahPengikut: number;
  jumlahMengikuti: number;
};

async function ambilProfil(nama: string): Promise<DataProfil | string> {
  try {
    const r = await fetch("/api/pengguna/" + encodeURIComponent(nama), {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (!r.ok) return d.galat || "Gagal muat profil.";
    return {
      media: d.media,
      jumlahSuka: d.sukaDiberikan ?? d.jumlahSuka ?? 0,
      sukaDiberikan: d.sukaDiberikan ?? d.jumlahSuka ?? 0,
      sukaDiterima: d.sukaDiterima ?? 0,
      jumlahKomentar: d.jumlahKomentar ?? 0,
      jumlahPengikut: d.jumlahPengikut ?? 0,
      jumlahMengikuti: d.jumlahMengikuti ?? 0,
    };
  } catch {
    return "Gak nyambung ke server.";
  }
}

function urlPfp(id: string, pfp: string | null): string {
  return "/api/pfp/" + id + "?v=" + encodeURIComponent(pfp || "");
}

export default function Profil() {
  const { siap, masuk, pengguna } = useSesi();
  const [data, setData] = useState<DataProfil | null>(null);
  const [galat, setGalat] = useState("");
  /* bioLokal: null = ngeikut data sesi; string = lagi diedit user. */
  const [bioLokal, setBioLokal] = useState<string | null>(null);
  const [bioEdit, setBioEdit] = useState(false);
  const [bioSibuk, setBioSibuk] = useState(false);
  /* posisi kursor textarea bio (buat autocomplete mention). */
  const [posisiBio, setPosisiBio] = useState(0);
  const bioRef = useRef<HTMLTextAreaElement>(null);
  /* section aktivitas lainnya. */
  const [aktivitasBuka, setAktivitasBuka] = useState(false);
  /* Editor PFP: file mentah ny ditahan dulu, gak keupload sampai
     user pencet Simpan di editor. */
  const [drafPfp, setDrafPfp] = useState<File | null>(null);
  /* r29: menu titik-tiga profil sendiri (posisi layar) + modal edit
     profil + umpan kecil. */
  const [menuProfil, setMenuProfil] = useState<{ x: number; y: number } | null>(null);
  const [editBuka, setEditBuka] = useState(false);
  const [umpan, setUmpan] = useState<string | null>(null);
  const umpanTimer = useRef(0);

  /* r29 (regresi seksi 11): ganti akun (login/logout/panic) = reset
     draft bio ny — draft user A gak boleh nyipir ke tampilan user B
     (sebelumnya bioLokal ny gak pernah dibersihin). Pola resmi React
     "sesuaikan state pas prop berubah": nyimpen id akun LAMA di
     state (bukan ref — set-state-saat-render gak boleh baca/tulis
     ref), sama kayak reset disabled di PilihOpsi. */
  const [idAkunLama, setIdAkunLama] = useState<string | null>(null);
  const idKini = pengguna?.id ?? null;
  if (idAkunLama !== idKini) {
    if (idAkunLama !== null || idKini !== null) {
      setBioLokal(null);
      setBioEdit(false);
      setEditBuka(false);
    }
    setIdAkunLama(idKini);
  }
  /* Bayangan error buat listener jaringan:balik (closure basi-proof). */
  const galatRef = useRef("");
  useEffect(() => {
    galatRef.current = galat;
  }, [galat]);
  const bioTersimpan = pengguna?.bio || "";
  const bio = bioLokal ?? bioTersimpan;
  /* Validasi baris bio (r28): nurut aturan server (lib/bio), client
     cuma nunuin lebih awal biar UX ny jelas — keputusan akhir tetep di
     server. */
  const bioBaris = bioEdit ? hitungBarisBio(bio) : 1;
  const bioKelebihan = bioBaris > MAKS_BARIS_BIO;

  useEffect(() => {
    if (!pengguna) return;
    let hidup = true;
    const muat = () => {
      ambilProfil(pengguna.username ?? pengguna.nama).then((hasil) => {
        if (!hidup) return;
        if (typeof hasil === "string") {
          setGalat(hasil);
          return;
        }
        setGalat("");
        setData(hasil);
      });
    };
    muat();
    /* P0-1: jaringan balik + profil lagi gagal -> muat ulang sendiri. */
    const cobaBalik = () => {
      if (galatRef.current) muat();
    };
    window.addEventListener("jaringan:balik", cobaBalik);
    return () => {
      hidup = false;
      window.removeEventListener("jaringan:balik", cobaBalik);
    };
  }, [pengguna]);

  function ubahMedia(id: string, ubah: { suka?: number; disukai?: boolean; komentar?: number; hapus?: boolean; visibilitas?: Visibilitas; bolehUnduh?: boolean }) {
    setData((p) => {
      if (!p) return p;
      if (ubah.hapus) return { ...p, media: p.media.filter((m) => m.id !== id) };
      /* Profil sendiri: semua visibilitas tetep keliatan — cuma
         nilainy yang keganti (badge di panel post). */
      return { ...p, media: p.media.map((m) => (m.id === id ? { ...m, ...ubah } : m)) };
    });
  }

  async function gantiPfp(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    /* Buka editor dulu: file asli gak kesentuh sama sekali sebelum
     user setuju sama hasil potongan ny. */
    setDrafPfp(file);
  }

  async function simpanPfp(hasil: File) {
    setDrafPfp(null);
    await pasangPfp(hasil);
  }

  async function kirimBio(e: React.FormEvent) {
    e.preventDefault();
    if (bioKelebihan) return;
    setBioSibuk(true);
    const jadi = await simpanBio(bio);
    setBioSibuk(false);
    if (jadi) {
      setBioLokal(null);
      setBioEdit(false);
    }
  }

  function pilihSebut(teksBaru: string, posisiBaru: number) {
    setBioLokal(teksBaru);
    setPosisiBio(posisiBaru);
    /* kursor diempatin di posisi baru abis sisipan (ikutkan frame
       berikutny biar React udah nulis valueny dulu). */
    requestAnimationFrame(() => {
      const el = bioRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(posisiBaru, posisiBaru);
      }
    });
  }

  /* ---------- r29: menu titik-tiga profil sendiri ---------- */

  function kabar(teks: string) {
    setUmpan(teks);
    clearTimeout(umpanTimer.current);
    umpanTimer.current = window.setTimeout(() => setUmpan(null), 2400);
  }

  /* Salin link profil: canonical /profil/<username> (origin dari
     window.location, gak hardcode — pola yang sama kayak ProfilOrang). */
  async function salinLinkProfil() {
    if (!pengguna) return;
    const tujuan = pengguna.username ?? pengguna.nama;
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

  function itemMenuProfil(): AksiItem[] {
    return [
      { id: "edit", label: "Edit profile", ikon: <EditIkon ukuran={15} />, onKlik: () => setEditBuka(true) },
      { id: "salinlink", label: "Salin link", ikon: <SalinIkon ukuran={15} />, onKlik: () => void salinLinkProfil() },
    ];
  }

  if (!siap) {
    return (
      <div className="profil-skeleton" aria-busy="true" aria-label="Memuat profil">
        <span className="sk-bulat" />
        <span className="profil-skeleton-badan">
          <span className="garis-skeleton" style={{ width: "38%", height: 28 }} />
          <span className="garis-skeleton" style={{ width: "62%", height: 14 }} />
          <span className="garis-skeleton" style={{ width: "45%", height: 14 }} />
        </span>
      </div>
    );
  }

  if (!masuk || !pengguna) {
    /* fix31: dulu ny cuma judul + 1 tombol — halamanny kerasa
       hampa (audit: 80% layar kosong). Sekarang: kartu tamu yang
       jelasin apa aja yang kebuka abis masuk + CTA ganda (Masuk /
       jelajah galeri), terus pencarian user tetep di bawah. */
    return (
      <section className="head">
        <h1>Profil</h1>
        <p className="lede">Kamu belum masuk. Profil ny keisi abis lu punya akun sendiri.</p>
        <div className="profil-tamu">
          <span className="profil-tamu-ikon" aria-hidden="true">
            <OrangIkon ukuran={34} />
          </span>
          <div>
            <h2>Belum ada yang keliatan di sini</h2>
            <p>Foto profil, bio, post galeri, sampe stats pengikut — semuany nongol di halaman ini abis lu masuk. Browsing tanpa akun tetep bebas kok.</p>
            <ul className="profil-tamu-buka">
              <li>Foto &amp; bio</li>
              <li>Post galeri</li>
              <li>Like &amp; komen</li>
              <li>Pengikut &amp; stats</li>
            </ul>
            <div className="row">
              <button type="button" className="btn primary" onClick={bukaPintu}>
                Masuk / Daftar
              </button>
              <Link className="btn" href="/galeri">
                Jelajahi galeri
              </Link>
            </div>
          </div>
        </div>
        <h2 className="judul-blok">Cari user lain</h2>
        <CariUser />
      </section>
    );
  }

  return (
    <>
      <section className="head profil-kepala">
        <div className="pfp-wrap">
          {pengguna.pfp ? (
            <img
              className="pfp-besar"
              src={urlPfp(pengguna.id, pengguna.pfp)}
              alt={"Foto profil " + pengguna.nama}
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
          {/* Tombol ganti foto (r28): ikon kamera bulat nempel di tepi
              avatar (aset camera.svg — bisa diganti owner). Mobile gak
              ngandalin hover: aria-label + ukuran touch 44px. */}
          <label className="pilih-file pfp-kamera" title="Ganti foto profil">
            <input type="file" accept="image/*" onChange={gantiPfp} aria-label="Ganti foto profil" />
            <KameraIkon ukuran={17} />
          </label>
        </div>
        <div className="profil-info">
          <div className="profil-baris-atas">
            <h1>
              {pengguna.nama}
              {pengguna.verified && <LencanaVerified />}
            </h1>
            {/* Menu titik-tiga profil SENDIRI (r29): Edit profile +
                Salin link. (Laporkan user gak muncul buat profil
                sendiri.) */}
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
          </div>
          {umpan && (
            <p className="umpan-baris" role="status">
              <CentangIkon ukuran={12} /> {umpan}
            </p>
          )}
          <p className="lede profil-handle">
            {pengguna.username ? "@" + pengguna.username + " · " : ""}
            {pengguna.jenis === "anonim" ? "Akun anonim: gak pakai sandi." : "Akun ber-sandi."}
          </p>

          {bioEdit ? (
            <form className="bio-form" onSubmit={kirimBio}>
              <label htmlFor="inputBio" className="baris-form">
                Bio
              </label>
              <div className="bio-edit-wrap">
                <textarea
                  id="inputBio"
                  ref={bioRef}
                  value={bio}
                  onChange={(e) => {
                    setBioLokal(e.target.value);
                    setPosisiBio(e.target.selectionStart ?? e.target.value.length);
                  }}
                  onSelect={(e) => setPosisiBio(e.currentTarget.selectionStart ?? 0)}
                  onKeyUp={(e) => setPosisiBio(e.currentTarget.selectionStart ?? 0)}
                  onClick={(e) => setPosisiBio(e.currentTarget.selectionStart ?? 0)}
                  maxLength={200}
                  rows={4}
                  placeholder="Cerita singkat tentang lu (opsional). Ketik @ buat nyebut orang."
                  aria-label="Bio profil"
                  aria-describedby="ketBarisBio"
                />
                <SebutOtomatis teks={bio} posisi={posisiBio} onPilih={pilihSebut} />
              </div>
              <p id="ketBarisBio" className={"bio-baris" + (bioKelebihan ? " lebih" : "")} aria-live="polite">
                {bioKelebihan
                  ? "Bio maksimal " + MAKS_BARIS_BIO + " baris — hapus baris kelebihan ny dulu."
                  : "Baris " + bioBaris + " dari " + MAKS_BARIS_BIO + " · maks 200 karakter. Enter = baris baru."}
              </p>
              <div className="row">
                <button type="submit" className="btn kecil primary" disabled={bioSibuk || bioKelebihan}>
                  <KirimIkon />
                  {bioSibuk ? "Nyunuh..." : "Simpan"}
                </button>
                <button type="button" className="btn kecil" onClick={() => { setBioLokal(null); setBioEdit(false); }} disabled={bioSibuk}>
                  Batal
                </button>
              </div>
            </form>
          ) : (
            <p className="bio-teks">
              {pengguna.bio ? <BioSebut teks={pengguna.bio} /> : <span className="bio-kosong">Belum ada bio.</span>}
              <button type="button" className="tautan-kecil" onClick={() => setBioEdit(true)}>
                Edit bio
              </button>
            </p>
          )}

          <ul className="profil-stat">
            <li>
              <b>{data ? data.media.length : "..."}</b> post
            </li>
            <li>
              <b>{data ? data.jumlahPengikut : "..."}</b> pengikut
            </li>
            <li>
              <b>{data ? data.jumlahMengikuti : "..."}</b> mengikuti
            </li>
            <li>
              <b>{data ? data.sukaDiterima : "..."}</b> like
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
                  <b>{data ? data.sukaDiberikan : "..."}</b> suka diberikan
                </li>
                <li>
                  <b>{data ? data.jumlahKomentar : "..."}</b> komentar
                </li>
              </ul>
            )}
          </div>

          <button type="button" className="btn kecil" onClick={keluar}>
            Keluar
          </button>
        </div>
      </section>

      {galat && (
        <div className="status">
          <div className="gagal">
            <h2>Profil ny gak kebaca</h2>
            <p>{galat}</p>
          </div>
        </div>
      )}

      <h2 className="judul-blok">Post galeri ny</h2>
      {!data && !galat && (
        <ul className="pp-skeleton" aria-label="Memuat post" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} aria-hidden="true" />
          ))}
        </ul>
      )}
      {data && data.media.length > 0 && <KisiProfil daftar={data.media} onUbah={ubahMedia} />}
      {data && data.media.length === 0 && (
        <div className="status">
          <div className="kosong">Belum ada post. Upload dari halaman galeri, nanti muncul di sini.</div>
        </div>
      )}

      {drafPfp && pengguna && (
        <EditorPfp file={drafPfp} nama={pengguna.nama} onSimpan={simpanPfp} onBatal={() => setDrafPfp(null)} />
      )}

      {/* r29: menu titik-tiga profil sendiri. */}
      {menuProfil && <MenuAksi x={menuProfil.x} y={menuProfil.y} items={itemMenuProfil()} onTutup={() => setMenuProfil(null)} />}

      {/* r29: modal Edit profile (username + nama tampilan). UI ny
          nutur pintu-kotak (form modal yang udah ada). */}
      {editBuka && pengguna && <EditProfilModal user={pengguna} onTutup={() => setEditBuka(false)} />}

      <h2 className="judul-blok">Cari user lain</h2>
      <CariUser />
    </>
  );
}

/* Modal Edit profile (r29): username (validator live ketersediaan —
   debounce 350ms, endpoint ny sama kayak daftar) + nama tampilan.
   Simpan -> PATCH /api/akun { username, displayName } (validasi
   beneran di server) -> state sesi keganti -> profil langsung
   nyegar TANPA reload (useSesi ke-render ulang). Bio gak di sini
   (tombol "Edit bio" ny sendiri udah ada). */
function EditProfilModal({ user, onTutup }: { user: PenguseSesi; onTutup: () => void }) {
  const { galat, sibuk } = useSesi();
  const [username, setUsername] = useState(user.username ?? "");
  const [nama, setNama] = useState(user.nama);
  const [cek, setCek] = useState<"idle" | "cek" | "tersedia" | "dipakai" | "invalid" | "galat">("idle");
  const [pesanCek, setPesanCek] = useState("");
  const timerCek = useRef(0);
  const userRef = useRef<HTMLInputElement>(null);

  function usernameOk(u: string): boolean {
    return /^[a-z0-9]([a-z0-9_.]{1,18})[a-z0-9]$/.test(u) || /^[a-z0-9]{3,20}$/.test(u);
  }

  /* Esc nutup + kunci gulir + fokus awal (pola PintuLogin). */
  useEffect(() => {
    const t = setTimeout(() => userRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onTutup();
    };
    document.addEventListener("keydown", onKey);
    kunciGulir();
    return () => {
      clearTimeout(t);
      clearTimeout(timerCek.current);
      document.removeEventListener("keydown", onKey);
      bukaKunciGulir();
    };
  }, [onTutup]);

  /* Validator ketersediaan username: debounce 350ms, cuma kalo
     bentukny valid + BEDA dari username sekarang (ny unchanged gak
     perlu dicek — server ny juga ny treat sama = no-op). */
  useEffect(() => {
    clearTimeout(timerCek.current);
    const u = username.trim().replace(/^@+/, "").toLowerCase();
    const sekarang = (user.username ?? "").toLowerCase();
    if (!u) {
      setCek("invalid");
      setPesanCek("Username gak boleh kosong.");
      return;
    }
    if (!usernameOk(u)) {
      setCek("invalid");
      setPesanCek("3-20 karakter: huruf kecil, angka, titik, underscore.");
      return;
    }
    if (u === sekarang) {
      setCek("tersedia");
      setPesanCek("@" + u + " — username lu sekarang (gak diubah).");
      return;
    }
    setCek("cek");
    setPesanCek("Ngecek...");
    timerCek.current = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/akun/cek-username?u=" + encodeURIComponent(u));
        const d = await r.json();
        if (!r.ok) throw new Error();
        setCek(d.status === "tersedia" ? "tersedia" : "dipakai");
        setPesanCek(d.status === "tersedia" ? "@" + u + " tersedia." : "@" + u + " udah dipake.");
      } catch {
        setCek("galat");
        setPesanCek("Cek ny gagal — coba lagi pas kirim.");
      }
    }, 350);
  }, [username, user.username]);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    const u = username.trim().replace(/^@+/, "").toLowerCase();
    if (!usernameOk(u) || !nama.trim()) return;
    const jadi = await simpanProfil(u, nama.trim());
    if (jadi) {
      mainkanSfx("notification");
      onTutup();
    } else {
      mainkanSfx("failure");
    }
  }

  const u = username.trim().replace(/^@+/, "").toLowerCase();
  const bisaSimpan = usernameOk(u) && (cek === "tersedia" || cek === "galat") && nama.trim().length >= 1;

  return (
    <div
      className="pintu-lapis"
      role="dialog"
      aria-modal="true"
      aria-label="Edit profile"
      onClick={(e) => e.target === e.currentTarget && onTutup()}
    >
      <section className="pintu-kotak" aria-labelledby="judulEditProfil">
        <button type="button" className="pintu-tutup" data-sfx="ui-dissolve" aria-label="Batal" title="Batal" onClick={onTutup}>
          <TutupIkon />
        </button>
        <h2 id="judulEditProfil">Edit profile</h2>
        <p>Username = identitas login + sapaan @mention. Nama tampilan = nama yang keliatan orang lain (bebas).</p>
        <form onSubmit={kirim} noValidate>
          <label className="baris-form" htmlFor="editUsername">
            Username
          </label>
          <input
            id="editUsername"
            ref={userRef}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={25}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="ketEditUsername"
            inputMode="text"
          />
          <p
            id="ketEditUsername"
            className={"hint kecil " + (cek === "tersedia" ? "hint-baik" : cek === "dipakai" || cek === "invalid" ? "hint-jelek" : "")}
            aria-live="polite"
          >
            {pesanCek || "Huruf kecil, angka, titik, underscore. Boleh pake @ di depan."}
          </p>

          <label className="baris-form" htmlFor="editNama">
            Nama tampilan
          </label>
          <input
            id="editNama"
            type="text"
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            maxLength={24}
            autoComplete="nickname"
            placeholder="Nama yang keliatan orang lain (bebas)"
          />

          <div className="row" style={{ marginTop: 18 }}>
            <button type="submit" className="btn primary" disabled={sibuk || !bisaSimpan}>
              {sibuk ? "Nyunuh..." : "Simpan"}
            </button>
            <button type="button" className="btn" onClick={onTutup} disabled={sibuk}>
              Batal
            </button>
          </div>
          {galat ? (
            <p className="hint" role="alert" style={{ color: "var(--tanda)" }}>
              {galat}
            </p>
          ) : (
            <p className="hint">Perubahan ny langsung nyegar profil + sapaan lu di mana-mana.</p>
          )}
        </form>
      </section>
    </div>
  );
}

