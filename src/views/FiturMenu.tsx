"use client";

/* Menu fitur (r27 / P3-10): kartu-kartu dibangun dari KATALOG, jadi
   nambah fitur baru di katalog otomatis nambah kartu di sini.
   Kartu chat (AI + Ruang Obrol) dibikin lebar: beda berat konten,
   beda bentuk (bukan semua kartu seragam).
   Kartu pake next/link (bukan <a>): navigasi ny client-side, jadi
   pindah dari sini ke halaman fitur GAK nge-reload dokumen.

   Pencarian fitur (client-side — seluruh katalog udah ada di
   browser, gak ada alasan nge-request server tiap karakter):
   - nyari di label + deskripsi + format + alias.
   - kosong -> urutan ASLI (gak diacak-ulang).
   - gak ketemu -> teks jelas, gak ada hasil kosong hening.
   - keyboard: panah bawah/atas mindahin fokus ke kartu hasil,
     Enter dari input buka hasil pertama, Escape ngosongin. */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { KATALOG, type EntryFitur } from "@/lib/katalog";
import { Panah, CariIkon } from "@/components/ikon";

function cocok(f: EntryFitur, q: string): boolean {
  const c = q.toLowerCase();
  return (
    f.label.toLowerCase().includes(c) ||
    f.deskripsi.toLowerCase().includes(c) ||
    f.format.toLowerCase().includes(c) ||
    (f.alias ?? []).some((a) => a.includes(c))
  );
}

export default function FiturMenu() {
  const [q, setQ] = useState("");
  const [fokusIdx, setFokusIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const daftarRef = useRef<HTMLUListElement>(null);

  const hasil = useMemo(() => {
    const isi = q.trim().replace(/\s+/g, " ");
    return isi ? KATALOG.filter((f) => cocok(f, isi)) : KATALOG;
  }, [q]);

  /* fokusIdx reset pas query ganti (di handler, bukan effect —
     biar gak ada render beruntun). */
  useEffect(() => {
    if (fokusIdx < 0) return;
    daftarRef.current?.querySelectorAll("li")[fokusIdx]?.scrollIntoView({ block: "nearest" });
  }, [fokusIdx]);

  /* Animasi masuk kartu. R28 (bug "search -> hapus -> daftar gak
     balik"): dulu ny efek ny jalan SEKALI pas mount, jadi item yang
     di-RENDER ULANG abis filter (node baru, gak bawa kelas .on) stayed
     di opacity:0 — keliatan kayak daftarny gak balik padahal cuma
     ketutup animasi. Sekarang: tiap kali hasil ganti, node yang
     BELUM pernah ke-reveal dikasih .on juga. Item yang baru muncul
     gara-gara filter gak di-stagger ulang (langsung keliatan + fade
     singkat) — cuma batch pertama (mount) yang dapet stagger.
     R30: pas FILTER, sisa delay stagger mount (kartu yang
     transisiny belum jalan karena delay 140+i*120ms) di-nol-in —
     hasil pencarian harusnya tampil LANGSUNG, bukan nunggu sisa
     jatah stagger dari 11 kartu (jalan mulai r30: 2 fitur baru
     bikin jendela stagger lebih panjang). */
  const pertamaRef = useRef(true);
  useEffect(() => {
    const pertama = pertamaRef.current;
    pertamaRef.current = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = daftarRef.current?.querySelectorAll<HTMLElement>(".kartu-grid .masuk");
    if (!el) return;
    el.forEach((item, i) => {
      if (reduce || !pertama) {
        /* R30: restart transisi (bukan cuma ganti --lambat — delay
           transisi kekunci di waktu MULAI, jadi kartu yang masih di
           fase delay stagger mount gak bakal nurut nilai baru).
           Pola resmi restart: lepas .on -> paksa reflow (offsetWidth)
           -> --lambat 0 -> pasang .on lagi. Hasil filter tampil
           LANGSUNG (fade singkat doang), apapun sisa stagger ny. */
        item.classList.remove("on");
        void item.offsetWidth;
        item.style.setProperty("--lambat", "0ms");
        item.classList.add("on");
        return;
      }
      item.style.setProperty("--lambat", 140 + i * 120 + "ms");
      requestAnimationFrame(() => requestAnimationFrame(() => item.classList.add("on")));
    });
  }, [hasil]);

  function keyInput(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && hasil.length) {
      e.preventDefault();
      /* fokus pindah ke kartu pertama — selanjutny Tab/Enter native
         jalan dari kartu ny sendiri. */
      setFokusIdx(0);
      daftarRef.current?.querySelectorAll<HTMLAnchorElement>("li a")[0]?.focus();
    } else if (e.key === "Enter") {
      const target = hasil[Math.max(0, fokusIdx)];
      if (target) inputRef.current?.blur();
    } else if (e.key === "Escape") {
      if (q) {
        e.preventDefault();
        setQ("");
      }
    }
  }

  return (
    <>
      <section className="head">
        <h1>Fitur</h1>
        <p className="lede">
          Mau ngapain hari ini? Nyimpen video, nyari foto, atau ngobrol, monggo dipilih mas.
        </p>
        <div className="cari-fitur" role="search" aria-label="Cari fitur">
          <input
            ref={inputRef}
            id="cariFitur"
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setFokusIdx(-1);
            }}
            onKeyDown={keyInput}
            placeholder="Cari fitur..."
            aria-describedby="ketCariFitur"
            autoComplete="off"
          />
          <span className="ikon-cari" aria-hidden="true">
            <CariIkon />
          </span>
        </div>
        <p id="ketCariFitur" className="hint" aria-live="polite">
          {q.trim()
            ? hasil.length
              ? `Ketemu ${hasil.length} fitur buat "${q.trim()}".`
              : `Gak ada fitur yang cocok buat "${q.trim()}". Coba kata laen — misalny: unduh, foto, chat, game.`
            : `${KATALOG.length} fitur tersedia.`}
        </p>
      </section>

      <ul className="kartu-grid" ref={daftarRef}>
        {hasil.map((k, i) => (
          <li key={k.id} className="masuk">
            <Link
              className={"kartu" + (k.lebar ? " lebar" : "") + (i === fokusIdx ? " disorot" : "")}
              href={"/fitur/" + k.id}
              aria-label={"Buka fitur " + k.label}
              onFocus={() => setFokusIdx(i)}
              onBlur={() => setFokusIdx(-1)}
            >
              <span className="kartu-ikon" aria-hidden="true">
                {k.ikon(30)}
              </span>
              <span className="kartu-badan">
                <h2>{k.label}</h2>
                <p>{k.deskripsi}</p>
                <span className="kartu-format">{k.format}</span>
              </span>
              <span className="kartu-panah">
                Masuk <Panah />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
