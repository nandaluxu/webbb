"use client";

/* Tombol Paste (paste.svg): baca clipboard browser, terus isi input
   link di sebelah ny. Kalau browser gak ngasih izin baca clipboard,
   kasih tau carany manual (Ctrl+V), gak ada error teknis yang
   dibuang ke muka user. */

import { useEffect, useRef, useState } from "react";
import { TempelIkon } from "@/components/ikon";

export default function TombolTempel({ onTempel }: { onTempel: (teks: string) => void }) {
  const [ket, setKet] = useState("");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function tempel() {
    try {
      const teks = await navigator.clipboard.readText();
      const isi = teks.trim();
      if (!isi) {
        setKet("Clipboard ny kosong.");
      } else {
        onTempel(isi);
        setKet("");
      }
    } catch {
      setKet("Browser ny gak ngasih izin baca clipboard. Tekan Ctrl+V di kotakny aja ya.");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setKet(""), 4000);
  }

  return (
    <span className="tempel-wrap">
      <button type="button" className="btn kecil tombol-tempel" onClick={tempel}>
        <TempelIkon ukuran={15} />
        Tempel
      </button>
      {ket && (
        <span className="tempel-ket" role="status">
          {ket}
        </span>
      )}
    </span>
  );
}
