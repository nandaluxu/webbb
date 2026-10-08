/* uguu.se upload (r30, AI Image Editor): flow existing bahan ny
   minta sumber gambar berupa URL publik, jadi file yang diupload
   user diterusin dulu ke layanan file sementara (server-side, gak
   pernah disebut namany di UI), baru URL ny dipakai.

   Kontrak (diverifikasi live dari sandbox):
   POST https://uguu.se/upload?output=json  (multipart field "files[]")
   -> { success: true, files: [{ url: "https://n.uguu.se/XXX.ext" }] }

   File ny umur ny lama (file sementara), type ny ikut file ny. */

const BATAS_UNGGUH = 32 * 1024 * 1024; /* 32 MB cukup buat foto editing */

export async function unggahKeUguu(file: File): Promise<string> {
  if (file.size > BATAS_UNGGUH) {
    throw new Error("Fotonya kegedean buat diproses (maks 32 MB).");
  }
  const fd = new FormData();
  fd.append("files[]", file, file.name || "sumber.jpg");
  const res = await fetch("https://uguu.se/upload?output=json", {
    method: "POST",
    body: fd,
    signal: AbortSignal.timeout(60000),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const url = data?.files?.[0]?.url;
  if (!res.ok || !data?.success || !url) {
    throw new Error("Gagal menyiapkan foto ny. Coba lagi bentar.");
  }
  return String(url);
}
