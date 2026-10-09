import type { NextConfig } from "next";

/* Port mini-service obrolan (socket.io). Browser nyambung same-origin
   ke /socket.io/*, server Next nerusin ke sini. Jadi satu port doang
   yang perlu di-expose ke luar (tunnel/cloudflared/nginx), gak perlu
   buka port mini-service langsung. */
const portObrolan = process.env.OBROLAN_PORT || "3003";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* Origin dev yang dikebolin: preview sandbox + quick tunnel cloudflared
     (HMR keblokir kalau host tunnel gak dikenal). Domain tunnel sendiri?
     Tambahin manual ke list ini. */
  allowedDevOrigins: ["*.space-z.ai", "*.trycloudflare.com", "nandaluxu.my.id", "wwww.nandaluxu.my.id"],
  /* Client socket.io selalu minta /socket.io/? (pakai slash). Normalisasi
     trailing-slash punya Next bakal nge-308 itu URL SEBELUM rewrite jalan,
     jadi dimatiin. Aman: app cuma punya route "/" (hash router). */
  skipTrailingSlashRedirect: true,
  /* Indikator dev (logo kecil pojok) dimatiin: ganggu klik area bawah. */
  devIndicators: false,
  /* Aset statis pemilik (ikon SVG, font emoji, bunyi .mp3) di-cache
     browser sehari. ETag tetep kekirim, jadi kalau file ny diganti,
     browser otomatis ambil yang baru pas revalidasi harian. Tanpa ini
     (default dev) semua aset max-age=0 = cek ulang tiap refresh. */
  async headers() {
    return [
      {
        source: "/aset/:berkas*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
  async rewrites() {
    return {
      /* beforeFiles: dieksekusi SEBELUM normalisasi trailing-slash punya
         Next. Penting karena client socket.io selalu minta /socket.io/?
         (dengan slash) dan engine.io cuma nerima path persis gitu. */
      beforeFiles: [
        {
          source: "/socket.io/:path*",
          destination: `http://127.0.0.1:${portObrolan}/socket.io/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
