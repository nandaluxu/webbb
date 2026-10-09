import type { Metadata, Viewport } from "next";
import "./globals.css";
/* Tema Swiss Zen (fix29): lapisan override dari pemilik. Dimuat
   SETELAH globals.css biar menang di cascade; seluruh rule ny
   di-scope html[data-ui="swiss"] — cuma aktif pas dipilih di
   Pengaturan, jadi gak ngaruh ke tampilan klasik sama sekali. */
import "./swiss-zen.css";
/* Tema Japandi: lapisan override ketiga, scope html[data-ui="japandi"]. */
import "./japandi.css";
/* Tema Hanami Minimalism: lapisan keempat, scope html[data-ui="hanami"]. */
import "./hanami.css";
/* Ruang Obrol: lapisan tema obrolan (klasik enhanced, Swiss, Japandi,
   Hanami). Scope .ruang-obrol + html[data-ui]. */
import "./ruang-obrol.css";
/* Permainan: tema game Tic Tac Toe + 2048 dan dropdown PilihOpsi
   (Swiss, Japandi, Hanami). Dimuat PALING AKHIR biar nimpa detail
   brutalis globals (kertas titik, bayangan keras) di gaya lain. */
import "./permainan.css";
/* Akinator: layout + bentuk halaman Akinator per gaya UI (Swiss, Japandi,
   Hanami). Dimuat PALING AKHIR biar nimpa blok .aki-* klasik di globals.
   Scope html[data-ui="..."], jadi Klasik gak tersentuh. */
import "./akinator-tema.css";
/* Chat pribadi (r32): tema panel obrolan teman ala WhatsApp (klasik
   enhanced, Swiss hairline, Japandi linen, Hanami sakura). Scope
   .cp-* + html[data-ui], dimuat paling akhir — alasan ny sama. */
import "./chat-pribadi.css";
import Kerangka from "@/components/Kerangka";

export const metadata: Metadata = {
  title: "Neyhra Playground",
  description: "Web prib gw jir wkwk.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* cover: biar env(safe-area-inset-*) kebaca di perangkat notch. */
  viewportFit: "cover",
};

/* Pasang tema + gaya UI + ukuran chat sebelum render biar gak kedip pas pertama buka. */
const skripTema = `(function(){try{var t=localStorage.getItem('neyhra:tema');if(t!=='gelap'&&t!=='terang'){t=matchMedia('(prefers-color-scheme: dark)').matches?'gelap':'terang';}document.documentElement.dataset.tema=t;var g=localStorage.getItem('neyhra:ui');document.documentElement.dataset.ui=(g==='swiss'||g==='japandi'||g==='hanami')?g:'klasik';var u=localStorage.getItem('neyhra:ukuran-chat');if(u==='kecil'||u==='sedang'||u==='besar'){document.documentElement.dataset.chatSize=u;}}catch(e){document.documentElement.dataset.tema='terang';document.documentElement.dataset.ui='klasik';}})();`;

/* Anti-flicker: kursor custom baru jalan di perangkat pointer halus. */
const gayaKursor = `@media (pointer: fine){html,body,*,*::before,*::after{cursor:none !important;}}`;

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Crect x='1.25' y='1.25' width='11.5' height='11.5' fill='none' stroke='%230A0A0A' stroke-width='1.5'/%3E%3Crect x='7.25' y='7.25' width='11.5' height='11.5' fill='%230A0A0A'/%3E/svg%3E";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" data-tema="terang" data-ui="klasik" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: skripTema }} />
        <style dangerouslySetInnerHTML={{ __html: gayaKursor }} />
        <link rel="icon" href={FAVICON} type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500&family=Zen+Kaku+Gothic+New:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@400;500&family=Zen+Maru+Gothic:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Kerangka>{children}</Kerangka>
      </body>
    </html>
  );
}
