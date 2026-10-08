"use client";

/* Beranda: intro + daftar menu + kartu sosmed di bawah (permintaan
   pemilik: sosmed nempel di menu utama, bukan di halaman lain). */

import { useEffect } from "react";
import Link from "next/link";
import { Panah, PanahKeluar, AsetIkon, WhatsAppIkon } from "@/components/ikon";

const SOSMED = [
  {
    nama: "YouTube",
    tampil: "@rewsyu",
    href: "https://www.youtube.com/@rewsyu",
    ikon: <AsetIkon nama="youtube" ukuran={24} />,
  },
  {
    nama: "Instagram",
    tampil: "@nandalemao",
    href: "https://www.instagram.com/nandalemao/",
    ikon: <AsetIkon nama="instagram" ukuran={24} />,
  },
  {
    nama: "Facebook",
    tampil: "nanda.icikiwir",
    href: "https://www.facebook.com/nanda.icikiwir.905084/",
    ikon: <AsetIkon nama="facebook" ukuran={24} />,
  },
  {
    /* WhatsApp: ganti href di bawah sama link WA ny, sisany biarin aja. */
    nama: "WhatsApp",
    tampil: "wa.me/6285760175216",
    href: "https://wa.me/6285760175216",
    ikon: <WhatsAppIkon />,
  },
];

export default function Beranda() {
  /* Baris daftar + kartu sosmed muncul satu-satu pas masuk layar. */
  useEffect(() => {
    const el = document.querySelectorAll<HTMLElement>(".toc .masuk, .sos .masuk");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.forEach((item, i) => {
      if (reduce) {
        item.classList.add("on");
        return;
      }
      item.style.setProperty("--lambat", 120 + i * 110 + "ms");
      requestAnimationFrame(() => requestAnimationFrame(() => item.classList.add("on")));
    });
  }, []);

  return (
    <>
      <section className="intro">
        <h1>
          <span className="garis">
            <span className="isi">Hi,</span>
          </span>
          <span className="garis">
            <span className="isi">My Nama gw Neyhra.</span>
          </span>
        </h1>
        <p className="lede lede-fade">
          Welkam di web testing gw, disini kalian bisa lihat galeri(isiny cm ppcp sih wkwk), nyari foto di Pinterest, donlot vid
          TikTok sama Instagram, atau ngobrol di chat hahay.
        </p>
      </section>

      <nav className="toc" id="toc" aria-label="Menu utama">
        <h2>Lihat apa yang ada</h2>
        <ol>
          <li className="masuk">
            <span className="no" aria-hidden="true">
              01
            </span>
            <div>
              <h3>Arsip Foto</h3>
              <p>Lihat koleksi foto yang gw simpen, gatau sih buat apa juga wkwk.</p>
            </div>
            <Link href="/galeri">
              Masuk galeri
              <Panah />
            </Link>
          </li>
          <li className="masuk">
            <span className="no" aria-hidden="true">
              02
            </span>
            <div>
              <h3>Fitur</h3>
              <p>
                Unduh vt, reels, foto IG, nyari foto Pinterest, sampai ngobrol bareng AI gw dan orang lain di chat
                global.
              </p>
            </div>
            <Link href="/fitur">
              Buka fitur
              <Panah />
            </Link>
          </li>
          <li className="masuk">
            <span className="no" aria-hidden="true">
              03
            </span>
            <div>
              <h3>Tic Tac Toe</h3>
              <p>
                Iseng dikit? Sembilan kotak siap main: lawan CPU minimax (level sempurnany gak bisa dikalahkan), dua
                orang gantian satu HP, atau bikin room online pake kode.
              </p>
              {/* Papan mini teaser — goresanny muter pelan sendiri (CSS),
                  statis kalau reduced-motion. Link masuk game di kanan. */}
              <span className="toc-ttt" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <svg className="p1" viewBox="0 0 100 100">
                  <path d="M22 22 78 78" pathLength={1} />
                  <path d="M78 22 22 78" pathLength={1} />
                </svg>
                <svg className="p2" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="33" pathLength={1} />
                </svg>
                <svg className="p3" viewBox="0 0 100 100">
                  <path d="M22 22 78 78" pathLength={1} />
                  <path d="M78 22 22 78" pathLength={1} />
                </svg>
              </span>
            </div>
            <Link href="/fitur/tictactoe">
              Masuk game
              <Panah />
            </Link>
          </li>
        </ol>
      </nav>

      <section className="sos" id="sos" aria-labelledby="sosJudul">
        <h2 id="sosJudul">Sosmed gw</h2>
        <ul className="sos-grid">
          {SOSMED.map((s) => (
            <li key={s.nama} className="masuk">
              <a className="kartu-sos" href={s.href} target="_blank" rel="noopener">
                <span className="sos-ikon" aria-hidden="true">
                  {s.ikon}
                </span>
                <span className="sos-badan">
                  <b>{s.nama}</b>
                  <span>{s.tampil}</span>
                </span>
                <span className="sos-panah" aria-hidden="true">
                  <PanahKeluar />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
