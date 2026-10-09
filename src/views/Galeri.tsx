"use client";

/* Galeri: media dinamis (hasil scan folder + unggahan user), terbaru
   duluan. Grid pake pratinjau low-res biar hemat kuota; file asli baru
   kebuka dari detail post. Upload SATU POST = bisa BANYAK media
   (maks 10 file, masing-maks 10 MB): pilih semua → foto masuk editor
   potongan dulu (crop client-side, file asli gak tersentuh) → susun
   (judul + siapa yang boleh lihat) → kirim sekali jadi satu post. */

import { useEffect, useRef, useState } from "react";
import { UnggahIkon, Panah, TutupIkon, PlayIkon, PotongIkon } from "@/components/ikon";
import PemilihGrid from "@/components/PemilihGrid";
import KisiMedia from "@/components/KisiMedia";
import EditorPost from "@/components/EditorPost";
import Saklar from "@/components/Saklar";
import { SebutOtomatis } from "@/components/SebutOtomatis";
import { useSesi, bukaPintu } from "@/lib/sesi-pengguna";
import { mainkanSfx } from "@/lib/suara";
import type { MediaPublik, Visibilitas } from "@/lib/tipe-media";

async function ambilGaleri(urut: string, jenis: string, batal?: AbortSignal): Promise<MediaPublik[] | string> {
  try {
    /* Timeout: koneksi nyangkut (jaringan HP kambuh) gak boleh
       nunuin skeleton selamany — P0-1. Sort + filter (r28) jalan di
       SERVER (params) — client gak nge-re-scheme data sendiri.
       sinyal batal: pas user ganti sort/filter cepet-cepet, request
       LAMA dibatalkan biar respons basi gak nimpa yang baru (race
       ketemu live di uji: klik Semua + Suka terbanyak berurutan →
       daftar waktu nyamur duluan). */
    const sinyal =
      batal && typeof AbortSignal.any === "function" ? AbortSignal.any([batal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    const r = await fetch("/api/galeri?urut=" + encodeURIComponent(urut) + "&jenis=" + encodeURIComponent(jenis), {
      cache: "no-store",
      signal: sinyal,
    });
    const d = await r.json();
    if (!r.ok) return d.galat || "Gagal muat galeri.";
    return d.daftar as MediaPublik[];
  } catch {
    return "Gak nyambung ke server.";
  }
}

const BATAS_UNGGAH = 10 * 1024 * 1024;
const BATAS_JUMLAH = 10;

/* Sort + filter galeri (r28): dua state PISAH (gak saling ngerusak,
   bisa dikombinain — misal "Video only" + "Suka terbanyak").
   Default = waktu + semua; balik ke situ = klik opsi default ny
   (gak perlu tombol reset khusus — opsi ny sendiri udah jelas). */
const PILIHAN_URUT: { k: string; teks: string }[] = [
  { k: "waktu", teks: "Terbaru" },
  { k: "suka", teks: "Suka terbanyak" },
  { k: "dilihat", teks: "Penonton terbanyak" },
  { k: "komentar", teks: "Komentar terbanyak" },
];
const PILIHAN_JENIS: { k: string; teks: string }[] = [
  { k: "semua", teks: "Semua" },
  { k: "foto", teks: "Foto" },
  { k: "video", teks: "Video" },
];

/* Pilihan visibilitas: teks ny selaras sama label badge di post. */
const PILIHAN_VIS: { k: Visibilitas; teks: string; ket: string }[] = [
  { k: "PUBLIC", teks: "Publik", ket: "Muncul di galeri + profil lu; semua orang bisa lihat." },
  { k: "PROFILE", teks: "Profil doang", ket: "Cuma muncul di profil lu; gak masuk galeri." },
  { k: "PRIVATE", teks: "Privat", ket: "Cuma lu sendiri yang bisa lihat post ini." },
];

type Muat = { jenis: "muat" } | { jenis: "gagal"; pesan: string } | { jenis: "siap"; daftar: MediaPublik[] };

export default function Galeri() {
  const gridRef = useRef<HTMLUListElement>(null);
  const [muat, setMuat] = useState<Muat>({ jenis: "muat" });
  const [unggahBuka, setUnggahBuka] = useState(false);
  /* Sort + filter (r28): urut & jenis. Ganti salah satu = muat ulang
     dengan kombinasi baru (server-side). */
  const [urut, setUrut] = useState("waktu");
  const [jenis, setJenis] = useState("semua");
  const { masuk } = useSesi();
  /* Bayangan state buat listener lama (gak boleh baca state dari
     listener dengan closure basi — makany di-ref). */
  const gagalRef = useRef(false);
  /* Bayangan urut/jenis buat listener jaringan (closure-proof).
     Di-update di effect (bukan pas render — react-hooks/refs). */
  const saringRef = useRef({ urut, jenis });
  useEffect(() => {
    saringRef.current = { urut, jenis };
  }, [urut, jenis]);

  function pasang(hasil: MediaPublik[] | string) {
    gagalRef.current = typeof hasil === "string";
    if (typeof hasil === "string") setMuat({ jenis: "gagal", pesan: hasil });
    else setMuat({ jenis: "siap", daftar: hasil });
  }

  useEffect(() => {
    let hidup = true;
    /* Batalkan request lama pas sort/filter ganti (anti race respons
       basi — lihat catatan ambilGaleri). Skeleton "muat" di-set di
       handler chip (bukan di sini) — aturan react-hooks gak ngijinin
       setState sync di effect; initial mount udah mulai dari "muat". */
    const ctrl = new AbortController();
    ambilGaleri(urut, jenis, ctrl.signal).then((hasil) => {
      if (hidup) pasang(hasil);
    });
    /* P0-1: jaringan balik (online / bfcache resume) + galeri lagi
       gagal -> nyoba ulang sendiri, tanpa refresh. Yang udah siap
       gak disentuh (anti request-storm). */
    const cobaBalik = () => {
      if (!gagalRef.current) return;
      setMuat({ jenis: "muat" });
      ambilGaleri(saringRef.current.urut, saringRef.current.jenis).then((hasil) => {
        if (hidup) pasang(hasil);
      });
    };
    window.addEventListener("jaringan:balik", cobaBalik);
    return () => {
      hidup = false;
      ctrl.abort();
      window.removeEventListener("jaringan:balik", cobaBalik);
    };
  }, [urut, jenis]);

  function cobaLagi() {
    setMuat({ jenis: "muat" });
    ambilGaleri(urut, jenis).then(pasang);
  }

  function ubahMedia(id: string, ubah: { suka?: number; disukai?: boolean; komentar?: number; hapus?: boolean; visibilitas?: Visibilitas; bolehUnduh?: boolean }) {
    setMuat((p) => {
      if (p.jenis !== "siap") return p;
      if (ubah.hapus) return { jenis: "siap", daftar: p.daftar.filter((m) => m.id !== id) };
      /* Privasi diganti (P1-6): galeri cuma nampilin PUBLIC — post
         yang jadi PROFILE/PRIVATE ilang dari daftar (cached data
         ke-invalidate, bukan cuma UI). */
      if (ubah.visibilitas && ubah.visibilitas !== "PUBLIC") {
        return { jenis: "siap", daftar: p.daftar.filter((m) => m.id !== id) };
      }
      return { jenis: "siap", daftar: p.daftar.map((m) => (m.id === id ? { ...m, ...ubah } : m)) };
    });
  }

  function mediaBaru(m: MediaPublik) {
    setMuat((p) =>
      p.jenis === "siap" ? { jenis: "siap", daftar: [m, ...p.daftar] } : { jenis: "siap", daftar: [m] }
    );
    setUnggahBuka(false);
  }

  const jumlah = muat.jenis === "siap" ? muat.daftar.length : 0;

  return (
    <>
      <header className="galeri-kepala">
        <h1>Photo Archive</h1>
        <div className="kenalan">
          <p className="count">
            <b>{jumlah}</b> media
          </p>
          <PemilihGrid gridRef={gridRef} />
          <button
            type="button"
            className="btn kecil"
            onClick={() => (masuk ? setUnggahBuka((v) => !v) : bukaPintu())}
            aria-expanded={unggahBuka}
          >
            <UnggahIkon />
            Unggah
          </button>
        </div>
      </header>

      {/* Sort + filter (r28): dua grup tombol TERPISAH — kombinasi
          bebas (misal Video + Suka terbanyak), default = Terbaru +
          Semua. aria-pressed nunjukin yang aktif. */}
      <div className="gal-saring" role="group" aria-label="Saring galeri">
        <div className="gal-saring-grup" role="group" aria-label="Filter jenis media">
          {PILIHAN_JENIS.map((p) => (
            <button
              key={p.k}
              type="button"
              className={"btn kecil" + (jenis === p.k ? " primary" : "")}
              aria-pressed={jenis === p.k}
              onClick={() => {
                if (jenis !== p.k) {
                  setJenis(p.k);
                  setMuat({ jenis: "muat" });
                  mainkanSfx("ui-menu");
                }
              }}
            >
              {p.teks}
            </button>
          ))}
        </div>
        <div className="gal-saring-grup" role="group" aria-label="Urutkan galeri">
          {PILIHAN_URUT.map((p) => (
            <button
              key={p.k}
              type="button"
              className={"btn kecil" + (urut === p.k ? " primary" : "")}
              aria-pressed={urut === p.k}
              onClick={() => {
                if (urut !== p.k) {
                  setUrut(p.k);
                  setMuat({ jenis: "muat" });
                  mainkanSfx("ui-menu");
                }
              }}
            >
              {p.teks}
            </button>
          ))}
        </div>
      </div>

      {unggahBuka && masuk && <FormUnggah onJadi={mediaBaru} />}

      {muat.jenis === "muat" && (
        <ul className="grid skeleton-grid" aria-label="Memuat galeri" aria-busy="true">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <li key={i} className="skeleton-kartu" aria-hidden="true" />
          ))}
        </ul>
      )}
      {muat.jenis === "gagal" && (
        <div className="status">
          <div className="gagal">
            <h2>Galeri ny gak kebuka</h2>
            <p>{muat.pesan}</p>
            <p>
              <button type="button" className="btn" onClick={cobaLagi}>
                Coba lagi
              </button>
            </p>
          </div>
        </div>
      )}
      {muat.jenis === "siap" && muat.daftar.length === 0 && (
        <div className="status">
          <div className="kosong">
            Belum ada media. Upload foto atau video lewat tombol <b>Unggah</b>, atau taro file di folder
            public/galeri, nanti ke-scan otomatis.
          </div>
        </div>
      )}

      {muat.jenis === "siap" && muat.daftar.length > 0 && (
        <KisiMedia daftar={muat.daftar} gridRef={gridRef} onUbah={ubahMedia} />
      )}
    </>
  );
}

/* ---------- Form upload: pilih → (potong foto) → susun → kirim ---------- */

function kirimXhr(fd: FormData, onProgres: (persen: number) => void): Promise<{ ok: boolean; data: any }> {
  return new Promise((selesai, gagal) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/galeri");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgres(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      selesai({ ok: xhr.status >= 200 && xhr.status < 300, data });
    };
    xhr.onerror = () => gagal(new Error("gak nyambung"));
    xhr.send(fd);
  });
}

const jenisFile = (f: File): "foto" | "video" | null =>
  f.type.startsWith("image/") ? "foto" : f.type.startsWith("video/") ? "video" : null;

type Tahap = "pilih" | "edit" | "susun";

function FormUnggah({ onJadi }: { onJadi: (m: MediaPublik) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [tahap, setTahap] = useState<Tahap>("pilih");
  const [judul, setJudul] = useState("");
  /* r30: izin unduhan (default nyala, nyamain perilaku lama). */
  const [bolehUnduh, setBolehUnduh] = useState(true);
  /* Posisi kursor di input judul (buat autocomplete @mention — r28).
     Mention di caption divalidasi + resolve ulang di SERVER pas
     upload (lihat /api/galeri POST). */
  const [posisiJudul, setPosisiJudul] = useState(0);
  const judulRef = useRef<HTMLInputElement>(null);
  const [vis, setVis] = useState<Visibilitas>("PUBLIC");
  const [sibuk, setSibuk] = useState(false);
  const [persen, setPersen] = useState(0);
  const [galat, setGalat] = useState("");
  const [preview, setPreview] = useState<string[]>([]);
  const urlRef = useRef<string[]>([]);

  /* Object URL pratinjau: dibikin saat tahap susun, dibersihin pas
     ganti / nutup (gak pernah numpuk). */
  useEffect(() => {
    if (tahap !== "susun") return;
    const urls = files.map((f) => URL.createObjectURL(f));
    urlRef.current = urls;
    setPreview(urls);
    return () => {
      urlRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlRef.current = [];
    };
  }, [files, tahap]);

  /* Milih file (bisa banyak, campur foto + video): validasi duluan
     (jenis, jumlah, ukuran per file), foto lanjut ke editor potongan. */
  function pasangFile(daftar: File[]) {
    setGalat("");
    if (!daftar.length) return;
    if (daftar.length > BATAS_JUMLAH) {
      setGalat("Maksimal " + BATAS_JUMLAH + " file dalam satu post.");
      mainkanSfx("system-alert");
      return;
    }
    for (const f of daftar) {
      if (!jenisFile(f)) {
        setGalat('File "' + f.name + '" gak didukung — cuma foto atau video.');
        mainkanSfx("system-alert");
        return;
      }
      if (f.size > BATAS_UNGGAH) {
        setGalat('File "' + f.name + '" ' + (f.size / 1048576).toFixed(1) + " MB, batasny 10 MB per file.");
        mainkanSfx("system-alert");
        return;
      }
    }
    mainkanSfx("ui-menu");
    setFiles(daftar);
    /* Ada foto = lewat editor potongan dulu; semua video = langsung susun. */
    setTahap(daftar.some((f) => jenisFile(f) === "foto") ? "edit" : "susun");
  }

  /* Hasil editor: foto (mungkin kepotong webp) balik ke slot masing2
     (urutan campur foto/video tetep). */
  function selesaiEdit(hasilFoto: File[]) {
    let k = 0;
    const gabung = files.map((f) => (jenisFile(f) === "foto" ? hasilFoto[k++] : f));
    setFiles(gabung);
    setTahap("susun");
  }

  function batalEdit() {
    setFiles([]);
    setTahap("pilih");
  }

  function ulangEdit() {
    /* Buka editor lagi pake file HASIL sekarang (webp kebaca normal
       sebagai gambar; potongan bisa dirapiin lagi). */
    const foto = files.filter((f) => jenisFile(f) === "foto");
    if (!foto.length) return;
    setTahap("edit");
  }

  function gantiFile() {
    setFiles([]);
    setPreview([]);
    setTahap("pilih");
    setPersen(0);
    setGalat("");
  }

  /* Mention kepilih dari autocomplete: sisipin @username + spasi di
     posisi kursor (sama kayak bio). */
  function pilihSebutJudul(teksBaru: string, posisiBaru: number) {
    setJudul(teksBaru);
    setPosisiJudul(posisiBaru);
    requestAnimationFrame(() => {
      const el = judulRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(posisiBaru, posisiBaru);
      }
    });
  }

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) {
      setGalat("Pilih file dulu.");
      mainkanSfx("system-alert");
      return;
    }
    setSibuk(true);
    setGalat("");
    setPersen(0);
    const fd = new FormData();
    files.forEach((f) => fd.append("file", f));
    fd.append("judul", judul);
    fd.append("visibilitas", vis);
    fd.append("bolehUnduh", bolehUnduh ? "1" : "0");
    try {
      const { ok, data } = await kirimXhr(fd, setPersen);
      if (!ok) {
        setGalat(data.galat || "Upload gagal.");
        mainkanSfx("failure");
        return;
      }
      mainkanSfx("digital-burst");
      onJadi(data.media);
    } catch {
      setGalat("Gak nyambung ke server.");
      mainkanSfx("failure");
    }
    setSibuk(false);
  }

  const adaFoto = files.some((f) => jenisFile(f) === "foto");
  const ketVis = PILIHAN_VIS.find((p) => p.k === vis)?.ket ?? "";

  return (
    <>
      {tahap === "edit" && (
        <EditorPost files={files.filter((f) => jenisFile(f) === "foto")} onSelesai={selesaiEdit} onBatal={batalEdit} />
      )}

      <form className="unggah-panel masuk on" onSubmit={kirim} noValidate aria-label="Upload media">
        {tahap === "pilih" && (
          <div className="row">
            <label className="pilih-file">
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(e) => {
                  pasangFile(Array.from(e.target.files ?? []));
                  /* Reset input biar milih file yang SAMA lagi tetep keanggep on change. */
                  e.currentTarget.value = "";
                }}
                aria-label="Pilih file foto atau video (bisa beberapa)"
              />
              <span className="btn">
                <UnggahIkon />
                Pilih foto / video
              </span>
            </label>
            <span className="up-ket-pilih">Bisa pilih beberapa file sekaligus (maks {BATAS_JUMLAH}) — semua ny jadi SATU post.</span>
          </div>
        )}

        {tahap === "susun" && (
          <>
            <ul className="up-pratinjau" aria-label="File yang bakal keupload">
              {preview.map((url, i) => {
                const f = files[i];
                const j = jenisFile(f);
                return (
                  <li key={i} className="up-kencil">
                    {j === "video" ? (
                      <span className="up-kencil-video">
                        <video src={url} muted playsInline preload="metadata" aria-hidden="true" />
                        <span className="up-kencil-play" aria-hidden="true">
                          <PlayIkon ukuran={16} />
                        </span>
                        <span className="up-kencil-jenis">video</span>
                      </span>
                    ) : (
                      <img src={url} alt={"Pratinjau file " + (i + 1)} decoding="async" />
                    )}
                    <span className="up-kencil-no" aria-hidden="true">
                      {i + 1}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="row">
              <div className="bio-edit-wrap judul-mention-wrap">
                <input
                  ref={judulRef}
                  type="text"
                  value={judul}
                  onChange={(e) => {
                    setJudul(e.target.value);
                    setPosisiJudul(e.target.selectionStart ?? e.target.value.length);
                  }}
                  onSelect={(e) => setPosisiJudul(e.currentTarget.selectionStart ?? 0)}
                  onKeyUp={(e) => setPosisiJudul(e.currentTarget.selectionStart ?? 0)}
                  onClick={(e) => setPosisiJudul(e.currentTarget.selectionStart ?? 0)}
                  placeholder="Judul / caption (opsional — ketik @ buat nge-mention orang)"
                  maxLength={300}
                  aria-label="Judul media"
                />
                <SebutOtomatis teks={judul} posisi={posisiJudul} onPilih={pilihSebutJudul} />
              </div>
              {adaFoto && (
                <button type="button" className="btn kecil" onClick={ulangEdit} disabled={sibuk}>
                  <PotongIkon />
                  Atur potongan
                </button>
              )}
              <button type="button" className="up-batal" onClick={gantiFile} disabled={sibuk}>
                <TutupIkon ukuran={12} />
                Ganti file
              </button>
              <button type="submit" className="btn primary" disabled={sibuk}>
                {sibuk ? "Nungguh..." : "Unggah"}
                <Panah />
              </button>
            </div>

            <div className="up-vis" role="group" aria-label="Siapa yang boleh lihat post ini">
              {PILIHAN_VIS.map((p) => (
                <button
                  key={p.k}
                  type="button"
                  className={"btn kecil" + (vis === p.k ? " primary" : "")}
                  aria-pressed={vis === p.k}
                  onClick={() => {
                    setVis(p.k);
                    mainkanSfx("ui-menu");
                  }}
                >
                  {p.teks}
                </button>
              ))}
            </div>
            <p className="up-vis-ket" aria-live="polite">
              {ketVis}
            </p>

            {/* r30: izin unduhan — saklar (komponen yang sama kayak
                saklar emoji r24, gaya ny konsisten). Matiin =
                tombol Download di menu post ilang + endpoint unduhan
                ny nolak (server-side, gak cuma disembunyiin). Pemilik
                sendiri tetep bisa unduh post ny. */}
            <div className="up-unduh-saklar">
              <Saklar
                nyala={bolehUnduh}
                label="Izinkan orang lain mengunduh post ini"
                onUbah={(v) => {
                  setBolehUnduh(v);
                  mainkanSfx("ui-menu");
                }}
              />
              <span className="up-unduh-ket">
                {bolehUnduh
                  ? "Tombol Download muncul di menu titik-tiga post lu buat semua yang lihat."
                  : "Cuma lu sendiri yang bisa unduh post ini."}
              </span>
            </div>
          </>
        )}

        {sibuk && (
          <div className="progres-unggah" role="status">
            <span className="progres-bar" style={{ width: persen + "%" }} />
            <span className="progres-teks">{persen}%</span>
          </div>
        )}

        <p className="hint">
          Maks {BATAS_JUMLAH} file per post, 10 MB per file. Foto kepotong di browser lu dulu (file asli gak kekirim kalo gak perlu), pratinjau grid otomatis dikecilin biar hemat kuota.
        </p>
        {galat && (
          <p className="hint" role="alert" style={{ color: "var(--tanda)" }}>
            {galat}
          </p>
        )}
      </form>
    </>
  );
}
