import type { ReactNode } from "react";
import s from "./KosongSakura.module.css";

/* Keadaan kosong tema Hanami: ranting sakura minimalis yang tergambar sekali
   (garis menjulur, bunga mekar satu per satu), lalu sesekali sehelai kelopak
   jatuh. Teks rata kiri supaya tetap sejalan dengan grid Swiss.

   <KosongSakura judul="Belum ada riwayat tebakan" keterangan="Mulai satu sesi untuk melihatnya di sini.">
     <button>Mulai menebak</button>
   </KosongSakura> */

type Props = {
  judul: string;
  keterangan?: string;
  children?: ReactNode; // aksi, mis. tombol
  className?: string;
};

// titik-titik ini jatuh persis di atas jalur ranting pada SVG di bawah
const BUNGA = [
  { x: 160, y: 36, k: 0.95, d: 1.0 },
  { x: 96, y: 94, k: 1.15, d: 1.3 },
  { x: 306, y: 72, k: 0.9, d: 1.45 },
  { x: 216, y: 124, k: 1.2, d: 1.6 },
  { x: 276, y: 134, k: 1.0, d: 1.8 },
] as const;

export default function KosongSakura({ judul, keterangan, children, className }: Props) {
  return (
    <section className={`${s.root} ${className ?? ""}`}>
      <svg className={s.gambar} viewBox="-12 0 332 160" aria-hidden="true" focusable="false">
        <g className={s.goyang}>
          <path className={s.kayu} pathLength={1} d="M -12 28 C 50 30, 110 14, 160 36 S 250 80, 332 70" />
          <path className={s.kayu} pathLength={1} style={{ animationDelay: "0.8s" }} d="M 96 24 C 98 50, 90 72, 96 94" />
          <path className={s.kayu} pathLength={1} style={{ animationDelay: "1.0s" }} d="M 218 60 C 224 84, 210 104, 216 124" />
          <path className={s.kayu} pathLength={1} style={{ animationDelay: "1.2s" }} d="M 278 72 C 284 96, 272 112, 276 134" />
          {BUNGA.map((b) => (
            <g key={`${b.x}-${b.y}`} transform={`translate(${b.x} ${b.y}) scale(${b.k})`}>
              <g className={s.mekar} style={{ animationDelay: `${b.d}s` }}>
                {[0, 72, 144, 216, 288].map((r) => (
                  <ellipse key={r} className={s.kelopak} cx="0" cy="-5.2" rx="3.7" ry="5.2" transform={`rotate(${r})`} />
                ))}
                <circle className={s.putik} r="1.5" />
              </g>
            </g>
          ))}
        </g>
        <ellipse className={`${s.jatuh} ${s.jatuhA}`} cx="188" cy="92" rx="2.8" ry="4.2" />
        <ellipse className={`${s.jatuh} ${s.jatuhB}`} cx="246" cy="104" rx="2.4" ry="3.6" />
      </svg>
      <h2 className={s.judul}>{judul}</h2>
      {keterangan ? <p className={s.keterangan}>{keterangan}</p> : null}
      {children ? <div className={s.aksi}>{children}</div> : null}
    </section>
  );
}
