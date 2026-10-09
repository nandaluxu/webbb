"use client";

/* Pengaturan: tema + suara + ukuran chat + custom emoji, semuany
   preferensi lokal (browser sendiri). Perubahan langsung kerasa:
   tema langsung ganti, backsound langsung bunyi/berhenti, ukuran
   chat langsung ganti nyaris tanpa repaint, custom emoji
   aktif/mati tanpa reload. */

import { useState, useSyncExternalStore } from "react";
import { Matahari, Bulan, NadaIkon, EmojiIkon } from "@/components/ikon";
import Saklar from "@/components/Saklar";
import { useSuara, setBack, setVolume, setSfx, bangunkanAudio, mainkanSfx } from "@/lib/suara";
import {
  bacaKeadaan,
  keadaanServer,
  langgananEmoji,
  simpanStatus,
  aktifkanFontEmoji,
  matikanFontEmoji,
} from "@/lib/emoji-font";

const KUNCI_TEMA = "neyhra:tema";
const KUNCI_UKURAN = "neyhra:ukuran-chat";

/* fix31: rasa tiap gaya tampilan — dipisah dari paragraf dinding
   lama, ditampilkan cuma buat gaya yang lagi dipilih. */
const KET_UI: Record<string, string> = {
  klasik: "Klasik — tampilan biasa situs.",
  swiss: "Swiss Zen — tulisan tipis, garis 1px, kartu tanpa bayangan.",
  japandi: "Japandi — warna linen & kayu, sudut membulat, permukaan lembut.",
  hanami: "Hanami — putih kelopak, garis tipis, sakura berjatuhan di latar.",
};

function terapkanTema(t: "terang" | "gelap") {
  document.documentElement.dataset.tema = t;
  try {
    window.localStorage.setItem(KUNCI_TEMA, t);
  } catch {}
  window.dispatchEvent(new CustomEvent("tema:ubah", { detail: { tema: t } }));
}

/* Tema dibaca dari DOM (sumber kebenaran ny) + langganan event
   tema:ubah, jadi tombol tema di masthead sama tombol di sini saling
   nyambung tanpa efek yang nge-set state. */
function langgananTema(f: () => void) {
  window.addEventListener("tema:ubah", f);
  return () => window.removeEventListener("tema:ubah", f);
}

function useTemaSekarang(): "terang" | "gelap" {
  return useSyncExternalStore(
    langgananTema,
    () => (document.documentElement.dataset.tema === "gelap" ? "gelap" : "terang"),
    () => "terang" as const
  );
}

/* ---------- Ukuran chat (r19) ----------
   Sumber kebenaran ny dataset di <html> (di-set oleh inline script
   layout.tsx sebelum render), pola yang sama kayak tema: gak ada
   state React yang menduplikasi. */
type UkuranChat = "kecil" | "sedang" | "besar";

function terapkanUkuran(u: UkuranChat) {
  document.documentElement.dataset.chatSize = u;
  try {
    window.localStorage.setItem(KUNCI_UKURAN, u);
  } catch {}
  window.dispatchEvent(new CustomEvent("ukuranchat:ubah", { detail: { ukuran: u } }));
}

function langgananUkuran(f: () => void) {
  window.addEventListener("ukuranchat:ubah", f);
  return () => window.removeEventListener("ukuranchat:ubah", f);
}

function bacaUkuran(): UkuranChat {
  const u = document.documentElement.dataset.chatSize;
  return u === "kecil" || u === "sedang" ? u : "besar";
}

function useUkuranSekarang(): UkuranChat {
  return useSyncExternalStore(langgananUkuran, bacaUkuran, () => "besar" as const);
}

/* ---------- Gaya UI (fix29): Klasik vs Swiss Zen vs Japandi ----------
   Sumber kebenaran ny dataset.ui di <html> (di-set oleh inline
   script layout.tsx sebelum render), pola yang sama kayak tema
   + ukuran chat: gak ada state React yang menduplikasi. Swiss
   Zen = lapisan CSS buatan pemilik (swiss-zen.css) — grid ketat,
   hairline 1px, ruang lega, tanpa bayangan. */
type GayaUI = "klasik" | "swiss" | "japandi" | "hanami";
const KUNCI_UI = "neyhra:ui";

function terapkanUI(g: GayaUI) {
  document.documentElement.dataset.ui = g;
  try {
    window.localStorage.setItem(KUNCI_UI, g);
  } catch {}
  window.dispatchEvent(new CustomEvent("ui:ubah", { detail: { ui: g } }));
}

function langgananUI(f: () => void) {
  window.addEventListener("ui:ubah", f);
  return () => window.removeEventListener("ui:ubah", f);
}

function bacaUI(): GayaUI {
  const u = document.documentElement.dataset.ui;
  return u === "swiss" || u === "japandi" || u === "hanami" ? u : "klasik";
}

function useUISekarang(): GayaUI {
  return useSyncExternalStore(langgananUI, bacaUI, () => "klasik" as const);
}

export default function Pengaturan() {
  const { back, volume, sfx } = useSuara();
  const tema = useTemaSekarang();
  const ui = useUISekarang();
  const ukuran = useUkuranSekarang();
  /* Keadaan emoji: state modul lib (satu sumber kebenaran) + event
     emoji:ubah, pola yang sama kayak tema (gak ada state React
     yang menduplikasi). */
  const emoji = useSyncExternalStore(langgananEmoji, bacaKeadaan, keadaanServer);
  const [emojiGalat, setEmojiGalat] = useState<string | null>(null);

  /* Nyalain custom emoji: langsung aktif dari cache kalo file ny
     udah pernah diunduh; belum ada -> unduh SEKALI dengan status
     jujur (bar progres di bawah saklar). 35MB gak pernah diunduh
     diam-diam: unduhan cuma jalan pas saklar ny DINYALAIN user. */
  async function nyalakanEmoji() {
    setEmojiGalat(null);
    simpanStatus("on");
    try {
      await aktifkanFontEmoji();
      mainkanSfx("notification");
    } catch {
      setEmojiGalat("Gagal mengunduh.");
      mainkanSfx("failure");
    }
  }

  function matikanEmoji() {
    simpanStatus("off");
    matikanFontEmoji();
  }

  return (
    <>
      <section className="head">
        <h1>Pengaturan</h1>
        <p className="lede">Preferensi kecil-kecil gini: biar web ny kerasa punya lu. Semuany kesimpen di browser lu, gak dikirim ke mana-mana.</p>
      </section>

      <section className="atur-blok" aria-labelledby="aturTema">
        <h2 id="aturTema">Tampilan</h2>
        <div className="atur-baris">
          <span className="atur-ket">
            Tema terang (kertas) atau gelap (tinta). Biasany ikutin setelan HP/komputer lu sampai lu milih sendiri.
          </span>
          <div className="pilihan-tema" role="group" aria-label="Pilih tema">
            <button
              type="button"
              className={"btn kecil" + (tema === "terang" ? " primary" : "")}
              aria-pressed={tema === "terang"}
              onClick={() => terapkanTema("terang")}
            >
              <Matahari />
              Terang
            </button>
            <button
              type="button"
              className={"btn kecil" + (tema === "gelap" ? " primary" : "")}
              aria-pressed={tema === "gelap"}
              onClick={() => terapkanTema("gelap")}
            >
              <Bulan />
              Gelap
            </button>
          </div>
        </div>
        <div className="atur-baris">
          <span className="atur-ket">
            Gaya tampilan situs — ruang obrol, game Tic Tac Toe + 2048, sama dropdown ikut keganti. Balik ke Klasik kapan aja.
          </span>
          <div className="pilihan-tema" role="group" aria-label="Pilih gaya tampilan">
            <button
              type="button"
              className={"btn kecil" + (ui === "klasik" ? " primary" : "")}
              aria-pressed={ui === "klasik"}
              onClick={() => terapkanUI("klasik")}
            >
              Klasik
            </button>
            <button
              type="button"
              className={"btn kecil" + (ui === "swiss" ? " primary" : "")}
              aria-pressed={ui === "swiss"}
              onClick={() => terapkanUI("swiss")}
            >
              Swiss Zen
            </button>
            <button
              type="button"
              className={"btn kecil" + (ui === "japandi" ? " primary" : "")}
              aria-pressed={ui === "japandi"}
              onClick={() => terapkanUI("japandi")}
            >
              Japandi
            </button>
            <button
              type="button"
              className={"btn kecil" + (ui === "hanami" ? " primary" : "")}
              aria-pressed={ui === "hanami"}
              onClick={() => terapkanUI("hanami")}
            >
              Hanami
            </button>
          </div>
        </div>
        {/* fix31: deskripsi 4 tema gak lagi numpuk jadi paragraf
            dinding — sekarang nyebutin gaya yang LAGI DIPILIK aja
            (ikut ganti pas tombol ny dipencet). */}
        <p className="atur-ket-kecil" aria-live="polite">
          {KET_UI[ui] ?? KET_UI.klasik} Tema terang/gelap di atas tetep jalan di semua gaya.
        </p>
        <div className="atur-baris">
          <span className="atur-ket">
            Ukuran tulisan chat (gelembung, balasan, jam, jarak antar pesan). Kecil = muat banyak obrolan, besar = enak dibaca.
          </span>
          <div className="pilihan-tema" role="group" aria-label="Pilih ukuran chat">
            <button
              type="button"
              className={"btn kecil" + (ukuran === "kecil" ? " primary" : "")}
              aria-pressed={ukuran === "kecil"}
              onClick={() => terapkanUkuran("kecil")}
            >
              Kecil
            </button>
            <button
              type="button"
              className={"btn kecil" + (ukuran === "sedang" ? " primary" : "")}
              aria-pressed={ukuran === "sedang"}
              onClick={() => terapkanUkuran("sedang")}
            >
              Sedang
            </button>
            <button
              type="button"
              className={"btn kecil" + (ukuran === "besar" ? " primary" : "")}
              aria-pressed={ukuran === "besar"}
              onClick={() => terapkanUkuran("besar")}
            >
              Besar
            </button>
          </div>
        </div>
      </section>

      <section className="atur-blok" aria-labelledby="aturSuara">
        <h2 id="aturSuara">
          <NadaIkon ukuran={18} />
          Suara
        </h2>
        <div className="atur-baris">
          <span className="atur-ket">Backsound ruang galeri: pelan, nyaman, gak ganggu. Mati total kalau lu gak suka.</span>
          <button
            type="button"
            className={"btn kecil" + (back ? " primary" : "")}
            aria-pressed={back}
            onClick={() => {
              bangunkanAudio();
              setBack(!back);
            }}
          >
            {back ? "Pause" : "Putar"}
          </button>
        </div>
        <div className="atur-baris">
          <label className="atur-ket" htmlFor="aturVolume">
            Volume
          </label>
          <input
            id="aturVolume"
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              bangunkanAudio();
              setVolume(Number(e.target.value) / 100);
            }}
          />
        </div>
        <div className="atur-baris">
          <span className="atur-ket">Efek suara ringan pas buka menu, nyuka post, atau upload berhasil.</span>
          <Saklar
            label="Efek suara"
            nyala={sfx}
            onUbah={(jadi) => {
              bangunkanAudio();
              setSfx(jadi);
              if (jadi) mainkanSfx("notification");
            }}
          />
        </div>
      </section>

      <section className="atur-blok" aria-labelledby="aturVideo">
        <h2 id="aturVideo">Video</h2>
        <div className="atur-baris">
          <span className="atur-ket">
            Post video langsung muter pas dibuka. Kalau browser nolak autoplay yang ada suaranya, video ny dimute-in
            otomatis + muncul tombol suara — bisu/nyala-suara ny keinget dari video sebelumnya (tombol di video ny
            sendiri, bukan di sini).
          </span>
        </div>
      </section>

      <section className="atur-blok" aria-labelledby="aturEmoji">
        <h2 id="aturEmoji">
          <EmojiIkon ukuran={18} />
          Emoji
        </h2>
        <div className="atur-baris">
          <span className="atur-ket">Emoji warna pake font tambahan; nyala-in kalau perlu.</span>
          <Saklar label="Emoji kustom" nyala={emoji.status === "on"} onUbah={(jadi) => (jadi ? nyalakanEmoji() : matikanEmoji())} />
        </div>

        {emoji.mengunduh && (
          <div className="atur-status">
            <p className="atur-status-teks" role="status">
              {emoji.fase === "menyiapkan"
                ? "Mengunduh emoji…"
                : emoji.fase === "terukur"
                  ? "Mengunduh emoji… " + Math.round(emoji.progres * 100) + "%"
                  : "Mengunduh emoji… " + (emoji.diterima / 1048576).toFixed(1) + " MB"}
            </p>
            <div className="atur-progres">
              {emoji.fase === "terukur" ? (
                <div
                  className="progres-unggah"
                  role="progressbar"
                  aria-valuenow={Math.round(emoji.progres * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progres unduhan emoji"
                >
                  <div className="progres-bar" style={{ width: Math.round(emoji.progres * 100) + "%" }} />
                  <span className="progres-teks">{Math.round(emoji.progres * 100)}%</span>
                </div>
              ) : (
                /* Total gak ketahui: bar indeterminate (gelombang
                   ter-clip di dalem track) + byte ASLI yang udah
                   nyampe, gak ada persen bohong. */
                <div className="progres-unggah tak-diketahui" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-label="Progres unduhan emoji">
                  <div className="progres-gel" aria-hidden="true" />
                  <span className="progres-teks">{(emoji.diterima / 1048576).toFixed(1)} MB</span>
                </div>
              )}
            </div>
          </div>
        )}

        {emoji.status === "on" && emoji.aktif && !emoji.mengunduh && (
          <p className="atur-status-teks" role="status">
            Emoji siap digunakan <b className="atur-pratinjau">😀 🎉</b>
          </p>
        )}

        {emoji.status === "on" && !emoji.aktif && !emoji.mengunduh && emojiGalat && (
          <p className="hint" role="alert">
            Gagal mengunduh.{" "}
            <button type="button" className="tautan-kecil" onClick={() => nyalakanEmoji()}>
              Coba lagi
            </button>
          </p>
        )}
      </section>
    </>
  );
}
