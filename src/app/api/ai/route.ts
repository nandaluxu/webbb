import { NextRequest } from "next/server";
import { kirimChat, SesiAI } from "@/lib/chatgpt";

export const runtime = "nodejs";

/* Jembatan AI: nerima prompt dari browser, manggil scrape di server
   (browser gak bisa: header + cookie kustom kena CORS), terus
   ngalirin potongan teks ny balik ke browser lewat SSE.

   Format event ke browser:
   data: {"teks": "..."}     -> potongan teks (teks kumulatif)
   data: {"selesai": true, "sesi": {...}}
   data: {"galat": "..."}
   data: [DONE] */

export async function POST(req: NextRequest) {
  let badan: { prompt?: unknown; sesi?: unknown };
  try {
    badan = await req.json();
  } catch {
    return new Response('data: {"galat":"Isi permintaanny gak kebaca."}\n\ndata: [DONE]\n\n', {
      status: 400,
      headers: SSE,
    });
  }

  const prompt = String(badan.prompt ?? "").slice(0, 2000).trim();
  if (!prompt) {
    return new Response('data: {"galat":"Pesan ny masih kosong."}\n\ndata: [DONE]\n\n', {
      status: 400,
      headers: SSE,
    });
  }

  let sesi: SesiAI | null = null;
  if (badan.sesi && typeof badan.sesi === "object") {
    const s = badan.sesi as Record<string, unknown>;
    if (typeof s.cookie === "string" && typeof s.deviceId === "string" && typeof s.parentMessageId === "string") {
      sesi = {
        cookie: s.cookie,
        deviceId: s.deviceId,
        parentMessageId: s.parentMessageId,
        chatId: typeof s.chatId === "string" ? s.chatId : null,
      };
    }
  }

  const enkode = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const kirim = (data: unknown) => {
        try {
          controller.enqueue(enkode.encode("data: " + JSON.stringify(data) + "\n\n"));
        } catch {
          /* browser udah nutup koneksi (misal tekan berhenti): diam aja */
        }
      };
      try {
        const hasil = await kirimChat({
          prompt,
          sesi,
          onTeks: (teks) => kirim({ teks }),
        });
        if (!hasil.teks) {
          kirim({ galat: "AI ny gak ngasih jawaban (balasan kosong). Coba kirim ulang pertanyaanny." });
        } else {
          kirim({ teks: hasil.teks });
          kirim({ selesai: true, sesi: hasil.sesi });
        }
      } catch (e) {
        const pesan = e instanceof Error ? e.message : "Ada yang salah pas manggil AI ny.";
        kirim({ galat: pesan });
      } finally {
        kirim({ tamat: true });
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, { headers: SSE });
}

const SSE = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
