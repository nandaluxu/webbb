/* Helper kanvas: baca token warna hex dari CSS (--ink, --lumut, dst)
   biar efek latar ngikut gaya UI + tema terang/gelap. */
export function bacaWarna(nama: string, cadangan: string): number[] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nama).trim();
  let s = (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : cadangan).slice(1);
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export const gerakDikurangi = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Selektor kursor: kolom teks vs elemen yang bisa diklik. */
export const TEKS =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="file"]),textarea,[contenteditable="true"]';
export const KLIK =
  'a[href],button,[role="button"],select,summary,label,input[type="checkbox"],input[type="radio"],input[type="range"],.kartu,.kartu-media,[data-klik]';
