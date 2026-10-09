"use client";

/* PanelAio: layout hasil khusus AIO Downloader.
   Beda sama Koleksi: hasil AIO itu SATU video yang sama dengan banyak
   pilihan kualitas: nampilin tiap resolusi jadi kartu terpisah cuma
   bikin user scroll ke ujung ny doang (dan download ny kebanyaan duplikat).
   Bentuk ny satu panel: pratinjau THUMBNAIL (poster dari resolver,
   gak ada video yang di-buffer/diputar — hemat bandwidth, file ny
   emang cuma turun pas user minta unduh), rincian dasar, dropdown
   kualitas custom (Video + Audio digrup, datany dari medias resolver,
   gak ada pilihan yang dihardcode), satu tombol unduh yang pas
   dipencet berubah jadi bar progress render SSE (persen ASLI dari
   stream, bukan timer palsu), abis itu Selesai / Gagal / Dibuka di
   tab baru.
   Pas proses: dropdown + tombol dikunci, pratinjau tetep keliatan,
   gak ada bagian halaman lain yang ikut loading. */

import { useMemo, useRef, useState } from "react";
import type { ItemMedia, SusunHasil } from "@/lib/katalog";
import { unduhFile } from "@/lib/unduh";
import { Penampil, type Foto } from "@/components/efek/Penampil";
import PilihOpsi, { type GrupOpsi } from "@/components/PilihOpsi";
import { UnduhIkon, CentangIkon, PanahKeluar } from "@/components/ikon";
import { mainkanSfx } from "@/lib/suara";

/* Label resolver ("1080p (mp4)") dikerok jadi teks yang enak
   dibaca di dropdown ("1080p MP4"). Cuma format tampilan, isi ny
   tetep dari data. */
function teksOpsi(item: ItemMedia): string {
  return (item.judul || item.jenis).replace(/\s*\(([^)]+)\)/, (_m, e: string) => " " + String(e).toUpperCase()).trim();
}

/* Urutan: video TERBAIK duluan (default terpilih), audio bitrate
   besar duluan. Skor ny campur dua gaya label resolver: YouTube
   pake angka (2160p > 1080p), TikTok pake keyword
   (hd_no_watermark > no_watermark > watermark) — di-sort dalam
   satu respons, jadi gak pernah kecampur antar platform. */
function susunGrup(items: ItemMedia[]): { grup: GrupOpsi[]; urut: ItemMedia[] } {
  const video = items.filter((i) => i.jenis === "video");
  const audio = items.filter((i) => i.jenis === "audio");
  const bitrate = (i: ItemMedia) => parseInt(String(i.judul || "").replace(/[^0-9]/g, ""), 10) || 0;
  const skor = (i: ItemMedia) => {
    const t = String(i.judul || "").toLowerCase();
    let s = parseInt(t.replace(/[^0-9]/g, ""), 10) || 0;
    if (/no[_ -]?watermark/.test(t)) s += 2000;
    if (t.includes("hd")) s += 3000;
    else if (/watermark/.test(t)) s -= 5000;
    return s;
  };
  const videoUrut = [...video].sort((a, b) => skor(b) - skor(a) || String(a.judul || "").localeCompare(String(b.judul || "")));
  const audioUrut = [...audio].sort((a, b) => bitrate(b) - bitrate(a) || String(a.judul || "").localeCompare(String(b.judul || "")));
  const urut = [...videoUrut, ...audioUrut];
  const grup: GrupOpsi[] = [];
  if (videoUrut.length) grup.push({ judul: "Video", opsi: videoUrut.map((i) => ({ nilai: i.url, teks: teksOpsi(i) })) });
  if (audioUrut.length) grup.push({ judul: "Audio", opsi: audioUrut.map((i) => ({ nilai: i.url, teks: teksOpsi(i) })) });
  return { grup, urut };
}

type Keadaan = "siap" | "proses" | "beres" | "tab" | "gagal";

export default function PanelAio({ data }: { data: SusunHasil }) {
  const { grup, urut } = useMemo(() => susunGrup(data.items), [data]);
  const [pilihan, setPilihan] = useState<string>(() => urut[0]?.url ?? "");
  const [keadaan, setKeadaan] = useState<Keadaan>("siap");
  const [persen, setPersen] = useState(0);
  const [pesanGagal, setPesanGagal] = useState("");
  /* Penjaga klik dobel + request kembar: sekali pencet, permintaan
     unduh yang sama gak boleh kepancing lagi sampe kelar. */
  const sibukRef = useRef(false);
  const pratinjauBtn = useRef<HTMLButtonElement>(null);

  const terpilih = urut.find((i) => i.url === pilihan) ?? urut[0];
  const poster = data.items.find((i) => i.thumbnail)?.thumbnail;
  const sibuk = keadaan === "proses";

  /* Pratinjau ny CUMA thumbnail: video ny gak di-buffer/diputar di
     panel (aturan pemilik web). Poster bisa di-zoom lewat Penampil
     kalau mau liat lebih gede. Unduhan tetep jalan lewat proksi
     same-origin, file beneran turun pas tombol dipencet. */

  /* Ganti kualitas = niat baru: state tombol ny balik "siap" (gak
     nyangkut di Selesai/Gagal pilihan sebelumny). Gak bisa pas lagi
     proses: dropdown ny emang kekunci. */
  function gantiPilihan(nilai: string) {
    setPilihan(nilai);
    if (keadaan !== "proses" && !sibukRef.current) {
      setKeadaan("siap");
      setPesanGagal("");
    }
  }

  const foto: Foto[] = useMemo(
    () => (poster ? [{ src: poster, alt: data.info.find(([k]) => k === "Judul")?.[1] || "Pratinjau video" }] : []),
    [poster, data.info]
  );

  function bukaPratinjau() {
    if (foto.length && pratinjauBtn.current) Penampil.buka(foto, 0, pratinjauBtn.current);
  }

  async function unduh() {
    if (sibukRef.current || !terpilih) return;
    sibukRef.current = true;
    setKeadaan("proses");
    setPesanGagal("");
    /* Item SSE dapet persen asli dari stream. Item file langsung
     gak ada progres ny (blob sekali jalan) — bar ny jadi mode
     "mengunduh" (gelombang doang, gak ada angka palsu). */
    setPersen(terpilih.unduhSse ? 1 : 0);
    try {
      const hasil = await unduhFile(terpilih.url, terpilih.nama, terpilih.cadangan, {
        unduhSse: terpilih.unduhSse,
        onProses: (p) => setPersen(p),
      });
      if (hasil === "blob") {
        setKeadaan("beres");
        mainkanSfx("digital-burst");
      } else if (hasil === "tab") {
        setKeadaan("tab");
        mainkanSfx("notification");
      } else {
        setKeadaan("gagal");
        setPesanGagal("Popup tab baru keblokir browser. Izinkan popup buat situs ini, terus coba lagi.");
        mainkanSfx("failure");
      }
    } catch {
      setKeadaan("gagal");
      setPesanGagal("Unduhanny gagal di tengah jalan (server render ny putus atau link ny kedaluwarsa). Coba lagi, atau pilih kualitas lain.");
      mainkanSfx("failure");
    } finally {
      sibukRef.current = false;
    }
  }

  return (
    <div className="hasil aio">
      <figure className="aio-pratinjau">
        {poster ? (
          <button type="button" ref={pratinjauBtn} className="aio-poster" onClick={bukaPratinjau} aria-label="Perbesar pratinjau video" disabled={sibuk}>
            <img
              src={poster}
              alt={data.info.find(([k]) => k === "Judul")?.[1] || "Pratinjau video"}
              loading="lazy"
              decoding="async"
              onLoad={(e) => e.currentTarget.classList.add("ok")}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </button>
        ) : (
          <div className="aio-poster kosong-poster" aria-hidden="true">
            <UnduhIkon ukuran={28} />
          </div>
        )}
        <span className="pasak" aria-hidden="true" />
      </figure>

      <div className="aio-badan">
        <dl className="rincian">
          {data.info.map(([nama, nilai]) => {
            /* P1-4c: field kosong/null GAK dirender — gak ada "-",
               gak ada baris label doang nyisain gap. */
            if (nilai == null || String(nilai).trim() === "") return null;
            return (
              <div className="baris" key={nama}>
                <dt>{nama}</dt>
                <dd>{nilai}</dd>
              </div>
            );
          })}
        </dl>

        <div className="aio-kontrol">
          <PilihOpsi id="aioKualitas" label="Kualitas" grup={grup} value={pilihan} onChange={gantiPilihan} disabled={sibuk} />

          {keadaan === "proses" ? (
            /* Tombol morph jadi bar progress: footprint ny sama
               (tinggi 46px), jadi gak ada lonjakan layout. Item SSE:
               persen angka asli dari stream, lebar fill ny transition
               smooth. Item file langsung: gelombang indeterminate
               (gak ada angka — jangan ngerangge persen palsu). */
            <div
              className="aio-progres"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={terpilih?.unduhSse ? persen : undefined}
              aria-label={terpilih?.unduhSse ? "Progress render " + persen + " persen" : "Mengunduh file"}
            >
              {terpilih?.unduhSse ? (
                <div className="aio-isi" style={{ width: persen + "%" }}>
                  <span className="aio-gel" />
                </div>
              ) : (
                <div className="aio-isi tanpa-persen">
                  <span className="aio-gel" />
                </div>
              )}
              {terpilih?.unduhSse && <span className="aio-angka">{persen}%</span>}
            </div>
          ) : (
            <button
              type="button"
              className={"btn aio-unduh" + (keadaan === "siap" || keadaan === "gagal" ? " primary" : "")}
              onClick={unduh}
              disabled={sibuk}
            >
              {keadaan === "beres" ? (
                <>
                  <CentangIkon />
                  <span>Selesai</span>
                </>
              ) : keadaan === "tab" ? (
                <>
                  <PanahKeluar />
                  <span>Dibuka di tab baru</span>
                </>
              ) : keadaan === "gagal" ? (
                <>
                  <UnduhIkon />
                  <span>Gagal. Coba lagi</span>
                </>
              ) : (
                <>
                  <UnduhIkon />
                  <span>Unduh {terpilih ? teksOpsi(terpilih) : ""}</span>
                </>
              )}
            </button>
          )}
        </div>

        {pesanGagal && <p className="aio-catatan gagal-catatan">{pesanGagal}</p>}
        {!pesanGagal && (
          <p className="aio-catatan">
            {terpilih?.unduhSse
              ? "Video ny dirender duluan di server (progress keliatan di tombol), abis itu file ny otomatis kesimpen. Kualitasny diambil dari daftar yang tersedia buat link tadi."
              : "Pratinjau ny cuma thumbnail biar hemat kuota, videony cuma turun pas lo pencet Unduh. File ny diambil dari server sumber terus otomatis kesimpen (gak ada tab baru)."}
          </p>
        )}
      </div>
    </div>
  );
}
