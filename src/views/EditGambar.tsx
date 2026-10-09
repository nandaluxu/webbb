"use client";

/* AI Image Editor (r34): foto + filter = hasil baru, semua proses
   ny jalan di server (job background — provider ny lambet 40-180
   detik + rate limit ny galak, browser gak boleh megang request
   gantung).

   Alur: upload/klik/drag&drop -> pratinjau -> pilih filter
   (dropdown PilihOpsi yang udah ada) -> Proses -> [Menyiapkan /
   Memproses...] -> hasil (gambar + tombol unduh) + masuk riwayat.

   - Refresh / pindah halaman / balik lagi: job tetep ketemu
     (status ny di server, polling ny aja yang baru mulai).
   - Dobel-klik Proses: gak ngehasilin job dobel (server nolak
     job ke-2 selagi ada yang aktif; tombol ny juga mati).
   - Riwayat per user: A gak bisa lihat punya B (semua dari sesi).
   - Status jujur: gagal, kedaluwarsa (30 menit), hasil yang udah
     gak tersedia — semuany kebaca jelas, gak ada spinner kosong.
   - GIF animasi tetep animasi (format hasil gak dipaksa berubah).
   - Riwayat bisa diapus (r34): tahan (HP) / klik kanan (desktop)
     di item ny -> menu aksi (Buka, Hapus — gaya ny sama kayak menu
     pesan Ruang Obrol). Row + file hasil ny keapus dari server;
     yang masih jalan gak bisa dihapus. */

import { useCallback, useEffect, useRef, useState } from "react";
import PilihOpsi, { type GrupOpsi } from "@/components/PilihOpsi";
import { UnggahIkon, Panah, TutupIkon, UnduhIkon, CentangIkon, FotoIkon, AsetIkon, HapusIkon } from "@/components/ikon";
import MenuAksi, { useTekanLama, type AksiItem } from "@/components/MenuAksi";
import Konfirmasi from "@/components/Konfirmasi";
import { useSesi, bukaPintu } from "@/lib/sesi-pengguna";
import { mainkanSfx } from "@/lib/suara";
import { waktuRelatif, useDetakWaktu } from "@/lib/waktu";
import { salinTeks } from "@/lib/salin-chat";

type DefFilter = { id: string; label: string; grup: string; artis: boolean };

type Job = {
  id: string;
  filter: string;
  namaFilter: string;
  artis: string | null;
  status: string;
  sumberNama: string;
  hasil: string | null;
  hasilNama: string | null;
  pesan: string | null;
  dibuat: string;
  selesai: string | null;
};

const TIPE_BOLEH = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const BATAS_BESAR = 32 * 1024 * 1024;

function teksStatus(s: string): string {
  switch (s) {
    case "QUEUED":
      return "Menyiapkan...";
    case "PROCESSING":
      return "Memproses...";
    case "COMPLETED":
      return "Berhasil";
    case "FAILED":
      return "Gagal";
    case "EXPIRED":
      return "Kedaluwarsa";
    default:
      return s;
  }
}

export default function EditGambar() {
  const { siap, masuk } = useSesi();
  const detak = useDetakWaktu(30000);

  const [file, setFile] = useState<File | null>(null);
  const [urlPratinjau, setUrlPratinjau] = useState<string | null>(null);
  const [filterId, setFilterId] = useState("");
  const [artis, setArtis] = useState("");
  const [galat, setGalat] = useState("");
  const [tahap, setTahap] = useState<"idle" | "unggah" | "proses">("idle");
  const [aktif, setAktif] = useState<Job | null>(null);
  const [riwayat, setRiwayat] = useState<Job[] | null>(null);
  const [daftarFilter, setDaftarFilter] = useState<DefFilter[]>([]);
  const [hasilBuka, setHasilBuka] = useState<Job | null>(null);
  const [hasilGakAda, setHasilGakAda] = useState(false);
  const [drag, setDrag] = useState(false);
  const [tersalin, setTersalin] = useState(false);
  /* Id riwayat yang hasil ny udah ilang (biar thumb ny gak stuck
     nge-load ulang; state, bukan modul — re-render pas ketemu). */
  const [habisId, setHabisId] = useState<Set<string>>(new Set());

  /* Menu aksi riwayat (r34): klik kanan (desktop) / tahan (HP) di
     item riwayat -> Buka + Hapus (lewat konfirmasi dulu). */
  const [menuRiwayat, setMenuRiwayat] = useState<{ x: number; y: number; job: Job } | null>(null);
  const [konfirmHapus, setKonfirmHapus] = useState<Job | null>(null);
  const [hapusSibuk, setHapusSibuk] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const objekUrl = useRef<string | null>(null);
  const pollingRef = useRef(0);

  /* ---------- Grup dropdown filter (dari data server). ---------- */
  const grup: GrupOpsi[] = [];
  for (const f of daftarFilter) {
    const g = grup.find((x) => x.judul === f.grup);
    if (g) g.opsi.push({ nilai: f.id, teks: f.label });
    else grup.push({ judul: f.grup, opsi: [{ nilai: f.id, teks: f.label }] });
  }
  /* Filter efektif: state atawa default pertama (DERIVED pas
     render — gak pake effect buat ngeset default, pola resmi
     React buat "state dengan nilai awal dari props/data"). */
  const filterEfektif = filterId || daftarFilter[0]?.id || "";
  const filterDef = daftarFilter.find((f) => f.id === filterEfektif) ?? null;

  /* ---------- Muat status + riwayat (jalan tiap mount = refresh
     recovery; polling ny cuma pas ada job aktif). Pola .then +
     flag hidup (kayak Galeri) — setState ny di callback async,
     bukan sync di body effect. ---------- */
  const muat = useCallback(() => {
    let hidup = true;
    fetch("/api/fitur/edit-gambar", { cache: "no-store", signal: AbortSignal.timeout(15000) })
      .then((r) => {
        if (!hidup) return null;
        if (r.status === 401) return null;
        return r.json().catch(() => null);
      })
      .then((d: any) => {
        if (!hidup || !d) return;
        setDaftarFilter(Array.isArray(d.filter) ? d.filter : []);
        setRiwayat(Array.isArray(d.riwayat) ? d.riwayat : []);
        setAktif(d.aktif ?? null);
      })
      .catch(() => {
        /* gagal ngambil: data lama dipertahanin, muat ulang pas
         mount berikutnya (recovery jaringan global udah ada). */
      });
    return () => {
      hidup = false;
    };
  }, []);

  useEffect(() => {
    if (!siap || !masuk) return;
    return muat();
  }, [siap, masuk, muat]);

  /* ---------- Polling job aktif (2.5 detik; berhenti pas
     terminal; jalan LAGI kalau user refresh di tengah proses —
     state ny di server, bukan di halaman). ---------- */
  useEffect(() => {
    if (!aktif || (aktif.status !== "QUEUED" && aktif.status !== "PROCESSING")) return;
    const id = aktif.id;
    pollingRef.current = window.setInterval(async () => {
      try {
        const r = await fetch("/api/fitur/edit-gambar", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (!r.ok) return;
        const d = await r.json();
        const baru: Job | null = d.aktif ?? null;
        setAktif(baru);
        if (!baru || (baru.status !== "QUEUED" && baru.status !== "PROCESSING")) {
          window.clearInterval(pollingRef.current);
          setRiwayat(Array.isArray(d.riwayat) ? d.riwayat : []);
          setTahap("idle");
          if (baru?.status === "COMPLETED") {
            mainkanSfx("digital-burst");
            setFile(null);
            setUrlPratinjau(null);
            setArtis("");
          } else if (baru) {
            mainkanSfx("failure");
          }
        }
      } catch {
        /* polling gagal bentar: interval tetep jalan (jaringan
           recovery ny udah ada global). */
      }
    }, 2500);
    return () => window.clearInterval(pollingRef.current);
  }, [aktif]);

  /* ---------- Pilih file (klik / drag&drop / picker HP). ---------- */
  function pakaiFile(f: File | undefined | null) {
    if (!f) return;
    setGalat("");
    if (!TIPE_BOLEH.includes(f.type)) {
      setGalat("Cuma foto JPG, PNG, WEBP, atau GIF yang bisa diproses.");
      mainkanSfx("failure");
      return;
    }
    if (f.size > BATAS_BESAR) {
      setGalat("Fotonya kegedean (maks 32 MB).");
      mainkanSfx("failure");
      return;
    }
    if (objekUrl.current) URL.revokeObjectURL(objekUrl.current);
    objekUrl.current = URL.createObjectURL(f);
    setFile(f);
    setUrlPratinjau(objekUrl.current);
    mainkanSfx("ui-menu");
  }

  useEffect(() => {
    return () => {
      if (objekUrl.current) URL.revokeObjectURL(objekUrl.current);
    };
  }, []);

  /* ---------- Proses (submit job). ---------- */
  async function proses() {
    if (!file || !filterEfektif || tahap !== "idle" || aktif) return;
    if (filterDef?.artis && !artis.trim()) {
      setGalat("Isi dulu nama artis ny buat filter ini.");
      return;
    }
    setTahap("unggah");
    setGalat("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("filter", filterEfektif);
      if (filterDef?.artis) fd.append("artis", artis.trim());
      const r = await fetch("/api/fitur/edit-gambar", { method: "POST", body: fd, signal: AbortSignal.timeout(90000) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) {
        /* Job laen masih jalan (dobel klik / submit dobel): balik
           ke job yang sama, gak bikin baru. */
        void muat();
        setTahap("idle");
        return;
      }
      if (!r.ok) {
        setGalat(d.galat || "Gagal mulai proses. Coba lagi.");
        mainkanSfx("failure");
        setTahap("idle");
        return;
      }
      setTahap("proses");
      void muat();
    } catch {
      setGalat("Gak nyambung ke server. Cek koneksi ny, coba lagi.");
      mainkanSfx("failure");
      setTahap("idle");
    }
  }

  /* ---------- Buka hasil dari riwayat. ---------- */
  function bukaHasil(j: Job) {
    setHasilGakAda(false);
    setHasilBuka(j);
  }

  /* Cek "hasil gak tersedia" lewat onLoad error di <img>. */
  function hasilPecah() {
    setHasilGakAda(true);
  }

  /* Thumb riwayat yang gagal load = hasil udah gak ada. */
  function thumbPecah(id: string) {
    setHabisId((p) => (p.has(id) ? p : new Set(p).add(id)));
  }

  async function salinLinkHasil() {
    if (!hasilBuka?.hasilNama) return;
    const ok = await salinTeks(hasilBuka.hasilNama);
    if (ok) {
      setTersalin(true);
      mainkanSfx("notification");
      window.setTimeout(() => setTersalin(false), 2400);
    }
  }

  /* ---------- Menu aksi riwayat (r34). ---------- */
  function itemMenuRiwayat(j: Job): AksiItem[] {
    const isi: AksiItem[] = [{ id: "buka", label: "Buka", ikon: <FotoIkon ukuran={15} />, onKlik: () => bukaHasil(j) }];
    /* Yang masih jalan gak dikasih opsi hapus (server ny juga
       nolak — menu ny aja gak munculin, biar gak ada yang
       keklik terus gagal). */
    if (j.status !== "QUEUED" && j.status !== "PROCESSING") {
      isi.push({ id: "hapus", label: "Hapus", ikon: <HapusIkon ukuran={15} />, bahaya: true, onKlik: () => setKonfirmHapus(j) });
    }
    return isi;
  }

  async function jalankanHapusRiwayat() {
    const j = konfirmHapus;
    if (!j || hapusSibuk) return;
    setHapusSibuk(true);
    try {
      const r = await fetch("/api/fitur/edit-gambar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aksi: "hapus", id: j.id }),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setGalat(d.galat || "Gagal hapus riwayat ny.");
        mainkanSfx("failure");
        return;
      }
      setRiwayat((p) => (p ? p.filter((x) => x.id !== j.id) : p));
      /* Yang lagi nongol di panel hasil / modal juga dibersihin
         (gak nyangkut nampilin arsip yang udah ilang). */
      if (aktif?.id === j.id) setAktif(null);
      if (hasilBuka?.id === j.id) setHasilBuka(null);
      mainkanSfx("ui-dissolve");
    } catch {
      setGalat("Gak nyambung ke server.");
      mainkanSfx("failure");
    } finally {
      setHapusSibuk(false);
      setKonfirmHapus(null);
    }
  }

  /* ---------- Gerbang login (job ny milik akun). ---------- */
  if (siap && !masuk) {
    return (
      <section className="head">
        <h1 className="masuk on">AI Image Editor</h1>
        <p className="lede">Login dulu buat makai editor foto ny, soalny hasil + riwayat ny nempel ke akun lu, jadi gak ilang walau pindah halaman.</p>
        <p style={{ marginTop: 24 }}>
          <button type="button" className="btn primary" onClick={bukaPintu}>
            Masuk
            <Panah />
          </button>
        </p>
      </section>
    );
  }

  const lagiJalan = !!aktif && (aktif.status === "QUEUED" || aktif.status === "PROCESSING");
  const bisaProses = !!file && !!filterEfektif && tahap === "idle" && !lagiJalan && (!filterDef?.artis || artis.trim().length > 0);

  return (
    <>
      <section className="head">
        <h1>AI Image Editor</h1>
        <p className="lede">
          Unggah foto, pilih filter ny, sisany beresin server. Hasil ny masuk riwayat akun lu — boleh ditunggu di sini, boleh ditinggal
          (jalan terus di belakang, balik aja kapan kepikiran).
        </p>
      </section>

      <div className="eg-panel">
        {/* ---------- Zona upload / pratinjau ---------- */}
        {urlPratinjau && file ? (
          <div className="eg-pratinjau">
            <img src={urlPratinjau} alt={"Pratinjau " + file.name} />
            <div className="eg-pratinjau-info">
              <span className="eg-nama-file">{file.name}</span>
              <span className="eg-ukuran">{(file.size / 1048576).toFixed(1)} MB</span>
              <button
                type="button"
                className="btn kecil"
                onClick={() => {
                  if (objekUrl.current) URL.revokeObjectURL(objekUrl.current);
                  objekUrl.current = null;
                  setFile(null);
                  setUrlPratinjau(null);
                }}
                disabled={tahap !== "idle" || lagiJalan}
              >
                <TutupIkon ukuran={12} />
                Ganti foto
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={"eg-drop" + (drag ? " drag" : "")}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pakaiFile(e.dataTransfer.files?.[0]);
            }}
            disabled={lagiJalan}
          >
            <UnggahIkon ukuran={26} />
            <b>{drag ? "Lepasin di sini" : "Klik atau seret foto ke sini"}</b>
            <span>JPG / PNG / WEBP / GIF, maks 32 MB</span>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={(e) => {
                pakaiFile(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
          </button>
        )}

        {/* ---------- Filter + artis + tombol proses ---------- */}
        <div className="eg-aturan">
          {grup.length > 0 && (
            <PilihOpsi
              id="eg-filter"
              label="Filter"
              grup={grup}
              value={filterEfektif}
              onChange={(v) => {
                setFilterId(v);
                setGalat("");
              }}
              disabled={lagiJalan}
            />
          )}
          {filterDef?.artis && (
            <div className="eg-artis">
              <label htmlFor="eg-artis-input">Nama artis</label>
              <input
                id="eg-artis-input"
                type="text"
                value={artis}
                maxLength={60}
                placeholder="misal: nama idol / tokoh"
                onChange={(e) => setArtis(e.target.value)}
                disabled={lagiJalan}
              />
            </div>
          )}
          <button type="button" className="btn primary eg-proses" onClick={() => void proses()} disabled={!bisaProses}>
            {lagiJalan
              ? teksStatus(aktif!.status) + " (ditinggal juga gak apa-apa)"
              : tahap === "unggah"
                ? "Mengunggah..."
                : "Proses foto"}
            {tahap === "idle" && !lagiJalan && <Panah />}
          </button>
        </div>

        {/* ---------- Status job aktif (state proses, bukan spinner
            kosong: selalu ada info apa yang lagi dikerjain). ---------- */}
        {aktif && (aktif.status === "QUEUED" || aktif.status === "PROCESSING") && (
          <div className="eg-status jalan" role="status">
            <span className="eg-status-titik" aria-hidden="true" />
            <div>
              <b>{teksStatus(aktif.status)}</b>
              <p>
                {aktif.namaFilter}
                {aktif.artis ? " bareng " + aktif.artis : ""} dari <span className="eg-nama-file">{aktif.sumberNama}</span>
                {aktif.status === "PROCESSING" ? " lagi diproses di server" : " lagi ngantri di server"}. Mau nunggu di sini atau ditinggal —
                kalau lu pindah halaman / refresh, proses ny tetep jalan.
              </p>
            </div>
          </div>
        )}

        {/* ---------- Hasil terbaru (sukses). ---------- */}
        {aktif?.status === "COMPLETED" && (
          <div className="eg-status sukses">
            <CentangIkon ukuran={18} />
            <div>
              <b>Beres!</b>
              <p>
                {aktif.namaFilter} udah jadi. Simpen hasil ny di bawah, atau lihat lagi nanti dari riwayat.
              </p>
            </div>
          </div>
        )}

        {/* ---------- Gagal / kedaluwarsa (pesan ny jujur). ---------- */}
        {aktif && (aktif.status === "FAILED" || aktif.status === "EXPIRED") && (
          <div className="eg-status gagal" role="alert">
            <b>{teksStatus(aktif.status)}</b>
            <p>{aktif.pesan || (aktif.status === "EXPIRED" ? "Proses ny lewat batas 30 menit." : "Pemrosesan gagal.")}</p>
          </div>
        )}

        {aktif?.status === "COMPLETED" && aktif.hasil && (
          <div className="eg-hasil">
            <img src={aktif.hasil} alt={"Hasil " + aktif.namaFilter} onError={hasilPecah} />
            <div className="eg-hasil-baris">
              <span className="eg-nama-file">{aktif.hasilNama}</span>
              {!hasilGakAda && (
                <a className="btn primary" href={aktif.hasil + "?unduh=1"}>
                  <UnduhIkon ukuran={14} />
                  Simpan hasil
                </a>
              )}
            </div>
            {hasilGakAda && (
              <p className="eg-habis" role="alert">
                Hasil ny udah gak tersedia di server. Yang baru dateng dari riwayat bakal normal lagi.
              </p>
            )}
          </div>
        )}

        {galat && (
          <p className="eg-galat" role="alert">
            {galat}
          </p>
        )}

        {/* ---------- Riwayat (per akun; hasil expired kebaca
            statusny, bukan broken image). ---------- */}
        <div className="eg-riwayat">
          <h2>
            <FotoIkon ukuran={15} /> Riwayat
            <span className="eg-riwayat-hint">tahan / klik kanan buat hapus</span>
          </h2>
          {riwayat === null && <p className="eg-riwayat-kosong">Muat riwayat...</p>}
          {riwayat?.length === 0 && (
            <p className="eg-riwayat-kosong">Belum ada yang diproses. Hasil pertama lu bakal nongol di sini.</p>
          )}
          {riwayat && riwayat.length > 0 && (
            <ul>
              {riwayat.map((j) => (
                <ItemRiwayat
                  key={j.id}
                  j={j}
                  detak={detak}
                  habis={habisId.has(j.id)}
                  onBuka={bukaHasil}
                  onThumbPecah={thumbPecah}
                  onMenu={(x, y, job) => {
                    setMenuRiwayat({ x, y, job });
                    mainkanSfx("ui-menu");
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---------- Modal hasil (dari riwayat). ---------- */}
      {hasilBuka && (
        <div
          className="pintu-lapis"
          role="dialog"
          aria-modal="true"
          aria-label={"Hasil " + hasilBuka.namaFilter}
          onClick={(e) => e.target === e.currentTarget && setHasilBuka(null)}
        >
          <section className="pintu-kotak eg-hasil-modal">
            <button type="button" className="post-tutup sisa-tutup" aria-label="Tutup hasil" onClick={() => setHasilBuka(null)}>
              <TutupIkon />
            </button>
            <h2>
              {hasilBuka.namaFilter}
              {hasilBuka.artis ? " bareng " + hasilBuka.artis : ""}
            </h2>
            <p className="eg-modal-sub">
              dari <span className="eg-nama-file">{hasilBuka.sumberNama}</span>
              {hasilBuka.selesai ? " · " + waktuRelatif(hasilBuka.selesai, detak) : ""}
            </p>
            {hasilBuka.status === "COMPLETED" && hasilBuka.hasil && !hasilGakAda ? (
              <>
                <img className="eg-modal-gambar" src={hasilBuka.hasil} alt={"Hasil " + hasilBuka.namaFilter} onError={hasilPecah} />
                <div className="eg-hasil-baris">
                  <span className="eg-nama-file">{hasilBuka.hasilNama}</span>
                  <button type="button" className="btn kecil" onClick={() => void salinLinkHasil()}>
                    <UnduhIkon ukuran={13} />
                    {tersalin ? "Tersalin" : "Salin nama"}
                  </button>
                  <a className="btn primary" href={hasilBuka.hasil + "?unduh=1"}>
                    <UnduhIkon ukuran={13} />
                    Simpan hasil
                  </a>
                </div>
              </>
            ) : (
              <p className="eg-habis" role="alert">
                {hasilBuka.status === "EXPIRED"
                  ? "Proses ini kedaluwarsa sebelum selesai (lewat 30 menit)."
                  : hasilGakAda
                    ? "Hasil ny udah gak tersedia lagi."
                    : hasilBuka.pesan || "Hasil ny gak tersedia."}
              </p>
            )}
          </section>
        </div>
      )}

      {/* ---------- Menu aksi + konfirmasi hapus riwayat (r34). ---------- */}
      {menuRiwayat && <MenuAksi x={menuRiwayat.x} y={menuRiwayat.y} items={itemMenuRiwayat(menuRiwayat.job)} onTutup={() => setMenuRiwayat(null)} />}

      {konfirmHapus && (
        <Konfirmasi
          judul="Hapus dari riwayat?"
          pesan={"Hasil " + konfirmHapus.namaFilter + " (dari " + konfirmHapus.sumberNama + ") bakal keapus dari server juga. Gak bisa dibalikin."}
          labelYakin="Hapus"
          sibuk={hapusSibuk}
          onYakin={jalankanHapusRiwayat}
          onBatal={() => setKonfirmHapus(null)}
        />
      )}
    </>
  );
}

/* Item riwayat (r34): klik = buka hasil, tahan (HP) / klik kanan
   (desktop) = menu aksi. Pola tahan ny sama kayak baris pesan
   Ruang Obrol (useTekanLama); klik synthetic yang nembak abis
   long-press diemin pakai patokan waktu — gak ada state yang
   nyangkut kalo klik ny gak pernah dateng. */
function ItemRiwayat({
  j,
  detak,
  habis,
  onBuka,
  onThumbPecah,
  onMenu,
}: {
  j: Job;
  detak: number;
  habis: boolean;
  onBuka: (j: Job) => void;
  onThumbPecah: (id: string) => void;
  onMenu: (x: number, y: number, j: Job) => void;
}) {
  const tahan = useRef(0);
  const tekan = useTekanLama((x, y) => {
    tahan.current = Date.now();
    onMenu(x, y, j);
  });
  return (
    <li>
      <button
        type="button"
        className="eg-riwayat-item"
        onClick={() => {
          if (Date.now() - tahan.current < 600) return;
          onBuka(j);
        }}
        onTouchStart={tekan.onTouchStart}
        onTouchMove={tekan.onTouchMove}
        onTouchEnd={tekan.onTouchEnd}
        onTouchCancel={tekan.onTouchCancel}
        onContextMenu={tekan.onContextMenu}
      >
        {j.status === "COMPLETED" && j.hasil && !habis ? (
          <img src={j.hasil} alt="" loading="lazy" decoding="async" onError={() => onThumbPecah(j.id)} />
        ) : (
          <span className={"eg-riwayat-ikon " + kelasStatus(j.status)} aria-hidden="true">
            {j.status === "COMPLETED" ? <FotoIkon ukuran={16} /> : j.status === "EXPIRED" ? <TutupIkon ukuran={14} /> : <AsetIkon nama="box" ukuran={16} />}
          </span>
        )}
        <span className="eg-riwayat-badan">
          <b>{j.namaFilter}</b>
          <span className="eg-nama-file">{j.sumberNama}</span>
          <time>{waktuRelatif(j.dibuat, detak)}</time>
        </span>
        <span className={"eg-riwayat-status " + kelasStatus(j.status)}>{teksStatus(j.status)}</span>
      </button>
    </li>
  );
}

function kelasStatus(s: string): string {
  if (s === "COMPLETED") return "sukses";
  if (s === "FAILED") return "gagal";
  if (s === "EXPIRED") return "habis";
  return "jalan";
}
