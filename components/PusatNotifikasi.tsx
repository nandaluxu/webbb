"use client";

/* PusatNotifikasi (r28, dirework r29): ikon mail di masthead (cuma
   buat yang login, posisinya: backsound -> MAIL -> menu) + drawer
   aktivitas.

   Isi: log aktivitas yang relevan ke user — LIKE / FOLLOW / MENTION
   (model Notifikasi di server, BUKAN state client sementara).
   - Terbaru duluan + badge jumlah belum-dibaca di ikon.
   - Klik item: tandain dibaca + navigasi ke konteks ny (LIKE/MENTION
     -> /post/<id>, FOLLOW -> /profil/<username>). Aktor udah hapus
     akun / post udah kehapus -> item tetep kebaca, TANPA link nyasar.
   - "Tandai semua dibaca" + state kosong.
   - Pengambilan data: saat mount, saat buka, pas window fokus lagi,
     dan pas jaringan balik (gak ada polling diam-diam).

   r29:
   - MODE PILIH (kayak chat): long-press (HP) / klik kanan (desktop)
     -> masuk mode pilih + item ny langsung kepilih. Baris jadi
     tombol togel, checkbox muncul. Bar aksi: n dipilih + Pilih
     semua + Salin + Hapus + Batal. Esc di mode pilih = batal dulu
     (sebelum nutup drawer).
   - SWIPE KIRI->KANAN (HP, di luar mode pilih): geser item ke kanan
     -> muncul indikasi hapus (ikon + latar) -> lepasin lewat
     threshold = hapus SATU item (optimistic + rollback kalau
     request ny gagal). Gerakan vertikal gak keganggu (intent
     horizontal dicek duluan + touch-action pan-y).
   - READ STATE (audit): cuma KLIK item yang nandain dibaca; render
     list gak otomatis nandain; salin gak ngubah read state; abis
     hapus (satu/banyak) jumlah belum-dibaca dihitung ulang (dari
     respons server).
   - Spacing ny lebih lega (padding/gap dinaikin, separator kasih
     ruang, timestamp punya kolom sendiri) — compact tapi gak sesak.

   Struktur drawer + focus trap + Esc + kunci gulir ny nutur MenuSisa
   (pola yang udah ada), kelas CSS ny juga dipake bareng. */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SuratIkon, TutupIkon, OrangIkon, LencanaVerified, CentangIkon, SukaOutlineIkon, PanahKeluar, HapusIkon, SalinIkon, PilihIkon } from "@/components/ikon";
import { useTekanLama } from "@/components/MenuAksi";
import Konfirmasi from "@/components/Konfirmasi";
import { useSesi } from "@/lib/sesi-pengguna";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";
import { waktuRelatif, useDetakWaktu } from "@/lib/waktu";
import { salinTeks } from "@/lib/salin-chat";

type NotiItem = {
  id: string;
  jenis: "LIKE" | "FOLLOW" | "MENTION" | string;
  waktu: string;
  dibaca: string | null;
  aktor: { id: string; nama: string; username: string | null; pfp: string | null; verified: boolean } | null;
  aktorNama: string;
  mediaId: string | null;
  mediaJudul: string | null;
};

const TEKS_JENIS: Record<string, string> = {
  LIKE: "menyukai postingan kamu",
  FOLLOW: "mulai mengikuti kamu",
  MENTION: "menandai kamu di postingan",
  MENTION_KOMENTAR: "menandai kamu di komentar",
};

/* Batas geser (px) sebelum item dianggap mau dihapus (swipe kanan). */
const BATAS_GESER = 64;

function urlPfp(id: string, pfp: string | null): string {
  return "/api/pfp/" + id + "?v=" + encodeURIComponent(pfp || "");
}

/* Satu baris teks yang kebaca pas disalin (mode pilih): [tanggal,
   jam] aktor aksi (di konteks). */
function barisSalinan(n: NotiItem): string {
  const d = new Date(n.waktu);
  const dua = (x: number) => String(x).padStart(2, "0");
  const stempel = isNaN(d.getTime()) ? "" : "[" + dua(d.getDate()) + "/" + dua(d.getMonth() + 1) + " " + dua(d.getHours()) + ":" + dua(d.getMinutes()) + "] ";
  const nama = n.aktor ? n.aktor.nama : n.aktorNama;
  const konteks = n.mediaJudul && n.jenis !== "FOLLOW" ? ' (di "' + n.mediaJudul + '")' : "";
  return stempel + nama + " " + (TEKS_JENIS[n.jenis] ?? "ngabisin waktu liat ini") + konteks;
}

export default function PusatNotifikasi() {
  const { siap, masuk, pengguna } = useSesi();
  const idSekarang = pengguna?.id ?? null;
  const [buka, setBuka] = useState(false);
  const [daftar, setDaftar] = useState<NotiItem[] | null>(null);
  const [belum, setBelum] = useState(0);
  const [galat, setGalat] = useState(false);
  /* Milik data yang ke-load (id user): render list cuma kalo data ny
     punya user yang LAGI login — logout/panic-ganti-akun gak bakal
     nyipir notifikasi user laen walau sesaat (muat() nimpa ny
     segera). */
  const [milik, setMilik] = useState<string | null>(null);
  /* Mode pilih (r29): null = mati; Set = id yang kepilih. */
  const [pilih, setPilih] = useState<Set<string> | null>(null);
  const [konfirmHapus, setKonfirmHapus] = useState<string[] | null>(null);
  const [sibukAksi, setSibukAksi] = useState(false);
  const [umpan, setUmpan] = useState<string | null>(null);
  const umpanTimer = useRef(0);
  const tombolRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tutupRef = useRef<HTMLButtonElement>(null);
  const detak = useDetakWaktu(30000);

  const muat = useCallback(async (untukId: string | null) => {
    try {
      const r = await fetch("/api/notifikasi", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (r.status === 401) return; /* sesi mati: diemin, ikon ny balik
        dicontrol sama state masuk */
      const d = await r.json();
      setDaftar(Array.isArray(d.daftar) ? d.daftar : []);
      setBelum(typeof d.belum === "number" ? d.belum : 0);
      setMilik(untukId);
      setGalat(false);
    } catch {
      setGalat(true);
    }
  }, []);

  /* Muat saat login + saat window balik fokus + jaringan balik (gak
     ada polling interval — hemat request). Pas logout komponen ny
     langsung null-render (gak perlu reset state — muat() baru
     nimpa pas login berikutnya). */
  useEffect(() => {
    if (!masuk) return;
    void muat(idSekarang);
    const onFocus = () => void muat(idSekarang);
    const onBalik = () => void muat(idSekarang);
    window.addEventListener("focus", onFocus);
    window.addEventListener("jaringan:balik", onBalik);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("jaringan:balik", onBalik);
    };
  }, [masuk, idSekarang, muat]);

  /* Drawer: Esc (mode pilih dibatin duluan), focus trap, kunci gulir
     (pola MenuSisa). */
  useEffect(() => {
    if (!buka) return;
    const t = setTimeout(() => tutupRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pilih) {
          /* Esc #1: batalin mode pilih dulu (kayak chat). */
          e.stopPropagation();
          setPilih(null);
          return;
        }
        mainkanSfx("ui-dissolve");
        setBuka(false);
        tombolRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const fokus = [...panelRef.current.querySelectorAll<HTMLElement>("a,button,[tabindex]:not([tabindex='-1'])")].filter(
        (el) => !el.hasAttribute("disabled")
      );
      if (!fokus.length) return;
      const awal = fokus[0];
      const akhir = fokus[fokus.length - 1];
      if (e.shiftKey && document.activeElement === awal) {
        e.preventDefault();
        akhir.focus();
      } else if (!e.shiftKey && document.activeElement === akhir) {
        e.preventDefault();
        awal.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    kunciGulir();
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      bukaKunciGulir();
    };
  }, [buka, pilih]);

  function bukaPanel() {
    setBuka(true);
    mainkanSfx("ui-menu");
    void muat(idSekarang);
  }

  function tutupPanel() {
    setBuka(false);
    setPilih(null);
    tombolRef.current?.focus();
  }

  function kabar(teks: string) {
    setUmpan(teks);
    clearTimeout(umpanTimer.current);
    umpanTimer.current = window.setTimeout(() => setUmpan(null), 2400);
  }

  async function tandai(id: string) {
    setBelum((n) => Math.max(0, n - 1));
    setDaftar((p) => (p ? p.map((x) => (x.id === id ? { ...x, dibaca: new Date().toISOString() } : x)) : p));
    try {
      await fetch("/api/notifikasi", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }

  async function tandaiSemua() {
    setBelum(0);
    setDaftar((p) => (p ? p.map((x) => ({ ...x, dibaca: x.dibaca ?? new Date().toISOString() })) : p));
    mainkanSfx("notification");
    try {
      await fetch("/api/notifikasi", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ semua: true }),
      });
    } catch {}
  }

  /* ---------- Hapus (satu / banyak) — optimistic + rollback ---------- */

  async function hapusIds(ids: string[]) {
    if (!ids.length || !daftar) return;
    setSibukAksi(true);
    const cadangan = daftar;
    const belumCadangan = belum;
    const hilangUnread = daftar.filter((x) => ids.includes(x.id) && !x.dibaca).length;
    setDaftar((p) => (p ? p.filter((x) => !ids.includes(x.id)) : p));
    setBelum((n) => Math.max(0, n - hilangUnread));
    try {
      const r = await fetch("/api/notifikasi", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.status === 401) return;
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("gagal");
      /* Jumlah resmi dari server (sinkron sama yang kehapus beneran). */
      if (typeof d.belum === "number") setBelum(d.belum);
      mainkanSfx("ui-dissolve");
    } catch {
      /* Rollback: item ny balik + pesan kecil. */
      setDaftar(cadangan);
      setBelum(belumCadangan);
      kabar("Gagal hapus — coba lagi");
      mainkanSfx("failure");
    } finally {
      setSibukAksi(false);
    }
  }

  function hapusSatu(n: NotiItem) {
    void hapusIds([n.id]);
  }

  async function hapusTerpilih() {
    if (!pilih) return;
    const ids = [...pilih];
    setKonfirmHapus(null);
    setPilih(null);
    await hapusIds(ids);
  }

  /* ---------- Salin terpilih ---------- */
  async function salinTerpilih() {
    if (!pilih || !daftar) return;
    const isi = daftar
      .filter((x) => pilih.has(x.id))
      .map(barisSalinan)
      .join("\n");
    const ok = await salinTeks(isi);
    if (ok) {
      kabar(pilih.size > 1 ? pilih.size + " notifikasi tersalin" : "Notifikasi tersalin");
      mainkanSfx("notification");
    } else {
      kabar("Clipboard ny keblokir browser");
      mainkanSfx("failure");
    }
  }

  function togelPilih(id: string) {
    setPilih((p) => {
      if (!p) return p;
      const baru = new Set(p);
      if (baru.has(id)) baru.delete(id);
      else baru.add(id);
      return baru;
    });
    mainkanSfx("ui-menu");
  }

  function masukPilih(id: string) {
    setPilih(new Set([id]));
    mainkanSfx("ui-menu");
  }

  /* Anonymous: ikonny gak ke-render sama sekali. */
  if (!siap || !masuk) return null;

  /* Data valid = punya user yang lagi login (anti nyipir antar akun). */
  const dataSah = daftar !== null && milik === idSekarang;
  const terpilihDaftar = pilih ? daftar?.filter((x) => pilih.has(x.id)) ?? [] : [];

  return (
    <>
      <button
        type="button"
        ref={tombolRef}
        className={"tema-toggle noti-btn" + (buka ? " buka" : "") + (belum > 0 && dataSah ? " ada" : "")}
        aria-expanded={buka}
        aria-controls="panel-notifikasi"
        aria-label={buka ? "Tutup notifikasi" : "Buka notifikasi" + (belum > 0 && dataSah ? " (" + belum + " belum dibaca)" : "")}
        data-sfx={buka ? "ui-dissolve" : "ui-menu"}
        onClick={() => (buka ? tutupPanel() : bukaPanel())}
      >
        <SuratIkon ukuran={20} />
        {belum > 0 && dataSah && (
          <span className="noti-badge" aria-hidden="true">
            {belum > 99 ? "99+" : belum}
          </span>
        )}
      </button>

      {buka && (
        <div
          className="sisa-lapis"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              mainkanSfx("ui-dissolve");
              tutupPanel();
            }
          }}
        >
          <div
            id="panel-notifikasi"
            ref={panelRef}
            className="sisa-panel noti-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Notifikasi"
          >
            <button
              type="button"
              ref={tutupRef}
              className="post-tutup sisa-tutup"
              data-sfx="ui-dissolve"
              aria-label="Tutup notifikasi"
              onClick={tutupPanel}
            >
              <TutupIkon />
            </button>

            <h2 className="noti-judul">
              <SuratIkon ukuran={18} /> Notifikasi
            </h2>

            {umpan && (
              <p className="umpan-baris noti-umpan" role="status">
                <CentangIkon ukuran={12} /> {umpan}
              </p>
            )}

            {/* Mode pilih (r29): bar aksi nggantinin "tandai semua". */}
            {pilih ? (
              <div className="bar-pilih noti-bar-pilih" role="toolbar" aria-label={"Notifikasi terpilih: " + pilih.size}>
                <span className="bp-jumlah">
                  <PilihIkon ukuran={13} />
                  {pilih.size} dipilih
                </span>
                <span className="bp-aksi">
                  {dataSah && daftar && pilih.size < daftar.length && (
                    <button
                      type="button"
                      className="btn kecil"
                      onClick={() => {
                        setPilih(new Set(daftar.map((x) => x.id)));
                        mainkanSfx("ui-menu");
                      }}
                    >
                      Pilih semua
                    </button>
                  )}
                  <button type="button" className="btn kecil" onClick={() => void salinTerpilih()} disabled={!pilih.size}>
                    <SalinIkon ukuran={13} />
                    Salin
                  </button>
                  <button
                    type="button"
                    className="btn kecil bahaya"
                    onClick={() => setKonfirmHapus([...pilih])}
                    disabled={!pilih.size}
                  >
                    <HapusIkon ukuran={13} />
                    Hapus
                  </button>
                  <button type="button" className="btn kecil" onClick={() => setPilih(null)}>
                    Batal
                  </button>
                </span>
              </div>
            ) : (
              belum > 0 &&
              dataSah && (
                <button type="button" className="btn kecil noti-tandai" onClick={() => void tandaiSemua()}>
                  <CentangIkon ukuran={13} />
                  Tandai semua dibaca
                </button>
              )
            )}

            {galat && !dataSah && (
              <p className="noti-kosong" role="alert">
                Gak bisa ngambil notifikasi. Coba buka lagi nanti.
              </p>
            )}
            {!dataSah && !galat && (
              <p className="noti-kosong" aria-busy="true">Muat notifikasi...</p>
            )}
            {dataSah && daftar.length === 0 && (
              <p className="noti-kosong">
                <SukaOutlineIkon ukuran={18} />
                Belum ada aktivitas. Kalau ada yang nyukain post lu, ngikutin, atau nge-mention lu — nongol di sini.
              </p>
            )}
            {dataSah && daftar.length > 0 && (
              <ul className="noti-daftar">
                {daftar.map((n) => (
                  <li key={n.id} className={n.dibaca ? "" : "belum"}>
                    <ItemNoti
                      n={n}
                      detak={detak}
                      modePilih={!!pilih}
                      terpilih={!!pilih?.has(n.id)}
                      onTogel={() => togelPilih(n.id)}
                      onTandai={() => void tandai(n.id)}
                      onMasukPilih={() => masukPilih(n.id)}
                      onHapus={() => hapusSatu(n)}
                    />
                  </li>
                ))}
              </ul>
            )}
            {dataSah && daftar.length > 0 && !pilih && (
              <p className="noti-catatan">
                Klik buat buka konteks ny <PanahKeluar /> · tahan / klik kanan buat milih
              </p>
            )}
          </div>
        </div>
      )}

      {konfirmHapus && (
        <Konfirmasi
          judul={"Hapus " + konfirmHapus.length + " notifikasi?"}
          pesan="Notifikasi ny ilang dari daftar lu. Aktivitas ny sendiri (post/follow/mention) gak kehapus."
          labelYakin="Hapus"
          sibuk={sibukAksi}
          onYakin={() => void hapusTerpilih()}
          onBatal={() => setKonfirmHapus(null)}
        />
      )}
    </>
  );
}

/* Satu item notifikasi (r29): bungkus swipe + mode pilih di satu
   baris. Normal: Link (navigasi) / button. Mode pilih: button togel
   + checkbox. Swipe kanan (sentuh, di luar mode pilih): konten
   bergeser + indikasi hapus di belakangny; lepasin lewat threshold
   = hapus.

   Long-press 480ms (HP) / klik kanan (desktop) = masuk mode pilih
   (useTekanLama — helper yang sama kayak chat + komentar). Ghost-
   click pas-nya jari diangkat abis long-press dicegah dengan
   preventDefault di touchend (event cancelable). */
function ItemNoti({
  n,
  detak,
  modePilih,
  terpilih,
  onTogel,
  onTandai,
  onMasukPilih,
  onHapus,
}: {
  n: NotiItem;
  detak: number;
  modePilih: boolean;
  terpilih: boolean;
  onTogel: () => void;
  onTandai: () => void;
  onMasukPilih: () => void;
  onHapus: () => void;
}) {
  const isiRef = useRef<HTMLDivElement>(null);
  const barisRef = useRef<HTMLDivElement>(null);
  /* data gesture: awal = titik sentuh; aktif = swipe ny beneran
     jalan (intent horizontal kepasti); dx = geser sekarang. */
  const awal = useRef<{ x: number; y: number; aktif: boolean; dx: number } | null>(null);
  /* true kalau long-press ny KEJADIAN di sentuhan ini (bukan cuma
     timer ny kepasang) — buat nge-batalin click sintetis ny. */
  const lamaJalan = useRef(false);
  const tekan = useTekanLama(() => {
    lamaJalan.current = true;
    onMasukPilih();
  });

  function mulai(e: React.TouchEvent) {
    awal.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, aktif: false, dx: 0 };
  }

  function gerak(e: React.TouchEvent) {
    const a = awal.current;
    if (!a) return;
    const dx = e.touches[0].clientX - a.x;
    const dy = e.touches[0].clientY - a.y;
    if (!a.aktif) {
      /* Gerakan VERTIKAL duluan = scroll biasa — gesture batal
         total (gulir list tetep lancar). */
      if (Math.abs(dy) > 12) {
        awal.current = null;
        return;
      }
      /* Intent KANAN (dx > 0) yang jelas: baru engage. Gerakan kiri
         gak dipake (gak ada aksi kiri di notifikasi). */
      if (dx > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        a.aktif = true;
        barisRef.current?.classList.add("menggeser");
      } else return;
    }
    a.dx = Math.max(0, Math.min(96, dx));
    const isi = isiRef.current;
    if (isi) isi.style.transform = "translateX(" + a.dx + "px)";
  }

  function selesai(e: React.TouchEvent) {
    const a = awal.current;
    barisRef.current?.classList.remove("menggeser");
    const isi = isiRef.current;
    if (a && a.aktif) {
      /* Lepasin lewat threshold = hapus (click sintetis ny dibuang —
         jari ny emang lagi ngeser, bukan nge-klik). */
      if (a.dx >= BATAS_GESER) {
        e.preventDefault();
        if (isi) isi.style.transform = "";
        awal.current = null;
        onHapus();
        return;
      }
    } else if (lamaJalan.current) {
      /* Long-press barusan jalan (masuk mode pilih) — click sintetis
         pas jari diangkat gak boleh nge-TOGEL item ny balik. */
      e.preventDefault();
    }
    lamaJalan.current = false;
    if (isi) isi.style.transform = "";
    awal.current = null;
  }

  const nama = n.aktor ? n.aktor.nama : n.aktorNama;
  const keProfil = n.aktor ? "/profil/" + encodeURIComponent(n.aktor.username ?? n.aktor.nama) : null;
  const kePost = n.mediaId ? "/post/" + encodeURIComponent(n.mediaId) : null;

  const badan = (
    <>
      {n.aktor && n.aktor.pfp ? (
        <img src={urlPfp(n.aktor.id, n.aktor.pfp)} alt="" width={38} height={38} loading="lazy" decoding="async" />
      ) : (
        <span className="noti-inisial" aria-hidden="true">
          <OrangIkon ukuran={16} />
        </span>
      )}
      <span className="noti-badan">
        <span className="noti-teks">
          <b>
            {nama}
            {n.aktor?.verified && <LencanaVerified />}
          </b>{" "}
          {TEKS_JENIS[n.jenis] ?? "ngabisin waktu liat ini"}
          {n.mediaJudul && n.jenis !== "FOLLOW" && <span className="noti-konteks">di “{n.mediaJudul}”</span>}
        </span>
        <time>{waktuRelatif(n.waktu, detak)}</time>
      </span>
      {!n.dibaca && !modePilih && <span className="noti-titik" aria-hidden="true" />}
    </>
  );

  /* Mode pilih: seluruh isi jadi tombol togel (checkbox + konten).
     Normal: Link ke konteks (klik = tandain dibaca + navigasi),
     atau button kalo konteksny udah gak ada (aktor/post kehapus). */
  const isiTombol = modePilih ? (
    <button type="button" className="noti-item" onClick={onTogel} aria-pressed={terpilih}>
      <span className="tanda-pilih" aria-hidden="true">
        <span className="tanda-kotak">{terpilih ? <CentangIkon ukuran={12} /> : null}</span>
      </span>
      {badan}
    </button>
  ) : n.jenis === "FOLLOW" ? (
    keProfil ? (
      <Link className="noti-item" href={keProfil} onClick={onTandai}>
        {badan}
      </Link>
    ) : (
      <button type="button" className="noti-item" onClick={onTandai}>
        {badan}
      </button>
    )
  ) : kePost ? (
    <Link className="noti-item" href={kePost} onClick={onTandai}>
      {badan}
    </Link>
  ) : (
    <button type="button" className="noti-item" onClick={onTandai}>
      {badan}
    </button>
  );

  return (
    <div
      ref={barisRef}
      className={"noti-baris" + (terpilih ? " terpilih" : "") + (modePilih ? " mode-pilih" : "")}
      onTouchStart={(e) => {
        if (modePilih) return;
        mulai(e);
        tekan.onTouchStart(e);
      }}
      onTouchMove={(e) => {
        if (modePilih) return;
        gerak(e);
        tekan.onTouchMove(e);
      }}
      onTouchEnd={(e) => {
        if (modePilih) return;
        selesai(e);
        tekan.onTouchEnd();
      }}
      onTouchCancel={() => {
        if (modePilih) return;
        awal.current = null;
        lamaJalan.current = false;
        barisRef.current?.classList.remove("menggeser");
        const isi = isiRef.current;
        if (isi) isi.style.transform = "";
        tekan.onTouchCancel();
      }}
      onContextMenu={modePilih ? undefined : tekan.onContextMenu}
    >
      {/* Indikasi hapus di belakang baris (kebuka pas digeser kanan). */}
      <span className="noti-hapus-bg" aria-hidden="true">
        <HapusIkon ukuran={17} />
      </span>
      <div ref={isiRef} className="noti-baris-isi">
        {isiTombol}
      </div>
    </div>
  );
}
