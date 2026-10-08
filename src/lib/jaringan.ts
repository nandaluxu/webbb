"use client";

/* Sentinel jaringan global (r27 / P0-1) — dipasang SEKALI di Kerangka.

   MASALAH DIAUDIT: pas web dibuka pas offline (atau sambungan ny
   mati pas halaman lagi kebuka / browser di-freeze bfcache),
   muatSesi cuma jalan sekali di awal -> user tampak logged-out
   selamany, fetch yang kegantung bikin tombol kayak "mati", dan
   gak ada yang nyoba ulang sampe user refresh manual.

   Solusi akar (bukan reload paksa):
   - event `online`            -> cek ulang sesi + siarkan "jaringan:balik"
   - `pageshow` (persisted)    -> page balik dari bfcache: koneksi lama
                                  udah mati duluan, cek ulang + siarkan.
   - `visibilitychange` (nyata)-> cuma nyala pas online; yang diulang
                                  disaring: view ny harus lagi GAGAL
                                  (anti request-storm), sesi cuma dicek
                                  kalau percobaan terakhirny gagal.
   - gagal muat sesi -> retry sendiri pakai backoff eksponensial
     (1s, 2s, 4s, 8s ... maks 30s), reset pas sukses. listener event
     mindahin jadwal backoff (langsung nyoba, gak numpuk).

   View yang punya data sekali-jalan (galeri/profil/leaderboard)
   dengin "jaringan:balik" dan nyoba ulang HANYA kalau state ny lagi
   gagal. Gak ada polling, gak ada reload, gak ada listener dobel
   (pasangJaringan idempoten + Kerangka gak pernah unmount). */

import { muatSesi, sesiGagal } from "@/lib/sesi-pengguna";

const BALIK = "jaringan:balik";
let terpasang = false;
let timerUlang = 0;
let percobaan = 0;
let lagiCek = false;

function siarBalik() {
  window.dispatchEvent(new CustomEvent(BALIK));
}

/* Cek sesi sekali (in-flight guard biar event nyasar gak numpuk
   jadi request kembar). Gagal -> jadwal ulang dengan backoff. */
async function cekSesi() {
  if (lagiCek) return;
  lagiCek = true;
  try {
    await muatSesi();
  } finally {
    lagiCek = false;
  }
  if (!sesiGagal()) {
    percobaan = 0;
    clearTimeout(timerUlang);
    return;
  }
  jadwalUlang();
}

function jadwalUlang() {
  clearTimeout(timerUlang);
  percobaan = Math.min(percobaan + 1, 6);
  const tunda = Math.min(30000, 1000 * 2 ** (percobaan - 1));
  timerUlang = window.setTimeout(cekSesi, tunda);
}

/* Panggil sekali dari Kerangka (idempoten). */
export function pasangJaringan() {
  if (terpasang) return;
  terpasang = true;

  /* Cek pertama + backoff kalau gagal. */
  void cekSesi();

  window.addEventListener("online", () => {
    /* Backoff ny di-skip: koneksi jelas udah balik, cek langsung. */
    clearTimeout(timerUlang);
    void cekSesi();
    siarBalik();
  });

  window.addEventListener("offline", () => {
    /* Gak ada yang di-auto-cancel di sini: fetch yang lagi jalan
       biarin selesai/gagal sendiri (tiap handler ny udah punya
       timeout sendiri). Yang penting gak ada retry spam pas
       offline — jadwalUlang cuma nyala dari hasil cekSesi gagal. */
  });

  window.addEventListener("pageshow", (e) => {
    if (!(e as PageTransitionEvent).persisted) return;
    /* bfcache resume: sambungan + state JS udah lama stale.
       Cek sesi + kasih tau view buat muter ulang data ny (yang
       gagal doang). Ini bukan reload — komponen tetep hidup. */
    clearTimeout(timerUlang);
    void cekSesi();
    siarBalik();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!navigator.onLine) return;
    /* Balik liat tab: cuma beresin sesi kalau emang terakhir gagal
       (kalem kalau semua ny sehat). Data view gak diulang dari sini —
       listener ny sendiri yang mutusin (state gagal doang). */
    if (sesiGagal()) {
      clearTimeout(timerUlang);
      void cekSesi();
      siarBalik();
    }
  });
}
