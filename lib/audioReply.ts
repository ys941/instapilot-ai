/**
 * lib/audioReply.ts
 *
 * Voice-note support for Instagram DMs:
 *   1. transcribeAudio()  — incoming voice note  → text   (Groq Whisper)
 *   2. synthesizeVoiceUrl() — reply text → public MP3 URL (Gemini TTS + Cloudinary)
 *
 * If anything fails, callers fall back to a normal text reply.
 */

const GROQ_BASE   = process.env.GROK_API_URL || "https://api.groq.com/openai/v1";
const GEMINI_TTS  = "gemini-2.5-flash-preview-tts";

// ── SSRF guard: only fetch voice notes from Meta-owned CDNs ───────────────────
// The attachment URL comes straight from the webhook payload, so a forged event
// could point us at internal/metadata endpoints. Real IG voice notes are served
// from lookaside.fbsbx.com / *.cdninstagram.com / *.fbcdn.net over https.
const ALLOWED_AUDIO_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net", ".fbsbx.com"];

function isAllowedAudioUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    // Match "cdn.fbsbx.com" AND the bare apex "fbsbx.com" (suffix minus the dot).
    return ALLOWED_AUDIO_HOST_SUFFIXES.some((s) => host.endsWith(s) || host === s.slice(1));
  } catch { return false; }
}

// ── 1. Transcribe an incoming voice note → text (Groq Whisper) ────────────────
export async function transcribeAudio(audioUrl: string): Promise<string | null> {
  const key = process.env.GROK_API_KEY || process.env.GROQ_API_KEY;
  if (!key) { console.warn("[Audio] No Groq key for transcription"); return null; }
  if (!isAllowedAudioUrl(audioUrl)) {
    console.warn(`[Audio] Rejected voice-note URL — not an https Meta CDN host: ${audioUrl.slice(0, 120)}`);
    return null;
  }
  try {
    // Download the voice note (IG CDN url is public for a short window)
    const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(15000) });
    if (!audioRes.ok) { console.warn(`[Audio] Could not fetch voice note: HTTP ${audioRes.status}`); return null; }
    const buf  = Buffer.from(await audioRes.arrayBuffer());
    const mime = audioRes.headers.get("content-type") ?? "audio/mp4";
    const ext  = mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : "m4a";

    const form = new FormData();
    form.append("file", new Blob([buf], { type: mime }), `voice.${ext}`);
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "json");

    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${key}` },
      body:    form,
      signal:  AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (data.error) { console.warn("[Audio] Whisper error:", data.error?.message); return null; }
    const text = (data.text ?? "").trim();
    console.log(`[Audio] Transcribed voice note (${text.length} chars): "${text.slice(0, 80)}"`);
    return text || null;
  } catch (err: any) {
    console.warn("[Audio] Transcription failed:", err?.message);
    return null;
  }
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

// ── 2. Reply text → public MP3 URL (Gemini TTS → Cloudinary transcode) ────────
export async function synthesizeVoiceUrl(text: string): Promise<string | null> {
  const gemKey = process.env.GEMINI_API_KEY?.trim();
  if (!gemKey) { console.warn("[Audio] No Gemini key for TTS"); return null; }

  // Keep voice notes short — TTS + IG both prefer brief clips
  const speak = text.length > 600 ? text.slice(0, 600) : text;

  try {
    // 2a. Gemini TTS → raw PCM
    const ttsRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS}:generateContent?key=${gemKey}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: speak }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
          },
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const ttsData = await ttsRes.json();
    const inline  = ttsData?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) {
      console.warn("[Audio] Gemini TTS returned no audio:", JSON.stringify(ttsData?.error ?? ttsData).slice(0, 160));
      return null;
    }
    const pcm = Buffer.from(inline.data, "base64");
    const wav = pcmToWav(pcm);
    console.log(`[Audio] TTS produced ${wav.length} bytes WAV`);

    // 2b. Upload WAV to Cloudinary (audio = video resource type), deliver as MP3
    const cloudName    = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();
    if (!cloudName || !uploadPreset) { console.warn("[Audio] Cloudinary not configured — cannot host voice reply"); return null; }

    const publicId = `voice_${Date.now()}`;
    const form = new FormData();
    form.append("file", `data:audio/wav;base64,${wav.toString("base64")}`);
    form.append("upload_preset", uploadPreset);
    form.append("public_id", publicId);
    // filename_override is REQUIRED: without a real filename Cloudinary derives the
    // display name from the data-URI mime ("audio/wav") and rejects it with
    // "Display name cannot contain slashes". A clean filename fixes that.
    form.append("filename_override", "voice.wav");
    const upRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
      method: "POST", body: form, signal: AbortSignal.timeout(30000),
    });
    const upData = await upRes.json();
    if (!upData.secure_url) { console.warn("[Audio] Cloudinary audio upload failed:", JSON.stringify(upData.error ?? upData).slice(0, 160)); return null; }

    const wavUrl = upData.secure_url as string;
    // Instagram ONLY accepts .m4a / .aac for audio DM attachments (verified live —
    // it rejects .mp3, .ogg, .wav, and even .mp4 video with "format not supported").
    // Cloudinary transcodes WAV → M4A on the fly.
    const m4aUrl = wavUrl.replace(/\.wav($|\?)/i, ".m4a$1");

    // Pre-warm so Cloudinary finishes transcoding BEFORE Instagram fetches it.
    try {
      const warm = await fetch(m4aUrl, { signal: AbortSignal.timeout(20000) });
      if (warm.ok) {
        console.log(`[Audio] Voice reply hosted (m4a ready): ${m4aUrl}`);
        return m4aUrl;
      }
      console.warn(`[Audio] M4A transcode not ready (HTTP ${warm.status}) — returning anyway`);
    } catch (e: any) {
      console.warn(`[Audio] M4A pre-warm failed (${e?.message}) — returning url anyway`);
    }
    console.log(`[Audio] Voice reply hosted (m4a): ${m4aUrl}`);
    return m4aUrl;
  } catch (err: any) {
    console.warn("[Audio] TTS/synthesis failed:", err?.message);
    return null;
  }
}
