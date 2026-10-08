/* Ikon SVG inline: goresan tinta 1.5, ujung kotak, nyambung sama
   bahasa cetak situs ny. Semua ikon ny relevant ke isi ny (R-04). */

type IkonProps = { ukuran?: number; className?: string };

/* Ikon dari aset SVG milik user (public/aset). Dipake lewat mask +
   currentColor: bentuk ny dari file aset, warna ny ikut warna teks
   sekitar, jadi kebaca di tema terang maupun gelap. */
export function AsetIkon({ nama, ukuran = 16, className }: IkonProps & { nama: string }) {
  return (
    <span
      aria-hidden="true"
      className={"ikon-aset" + (className ? " " + className : "")}
      style={{
        width: ukuran,
        height: ukuran,
        maskImage: `url(/aset/${nama}.svg)`,
        WebkitMaskImage: `url(/aset/${nama}.svg)`,
      }}
    />
  );
}

/* Badge terverifikasi (verified.svg): status dari data user, bukan
   tempelan tampilan. Ukuran ny ngikut font username sekitar ny (em,
   lihat .lencana di globals.css), jadi proporsional di semua tempat
   tanpa musti diatur satu-satu. */
export function LencanaVerified({ className }: IkonProps) {
  return (
    <span
      role="img"
      aria-label="Akun terverifikasi"
      title="Akun terverifikasi"
      className={"lencana" + (className ? " " + className : "")}
    />
  );
}

export function MataIkon({ ukuran = 18, className }: IkonProps) {
  return <AsetIkon nama="eye" ukuran={ukuran} className={className} />;
}

export function MataTutupIkon({ ukuran = 18, className }: IkonProps) {
  return <AsetIkon nama="eye-off" ukuran={ukuran} className={className} />;
}

export function MenuIkon({ ukuran = 20, className }: IkonProps) {
  return <AsetIkon nama="menu" ukuran={ukuran} className={className} />;
}

export function TempelIkon({ ukuran = 16, className }: IkonProps) {
  return <AsetIkon nama="paste" ukuran={ukuran} className={className} />;
}

export function SukaOutlineIkon({ ukuran = 16, className }: IkonProps) {
  return <AsetIkon nama="love" ukuran={ukuran} className={className} />;
}

export function SukaPenuhIkon({ ukuran = 16, className }: IkonProps) {
  return <AsetIkon nama="loved" ukuran={ukuran} className={className} />;
}

export function KomentarAsetIkon({ ukuran = 16, className }: IkonProps) {
  return <AsetIkon nama="comment" ukuran={ukuran} className={className} />;
}

/* Kamera (r28): tombol ganti foto profil — aset camera.svg, owner bisa
   langsung replace file ny tanpa nyentuh kode. */
export function KameraIkon({ ukuran = 16, className }: IkonProps) {
  return <AsetIkon nama="camera" ukuran={ukuran} className={className} />;
}

/* Surat (r28): ikon mail buat notification center di masthead. */
export function SuratIkon({ ukuran = 20, className }: IkonProps) {
  return <AsetIkon nama="mail" ukuran={ukuran} className={className} />;
}

export function Merek({ ukuran = 20, className }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <rect x="1.25" y="1.25" width="11.5" height="11.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7.25" y="7.25" width="11.5" height="11.5" fill="currentColor" />
    </svg>
  );
}

export function Matahari({ ukuran = 18 }: IkonProps) {
  return (
    <svg className="ik-matahari" width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

export function Bulan({ ukuran = 18 }: IkonProps) {
  return (
    <svg className="ik-bulan" width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

export function Panah({ ukuran = 15 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 8h13M9 3l5 5-5 5" />
    </svg>
  );
}

/* Panah bawah: expand/collapse section "aktivitas lainnya" (r27). */
export function PanahBawahIkon({ ukuran = 15 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M2 5l6 6 6-6" />
    </svg>
  );
}

export function PanahKeluar({ ukuran = 15 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 13 13 3M6 3h7v7" />
    </svg>
  );
}

export function TikTokIkon({ ukuran = 26 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M14 4v9.5a4.5 4.5 0 1 1-4.5-4.5" />
      <path d="M14 4c.5 2.6 2.1 4.1 4.5 4.5" />
    </svg>
  );
}

export function InstagramIkon({ ukuran = 26 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PinterestIkon({ ukuran = 26 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M10.2 16.6V8h2.7a2.9 2.9 0 0 1 0 5.8h-2.7" />
      <path d="M12.9 13.8c-.3 1.4-.9 2.9-1.5 4.2" />
    </svg>
  );
}

export function ObrolanIkon({ ukuran = 26 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3.5 4.5h17v12h-9l-4 3v-3h-4z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  );
}

export function UnduhIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 1.5v9M4.5 7.5 8 11l3.5-3.5M2 13.5h12" />
    </svg>
  );
}

export function NadaIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 13V7M6.5 13V3M10.5 13V8.5M14 13V5" />
    </svg>
  );
}

/* Centang: tanda unduhan sukses di panel AIO (state "Selesai"). */
export function CentangIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square">
      <path d="M2.5 8.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

export function SemuaIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 1.5 1.5 5 8 8.5 14.5 5 8 1.5z" />
      <path d="M1.5 8.5 8 12l6.5-3.5M1.5 11.5 8 15l6.5-3.5" />
    </svg>
  );
}

export function PlayIkon({ ukuran = 11 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M4.5 3l9 5-9 5z" />
    </svg>
  );
}

/* Jeda (pause) player video r24. */
export function JedaIkon({ ukuran = 14 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M4 3h3v10H4zM9 3h3v10H9z" />
    </svg>
  );
}

/* Speaker nyala (volume) player video r24. */
export function SuaraIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" stroke="currentColor" strokeWidth="1.2">
      <path d="M2.5 6v4h2.8L9 13V3L5.3 6H2.5z" stroke="none" />
      <path d="M11 5.5c1 1.3 1 3.7 0 5M12.8 3.8c1.8 2.2 1.8 6.2 0 8.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* Speaker bisu (muted) player video r24. */
export function BisuIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" stroke="currentColor" strokeWidth="1.2">
      <path d="M2.5 6v4h2.8L9 13V3L5.3 6H2.5z" stroke="none" />
      <path d="M11 6l4 4M15 6l-4 4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* Layar penuh player video r24 (empat sudut). */
export function LayarIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
    </svg>
  );
}

/* Potongan (crop) foto post r24: sudut putus-putus + garis silang. */
export function PotongIkon({ ukuran = 14 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeDasharray="2 2">
      <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
      <path d="M6 6l4 4M10 6l-4 4" strokeDasharray="none" />
    </svg>
  );
}

export function FotoIkon({ ukuran = 12 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2.5" width="13" height="11" />
      <circle cx="5" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <path d="M2 12l4-4 2.5 2.5L11 8l3.5 3.5" />
    </svg>
  );
}

export function BesarIkon({ ukuran = 13 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="5" />
      <path d="M7 5v4M5 7h4M11 11l3.5 3.5" />
    </svg>
  );
}

export function TutupIkon({ ukuran = 14 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

export function KiriIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M15 8H2M7 3 2 8l5 5" />
    </svg>
  );
}

export function KananIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 8h13M9 3l5 5-5 5" />
    </svg>
  );
}

export function ZoomInIkon({ ukuran = 18 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="11" cy="11" r="7" />
      <path d="M11 8v6M8 11h6M21 21l-4.3-4.3" />
    </svg>
  );
}

export function ZoomOutIkon({ ukuran = 18 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="11" cy="11" r="7" />
      <path d="M8 11h6M21 21l-4.3-4.3" />
    </svg>
  );
}

export function ResetIkon({ ukuran = 18 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function BalasIkon({ ukuran = 15 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6.5 3 2 7.5 6.5 12" />
      <path d="M2 7.5h7a5 5 0 0 1 5 5v.5" />
    </svg>
  );
}

export function KirimIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 8 14 2 8.5 14 7 9.5 2 8z" />
    </svg>
  );
}

export function CariIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3.5 3.5" />
    </svg>
  );
}

/* ---------- Ikon susunan grid (masonry / dua / tiga / baris) ---------- */
export function GridMasonry({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="1.5" width="6" height="9" />
      <rect x="8.5" y="1.5" width="6" height="4" />
      <rect x="8.5" y="6.5" width="6" height="8" />
      <rect x="1.5" y="11.5" width="6" height="3" />
    </svg>
  );
}

export function GridDua({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="1.5" width="5.4" height="13" />
      <rect x="9.1" y="1.5" width="5.4" height="13" />
    </svg>
  );
}

export function GridTiga({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="1.5" width="3.6" height="13" />
      <rect x="6.2" y="1.5" width="3.6" height="13" />
      <rect x="10.9" y="1.5" width="3.6" height="13" />
    </svg>
  );
}

export function GridBaris({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="1.5" width="13" height="4.2" />
      <rect x="1.5" y="6.9" width="13" height="4.2" />
      <rect x="1.5" y="12.3" width="13" height="2.2" />
    </svg>
  );
}

/* ---------- Ikon sosmed ---------- */
export function YouTubeIkon({ ukuran = 22 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10.5 9.3v5.4l4.7-2.7z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FacebookIkon({ ukuran = 22 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true">
      <path d="M14.5 3.5h-2a3.5 3.5 0 0 0-3.5 3.5V10H6.5v3H9v7.5" />
      <path d="M6.5 13H12" />
      <path d="M14.5 3.5V10" />
    </svg>
  );
}

export function WhatsAppIkon({ ukuran = 22 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.3-1.1A8.5 8.5 0 1 0 12 3.5Z" />
      <path d="M9.2 8.2c.3 2.9 2.7 5.3 5.6 5.6l.9-1.7 1.9.9c-.2 1.6-1.4 2.6-3 2.4-4.2-.4-7.3-3.5-7.7-7.7-.2-1.6.8-2.8 2.4-3l.9 1.9-1.7.9Z" />
    </svg>
  );
}

export function KotakIkon({ ukuran = 26 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M3 7 6 2h12l3 5M3 7v15h18V7M3 7h18M12 2v5M12 7v15" />
    </svg>
  );
}

export function PutarIkon({ ukuran = 18 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 3v6h-6" />
    </svg>
  );
}

export function SukaIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M12 20S3 15 3 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 9 2.5C21 15 12 20 12 20Z" />
    </svg>
  );
}

export function KomentarIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M21 12a8 8 0 0 1-8 8H4l2.2-3.3A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

export function UnggahIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M12 15V4M7 9l5-5 5 5M4 18v3h16v-3" />
    </svg>
  );
}

export function OrangIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21c1.5-3.8 4.6-5.5 7.5-5.5s6 1.7 7.5 5.5" />
    </svg>
  );
}

/* ---------- Ikon aksi pesan/komentar/post ---------- */

/* Salin: dua lembar numpuk (copy). */
export function SalinIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <rect x="5.5" y="1.5" width="9" height="9" />
      <path d="M1.5 5.5v9h9" />
    </svg>
  );
}

/* Tautan (rantai) r31: tombol "deteksi link" di kotak masuk AM
   V2 — buka satu pesan, keruk semua link ny (href + teks), kasih
   ke user buat disalin/dipencet. Dua gelang rantai miring. */
export function TautanIkon({ ukuran = 13 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M6.5 9.5l3-3" />
      <path d="M9.2 3.4l1.4-1.4c1-1 2.6-1 3.6 0s1 2.6 0 3.6l-1.4 1.4" />
      <path d="M6.8 12.6l-1.4 1.4c-1 1-2.6 1-3.6 0s-1-2.6 0-3.6l1.4-1.4" />
    </svg>
  );
}

/* Hapus: tempat sampah (delete). */
export function HapusIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M2.5 4.5h11M6 2.5h4M4 4.5v9h8v-9M6.5 7v4.5M9.5 7v4.5" />
    </svg>
  );
}

/* Lapor: bendera (report). */
export function LaporIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M3 2v12" />
      <path d="M3 3h9l-2.5 3L12 9H3" />
    </svg>
  );
}

/* Gembok: ubah privasi post (Publik / Profil doang / Privat). */
export function GembokIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <rect x="3" y="7" width="10" height="7" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      <path d="M8 9.5v2" />
    </svg>
  );
}

/* Titik tiga horizontal: menu post/komentar (⋯). */
export function TitikTigaIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

/* Edit profil (r29): pensil — menu "Edit profile". */
export function EditIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M10.5 2.5l3 3L5 14H2v-3z" />
      <path d="M9 4l3 3" />
    </svg>
  );
}

/* Pilih: kotak dicentang (mode seleksi multi pesan). */
export function PilihIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <rect x="1.5" y="1.5" width="13" height="13" />
      <path d="M4.5 8.5l2.5 2.5 4.5-5" />
    </svg>
  );
}

/* Muka senyum: kontrol custom emoji di Pengaturan (ikon ny tentang
   emoji, relevan ke isinya, bukan dekorasi). */
export function EmojiIkon({ ukuran = 16 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2" />
      <path d="M9 9.5v.01M15 9.5v.01" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/* Ukuran chat: tiga tingkatan (ikon huruf A kecil/besar buat kontrol
   di Pengaturan, nyambung sama tipografi chat ny). */
export function UkuranChatIkon({ ukuran = 18 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M3 18 8 6l5 12M4.6 14h6.8" />
      <path d="M15.5 18 19 10l3.5 8M16.5 15.5h5" />
    </svg>
  );
}

/* Lampu genie: ikon fitur Akinator (R23). */
export function LampuGenieIkon({ ukuran = 24 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M6.5 19.5h11" />
      <path d="M8.5 19.5c-2.8-.7-4.3-3.5-3-5.9.9-1.7 3-2.5 5.3-2.1l5.1 1c2 .4 3.4 1.9 3.1 3.5-.2 1.3-1.4 2.1-2.8 2.1H8.5" />
      <path d="M5.4 13.4 2.2 10.2l3.2.8" />
      <path d="M18.5 12.4c2.6.6 3.3 3 1.4 4.3" />
      <path d="M10.4 11.1c.3-1.4 1.9-2.2 3.3-1.5" />
      <path d="M12.2 7.9c.2-1 .9-1.5.9-2.4 0-.8-.7-1.2-.7-1.2" />
    </svg>
  );
}

/* Papan tic tac toe (# + X + O): ikon fitur game (r35). */
export function TictactoeIkon({ ukuran = 24 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M9 2.5v19M15 2.5v19M2.5 9h19M2.5 15h19" />
      <path d="M4.2 4.2l2.6 2.6M6.8 4.2 4.2 6.8" />
      <circle cx="12" cy="12" r="2.3" />
      <path d="M17.2 17.2l2.6 2.6M19.8 17.2l-2.6 2.6" />
    </svg>
  );
}

/* Empat ubin 2x2, satu terisi penuh (ubin yang baru gabung): ikon fitur game 2048. */
export function Game2048Ikon({ ukuran = 24 }: IkonProps) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="3" width="8" height="8" />
      <rect x="3" y="13" width="8" height="8" strokeDasharray="2 2" />
      <rect x="13" y="13" width="8" height="8" fill="currentColor" />
    </svg>
  );
}
