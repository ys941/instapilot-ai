/**
 * lib/tts.ts
 *
 * Provider-abstracted text-to-speech that returns raw audio bytes.
 *
 * Provider order is driven by TTS_PROVIDER (default "groq"). We try the selected
 * provider first, then fall back to the OTHER configured provider, then Gemini
 * TTS as a last resort. Returns null only when every provider fails — the caller
 * can then render a music-only Short.
 *
 * Patterns (Groq base URL, GROK_API_KEY/GROQ_API_KEY resolution, the Gemini TTS
 * request shape) are reused from lib/audioReply.ts.
 *
 * Dependency-free: uses global fetch + Buffer only.
 */

const GROQ_BASE  = process.env.GROK_API_URL || "https://api.groq.com/openai/v1";
const GEMINI_TTS = "gemini-2.5-flash-preview-tts";

// Groq's TTS model. PlayAI (`playai-tts`) was decommissioned by Groq; the current
// hosted model is Canopy Labs Orpheus. Overridable via GROQ_TTS_MODEL.
const GROQ_TTS_MODEL = process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english";
// Groq-hosted Orpheus voices: autumn, diana, hannah (female); austin, daniel, troy (male).
const GROQ_TTS_VOICE = process.env.GROQ_TTS_VOICE || "autumn";

type TtsResult = { audio: Buffer; format: "wav" | "mp3" };

function groqKey(): string | undefined {
  return process.env.GROK_API_KEY || process.env.GROQ_API_KEY;
}

// ── WAV wrapper for Gemini's raw PCM (16-bit, 24kHz, mono) ────────────────────
function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate   = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);            // fmt chunk size
  header.writeUInt16LE(1, 20);             // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ── Groq TTS (Canopy Orpheus) ──────────────────────────────────────────────────
// NOTE: Orpheus requires a one-time terms acceptance by the org admin in the Groq
// console before the model can be used on an account:
//   https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english
// Until accepted, the API returns 400 model_terms_required and we fall back.
async function ttsGroq(text: string, opts?: { voice?: string }): Promise<TtsResult | null> {
  const key = groqKey();
  if (!key) return null;
  try {
    const res = await fetch(`${GROQ_BASE}/audio/speech`, {
      method:  "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_TTS_MODEL,
        input: text,
        voice: opts?.voice || GROQ_TTS_VOICE,
        response_format: "wav",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = JSON.stringify(await res.json()).slice(0, 200); } catch { detail = `HTTP ${res.status}`; }
      console.warn("[TTS] groq failed:", detail);
      return null;
    }
    const audio = Buffer.from(await res.arrayBuffer());
    console.log(`[TTS] voice served by groq (${audio.length} bytes)`);
    return { audio, format: "wav" };
  } catch (err: any) {
    console.warn("[TTS] groq failed:", err?.message);
    return null;
  }
}

// ── Canopy / Orpheus TTS ──────────────────────────────────────────────────────
// Only attempted when CANOPY_TTS_URL is set. Tolerant of multiple response shapes:
// raw audio bytes, { audio_base64 } / { audio } (base64), or { url } / { audio_url }.
async function ttsCanopy(text: string, opts?: { voice?: string }): Promise<TtsResult | null> {
  const url = process.env.CANOPY_TTS_URL;
  if (!url) return null;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const ckey = process.env.CANOPY_TTS_KEY;
    if (ckey) headers.Authorization = `Bearer ${ckey}`;

    const res = await fetch(url, {
      method:  "POST",
      headers,
      body: JSON.stringify({
        text,
        voice: opts?.voice || process.env.CANOPY_TTS_VOICE || "tara",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn("[TTS] canopy failed:", `HTTP ${res.status}`);
      return null;
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();

    // Raw audio bytes
    if (ct.startsWith("audio/")) {
      const audio = Buffer.from(await res.arrayBuffer());
      const format: "wav" | "mp3" = ct.includes("mpeg") || ct.includes("mp3") ? "mp3" : "wav";
      console.log(`[TTS] voice served by canopy (${audio.length} bytes)`);
      return { audio, format };
    }

    // JSON response — accept base64 audio or a url to fetch
    const data: any = await res.json();
    const b64: string | undefined = data?.audio_base64 || data?.audio;
    if (typeof b64 === "string" && b64.length > 0) {
      const audio = Buffer.from(b64, "base64");
      console.log(`[TTS] voice served by canopy (${audio.length} bytes)`);
      return { audio, format: "wav" };
    }

    const audioUrl: string | undefined = data?.url || data?.audio_url;
    if (typeof audioUrl === "string" && audioUrl.length > 0) {
      const fetched = await fetch(audioUrl, { signal: AbortSignal.timeout(15000) });
      if (!fetched.ok) { console.warn("[TTS] canopy failed:", `audio url HTTP ${fetched.status}`); return null; }
      const audio = Buffer.from(await fetched.arrayBuffer());
      const fct = (fetched.headers.get("content-type") || "").toLowerCase();
      const format: "wav" | "mp3" = fct.includes("mpeg") || fct.includes("mp3") || audioUrl.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
      console.log(`[TTS] voice served by canopy (${audio.length} bytes)`);
      return { audio, format };
    }

    console.warn("[TTS] canopy failed:", "unrecognized response shape");
    return null;
  } catch (err: any) {
    console.warn("[TTS] canopy failed:", err?.message);
    return null;
  }
}

// ── Gemini TTS fallback (reuses audioReply.ts request shape; returns WAV) ──────
async function ttsGemini(text: string): Promise<TtsResult | null> {
  const gemKey = process.env.GEMINI_API_KEY?.trim();
  if (!gemKey) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS}:generateContent?key=${gemKey}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const data: any = await res.json();
    const inline = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) {
      console.warn("[TTS] gemini failed:", JSON.stringify(data?.error ?? data).slice(0, 160));
      return null;
    }
    const pcm = Buffer.from(inline.data, "base64");
    const audio = pcmToWav(pcm);
    console.log(`[TTS] voice served by gemini (${audio.length} bytes)`);
    return { audio, format: "wav" };
  } catch (err: any) {
    console.warn("[TTS] gemini failed:", err?.message);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isTtsConfigured(): boolean {
  return Boolean(groqKey() || process.env.CANOPY_TTS_URL || process.env.GEMINI_API_KEY?.trim());
}

export async function synthesizeSpeech(
  text: string,
  opts?: { voice?: string },
): Promise<TtsResult | null> {
  const selected = (process.env.TTS_PROVIDER || "groq").toLowerCase();

  // Build provider order: selected first, then the OTHER configured one, then Gemini.
  const order: Array<"groq" | "canopy"> =
    selected === "canopy" ? ["canopy", "groq"] : ["groq", "canopy"];

  for (const provider of order) {
    const result = provider === "canopy" ? await ttsCanopy(text, opts) : await ttsGroq(text, opts);
    if (result) return result;
  }

  // Last resort: Gemini TTS.
  return await ttsGemini(text);
}
