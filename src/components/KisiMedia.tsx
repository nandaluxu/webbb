"use client";

/* KisiMedia: grid media galeri (thumb + aksi suka/komentar/unduh)
   dipake bersama sama halaman galeri + profil. Klik kartu buka
   PanelPost (detail + komentar), bukan langsung zoom: file asli
   gak kebuka cuma buat ngintip grid. Di layar sentuh, tap pertama
   nyorotin kartu, tap kedua baru buka. */

import { useEffect, useRef, useState } from "react";
import { FotoIkon, BesarIkon, SukaOutlineIkon, SukaPenuhIkon, KomentarAsetIkon, PlayIkon, LencanaVerified } from "@/components/ikon";
import { catatRasio, pasangGrid, lepasGrid, modeGridSekarang, susunUlangMasonry } from "@/components/PemilihGrid";
import PanelPost from "@/components/PanelPost";
import { matikanAktifLain } from "@/lib/sentuh";
import { useSesi, bukaPintu, tolakSesi } from "@/lib/sesi-pengguna";
import { mainkanSfx } from "@/lib/suara";
import type { MediaPublik, Visibilitas } from "@/lib/tipe-media";
import { urlProfil, sebutanUser } from "@/lib/tipe-media";

function ukuranSingkat(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1048576) return Math.round(bytes / 1024) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

export default function KisiMedia({
  daftar,
  gridRef,
  onUbah,
}: {
  daftar: MediaPublik[];
  gridRef?: React.RefObject<HTMLUListElement | null>;
  onUbah: (id: string, ubah: { suka?: number; disukai?: boolean; komentar?: number; hapus?: boolean; visibilitas?: Visibilitas; bolehUnduh?: boolean }) => void;
}) {
  const refDalam = useRef<HTMLUListElement>(null);
  const ref = gridRef || refDalam;
  const [panelPost, setPanelPost] = useState<MediaPublik | null>(null);
  /* Masonry layar sempit (<= 900): item nurut rasio asli (bukan
     span baris) + packing rapat (span 6px dari PemilihGrid). Nyala
     kalau layar sempit + mode masonry; ke-refresh pas mode ganti
     atau layar diresize. Di-init LANGSUNG dari matchMedia (bukan
     false->effect) biar render pertama ny udah bener: rasio server
     nempel duluan, gak ada frame placeholder 150px->rasio (loncat).
     Aman buat SSR: daftar selalu kosong pas render server (data
     dateng dari fetch client), jadi gak pernah ada markup beda. */
  const [masonryHP, setMasonryHP] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width:900px)").matches && modeGridSekarang() === "masonry"
  );
  const { masuk, pengguna } = useSesi();
  const sentuh = useRef(false);
  const tipePointer = useRef("");
  const n = Math.min(daftar.length, 5);

  useEffect(() => {
    sentuh.current = window.matchMedia("(pointer: coarse)").matches;
    tipePointer.current = sentuh.current ? "touch" : "mouse";
    const on = (e: PointerEvent) => {
      tipePointer.current = e.pointerType;
    };
    addEventListener("pointerdown", on, { capture: true, passive: true });
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".thumb")) matikanAktifLain(null);
    };
    document.addEventListener("click", onClick);
    return () => {
      removeEventListener("pointerdown", on, { capture: true });
      document.removeEventListener("click", onClick);
    };
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ul = ref.current;
    if (!ul) return;
    let bersihIO: (() => void) | undefined;
    const items = [...ul.querySelectorAll<HTMLElement>("li")];
    /* Scroll reveal: item muncul (fade-in ringan) pas masuk
       viewport, sekali doang. Stagger ny kecil (modulo) biar item
       yang jauh di bawah gak nunggu delay panjan pas discroll.
       Ruang ny udah kejatah dari baris grid + aspect ratio, jadi
       gak ada layout loncat. */
    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("on"));
    } else {
      items.forEach((el, i) => {
        if (el.classList.contains("on")) return;
        el.classList.add("masuk");
        el.style.setProperty("--lambat", (i % 5) * 55 + "ms");
      });
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              en.target.classList.add("on");
              io.unobserve(en.target);
            }
          });
        },
        { rootMargin: "0px 0px -4% 0px" }
      );
      items.forEach((el) => io.observe(el));
      bersihIO = () => io.disconnect();
    }
    /* Rasio-asli nempel di .thumb. Sumberny data-rasio dari SERVER
       (dimensi asli, kebaca dari <li data-rasio>) kalau ada, jadi
       tinggi udah kejatah SEBELUM gambar muat (gak loncat); kelas
       .jatah matiin min-height placeholder ny. Kalau server gak punya
       dimensi (null), dataset keisi belakangan pas onLoad
       (catatRasio) dan perilaku lama ny tetep jalan.
       Nempel ny di .thumb (bukan li) biar bar aksi gak makan bagian
       rasio foto ny. Terus span masonry (packing rapat) dihitung
       ulang abis rasio kepasang. */
    const perluRasio = n <= 4 || masonryHP;
    ul.querySelectorAll<HTMLElement>("li").forEach((el) => {
      const r = parseFloat(el.dataset.rasio || "");
      const tombol = el.querySelector<HTMLElement>(".thumb");
      if (!tombol) return;
      if (perluRasio && isFinite(r) && r > 0.05) {
        tombol.style.aspectRatio = String(r);
        tombol.classList.add("jatah");
      } else if (!perluRasio) {
        tombol.style.aspectRatio = "";
        tombol.classList.remove("jatah");
      }
    });
    if (masonryHP) susunUlangMasonry(ul);
    return bersihIO;
  }, [daftar, ref, n, masonryHP]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width:900px)");
    const cek = () => setMasonryHP(mq.matches && modeGridSekarang() === "masonry");
    cek();
    mq.addEventListener("change", cek);
    window.addEventListener("grid:ubah", cek);
    return () => {
      mq.removeEventListener("change", cek);
      window.removeEventListener("grid:ubah", cek);
    };
  }, []);

  /* Suka optimistic (r19): ikon + angka langsung ganti, POST di
     belakang; gagal/timeout 6 detik -> balik ke keadaan semula.
     KisiMedia ny render dari state induk (media.suka), makany
     prediksi ny dikirim lewat onUbah juga. Panel post yang kebuka
     ikut sinkron. */
  async function suka_(m: MediaPublik) {
    if (!masuk) {
      bukaPintu();
      return;
    }
    const sebelum = { jumlah: m.suka, aku: m.disukai };
    const prediksi = { jumlah: sebelum.jumlah + (sebelum.aku ? -1 : 1), aku: !sebelum.aku };
    onUbah(m.id, { suka: prediksi.jumlah, disukai: prediksi.aku });
    if (panelPost && panelPost.id === m.id) setPanelPost((p) => (p ? { ...p, suka: prediksi.jumlah, disukai: prediksi.aku } : p));
    mainkanSfx(prediksi.aku ? "digital-burst" : "ui-dissolve");
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch("/api/media/" + m.id + "/suka", { method: "POST", signal: ctrl.signal });
      if (r.status === 401) {
        tolakSesi();
        throw new Error();
      }
      if (!r.ok) throw new Error();
      const d = await r.json();
      onUbah(m.id, { suka: d.suka, disukai: d.disukai });
      if (panelPost && panelPost.id === m.id) setPanelPost((p) => (p ? { ...p, suka: d.suka, disukai: d.disukai } : p));
    } catch {
      onUbah(m.id, { suka: sebelum.jumlah, disukai: sebelum.aku });
      if (panelPost && panelPost.id === m.id) setPanelPost((p) => (p ? { ...p, suka: sebelum.jumlah, disukai: sebelum.aku } : p));
      mainkanSfx("failure");
    } finally {
      clearTimeout(timer);
    }
  }

  function bukaMedia(m: MediaPublik, b: HTMLButtonElement) {
    if ((sentuh.current || tipePointer.current === "touch") && !b.classList.contains("aktif")) {
      matikanAktifLain(b);
      b.classList.add("aktif");
      return;
    }
    matikanAktifLain(null);
    setPanelPost(m);
  }

  if (!daftar.length) return null;

  /* Ref callback: <ul> muncul belakangan (habis data kebaca), jadi
     dia ny daftar sendiri ke sistem mode grid pas elemen ny kebikin.
     Tanpa ini mode bento/masonry gak pernah ketulis ke data-grid. */
  const tunjukRef = (el: HTMLUListElement | null) => {
    const lama = ref.current;
    if (lama && lama !== el) lepasGrid(lama);
    ref.current = el;
    if (el) pasangGrid(el);
  };

  return (
    <>
      <ul className="grid" ref={tunjukRef} data-n={n}>
        {daftar.map((m) => (
          <Kartu key={m.id} media={m} rasioInline={n <= 4 || masonryHP} onBuka={bukaMedia} onSuka={suka_} onPost={setPanelPost} />
        ))}
      </ul>
        {panelPost && <PanelPost media={panelPost} onTutup={() => setPanelPost(null)} onUbah={(id, u) => {
          /* Salinan panel ikut ke-update (badge privasi/dll) sebelum
             diterusin ke induk (yang mungkin ngefilter itemny keluar). */
          setPanelPost((p) => (p && p.id === id ? { ...p, ...(u.visibilitas ? { visibilitas: u.visibilitas } : {}), ...(u.suka != null ? { suka: u.suka, disukai: u.disukai } : {}), ...(u.komentar != null ? { komentar: u.komentar } : {}) } : p));
          onUbah(id, u);
        }} />}
    </>
  );
}

function Kartu({
  media,
  rasioInline,
  onBuka,
  onSuka,
  onPost,
}: {
  media: MediaPublik;
  rasioInline: boolean;
  onBuka: (m: MediaPublik, b: HTMLButtonElement) => void;
  onSuka: (m: MediaPublik) => void;
  onPost: (m: MediaPublik) => void;
}) {
  const liRef = useRef<HTMLLIElement>(null);
  const bRef = useRef<HTMLButtonElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const nomor = media.judul || media.nama;
  /* r30: siapa yang liat kartu ini (buat izin unduhan — pemilik
     post selalu boleh unduh walau izin ny mati). */
  const { pengguna } = useSesi();

  function onLoad() {
    const img = imgRef.current;
    const b = bRef.current;
    const li = liRef.current;
    if (!img || !b || !li) return;
    img.classList.add("ok");
    b.classList.add("loaded");
    if (img.naturalWidth && img.naturalHeight) {
      const rasio = img.naturalWidth / img.naturalHeight;
      catatRasio(li, rasio);
      /* Media dikit atau masonry HP: kotak thumb nurut rasio asli
         foto (bukan dipaksa tinggi baris), jadi gak ada crop/blank
         aneh-aneh. Mode laen: inline ny gak ngaruh (flex nge-fill). */
      const ul = li.closest<HTMLUListElement>("ul.grid");
      if (ul && ul.dataset.n && (ul.dataset.n !== "5" || rasioInline)) b.style.aspectRatio = String(rasio);
    }
  }

  return (
    <li ref={liRef} data-rasio={media.rasio != null ? String(media.rasio) : undefined}>
      <button
        ref={bRef}
        type="button"
        className={"thumb" + (rasioInline && media.rasio != null ? " jatah" : "")}
        style={rasioInline && media.rasio != null ? { aspectRatio: String(media.rasio) } : undefined}
        data-sfx="data-load"
        aria-label={"Buka post " + (media.jenis === "video" ? "video" : "foto") + " " + nomor}
        onClick={() => bRef.current && onBuka(media, bRef.current)}
      >
        <span className="thumb-inner">
          <img
            ref={imgRef}
            src={media.pratinjau}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={onLoad}
            onError={() => bRef.current?.classList.add("broken")}
          />
          {media.jenis === "video" && (
            <span className="badge-video" aria-hidden="true">
              <PlayIkon />
              video
            </span>
          )}
          {(media.item?.length || 1) > 1 && (
            <span className="badge-multi" aria-hidden="true">
              <FotoIkon ukuran={11} />
              {media.item!.length}
            </span>
          )}
          <span className="pasak" aria-hidden="true" />
        </span>
        <span className="media-bar">
          <span className="mb-ikon" aria-hidden="true">
            <FotoIkon />
          </span>
          <span className="mb-teks">{nomor}</span>
          {media.user && (
            <span className="mb-user">
              {sebutanUser(media.user)}
              {media.user.verified && <LencanaVerified />}
            </span>
          )}
          <span className="mb-no">{ukuranSingkat(media.ukuran)}</span>
        </span>
        <span className="err">{media.nama} tidak ditemukan</span>
      </button>
      <div className="aksi-bar">
        <button
          type="button"
          className={"ab-btn suka" + (media.disukai ? " aktif" : "")}
          onClick={() => onSuka(media)}
          aria-pressed={media.disukai}
          aria-label={media.disukai ? "Batal suka " + nomor : "Suka " + nomor}
        >
          {media.disukai ? <SukaPenuhIkon ukuran={14} /> : <SukaOutlineIkon ukuran={14} />}
          <span>{media.suka}</span>
        </button>
        <button type="button" className="ab-btn" data-sfx="data-load" onClick={() => onPost(media)} aria-label={"Buka komentar " + nomor}>
          <KomentarAsetIkon ukuran={14} />
          <span>{media.komentar}</span>
        </button>
        {/* r30: unduhan kartu nurut izin — pemilik post selalu boleh,
            orang lain cuma kalo uploader ny ngizinin (server ny juga
            ngecek endpoint ny, ini cuma pintu UI ny). */}
        {(media.bolehUnduh !== false || (pengguna && media.user?.id === pengguna.id)) && (
          <a className="ab-unduh" href={media.file + "?unduh=1"} aria-label={"Unduh " + media.nama} title={"Unduh " + media.nama}>
            <BesarIkon />
          </a>
        )}
      </div>
    </li>
  );
}
