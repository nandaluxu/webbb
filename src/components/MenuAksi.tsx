"use client";

/* MenuAksi: menu aksi kontekstual yang dipake bareng sama-sama oleh
   pesan chat (long-press / klik kanan), komentar, dan menu titik-tiga
   post. SATU implementasi, bukan tiga-tigany.

   - Buka di posisi layar (x, y) dari pointer, dijepit biar gak keluar
     viewport.
   - Nutup: klik di luar, Esc, atau abis item kepilih.
   - Keyboard: panah atas/bawah jalan dari handler document (Enter
     milih, Esc nutup, fokus balik ke elemen pembuka). Fokus item
     cuma pindah pas NAVIGASI panah — pas menu baru kebuka fokus ny
     di container, jadi (desktop) semua item tetep tampil kotak 1:1
     seukuran ikon; label ny baru melebar pas item ny di-hover /
     difokus panah (item ny memanjang). Sentuh: label selalu keliatan.
     Ini diatur di CSS (.menu-aksi), bukan JS.
   - "baru": 250ms pertama menu gak nyeret event, biar jari yang
     nyebabin menu kebuka gak nyenggol item pas diangkat. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type AksiItem = {
  id: string;
  label: string;
  ikon: ReactNode;
  onKlik: () => void;
  /* bahaya = hapus: warna ny beda di CSS. */
  bahaya?: boolean;
};

export default function MenuAksi({ x, y, items, onTutup }: { x: number; y: number; items: AksiItem[]; onTutup: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ kiri: x, atas: y });
  const [idx, setIdx] = useState(0);
  const [baru, setBaru] = useState(true);
  const fokusBalik = useRef<HTMLElement | null>(null);

  /* Jepit posisi ke viewport (diukur abis render pertama, sebelum
     paint, jadi gak pernah keliatan nyasar duluan). Jepit ny pakai
     LEBAR MENU SAAT LABEL KEBUKA (bukan lebar collapse): di desktop
     item ny memanjang pas di-hover — kalau dijepit pakai lebar kotak
     44px, menu yang kebuka deket tepi kanan bakal kepotong pas
     label ny melebar. scrollWidth label kebaca walau max-width ny 0. */
  useLayoutEffect(() => {
    const el = menuRef.current;
    fokusBalik.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!el) return;
    const kotak = el.getBoundingClientRect();
    let lebarBuka = kotak.width;
    el.querySelectorAll<HTMLElement>(".label").forEach((l) => {
      if (l.scrollWidth) lebarBuka = Math.max(lebarBuka, l.scrollWidth + 78);
    });
    const kiri = Math.max(8, Math.min(x, window.innerWidth - lebarBuka - 8));
    const atas = Math.max(8, Math.min(y, window.innerHeight - kotak.height - 8));
    setPos({ kiri, atas });
  }, [x, y]);

  useEffect(() => {
    const t = setTimeout(() => setBaru(false), 250);
    return () => clearTimeout(t);
  }, []);

  /* Klik/pointer di luar = tutup. (Menu nyself nge-stop propagation.) */
  useEffect(() => {
    function luar(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onTutup();
    }
    document.addEventListener("pointerdown", luar);
    return () => document.removeEventListener("pointerdown", luar);
  }, [onTutup]);

  /* Keyboard: Esc nutup, panah gerak, Enter milih. */
  useEffect(() => {
    function tombol(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onTutup();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => {
          const n = items.length;
          return e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
        });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const item = items[idx];
        if (item) {
          onTutup();
          item.onKlik();
        }
      }
    }
    document.addEventListener("keydown", tombol, true);
    return () => document.removeEventListener("keydown", tombol, true);
  }, [items, idx, onTutup]);

  /* Fokus item aktif CUMA pas navigasi keyboard (idx ganti karena
     panah), bukan pas menu baru kebuka: pas buka, fokus ny ke
     CONTAINER menu — jadi item pertama gak ke-highlight/kebuka
     label ny, kolom ny tetep kotak 1:1 semua (r18). Panah/Enter tetep
     jalan dari handler document level. */
  const bukaKe = useRef(0);
  useEffect(() => {
    bukaKe.current++;
    if (bukaKe.current === 1) {
      menuRef.current?.focus();
      return;
    }
    menuRef.current?.querySelector<HTMLElement>('[data-idx="' + idx + '"]')?.focus();
  }, [idx]);

  useEffect(() => {
    return () => fokusBalik.current?.focus?.();
  }, []);

  if (!items.length) return null;

  return (
    <div
      ref={menuRef}
      tabIndex={-1}
      className={"menu-aksi" + (baru ? " baru" : "")}
      style={{ left: pos.kiri, top: pos.atas }}
      role="menu"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          data-idx={i}
          className={"aksi-item" + (it.bahaya ? " bahaya" : "") + (i === idx ? " kinerja" : "")}
          onClick={() => {
            onTutup();
            it.onKlik();
          }}
        >
          {it.ikon}
          <span className="label">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/* useTekanLama: deteksi long-press (touch) + klik kanan (desktop)
   jadi SATU pintu buka menu aksi. Balikin props yang tinggal
   di-spread ke elemen target:
     {...tekan}

   - Touch: tekan 480ms tanpa gerak > 10px = buka (posisi jari).
     Gerakan/lepas sebelum ny = batal (biar scroll + swipe balas tetep
     jalan).
   - Desktop: contextmenu (klik kanan) = buka (posisi kursor), menu
     bawaan browser dibuang.
   - Fokus keyboard: gak lewat sini (menu dibuka lewat tombol aksi
     masing-masing bila ada). */
export function useTekanLama(buka: (x: number, y: number) => void, tunda = 480) {
  const timer = useRef(0);
  const titik = useRef({ x: 0, y: 0 });

  function mulai(x: number, y: number) {
    titik.current = { x, y };
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => buka(x, y), tunda);
  }
  function gerak(x: number, y: number) {
    const dx = Math.abs(x - titik.current.x);
    const dy = Math.abs(y - titik.current.y);
    if (dx > 10 || dy > 10) batal();
  }
  function batal() {
    clearTimeout(timer.current);
  }

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      mulai(t.clientX, t.clientY);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0];
      gerak(t.clientX, t.clientY);
    },
    onTouchEnd: batal,
    onTouchCancel: batal,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      buka(e.clientX, e.clientY);
    },
  };
}
