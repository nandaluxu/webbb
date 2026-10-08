"use client";

/* Panel post: detail satu media (pratinjau + komentar), dibuka pas
   kartu grid diklik (bukan langsung zoom). File asli cuma kebuka
   kalau user minta: foto di-zoom lewat Penampil, video diputar lewat
   PenampilVideo. Grid tetap cuma makan pratinjau.
   Komentar + suka butuh login; tombol ny buka pintu login kalau
   belum. Pemilik post (atau owner) bisa hapus post dari sini.

   Struktur komentar: PFP kiri, username + teks di kolom kanan ny
   (wrap tetap sejajar, gak balik ke PFP). Balasan nyambung ke
   komentar asli (balasanId), sapaan "@nama" diambil dari data user,
   indentasiny dikit doang biar gak nyelam dalam.

   Thread: balasan di-RENDER nempel di komentar induk ny (bukan
   urutan waktu flat). Dulu ny daftar flat: balasan ke komentar
   pertama muncul nyangkut di bawah komentar apapun yang kebetulan
   di atas ny -> keliatan kayak balasan komentar yang salah. Balasan
   dari balasan tetep nempel di thread akar ny (indent 1 level),
   tapi @ny tetap nunjuk reply yang dibalas.

   Esc cuma nutup layer PALING ATAS: kalau lagi ada zoom/konfirmasi/
   login/menu di atas post, panel ini gak ikut kebuka-balik. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SukaOutlineIkon, SukaPenuhIkon, KirimIkon, TutupIkon, OrangIkon, LencanaVerified, PlayIkon, BesarIkon, BalasIkon, SalinIkon, HapusIkon, LaporIkon, TitikTigaIkon, CentangIkon, GembokIkon, UnduhIkon } from "@/components/ikon";
import Konfirmasi from "@/components/Konfirmasi";
import MenuAksi, { useTekanLama, type AksiItem } from "@/components/MenuAksi";
import { SebutOtomatis, BioSebut } from "@/components/SebutOtomatis";
import { Penampil, type Foto } from "@/components/efek/Penampil";
import PenampilVideo from "@/components/efek/PenampilVideo";
import VideoInline from "@/components/efek/VideoInline";
import { useSesi, bukaPintu, tolakSesi } from "@/lib/sesi-pengguna";
import { mainkanSfx } from "@/lib/suara";
import { kunciGulir, bukaKunciGulir } from "@/lib/gulir";
import { waktuRelatif, useDetakWaktu } from "@/lib/waktu";
import { formatSalin, salinTeks } from "@/lib/salin-chat";
import { formatJumlah } from "@/lib/format";
import type { MediaPublik, KomentarPublik, Visibilitas } from "@/lib/tipe-media";
import { urlProfil, sebutanUser } from "@/lib/tipe-media";

function urlPfp(p: { id: string; pfp: string | null }): string {
  return "/api/pfp/" + p.id + "?v=" + encodeURIComponent(p.pfp || "");
}

/* Satu utas: komentar induk + balasan-balasanny (urut waktu). */
type Utas = { kom: KomentarPublik; balasan: KomentarPublik[] };

/* Susun daftar flat jadi utas: balasan nempel di komentar induk ny
   (cari akar thread naik lewat data balasan, BUKAN lewat posisi
   visual/index). Balasan dari balasan ikut thread akal ny biar
   indentasiny gak nyelam dalam. Induk ny gak kebaca (kepotong batas
   100 komentar) -> balasanny tampil sebagai komentar biasa biar
   gak ilang. */
function susunUtas(daftar: KomentarPublik[]): Utas[] {
  const peta = new Map(daftar.map((k) => [k.id, k]));
  const utas: Utas[] = [];
  const anak = new Map<string, KomentarPublik[]>();
  for (const k of daftar) {
    if (!k.balasan) {
      utas.push({ kom: k, balasan: [] });
      continue;
    }
    let induk = peta.get(k.balasan.id) ?? null;
    while (induk && induk.balasan) {
      const naik = peta.get(induk.balasan.id);
      if (!naik) break;
      induk = naik;
    }
    if (induk && !induk.balasan) {
      const arr = anak.get(induk.id) ?? [];
      arr.push(k);
      anak.set(induk.id, arr);
    } else {
      utas.push({ kom: k, balasan: [] });
    }
  }
  for (const u of utas) u.balasan = anak.get(u.kom.id) ?? [];
  return utas;
}

/* Lompat + kilat ke komentar yang dibalas (kayak di ruang obrol).
   Level modul biar KomentarBaris bisa pakai tanpa lewat props. */
function lompatKe(id: string) {
  const el = document.getElementById("komentar-" + id);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  el.classList.add("sorot");
  setTimeout(() => el.classList.remove("sorot"), 1500);
}

export default function PanelPost({
  media,
  onTutup,
  onUbah,
}: {
  media: MediaPublik;
  onTutup: () => void;
  onUbah: (id: string, ubah: { suka?: number; disukai?: boolean; komentar?: number; hapus?: boolean; visibilitas?: Visibilitas; bolehUnduh?: boolean }) => void;
}) {
  const { masuk, pengguna } = useSesi();
  const [daftar, setDaftar] = useState<KomentarPublik[] | null>(null);
  const [galat, setGalat] = useState("");
  const [teks, setTeks] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [suka, setSuka] = useState({ jumlah: media.suka, aku: media.disukai });
  /* Penonton unik (r28): state lokal karena angkany bisa nambah pas
     user ini sendiri baru pertama kali nglihat post (server balikin
     jumlah terbaru). Panel kebuka dari grid mana pun (galeri/profil/
     direct URL) nembak route yang sama — 1 user = 1 view. */
  const [dilihat, setDilihat] = useState(media.dilihat);
  const sudahLihat = useRef(false);
  /* Video yang lagi diputar: sumberny diambil dari SLIDE AKTIF
     (post multi-item bisa punya video di slide ke-2 dst). */
  const [videoBuka, setVideoBuka] = useState<{
    sumber: { file: string; nama: string; judul: string | null; pratinjau?: string };
    rasio: number | null;
  } | null>(null);
  const [konfirmHapus, setKonfirmHapus] = useState(false);
  /* Visibilitas lokal (P1-6): media prop gak keganti pas parent
     cuma filter daftarny, jadi nilainy dipegang sendiri di sini.
     bolehUnduh (r30) juga lokal — parent ny cuma nyalin salinan. */
  const [vis, setVis] = useState<Visibilitas>(media.visibilitas || "PUBLIC");
  const [bolehUnduh, setBolehUnduh] = useState(media.bolehUnduh !== false);
  /* Submenu privasi (posisi layar) + status kirim. */
  const [menuPrivasi, setMenuPrivasi] = useState<{ x: number; y: number } | null>(null);
  const [sibukPrivasi, setSibukPrivasi] = useState(false);
  /* r30: submenu izin unduhan (pemilik doang) + status kirim. */
  const [menuUnduhIzin, setMenuUnduhIzin] = useState<{ x: number; y: number } | null>(null);
  const [sibukUnduhIzin, setSibukUnduhIzin] = useState(false);
  /* Titik awal pointer di lapis backdrop: buat mbedain KLIK (nurut
     nutup) dari UJUNG DRAG slide yang nyasar keluar kotak (pas
     dilepas, browser ngesintesis event click di ancestor backdrop —
     tanpa penanda ini panel post ketutup sendiri tiap drag lepas
     di luar area media, terverifikasi repro r27). */
  const asalPointer = useRef<{ x: number; y: number } | null>(null);
  /* Slide aktif carousel (post multi-foto). */
  const [aktif, setAktif] = useState(0);
  const [lebarRel, setLebarRel] = useState(0);
  const relRef = useRef<HTMLDivElement>(null);
  /* Komentar yang lagi dibalas (null = komen biasa). */
  const [balasan, setBalasan] = useState<KomentarPublik | null>(null);
  /* r29: posisi kursor textarea komentar (buat autocomplete @mention
     — pola yang sama kayak editor bio). */
  const [posisiKomentar, setPosisiKomentar] = useState(0);
  const komentarRef = useRef<HTMLTextAreaElement>(null);
  const [baru, setBaru] = useState<Set<string>>(new Set());
  /* Menu titik-tiga post (posisi layar). */
  const [menuPost, setMenuPost] = useState<{ x: number; y: number } | null>(null);
  /* Menu aksi komentar (posisi + komentar target). */
  const [menuKomentar, setMenuKomentar] = useState<{ x: number; y: number; k: KomentarPublik } | null>(null);
  /* Konfirmasi lapor (post / komentar) + hapus komentar. */
  const [konfirmLaporPost, setKonfirmLaporPost] = useState(false);
  const [konfirmLaporKom, setKonfirmLaporKom] = useState<KomentarPublik | null>(null);
  const [konfirmHapusKom, setKonfirmHapusKom] = useState<KomentarPublik | null>(null);
  const [sibukAksi, setSibukAksi] = useState(false);
  /* Umpan balik singkat (tersalin / lapor terkirim). */
  const [umpan, setUmpan] = useState<string | null>(null);
  const umpanTimer = useRef(0);
  const imgPratinjau = useRef<HTMLImageElement>(null);
  const ulKomentar = useRef<HTMLUListElement>(null);
  const idLama = useRef<Set<string>>(new Set());
  const detak = useDetakWaktu(30000);
  /* Utas komentar: dihitung dari data (bukan index visual), jadi
     balasan selalu nempel di induk ny yang bener. */
  const utas = useMemo(() => (daftar ? susunUtas(daftar) : null), [daftar]);

  const pemilik = !!pengguna && !!media.user && media.user.id === pengguna.id;
  const owner = !!pengguna?.admin;
  const bisaHapus = pemilik || owner;

  /* Izin hapus komentar: yang nulis, pemilik post, atau owner
     (ngikut sistem permission yang udah ada, sama kayak backend). */
  const bisaHapusKom = useCallback(
    (k: KomentarPublik) => !!pengguna && (k.user.id === pengguna.id || pemilik || owner),
    [pengguna, pemilik, owner]
  );

  /* Umpan balik singkat (2.4 detik). */
  const kabar = useCallback((pesan: string) => {
    setUmpan(pesan);
    clearTimeout(umpanTimer.current);
    umpanTimer.current = window.setTimeout(() => setUmpan(null), 2400);
  }, []);

  useEffect(() => {
    let hidup = true;
    fetch("/api/media/" + media.id + "/komentar", { cache: "no-store", signal: AbortSignal.timeout(12000) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (hidup) {
          const daftarBaru: KomentarPublik[] = ok ? d.daftar : [];
          idLama.current = new Set(daftarBaru.map((k) => k.id));
          setDaftar(daftarBaru);
        }
      })
      .catch(() => {
        if (hidup) setDaftar([]);
      });
    /* Catat view (r28): SEKALI per pembukaan panel. Server ny yang
       dedupe (unique constraint) — ref ini cuma nyegah dobel-POST dari
       re-render, bukan sumber kebenaran. Anonymous tanpa sesi gak
       direkam (kebijakan server). */
    if (!sudahLihat.current) {
      sudahLihat.current = true;
      fetch("/api/media/" + media.id + "/lihat", { method: "POST", signal: AbortSignal.timeout(12000) })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (hidup && d && typeof d.dilihat === "number") setDilihat(d.dilihat);
        })
        .catch(() => {});
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.target instanceof HTMLTextAreaElement) return;
      /* Ada layer lain di atas post (zoom foto/video, konfirmasi,
         pintu login, menu samping, MENU AKSI r17)? Esc-ny milik layer
         itu, post tetep kebuka. Dicek dari DOM biar selalu ngerti
         keadaan sekarang (listener ini cuma pasang sekali). */
      if (document.querySelector(".video-lapis, .viewer.open, .pintu-lapis, .sisa-lapis, .menu-aksi")) return;
      mainkanSfx("ui-dissolve");
      onTutup();
    };
    document.addEventListener("keydown", onKey);
    kunciGulir();
    return () => {
      hidup = false;
      document.removeEventListener("keydown", onKey);
      bukaKunciGulir();
    };
  }, [media.id, onTutup]);

  /* Komentar muncul pelan pas masuk viewport (lazy reveal), satu
     elemen cuma sekali. Yang udah kebaca sebelum ny gak diulang. */
  useEffect(() => {
    const ul = ulKomentar.current;
    if (!ul || !daftar) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const items = [...ul.querySelectorAll<HTMLLIElement>("li")].filter((el) => !el.classList.contains("pk-skeleton") && !el.classList.contains("on"));
    if (reduce || !items.length || !("IntersectionObserver" in window)) return;
    items.forEach((li) => li.classList.add("masuk"));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("on");
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: "0px 0px -6% 0px" }
    );
    items.forEach((li) => io.observe(li));
    return () => io.disconnect();
  }, [daftar]);

  /* Suka optimistic (r19): UI LANGSUNG ganti (ikon + angka) pas
     di-tekan, POST jalan di belakang. Gagal / timeout 6 detik ->
     balik ke keadaan semula (gak ada UI yang bohong permanent).
     Sukses -> angka ny nurut kebenaran dari server. Kepencet dua
     kali cepet pun aman: tiap sukses sinkron ke nilai server
     terakhir. */
  async function suka_() {
    if (!masuk) {
      bukaPintu();
      return;
    }
    const sebelum = { jumlah: suka.jumlah, aku: suka.aku };
    const prediksi = { jumlah: sebelum.jumlah + (sebelum.aku ? -1 : 1), aku: !sebelum.aku };
    setSuka(prediksi);
    onUbah(media.id, { suka: prediksi.jumlah, disukai: prediksi.aku });
    mainkanSfx(prediksi.aku ? "digital-burst" : "ui-dissolve");
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch("/api/media/" + media.id + "/suka", { method: "POST", signal: ctrl.signal });
      if (r.status === 401) {
        tolakSesi();
        throw new Error();
      }
      if (!r.ok) throw new Error();
      const d = await r.json();
      setSuka({ jumlah: d.suka, aku: d.disukai });
      onUbah(media.id, { suka: d.suka, disukai: d.disukai });
    } catch {
      setSuka(sebelum);
      onUbah(media.id, { suka: sebelum.jumlah, disukai: sebelum.aku });
      mainkanSfx("failure");
    } finally {
      clearTimeout(timer);
    }
  }

  function pilihSebutKomentar(teksBaru: string, posisiBaru: number) {
    setTeks(teksBaru);
    setPosisiKomentar(posisiBaru);
    /* kursor diempatin di posisi baru (frame berikutnya biar React
       udah nulis valueny dulu — pola editor bio). */
    requestAnimationFrame(() => {
      const el = komentarRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(posisiBaru, posisiBaru);
      }
    });
  }

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    if (!masuk) {
      bukaPintu();
      return;
    }
    /* r29: newline dipertahanin (dulu ke-collapse jadi spasi) —
       server ny juga gak collapse (rapikanKomentar). Mention + emoji
       + baris baru jalan barengan. */
    const isi = teks.replace(/\r\n?/g, "\n").split("\n").map((b) => b.replace(/[ \t]+/g, " ").trim()).join("\n").trim().slice(0, 500);
    if (!isi) return;
    setSibuk(true);
    setGalat("");
    try {
      const r = await fetch("/api/media/" + media.id + "/komentar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teks: isi, balasanId: balasan?.id ?? null }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.status === 401) {
        tolakSesi();
        setSibuk(false);
        return;
      }
      const d = await r.json();
      if (!r.ok) {
        setGalat(d.galat || "Gagal ngirim komentar.");
        mainkanSfx("failure");
      } else {
        /* Tandain komentar baru biar keanimasi + kegulir ke situ. */
        const segar = (d.daftar as KomentarPublik[]).filter((k) => !idLama.current.has(k.id)).map((k) => k.id);
        idLama.current = new Set((d.daftar as KomentarPublik[]).map((k) => k.id));
        setBaru(new Set(segar));
        setDaftar(d.daftar);
        setTeks("");
        setBalasan(null);
        onUbah(media.id, { komentar: d.daftar.length });
        mainkanSfx("notification");
        /* Gulir ke komentar yang baru masuk. Dengan thread, komentar
           baru bisa di tengah daftar (balasan ke komentar awal), jadi
           gak boleh asal gulir ke bawah doang. */
        const target = segar.length ? document.getElementById("komentar-" + segar[segar.length - 1]) : null;
        target?.scrollIntoView({
          block: "nearest",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
      }
    } catch {
      setGalat("Gak nyambung ke server.");
      mainkanSfx("failure");
    }
    setSibuk(false);
  }

  async function hapusPost() {
    setSibuk(true);
    const r = await fetch("/api/media/" + media.id + "/hapus", { method: "POST", signal: AbortSignal.timeout(12000) }).catch(() => null);
    setSibuk(false);
    if (r && r.status === 401) {
      tolakSesi();
      setKonfirmHapus(false);
      return;
    }
    if (!r || !r.ok) {
      setKonfirmHapus(false);
      setGalat("Gagal hapus post. Coba lagi bentar.");
      mainkanSfx("failure");
      return;
    }
    setKonfirmHapus(false);
    onUbah(media.id, { hapus: true });
    onTutup();
  }

  /* ---------- Aksi komentar + lapor post ---------- */

  async function salinKomentar(k: KomentarPublik) {
    const teks = formatSalin({ nama: k.user.nama, teks: k.teks, waktu: k.waktu });
    const ok = await salinTeks(teks);
    if (ok) {
      kabar("Komentar tersalin");
      mainkanSfx("notification");
    } else {
      kabar("Clipboard ny keblokir browser");
      mainkanSfx("failure");
    }
  }

  /* Hapus komentar: beneran dari database (route ny yang ngecek
     izin: yang nulis / pemilik post / owner), terus daftar ny
     di-refresh dari respons server biar sinkron + jumlah komentar di
     kartu ikut ke-update. */
  async function hapusKomentar() {
    if (!konfirmHapusKom) return;
    setSibukAksi(true);
    try {
      const r = await fetch("/api/media/" + media.id + "/komentar/hapus", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ komentarId: konfirmHapusKom.id }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.status === 401) {
        tolakSesi();
        return;
      }
      const d = await r.json();
      if (!r.ok) {
        setGalat(d.galat || "Gagal hapus komentar.");
        mainkanSfx("failure");
      } else {
        const daftarBaru = d.daftar as KomentarPublik[];
        idLama.current = new Set(daftarBaru.map((k) => k.id));
        setDaftar(daftarBaru);
        onUbah(media.id, { komentar: daftarBaru.length });
        mainkanSfx("ui-dissolve");
      }
    } catch {
      setGalat("Gak nyambung ke server.");
      mainkanSfx("failure");
    } finally {
      setSibukAksi(false);
      setKonfirmHapusKom(null);
    }
  }

  async function kirimLapor(jenis: "komentar" | "media", k?: KomentarPublik) {
    setSibukAksi(true);
    try {
      const r = await fetch("/api/laporan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jenis === "komentar" ? { jenis, targetId: k?.id } : { jenis, targetId: media.id }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.status === 401) {
        tolakSesi();
        return;
      }
      if (r.ok) {
        kabar("Laporan terkirim ke owner");
        mainkanSfx("notification");
      } else {
        const d = await r.json().catch(() => ({}));
        kabar(d.galat || "Gagal kirim laporan");
        mainkanSfx("failure");
      }
    } catch {
      kabar("Gak nyambung ke server");
      mainkanSfx("failure");
    } finally {
      setSibukAksi(false);
      setKonfirmLaporKom(null);
      setKonfirmLaporPost(false);
    }
  }

  /* ---------- Salin link post (r28) ----------
     Canonical URL = /post/<id> (halaman detail ny sendiri, bukan
     hash/modal). Origin diambil dari window.location (gak hardcode
     domain), clipboard API + fallback (helper salinTeks). */
  async function salinLink() {
    const url = new URL("/post/" + encodeURIComponent(media.id), window.location.origin).toString();
    const ok = await salinTeks(url);
    if (ok) {
      kabar("Link disalin");
      mainkanSfx("notification");
    } else {
      kabar("Clipboard ny keblokir browser");
      mainkanSfx("failure");
    }
  }

  /* Menu titik-tiga post: isinya nurut izin. User gak liat aksi
     yang gak boleh dia pake. Lapor butuh login. Privasi + izin
     unduhan cuma buat PEMILIK post (uploader) — perubahan ny
     divalidasi lagi di server, nampilin menu bukan satu-satunya
     gerbang. Download (r30): muncul buat SEMUA penonton kalo
     uploader ngizinin, terus selalu buat pemilik ny sendiri. */
  function itemMenuPost(): AksiItem[] {
    const isi: AksiItem[] = [
      { id: "salinlink", label: "Salin link", ikon: <SalinIkon ukuran={15} />, onKlik: () => void salinLink() },
    ];
    if (bolehUnduh || pemilik) {
      isi.push({
        id: "unduh",
        label: jumlahItem > 1 ? "Download slide ini" : "Download",
        ikon: <UnduhIkon ukuran={15} />,
        onKlik: () => unduhSekarang(),
      });
    }
    if (pemilik) {
      isi.push({
        id: "privasi",
        label: "Privasi",
        ikon: <GembokIkon ukuran={15} />,
        onKlik: () => {
          /* submenu kebuka di posisi menu yang sama */
          setMenuPrivasi(menuPost ? { x: menuPost.x, y: menuPost.y + 10 } : { x: 100, y: 100 });
        },
      });
      isi.push({
        id: "izinunduh",
        label: "Izinkan unduhan",
        ikon: <UnduhIkon ukuran={15} />,
        onKlik: () => {
          setMenuUnduhIzin(menuPost ? { x: menuPost.x, y: menuPost.y + 10 } : { x: 100, y: 100 });
        },
      });
    }
    if (bisaHapus) {
      isi.push({ id: "hapus", label: "Hapus", ikon: <HapusIkon ukuran={15} />, bahaya: true, onKlik: () => setKonfirmHapus(true) });
    }
    if (media.user?.id !== pengguna?.id) {
      isi.push({
        id: "lapor",
        label: "Laporkan",
        ikon: <LaporIkon ukuran={15} />,
        onKlik: () => (masuk ? setKonfirmLaporPost(true) : bukaPintu()),
      });
    }
    return isi;
  }

  /* ---------- Download (r30) ----------
     Unduh slide yang LAGI DILIHAT (post 1 file = file utamany).
     Jalur ny route file ?unduh=1 (content-disposition attachment +
     MIME + nama file dari server); server ny yang mastiin izin ny
     (403 buat yang gak berizin) — UI cuma pintu masuk ny. */
  function unduhSekarang() {
    const url = itemSekarang.file + (itemSekarang.file.includes("?") ? "&" : "?") + "unduh=1";
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    kabar("Unduhan dimulai");
  }

  /* Ubah izin unduhan (pemilik, r30): mirip ubahPrivasi — server ny
     yang mutusin boleh/gak, sukses -> state lokal + salinan grid
     induk ikut ke-update. */
  async function ubahUnduhIzin(boleh: boolean) {
    if (sibukUnduhIzin || boleh === bolehUnduh) {
      setMenuUnduhIzin(null);
      return;
    }
    setSibukUnduhIzin(true);
    try {
      const r = await fetch("/api/media/" + media.id + "/unduh-izin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boleh }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.status === 401) {
        tolakSesi();
        return;
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        kabar(d.galat || "Gagal ganti izin unduhan.");
        mainkanSfx("failure");
        return;
      }
      setBolehUnduh(boleh);
      onUbah(media.id, { bolehUnduh: boleh });
      kabar(boleh ? "Unduhan dibuka buat semua penonton" : "Unduhan cuma buat lu sendiri");
      mainkanSfx("notification");
    } catch {
      kabar("Gak nyambung ke server.");
      mainkanSfx("failure");
    } finally {
      setSibukUnduhIzin(false);
      setMenuUnduhIzin(null);
    }
  }

  /* Ubah privasi post milik sendiri (P1-6). Server ny yang
     mutusin boleh atau gak; sukses -> badge + daftar induk ikut
     ke-update lewat onUbah (galeri ngefilter PROFILE/PRIVATE,
     profil orang lain ngefilter PRIVATE). */
  async function ubahPrivasi(baru: Visibilitas) {
    if (sibukPrivasi || baru === vis) {
      setMenuPrivasi(null);
      return;
    }
    setSibukPrivasi(true);
    try {
      const r = await fetch("/api/media/" + media.id + "/privasi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibilitas: baru }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.status === 401) {
        tolakSesi();
        return;
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        kabar(d.galat || "Gagal ganti privasi.");
        mainkanSfx("failure");
        return;
      }
      setVis(baru);
      onUbah(media.id, { visibilitas: baru });
      kabar("Privasi diganti jadi " + (baru === "PUBLIC" ? "Publik" : baru === "PROFILE" ? "Profil doang" : "Privat"));
      mainkanSfx("notification");
    } catch {
      kabar("Gak nyambung ke server.");
      mainkanSfx("failure");
    } finally {
      setSibukPrivasi(false);
      setMenuPrivasi(null);
    }
  }

  function itemMenuKomentar(k: KomentarPublik): AksiItem[] {
    const isi: AksiItem[] = [
      { id: "salin", label: "Salin", ikon: <SalinIkon ukuran={15} />, onKlik: () => salinKomentar(k) },
    ];
    if (bisaHapusKom(k)) {
      isi.push({ id: "hapus", label: "Hapus", ikon: <HapusIkon ukuran={15} />, bahaya: true, onKlik: () => setKonfirmHapusKom(k) });
    }
    if (k.user.id !== pengguna?.id) {
      isi.push({
        id: "lapor",
        label: "Laporkan",
        ikon: <LaporIkon ukuran={15} />,
        onKlik: () => (masuk ? setKonfirmLaporKom(k) : bukaPintu()),
      });
    }
    return isi;
  }

  /* ---------- Carousel multi-foto (r24) ----------
     1 item: pratinjau biasa (tanpa dot, perilaku lama). 2+ item:
     scroll-snap horizontal (swipe native di HP, drag pointer di
     desktop), dot di tengah bawah, keyboard panah (fokus area).
     Tinggi area ikut rasio slide AKTIF (transisi halus), max 76vh
     kayak dulu, jadi rasio campur (portrait+landscape) gak bikin
     loncat layout. */
  const jumlahItem = media.item?.length || 1;
  const itemSekarang =
    media.item?.[Math.min(aktif, Math.max(0, media.item.length - 1))] ?? {
      jenis: media.jenis,
      nama: media.nama,
      rasio: media.rasio,
      pratinjau: media.pratinjau,
      file: media.file,
    };

  function keSlide(i: number) {
    const rel = relRef.current;
    if (!rel) return;
    const idx = Math.max(0, Math.min(jumlahItem - 1, i));
    rel.scrollTo({
      left: idx * rel.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    setAktif(idx);
  }

  /* Gulir → slide aktif (dot + tinggi ikut). rAF biar gak kebanjiran
     event pas momentum scroll. */
  useEffect(() => {
    const rel = relRef.current;
    if (!rel || jumlahItem < 2) return;
    let raf = 0;
    const onGulir = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = Math.round(rel.scrollLeft / Math.max(1, rel.clientWidth));
        setAktif(Math.max(0, Math.min(jumlahItem - 1, i)));
      });
    };
    rel.addEventListener("scroll", onGulir, { passive: true });
    return () => {
      rel.removeEventListener("scroll", onGulir);
      cancelAnimationFrame(raf);
    };
  }, [jumlahItem]);

  /* Ukuran lebar area (buat tinggi yang nurut rasio aktif). */
  useEffect(() => {
    const rel = relRef.current;
    if (!rel || jumlahItem < 2) return;
    setLebarRel(rel.clientWidth);
    const ro = new ResizeObserver((e) => setLebarRel(e[0].contentRect.width));
    ro.observe(rel);
    return () => ro.disconnect();
  }, [jumlahItem]);

  /* Mouse drag (desktop, P1-5 "hold untuk slide"): geser slide pakai
     tombol kiri yang di-held. Sentuh gak butuh (swipe native +
     scroll-snap), makany cuma pointerType mouse yang ditangani.
     Rilis = keputusan eksplisit:
     - gerakan pendek (< 8px) = bukan drag -> balik ke slide aktif
       (klik biasa gak keanggep swipe).
     - lepas CEPAT (velocity > 0.55 px/ms) -> maju/mundur satu slide
       di ARAH GERAKAN (fling), walau belum lewat setengah lebar.
     - selebihny -> snap ke slide terdeket (scrollTo smooth; gak
       bergantung ke timing momentum CSS doang).
     pointercancel ikut ditangani (browser nyulap gesture — tanpa ny,
     drag bisa nyangkut "nyala" selamany). */
  useEffect(() => {
    const rel = relRef.current;
    if (!rel || jumlahItem < 2) return;
    let turun = false;
    let mulaiX = 0;
    let mulaiKiri = 0;
    let gerak = 0;
    /* Riwayat sampel (x, t) buat velocity SMOOTHING: velocity instan
       per-event itu berisik (event mouse bisa numpuk 1 frame).
       Dihitung dari jendela ~80ms terakhir -> nyerminin kecepatan
       yang kerasain pas dilepas. */
    const sampel: { x: number; t: number }[] = [];
    const CATAT_SAMPL = 8;
    const vxHalus = () => {
      while (sampel.length > CATAT_SAMPL) sampel.shift();
      if (sampel.length < 2) return 0;
      const akhir = sampel[sampel.length - 1];
      /* sampel TER TUA yang masih di jendela 80ms (sampel urut lama ->
         baru: begitu ketemu satu yang muat, itu udah yang paling tua
         di jendela — berhenti, jangan ditimpa sama sampel baru). */
      let awal = sampel[0];
      for (const s of sampel) {
        if (akhir.t - s.t <= 80) {
          awal = s;
          break;
        }
      }
      const dt = akhir.t - awal.t;
      return dt > 0 ? (akhir.x - awal.x) / dt : 0;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      /* preventDefault: tanpa ini, drag mouse di atas <img> slide
         nge-trigger drag-and-drop gambar NATIVE browser -> pointermove
         kecancel (pointercancel) -> carousel gak pernah bergeser di
         desktop. Dengan ini gesture kena milik carousel kita. */
      e.preventDefault();
      turun = true;
      gerak = 0;
      sampel.length = 0;
      sampel.push({ x: e.clientX, t: performance.now() });
      mulaiX = e.clientX;
      mulaiKiri = rel.scrollLeft;
      /* scroll-snap dimatikan SEKADAR pas drag mouse: mandatory snap
         nge-re-snap SETIAP assignment scrollLeft programatik (dibuktikan
         live: set 200 dibaca balik 0), jadi slide gak pernah ngikutin
         kursor. Snap ny dipegang manual pas dilepas (keSlide);
         sentuh tetep pake snap native (swipe). */
      rel.style.scrollSnapType = "none";
    };
    const onMove = (e: PointerEvent) => {
      if (!turun) return;
      sampel.push({ x: e.clientX, t: performance.now() });
      gerak = e.clientX - mulaiX;
      rel.scrollLeft = mulaiKiri - gerak;
    };
    const onUp = () => {
      if (!turun) return;
      turun = false;
      /* snap dipulihkin dulu baru keSlide mutusin posisi akhir
         (scrollTo eksplisit ke slide target). */
      rel.style.scrollSnapType = "";
      const vx = vxHalus();
      const lebar = Math.max(1, rel.clientWidth);
      const idxSekarang = Math.max(0, Math.min(jumlahItem - 1, Math.round(rel.scrollLeft / lebar)));
      if (Math.abs(gerak) < 8) {
        keSlide(idxSekarang); /* gerakan mikro: balik (klik bukan swipe) */
        return;
      }
      /* fling: kenceng pas dilepas (0.8 px/ms ~ gerakan 80px dalam
         100ms) -> lanjut satu slide di ARAH GERAKAN. Drag kiri
         (vx < 0) = konten geser kanan = slide BERIKUTNY; drag kanan
         = sebelumny. */
      if (Math.abs(vx) > 0.8) {
        keSlide(idxSekarang + (vx < 0 ? 1 : -1));
        return;
      }
      keSlide(idxSekarang);
    };
    rel.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      rel.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [jumlahItem]);

  const rasioAktif = itemSekarang.rasio && itemSekarang.rasio > 0.05 ? itemSekarang.rasio : 0.8;
  const rasioAwal = media.item?.[0]?.rasio && media.item[0].rasio! > 0.05 ? media.item[0].rasio! : media.rasio ?? 0.8;
  const tinggiMaks = typeof window === "undefined" ? 800 : Math.round(window.innerHeight * 0.76);
  const tinggiRel =
    jumlahItem > 1 && lebarRel > 0 ? Math.min(Math.round(lebarRel / rasioAktif), tinggiMaks) : undefined;

  function bukaAsli(t: HTMLButtonElement) {
    if (itemSekarang.jenis === "video") {
      bukaVideo();
      return;
    }
    /* Semua FOTO di post ini kebuka di penampil (slide aktif duluan);
     * video item gak masuk penampil foto (ny diputer lewat tombol
     * pas slide ny aktif). */
    const fotoItem = (media.item ?? []).filter((i) => i.jenis === "foto");
    const daftar = (fotoItem.length ? fotoItem : [itemSekarang]).map((i) => ({ src: i.file, alt: media.judul || i.nama }));
    const idx = Math.max(0, fotoItem.findIndex((i) => i.file === itemSekarang.file));
    Penampil.buka(daftar, idx, t);
  }

  /* r30: buka penampil video penuh. Dipanggil dari BARIS KONTROL
     VideoInline (tombol perbesar ny sekarang nempel di situ, satu
     row sama bisu) — perilaku ny sama kayak dulu: rasio slide
     aktif kebawa ke penampil biar kotak ny udah bener ukuran ny
     dari frame pertama (poster ny kepake juga), gak ada lompatan
     layout atau kotak hitam default 300x150. */
  function bukaVideo() {
    const w = imgPratinjau.current?.naturalWidth;
    const h = imgPratinjau.current?.naturalHeight;
    setVideoBuka({
      sumber: {
        file: itemSekarang.file,
        nama: itemSekarang.nama,
        judul: media.judul,
        pratinjau: itemSekarang.pratinjau,
      },
      rasio: itemSekarang.rasio || (w && h ? w / h : null),
    });
  }

  function pilihBalas(k: KomentarPublik) {
    setBalasan(k);
    mainkanSfx("ui-menu");
    document.getElementById("inputKomentar")?.focus();
  }

  return (
    <div
      className="post-lapis"
      role="dialog"
      aria-modal="true"
      aria-label={"Post " + (media.judul || media.nama)}
      onPointerDown={(e) => {
        /* dicatat dari titik mana pun di dalem panel: drag slide bisa
           mulai di kotak media terus dilepas di luar ny (click
           sintetis ny jatuh ke backdrop). */
        asalPointer.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const asal = asalPointer.current;
        /* gerakan > 12px sejak tekan = drag (misal slide carousel
           nyasar keluar kotak), bukan klik tutup. */
        if (asal && Math.hypot(e.clientX - asal.x, e.clientY - asal.y) > 12) return;
        onTutup();
      }}
    >
      <section className="post-kotak">
        <button type="button" className="post-tutup" data-sfx="ui-dissolve" aria-label="Tutup post" onClick={onTutup}>
          <TutupIkon />
        </button>

        <div className="post-media">
          {jumlahItem > 1 ? (
            <div
              className="post-rel"
              ref={relRef}
              role="region"
              aria-roledescription="carousel"
              aria-label={"Slide post " + (media.judul || media.nama)}
              tabIndex={0}
              style={{ aspectRatio: String(rasioAwal), height: tinggiRel }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  keSlide(aktif - 1);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  keSlide(aktif + 1);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  keSlide(0);
                } else if (e.key === "End") {
                  e.preventDefault();
                  keSlide(jumlahItem - 1);
                }
              }}
            >
              {media.item!.map((it, i) => (
                <div
                  className={"post-slide" + (i === aktif ? " aktif" : "")}
                  key={i}
                  aria-hidden={i !== aktif}
                  aria-label={"Slide " + (i + 1) + " dari " + jumlahItem}
                >
                  {/* Video slide AKTIF: muter langsung (r28) — pindah
                      slide = unmount = berhenti sendiri, gak ada dua
                      video bersuara barengan. Slide video yang GAK
                      aktif tetep poster + ikon play. r30: tombol
                      perbesar ny di BARIS KONTROL VideoInline (satu
                      row sama bisu). */}
                  {it.jenis === "video" && i === aktif ? (
                    <VideoInline
                      file={it.file}
                      pratinjau={it.pratinjau}
                      nama={it.nama}
                      rasio={it.rasio}
                      tertunda={!!videoBuka}
                      onPerbesar={bukaVideo}
                    />
                  ) : (
                    <>
                      <img
                        src={it.pratinjau}
                        alt=""
                        loading={i === 0 ? "eager" : "lazy"}
                        decoding="async"
                        ref={i === 0 ? imgPratinjau : undefined}
                      />
                      {it.jenis === "video" && (
                        <span className="post-slide-play" aria-hidden="true">
                          <PlayIkon ukuran={30} />
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : itemSekarang.jenis === "video" ? (
            /* Post video tunggal: langsung muter pas panel dibuka
               (r28) — gak ada state "klik dulu baru preview baru
               play". Mute/suara ny preferensi persisten user.
               r30: perbesar ny satu row sama bisu di VideoInline. */
            <VideoInline
              file={itemSekarang.file}
              pratinjau={itemSekarang.pratinjau}
              nama={itemSekarang.nama}
              rasio={itemSekarang.rasio ?? media.rasio}
              tertunda={!!videoBuka}
              onPerbesar={bukaVideo}
            />
          ) : (
            <img src={media.pratinjau} alt={media.judul || media.nama} loading="lazy" decoding="async" ref={imgPratinjau} />
          )}

          {jumlahItem > 1 && (
            <div className="post-dot" role="tablist" aria-label={"Pilih slide"}>
              {media.item!.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === aktif}
                  aria-label={"Slide " + (i + 1)}
                  className={i === aktif ? "aktif" : ""}
                  onClick={() => keSlide(i)}
                />
              ))}
            </div>
          )}

          {/* r30: tombol ini cuma buat FOTO ("Lihat asli"). Buat
              video, perbesar ny udah nempel di BARIS KONTROL
              VideoInline (satu row sama bisu) — render dua-duanya
              = dua tombol numpuk di pojok yang sama. */}
          {itemSekarang.jenis !== "video" && (
            <button
              type="button"
              className="post-buka-asli"
              data-sfx="ui-menu"
              onClick={(e) => bukaAsli(e.currentTarget)}
              aria-label="Lihat asli"
            >
              <BesarIkon ukuran={15} />
              <span className="post-asli-tip" aria-hidden="true">
                Lihat asli
              </span>
            </button>
          )}
        </div>

        <div className="post-sisi">
          <header className="post-kepala">
            {media.user ? (
              <Link className="post-user" href={urlProfil(media.user)}>
                {media.user.pfp ? (
                  <img src={urlPfp(media.user)} alt="" width={32} height={32} loading="lazy" decoding="async" />
                ) : (
                  <span className="post-inisial" aria-hidden="true">
                    <OrangIkon ukuran={16} />
                  </span>
                )}
                <b>
                  {media.user.nama}
                  {media.user.verified && <LencanaVerified />}
                </b>
                {media.user.username && <span className="post-user-handle">@{media.user.username}</span>}
              </Link>
            ) : (
              <span className="post-user">
                <span className="post-inisial" aria-hidden="true">
                  <OrangIkon ukuran={16} />
                </span>
                <b>dari arsip</b>
              </span>
            )}
            <time>{waktuRelatif(media.waktu, detak)}</time>
            {vis !== "PUBLIC" && (
              <span className={"post-vis " + (vis === "PRIVATE" ? "privat" : "profil")}>
                {vis === "PRIVATE" ? "Privat" : "Profil doang"}
              </span>
            )}
          </header>

          {/* Caption (r28): mention @username jadi link profil —
              render token ny aman (BioSebut: teks dipecah + link,
              GAK pake dangerouslySetInnerHTML). */}
          {media.judul && (
            <p className="post-judul">
              <BioSebut teks={media.judul} />
            </p>
          )}

          <div className="post-aksi">
            <button type="button" className={"suka-btn" + (suka.aku ? " aktif" : "")} onClick={suka_} aria-pressed={suka.aku}>
              {suka.aku ? <SukaPenuhIkon ukuran={15} /> : <SukaOutlineIkon ukuran={15} />}
              <span>{suka.jumlah}</span>
              <span className="sr-only">suka</span>
            </button>
            <span className="ket-komentar">
              {daftar === null ? "Memuat komentar..." : daftar.length + " komentar"}
            </span>
            <span className="ket-komentar penonton">{formatJumlah(dilihat)} penonton</span>
            {/* Menu titik-tiga: aksi cuma keliatan pas dibuka, isinya
                nurut izin (Hapus kalo boleh, Laporkan). */}
            <button
              type="button"
              className="post-menu"
              aria-haspopup="menu"
              aria-expanded={!!menuPost}
              aria-label="Menu post"
              onClick={(e) => {
                if (!itemMenuPost().length) return;
                const kotak = e.currentTarget.getBoundingClientRect();
                setMenuPost({ x: kotak.right, y: kotak.bottom + 6 });
                mainkanSfx("ui-menu");
              }}
            >
              <TitikTigaIkon ukuran={16} />
            </button>
          </div>

          <ul className="post-komentar" ref={ulKomentar}>
            {daftar === null && (
              <>
                <li className="pk-skeleton" aria-hidden="true">
                  <span className="pk-inisial" />
                  <span className="pk-badan">
                    <span className="garis-skeleton" style={{ width: "70%" }} />
                    <span className="garis-skeleton" style={{ width: "35%" }} />
                  </span>
                </li>
                <li className="pk-skeleton" aria-hidden="true">
                  <span className="pk-inisial" />
                  <span className="pk-badan">
                    <span className="garis-skeleton" style={{ width: "82%" }} />
                    <span className="garis-skeleton" style={{ width: "28%" }} />
                  </span>
                </li>
              </>
            )}
            {daftar !== null && daftar.length === 0 && (
              <li className="post-kosong">Belum ada yang komen. Jadi yang pertama?</li>
            )}
            {utas?.map((u) => (
              <li key={u.kom.id} id={"komentar-" + u.kom.id} className={baru.has(u.kom.id) ? "baru" : ""}>
                <KomentarBaris k={u.kom} detak={detak} onBalas={pilihBalas} onMenu={(x, y) => setMenuKomentar({ x, y, k: u.kom })} />
                {u.balasan.length > 0 && (
                  <ul className="pk-utas">
                    {u.balasan.map((r) => (
                      <li key={r.id} id={"komentar-" + r.id} className={baru.has(r.id) ? "baru" : ""}>
                        <KomentarBaris k={r} detak={detak} onBalas={pilihBalas} onMenu={(x, y) => setMenuKomentar({ x, y, k: r })} kecil />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {balasan && (
            /* R20/R21 (nyamain bar balasan chat): 2 baris — label +
               batal, teks quote 1 baris CSS ellipsis. Gak ada slice
               JS; teks DOM utuh. */
            <div className="balas-bar balas-komentar" role="group" aria-label="Pratinjau balasan">
              <div className="balas-bar-atas">
                <span className="balas-bar-label">
                  Membalas <b>@{balasan.user.nama}</b>
                </span>
                <button
                  type="button"
                  className="balas-bar-tutup"
                  onClick={() => setBalasan(null)}
                  aria-label="Batal balas"
                >
                  <TutupIkon />
                </button>
              </div>
              <p className="balas-bar-teks">{balasan.teks}</p>
            </div>
          )}

          <form className="post-form" onSubmit={kirim}>
            {/* r29: wrapper relative = anchor dropdown autocomplete
                @mention (flip atas/bawah ngikut viewport — pola
                bio-edit-wrap). */}
            <div className="komen-edit-wrap">
              <textarea
                id="inputKomentar"
                ref={komentarRef}
                value={teks}
                onChange={(e) => {
                  setTeks(e.target.value);
                  setPosisiKomentar(e.target.selectionStart ?? e.target.value.length);
                }}
                onSelect={(e) => setPosisiKomentar(e.currentTarget.selectionStart ?? 0)}
                onKeyUp={(e) => setPosisiKomentar(e.currentTarget.selectionStart ?? 0)}
                onClick={(e) => setPosisiKomentar(e.currentTarget.selectionStart ?? 0)}
                placeholder={balasan ? "Balas @" + balasan.user.nama + "..." : masuk ? "Tulis komentar... (@ buat nyebut orang)" : "Login dulu buat nulis komentar"}
                maxLength={500}
                rows={2}
                aria-label="Komentar"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (balasan) {
                      e.stopPropagation();
                      setBalasan(null);
                    }
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    /* IME (bahasa Cina/Jepang/Korea dll): Enter ny
                       buat milih kandidat, jangan dikirim. */
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    kirim(e);
                  }
                }}
              />
              <SebutOtomatis teks={teks} posisi={posisiKomentar} onPilih={pilihSebutKomentar} />
            </div>
            <button type="submit" className="btn primary" disabled={sibuk || !teks.trim()}>
              <KirimIkon />
              Kirim
            </button>
          </form>
          {umpan && (
            <p className="umpan-baris" role="status">
              <CentangIkon ukuran={12} /> {umpan}
            </p>
          )}
          {galat && (
            <p className="hint" role="alert" style={{ color: "var(--tanda)" }}>
              {galat}
            </p>
          )}
        </div>
      </section>

      {videoBuka && <PenampilVideo media={videoBuka.sumber} rasio={videoBuka.rasio} onTutup={() => setVideoBuka(null)} />}

      {menuPost && <MenuAksi x={menuPost.x} y={menuPost.y} items={itemMenuPost()} onTutup={() => setMenuPost(null)} />}
      {menuPrivasi && (
        <MenuAksi
          x={menuPrivasi.x}
          y={menuPrivasi.y}
          items={[
            {
              id: "PUBLIC",
              label: "Publik",
              ikon: vis === "PUBLIC" ? <CentangIkon ukuran={15} /> : <GembokIkon ukuran={15} />,
              onKlik: () => ubahPrivasi("PUBLIC"),
            },
            {
              id: "PROFILE",
              label: "Hanya Profil",
              ikon: vis === "PROFILE" ? <CentangIkon ukuran={15} /> : <GembokIkon ukuran={15} />,
              onKlik: () => ubahPrivasi("PROFILE"),
            },
            {
              id: "PRIVATE",
              label: "Private",
              ikon: vis === "PRIVATE" ? <CentangIkon ukuran={15} /> : <GembokIkon ukuran={15} />,
              onKlik: () => ubahPrivasi("PRIVATE"),
            },
          ]}
          onTutup={() => setMenuPrivasi(null)}
        />
      )}
      {/* r30: submenu izin unduhan (pemilik) — pola submenu privasi. */}
      {menuUnduhIzin && (
        <MenuAksi
          x={menuUnduhIzin.x}
          y={menuUnduhIzin.y}
          items={[
            {
              id: "izin-ya",
              label: "Boleh diunduh",
              ikon: bolehUnduh ? <CentangIkon ukuran={15} /> : <UnduhIkon ukuran={15} />,
              onKlik: () => void ubahUnduhIzin(true),
            },
            {
              id: "izin-nggak",
              label: "Cuma lu sendiri",
              ikon: !bolehUnduh ? <CentangIkon ukuran={15} /> : <GembokIkon ukuran={15} />,
              onKlik: () => void ubahUnduhIzin(false),
            },
          ]}
          onTutup={() => setMenuUnduhIzin(null)}
        />
      )}
      {menuKomentar && (
        <MenuAksi
          x={menuKomentar.x}
          y={menuKomentar.y}
          items={itemMenuKomentar(menuKomentar.k)}
          onTutup={() => setMenuKomentar(null)}
        />
      )}

      {konfirmHapusKom && (
        <Konfirmasi
          judul="Hapus komentar ini?"
          pesan="Komentar ny ilang dari post ini buat semua orang. Balasan ke komentar ni balik jadi komentar biasa."
          labelYakin="Hapus"
          sibuk={sibukAksi}
          onYakin={hapusKomentar}
          onBatal={() => setKonfirmHapusKom(null)}
        />
      )}

      {konfirmLaporKom && (
        <Konfirmasi
          judul="Laporkan komentar ini?"
          pesan="Laporan ny nyampe ke owner lengkap sama isi komentar ny. Komentar ny tetep keliatan sampai owner ny mroses."
          labelYakin="Laporkan"
          sibuk={sibukAksi}
          onYakin={() => kirimLapor("komentar", konfirmLaporKom)}
          onBatal={() => setKonfirmLaporKom(null)}
        />
      )}

      {konfirmLaporPost && (
        <Konfirmasi
          judul="Laporkan post ini?"
          pesan="Laporan ny nyampe ke owner lengkap sama post ny. Post ny tetep keliatan sampai owner ny mroses."
          labelYakin="Laporkan"
          sibuk={sibukAksi}
          onYakin={() => kirimLapor("media")}
          onBatal={() => setKonfirmLaporPost(false)}
        />
      )}

      {konfirmHapus && (
        <Konfirmasi
          judul="Hapus post ini?"
          pesan="Post, komentar, sama sukany ikut kehapus. Gak bisa dibalikin."
          labelYakin="Hapus"
          sibuk={sibuk}
          onYakin={hapusPost}
          onBatal={() => setKonfirmHapus(false)}
        />
      )}
    </div>
  );
}

/* Satu baris komentar: PFP kiri, username + waktu, teks wrap sejajar
   kolom, tombol Balas. Dipake buat komentar induk (biasa) sama
   balasan (kecil: PFP lebih ramping). Sapaan @nama cuma muncul di
   baris balasan, nunjuk target yang bener (data dari server).
   Long-press (HP) / klik kanan (desktop) = menu aksi: Salin, Hapus
   (kalo boleh), Laporkan. */
function KomentarBaris({
  k,
  detak,
  onBalas,
  onMenu,
  kecil,
}: {
  k: KomentarPublik;
  detak: number;
  onBalas: (k: KomentarPublik) => void;
  onMenu: (x: number, y: number) => void;
  kecil?: boolean;
}) {
  const tekan = useTekanLama(onMenu);
  return (
    <div className={"pk-baris" + (kecil ? " kecil" : "")} {...tekan}>
      <span className="pk-pfp" aria-hidden="true">
        {k.user.pfp ? (
          <img src={urlPfp(k.user)} alt="" width={kecil ? 20 : 26} height={kecil ? 20 : 26} loading="lazy" decoding="async" />
        ) : (
          <span className="pk-inisial">{k.user.nama.slice(0, 1).toUpperCase()}</span>
        )}
      </span>
      <span className="pk-badan">
        <span className="pk-user">
          <Link href={urlProfil(k.user)}>
            <b>
              {k.user.nama}
              {k.user.verified && <LencanaVerified />}
            </b>
          </Link>
          <time>{waktuRelatif(k.waktu, detak)}</time>
        </span>
        <span className="pk-teks">
          {k.balasan && (
            <button
              type="button"
              className="pk-sapa"
              onClick={() => lompatKe(k.balasan!.id)}
              aria-label={"Lihat komentar dari " + k.balasan!.nama + " yang dibalas"}
            >
              @{k.balasan.nama}
            </button>
          )}
          {/* r29: mention @username jadi link profil + newline
              ny ke-render (CSS .pk-teks pre-line). Render token ny
              aman (BioSebut: teks dipecah + link, GAK pake
              dangerouslySetInnerHTML). */}
          {k.balasan ? " " : ""}
          <BioSebut teks={k.teks} />
        </span>
        <button type="button" className="pk-balas" onClick={() => onBalas(k)} aria-label={"Balas komentar " + k.user.nama}>
          <BalasIkon ukuran={12} />
          <span className="label">Balas</span>
        </button>
      </span>
    </div>
  );
}
