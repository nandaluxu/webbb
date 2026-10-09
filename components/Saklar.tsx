"use client";

/* Saklar (switch) ON/OFF: kontrol preferensi di Pengaturan.
   Semantik penuh (button + role=switch + aria-checked), keyboard
   gratis dari <button>, visual brutalis situs: track kotak 1px ink,
   pemilih kotak yang geser; ON = track isi ink + pemilih balik warna
   kertas. Transisi cuma transform (ringan, reduced-motion mati lewat
   aturan global). Ukuran sentuh 44x44 (tap target), visual lebih
   kecil di dalem ny. */

export default function Saklar({
  nyala,
  label,
  onUbah,
  disabled,
}: {
  nyala: boolean;
  label: string;
  onUbah: (jadi: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="saklar"
      role="switch"
      aria-checked={nyala}
      aria-label={label}
      disabled={disabled}
      onClick={() => onUbah(!nyala)}
    >
      <span className="saklar-rel" aria-hidden="true">
        <span className="saklar-pilih" />
      </span>
      <span className="saklar-teks" aria-hidden="true">
        {nyala ? "Nyala" : "Mati"}
      </span>
    </button>
  );
}
