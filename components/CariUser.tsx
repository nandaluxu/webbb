"use client";

/* Cari user: kotak pencarian nama, hasil ny link ke profil orang ny. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CariIkon, OrangIkon, LencanaVerified } from "@/components/ikon";

type UserKecil = { id: string; nama: string; username: string | null; jenis: string; pfp: string | null; verified: boolean };

export default function CariUser() {
  const [q, setQ] = useState("");
  const [daftar, setDaftar] = useState<UserKecil[] | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    const isi = q.trim();
    if (isi.length < 1) {
      timer.current = window.setTimeout(() => setDaftar(null), 0);
      return () => window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(async () => {
      setSibuk(true);
      try {
        const r = await fetch("/api/pengguna?q=" + encodeURIComponent(isi), { cache: "no-store" });
        const d = await r.json();
        setDaftar(r.ok ? d.daftar : []);
      } catch {
        setDaftar([]);
      }
      setSibuk(false);
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [q]);

  return (
    <div className="cari-user" role="search" aria-label="Cari user">
      <div className="row">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari nama user..."
          aria-label="Nama yang dicari"
          minLength={1}
        />
        <span className="ikon-cari" aria-hidden="true">
          {sibuk ? <span className="bar" /> : <CariIkon />}
        </span>
      </div>
      {daftar !== null && (
        <ul className="daftar-user">
          {daftar.length === 0 && <li className="user-kosong">Gak ada user yang namany ngandung "{q.trim()}".</li>}
          {daftar.map((u) => (
            <li key={u.id}>
              <Link href={"/profil/" + encodeURIComponent(u.username ?? u.nama)}>
                {u.pfp ? (
                  <img
                    src={"/api/pfp/" + u.id + "?v=" + encodeURIComponent(u.pfp)}
                    alt=""
                    width={28}
                    height={28}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="du-inisial" aria-hidden="true">
                    <OrangIkon ukuran={14} />
                  </span>
                )}
                <b>
                  {u.username ? (
                    <>
                      <span className="du-nama">
                        <span className="du-nama-teks">{u.nama}</span>
                        {u.verified && <LencanaVerified />}
                      </span>
                      <span className="du-handle">@{u.username}</span>
                    </>
                  ) : (
                    <span className="du-nama">
                      <span className="du-nama-teks">{u.nama}</span>
                      {u.verified && <LencanaVerified />}
                    </span>
                  )}
                </b>
                {u.jenis === "anonim" && <span className="du-jenis">anonim</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
