"use client";

/* Akinator: genie nebak karakter yang lo pikirin.

   - Mesin nyata di server (src/lib/akinator + /api/akinator), nyambung
     ke akinator.com. Sesi game idup di memori server, ekspresi genie
     (akitude) dikirim tiap langkah.
   - Gambar ekspresi = file lokal /aset/akinator/*.png (aset prototype,
     gampang diganti karakter custom: tuker fileny, nama ny sama).
     Kalau file lokalny gak ada, otomatis pakai URL akinator.com.
   - Semua state kebayang: idle, jalan (mikir/menekan), tebakan,
     menang, nyerah (soundlike), pilihan, error per-aksi + restart.
   - R23: panggung genie jadi fokus utama (kolom besar di grid 3:2,
     tingginy sejajar blok konten), pertanyaan ditampilkan sebagai
     gelembung chat dari si genie. Posisi panggung bisa dipindah
     kiri/kanan (pref localStorage "neyhra:aki-sisi"); pas di kanan,
     gambar di-flip horizontal biar tetep ngadep konten. Halaman ini
     juga matiin noise latar + token warna monokrom murni (CSS).
   - Desktop: panggung kiri/kanan + arena tanya-jawab. HP: ditumpuk,
     panggung gede di atas, gelembung di bawahny (ekor ke atas).
   - Tema: markup ini SAMA buat 4 gaya UI. Layout + bentuk tiap gaya
     (Klasik / Swiss Zen / Japandi / Hanami) diatur di
     src/app/akinator-tema.css lewat html[data-ui]; Klasik tetep
     dari globals.css. Kait markup buat tema: .aki-head, .aki-no-kata /
     .aki-no-n / .aki-no-tanda, dan data-j di .aki-tombol. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Panah, KiriIkon } from "@/components/ikon";
import { mainkanSfx } from "@/lib/suara";

const JAWABAN = ["Iya", "Tidak", "Tidak tahu", "Mungkin", "Mungkin tidak"];

type Ekspresi = {
  akitude: string;
  label: string;
  mood: string;
  moodLabel: string;
  gambar: string;
  gambarJauh: string;
};

type Tebakan = { nama: string; deskripsi: string; foto: string | null; adaFoto: boolean };
type Opsi = { nama: string; deskripsi: string };

type Papan = {
  ok: true;
  gameId: string;
  status: string;
  pertanyaan?: string;
  tebakan?: Tebakan | null;
  opsi?: Opsi[];
  pilihan?: Opsi;
  step: number;
  persen: number;
  labelProgres: string;
  riwayat: number;
  bisaUndo: boolean;
  ekspresi: Ekspresi | null;
  catatan?: string;
  timesPlayed?: string | null;
};

type Galat = { kode: string; galat: string; cobaLagiMs?: number; matiSesi?: boolean };

/* Pref posisi panggung: "kiri" (default) atau "kanan". Kiri dulu biar
   SSR dan render pertama gak pernah beda (gak ada hydration mismatch);
   pref kebaca di effect, kayak tema. */
const KUNCI_SISI = "neyhra:aki-sisi";
type Sisi = "kiri" | "kanan";

function bacaSisi(): Sisi {
  try {
    return localStorage.getItem(KUNCI_SISI) === "kanan" ? "kanan" : "kiri";
  } catch {
    return "kiri";
  }
}

export default function Akinator() {
  const [papan, setPapan] = useState<Papan | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<Galat | null>(null);
  const [mulaiLagi, setMulaiLagi] = useState(false);
  const [nutup, setNutup] = useState(false);
  const [sisi, setSisi] = useState<Sisi>("kiri");

  /* Pref posisi panggung (kiri/kanan) + latar polos halaman ini. */
  useEffect(() => {
    setSisi(bacaSisi());
    document.body.dataset.latar = "polos";
    return () => {
      delete document.body.dataset.latar;
    };
  }, []);

  const pindahSisi = useCallback(() => {
    setSisi((lama) => {
      const baru: Sisi = lama === "kiri" ? "kanan" : "kiri";
      try {
        localStorage.setItem(KUNCI_SISI, baru);
      } catch {
        /* penyimpanan diblokir: tetep pindah, cuma gak ketimpa */
      }
      return baru;
    });
  }, []);

  const status = papan?.status ?? "idle";
  const sfxMenang = useRef(false);

  /* Reset penanda sfx per game. */
  useEffect(() => {
    if (papan && papan.status === "question") sfxMenang.current = false;
  }, [papan?.gameId]);

  const kirim = useCallback(
    async (badan: Record<string, unknown>) => {
      setSibuk(true);
      setGalat(null);
      /* Batas waktu klien (r25): nyelaras sama budget server (45 detik)
         plus jeda jaringan. Tanpa ini, request yang kepotong tunnel /
         proxy gantung dalem-deman dan yang muncul error nyasar
         "cek koneksi lu" — padahal server ny lagi mikir. */
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 70_000);
      try {
        const res = await fetch("/api/akinator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(badan),
          signal: ac.signal,
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setGalat({ kode: data.kode ?? "ERROR", galat: data.galat ?? "Kesalahan gak terduga.", cobaLagiMs: data.cobaLagiMs, matiSesi: data.matiSesi });
          return null;
        }
        setPapan(data as Papan);

        /* SFX momen: tebakan muncul / menang / nyerah. */
        if (data.status === "propose") mainkanSfx("notification");
        if (data.status === "won" && !sfxMenang.current) {
          sfxMenang.current = true;
          mainkanSfx("digital-burst");
        }
        if (data.status === "soundlike" && badan.aksi === "menyerah") mainkanSfx("failure");
        return data as Papan;
      } catch (e) {
        /* Bedain tiga kejadian ny jelas beda penyebab, jangan satu
           pesen "cek koneksi" buat semua (r25): server app ny mati,
           respons ny gak JSON (biasany error page proxy/tunnel), atau
           beneran kepotong waktu. */
        if (e instanceof DOMException && e.name === "AbortError") {
          setGalat({ kode: "LAMA", galat: "Kelamaan nyambung (lebih dari semenit). Game ny aman — coba lagi, biasany lancar pas jalurny udah longgar." });
        } else if (e instanceof SyntaxError) {
          setGalat({ kode: "JARINGAN", galat: "Server app ny balas aneh (bukan data game). Kalau lu pake tunnel/cloudflared, coba buka langsung dari localhost buat mastiin." });
        } else {
          setGalat({ kode: "JARINGAN", galat: "Sambungan ke server app ny kepotus. Pastiin server ny masih jalan (bash mulai.sh), terus coba lagi — game ny aman." });
        }
        return null;
      } finally {
        clearTimeout(timer);
        setSibuk(false);
      }
    },
    []
  );

  const mulai = useCallback(() => {
    setMulaiLagi(true);
    void kirim({ aksi: "mulai" }).finally(() => setMulaiLagi(false));
  }, [kirim]);

  /* R26: "main ulang" gak lagi langsung bikin game baru di atas sesi
     lama yang masih nyangkut. Alur baru = CLOSE dulu (server buang
     sesi + tutup browser transport + jar SEKARANG), terus balik ke
     layar awal — pemain mulai dari awal lewat tombol "Mulai main"
     yang sama kayak game pertama. Gak ada jalur replay/resume yang
     disentuh. Tutup di-best-effort-kan: server gak kejangkau pun
     tetep balik intro (sesi ke-sweep sendiri pas idle). */
  const tutupDanKembali = useCallback(async () => {
    const id = papan?.gameId;
    setNutup(true);
    try {
      if (id) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 15_000);
        try {
          await fetch("/api/akinator", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aksi: "tutup", gameId: id }),
            signal: ac.signal,
          });
        } catch {
          /* best effort — sesi lama ke-sweep sendiri pas idle */
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      setPapan(null);
      setGalat(null);
      setNutup(false);
    }
  }, [papan]);

  const jawab = useCallback(
    (n: number) => {
      if (!papan || sibuk) return;
      void kirim({ aksi: "jawab", gameId: papan.gameId, jawaban: n });
    },
    [papan, sibuk, kirim]
  );

  /* Pintasan keyboard 1-5 buat jawab (bonus, tetep bisa Tab + Enter). */
  useEffect(() => {
    function tombol(e: KeyboardEvent) {
      if (status !== "question" || sibuk) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const n = Number(e.key) - 1;
      if (n >= 0 && n <= 4) {
        e.preventDefault();
        jawab(n);
      }
    }
    window.addEventListener("keydown", tombol);
    return () => window.removeEventListener("keydown", tombol);
  }, [status, sibuk, jawab]);

  const e = papan?.ekspresi ?? null;

  return (
    <>
      <section className="head aki-head">
        <h1>Akinator</h1>
        <p className="lede">
          Pikirin satu karakter, apapun: orang, tokoh kartun, selebgram, hewan, sampe anggota keluargany. Gw tanya, lo jawab jujur, genie ny nebak.
        </p>
      </section>

      <div className={"aki-papan" + (status === "won" ? " menang" : "")} data-status={status} data-sisi={sisi}>
        <div className="aki-grid">
          <PanggungGenie ekspresi={e} status={status} sibuk={sibuk && status === "question"} onPindah={pindahSisi} sisi={sisi} />

          <div className="aki-badan">
            {/* ---------- Idle: belum mulai ---------- */}
            {!papan && (
              <div className="aki-intro masuk on">
                <h2 className="aki-buka h2">Siap buat dibaca isi kepala?</h2>
                <p>
                  Cara mainny gampang: pikirin SATU karakter, jangan bocorin ke siapa-siapa (apalagi ke gw). Nanti gw kasih pertanyaan kayak{" "}
                  <i>&ldquo;tokoh lo ini perempuan?&rdquo;</i> dan lo jawab dari 5 pilihan. Makin jujur jawaban lo, makin cepet kena.
                </p>
                <ul className="aki-cara">
                  <li>Iya / Tidak jawab sejujur-jujurnya</li>
                  <li>Gak yakin? &ldquo;Tidak tahu&rdquo; itu jawaban sah</li>
                  <li>Kejawab ngawur? Ada tombol Mundur</li>
                </ul>
                <button type="button" className="btn primary" onClick={mulai} disabled={mulaiLagi}>
                  {mulaiLagi ? "Lagi bangunin sesi..." : "Mulai main"}
                  <Panah />
                </button>
              </div>
            )}

            {/* ---------- Lagi main: pertanyaan ---------- */}
            {papan && status === "question" && (
              <>
                <div className="aki-tanya masuk on" key={papan.step + "-" + papan.pertanyaan}>
                  <div className="aki-bola">
                    <p className="aki-no">
                      <span className="aki-no-kata">Pertanyaan</span>{" "}
                      <span className="aki-no-n">
                        <span className="aki-no-tanda">#</span>
                        {papan.step}
                      </span>
                    </p>
                    <h2 className="aki-teks">{papan.pertanyaan}</h2>
                  </div>
                  <div className="aki-maju">
                    <span className="aki-maju-label">{papan.labelProgres}</span>
                    <span className="aki-batang" aria-hidden="true">
                      <span style={{ width: papan.persen + "%" }} />
                    </span>
                    <span className="aki-maju-angka">{Math.round(papan.persen)}%</span>
                  </div>
                </div>

                <div className="aki-jawab" role="group" aria-label="Pilihan jawaban">
                  {JAWABAN.map((j, i) => (
                    <button key={j} type="button" className="aki-tombol" data-j={i} onClick={() => jawab(i)} disabled={sibuk}>
                      <span className="ki">{i + 1}</span>
                      {j}
                    </button>
                  ))}
                </div>

                <div className="aki-kontrol">
                  <button type="button" className="tautan-kecil" onClick={() => kirim({ aksi: "undo", gameId: papan.gameId })} disabled={!papan.bisaUndo || sibuk}>
                    <KiriIkon />
                    Mundur
                  </button>
                  <button type="button" className="tautan-kecil" onClick={() => kirim({ aksi: "menyerah", gameId: papan.gameId })} disabled={sibuk}>
                    Nyerah
                  </button>
                  <span className="aki-catatan">{papan.riwayat} jawaban</span>
                </div>
                {papan.catatan && <p className="aki-info">{papan.catatan}</p>}
              </>
            )}

            {/* ---------- Tebakan ---------- */}
            {papan && status === "propose" && papan.tebakan && (
              <div className="aki-tebakan masuk on">
                <p className="aki-buka">Oke, gw yakin ini:</p>
                <div className="aksi-tebakan">
                  {papan.tebakan.adaFoto && (
                    <img className="aki-foto" src={papan.tebakan.foto ?? ""} alt={"Foto " + papan.tebakan.nama} loading="lazy" referrerPolicy="no-referrer" />
                  )}
                  <div className="badan-tebakan">
                    <h2 className="aki-nama">{papan.tebakan.nama}</h2>
                    {papan.tebakan.deskripsi && <p className="aki-desk">{papan.tebakan.deskripsi}</p>}
                  </div>
                </div>
                <div className="aki-jawab tebakan">
                  <button type="button" className="btn primary" onClick={() => kirim({ aksi: "terima", gameId: papan.gameId })} disabled={sibuk}>
                    Bener, kena!
                  </button>
                  <button type="button" className="btn" onClick={() => kirim({ aksi: "tolak", gameId: papan.gameId })} disabled={sibuk}>
                    Nggak, lanjut tanya
                  </button>
                </div>
              </div>
            )}

            {/* ---------- Menang ---------- */}
            {papan && status === "won" && papan.tebakan && (
              <div className="aki-hasil masuk on">
                <p className="aki-buka">Tebakanny tepat</p>
                <h2 className="aki-nama besar">{papan.tebakan.nama}</h2>
                {papan.tebakan.deskripsi && <p className="aki-desk">{papan.tebakan.deskripsi}</p>}
                <p className="aki-info">Butuh {papan.riwayat} pertanyaan buat nebak ini.</p>
                <div className="aki-jawab tebakan">
                  <button type="button" className="btn primary" onClick={() => void tutupDanKembali()} disabled={nutup}>
                    {nutup ? "Ngebersihin sesi..." : "Mulai dari awal"}
                    <Panah />
                  </button>
                </div>
              </div>
            )}

            {/* ---------- Nyerah: daftar soundlike ---------- */}
            {papan && status === "soundlike" && (
              <div className="aki-soundlike masuk on">
                <p className="aki-buka">Gw nyerah... tapi bentar</p>
                <p className="aki-teks-kecil">
                  Ini beberapa karakter yang paling nyambung sama jawaban lo. Salah satiny bener kan? Pilih:
                </p>
                <ul className="aki-opsi">
                  {(papan.opsi ?? []).map((o, i) => (
                    <li key={o.nama + i}>
                      <button type="button" className="aki-opsi-btn" onClick={() => kirim({ aksi: "pilih", gameId: papan.gameId, pilihan: i })} disabled={sibuk}>
                        <b>{o.nama}</b>
                        {o.deskripsi && <span>{o.deskripsi}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
                {(papan.opsi ?? []).length === 0 && (
                  <p className="aki-info">Daftar ny gak kebaca dari server. Mulai game baru aja ya.</p>
                )}
                <button type="button" className="btn" onClick={() => void tutupDanKembali()} disabled={nutup} style={{ marginTop: 18 }}>
                  {nutup ? "Ngebersihin sesi..." : "Tutup & mulai dari awal"}
                </button>
              </div>
            )}

            {/* ---------- Udah milih (habis nyerah) ---------- */}
            {papan && status === "picked" && papan.pilihan && (
              <div className="aki-hasil masuk on">
                <p className="aki-buka">Yaudah, yang ini</p>
                <h2 className="aki-nama besar">{papan.pilihan.nama}</h2>
                {papan.pilihan.deskripsi && <p className="aki-desk">{papan.pilihan.deskripsi}</p>}
                <div className="aki-jawab tebakan">
                  <button type="button" className="btn primary" onClick={() => void tutupDanKembali()} disabled={nutup}>
                    {nutup ? "Ngebersihin sesi..." : "Mulai dari awal"}
                    <Panah />
                  </button>
                </div>
              </div>
            )}

            {/* ---------- Galat (per-aksi, game tetep aman) ---------- */}
            {galat && (
              <div className="aki-galat" role="alert">
                <p>{galat.galat}</p>
                <div className="aki-galat-aksi">
                  {galat.kode === "CEPAT" ? (
                    /* Start keburu-buru (jeda anti-spam 6 detik): kasih
                       tombol coba lagi langsung, jangan cuma "Tutup". */
                    <button type="button" className="btn kecil primary" onClick={mulai} disabled={sibuk || mulaiLagi}>
                      {mulaiLagi ? "Lagi bangunin sesi..." : "Coba lagi"}
                    </button>
                  ) : galat.matiSesi || galat.kode === "SESI_HILANG" ? (
                    <button type="button" className="btn kecil primary" onClick={() => void tutupDanKembali()} disabled={nutup}>
                      {nutup ? "Ngebersihin sesi..." : "Tutup & mulai dari awal"}
                    </button>
                  ) : (
                    <button type="button" className="btn kecil" onClick={() => setGalat(null)} disabled={sibuk}>
                      Tutup
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- Panggung genie (gambar ekspresi + kaki panggung) ---------- */

function PanggungGenie({
  ekspresi,
  status,
  sibuk,
  sisi,
  onPindah,
}: {
  ekspresi: Ekspresi | null;
  status: string;
  sibuk: boolean;
  sisi: Sisi;
  onPindah: () => void;
}) {
  /* File lokal gak ada (mis. deploy polos) -> pakai URL akinator.com.
     jauh = akitude terakhir yang gagal lokal; begitu ekspresi ganti,
     kunci ny beda dari jauh -> otomatis nyoba lokal lagi (gak perlu
     effect reset). */
  const [jauh, setJauh] = useState<string | null>(null);

  const kunci = ekspresi?.akitude ?? "idle";
  const src =
    jauh === kunci
      ? ekspresi?.gambarJauh ?? "https://id.akinator.com/assets/img/akitudes_670x1096/serein_2.png"
      : ekspresi?.gambar ?? "/aset/akinator/serein_2.png";

  return (
    <figure className={"aki-genie" + (status === "won" ? " pesta" : "")} aria-live="polite">
      {/* .aki-wadah = target flip (pas panggung di kanan). Animasi
          wajah/mikir tetap di img biar gak ketimpa transform flip. */}
      <div className="aki-wadah">
        <img
          key={kunci}
          src={src}
          onError={() => setJauh(kunci)}
          width={670}
          height={1096}
          alt={ekspresi ? "Genie " + ekspresi.label : "Genie santai"}
          className={sibuk ? "mikir" : ""}
          referrerPolicy="no-referrer"
        />
      </div>
      <figcaption className="aki-kaki">
        <b>{ekspresi ? ekspresi.label : "Santai banget"}</b>
        <span>{ekspresi ? ekspresi.moodLabel : "Tenang"}</span>
        <button
          type="button"
          className="aki-sisi"
          onClick={onPindah}
          aria-label={sisi === "kiri" ? "Pindah genie ke kanan" : "Pindah genie ke kiri"}
          title={sisi === "kiri" ? "Pindah genie ke kanan" : "Pindah genie ke kiri"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden="true">
            <path d="M4 8h13" />
            <path d="M13 4l4 4-4 4" />
            <path d="M20 16H7" />
            <path d="M11 12l-4 4 4 4" />
          </svg>
        </button>
      </figcaption>
    </figure>
  );
}
