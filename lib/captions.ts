/**
 * lib/captions.ts
 *
 * Word-level transcription + ASS subtitle builder for burned-in,
 * word-by-word ("karaoke") captions on a vertical 720×1280 Short.
 *
 *   1. wordTimestamps()    — audio Buffer → [{ word, start, end }]  (Groq Whisper large-v3)
 *   2. buildAssCaptions()  — words → a valid ASS subtitle document (pure, no I/O)
 *
 * Reuses the Groq Whisper multipart pattern from lib/audioReply.ts.
 */

const GROQ_BASE = process.env.GROK_API_URL || "https://api.groq.com/openai/v1";

export interface CaptionWord {
  word: string;
  start: number; // seconds
  end: number;   // seconds
}

// ── 1. Word-level transcription (Groq Whisper large-v3) ───────────────────────
export async function wordTimestamps(
  audio: Buffer,
  format: "wav" | "mp3" = "wav",
): Promise<CaptionWord[]> {
  const key = process.env.GROK_API_KEY || process.env.GROQ_API_KEY;
  if (!key) { console.warn("[Captions] No Groq key for transcription"); return []; }

  try {
    const mime = format === "mp3" ? "audio/mpeg" : "audio/wav";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `voice.${format}`);
    // Word timestamps require large-v3 (NOT the turbo model).
    form.append("model", "whisper-large-v3");
    form.append("response_format", "verbose_json");
    // Field name must be exactly "timestamp_granularities[]".
    form.append("timestamp_granularities[]", "word");

    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${key}` },
      body:    form,
      signal:  AbortSignal.timeout(20000),
    });
    const data = await res.json();
    if (data.error) { console.warn("[Captions] Whisper error:", data.error?.message); return []; }

    let words: CaptionWord[] = [];

    if (Array.isArray(data.words) && data.words.length) {
      words = data.words.map((w: any) => ({
        word:  String(w.word ?? "").trim(),
        start: Number(w.start) || 0,
        end:   Number(w.end)   || 0,
      })).filter((w: CaptionWord) => w.word.length > 0);
    } else if (Array.isArray(data.segments) && data.segments.length) {
      // Fallback: split each segment's text evenly across its time span.
      for (const seg of data.segments) {
        const segStart = Number(seg.start) || 0;
        const segEnd   = Number(seg.end)   || segStart;
        const toks     = String(seg.text ?? "").trim().split(/\s+/).filter(Boolean);
        if (!toks.length) continue;
        const dur = (segEnd - segStart) / toks.length;
        toks.forEach((tok: string, i: number) => {
          words.push({
            word:  tok,
            start: segStart + dur * i,
            end:   segStart + dur * (i + 1),
          });
        });
      }
    }

    console.log(`[Captions] ${words.length} words aligned`);
    return words;
  } catch (err: any) {
    console.warn("[Captions] Word transcription failed:", err?.message);
    return [];
  }
}

// ── ASS helpers ───────────────────────────────────────────────────────────────

// Seconds → ASS time "H:MM:SS.cc" (centiseconds).
function assTime(sec: number): string {
  const s  = Math.max(0, sec);
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  // Guard against cs rounding up to 100.
  const csFixed = cs === 100 ? 99 : cs;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(csFixed).padStart(2, "0")}`;
}

// Escape characters that have meaning inside an ASS Dialogue text field.
function escapeAss(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/,/g, "\\,");
}

// ── 2. ASS caption builder (pure) — TikTok-style word-by-word highlight ────────
// Renders short phrases (≈3 words) where the CURRENTLY-spoken word pops: it turns
// a bright accent colour and scales up while the rest of the phrase stays white.
// The highlight tiles each phrase's duration gap-free, so a caption is always on
// screen and the pop simply moves from word to word (no flicker).
//
// Font: "Geist" (bundled at public/fonts/CFSans.ttf, supplied to ffmpeg via the
// subtitles `fontsdir`). libass synthesises bold from the single weight.
export function buildAssCaptions(
  words: CaptionWord[],
  opts: { width?: number; height?: number } = {},
): string {
  const width  = opts.width  ?? 720;
  const height = opts.height ?? 1280;

  // Position: Alignment 2 = bottom-center, MarginV measured up from the bottom edge.
  // 0.34 keeps captions in the lower-middle "safe zone" — clear of YouTube Shorts'
  // bottom overlay (title, @handle, CTA, progress bar) which covers roughly the
  // bottom ~20% and would otherwise hide a lower caption.
  const marginV  = Math.round(height * 0.34);
  const fontSize = Math.round(height * 0.058); // ~74px at 1280h — big & legible

  // Accent for the active word: warm gold #FFD60A → ASS &HAABBGGRR.
  const ACCENT = "&H000AD6FF";

  // V4+ Style fields:
  // Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
  // Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle,
  // Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  //   PrimaryColour = &H00FFFFFF white fill · OutlineColour = &H00101010 near-black
  //   BackColour    = &HA0000000 soft drop shadow · thick outline (6) + shadow (3)
  const styleLine =
    `Style: Caption,Geist,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&HA0000000,` +
    `1,0,0,0,100,100,1,0,1,6,3,2,60,60,${marginV},1`;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleLine,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events: string[] = [];

  // Inline override that makes a word "pop": accent colour + scale-up + a quick
  // grow/settle transform so it visibly snaps as it's spoken.
  const popOn  = `{\\1c${ACCENT}\\fscx118\\fscy118\\t(0,90,\\fscx128\\fscy128)\\t(90,170,\\fscx118\\fscy118)}`;
  const popOff = "{\\r}"; // reset back to the Caption style defaults

  // Group words into short phrases (≈3 words/line) for readability.
  const PER_LINE = 3;
  for (let i = 0; i < words.length; i += PER_LINE) {
    const line = words.slice(i, i + PER_LINE);
    if (!line.length) continue;

    const lineStart = line[0].start;
    const lineEnd   = line[line.length - 1].end;
    if (!(lineEnd > lineStart)) continue; // skip degenerate/zero-length lines

    // Tile the phrase duration with one Dialogue per word, gap-free: word j is the
    // active (popped) word from its start until the next word's start (or lineEnd
    // for the last word). The whole phrase stays visible; only the pop moves.
    for (let j = 0; j < line.length; j++) {
      const segStart = line[j].start;
      const segEnd   = j < line.length - 1 ? line[j + 1].start : lineEnd;
      if (!(segEnd > segStart)) continue;

      const text = line
        .map((w, k) =>
          k === j
            ? `${popOn}${escapeAss(w.word)}${popOff}`
            : escapeAss(w.word),
        )
        .join(" ");

      // \fad gives the phrase a soft entrance only on its first word.
      const fade = j === 0 ? "{\\fad(120,0)}" : "";
      events.push(
        `Dialogue: 0,${assTime(segStart)},${assTime(segEnd)},Caption,,0,0,0,,${fade}${text}`,
      );
    }
  }

  return header.concat(events).join("\n") + "\n";
}
