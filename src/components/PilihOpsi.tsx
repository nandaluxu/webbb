"use client";

/* PilihOpsi: dropdown CUSTOM (bukan <select> bawaan browser) yang
   ngikut bahasa visual situs: border tinta, kotak tajam, chevron
   yang muter pas kebuka.

   Kenapa custom sekarang: select native gak bisa distyle konsisten
   (daftar opsi ny digambar OS, beda-beda bentuk ny) dan gak punya
   grup + state terpilih yang keliatan jelas. Ini dropdown ny sendiri
   yang digambar, jadi:

   - Buka/tutup klik tombol; klik di luar nutup; Esc nutup.
   - Desktop: hover opsi dapet feedback (latar kilau + geser dikit).
   - Mobile: tinggi sentuh 44px, daftar max-height bisa digulir.
   - Keyboard penuh: Enter/Space/panah-bawah buka, panah naik/turun
     gerak, Home/End lompat, Enter milih, Esc nutup (fokus balik ke
     tombol), Tab nutup.
   - Opsi terpilih: tebal + centang kanan + latar, gak nyamar sama
     opsi yang cuma ke-hover.
   - Grup (Video / Audio) jadi judul kecil di daftar, persis
     optgroup dulu.

   A11y: tombol aria-haspopup="listbox" + aria-expanded; daftar
   role="listbox", opsi role="option" + aria-selected, fokus ny
     dijaga di daftar lewat aria-activedescendant. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CentangIkon } from "@/components/ikon";

export type Opsi = { nilai: string; teks: string };
export type GrupOpsi = { judul: string; opsi: Opsi[] };

export default function PilihOpsi({
  id,
  label,
  grup,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  grup: GrupOpsi[];
  value: string;
  onChange: (nilai: string) => void;
  disabled?: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const kotakRef = useRef<HTMLDivElement>(null);
  const daftarRef = useRef<HTMLUListElement>(null);
  const tombolRef = useRef<HTMLButtonElement>(null);

  /* Daftar flat + penanda grup per opsi (buat render judul grup). */
  const flat = grup.flatMap((g) => g.opsi.map((o) => ({ ...o, grup: g.judul })));
  const idxTerpilih = Math.max(0, flat.findIndex((o) => o.nilai === value));
  const [idx, setIdx] = useState(idxTerpilih);
  const terpilih = flat.find((o) => o.nilai === value) ?? flat[0];
  const grupTerpilih = terpilih?.grup;

  /* Buka: fokus ke daftar, posisiin hover di opsi terpilih. */
  function bukaDaftar() {
    if (disabled) return;
    setIdx(idxTerpilih);
    setBuka(true);
  }

  useEffect(() => {
    if (buka) {
      requestAnimationFrame(() => {
        daftarRef.current?.focus();
        const el = daftarRef.current?.querySelector<HTMLElement>('[data-idx="' + idxTerpilih + '"]');
        el?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [buka, idxTerpilih]);

  function tutup(fokusBalik = true) {
    setBuka(false);
    if (fokusBalik) tombolRef.current?.focus();
  }

  /* Klik/pointer di luar = tutup. */
  useEffect(() => {
    if (!buka) return;
    function luar(e: PointerEvent) {
      if (kotakRef.current && !kotakRef.current.contains(e.target as Node)) setBuka(false);
    }
    document.addEventListener("pointerdown", luar);
    return () => document.removeEventListener("pointerdown", luar);
  }, [buka]);

  /* Matiin pas ke-disable (misal lagi proses unduh). Pola reset saat
     render (resmi dari React docs, bukan efek): pas prop disabled
     ganti, tutup daftar ny sekalian tanpa efek. */
  const [disableLama, setDisableLama] = useState(!!disabled);
  if (!!disabled !== disableLama) {
    setDisableLama(!!disabled);
    if (disabled) setBuka(false);
  }

  /* Pastiin daftar gak nyabit viewport bawah (diukur sebelum paint). */
  useLayoutEffect(() => {
    if (!buka || !daftarRef.current) return;
    const kotak = daftarRef.current.getBoundingClientRect();
    const sisa = window.innerHeight - kotak.bottom;
    if (sisa < 8) {
      daftarRef.current.style.maxHeight = Math.max(160, kotak.height + sisa - 8) + "px";
    }
  }, [buka]);

  function pilih(nilai: string) {
    onChange(nilai);
    tutup();
  }

  /* Keyboard di daftar: panah gerak, Home/End lompat, Enter/Space
     milih, Esc/Tab nutup. */
  function daftarKetik(e: React.KeyboardEvent) {
    const n = flat.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => (i + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => (i - 1 + n) % n);
    } else if (e.key === "Home") {
      e.preventDefault();
      setIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setIdx(n - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (flat[idx]) pilih(flat[idx].nilai);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      tutup();
    } else if (e.key === "Tab") {
      tutup(false);
    }
    if (flat[idx]) {
      requestAnimationFrame(() => {
        daftarRef.current?.querySelector<HTMLElement>('[data-idx="' + idx + '"]')?.scrollIntoView({ block: "nearest" });
      });
    }
  }

  return (
    <div className={"pilih-opsi" + (disabled ? " mati" : "")} ref={kotakRef}>
      <label htmlFor={id}>{label}</label>
      <div className="po-kotak">
        <button
          ref={tombolRef}
          id={id}
          type="button"
          className={"po-tombol" + (buka ? " buka" : "")}
          aria-haspopup="listbox"
          aria-expanded={buka}
          disabled={disabled}
          onClick={() => (buka ? tutup(false) : bukaDaftar())}
          onKeyDown={(e) => {
            if (!buka && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              bukaDaftar();
            }
          }}
        >
          {grupTerpilih ? <span className="po-grup-mini">{grupTerpilih} · </span> : null}
          <span className="po-terpilih">{terpilih ? terpilih.teks : "-"}</span>
          <svg className="po-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 4.5l4 3.5 4-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
        </button>

        {buka && (
          <ul
            ref={daftarRef}
            className="po-daftar"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={id + "-o" + idx}
            onKeyDown={daftarKetik}
            onBlur={(e) => {
              /* Fokus keluar dari daftar = tutup — KECUALI kalau nyasar
                 ke TRIGGER kotak ini (r29): browser mindahin fokus ke
                 tombol pas pointerdown SEBELUM event click ny kefire;
                 blur-close dulu + click-reopen pas-nya nyebabin
                 "klik trigger lagi malah kebuka lagi" (toggle ny kalah
                 sama dua transisi state beruntun). Fokus yang gerak di
                 DALAM kotak (trigger <-> daftar) biarin — toggle keurus
                 di onClick trigger ny. */
              if (kotakRef.current && kotakRef.current.contains(e.relatedTarget as Node)) return;
              setBuka(false);
            }}
          >
            {(() => {
              /* Render per grup biar judul ny cuma sekali per grup. */
              const isi: React.ReactNode[] = [];
              let grupNy = "";
              flat.forEach((o, i) => {
                if (o.grup !== grupNy) {
                  grupNy = o.grup;
                  isi.push(
                    <li key={"g-" + o.grup + "-" + i} className="po-grup" role="presentation">
                      {o.grup}
                    </li>
                  );
                }
                isi.push(
                  <li
                    key={o.nilai}
                    id={id + "-o" + i}
                    role="option"
                    aria-selected={o.nilai === value}
                    data-idx={i}
                    className={"po-opsi" + (o.nilai === value ? " aktif" : "") + (i === idx && o.nilai !== value ? " kincong" : "")}
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => pilih(o.nilai)}
                  >
                    <span>{o.teks}</span>
                    {o.nilai === value && <CentangIkon ukuran={13} />}
                  </li>
                );
              });
              return isi;
            })()}
          </ul>
        )}
      </div>
    </div>
  );
}
