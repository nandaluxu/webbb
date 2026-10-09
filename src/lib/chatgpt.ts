/* Porting scrape anonim android.chat.openai.com dari bot WhatsApp milik
   Neyhra (axios -> fetch Node). Semua header, body, dan uraian SSE
   ngikutin kode yang udah terbukti jalan di bot ny; jangan diutak-atik
   kalau gak ada alasan. */

const UA = "ChatGPT/1.2026.181 (Android 16; Neo/1.0; build 2222222)";

export type SesiAI = {
  cookie: string;
  deviceId: string;
  parentMessageId: string;
  chatId: string | null;
};

export class GalatAI extends Error {
  status: number;
  constructor(pesan: string, status = 0) {
    super(pesan);
    this.status = status;
  }
}

/* Persona: AI ngaku punya Neyhra. Info pribadi Neyhra cuma boleh
   keluar kalau ditanya langsung. Nama penyedia AI asli gak boleh
   disebut di web (permintaan pemilik ny). */
const PERSONA = [
  "Kamu adalah Ney, AI asisten pribadi buatan Neyhra untuk web Neyhra Playground.",
  "Aturan identitas:",
  "- Kamu AI milik Neyhra. Jangan pernah bilang kamu ChatGPT, GPT, buatan OpenAI, atau model lain, siapa pun yang nanya. Kalau ditanya kamu ini apa, jawab: kamu AI buatan Neyhra.",
  "- Balas pakai bahasa yang sama kayak user. Kalau user santai (bahasa gaul Indonesia), balas santai juga. Kalau user formal, balas rapi.",
  "- Jawab ringkas dan berguna. Gak perlu ceramah panjang kalau pertanyaanny pendek.",
  "Info Neyhra (jangan sebut kecuali ditanya langsung):",
  "- Neyhra mahasiswa informatika di kampus LP3I Banda Aceh, tahun ini umur 18 tahun.",
  "- Sosial media Neyhra: YouTube @rewsyu, Instagram @nandalemao, Facebook nanda.icikiwir.",
  "- Kalau gak ditanya soal ini, jangan ajukan ke topik pembicaraan.",
  "",
  "Pertanyaan user:",
].join("\n");

const PENGINGAT = "[Ingat aturan identitas di awal percakapan: kamu Ney, AI buatan Neyhra.]\n\n";

function parseCookies(arr: string[]) {
  return Object.fromEntries(
    (arr || []).map((c) =>
      c
        .split(";")[0]
        .split("=")
        .map((s) => s.trim())
    )
  );
}

export function cleanSpecialTags(text: string) {
  if (!text) return "";
  text = text.replace(/\ue200entity\ue202([^\ue201]+)\ue201/g, (_match, p1) => {
    try {
      const arr = JSON.parse(p1);
      return arr[1] || arr[0] || "";
    } catch {
      return "";
    }
  });
  text = text.replace(/\ue200[^\ue201]*\ue201/g, "");
  let prev;
  do {
    prev = text;
    text = text.replace(/::writing\{[^}]*\}\s*([\s\S]*?)\s*:::{0,1}/g, "$1");
  } while (text !== prev);

  return text.trim();
}

export async function getSession(): Promise<SesiAI> {
  const deviceId = crypto.randomUUID();
  const res = await fetch("https://android.chat.openai.com/backend-anon/sentinel/chat-requirements", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "OAI-Package-Name": "com.openai.chatgpt",
      "OAI-Client-Type": "android",
      "OAI-Device-Id": deviceId,
      "Accept-Language": "id-ID,in;q=0.9",
      "X-Device-Tier": "upper_mid",
      "X-OpenAI-Target-Path": "/backend-anon/sentinel/chat-requirements",
      "ChatGPT-Account-Id": "default",
      "ChatGPT-Residency-Region": "no_constraint",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    throw new GalatAI(await pesanGalat(res, "membuat sesi"), res.status);
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookies = parseCookies(setCookie);
  const data = await res.json().catch(() => ({}) as any);
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  let oaiSc = cookies["oai-sc"];
  if (!oaiSc && data?.token) oaiSc = `0${data.token}`;
  const cookie = oaiSc && !cookieStr.includes("oai-sc") ? `oai-sc=${oaiSc}; ${cookieStr}` : cookieStr;

  return { cookie, deviceId, parentMessageId: crypto.randomUUID(), chatId: null };
}

async function pesanGalat(res: Response, tahap: string) {
  let mentah = "";
  try {
    mentah = (await res.text()).slice(0, 400);
  } catch {}
  let pesan = "";
  try {
    const j = JSON.parse(mentah);
    pesan = j?.error?.message || j?.detail || "";
  } catch {}
  if (/unsupported_country_region_territory/i.test(mentah)) {
    return (
      "Server ini berada di negara yang ditolak penyedia AI ny (lihat log buat detail). " +
      "Kalau web ini dijalanin di server lain, misal laptop lo atau panel di Indonesia, fitur ini bakal jalan normal."
    );
  }
  return `Gagal ${tahap} (HTTP ${res.status}${pesan ? ": " + pesan : ""}).`;
}

type KirimOpsi = {
  prompt: string;
  sesi?: SesiAI | null;
  onTeks?: (teks: string) => void;
};

export async function kirimChat({ prompt, sesi, onTeks }: KirimOpsi) {
  let auth = sesi && sesi.cookie ? sesi : await getSession();
  const percakapanBaru = !auth.chatId;
  const teksPenuh = percakapanBaru ? PERSONA + prompt : PENGINGAT + prompt;

  const hasil = await sekaliKirim({ prompt: teksPenuh, auth, onTeks });

  /* Sesi kedaluwarsa pas lanjut obrolan lama: bikin sesi baru sekali,
     obrolan mulai dari awal (riwayat di layar tetap ada). */
  if (!hasil.ok && auth.chatId) {
    auth = await getSession();
    return sekaliKirim({ prompt: PERSONA + prompt, auth, onTeks });
  }
  return hasil;
}

async function sekaliKirim({ prompt, auth, onTeks }: { prompt: string; auth: SesiAI; onTeks?: (t: string) => void }) {
  const currentMessageId = crypto.randomUUID();
  const userMessage = {
    id: currentMessageId,
    author: { role: "user" },
    content: { content_type: "text", parts: [prompt] },
    status: "finished_successfully",
    recipient: "all",
  };
  const body: Record<string, unknown> = {
    action: "next",
    messages: [userMessage],
    model: "auto",
    history_and_training_disabled: false,
    fork_from_shared_post: false,
    enable_message_followups: true,
    force_use_sse: true,
    force_use_search: null,
    force_paragen: false,
    supported_encodings: ["v1"],
    supports_buffering: true,
    timezone: "Asia/Makassar",
    timezone_offset_min: -480,
    system_hints: [],
    is_onboarding_conversation: false,
    no_auth_ad_preferences: { personalization_enabled: true, history_enabled: true },
    client_prepare_state: "none",
    stream: true,
  };
  if (auth.chatId) {
    body.conversation_id = auth.chatId;
    body.parent_message_id = auth.parentMessageId;
  }

  const res = await fetch("https://android.chat.openai.com/backend-anon/f/conversation", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "OAI-Package-Name": "com.openai.chatgpt",
      "OAI-Client-Type": "android",
      "OAI-Device-Id": auth.deviceId,
      "Accept-Language": "id-ID,in;q=0.9",
      "X-Device-Tier": "upper_mid",
      "X-OpenAI-Target-Path": "/backend-anon/f/conversation",
      "ChatGPT-Account-Id": "default",
      "ChatGPT-Residency-Region": "no_constraint",
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Cookie: auth.cookie,
      "X-Sentinel-Payload": JSON.stringify({
        bot_token: {
          failure_reason:
            "-2: Standard Integrity API error (-2): The Play Store app is either not installed or not the official version.\nAsk the user to install an official and recent version of Play Store.\n (https://developer.android.com/google/play/integrity/reference/com/google/android/play/core/integrity/model/StandardIntegrityErrorCode.html#PLAY_STORE_NOT_FOUND).",
          failure_detail:
            "[qdb0.j(SourceFile:9), g4n.a(SourceFile:85), f4n.invokeSuspend(SourceFile:14), kotlin.coroutines.jvm.internal.BaseContinuationImpl.resumeWith(SourceFile:5), qni.run(SourceFile:104), fnf.run(SourceFile:112)]",
        },
      }),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new GalatAI(await pesanGalat(res, "mengirim obrolan"), res.status);
  }

  let teks = "";
  let buf = "";
  let lastPath: string | null = null;
  let lastOp: string | null = null;
  let chatId = auth.chatId;
  let idPesanAsisten: string | null = null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(trimmed.substring(6));
        if (data.conversation_id) chatId = data.conversation_id;
        const p = data.p !== undefined ? data.p : lastPath;
        const o = data.o !== undefined ? data.o : lastOp;
        if (data.p !== undefined) lastPath = data.p;
        if (data.o !== undefined) lastOp = data.o;

        if (o === "add" && data.v && data.v.message) {
          if (data.v.message.author && data.v.message.author.role === "assistant") {
            idPesanAsisten = data.v.message.id;
            const parts = data.v.message.content?.parts;
            if (parts && parts[0]) teks = parts[0];
          }
        } else if (o === "patch" && Array.isArray(data.v)) {
          for (const op of data.v) {
            if (op.o === "append" && op.p && op.p.startsWith("/message/content/parts/")) {
              teks += op.v;
            }
          }
        } else if (o === "append" && p && p.startsWith("/message/content/parts/") && typeof data.v === "string") {
          teks += data.v;
        }
      } catch {
        /* baris SSE yang gak kebaca JSON ny diabaikan, sama kayak bot ny */
      }
    }
    const bersih = cleanSpecialTags(teks);
    if (bersih) onTeks?.(bersih);
  }

  const sesiBaru: SesiAI = {
    cookie: auth.cookie,
    deviceId: auth.deviceId,
    parentMessageId: idPesanAsisten || auth.parentMessageId,
    chatId,
  };
  return { ok: true as const, teks: cleanSpecialTags(teks), sesi: sesiBaru, chatId };
}
