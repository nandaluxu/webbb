"use client";

/* Menu samping: navigasi utama situs (dibuka dari kanan). Isi ny:
   PFP + nama + badge terverifikasi di atas, terus menu akun (Profil,
   Pengaturan, Chat pribadi, Dashboard khusus owner, Keluar), dan
   menu halaman (Utama, Galeri, Fitur). Tutup pake Esc, klik backdrop,
   atau tombol X. Fokus dijaga di dalam panel biar Tab gak nyasar ke
   belakang. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIkon, OrangIkon, TutupIkon, LencanaVerified, PanahKeluar } from "@/components/ikon";
import { useSesi, bukaPintu, keluar } from "@/lib/sesi-pengguna";
import { bukaChat } from "@/lib/chat-pribadi";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";

const HALAMAN = [
  { href: "/", label: "Utama", cocok: (p: string) => p === "/" },
  { href: "/galeri", label: "Galeri", cocok: (p: string) => p.startsWith("/galeri") },
  { href: "/fitur", label: "Fitur", cocok: (p: string) => p.startsWith("/fitur") },
  { href: "/dashboard", label: "Leaderboard", cocok: (p: string) => p.startsWith("/dashboard") },
];

export default function MenuSisa() {
  const rute = usePathname() || "/";
  const { siap, masuk, pengguna } = useSesi();
  const [buka, setBuka] = useState(false);
  /* Badge chat pribadi (r32): jumlah pesan teman yang belum dibaca.
     Diambil pas menu kebuka + disegarkan tiap panel chat ny ngasih
     kabar (event "cp:perbarui" dari komponen ChatPribadi). */
  const [belumBaca, setBelumBaca] = useState(0);
  const tombolRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tutupRef = useRef<HTMLButtonElement>(null);

  /* Angka belum-baca ny ikut menu (bukan cuma pas panel chat kebuka). */
  useEffect(() => {
    if (!masuk) {
      setBelumBaca(0);
      return;
    }
    const ambil = () => {
      fetch("/api/teman?ringkas=1", { cache: "no-store", signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => setBelumBaca(d.jumlahBelumBaca ?? 0))
        .catch(() => {});
    };
    ambil();
    window.addEventListener("cp:perbarui", ambil);
    return () => window.removeEventListener("cp:perbarui", ambil);
  }, [masuk]);

  useEffect(() => {
    if (!buka) return;
    const t = setTimeout(() => tutupRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        mainkanSfx("ui-dissolve");
        setBuka(false);
        tombolRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const fokus = [...panelRef.current.querySelectorAll<HTMLElement>("a,button,input,[tabindex]:not([tabindex='-1'])")].filter(
        (el) => !el.hasAttribute("disabled")
      );
      if (!fokus.length) return;
      const awal = fokus[0];
      const akhir = fokus[fokus.length - 1];
      if (e.shiftKey && document.activeElement === awal) {
        e.preventDefault();
        akhir.focus();
      } else if (!e.shiftKey && document.activeElement === akhir) {
        e.preventDefault();
        awal.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    kunciGulir();
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      bukaKunciGulir();
    };
  }, [buka]);

  /* Navigasi dari drawer nutup lewat onClick tiap link (fungsi tutup
     di bawah), jadi gak butuh efek yang ngeintip perubahan rute. */

  function buka_() {
    setBuka(true);
  }

  function tutup() {
    setBuka(false);
    tombolRef.current?.focus();
  }

  return (
    <>
      <button
        type="button"
        ref={tombolRef}
        className="tema-toggle menu-btn"
        aria-expanded={buka}
        aria-controls="menu-sisa"
        aria-label="Buka menu"
        data-sfx={buka ? "ui-dissolve" : "ui-menu"}
        onClick={buka_}
      >
        <MenuIkon ukuran={20} />
      </button>

      {buka && (
        <div
          className="sisa-lapis"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              mainkanSfx("ui-dissolve");
              tutup();
            }
          }}
        >
          <div
            id="menu-sisa"
            ref={panelRef}
            className="sisa-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <button type="button" ref={tutupRef} className="post-tutup sisa-tutup" data-sfx="ui-dissolve" aria-label="Tutup menu" onClick={tutup}>
              <TutupIkon />
            </button>

            {masuk && pengguna ? (
              <Link className="sisa-user" href="/profil" onClick={tutup}>
                {pengguna.pfp ? (
                  <img
                    src={"/api/pfp/" + pengguna.id + "?v=" + encodeURIComponent(pengguna.pfp)}
                    alt=""
                    width={56}
                    height={56}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="sisa-inisial" aria-hidden="true">
                    <OrangIkon ukuran={26} />
                  </span>
                )}
                <span className="sisa-identitas">
                  <b>
                    {pengguna.nama}
                    {pengguna.verified && <LencanaVerified />}
                  </b>
                  <span>
                    {pengguna.username ? "@" + pengguna.username + " · " : ""}
                    {pengguna.jenis === "anonim" ? "Akun anonim" : "Akun ber-sandi"}
                  </span>
                </span>
              </Link>
            ) : (
              <div className="sisa-user">
                <span className="sisa-inisial" aria-hidden="true">
                  <OrangIkon ukuran={26} />
                </span>
                <span className="sisa-identitas">
                  <b>{siap ? "Belum masuk" : "..."}</b>
                  <span>Browsing sebagai tamu</span>
                </span>
              </div>
            )}

            <ul className="sisa-nav">
              {masuk && (
                <>
                  <li>
                    <Link href="/profil" onClick={tutup} aria-current={rute.startsWith("/profil") ? "page" : undefined}>
                      Profil
                    </Link>
                  </li>
                  <li>
                    <Link href="/pengaturan" onClick={tutup} aria-current={rute.startsWith("/pengaturan") ? "page" : undefined}>
                      Pengaturan
                    </Link>
                  </li>
                </>
              )}
              {/* Chat pribadi (r32): DI BAWAH Pengaturan, sesuai
                  permintaan — bukan di header. Keliatan buat tamu
                  juga: diklik -> gerbang login (fitur ny gak
                  ngumpet, tapi tetep login-gated). */}
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        tutup();
                        bukaChat();
                      }}
                    >
                      Chat pribadi
                      {belumBaca > 0 && (
                        <span className="sisa-badge" aria-label={belumBaca + " pesan belum dibaca"}>
                          {belumBaca > 99 ? "99+" : belumBaca}
                        </span>
                      )}
                    </button>
                  </li>
              {masuk && (
                <>
                  {pengguna?.admin && (
                    <li>
                      <Link href="/admin" onClick={tutup} aria-current={rute.startsWith("/admin") ? "page" : undefined}>
                        Dashboard Admin
                      </Link>
                    </li>
                  )}
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        tutup();
                        keluar();
                      }}
                    >
                      Keluar
                      <PanahKeluar />
                    </button>
                  </li>
                </>
              )}
              {!masuk && siap && (
                <li>
                  <button type="button" onClick={() => { tutup(); bukaPintu(); }}>
                    Masuk
                  </button>
                </li>
              )}
            </ul>

            <p className="sisa-label">Jelajah</p>
            <ul className="sisa-nav sisa-nav-dua">
              {HALAMAN.map((m) => (
                <li key={m.href}>
                  <Link href={m.href} onClick={tutup} aria-current={m.cocok(rute) ? "page" : undefined}>
                    {m.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
