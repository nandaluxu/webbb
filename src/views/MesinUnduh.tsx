"use client";

/* Mesin unduh generik: halaman fitur tiktok / instagram / pinterest
   jalan lewat view ini. Entry ny diambil dari KATALOG.
   Layout hasil ada dua macam:
   - solo    : satu video (kayak TikTok) -> video gede + rincian + tombol.
   - koleksi : banyak item (post IG / hasil cari Pinterest) -> rincian +
               grid media + pemilih susunan. Foto dibesarkan lewat
               Penampil, video diputar langsung.
   Entry panel (AIO): satu video yang sama, banyak kualitas ->
               PanelAio (pratinjau tunggal + dropdown kualitas +
               tombol unduh + progress render SSE).
   Entry model pencarian (mode 'cari') otomatis dapet form kata kunci
   + chip jumlah.
   Logika unduh file ny (blob + SSE) ada di lib/unduh, dipake
   bersama sama PanelAio. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { EntryCari, EntryUnduh, ItemMedia, SusunHasil } from "@/lib/katalog";
import { catatRasio, pasangGrid, lepasGrid } from "@/components/PemilihGrid";
import PemilihGrid from "@/components/PemilihGrid";
import PanelAio from "@/components/PanelAio";
import { Penampil, type Foto } from "@/components/efek/Penampil";
import { matikanAktifLain } from "@/lib/sentuh";
import { unduhFile } from "@/lib/unduh";
import { UnduhIkon, NadaIkon, SemuaIkon, PlayIkon, FotoIkon, PanahKeluar } from "@/components/ikon";
import TombolTempel from "@/components/TombolTempel";

type Entry = EntryUnduh | EntryCari;
type Status = { jenis: "kosong" } | { jenis: "muat"; pesan: string } | { jenis: "gagal"; judul: string; pesan: string } | { jenis: "hasil"; data: SusunHasil };

export default function MesinUnduh({ entry }: { entry: Entry }) {
  const modeCari = entry.mode === "cari";
  const [nilai, setNilai] = useState("");
  const [jumlah, setJumlah] = useState((entry as EntryCari).jumlahDefault ?? 12);
  const [status, setStatus] = useState<Status>({ jenis: "kosong" });
  const [sibuk, setSibuk] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const gagalRef = useRef<HTMLDivElement>(null);

  /* Deteksi pointer di client doang: view ini sekarang ke-SSR
     (rute beneran), window cuma ada setelah hydration. */
  const sentuh = useRef(false);
  const tipePointer = useRef("mouse");
  useEffect(() => {
    sentuh.current = window.matchMedia("(pointer: coarse)").matches;
    tipePointer.current = sentuh.current ? "touch" : "mouse";
    const on = (e: PointerEvent) => {
      tipePointer.current = e.pointerType;
    };
    addEventListener("pointerdown", on, { capture: true, passive: true });
    return () => removeEventListener("pointerdown", on, { capture: true });
  }, []);

  /* Tap di luar kartu matiin lapisan hover tiruan. */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".thumb") && !(e.target as HTMLElement).closest(".kartu-media")) {
        matikanAktifLain(null);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (status.jenis === "gagal" && gagalRef.current) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gagalRef.current.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-5px)" },
          { transform: "translateX(5px)" },
          { transform: "translateX(0)" },
        ],
        { duration: reduce ? 1 : 260, easing: "ease-in-out" }
      );
    }
  }, [status]);

  async function jalankanUnduh(link: string) {
    const unduh = entry as EntryUnduh;
    setStatus({ jenis: "muat", pesan: "Mengambil data dari " + entry.label + "..." });
    setSibuk(true);
    try {
      const res = await fetch(unduh.endpoint(link));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!unduh.cekData(data)) {
        setStatus({ jenis: "gagal", judul: "Itemnya tidak bisa diambil", pesan: unduh.pesanGagal(data) });
        return;
      }
      setStatus({ jenis: "hasil", data: unduh.susun(data) });
    } catch (err) {
      setStatus({
        jenis: "gagal",
        judul: "Gagal menghubungi API",
        pesan:
          "Server menjawab dengan error atau jaringannya bermasalah (" +
          (err instanceof Error ? err.message : "?") +
          "). Tunggu sebentar lalu tekan Ambil lagi.",
      });
    } finally {
      setSibuk(false);
    }
  }

  async function jalankanCari(kueri: string) {
    const cari = entry as EntryCari;
    setStatus({ jenis: "muat", pesan: 'Nyari pin buat "' + kueri + '"...' });
    setSibuk(true);
    try {
      const data = await cari.cari(kueri, jumlah);
      setStatus({ jenis: "hasil", data });
    } catch (err) {
      setStatus({
        jenis: "gagal",
        judul: "Pencarian gagal",
        pesan: err instanceof Error ? err.message : "Ada yang salah pas nyari pin ny. Coba lagi bentar.",
      });
    } finally {
      setSibuk(false);
    }
  }

  function kirim(e: React.FormEvent) {
    e.preventDefault();
    if (modeCari) {
      const kueri = nilai.trim().replace(/\s+/g, " ");
      if (!kueri) {
        setStatus({ jenis: "gagal", judul: "Kata kuncinya masih kosong", pesan: "Tulis dulu kata kunci ny di kotak di atas, misal: kucing oren. Terus tekan Cari." });
        return;
      }
      if (kueri.length < 2) {
        setStatus({ jenis: "gagal", judul: "Kata kuncinya kependekan", pesan: "Minimal 2 karakter. Coba kata yang lebih spesifik biar hasil ny bagus." });
        return;
      }
      jalankanCari(kueri.slice(0, 80));
      return;
    }
    let link = nilai.trim();
    if (!link) {
      setStatus({ jenis: "gagal", judul: "Linknya masih kosong", pesan: "Tempel dulu link " + entry.label + " di kotak di atas, lalu tekan Ambil." });
      return;
    }
    if (!/^https?:\/\//i.test(link)) link = "https://" + link;
    const unduh = entry as EntryUnduh;
    if (!unduh.cocok(link)) {
      setStatus({ jenis: "gagal", judul: "Linknya bukan " + entry.label, pesan: unduh.pesanSalah });
      return;
    }
    jalankanUnduh(link);
  }

  const jumlahPilihan = (entry as EntryCari).jumlahPilihan ?? [];

  return (
    <>
      <section className="head">
        <h1>{entry.judul}</h1>
        <p className="lede">{entry.lede}</p>
      </section>

      <form className="form" onSubmit={kirim} noValidate>
        <label htmlFor="inputFitur">{entry.labelForm}</label>
        <div className="row">
          <input
            id="inputFitur"
            type="text"
            inputMode={modeCari ? "search" : undefined}
            value={nilai}
            onChange={(e) => setNilai(e.target.value)}
            placeholder={entry.placeholder}
            aria-describedby="petunjukForm"
          />
          {!modeCari && <TombolTempel onTempel={setNilai} />}
          <button type="submit" className="btn primary" disabled={sibuk}>
            {modeCari ? "Cari" : "Ambil"}
          </button>
        </div>
        <p className="hint" id="petunjukForm">
          {entry.petunjuk}
        </p>
        {modeCari && jumlahPilihan.length > 0 && (
          <div className="chips" role="group" aria-label="Jumlah hasil">
            <span className="chip-label">Jumlah</span>
            {jumlahPilihan.map((n) => (
              <button
                key={n}
                type="button"
                className={"chip" + (n === jumlah ? " aktif" : "")}
                aria-pressed={n === jumlah}
                onClick={() => setJumlah(n)}
              >
                {n}
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="status" ref={statusRef} aria-live="polite">
        {status.jenis === "kosong" && (
          <div className="kosong">
            {entry.kosong ? (
              <span dangerouslySetInnerHTML={{ __html: entry.kosong }} />
            ) : (
              <>
                Hasil bakal muncul di sini: <b>pratinjau</b>, rincian post,
                <br />
                dan <b>tombol simpen</b> sebelum file ny keunduh.
              </>
            )}
          </div>
        )}
        {status.jenis === "muat" && (
          <div className="muat">
            <span className="bar" />
            <span>{status.pesan}</span>
          </div>
        )}
        {status.jenis === "gagal" && (
          <div className="gagal" ref={gagalRef}>
            <h2>{status.judul}</h2>
            <p>{status.pesan}</p>
          </div>
        )}
        {status.jenis === "hasil" && (
          <Hasil
            data={status.data}
            panel={!modeCari && !!(entry as EntryUnduh).panel}
            sentuh={sentuh.current}
            tipePointer={tipePointer}
          />
        )}
      </div>
    </>
  );
}

/* ---------- Layout hasil ---------- */

function Hasil({
  data,
  panel,
  sentuh,
  tipePointer,
}: {
  data: SusunHasil;
  panel?: boolean;
  sentuh: boolean;
  tipePointer: React.RefObject<string>;
}) {
  /* Entry panel (AIO): satu video + banyak kualitas -> panel tunggal,
     bukan grid kartu. Item AIO (unduhSse) juga gak bisa langsung
     diputar dari url stream, jadi jangan masuk layout solo walau
     cuman 1 video. */
  if (panel) return <PanelAio data={data} />;
  const solo = data.items.length === 1 && data.items[0].jenis === "video" && !data.items[0].unduhSse;
  if (solo) return <Solo data={data} />;
  return <Koleksi data={data} sentuh={sentuh} tipePointer={tipePointer} />;
}

function Rincian({ info }: { info: [string, string][] }) {
  if (!info.length) return null;
  /* P1-4c: baris dengan nilai kosong/null/undefined gak dirender —
     gak ada "-", gak ada "undefined", gak ada label nyisain gap
     (dipake IG/TikTok/Pinterest/AIO sekalian). */
  const isi = info.filter(([nama, nilai]) => nama && nilai != null && String(nilai).trim() !== "");
  if (!isi.length) return null;
  return (
    <dl className="rincian">
      {isi.map(([nama, nilai]) => (
        <div className="baris" key={nama}>
          <dt>{nama}</dt>
          <dd>{nilai}</dd>
        </div>
      ))}
    </dl>
  );
}

function Solo({ data }: { data: SusunHasil }) {
  const item = data.items[0];
  const [noVideo, setNoVideo] = useState(false);

  return (
    <div className="hasil">
      <figure className={"pratek" + (noVideo ? " no-video" : "")}>
        <video
          controls
          preload="metadata"
          playsInline
          aria-label="Pratinjau video"
          poster={item.thumbnail}
          src={item.url}
          onError={() => setNoVideo(true)}
        />
        <div className="gagal-muat">
          Pratinjau tidak bisa diputar di sini (server video menolak atau linknya kedaluwarsa), tapi tombol unduh di
          bawah tetap bisa dicoba.
        </div>
      </figure>
      <div>
        <Rincian info={data.info} />
        <div className="aksi">
          <TombolUnduh
            url={item.url}
            nama={item.nama}
            label="Unduh video (MP4)"
            ikon={<UnduhIkon />}
            utama
            cadangan={item.cadangan}
          />
          {data.tambahan.map((t) => (
            <TombolUnduh
              key={t.url}
              url={t.url}
              nama={t.nama}
              label={t.label}
              ikon={t.ikon === "nada" ? <NadaIkon /> : <UnduhIkon />}
              cadangan={undefined}
            />
          ))}
        </div>
        <p className="catatan">
          Nama file dibuat otomatis dari caption. Videony diambil lewat server biar pratinjau ny bisa diputar dan
          unduhanny langsung kesimpen (tanpa tab baru).
        </p>
      </div>
    </div>
  );
}

function Koleksi({
  data,
  sentuh,
  tipePointer,
}: {
  data: SusunHasil;
  sentuh: boolean;
  tipePointer: React.RefObject<string>;
}) {
  const gridRef = useRef<HTMLUListElement>(null);
  const [prosesSemua, setProsesSemua] = useState<{ i: number; total: number; persen?: number } | null>(null);
  const [selesaiSemua, setSelesaiSemua] = useState<string | null>(null);

  /* Grid hasil baru ke-render SETELAH pencarian kelar, jadi dia ny
     daftar sendiri ke sistem mode grid pas elemen ny muncul. */
  const tunjukRef = (el: HTMLUListElement | null) => {
    const lama = gridRef.current;
    if (lama && lama !== el) lepasGrid(lama);
    gridRef.current = el;
    if (el) pasangGrid(el);
  };

  const fotoDaftar = useMemo<Foto[]>(
    () =>
      data.items
        /* Thumbnail video AIO (poster) ikut bisa di-zoom: itu
           satu-satunya cara "ngintip" videony sebelum diunduh. */
        .filter((i) => i.jenis === "foto" || (i.jenis === "video" && i.poster))
        .map((i) => ({
          src: i.thumbnail || i.url,
          alt: i.judul || (i.jenis === "foto" ? "Foto hasil" : "Pratinjau video"),
          /* P0-3: pratinjau cadangan buat penampil (pinimg bisa nolak
             varian 736x buat PNG/GIF — dicoba sekali lewat proksi). */
          cadangan: i.cadanganPratinjau,
        })),
    [data]
  );

  /* Kartu media muncul satu-satu. */
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = gridRef.current?.querySelectorAll<HTMLElement>("li");
    el?.forEach((item, i) => {
      if (reduce) return;
      item.classList.add("masuk");
      item.style.setProperty("--lambat", 80 + i * 55 + "ms");
      requestAnimationFrame(() => requestAnimationFrame(() => item.classList.add("on")));
    });
  }, [data]);

  async function unduhSemua() {
    setProsesSemua({ i: 0, total: data.items.length });
    setSelesaiSemua(null);
    let lewatTab = 0;
    let terblokir = 0;
    for (let i = 0; i < data.items.length; i++) {
      setProsesSemua({ i: i + 1, total: data.items.length });
      const item = data.items[i];
      const hasil = await unduhFile(item.url, item.nama, item.cadangan, {
        unduhSse: item.unduhSse,
        onProses: (p) => setProsesSemua({ i: i + 1, total: data.items.length, persen: p }),
      });
      if (hasil === "tab") lewatTab++;
      if (hasil === "gagal") terblokir++;
      await new Promise((r) => setTimeout(r, 400));
    }
    setProsesSemua(null);
    setSelesaiSemua(
      lewatTab || terblokir
        ? lewatTab + " item dibuka di tab baru" + (terblokir ? ", " + terblokir + " gagal (popup keblokir)" : "")
        : "Semua item terunduh"
    );
    setTimeout(() => setSelesaiSemua(null), 4000);
  }

  return (
    <div className="hasil koleksi">
      <div className="koleksi-rincian">
        <Rincian info={data.info} />
        <div className="koleksi-alat">
          {data.items.length > 1 && (
            <button type="button" className="btn primary" onClick={unduhSemua} disabled={!!prosesSemua}>
              <SemuaIkon />
              <span>
                {prosesSemua
                  ? "Mengunduh " + prosesSemua.i + "/" + prosesSemua.total + (prosesSemua.persen ? " (" + prosesSemua.persen + "%)…" : "…")
                  : selesaiSemua ?? "Unduh semua (" + data.items.length + " item)"}
              </span>
            </button>
          )}
          <div className="alat-grid">
            <span className="alat-label">Susunan</span>
            <PemilihGrid gridRef={gridRef} />
          </div>
        </div>
      </div>
      <ul className="gal-unduh" ref={tunjukRef}>
        {data.items.map((item, i) => (
          <KartuMedia key={item.url + i} item={item} urutan={i} fotoDaftar={fotoDaftar} sentuh={sentuh} tipePointer={tipePointer} />
        ))}
      </ul>
    </div>
  );
}

/* ---------- Kartu media: foto / video + lapisan animasi hover ---------- */

function KartuMedia({
  item,
  urutan,
  fotoDaftar,
  sentuh,
  tipePointer,
}: {
  item: ItemMedia;
  urutan: number;
  fotoDaftar: Foto[];
  sentuh: boolean;
  tipePointer: React.RefObject<string>;
}) {
  const liRef = useRef<HTMLLIElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const bRef = useRef<HTMLButtonElement>(null);
  const [nyobaAsli, setNyobaAsli] = useState(false);
  const [gagal, setGagal] = useState(false);
  const [simpanStatus, setSimpanStatus] = useState<"siap" | "sibuk" | "beres" | "tab" | "gagal">("siap");
  /* Persen render AIO (stream SSE) biar tombol simpen ny hidup, gak
     kerasa nge-hang pas video dirender di server. */
  const [persen, setPersen] = useState<number | null>(null);

  function bukaFoto() {
    const b = bRef.current;
    if (!b) return;
    /* Di layar sentuh: sentuhan pertama nyalain lapisan hover ny dulu,
       sentuhan kedua baru buka penampil (kayak pola hover di desktop). */
    if ((sentuh || tipePointer.current === "touch") && !b.classList.contains("aktif")) {
      matikanAktifLain(b);
      b.classList.add("aktif");
      return;
    }
    matikanAktifLain(null);
    const src = item.thumbnail || item.url;
    const idx = fotoDaftar.findIndex((f) => f.src === src);
    Penampil.buka(fotoDaftar, Math.max(0, idx), b);
  }

  async function simpan() {
    setSimpanStatus("sibuk");
    setPersen(item.unduhSse ? 1 : null);
    const hasil = await unduhFile(item.url, item.nama, item.cadangan, {
      unduhSse: item.unduhSse,
      onProses: (p) => setPersen(p),
    });
    setPersen(null);
    setSimpanStatus(hasil === "blob" ? "beres" : hasil === "gagal" ? "gagal" : "tab");
    setTimeout(() => setSimpanStatus("siap"), 4000);
  }

  return (
    <li
      ref={liRef}
      className={"kartu-media" + (gagal ? " gagal-media" : "")}
    >
      <figure>
        {item.jenis === "video" && !item.poster ? (
          <video
            controls
            preload="metadata"
            playsInline
            aria-label={"Pratinjau video item " + (urutan + 1)}
            poster={item.thumbnail}
            src={item.url}
            onLoadedData={(e) => {
              liRef.current?.classList.add("muat-penuh");
              const v = e.currentTarget;
              if (v.videoWidth) catatRasio(liRef.current, v.videoWidth / v.videoHeight);
            }}
            onError={() => setGagal(true)}
          />
        ) : item.jenis === "audio" ? (
          /* Kartu audio AIO: gak ada media yang bisa diputar/di-zoom,
             isiny placeholder nada + label kualitas di media-bar.
             Rasio ny ikut aturan figure biasa (4:5 / 1:1 per mode). */
          <div className="pratinjau-audio" aria-hidden="true">
            <NadaIkon ukuran={30} />
          </div>
        ) : (
          <button type="button" className="pratinjau-foto" ref={bRef} onClick={bukaFoto} aria-label={(item.judul ? item.judul + ". " : "") + (item.jenis === "video" ? "Perbesar pratinjau video item " : "Perbesar foto item ") + (urutan + 1)}>
            <img
              ref={imgRef}
              src={item.thumbnail || item.url}
              data-asli={item.url}
              alt={item.judul || (item.jenis === "video" ? "Pratinjau video item " : "Foto item ") + (urutan + 1)}
              loading="lazy"
              decoding="async"
              onLoad={(e) => {
                const img = e.currentTarget;
                img.classList.add("ok");
                liRef.current?.classList.add("muat-penuh");
                if (img.naturalWidth) catatRasio(liRef.current, img.naturalWidth / img.naturalHeight);
              }}
              onError={() => {
                /* Thumbnail kecil gak ada? Balik ke URL asli sekali, baru nyerah. */
                const asli = item.url;
                if (asli && asli !== imgRef.current?.src && !nyobaAsli) {
                  setNyobaAsli(true);
                  if (imgRef.current) imgRef.current.src = asli;
                } else {
                  setGagal(true);
                }
              }}
            />
          </button>
        )}
        <span className="pasak" aria-hidden="true" />
      </figure>

      <div className="media-bar">
        <span className="mb-ikon" aria-hidden="true">
          {item.jenis === "video" ? <PlayIkon /> : item.jenis === "audio" ? <NadaIkon /> : <FotoIkon />}
        </span>
        <span className="mb-teks">{item.judul || (item.jenis === "video" ? "Video " : item.jenis === "audio" ? "Audio " : "Foto ") + (urutan + 1)}</span>
        {item.sumber && (
          <a className="mb-aksi" href={item.sumber} target="_blank" rel="noopener" aria-label="Buka halaman sumber" title="Buka halaman sumber">
            <PanahKeluar ukuran={12} />
          </a>
        )}
      </div>

      <button
        type="button"
        className={"simpan" + (simpanStatus === "sibuk" ? " sibuk" : "") + (simpanStatus === "beres" ? " beres" : "") + (persen != null ? " persen" : "")}
        onClick={simpan}
        aria-label={"Simpan item " + (urutan + 1) + " (" + item.jenis + ")" + (persen != null ? ", render " + persen + " persen" : "") + (simpanStatus === "tab" ? ", dibuka di tab baru" : "")}
      >
        {persen != null ? <span className="simpan-angka">{persen}%</span> : <UnduhIkon ukuran={15} />}
      </button>

      {item.jenis !== "audio" && (
        <span className="media-err">
          Item ini tidak bisa dimuat, tapi tombol simpan di pojok tetap bisa dicoba.
        </span>
      )}
    </li>
  );
}

function TombolUnduh({
  url,
  nama,
  label,
  ikon,
  utama,
  cadangan,
}: {
  url: string;
  nama: string;
  label: string;
  ikon: React.ReactNode;
  utama?: boolean;
  cadangan?: string;
}) {
  const [status, setStatus] = useState<"siap" | "sibuk" | "beres" | "tab" | "gagal">("siap");

  async function klik() {
    setStatus("sibuk");
    const hasil = await unduhFile(url, nama, cadangan);
    setStatus(hasil === "blob" ? "beres" : hasil === "gagal" ? "gagal" : "tab");
    setTimeout(() => setStatus("siap"), 4000);
  }

  const teks =
    status === "sibuk"
      ? "Menyiapkan unduhan..."
      : status === "beres"
        ? "Unduhan dimulai"
        : status === "gagal"
          ? "Gagal, popup keblokir"
          : status === "tab"
            ? "Dibuka di tab baru"
            : label;

  return (
    <button type="button" className={"btn" + (utama ? " primary" : "")} onClick={klik} disabled={status === "sibuk"}>
      {ikon}
      <span>{teks}</span>
    </button>
  );
}
