"use client";

/* Pintu login global (r27 / P2-9, fix31: masuk vs daftar dipisah tegas):
   - MASUK: Username (boleh pake @) + sandi. Validator live juga
     jalan di tab ini (debounce 350ms): username belum terdaftar
     langsung ketahuan SEBELUM submit + ada tombol "Bikin akunny"
     yang mindahin ke tab Daftar (username kebawa).
   - DAFTAR: Username (validator live ketersediaan, debounce 350ms) +
     Nama tampilan (bebas) + sandi (r29: minimal 4 karakter — gak
     ada lagi syarat kapital/simbol; sebagai gantiny ada BAR
     KERAHATAN SANDI 5 level yang live-update).
   - fix31: server nolak masuk ke username baru (404 belum-terdaftar)
     dan nolak daftar ke username lama (409) — pesan ny dibarengin
     tombol aksi "Pindah ke Daftar/Masuk" biar gak bingung.
   - Anonim tetep ada (akun sekali pakai tanpa sandi) — dijadikan
     tombol kecil di bawah biar alurny jelas buat yang gak mau akun.
   Batal = ikon X doang (aria-label + tooltip desktop + fokus
   keyboard). Esc tetep nutup. Sesi di server (cookie httpOnly). */

import { useEffect, useRef, useState } from "react";
import { Merek, Panah, MataIkon, MataTutupIkon, TutupIkon } from "@/components/ikon";
import { useSesi, masuk, tutupPintu, bersihkanGalat } from "@/lib/sesi-pengguna";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";
import { levelSandi, LABEL_LEVEL, MAKS_SANDI_PENDEK } from "@/lib/kekuatan-sandi";

type CekUsername = "idle" | "cek" | "tersedia" | "dipakai" | "invalid" | "galat";

function usernameOk(u: string): boolean {
  return /^[a-z0-9]([a-z0-9_.]{1,18})[a-z0-9]$/.test(u) || /^[a-z0-9]{3,20}$/.test(u);
}

export default function PintuGlobal() {
  const { pintuTerbuka, galat, galatKode, sibuk } = useSesi();
  const [tab, setTab] = useState<"masuk" | "daftar">("masuk");
  const [username, setUsername] = useState("");
  const [namaTampil, setNamaTampil] = useState("");
  const [sandi, setSandi] = useState("");
  const [sandiKlihat, setSandiKlihat] = useState(false);
  const [cek, setCek] = useState<CekUsername>("idle");
  const [pesanCek, setPesanCek] = useState("");
  const timerCek = useRef(0);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pintuTerbuka) return;
    const t = setTimeout(() => {
      setSandi("");
      setSandiKlihat(false);
      usernameRef.current?.focus();
    }, 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") tutupPintu();
    };
    document.addEventListener("keydown", onKey);
    kunciGulir();
    return () => {
      clearTimeout(t);
      clearTimeout(timerCek.current);
      document.removeEventListener("keydown", onKey);
      bukaKunciGulir();
    };
  }, [pintuTerbuka]);

  /* Ganti tab + bersihin galat lama (pesan dari alur sebelumny
     gak boleh nyasar nempel di tab baru). */
  function pindahTab(t: "masuk" | "daftar") {
    setTab(t);
    bersihkanGalat();
  }

  /* Validator ketersediaan username: DEBOUNCE 350ms (bukan tiap
     keypress), jalan di KEDUA tab (fix31 — tab masuk juga perlu
     tau username ny terdaftar apa belom sebelum submit). */
  useEffect(() => {
    clearTimeout(timerCek.current);
    const u = username.trim().replace(/^@+/, "").toLowerCase();
    if (!u) {
      setCek("idle");
      setPesanCek("");
      return;
    }
    if (!usernameOk(u)) {
      setCek("invalid");
      setPesanCek("3-20 karakter: huruf kecil, angka, titik, underscore.");
      return;
    }
    setCek("cek");
    setPesanCek("Ngecek...");
    timerCek.current = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/akun/cek-username?u=" + encodeURIComponent(u));
        const d = await r.json();
        if (!r.ok) throw new Error();
        setCek(d.status === "tersedia" ? "tersedia" : d.status === "dipakai" ? "dipakai" : "invalid");
        setPesanCek(d.status === "tersedia" ? "@" + u + " tersedia." : d.status === "dipakai" ? "@" + u + " udah dipake." : d.pesan || "");
      } catch {
        setCek("galat");
        setPesanCek("Cek ny gagal — coba lagi pas kirim.");
      }
    }, 350);
  }, [username]);

  if (!pintuTerbuka) return null;

  /* Kekuatan sandi (r29): level 0 = gak valid (<4 karakter). */
  const level = levelSandi(sandi);
  const bisaDaftar =
    tab === "daftar" &&
    usernameOk(username.trim().replace(/^@+/, "").toLowerCase()) &&
    cek === "tersedia" &&
    sandi.length >= MAKS_SANDI_PENDEK &&
    namaTampil.trim().length >= 1;

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    /* fix31: niat dikirim eksplisit — tab Masuk gak bikin akun,
       tab Daftar gak nyamar jadi login. */
    const ok = await masuk("akun", username, sandi, tab === "daftar" ? namaTampil.trim() || username : undefined, tab);
    if (ok) mainkanSfx("digital-burst");
    else mainkanSfx("failure");
  }

  async function kirimAnonim(e: React.MouseEvent) {
    e.preventDefault();
    if (await masuk("anonim", username, "")) mainkanSfx("digital-burst");
    else mainkanSfx("failure");
  }

  return (
    <div className="pintu-lapis" role="dialog" aria-modal="true" aria-label="Masuk" onClick={(e) => e.target === e.currentTarget && tutupPintu()}>
      <section className="pintu-kotak" aria-labelledby="pintuJudul">
        <button
          type="button"
          className="pintu-tutup"
          data-sfx="ui-dissolve"
          aria-label="Batal"
          title="Batal"
          onClick={tutupPintu}
        >
          <TutupIkon />
        </button>
        <span className="merek">
          <Merek ukuran={24} />
          Neyhra Playground
        </span>
        <h2 id="pintuJudul">{tab === "masuk" ? "Masuk dulu" : "Bikin akun"}</h2>
        <p>{tab === "masuk" ? "Butuh akun buat chat, upload, nyukain post, atau komen. Browsing tetap bebas." : "Pilih username (idenitas, gak bisa diganti-gampang) + nama tampilan (bebas)."}</p>

        <div className="pintu-tab" role="tablist" aria-label="Mode">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "masuk"}
            className={tab === "masuk" ? "aktif" : ""}
            onClick={() => pindahTab("masuk")}
          >
            Masuk
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "daftar"}
            className={tab === "daftar" ? "aktif" : ""}
            onClick={() => pindahTab("daftar")}
          >
            Daftar
          </button>
        </div>

        <form onSubmit={kirim} noValidate>
          <label className="baris-form" htmlFor="pintuNama">
            Username
          </label>
          <input
            id="pintuNama"
            ref={usernameRef}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="nanda"
            maxLength={25}
            autoComplete={tab === "daftar" ? "off" : "username"}
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="ketUsername"
            inputMode="text"
          />
          <p
            id="ketUsername"
            className={
              "hint kecil " +
              /* Daftar: tersedia = baik, dipakai = jelek.
                 Masuk: kebaliknya — terdaftar = baik, belum ada = jelek. */
              (tab === "daftar"
                ? cek === "tersedia"
                  ? "hint-baik"
                  : cek === "dipakai" || cek === "invalid"
                    ? "hint-jelek"
                    : ""
                : cek === "dipakai"
                  ? "hint-baik"
                  : cek === "tersedia" || cek === "invalid"
                    ? "hint-jelek"
                    : "")
            }
            aria-live="polite"
          >
            {tab === "daftar"
              ? pesanCek || "Huruf kecil, angka, titik, underscore. Boleh pake @ di depan."
              : cek === "tersedia"
                ? "@" + username.trim().replace(/^@+/, "").toLowerCase() + " belum terdaftar."
                : cek === "dipakai"
                  ? "@" + username.trim().replace(/^@+/, "").toLowerCase() + " terdaftar — tinggal isi sandi."
                  : cek === "invalid"
                    ? pesanCek
                    : cek === "cek"
                      ? "Ngecek..."
                      : cek === "galat"
                        ? pesanCek
                        : "Boleh pake @ di depan. username lama = nama akun lu (huruf gak ngaruh)."}
            {tab === "masuk" && cek === "tersedia" && (
              <>
                {" "}
                <button type="button" className="pintu-galat-aksi" onClick={() => pindahTab("daftar")}>
                  Bikin akunny
                </button>
              </>
            )}
          </p>

          {tab === "daftar" && (
            <>
              <label className="baris-form" htmlFor="pintuTampil">
                Nama tampilan
              </label>
              <input
                id="pintuTampil"
                type="text"
                value={namaTampil}
                onChange={(e) => setNamaTampil(e.target.value)}
                placeholder="Nanda (bebas, spasi boleh)"
                maxLength={24}
                autoComplete="nickname"
              />
            </>
          )}

          <label className="baris-form" htmlFor="pintuSandi">
            Sandi
          </label>
          <div className="baris-sandi">
            <input
              id="pintuSandi"
              type={sandiKlihat ? "text" : "password"}
              value={sandi}
              onChange={(e) => setSandi(e.target.value)}
              placeholder={tab === "daftar" ? "Minimal 4 karakter" : "Sandi lu"}
              autoComplete={tab === "daftar" ? "new-password" : "current-password"}
              aria-describedby={tab === "daftar" ? "ketSandi" : undefined}
            />
            <button
              id="tombolMata"
              type="button"
              className="tombol-mata"
              aria-label={sandiKlihat ? "Sembunyikan sandi" : "Lihat sandi"}
              aria-pressed={sandiKlihat}
              onClick={() => setSandiKlihat((v) => !v)}
            >
              {sandiKlihat ? <MataTutupIkon /> : <MataIkon />}
            </button>
          </div>

          {/* Bar kekuatan sandi (r29): live-update tiap ketikan.
              Level 1-5 (Sangat lemah..Sangat kuat), 5 blok. Kosong /
              gak valid = bar kempis + hint minimal. Kapital/angka/
              simbol/panjang cuma nambahin level, BUKAN syarat. */}
          {tab === "daftar" && (
            <div id="ketSandi" className="sandi-bar" aria-live="polite">
              <div className="sandi-bar-isi" data-level={level} aria-hidden="true">
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={"blok" + (i <= level ? " isi" : "") + " l" + level} />
                ))}
              </div>
              <span className={"sandi-bar-label l" + level}>
                {sandi ? (level > 0 ? LABEL_LEVEL[level] : "Kurang dari " + MAKS_SANDI_PENDEK + " karakter") : "Minimal " + MAKS_SANDI_PENDEK + " karakter — makin variasi, makin kuat"}
              </span>
            </div>
          )}

          <div className="row" style={{ marginTop: 18 }}>
            <button type="submit" className="btn primary" disabled={sibuk || (tab === "daftar" && !bisaDaftar)}>
              {sibuk ? "Ngecek..." : tab === "masuk" ? "Masuk" : cek === "tersedia" ? "Daftar" : "Daftar"}
              <Panah />
            </button>
          </div>
          {galat ? (
            <p className="hint" role="alert" style={{ color: "var(--tanda)" }}>
              {galat}
              {/* fix31: aksi langsung dari pesan galat — masuk ke akun
                  yang belom ada = ajak daftar; daftar yang udah ada =
                  ajak masuk. Username kebawa, gak ngetik ulang. */}
              {tab === "masuk" && galatKode === "belum-terdaftar" && (
                <button type="button" className="pintu-galat-aksi" onClick={() => pindahTab("daftar")}>
                  Pindah ke Daftar
                </button>
              )}
              {tab === "daftar" && galatKode === "sudah-terdaftar" && (
                <button type="button" className="pintu-galat-aksi" onClick={() => pindahTab("masuk")}>
                  Pindah ke Masuk
                </button>
              )}
            </p>
          ) : (
            <p className="hint">username + sandi ny disimpen server; sandi ny di-hash, gak ada yang bisa baca.</p>
          )}
        </form>

        <div className="pintu-anonim">
          <button type="button" className="pintu-tautan" onClick={kirimAnonim} disabled={sibuk}>
            Gak mau akun? Masuk anonim pake nama {username.trim() ? '"' + username.trim() + '"' : "bebas"}
          </button>
          <p className="hint kecil">Anonim gak pakai sandi, cuma sekali pakai di browser ini.</p>
        </div>
      </section>
    </div>
  );
}
