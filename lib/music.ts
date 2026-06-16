/**
 * lib/music.ts
 *
 * Selects royalty-free background music for a Short by:
 *   1. Analysing the card image with the Gemini VISION chain → a mood + search query.
 *   2. Querying the Jamendo API (Creative-Commons music, YouTube-safe) for an
 *      instrumental track matching that mood.
 *   3. Returning the downloaded MP3 bytes + an attribution line.
 *
 * Why Jamendo: YouTube's own Audio Library has NO public API. Jamendo is the
 * practical equivalent — a free music API of CC-licensed instrumental tracks that
 * are safe to use on YouTube (with attribution, which we append to the description).
 *
 * Requires env `JAMENDO_CLIENT_ID` (free). If it's missing, or anything fails,
 * this module returns null and the Short is rendered with silent audio — i.e. the
 * feature degrades gracefully and never blocks publishing.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const MOODS = ["calm", "uplifting", "inspirational", "hopeful", "serious", "dramatic", "energetic", "ambient"];

export interface MusicSelection {
  buffer:      Buffer;
  attribution: string;   // e.g. 'Music: "Track" by Artist (Jamendo, CC BY)'
  mood:        string;
  query:       string;
}

// ── 1. Vision: pick a mood for the card ──────────────────────────────────────
async function pickMoodFromImage(imageJpeg: Buffer): Promise<{ mood: string; query: string }> {
  const fallback = { mood: "calm", query: "calm ambient instrumental" };
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return fallback;

  // Clean, multimodal-capable models (same family as gemini.ts VISION_CHAIN).
  const VISION_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite"];
  try {
    const genAI = new GoogleGenerativeAI(key);
    const prompt =
      `You are choosing INSTRUMENTAL background music for a short educational video (a YouTube Short). ` +
      `Look at this card image and judge its emotional tone. Pick the ONE mood that best fits and a short (2-3 word) music search query. ` +
      `Allowed moods: ${MOODS.join(", ")}. ` +
      `Return ONLY JSON: {"mood":"<one of the moods>","query":"<2-3 word instrumental music search>"}`;

    for (const model of VISION_MODELS) {
      try {
        const m = genAI.getGenerativeModel({ model, generationConfig: { maxOutputTokens: 120, temperature: 0.4 } });
        const res = await m.generateContent([
          { text: prompt },
          { inlineData: { data: imageJpeg.toString("base64"), mimeType: "image/jpeg" } },
        ]);
        const txt = res.response.text();
        const j = JSON.parse(txt.match(/\{[\s\S]*\}/)?.[0] ?? txt);
        const mood = String(j.mood ?? "").toLowerCase().trim();
        const query = String(j.query ?? "").trim();
        if (mood) {
          console.log(`[Music] Vision mood: ${mood} (query: "${query || mood}") via ${model}`);
          return { mood: MOODS.includes(mood) ? mood : "calm", query: query || `${mood} instrumental` };
        }
      } catch (err: any) {
        console.warn(`[Music] vision ${model} failed: ${err?.message ?? err}`);
      }
    }
  } catch (err: any) {
    console.warn("[Music] vision init failed:", err?.message ?? err);
  }
  return fallback;
}

// ── 2. Jamendo: fetch an instrumental track for the mood ─────────────────────
interface JamendoTrack {
  name?: string; artist_name?: string; audio?: string; audiodownload?: string;
  license_ccurl?: string; shareurl?: string;
}

// Derive a human CC label from a Creative-Commons license URL, e.g.
//   https://creativecommons.org/licenses/by-nc-sa/3.0/ → "CC BY-NC-SA"
// Falls back to plain "CC" when the URL is missing or unrecognised.
function ccLabelFromUrl(url?: string): string {
  if (!url) return "CC";
  const m = url.match(/licenses\/(by(?:-[a-z]+)*)/i);
  if (!m) return "CC";
  return `CC ${m[1].toUpperCase()}`;
}

async function fetchJamendoTrack(tag: string): Promise<{ buffer: Buffer; attribution: string } | null> {
  const clientId = process.env.JAMENDO_CLIENT_ID?.trim();
  if (!clientId) return null;
  try {
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: "12",
      fuzzytags: tag,
      vocalinstrumental: "instrumental",
      audioformat: "mp32",
      include: "musicinfo licenses",
      order: "popularity_total",
      boost: "popularity_total",
      audiodlformat: "mp32",
    });
    const res = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) { console.warn(`[Music] Jamendo HTTP ${res.status}`); return null; }
    const data = await res.json();
    const tracks: JamendoTrack[] = data?.results ?? [];
    if (!tracks.length) { console.warn(`[Music] Jamendo: no tracks for "${tag}"`); return null; }

    // Pick among the top few for variety.
    const pick = tracks[Math.floor(Math.random() * Math.min(tracks.length, 8))];
    const audioUrl = pick.audiodownload || pick.audio;
    if (!audioUrl) return null;

    const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(30_000) });
    if (!audioRes.ok) { console.warn(`[Music] Jamendo audio HTTP ${audioRes.status}`); return null; }
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    if (buffer.length < 20_000) { console.warn("[Music] Jamendo audio too small"); return null; }

    const license = ccLabelFromUrl(pick.license_ccurl);
    const attribution = `Music: "${pick.name ?? "Untitled"}" by ${pick.artist_name ?? "Unknown"} (Jamendo, ${license})`;
    console.log(`[Music] Selected: ${attribution} (${Math.round(buffer.length / 1024)} KB)`);
    return { buffer, attribution };
  } catch (err: any) {
    console.warn("[Music] Jamendo fetch failed:", err?.message ?? err);
    return null;
  }
}

/** True when music selection is possible (Jamendo key present). */
export function isMusicConfigured(): boolean {
  return Boolean(process.env.JAMENDO_CLIENT_ID?.trim());
}

/**
 * Pick + download a mood-matched instrumental track for the given card image.
 * Returns null (→ silent Short) if not configured or anything fails.
 */
export async function selectMusicForCard(imageJpeg: Buffer): Promise<MusicSelection | null> {
  if (!isMusicConfigured()) return null;
  const { mood, query } = await pickMoodFromImage(imageJpeg);
  // Try the specific query first, then fall back to the broad mood tag.
  const got = (await fetchJamendoTrack(query)) ?? (await fetchJamendoTrack(mood));
  if (!got) return null;
  return { ...got, mood, query };
}
