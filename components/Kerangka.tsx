"use client";

/* Kerangka halaman: masthead (brand + menu utama + kontrol) + footer
   + efek. Dipasang sekali di layout, jadi pindah halaman gak bikin
   kursor/noise ke-reset. Menu utama (Utama/Galeri/Fitur) tetep di
   bagian atas kayak sedia kala; menu samping (menu.svg) jadi menu
   tambahan buat akun + jelajah. Pintu login global tetep dari sini.

   r27 / P3-12: link menu utama dapet interaksi hover ripple yang
   SUMBERNYA dari titik masuk kursor (masuk dari atas = membesar dari
   atas, dari kanan = dari kanan). Efekny cuma di link yang di-hover,
   ke-clip di kotak link ny sendiri, layer ny pointer-events:none —
   gak ganggu klik + gak nyebar ke navigator laen. Desktop doang
   (hover stabil); reduced-motion dimatiin dari CSS. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import LatarKursor from "@/components/efek/LatarKursor";
import PenampilMount from "@/components/efek/Penampil";
import GulirBar from "@/components/efek/GulirBar";
import TemaToggle from "@/components/TemaToggle";
import SuaraBtn from "@/components/SuaraBtn";
import PusatNotifikasi from "@/components/PusatNotifikasi";
import MenuSisa from "@/components/MenuSisa";
import ChatPribadi from "@/components/ChatPribadi";
import PintuGlobal from "@/components/PintuLogin";
import { Merek } from "@/components/ikon";
import { pasangJaringan } from "@/lib/jaringan";
import { bangunkanEmoji } from "@/lib/emoji-font";

const MENU = [
  { href: "/", label: "Utama", cocok: (p: string) => p === "/" },
  { href: "/galeri", label: "Galeri", cocok: (p: string) => p.startsWith("/galeri") },
  { href: "/fitur", label: "Fitur", cocok: (p: string) => p.startsWith("/fitur") },
  { href: "/dashboard", label: "Leaderboard", cocok: (p: string) => p.startsWith("/dashboard") },
];

/* Satu link menu + ripple dari titik masuk pointer. Titikny disimpen
   di CSS custom property --masuk-x/y; animasiny nyala lewat kelas
   .riak yang dicopot abis animasiny kelar (timer). */
function MenuLink({ href, label, aktif }: { href: string; label: string; aktif: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const timer = useRef(0);

  function riak(e: React.PointerEvent) {
    const a = ref.current;
    if (!a || e.pointerType !== "mouse") return;
    const kotak = a.getBoundingClientRect();
    a.style.setProperty("--masuk-x", e.clientX - kotak.left + "px");
    a.style.setProperty("--masuk-y", e.clientY - kotak.top + "px");
    a.classList.remove("riak");
    /* reflow dikit biar animasi bisa muter ulang pas masuk-masuk
       cepet; ini efek visual murni, bukan race-fix layout. */
    void a.offsetWidth;
    a.classList.add("riak");
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => a.classList.remove("riak"), 700);
  }

  return (
    <Link ref={ref} href={href} aria-current={aktif ? "page" : undefined} onPointerEnter={riak}>
      {label}
    </Link>
  );
}

const KAKI: Record<string, string> = {
  beranda: "Neyhra Playground.",
  galeri:
    "Klik foto untuk memperbesar. Pakai panah kiri kanan untuk berpindah, scroll atau plus minus untuk zoom, Esc untuk tutup. Di HP: tap sekali buat lihat judulny, tap lagi buat buka.",
  fitur: "donlotny diproses langsung di browser, file ny gak lewat server gw jd privasi aman bossss.",
  sfile: "sfile ny ngelewatin server gw dikit (biar lolos proteksi CDN ny), sisany tetep urusan browser lu.",
  ai: "Obrolan lu ama Ney disimpen di browser lu sendiri, gak ada yang lain yang baca aman ajah.",
  obrolan: "Chat Global kesimpen di server ygy bukan di hape lu kampank",
  profil: "Profil cuma nampilin nama, foto, sama post galeri ny. Sandi lu gak keliatan di mana-mana.",
  pengaturan: "Preferensi tema + suara kesimpen di browser lu sendiri, gak dikirim ke mana-mana.",
  akinator: "Game ny jalan di server akinator.com (asli), sesi ny disimpen sejenak di server gw, gak ada data lo yang lain yang ikut.",
  amv2: "Generator V2 ny jalan di server: email sementara + hasil ny disimpen ke akun lu, cuma lu yang bisa buka lagi.",
  editgambar: "Foto ny diproses di server, hasil + riwayat ny nempel ke akun lu. Satu proses jalan pada satu waktu.",
  leaderboard: "Skor disusun dari game Akinator yang selesai — nama lo cuma nempel kalau lo main sampe kelar (kena, nyerah, atau milih).",
  admin: "Dashboard owner: ngatur verified, post, sama user. Gak ada orang lain yang bisa buka.",
};

function kakiRute(p: string): string {
  if (p.startsWith("/admin")) return KAKI.admin;
  if (p.startsWith("/fitur/sfile")) return KAKI.sfile;
  if (p.startsWith("/fitur/ai")) return KAKI.ai;
  if (p.startsWith("/fitur/am-premium-v2")) return KAKI.amv2;
  if (p.startsWith("/fitur/edit-gambar")) return KAKI.editgambar;
  if (p.startsWith("/fitur/obrolan")) return KAKI.obrolan;
  if (p.startsWith("/fitur/akinator")) return KAKI.akinator;
  if (p.startsWith("/dashboard")) return KAKI.leaderboard;
  if (p.startsWith("/fitur")) return KAKI.fitur;
  if (p.startsWith("/galeri")) return KAKI.galeri;
  if (p.startsWith("/profil")) return KAKI.profil;
  if (p.startsWith("/pengaturan")) return KAKI.pengaturan;
  return KAKI.beranda;
}

export default function Kerangka({ children }: { children: React.ReactNode }) {
  const rute = usePathname() || "/";

  useEffect(() => {
    /* Sesi + pemulihan jaringan (P0-1): cek sesi di boot, terus
       otomatis nyoba ulang pas online/bfcache-resume dengan backoff.
       Kerangka gak pernah unmount, jadi listener ny seumur app. */
    pasangJaringan();
    /* Custom emoji default OFF; kalo user pernah nyala-in, font ny
       diaktifkan dari cache di sini (gak nyentuh jalur render, gak
       ngeblok apa pun: ini efek samping yang asinkron). */
    bangunkanEmoji();
  }, []);

  return (
    <div className="lapis-isi">
      <header className="masthead">
        <Link className="brand" href="/">
          <Merek />
          Neyhra Playground
        </Link>
        <nav className="menu" aria-label="Menu utama">
          <ul>
            {MENU.map((m) => (
              <li key={m.href}>
                <MenuLink href={m.href} label={m.label} aktif={m.cocok(rute)} />
              </li>
            ))}
          </ul>
        </nav>
        <div className="aksi-kepala">
          <TemaToggle />
          <SuaraBtn />
          {/* Mail (r28): cuma buat yang login — urutan resmi:
              backsound -> mail -> menu. */}
          <PusatNotifikasi />
          <MenuSisa />
        </div>
      </header>

      <main className="page">{children}</main>

      <footer className="site-foot">
        <p>{kakiRute(rute)}</p>
      </footer>

      <LatarKursor />
      <PenampilMount />
      <GulirBar />
      <PintuGlobal />
      {/* Chat pribadi (r32): overlay global — dibuka dari menu samping
          atau tombol Chat di profil teman, gak nempel route apa pun. */}
      <ChatPribadi />
    </div>
  );
}
