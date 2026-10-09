"use client";

/* AM Premium Generator: dua kotak, satu alur.
   1. Kotak email: validasi bentuk alamat (bebas domain, bukan cuma
      gmail). Valid = centang nyala, tombol request magic link kebuka.
   2. Setelah request: panduan cek inbox (termasuk folder spam),
      suruh salin link dari email ny.
   3. Kotak kedua: tempel URL ny buat aktivasi. Syarat: email ny
      TIDAK boleh beda dari yang dipake request (dicek di sini + di
      server), baru tombol aktivasi ny aktif.
   4. Berhasil = popup selamat + kode pembelian (NeyhraPlayground-...)
      yang bisa disalin.

   UI ny nurut bahasa visual situs: kotak border tinta, nomor langkah
   tabular, input 46px, tombol .btn primary, popup gaya pintu. */

import { useEffect, useRef, useState } from "react";
import { AsetIkon, CentangIkon, SalinIkon, Merek } from "@/components/ikon";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";
import { salinTeks } from "@/lib/salin-chat";

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function AMPremium() {
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState("");
  /* Email yang beneran dipake pas request magic link. Aktivasi wajib
     pakai email ini (gak boleh ganti di tengah jalan). */
  const [dikirim, setDikirim] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<"kirim" | "aktivasi" | null>(null);
  const [galat, setGalat] = useState("");
  const [berhasil, setBerhasil] = useState<{ kode: string; email: string } | null>(null);
  const [tersalin, setTersalin] = useState(false);
  const salinRef = useRef(0);

  const emailBersih = email.trim();
  const valid = RE_EMAIL.test(emailBersih);
  const berubah = !!dikirim && emailBersih.toLowerCase() !== dikirim;
  const bisaAktivasi = !!dikirim && !berubah && valid && url.trim().length > 8 && !sibuk;

  /* Popup sukses: kunci gulir + Esc nutup + SFX. */
  useEffect(() => {
    if (!berhasil) return;
    mainkanSfx("digital-burst");
    kunciGulir();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBerhasil(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      bukaKunciGulir();
    };
  }, [berhasil]);

  async function kirimLink() {
    if (!valid || sibuk) return;
    setSibuk("kirim");
    setGalat("");
    try {
      const res = await fetch("/api/fitur/am", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "kirim", email: emailBersih }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        setGalat(d.pesan || "Magic link gagal dikirim. Coba lagi bentar.");
        mainkanSfx("failure");
        return;
      }
      setDikirim(emailBersih.toLowerCase());
      setUrl("");
      mainkanSfx("notification");
    } catch {
      setGalat("Gak nyambung ke server. Cek koneksi ny, coba lagi.");
      mainkanSfx("failure");
    } finally {
      setSibuk(null);
    }
  }

  async function aktivasi() {
    if (!bisaAktivasi) return;
    setSibuk("aktivasi");
    setGalat("");
    try {
      const res = await fetch("/api/fitur/am", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aksi: "aktivasi", email: emailBersih, url: url.trim() }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        setGalat(d.pesan || "Aktivasi gagal. Cek ulang link ny, terus coba lagi.");
        mainkanSfx("failure");
        return;
      }
      setBerhasil({ kode: String(d.kode || ""), email: String(d.email || emailBersih) });
    } catch {
      setGalat("Gak nyambung ke server. Cek koneksi ny, coba lagi.");
      mainkanSfx("failure");
    } finally {
      setSibuk(null);
    }
  }

  async function salinKode() {
    if (!berhasil) return;
    const ok = await salinTeks(berhasil.kode);
    if (ok) {
      setTersalin(true);
      mainkanSfx("digital-burst");
      clearTimeout(salinRef.current);
      salinRef.current = window.setTimeout(() => setTersalin(false), 2400);
    }
  }

  return (
    <>
      <section className="head">
        <h1>AM Premium Generator</h1>
        <p className="lede">
          Masukin email lo, gw kirimin magic link ny. Buka email ny (kalo gak nemu, cek folder spam), salin link ny, terus
          tempel di kotak aktivasi. Premium 1 tahun nempel di akun email itu.
        </p>
      </section>

      <div className="am-panel">
        <div className="am-kepala">
          <span className="am-logo" aria-hidden="true">
            <AsetIkon nama="am" ukuran={40} />
          </span>
          <div className="am-judul">
            <h2>AM Premium · 1 Tahun</h2>
            <p>
              <Merek ukuran={12} /> Neyhra Playground
            </p>
          </div>
        </div>

        {/* Langkah 1: email */}
        <div className="am-langkah">
          <div className="am-baris-judul">
            <span className="am-nomor">1</span>
            <label htmlFor="amEmail">Email lo</label>
            <span className="am-ket">bebas, gak harus gmail</span>
          </div>
          <div className="am-kotak-input">
            <input
              id="amEmail"
              type="email"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setGalat("");
              }}
              placeholder="nama@contoh.com"
              aria-invalid={emailBersih.length > 0 && !valid}
              disabled={sibuk !== null}
            />
            <span className={"am-valid" + (valid && !berubah ? " on" : "")} aria-hidden="true">
              <CentangIkon ukuran={15} />
            </span>
          </div>

          {berubah && dikirim && (
            <p className="am-ingat" role="alert">
              Magic link tadi dikirim ke <b>{dikirim}</b>. Email ny gak boleh ganti di tengah jalan: balikin ke alamat
              itu, atau kirim ulang magic link ny.
            </p>
          )}

          <button type="button" className="btn primary am-tombol" onClick={kirimLink} disabled={!valid || sibuk !== null}>
            {sibuk === "kirim" ? "Mengirim..." : dikirim ? "Kirim ulang magic link" : "Kirim Magic Link"}
          </button>
        </div>

        {/* Langkah 2: link dari email */}
        <div className={"am-langkah" + (dikirim ? "" : " mati")}>
          <div className="am-baris-judul">
            <span className="am-nomor">2</span>
            <label htmlFor="amUrl">Link dari email</label>
            <span className="am-ket">tempel URL yang lo salin dari inbox</span>
          </div>
          <div className="am-kotak-input">
            <input
              id="amUrl"
              type="text"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setGalat("");
              }}
              placeholder={dikirim ? "https://..." : "Kirim magic link dulu buat buka langkah ini"}
              disabled={!dikirim || sibuk !== null}
            />
          </div>

          {dikirim && (
            <div className="am-panduan">
              <b>Cek email lo</b> di <b>{dikirim}</b>:
              <ol>
                <li>Buka email dari Alight Motion.</li>
                <li>
                  Gak ketemu? Nyari di folder <b>Spam</b> (kadang nyasar ke situ).
                </li>
                <li>Salin link panjang ny (klik kanan link ny, pilih Copy link address).</li>
                <li>Tempel ke kotak di atas, terus pencet Aktivasi Premium.</li>
              </ol>
            </div>
          )}

          <button type="button" className="btn primary am-tombol" onClick={aktivasi} disabled={!bisaAktivasi}>
            {sibuk === "aktivasi" ? "Memproses..." : "Aktivasi Premium"}
          </button>
        </div>

        {galat && (
          <div className="gagal" role="alert">
            <h2>Ada yang gak beres</h2>
            <p>{galat}</p>
          </div>
        )}
      </div>

      {berhasil && (
        <div
          className="pintu-lapis"
          role="dialog"
          aria-modal="true"
          aria-label="AM Premium berhasil"
          onClick={(e) => e.target === e.currentTarget && setBerhasil(null)}
        >
          <section className="pintu-kotak am-berhasil">
            <span className="am-berhasil-ikon" aria-hidden="true">
              <CentangIkon ukuran={34} />
            </span>
            <h2>Selamat!</h2>
            <p>
              AM Premium <b>1 tahun</b> berhasil didapatkan buat <b>{berhasil.email}</b>. Simpen kode pembelian ny di
              bawah, buat jaga-jaga.
            </p>
            <div className="am-kode">
              <span className="ket">Kode pembelian</span>
              <code>{berhasil.kode}</code>
              <button type="button" className="btn kecil" onClick={salinKode}>
                <SalinIkon ukuran={13} />
                {tersalin ? "Tersalin" : "Salin kode"}
              </button>
            </div>
            <button type="button" className="btn primary am-tombol" onClick={() => setBerhasil(null)}>
              Tutup
            </button>
          </section>
        </div>
      )}
    </>
  );
}
