"use client";

/* /post/[id] (r28): halaman detail SATU post — canonical URL buat
   "Salin link". Reuse PanelPost (panel detail + komentar + aksi) persis
   kayak dibuka dari grid, jadi semua perilaku (suka, komentar, privasi,
   view count) JALAN SAMA di direct URL dan di grid. Tutup panel =
   balik ke galeri (bukan history.back — biar deterministic). */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PanelPost from "@/components/PanelPost";
import { Panah } from "@/components/ikon";
import type { MediaPublik } from "@/lib/tipe-media";

export default function HalamanPost({ id }: { id: string }) {
  const router = useRouter();
  const [media, setMedia] = useState<MediaPublik | null>(null);
  const [galat, setGalat] = useState("");

  useEffect(() => {
    let hidup = true;
    (async () => {
      try {
        const r = await fetch("/api/media/" + encodeURIComponent(id), {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        const d = await r.json().catch(() => ({}));
        if (!hidup) return;
        if (!r.ok) {
          setGalat(d.galat || "Post ny gak ketemu.");
          return;
        }
        setMedia(d.media as MediaPublik);
      } catch {
        if (hidup) setGalat("Gak nyambung ke server.");
      }
    })();
    return () => {
      hidup = false;
    };
  }, [id]);

  if (media) {
    return (
      <>
        {/*
          PanelPost ny overlay fixed — key per media.id biar navigasi
          antar post (lewat notifikasi/dll) selalu remount bersih.
          onUbah no-op: halaman ini gak punya daftar grid yang perlu
          sinkron (aksi hapus = nutup panel).
        */}
        <PanelPost
          key={media.id}
          media={media}
          onTutup={() => router.push("/galeri")}
          onUbah={() => {}}
        />
      </>
    );
  }

  return (
    <section className="head">
      <h1 className="masuk on">Post</h1>
      {galat ? (
        <>
          <p className="lede">{galat}</p>
          <p style={{ marginTop: 16 }}>
            <Link className="btn" href="/galeri">
              Balik ke galeri
              <Panah />
            </Link>
          </p>
        </>
      ) : (
        <p className="lede" aria-busy="true">
          Muat post ny...
        </p>
      )}
    </section>
  );
}
