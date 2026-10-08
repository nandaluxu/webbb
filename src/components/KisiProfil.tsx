"use client";

/* KisiProfil: grid post khusus halaman profil (3 kolom, thumb 4:5,
   crop cover). Beda sama grid galeri (KisiMedia): gak ikut mode
   masonry/dua/tiga/baris, gak ada bar aksi per kartu, gak ada layout
   khusus media-dikit. Semua post selalu sel 4:5 yang sama -> grid
   ny solid: tinggi item konsisten, gak ada yang nyangkut di garis
   atau keluar container. Ukuran (jumlah post 1/2/6+) nurut grid
   naturalny, gak diatur-atur khusus.

   Klik kartu buka PanelPost (detail + komentar): file asli tetep
   cuma kebuka lewat "Lihat asli" di dalem panel (rasio original,
   gak kena crop 4:5 ny). Thumbnail cuma tampilan.

   Lazy: img loading=lazy + ruang udah kejatah dari aspect-ratio 4:5,
   jadi layout gak loncat. Belum kebaca -> placeholder shimmer;
   abis kebaca -> fade-in + skala turun dikit (feedback yang
   kerasain tapi halus). Reveal per item pas masuk viewport. */

import { useEffect, useRef, useState } from "react";
import { SukaPenuhIkon, KomentarAsetIkon, PlayIkon } from "@/components/ikon";
import PanelPost from "@/components/PanelPost";
import type { MediaPublik, Visibilitas } from "@/lib/tipe-media";

export default function KisiProfil({
  daftar,
  onUbah,
}: {
  daftar: MediaPublik[];
  onUbah: (id: string, ubah: { suka?: number; disukai?: boolean; komentar?: number; hapus?: boolean; visibilitas?: Visibilitas; bolehUnduh?: boolean }) => void;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [panelPost, setPanelPost] = useState<MediaPublik | null>(null);

  useEffect(() => {
    const ul = ref.current;
    if (!ul) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const items = [...ul.querySelectorAll<HTMLElement>("li")];
    /* Reveal per item (sekali doang) pas masuk viewport. Stagger kecil
       biar baris pertama gak pindah barengan persis. */
    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("on"));
      return;
    }
    items.forEach((el, i) => {
      if (el.classList.contains("on")) return;
      el.classList.add("masuk");
      el.style.setProperty("--lambat", (i % 3) * 60 + "ms");
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
    return () => io.disconnect();
  }, [daftar]);

  function bukaMedia(m: MediaPublik) {
    setPanelPost(m);
  }

  if (!daftar.length) return null;

  return (
    <>
      <ul className="grid-profil" ref={ref}>
        {daftar.map((m) => (
          <KartuProfil key={m.id} media={m} onBuka={bukaMedia} />
        ))}
      </ul>
      {panelPost && (
        <PanelPost
          media={panelPost}
          onTutup={() => setPanelPost(null)}
          onUbah={(id, u) => {
            /* salinan panel ikut sinkron (badge privasi) sebelum
               diterusin ke induk */
            setPanelPost((p) => (p && p.id === id ? { ...p, ...(u.visibilitas ? { visibilitas: u.visibilitas } : {}) } : p));
            onUbah(id, u);
          }}
        />
      )}
    </>
  );
}

/* Satu kartu profil. Sumber gambarnya baru ditaruh PAS kartu ny
   mendekat viewport (IO, jarak pandang 600px): lebih ketat dari
   lazy native browser yang marginny gede, jadi media yang jauh
   bener-bener gak dimuat dulu (bukan cuma animasi). Sebelum ny:
   placeholder shimmer di sel 4:5 yang ruangny udah kejatah
   (layout gak loncat). */
function KartuProfil({ media, onBuka }: { media: MediaPublik; onBuka: (m: MediaPublik) => void }) {
  /* Browser lawas tanpa IO: langsung siap dari awal (gak ada cara
     nunda ny). Komponen ini cuma kebikin di client abis data kebaca,
     jadi gak ada jalur SSR yang kena. */
  const [siap, setSiap] = useState(() => typeof IntersectionObserver === "undefined");
  const liRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const li = liRef.current;
    if (!li || siap || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            setSiap(true);
            io.disconnect();
          }
        });
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(li);
    return () => io.disconnect();
  }, [siap]);

  return (
    <li ref={liRef}>
      <button
        type="button"
        className="pp-kartu"
        onClick={() => onBuka(media)}
        aria-label={"Buka post " + (media.jenis === "video" ? "video" : "foto") + " " + (media.judul || media.nama)}
      >
        <span className="pp-media">
          {siap ? (
            <img
              src={media.pratinjau}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={(e) => {
                const b = e.currentTarget.closest(".pp-kartu");
                e.currentTarget.classList.add("ok");
                b?.classList.add("loaded");
              }}
              onError={(e) => e.currentTarget.closest(".pp-kartu")?.classList.add("broken")}
            />
          ) : (
            <span className="pp-tunggu" aria-hidden="true" />
          )}
          {media.jenis === "video" && (
            <span className="pp-video" aria-hidden="true">
              <PlayIkon ukuran={11} />
              video
            </span>
          )}
          <span className="pasak" aria-hidden="true" />
          <span className="pp-err" role="img" aria-label="Media rusak">
            {media.nama}
          </span>
        </span>
        <span className="pp-kepo" aria-hidden="true">
          <span className="pp-kepo-item">
            <SukaPenuhIkon ukuran={12} />
            <b>{media.suka}</b>
          </span>
          <span className="pp-kepo-item">
            <KomentarAsetIkon ukuran={12} />
            <b>{media.komentar}</b>
          </span>
        </span>
      </button>
    </li>
  );
}
