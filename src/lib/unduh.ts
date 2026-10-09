/* Perpustakaan unduhan file (dipindah dari MesinUnduh biar bisa
   dipake bersama sama PanelAio tanpa import muter): ambilBlob,
   selesaikanSse (stream progress render AIO), unduhFile.
   Semua fungsi ny cuma dipanggil dari event handler (window/document
   kebaca setelah interaksi user), aman diimpor dari mana aja. */

/* URL proksi same-origin buat media yang CORS ny kekunci (tikcdn,
   tiktokcdn, dll). Dipake buat pratinjau video TikTok (content-type
   ny di-override jadi video/mp4 biar bisa di-buffer) + jadi jalan
   unduhan tanpa popup. tipe: "video" | "audio" opsional. */
export function urlProksi(url: string, tipe?: "video" | "audio") {
  return "/api/proksi?url=" + encodeURIComponent(url) + (tipe ? "&tipe=" + tipe : "");
}

export async function ambilBlob(url: string) {
  const res = await fetch(url);
  /* 204 atau body kosong = link expired/server ogah, jangan bikin file kosong. */
  if (!res.ok || res.status === 204) throw new Error("HTTP " + res.status);
  const blob = await res.blob();
  if (!blob.size) throw new Error("file kosong");
  return blob;
}

/* Stream SSE j2download (AIO): url media ny sebenarnya stream
   progress render, bukan file. Dibaca sampe event "completed" yang
   bawa download_url (file beneran). Progress ny diterusin ke
   onProses biar tombol ny bisa nunjukin persen (video 3+ menit
   nyampe puluhan detik dirender: tanpa persen kerasa nge-hang).
   CDN ny CORS terbuka, jadi ini jalan langsung dari browser. */
export async function selesaikanSse(url: string, onProses?: (persen: number) => void): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: "text/event-stream" },
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok || !res.body) throw new Error("stream gak kebuka");
  const pembaca = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await pembaca.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const baris = buf.split("\n");
      buf = baris.pop() ?? "";
      for (const l of baris) {
        if (!l.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(l.slice(5));
          if (typeof ev.progress === "number") onProses?.(Math.max(1, Math.min(99, Math.round(ev.progress))));
          if (typeof ev.download_url === "string" && ev.download_url) return ev.download_url;
        } catch {}
      }
    }
  } finally {
    pembaca.cancel().catch(() => {});
  }
  throw new Error("render kelar tanpa link unduhan");
}

/* Unduh file: fetch -> blob -> klik. Item AIO (unduhSse): url ny
   stream progress: selesaikan dulu sampe dapet download_url baru
   diunduh. Kalau CDN nolak fetch langsung dari browser (CORS fixed
   ke domain laen — tikcdn/tiktokcdn gaya ny), coba lewat link
   cadangan, KALAU MASIH lewat proksi server ny (same-origin, gak
   kenal CORS) — inilah yang bikin unduhan gak perlu nyerah ke
   popup tab baru. window.open cuman sisa buat keadaan beneran
   darurat (server juga gak bisa nyampe). */
export async function unduhFile(
  url: string,
  nama: string,
  cadangan?: string,
  opts?: { unduhSse?: boolean; onProses?: (persen: number) => void }
): Promise<"blob" | "tab" | "gagal"> {
  let target = url;
  if (opts?.unduhSse) {
    try {
      target = await selesaikanSse(url, opts.onProses);
    } catch {
      /* stream ny gak kebuka dari sini: kasih tau persen 100 +
         nyerah lewat tab biar user gak nunggu puter doang. */
      opts.onProses?.(100);
      const tab = window.open(url, "_blank", "noopener");
      return tab ? "tab" : "gagal";
    }
  }
  let blob: Blob | null = null;
  try {
    blob = await ambilBlob(target);
  } catch {}
  if (!blob && cadangan) {
    try {
      blob = await ambilBlob(cadangan);
    } catch {}
  }
  /* Jalur proksi: server ny yang ambil ke CDN. URL http(s) doang
     (relative path udah same-origin duluan, gak perlu muter). */
  if (!blob && /^https?:\/\//i.test(target)) {
    try {
      blob = await ambilBlob(urlProksi(target));
    } catch {}
  }
  if (blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nama;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
    return "blob";
  }
  const tab = window.open(target, "_blank", "noopener");
  return tab ? "tab" : "gagal";
}
