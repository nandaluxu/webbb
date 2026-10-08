/* Helper kecil buat route hasil AI Image Editor (r30): MIME dari
   nama file (ekstensi). Dipisahin biar route ny gak ngimpor
   modul yang ada import fs (am buat dipake bareng). */

export function mimeHasil(nama: string): string {
  const e = nama.toLowerCase().split(".").pop() || "";
  if (e === "gif") return "image/gif";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  return "image/png";
}
