"use client";

/* Sfile: satu kotak buat dua jalur.
   - Input = link sfile.co / sfile.mobi -> ambil info file + tombol unduh.
   - Input = teks biasa -> nyari file di sfile, tiap baris ada tombol unduh.
   Unduhan ny ngelewatin server (proxy) karena CDN sfile ngecek cookie
   + referer, browser gak bisa ambil langsung. Di bawah ny ada upload
   guest ke sfile.co (mp4/video ditolak server ny, itu kebijakan ny). */

import { useRef, useState } from "react";
import { UnduhIkon, Panah, UnggahIkon, AsetIkon } from "@/components/ikon";
import TombolTempel from "@/components/TombolTempel";
import type { EntryLain } from "@/lib/katalog";

type InfoFile = {
  nama: string;
  ukuran: string | null;
  waktu: string | null;
  unduhan: number | null;
  url: string;
};

type HasilCari = {
  nama: string;
  url: string;
  ukuran: string | null;
  waktu: string | null;
};

type Status =
  | { jenis: "kosong" }
  | { jenis: "muat"; pesan: string }
  | { jenis: "gagal"; judul: string; pesan: string }
  | { jenis: "unduh"; info: InfoFile }
  | { jenis: "cari"; daftar: HasilCari[]; q: string };

const JUMLAH_PILIHAN = [6, 10, 20, 40];

function linkSfile(v: string): boolean {
  return /https?:\/\/(www\.)?(sfile\.co|sfile\.mobi)\/\S+/i.test(v.trim()) || /^(sfile\.co|sfile\.mobi)\/\S+/i.test(v.trim());
}

export default function SfileView({ entry }: { entry: EntryLain }) {
  const [nilai, setNilai] = useState("");
  const [jumlah, setJumlah] = useState(10);
  const [status, setStatus] = useState<Status>({ jenis: "kosong" });
  const statusRef = useRef<HTMLDivElement>(null);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    const v = nilai.trim();
    if (!v) {
      setStatus({ jenis: "gagal", judul: "Kotakny masih kosong", pesan: "Tempel link sfile atau tulis kata kunci pencarian dulu." });
      return;
    }

    if (linkSfile(v)) {
      setStatus({ jenis: "muat", pesan: "Ngecek file ny di sfile..." });
      try {
        const r = await fetch("/api/sfile/info", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: v.startsWith("http") ? v : "https://" + v }),
        });
        const d = await r.json();
        if (!r.ok) {
          setStatus({ jenis: "gagal", judul: "File ny gak kebaca", pesan: d.galat || "Coba cek lagi link ny." });
          return;
        }
        setStatus({ jenis: "unduh", info: d.info });
      } catch {
        setStatus({ jenis: "gagal", judul: "Gak nyambung", pesan: "Server ny lagi gak kejangkau. Coba lagi bentar." });
      }
      return;
    }

    if (v.length < 2) {
      setStatus({ jenis: "gagal", judul: "Kata kunci ny kependekan", pesan: "Minimal 2 huruf buat nyari." });
      return;
    }
    setStatus({ jenis: "muat", pesan: 'Nyari file "' + v + '" di sfile...' });
    try {
      const r = await fetch("/api/sfile/cari", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: v, jumlah }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStatus({ jenis: "gagal", judul: "Pencarian gagal", pesan: d.galat || "Coba kata kunci lain." });
        return;
      }
      setStatus({ jenis: "cari", daftar: d.daftar, q: v });
    } catch {
      setStatus({ jenis: "gagal", judul: "Gak nyambung", pesan: "Server ny lagi gak kejangkau. Coba lagi bentar." });
    }
  }

  return (
    <>
      <section className="head">
        <h1>{entry.judul}</h1>
        <p className="lede">{entry.lede}</p>
      </section>

      <form className="form" onSubmit={kirim} noValidate>
        <label htmlFor="inputSfile">Link sfile atau kata kunci</label>
        <div className="row">
          <input
            id="inputSfile"
            type="text"
            inputMode="search"
            value={nilai}
            onChange={(e) => setNilai(e.target.value)}
            placeholder="https://sfile.co/xxxx atau: kata kunci..."
            aria-describedby="petunjukSfile"
          />
          <TombolTempel onTempel={setNilai} />
          <button type="submit" className="btn primary">
            {linkSfile(nilai.trim()) ? "Ambil" : "Cari"}
          </button>
        </div>
        <p className="hint" id="petunjukSfile">
          Tempel link sfile buat donlot langsung, atau tulis kata kunci buat nyari file (hasil ny bisa diunduh satu-satu).
        </p>
        {!linkSfile(nilai.trim()) && (
          <div className="chips" role="group" aria-label="Jumlah hasil">
            <span className="chip-label">Jumlah</span>
            {JUMLAH_PILIHAN.map((n) => (
              <button key={n} type="button" className={"chip" + (n === jumlah ? " aktif" : "")} aria-pressed={n === jumlah} onClick={() => setJumlah(n)}>
                {n}
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="status" ref={statusRef} aria-live="polite">
        {status.jenis === "kosong" && (
          <div className="kosong">
            Tempel <b>link sfile</b> buat donlot, atau ketik <b>kata kunci</b> buat nyari file.
            <br />
            Hasil ny muncul di sini.
          </div>
        )}
        {status.jenis === "muat" && (
          <div className="muat">
            <span className="bar" />
            <span>{status.pesan}</span>
          </div>
        )}
        {status.jenis === "gagal" && (
          <div className="gagal">
            <h2>{status.judul}</h2>
            <p>{status.pesan}</p>
          </div>
        )}
        {status.jenis === "unduh" && <HasilUnduh info={status.info} />}
        {status.jenis === "cari" && <HasilCariSfile daftar={status.daftar} q={status.q} />}
      </div>

      <UnggahSfile />
    </>
  );
}

function HasilUnduh({ info }: { info: InfoFile }) {
  const unduhan = info.unduhan !== null ? info.unduhan.toLocaleString("id-ID") + "x" : null;
  return (
    <div className="hasil">
      <dl className="rincian">
        <div className="baris">
          <dt>Nama file</dt>
          <dd>{info.nama}</dd>
        </div>
        <div className="baris">
          <dt>Ukuran</dt>
          <dd>{info.ukuran || "-"}</dd>
        </div>
        <div className="baris">
          <dt>Diunggah</dt>
          <dd>{info.waktu || "-"}</dd>
        </div>
        {unduhan && (
          <div className="baris">
            <dt>Total unduhan</dt>
            <dd>{unduhan}</dd>
          </div>
        )}
      </dl>
      <p className="aksi-hasil">
        <a className="btn primary" href={"/api/sfile/unduh?url=" + encodeURIComponent(info.url)}>
          <UnduhIkon />
          Unduh file
        </a>
        <a className="btn" href={info.url} target="_blank" rel="noopener">
          Buka halaman ny
          <Panah />
        </a>
      </p>
      <p className="hint">Unduhan lewat server gw biar lolos proteksi CDN sfile. File gede dikit sabar ya, kadang lambet.</p>
    </div>
  );
}

function HasilCariSfile({ daftar, q }: { daftar: HasilCari[]; q: string }) {
  return (
    <div className="hasil">
      <p className="ket-hasil">
        <b>{daftar.length}</b> file buat <b>{q}</b>
      </p>
      <ul className="daftar-file">
        {daftar.map((f) => (
          <li key={f.url}>
            <span className="df-badan">
              <span className="df-nama">{f.nama}</span>
              <span className="df-meta">
                {f.ukuran || "?"}
                {f.waktu ? " • " + f.waktu : ""}
              </span>
            </span>
            <a className="btn kecil" href={"/api/sfile/unduh?url=" + encodeURIComponent(f.url)}>
              <UnduhIkon />
              Unduh
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Upload guest ke sfile.co ---------- */

type StatusUnggah =
  | { jenis: "diam" }
  | { jenis: "muat"; persen: number }
  | { jenis: "gagal"; pesan: string }
  | { jenis: "jadi"; shareUrl: string; nama: string; ukuran: string | null; duplikat: boolean };

const BATAS_WEB = 100 * 1024 * 1024;

function UnggahSfile() {
  const [file, setFile] = useState<File | null>(null);
  const [deskripsi, setDeskripsi] = useState("");
  const [status, setStatus] = useState<StatusUnggah>({ jenis: "diam" });
  const inputRef = useRef<HTMLInputElement>(null);

  function pilih(f: File | null) {
    setFile(f);
    if (status.jenis !== "diam") setStatus({ jenis: "diam" });
  }

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setStatus({ jenis: "gagal", pesan: "Pilih file dulu." });
      return;
    }
    if (file.size > BATAS_WEB) {
      setStatus({ jenis: "gagal", pesan: "File ny " + (file.size / 1048576).toFixed(1) + " MB, batas upload 100 MB." });
      return;
    }
    setStatus({ jenis: "muat", persen: 0 });
    const fd = new FormData();
    fd.append("file", file);
    fd.append("deskripsi", deskripsi);
    try {
      const r = await fetch("/api/sfile/unggah", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) {
        setStatus({ jenis: "gagal", pesan: d.galat || "Upload gagal." });
        return;
      }
      setStatus({ jenis: "jadi", shareUrl: d.shareUrl, nama: d.nama, ukuran: d.ukuran, duplikat: !!d.duplikat });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setStatus({ jenis: "gagal", pesan: "Gak nyambung ke server. Coba lagi." });
    }
  }

  return (
    <section className="unggah-sfile" aria-labelledby="unggahSfileJudul">
      <h2 id="unggahSfileJudul">
        <AsetIkon nama="box" ukuran={20} />
        Unggah file ke sfile
      </h2>
      <p className="hint">Dapet link buat dibagi. Server sfile nolak video/mp4, itu kebijakan ny. Maks 100 MB.</p>
      <form onSubmit={kirim} noValidate>
        <div className="row">
          <label className="pilih-file">
            <input
              ref={inputRef}
              type="file"
              onChange={(e) => pilih(e.target.files?.[0] || null)}
              aria-label="Pilih file buat diunggah"
            />
            <span className="btn">
              <UnggahIkon />
              {file ? file.name : "Pilih file"}
            </span>
          </label>
          <input
            type="text"
            value={deskripsi}
            onChange={(e) => setDeskripsi(e.target.value)}
            placeholder="Deskripsi (opsional)"
            maxLength={550}
            aria-label="Deskripsi file"
          />
          <button type="submit" className="btn primary" disabled={status.jenis === "muat" || !file}>
            {status.jenis === "muat" ? "Nungguh..." : "Unggah"}
          </button>
        </div>
      </form>
      {status.jenis === "muat" && (
        <p className="hint" role="status">
          Lagi ngunggah ke sfile... file gede agak lama.
        </p>
      )}
      {status.jenis === "gagal" && (
        <p className="hint" role="alert" style={{ color: "var(--tanda)" }}>
          {status.pesan}
        </p>
      )}
      {status.jenis === "jadi" && (
        <div className="hasil-upload">
          <p>
            {status.duplikat ? "File ny udah pernah ada, link lama ny dipake." : "Unggahan berhasil."}{" "}
            <b>{status.nama}</b>
            {status.ukuran ? " (" + status.ukuran + ")" : ""}
          </p>
          <div className="row">
            <input type="text" readOnly value={status.shareUrl} aria-label="Link file" onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="btn"
              onClick={() => navigator.clipboard?.writeText(status.shareUrl).catch(() => {})}
            >
              Salin link
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
