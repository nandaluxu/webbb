"use client";

/* Ney AI: obrolan dengan AI pribadi Neyhra. Nama penyedia AI ny
   sengaja gak ditulis di mana-mana di web ini.
   - Jawaban ngalir kata demi kata (SSE dari /api/ai).
   - Sesi obrolan + riwayat disimpen di browser, jadi percakapan
     nyambung walau halaman ditutup.
   - "Obrolan baru" mutus sesi lama dan mulai dari nol.
   - Menu aksi pesan (long-press HP / klik kanan desktop): Salin
     (format [DD/MM, HH:mm] nama: teks, helper yang sama kayak chat
     global + komentar), Hapus (dari riwayat lokal, bukan server),
     dan Laporkan buat jawaban Ney (masuk dashboard owner). */

import { useCallback, useEffect, useRef, useState } from "react";
import { Merek, KirimIkon, TutupIkon, Panah, SalinIkon, HapusIkon, LaporIkon, CentangIkon } from "@/components/ikon";
import MenuAksi, { useTekanLama, type AksiItem } from "@/components/MenuAksi";
import Konfirmasi from "@/components/Konfirmasi";
import { bacaRiwayatAI, bacaSesiAI, hapusSesiAI, simpanRiwayatAI, simpanSesiAI, type RiwayatAI, type SesiAILokal } from "@/lib/pengguna";
import { buatTeksEksporAI, namaFileEksporAI, unduhTxt } from "@/lib/ekspor-ai";
import { useSesi, bukaPintu } from "@/lib/sesi-pengguna";
import { mainkanSfx } from "@/lib/suara";
import { formatSalin, salinTeks } from "@/lib/salin-chat";

export default function ChatAI() {
  const [siap, setSiap] = useState(false);
  const [riwayat, setRiwayat] = useState<RiwayatAI[]>([]);
  const [alir, setAlir] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [nilai, setNilai] = useState("");
  /* Menu aksi pesan riwayat (index di array riwayat). */
  const [menu, setMenu] = useState<{ x: number; y: number; idx: number } | null>(null);
  const [konfirmLapor, setKonfirmLapor] = useState<number | null>(null);
  const [sibukAksi, setSibukAksi] = useState(false);
  const [umpan, setUmpan] = useState<string | null>(null);
  const umpanTimer = useRef(0);
  const { siap: sesiSiap, masuk, pengguna } = useSesi();

  const sesiRef = useRef<SesiAILokal | null>(null);
  const batalRef = useRef<AbortController | null>(null);
  const daftarRef = useRef<HTMLDivElement>(null);
  const diBawah = useRef(true);

  useEffect(() => {
    setRiwayat(bacaRiwayatAI());
    sesiRef.current = bacaSesiAI();
    setSiap(true);
  }, []);

  useEffect(() => {
    if (diBawah.current) {
      const el = daftarRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: riwayat.length > 3 ? "smooth" : "auto" });
    }
  }, [riwayat, alir]);

  function cekPosisiScroll() {
    const el = daftarRef.current;
    if (!el) return;
    diBawah.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  }

  const simpan = useCallback((baru: RiwayatAI[]) => {
    setRiwayat(baru);
    simpanRiwayatAI(baru);
  }, []);

  const kabar = useCallback((teks: string) => {
    setUmpan(teks);
    clearTimeout(umpanTimer.current);
    umpanTimer.current = window.setTimeout(() => setUmpan(null), 2400);
  }, []);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    const teks = nilai.trim().slice(0, 2000);
    if (!teks || sibuk) return;
    setNilai("");
    setGalat(null);
    const baru = [...riwayat, { peran: "aku" as const, teks, waktu: Date.now() }];
    simpan(baru);
    setSibuk(true);
    setAlir("");
    diBawah.current = true;

    const ctrl = new AbortController();
    batalRef.current = ctrl;
    let teksJawaban = "";
    let galatPesan: string | null = null;

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: teks, sesi: sesiRef.current }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error("Server AI ny gak menjawab (HTTP " + res.status + ").");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data: ")) continue;
          const muatan = t.slice(6);
          if (muatan === "[DONE]") continue;
          try {
            const data = JSON.parse(muatan);
            if (typeof data.teks === "string") {
              teksJawaban = data.teks;
              setAlir(data.teks);
            }
            if (data.selesai && data.sesi) {
              sesiRef.current = data.sesi;
              simpanSesiAI(data.sesi);
            }
            if (data.galat) galatPesan = data.galat;
          } catch {
            /* baris yang gak kebaca: skip */
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        galatPesan = err instanceof Error ? err.message : "Ada yang salah pas manggil AI ny.";
      }
    }

    batalRef.current = null;
    setAlir(null);
    setSibuk(false);

    if (galatPesan) {
      setGalat(galatPesan);
      mainkanSfx("failure");
      /* Pesan user ny udah kesimpen; jawabannya gagal, biarin user kirim ulang. */
      if (!teksJawaban) {
        simpan(baru.filter((m) => m.teks !== teks || m.peran !== "aku"));
        setNilai(teks);
      }
    } else if (teksJawaban) {
      simpan([...baru, { peran: "ney", teks: teksJawaban, waktu: Date.now() }]);
    }
  }

  function obrolanBaru() {
    hapusSesiAI();
    sesiRef.current = null;
    setRiwayat([]);
    setAlir(null);
    setGalat(null);
    setMenu(null);
  }

  /* Ekspor semua chat ke .txt (r29): data ny 100% dari browser
     (localStorage) — gak ada request server, gak mungkin nyentuh
     punya orang. Kosong = kasih tau, gak bikin file. Download via
     Blob + <a download> (gak buka tab baru). */
  function eksporChat() {
    if (riwayat.length === 0) {
      kabar("Belum ada obrolan buat diekspor");
      mainkanSfx("failure");
      return;
    }
    const kini = new Date();
    const isi = buatTeksEksporAI([{ judul: "Ney — AI Neyhra", pesan: riwayat }], kini);
    const ok = unduhTxt(namaFileEksporAI(kini), isi);
    if (ok) {
      kabar("Chat diekspor ke " + namaFileEksporAI(kini));
      mainkanSfx("notification");
    } else {
      kabar("Gagal bikin file ekspor");
      mainkanSfx("failure");
    }
  }

  /* ---------- Aksi pesan riwayat ---------- */

  function namaPesan(m: RiwayatAI): string {
    return m.peran === "aku" ? pengguna?.nama || "Gw" : "Ney";
  }

  async function salinPesan(idx: number) {
    const m = riwayat[idx];
    if (!m) return;
    const teks = formatSalin({ nama: namaPesan(m), teks: m.teks, waktu: m.waktu ?? NaN });
    const ok = await salinTeks(teks);
    if (ok) {
      kabar("Pesan tersalin");
      mainkanSfx("notification");
    } else {
      kabar("Clipboard ny keblokir browser");
      mainkanSfx("failure");
    }
  }

  function hapusPesan(idx: number) {
    simpan(riwayat.filter((_, i) => i !== idx));
    mainkanSfx("ui-dissolve");
  }

  async function jalankanLapor() {
    if (konfirmLapor === null) return;
    const m = riwayat[konfirmLapor];
    setSibukAksi(true);
    try {
      const r = await fetch("/api/laporan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jenis: "ai", konteks: m?.teks ?? "" }),
      });
      if (r.ok) {
        kabar("Laporan terkirim ke owner");
        mainkanSfx("notification");
      } else {
        kabar("Gagal kirim laporan");
        mainkanSfx("failure");
      }
    } catch {
      kabar("Gak nyambung ke server");
      mainkanSfx("failure");
    } finally {
      setSibukAksi(false);
      setKonfirmLapor(null);
    }
  }

  function itemMenu(idx: number): AksiItem[] {
    const m = riwayat[idx];
    const isi: AksiItem[] = [
      { id: "salin", label: "Salin", ikon: <SalinIkon ukuran={15} />, onKlik: () => salinPesan(idx) },
      { id: "hapus", label: "Hapus", ikon: <HapusIkon ukuran={15} />, bahaya: true, onKlik: () => hapusPesan(idx) },
    ];
    if (m?.peran === "ney") {
      isi.push({ id: "lapor", label: "Laporkan", ikon: <LaporIkon ukuran={15} />, onKlik: () => setKonfirmLapor(idx) });
    }
    return isi;
  }

  if (!siap || !sesiSiap) return null;

  if (!masuk || !pengguna) {
    return (
      <section className="pintu">
        <span className="merek">
          <Merek ukuran={24} />
          Neyhra Playground
        </span>
        <h2>Kenalan dulu sama Ney</h2>
        <p>Chat AI butuh login, biar Ney tau harus nyapa siapa. Obrolan lo disimpen di browser sendiri, gak ke mana-mana.</p>
        <p>
          <button type="button" className="btn primary" onClick={bukaPintu}>
            Masuk
            <Panah />
          </button>
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="head">
        <h1>Ney AI</h1>
        <p className="lede">
          Ngobrol sama Ney, AI pribadi Neyhra. Tanya apa aja, dari bantuin tugas sampai nyari ide. Obrolanny
          nyambung terus, jadi gak mulai dari nol tiap kali balik.
        </p>
      </section>

      <div className="tamu-bar">
        <span className="siapa">
          <Merek ukuran={18} />
          Halo <b>{pengguna.nama}</b>
        </span>
        <span className="tamu-aksi">
          <button type="button" className="ganti" onClick={eksporChat} title="Simpen semua obrolan jadi file .txt">
            Ekspor chat
          </button>
          <button type="button" className="ganti" onClick={obrolanBaru}>
            obrolan baru
          </button>
        </span>
      </div>

      <div className="ruang">
        <div className="ruang-kepala">
          <div className="judul">
            <h2>Ney</h2>
            <p>AI buatan Neyhra, tinggal nanya</p>
          </div>
          <div className="status-kanan">
            <span className="ai-kartu">
              <Merek ukuran={12} />
              AI Neyhra
            </span>
          </div>
        </div>

        <div className="daftar-chat" ref={daftarRef} onScroll={cekPosisiScroll}>
          {riwayat.length === 0 && alir === null && !sibuk && (
            <div className="kosong">
              Belum ada obrolan. Ketik apa aja di bawah, <b>Ney jawab kok</b>.
            </div>
          )}
          {riwayat.map((m, i) => (
            <BarisAI key={i} idx={i} peran={m.peran} teks={m.teks} onMenu={(x, y) => setMenu({ x, y, idx: i })} />
          ))}
          {sibuk && (alir === null || alir === "") && (
            <div className="bar-menulis">
              Ney mikir
              <span className="ketik" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
          {alir !== null && alir !== "" && <BarisAI idx={-1} peran="ney" teks={alir} mengalir />}
          {umpan && (
            <div className="chip-turun">
              <span className="chip-umpan" role="status">
                <CentangIkon ukuran={12} />
                {umpan}
              </span>
            </div>
          )}
        </div>

        {galat && (
          <div className="gagal" role="alert" style={{ margin: "12px 18px" }}>
            <h2>Jawabanny gagal kebaca</h2>
            <p>{galat}</p>
          </div>
        )}

        <form className="komposer" onSubmit={kirim} noValidate>
          <input
            id="inputAI"
            type="text"
            value={nilai}
            onChange={(e) => setNilai(e.target.value)}
            placeholder="Tanya apa aja..."
            aria-label="Pesan untuk Ney"
            maxLength={2000}
            autoComplete="off"
            disabled={sibuk}
          />
          {sibuk ? (
            <button
              type="button"
              className="btn"
              onClick={() => batalRef.current?.abort()}
              aria-label="Berhenti menunggu jawaban"
            >
              <TutupIkon />
              <span>Berhenti</span>
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={!nilai.trim()} aria-label="Kirim pesan">
              <KirimIkon />
            </button>
          )}
        </form>
      </div>

      {menu && menu.idx >= 0 && (
        <MenuAksi x={menu.x} y={menu.y} items={itemMenu(menu.idx)} onTutup={() => setMenu(null)} />
      )}

      {konfirmLapor !== null && (
        <Konfirmasi
          judul="Laporkan jawaban Ney ini?"
          pesan="Laporan ny nyampe ke owner beserta isi jawaban ny, biar bisa dicek dan dibenerin kalau emang nyeleneh."
          labelYakin="Laporkan"
          sibuk={sibukAksi}
          onYakin={jalankanLapor}
          onBatal={() => setKonfirmLapor(null)}
        />
      )}
    </>
  );
}

function BarisAI({
  peran,
  teks,
  mengalir,
  idx,
  onMenu,
}: {
  peran: "aku" | "ney";
  teks: string;
  mengalir?: boolean;
  /* idx >= 0 = pesan riwayat (bisa dibuka menu aksi ny). idx -1 =
     pesan yang lagi streaming (belum ada aksi). */
  idx: number;
  onMenu?: (x: number, y: number) => void;
}) {
  const aku = peran === "aku";
  const tekan = useTekanLama((x, y) => {
    if (onMenu && idx >= 0 && !mengalir) onMenu(x, y);
  });
  return (
    <div className={"baris-pesan" + (aku ? " sendiri" : "") + (mengalir ? "" : " baru")} {...(idx >= 0 && !mengalir ? tekan : {})}>
      <div className="badan-pesan">
        {!aku && (
          <div className="kepala-pesan">
            <span className="nama">Ney</span>
          </div>
        )}
        <div className={"gelembung" + (mengalir ? " mengalir" : "")}>
          <span className="isi-pesan">{teks}</span>
        </div>
      </div>
    </div>
  );
}
