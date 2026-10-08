"use client";

/* SebutOtomatis (r27 / P2-8): autocomplete @username buat textarea bio.
   - Muncul pas ketik "@x" (minimal 1 karakter setelah @) di posisi
     kursor, BUKAN cuma di akhir teks (kata di tengah ikut kehitung).
   - Pencarian: /api/pengguna?q= (debounce 300ms, maks 6 hasil —
     dropdown kecil, gak ngegedein). Hasil ny nempel ke query ny:
     hasil buat "@na" gak kepakai pas token udah jadi "@nan" (stale
     guard, tanpa perlu nge-reset state di effect).
   - Keyboard (document capture, CUMA pas dropdown lagi kebuka):
     panah pilih, Enter/Tab masukin, Escape nutup dropdown doang
     (editor tetep kebuka).
   - Ngalahar token "@..." di posisi kursor diganti "@username ".
   - Mobile: posisi dropdown diukur pas buka (layout effect, tulis
     langsung ke style — bukan state) + flip ke atas kalau ruang
     bawahny kurang.
   Komponen render bio (BioSebut) ada di sini juga: @username jadi
   link ke profil (mention ngikut username = identifier stabil). */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { OrangIkon } from "@/components/ikon";

type Kandidat = { id: string; nama: string; username: string | null; pfp: string | null };

/* Token @mention di posisi kursor: { mulai, isi } atau null. */
function tokenDiKursor(teks: string, posisi: number) {
  const awal = teks.lastIndexOf("@", posisi - 1);
  if (awal < 0) return null;
  /* kalau ada karakter non-token antara @ dan kursor: bukan 1 kata */
  const potong = teks.slice(awal + 1, posisi);
  if (!/^[a-zA-Z0-9_.]*$/.test(potong)) return null;
  /* @ harus di awal baris atau setelah spasi (bukan email@domain) */
  if (awal > 0 && !/\s/.test(teks[awal - 1])) return null;
  return { mulai: awal, isi: potong };
}

export function SebutOtomatis({
  teks,
  posisi,
  onPilih,
}: {
  teks: string;
  /* posisi kursor terakhir (diperbarui pemanggil dari
     onSelect / onKeyUp / onClick textarea). */
  posisi: number;
  onPilih: (teksBaru: string, posisiBaru: number) => void;
}) {
  /* hasil ny nempel ke query (stale guard): cuma kepakai kalau
     token sekarang MASIH sama kayak waktu hasilny dateng. */
  const [hasil, setHasil] = useState<{ untuk: string; daftar: Kandidat[] } | null>(null);
  const [idx, setIdx] = useState(0);
  /* Escape/milih = "tutup buat token INI": nyimpen kunci token ny,
     bukan boolean — pas user lanjut ngetik (token ganti), kunci ny
     gak nyambung lagi -> dropdown idup lagi. Tanpa effect reset. */
  const [tutupKunci, setTutupKunci] = useState<string | null>(null);
  const bungkusRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);

  const token = tokenDiKursor(teks, posisi);
  const layak = !!token && token.isi.length >= 1 && token.isi.length <= 20;
  const kunci = token ? token.mulai + ":" + token.isi : "";
  const sembunyi = !!token && tutupKunci === kunci;
  const daftar = token && layak && !sembunyi && hasil?.untuk === token.isi ? hasil.daftar : [];
  const buka = daftar.length > 0;

  /* cari kandidat (debounce 300ms — gak tiap keypress). setState ny
     cuma jalan di callback async (bukan sync di badan effect). */
  useEffect(() => {
    if (!layak || !token) return;
    const untuk = token.isi;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/pengguna?q=" + encodeURIComponent(untuk), { cache: "no-store" });
        const d = await r.json();
        setHasil({ untuk, daftar: Array.isArray(d.daftar) ? d.daftar.slice(0, 6) : [] });
        setIdx(0);
      } catch {
        setHasil({ untuk, daftar: [] });
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [layak, token?.mulai, token?.isi]);

  /* posisi dropdown: nempel di bawah textarea, flip ke atas kalo
     ruang bawah kurang (HP). Ditulis LANGSUNG ke style di layout
     effect (sebelum paint, gak ada flash) — bukan lewat state. */
  useLayoutEffect(() => {
    const el = bungkusRef.current;
    if (!el || !buka) return;
    const kotak = el.getBoundingClientRect();
    const sisaBawah = window.innerHeight - kotak.bottom;
    const tinggi = Math.min(230, daftar.length * 46 + 8);
    el.style.top = (sisaBawah < tinggi + 12 && kotak.top > tinggi + 12 ? -(tinggi + 4) : kotak.height + 4) + "px";
  }, [buka, daftar.length]);

  function masuk(u: Kandidat) {
    if (!token) return;
    const handle = u.username ?? u.nama;
    const sebelum = teks.slice(0, token.mulai);
    const sesudah = teks.slice(posisi);
    const baru = sebelum + "@" + handle + " " + sesudah;
    setTutupKunci(token.mulai + ":" + token.isi);
    onPilih(baru, (sebelum + "@" + handle + " ").length);
  }

  /* Keyboard: document capture — CUMA pas dropdown ny beneran nongol.
     Tombol ny dikonsumsi (preventDefault) biar caret textarea gak
     pindah pas navigasi saran. r29: Enter/Tab juga stopPropagation —
     dipake sama composer komentar (Enter = kirim): event ny gak boleh
     nyampe onKeyDown textarea pas lagi milih saran, kebalikan ny pas
     dropdown ketutup Enter tetep ngirim (listener ny cuma pas buka). */
  useEffect(() => {
    if (!buka) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => (i + 1) % daftar.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => (i - 1 + daftar.length) % daftar.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        masuk(daftar[idx] ?? daftar[0]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setTutupKunci(kunci);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [buka, daftar, idx, teks, posisi, kunci]);

  if (!buka) return null;

  return (
    <div ref={bungkusRef} className="sebut-wrap">
      <ul className="sebut-daftar" role="listbox" aria-label="Saran username">
        {daftar.map((u, i) => (
          <li key={u.id} role="option" aria-selected={i === idx}>
            <button
              type="button"
              onMouseDown={(e) => {
                /* onMouseDown (bukan click): jalan SEBELUM textarea
                   keblur pas fokusny pindah — click bakal kena race. */
                e.preventDefault();
                masuk(u);
              }}
              onMouseEnter={() => setIdx(i)}
            >
              {u.pfp ? (
                <img src={"/api/pfp/" + u.id + "?v=" + encodeURIComponent(u.pfp)} alt="" width={26} height={26} loading="lazy" decoding="async" />
              ) : (
                <span className="sebut-inisial" aria-hidden="true">
                  <OrangIkon ukuran={13} />
                </span>
              )}
              <b>@{u.username ?? u.nama}</b>
              <span className="sebut-nama">{u.nama}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* BioSebut: render teks bio + @username jadi link profil.
   Mention nyedot username (identifier) — sesuai schema r27. */
export function BioSebut({ teks }: { teks: string }) {
  const bagian: (string | { u: string })[] = [];
  const pola = /(^|\s)@([a-z0-9][a-z0-9_.]{1,18}[a-z0-9])(?=$|[\s.,!?])/g;
  let terakhir = 0;
  let m: RegExpExecArray | null;
  while ((m = pola.exec(teks))) {
    const awal = m.index + m[1].length;
    if (awal > terakhir) bagian.push(teks.slice(terakhir, awal));
    bagian.push({ u: m[2] });
    terakhir = awal + 1 + m[2].length;
  }
  if (terakhir < teks.length) bagian.push(teks.slice(terakhir));
  return (
    <span className="bio-sebut">
      {bagian.map((b, i) =>
        typeof b === "string" ? (
          <span key={i}>{b}</span>
        ) : (
          <Link key={i} className="bio-mention" href={"/profil/" + encodeURIComponent(b.u)}>
            @{b.u}
          </Link>
        )
      )}
    </span>
  );
}
