/**
 * lib/youtubePublish.ts
 *
 * Publishes a post to YouTube as a vertical Short — rendered directly
 * from the post's content (no Instagram dependency). Used by both:
 *   - the manual publish route (/api/posts/[id]/publish) for platform youtube/both
 *   - the catchup scheduler (publishOverdueScheduled) for scheduled/auto posts
 *
 * Carousel → multi-slide Short; story → story card; everything else → one card.
 */

import { renderCardsToShortMp4, probeAudioDurationSec, assembleVoiceTrack } from "@/lib/videoGenerator";
import { withRenderLock } from "@/lib/renderLock";
import { synthesizeSpeech, isTtsConfigured } from "@/lib/tts";
import { wordTimestamps, buildAssCaptions, type CaptionWord } from "@/lib/captions";
import { uploadShort, setVideoThumbnail, type YouTubeCreds } from "@/lib/youtube";
import { renderHookCard, renderOutroCard, THEMES, type Theme } from "@/lib/hookCard";
import { buildBeautifulCaption } from "@/lib/captionBuilder";
import { selectMusicForCard } from "@/lib/music";
import { getBrand, type YouTubeSettings } from "@/lib/preferences";
import type { BrandConfig } from "@/lib/brandConfig";
import { atHandle, ytHandle, ytChannelName, dualFollowCTA } from "@/lib/brandConfig";

export interface YtPostInput {
  id?:             string;
  type:            string;            // PostType
  title:           string;
  hook?:           string | null;
  content?:        string | null;
  cta?:            string | null;
  reelScript?:     string | null;
  hashtags?:       string[];
  carouselSlides?: Array<{ slide: number; headline: string; body: string }> | null;
  /** Real uploaded media (media-folder upload). When present, the Short uses the
   *  ACTUAL media (video → direct upload; image → rendered Short) instead of a
   *  re-rendered branded card — mirrors how Instagram publishes uploaded media. */
  mediaUrls?:      string[];
}

/**
 * Build YouTube-optimized SEARCHABLE keyword tags for a post.
 *
 * These are DISTINCT from the Instagram reach hashtags (`post.hashtags`): they are
 * lowercase search keywords derived from the post title/topic/type plus evergreen
 * niche/discovery terms — tuned for YouTube search and Shorts discovery, NOT
 * Instagram reach. Returns ~8–12 deduped tags with NO "#" prefix (uploadShort adds
 * the "#" and appends "#Shorts" itself).
 */
export function buildYouTubeTags(post: YtPostInput, brand?: BrandConfig): string[] {
  // Common English stop-words to drop from the title-derived keywords.
  const STOP = new Set([
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
    "is", "are", "was", "were", "be", "by", "at", "as", "it", "its", "this", "that",
    "your", "you", "what", "why", "how", "when", "from", "vs", "into", "about",
  ]);

  // Keyword tags derived from the title's key terms (single words, deduped).
  const titleWords = (post.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP.has(w));

  // A multi-word phrase from the title (great for long-tail search), trimmed.
  const titlePhrase = (post.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // A keyword derived from the post type (e.g. ECG_QUIZ → "ecg quiz").
  const typeKeyword = (post.type ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  // Evergreen niche / discovery tags optimized for YouTube search + Shorts.
  // Derived from the brand's niche plus generic discovery terms + "shorts".
  const niche = (brand?.niche ?? "").trim().toLowerCase();
  const evergreen = [
    ...(niche && niche !== "your topic" ? [niche] : []),
    "how to",
    "tips",
    "explained",
    "education",
    "shorts",
  ];

  const tags: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const v = t.trim();
    if (v && v.length >= 3 && !seen.has(v)) {
      seen.add(v);
      tags.push(v);
    }
  };

  // Order: most specific (title phrase + words, type) first, then evergreen.
  if (titlePhrase && titlePhrase.split(" ").length >= 2) add(titlePhrase);
  if (typeKeyword) add(typeKeyword);
  titleWords.forEach(add);
  evergreen.forEach(add);

  // Cap at 12 (YouTube discovery sweet-spot; ~8–12 requested).
  return tags.slice(0, 12);
}

// Cache AI-generated tags by post.id so they're generated once per post.
const _ytTagsCache = new Map<string, string[]>();
const _YT_TAGS_CACHE_MAX = 200;

/**
 * AI-ASSISTED YouTube tags: uses the SELECTED AI provider (Grok or Gemini) to
 * generate YouTube-algorithm-optimized SEARCH keywords for Shorts discovery — a
 * mix of broad + specific niche/topic terms, lowercase, no '#'. Returns
 * ~8–12 tags. Always includes "shorts" and dedupes.
 *
 * On ANY failure (no provider, network/rate-limit error, unparseable or empty
 * result) it FALLS BACK to the deterministic buildYouTubeTags(post). Cached by
 * post.id (bounded, oldest-evicted) so the AI call runs at most once per post.
 */
export async function buildYouTubeTagsAI(post: YtPostInput, brand?: BrandConfig): Promise<string[]> {
  const b = brand ?? await getBrand();
  const niche = (b.niche ?? "").trim() || "this topic";
  // Helper: append "shorts", dedupe (case-insensitive), cap at 12.
  const finalize = (raw: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...raw, "shorts"]) {
      const v = (t ?? "").toString().toLowerCase().replace(/^#+/, "").trim();
      if (v && v.length >= 3 && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    return out.slice(0, 12);
  };

  // 1. Cached for this post → return verbatim.
  if (post.id && _ytTagsCache.has(post.id)) {
    return _ytTagsCache.get(post.id)!;
  }

  let result = finalize(buildYouTubeTags(post, b)); // deterministic fallback
  try {
    const { getAIClient } = await import("@/lib/ai-factory");
    const ai = await getAIClient();

    const stored = post.reelScript ?? "";
    const contentSource = stored.startsWith("CAPTION:")
      ? stored.slice("CAPTION:".length).trim()
      : (post.content ?? "");

    const prompt =
`Generate YouTube-algorithm-optimized SEARCH tags for a ${niche} YouTube Short, tuned for Shorts discovery and search ranking.

POST TYPE: ${post.type}
TITLE: ${post.title}
CONTENT:
${(contentSource ?? "").slice(0, 800)}

Requirements:
- A mix of BROAD discovery terms (e.g. ${niche}, plus general interest keywords) AND SPECIFIC terms drawn from this exact topic.
- Searchable keywords real viewers would type — favour multi-word long-tail phrases plus single strong keywords.
- All lowercase, NO '#' prefix, no duplicates.
- Return 8 to 12 tags.

Return ONLY a JSON array of tag strings, e.g. ["${niche}","beginner tips","how to explained"]. No prose, no markdown, no keys.`;

    const out = await ai.generateContent(
      prompt,
      `You are a YouTube SEO expert for ${niche} Shorts. Return ONLY a JSON array of lowercase tag strings — no prose, no markdown.`,
      400,
    );

    const cleaned = (out ?? "").replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        const strings = parsed.filter((t): t is string => typeof t === "string");
        if (strings.length > 0) {
          result = finalize(strings);
        }
      }
    }
  } catch (err: any) {
    console.warn("[YouTubeTags] AI tag generation failed, using deterministic fallback:", err?.message ?? err);
  }

  // Memoise by post.id (bounded — evict the oldest entry when over capacity).
  if (post.id) {
    if (_ytTagsCache.size >= _YT_TAGS_CACHE_MAX) {
      const oldest = _ytTagsCache.keys().next().value;
      if (oldest !== undefined) _ytTagsCache.delete(oldest);
    }
    _ytTagsCache.set(post.id, result);
  }

  return result;
}

/** True for a video URL (by extension or Cloudinary's /video/upload/ path). */
function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|m4v|avi)(\?|#|$)/i.test(url) || url.includes("/video/upload/");
}

/** Download a URL into a Buffer. Throws on a non-OK response. */
async function fetchUrlToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download media (${res.status} ${res.statusText}) from ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// Short-card teaser cache (per post.id) so the AI condense runs once per post.
const _shortCardCache = new Map<string, string>();
const _SHORT_CARD_CACHE_MAX = 200;

/**
 * DEPRECATED / UNUSED for the Short content card.
 *
 * The Short's content card now renders the FULL, descriptive post.content (exactly
 * like Instagram) — see renderPostCardBuffers. The curiosity gap is provided by the
 * separate AI hook intro card (buildShortHook → renderHookCard), so the content card
 * no longer condenses to a teaser. This helper is retained for backward-compatibility
 * /reuse only; it is NOT called when rendering the Short card.
 *
 * It condenses the post's content into 3 brief, engaging teaser lines (AI-assisted
 * via the selected provider, deterministic fallback, cached per post.id). Quiz types
 * are returned unchanged.
 */
export async function buildShortCardContent(post: YtPostInput, brand?: BrandConfig): Promise<string> {
  if (isQuizType(post.type)) return post.content ?? "";
  const niche = ((brand ?? await getBrand()).niche ?? "").trim() || "this topic";
  if (post.id && _shortCardCache.has(post.id)) return _shortCardCache.get(post.id)!;

  const stored = post.reelScript ?? "";
  const source = stored.startsWith("CAPTION:") ? stored.slice("CAPTION:".length).trim() : (post.content ?? "");

  // Deterministic fallback: first 3 content lines, de-numbered + trimmed short.
  const deterministic = (): string =>
    (post.content ?? "")
      .split("\n")
      .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").replace(/\*\*/g, "").trim())
      .filter((l) => l.length >= 4 && !/^#/.test(l))
      .slice(0, 3)
      .map((l) => (l.length > 60 ? l.slice(0, 58).replace(/\s+\S*$/, "").trim() + "…" : l))
      .join("\n");

  let result = deterministic();
  try {
    const { getAIClient } = await import("@/lib/ai-factory");
    const ai = await getAIClient();
    const prompt =
`You are writing the ON-SCREEN text for a vertical YouTube Short about a ${niche} topic. It must be SHORT, punchy and create a CURIOSITY GAP so the viewer goes to READ THE CAPTION for the full answer.

TOPIC / TITLE: ${post.title}
SOURCE CONTENT:
${(source ?? "").slice(0, 800)}

Write EXACTLY 3 short lines:
- Each line a COMPLETE thought of ≤ 8 words — scannable in under a second.
- Punchy, intriguing, benefit/curiosity-driven — TEASE the insight, do NOT fully explain it.
- No numbering, no hashtags, no emojis, no quotation marks.
Return ONLY a JSON array of exactly 3 strings.`;
    const out = await ai.generateContent(
      prompt,
      `You write ultra-concise, curiosity-driven on-screen text for ${niche} YouTube Shorts. Return ONLY a JSON array of 3 short strings — no prose, no markdown.`,
      200,
    );
    const cleaned = (out ?? "").replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) {
        const lines = arr
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.replace(/\*\*/g, "").replace(/^["']|["']$/g, "").trim())
          .filter(Boolean)
          .slice(0, 3);
        if (lines.length >= 2) result = lines.join("\n");
      }
    }
  } catch (err: any) {
    console.warn("[ShortCard] AI condense failed, using deterministic fallback:", err?.message ?? err);
  }

  if (post.id) {
    if (_shortCardCache.size >= _SHORT_CARD_CACHE_MAX) {
      const oldest = _shortCardCache.keys().next().value;
      if (oldest !== undefined) _shortCardCache.delete(oldest);
    }
    _shortCardCache.set(post.id, result);
  }
  return result;
}

// Cache the exciting opener-hook line per post.id so the AI call runs once.
const _shortHookCache = new Map<string, string>();
const _SHORT_HOOK_CACHE_MAX = 200;

/**
 * Write ONE short, irresistible, curiosity-gap HOOK line for the Short's opener
 * (the hook intro card + YouTube thumbnail). Uses the SELECTED AI provider to
 * craft a scroll-stopping line tailored to this exact post — the kind of line
 * that makes a viewer STOP and watch.
 *
 * Constraints baked into the prompt: ≤ ~10 words, no hashtags, no emojis, no
 * quotes. On ANY failure (no provider, network/parse error, empty/too-long
 * result) it falls back deterministically to `post.hook`, or a punchy derivation
 * of `post.title`. Cached by post.id (bounded, oldest-evicted).
 */
export async function buildShortHook(post: YtPostInput, brand?: BrandConfig): Promise<string> {
  const niche = ((brand ?? await getBrand()).niche ?? "").trim() || "this topic";
  // Strip emojis/hashtags/quotes/markdown and collapse whitespace.
  const sanitize = (s: string): string =>
    (s ?? "")
      .replace(/[#"'`*_]/g, "")
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, "")
      .replace(/\s+/g, " ")
      .trim();

  // Deterministic fallback: the post's own hook, else a punchy title derivation.
  const fallback = (): string => {
    const h = sanitize(post.hook ?? "");
    if (h) return h.length > 70 ? h.slice(0, 68).replace(/\s+\S*$/, "").trim() : h;
    const t = sanitize(post.title ?? "").replace(/[.!?]+$/, "");
    if (!t) return `The one thing about ${niche} most people get wrong`;
    const words = t.split(" ");
    const short = words.length > 9 ? words.slice(0, 9).join(" ") : t;
    return short;
  };

  if (post.id && _shortHookCache.has(post.id)) return _shortHookCache.get(post.id)!;

  let result = fallback();
  try {
    const stored = post.reelScript ?? "";
    const source = stored.startsWith("CAPTION:") ? stored.slice("CAPTION:".length).trim() : (post.content ?? "");

    const prompt =
`Write ONE irresistible, curiosity-gap HOOK line for the OPENING title card of a vertical ${niche} YouTube Short. It is the FIRST thing a viewer sees — it must make them STOP scrolling and watch the whole video.

TOPIC / TITLE: ${post.title}
SOURCE CONTENT:
${(source ?? "").slice(0, 600)}

The hook MUST:
- Be a COMPLETE, self-contained thought of 6 to 12 words on a SINGLE line — never a sentence fragment, never cut off, never ending on a weak word like "is/the/a/your/secretly".
- Open a strong CURIOSITY GAP — tease the payoff/secret/danger, do NOT explain or answer it.
- Make the viewer feel they NEED the answer (surprise, stakes, "I didn't know that").
- Be specific to THIS topic (not generic). No hashtags, no emojis, no quotation marks.

Examples of the STYLE (do not copy — match the energy):
- "The mistake most people make and never notice"
- "This common habit is quietly costing you results"
- "The one thing experts wish everyone knew"

Return ONLY the single complete hook line — no prose, no markdown, no label, no quotes.`;
    const hookSystem =
      `You write irresistible, COMPLETE curiosity-gap hook lines (6-12 words) for ${niche} YouTube Shorts. Always return ONE finished line — never a fragment. Return ONLY the hook line, no prose, no markdown, no quotes.`;
    // Tier order: Gemini FLASH → Grok → Gemini REASONING (last resort).
    // Generous token budget so even a "thinking" fallback model finishes the line
    // (80 was too low and produced truncated fragments like "This is").
    // Parse raw model output → one clean hook line (join wrapped lines, strip
    // any "Here's…:"/"1."/"Hook:" preamble, cap length on a word boundary).
    const DANGLING = new Set([
      "is","are","was","were","be","being","been","the","a","an","and","or","to","of",
      "for","that","this","with","into","from","at","by","as","it","its","on","in","your",
      "my","their","his","her","our","can","will","could","should","would","may","might",
      "than","but","so","if","when","how","why","what","which","because","about",
    ]);
    const parseHook = (raw: string): string => {
      let l = sanitize(
        (raw ?? "")
          .replace(/^\s*(here'?s|sure|okay|the|your)?\s*(hook|line|title)?\s*[:\-]\s*/i, "")
          .replace(/^\s*\d+[.)]\s*/, "")
          .replace(/\s*\n+\s*/g, " ")
          .trim()
      );
      const w = l.split(" ").filter(Boolean);
      if (w.length > 13) l = w.slice(0, 13).join(" ");
      if (l.length > 92) l = l.slice(0, 92).replace(/\s+\S*$/, "").trim();
      return l;
    };
    // A hook is COMPLETE only if it's ≥4 words, ≥18 chars, and does NOT end on a
    // dangling word (verb-to-be, article, preposition, conjunction, or an -ly adverb
    // like "quietly"/"secretly") — a dangling end means the model truncated.
    const isCompleteHook = (raw: string): boolean => {
      const l = parseHook(raw);
      const w = l.split(" ").filter(Boolean);
      if (w.length < 4 || l.length < 18) return false;
      const last = (w[w.length - 1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
      return !(DANGLING.has(last) || /ly$/.test(last));
    };

    const { generateTextResilient } = await import("@/lib/ai-factory");
    // BIG token budget (newer Gemini flash + reasoning models spend output tokens
    // "thinking" first), AND a COMPLETENESS validator so a truncated flash result
    // is REJECTED and the next tier (Grok) is tried — instead of shipping a cut
    // hook like "...IS QUIETLY". Only a complete hook is accepted from any tier.
    const out = await generateTextResilient(prompt, hookSystem, 2000, isCompleteHook);
    const line = parseHook(out ?? "");
    if (isCompleteHook(out ?? "")) {
      result = line;
    } else {
      console.warn(`[ShortHook] No tier produced a complete hook ("${line}") — using the post's own complete hook instead`);
    }
  } catch (err: any) {
    console.warn("[ShortHook] AI hook generation failed, using deterministic fallback:", err?.message ?? err);
  }

  if (post.id) {
    if (_shortHookCache.size >= _SHORT_HOOK_CACHE_MAX) {
      const oldest = _shortHookCache.keys().next().value;
      if (oldest !== undefined) _shortHookCache.delete(oldest);
    }
    _shortHookCache.set(post.id, result);
  }
  return result;
}

/**
 * Strip quiz answer/reveal sections from raw content so a quiz Short NEVER shows
 * the answer on a slide. Mirrors postTypeImageGenerator.stripAnswerSections (the
 * quiz cards use the same hygiene) plus drops "answer in comments/tomorrow" lines.
 */
function stripQuizAnswer(content: string): string {
  return (content ?? "")
    .replace(/\n?\s*CORRECT\s+ANSWER\s*[:\-][^\n]*/gi, "")
    .replace(/\n?\s*ANSWER\s*[:\-][^\n]*/gi, "")
    .replace(/\n?\s*MECHANISM\s*[:\-][\s\S]*?(?=\n\s*[A-Z]{3,}|\n\s*$|$)/i, "")
    .replace(/\n?\s*MANAGEMENT\s*[:\-][\s\S]*?(?=\n\s*[A-Z]{3,}|\n\s*$|$)/i, "")
    .replace(/^.*answer\s+(?:in\s+(?:the\s+)?comments?|tomorrow|below|later).*$/gim, "")
    .trim();
}

/**
 * Split a post's plain content into descriptive CONTENT slides for the carousel
 * Short — one key point per slide, big and readable. Each slide is a
 * `{ slide, headline, body }` shape that `slideImageGenerator.generateAllSlideBuffers`
 * renders with the same readable slide renderer the CAROUSEL posts use.
 *
 *   - QUIZ / ECG_QUIZ / ANGIOGRAPHY_QUIZ: the case goes on a slide, the question on
 *     a slide, and the A/B/C/D options on a slide (split across two if long). The
 *     answer is NEVER revealed (stripQuizAnswer + we never emit an answer slide).
 *   - All other types: each content point/line becomes its own slide (~5–7 aimed),
 *     with the post title used as the running headline context.
 *
 * Returns slides numbered 1..N. The HOOK cover + SUBSCRIBE outro are NOT included
 * here — buildShortForPost prepends/appends those branded cards.
 */
function buildContentSlideSpecs(post: YtPostInput): Array<{ slide: number; headline: string; body: string }> {
  const title = (post.title ?? "").replace(/\*\*/g, "").trim() || "Did You Know?";
  const rawContent = post.content ?? "";

  // De-numbered, de-bulleted, non-empty content lines (no '#' heading-only lines).
  const lines = rawContent
    .split("\n")
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*‣◦⁃►])\s*/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.length >= 4 && !/^#/.test(l));

  const specs: Array<{ headline: string; body: string }> = [];

  if (isQuizType(post.type)) {
    // QUIZ family: case → question → options (never the answer).
    const safe   = stripQuizAnswer(rawContent);
    const sLines = safe
      .split("\n")
      .map((l) => l.replace(/\*\*/g, "").trim())
      .filter(Boolean);

    // A/B/C/D option lines (answer already stripped above).
    const optLines = sLines
      .filter((l) => /^[A-D][).:]/.test(l))
      .map((l) => l.replace(/^([A-D])[).:]?\s*/, "$1) ").trim())
      .slice(0, 4);

    // Non-option lines = the case/stem + the question.
    const stemLines = sLines.filter((l) => !/^[A-D][).:]/.test(l) && !/^(quiz|question)\s*[:\-]/i.test(l));
    // The question is the line ending in '?' (or the hook); the rest is the case.
    const questionLine =
      (post.hook ?? "").trim() ||
      stemLines.find((l) => l.trim().endsWith("?")) ||
      "What's the right answer?";
    const caseLines = stemLines.filter((l) => l !== questionLine);

    if (caseLines.length) {
      specs.push({ headline: "The Case", body: caseLines.join("\n") });
    }
    specs.push({ headline: "The Question", body: questionLine });
    if (optLines.length) {
      // Options on one slide; split into two if there are 4 (two per slide) so the
      // text stays big and readable.
      if (optLines.length >= 4) {
        specs.push({ headline: "Your Options", body: optLines.slice(0, 2).join("\n") });
        specs.push({ headline: "Your Options", body: optLines.slice(2).join("\n") });
      } else {
        specs.push({ headline: "Your Options", body: optLines.join("\n") });
      }
    }
    specs.push({ headline: "Can You Solve It?", body: "Drop your answer in the comments — the answer is revealed there!" });
  } else {
    // Non-quiz: one key point per slide. Aim for ~5–7 content slides.
    const MAX_SLIDES = 7;
    let points = lines;
    if (points.length > MAX_SLIDES) {
      // Too many points → keep the strongest first MAX_SLIDES (they're already ordered).
      points = points.slice(0, MAX_SLIDES);
    } else if (points.length <= 2) {
      // Content-light → split more finely on sentence boundaries so the Short isn't
      // just one or two slides (pads toward the ~45s target).
      const sentences = rawContent
        .replace(/\*\*/g, "")
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
        .filter((s) => s.length >= 12 && !/^#/.test(s));
      if (sentences.length > points.length) points = sentences.slice(0, MAX_SLIDES);
    }

    // Each point → its own slide. The point text IS the body (descriptive, not
    // truncated — the slide renderer auto-shrinks the font to fit). The running
    // headline gives each slide a clear, consistent label tied to the topic.
    points.forEach((p) => {
      // If the point looks like "Label: detail", use the label as the headline.
      const m = p.match(/^([^:]{3,42}):\s*(.+)$/);
      if (m && m[2].length >= 12) {
        specs.push({ headline: m[1].trim(), body: m[2].trim() });
      } else {
        specs.push({ headline: title, body: p });
      }
    });
  }

  // Number the slides 1..N (these are passed standalone — NOT cover/last, so the
  // readable buildContentSlide renderer is used for every one).
  return specs
    .filter((s) => (s.body ?? "").trim().length > 0)
    .map((s, i) => ({ slide: i + 1, headline: s.headline, body: s.body }));
}

/**
 * Render the post into one or more vertical 9:16 (1080×1920) card JPEG buffers
 * (content order). The whole Short shares ONE `theme` (passed by buildShortForPost,
 * derived from post.id) so the hook cover, every content slide, and the outro look
 * cohesive — and different Shorts look different. The branded content slides are
 * rendered full-frame 9:16 so the Short has no black bars. (STORY / single-card
 * fallback paths still emit square 1080×1080 cards — rare, and the videoGenerator
 * contains+pads any non-9:16 image so it's never cropped.)
 */
export async function renderPostCardBuffers(post: YtPostInput, theme: Theme): Promise<Buffer[]> {
  const { generateShortSlidesVertical } = await import("@/lib/slideImageGenerator");

  // Carousel → render each authored slide as a FULL-FRAME vertical themed slide so
  // it fills the Short (one key point per card, big readable text).
  const slides = Array.isArray(post.carouselSlides) ? post.carouselSlides : null;
  if (post.type === "CAROUSEL" && slides && slides.length >= 2) {
    const renumbered = slides.map((s, i) => ({ slide: i + 1, headline: s.headline, body: s.body }));
    const buffers = await generateShortSlidesVertical(renumbered, theme);
    if (buffers.length >= 1) return buffers;
  }

  // Story → story card renderer
  if (post.type === "STORY") {
    const { renderStoryToJpeg } = await import("@/lib/storyImageGenerator");
    const brand = await getBrand();
    const nicheLabel = ((brand.niche ?? "").trim() || "Today").toUpperCase();
    const lines = (post.content ?? "").split("\n").filter(Boolean);
    const buf = await renderStoryToJpeg({
      headline: post.title || lines[0] || (brand.niche ?? "").trim() || "Did You Know?",
      body:     lines[1] || (post.content ?? ""),
      label:    nicheLabel,
      type:     "health_awareness",
      tips:     lines.filter((l) => l.startsWith("TIP:")).map((l) => l.slice(4).trim()).filter(Boolean).slice(0, 6),
      tagline:  (lines.find((l) => l.startsWith("TAGLINE:")) ?? "").replace(/^TAGLINE:/, "").trim(),
      cta:      "Save & share ❤️",
    });
    return buf ? [buf] : [];
  }

  // ALL OTHER TYPES → split the FULL, descriptive content into MULTIPLE content
  // slides (one key point per slide) and render them via the SAME readable slide
  // renderer the carousels use. This makes every Short a multi-slide carousel
  // (~5–7 content slides). Each slide carries full descriptive text — the renderer
  // auto-shrinks to fit, so nothing is truncated. Quiz types get case/question/
  // options slides and NEVER reveal the answer (see buildContentSlideSpecs).
  //
  // Every spec is rendered as a CONTENT slide (isCover/isLast = false): our own
  // branded HOOK cover + SUBSCRIBE outro (added in buildShortForPost) are the
  // real cover/CTA, so we must NOT let the slide renderer emit its "SWIPE TO
  // LEARN" cover or "Save & Share" CTA in the middle of the deck.
  const specs = buildContentSlideSpecs(post);
  if (specs.length >= 1) {
    // FULL-FRAME vertical themed slides (1080×1920) — big readable key point per
    // card, all sharing the Short's one theme.
    const buffers = await generateShortSlidesVertical(specs, theme);
    if (buffers.length >= 1) return buffers;
  }

  // Fallback (content was empty/unsplittable) → single branded post card, FULL and
  // descriptive (renders from post.content verbatim, no teaser condensing). The
  // curiosity GAP is provided separately by the AI hook intro card.
  const { renderPostToJpeg } = await import("@/lib/postTypeImageGenerator");
  const buf = await renderPostToJpeg({
    postType:   post.type,
    title:      post.title,
    hook:       post.hook       ?? "",
    content:    post.content    ?? "",
    cta:        post.cta        ?? "",
    // Do NOT pass the long stored caption here — the card renders from content.
    reelScript: undefined,
  });
  return buf ? [buf] : [];
}

/** Build the YouTube description from the post (reuses the IG caption builder).
 *  Uses whichever is RICHER between the stored prose caption and the fully
 *  formatted beautiful caption, so a one-line stored caption never makes the
 *  description look thin. */
function buildYtDescription(post: YtPostInput, brand: BrandConfig, suffix?: string): string {
  const stored = post.reelScript?.startsWith("CAPTION:") ? post.reelScript.slice(8).trim() : null;
  const beautiful = buildBeautifulCaption({
    postType:   post.type,
    title:      post.title,
    hook:       post.hook ?? null,
    content:    post.content ?? "",
    cta:        post.cta ?? null,
    reelScript: post.reelScript ?? undefined,
    hashtags:   [],
  }, brand);
  // Prefer the longer/richer of the two.
  const base = stored && stored.length >= beautiful.length ? stored : beautiful;
  // Ensure the both-account CTA is present even in the fallback path. The beautiful
  // caption only names Instagram; the same unified body runs on YouTube too, so
  // guarantee BOTH handles appear (Subscribe on YouTube + Follow on Instagram).
  // Only append the lines that aren't already in the base text.
  const withBothAccounts = ensureBothAccountCta(base, brand);
  return [withBothAccounts, suffix?.trim() || ""].filter(Boolean).join("\n\n");
}

/** YouTube channel URL for the brand (handle-based). "" when no handle. */
function ytUrl(brand: BrandConfig): string {
  const h = ytHandle(brand).replace(/^@/, "");
  return h && h !== "our channel" ? `https://youtube.com/@${h}` : "";
}
/** Instagram profile URL for the brand. "" when no handle. */
function igUrl(brand: BrandConfig): string {
  const h = atHandle(brand).replace(/^@/, "");
  return h && h !== "this account" ? `https://instagram.com/${h}` : "";
}

/**
 * Append a clean "follow us" links block to a caption — directly-clickable account
 * links for BOTH platforms. On YouTube both URLs are clickable; on Instagram the
 * handle mention is clickable (IG doesn't linkify caption URLs).
 * Idempotent: skips if the YouTube URL is already present.
 */
function appendFollowLinks(caption: string, brand: BrandConfig): string {
  const yt = ytUrl(brand);
  const ig = igUrl(brand);
  if (!yt && !ig) return caption;
  if (yt && caption.includes(yt)) return caption;
  const lines: string[] = ["━━━━━━━━━━━━━━"];
  if (yt) lines.push(`▶️ Subscribe on YouTube ${ytHandle(brand)}: ${yt}`);
  if (ig) lines.push(`📸 Follow on Instagram ${atHandle(brand)}: ${ig}`);
  return [caption.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}

/**
 * Guarantee the call-to-action invites following on BOTH platforms (used by the
 * deterministic fallback caption). Appends only the missing handle line(s) so we
 * never duplicate a CTA that already names the channel.
 */
function ensureBothAccountCta(caption: string, brand: BrandConfig): string {
  const yt = ytHandle(brand);
  const ig = atHandle(brand);
  const niche = (brand.niche ?? "").trim() || "more";
  const lines: string[] = [];
  if (yt && yt !== "our channel" && !caption.includes(yt)) {
    lines.push(`▶️ Subscribe on YouTube ${yt} for daily ${niche}!`);
  }
  if (ig && ig !== "this account" && !caption.includes(ig)) {
    lines.push(`📸 Follow on Instagram ${ig} for daily ${niche}!`);
  }
  if (lines.length === 0) return caption;
  return [caption, lines.join("\n")].filter(Boolean).join("\n\n");
}

// ── Unified rich caption (shared IDENTICALLY by Instagram + YouTube) ───────────
//
// buildRichCaption() produces the ONE rich, Grok-elaborated caption (NO hashtags,
// NO music attribution, NO suffix) used on BOTH platforms for the same post.
//
// It is generated ONCE per post and memoised in an in-memory Map keyed by post.id,
// so that whichever platform publishes first pays the Grok cost and the other reads
// the byte-identical cached text. The cache is bounded (oldest-evicted) so a long-
// running process can't leak memory.

const _richCaptionCache = new Map<string, string>();
const _RICH_CAPTION_CACHE_MAX = 200;

/** Quiz-style post types must NEVER reveal the answer in the caption. */
function isQuizType(type: string): boolean {
  return /QUIZ/i.test(type);
}

/**
 * Build the ONE unified rich caption for a post (NO hashtags, NO music attribution,
 * NO suffix). Grok-elaborated: hook line → intro → 1️⃣2️⃣3️⃣ expanded points →
 * "💡 Why it matters" → CTA. Falls back to the full buildYtDescription() (beautiful
 * caption / stored prose) when Grok fails or returns a thin (<300 char) result.
 *
 * Cached by post.id so Instagram and YouTube get byte-identical text and Grok runs
 * only once per post.
 */
export async function buildRichCaption(post: YtPostInput, brand?: BrandConfig): Promise<string> {
  // 1. Already generated for this post in this process → return verbatim.
  if (post.id && _richCaptionCache.has(post.id)) {
    return _richCaptionCache.get(post.id)!;
  }

  const b = brand ?? await getBrand();
  const niche = (b.niche ?? "").trim() || "this topic";
  const yt = ytHandle(b);
  const ig = atHandle(b);

  // Deterministic fallback: the full beautiful caption (no suffix).
  const fallback = buildYtDescription(post, b);

  let result = fallback;
  try {
    // A legacy "CAPTION:" prose caption is a valid content source.
    const stored = post.reelScript ?? "";
    const contentSource = stored.startsWith("CAPTION:")
      ? stored.slice("CAPTION:".length).trim()
      : (post.content ?? "");

    const quiz = isQuizType(post.type);
    // For quizzes, the key-points expansion must present the question/options and
    // explicitly NOT reveal which option is correct (the answer lives in comments).
    const learnSection = quiz
      ? `3. "🔑 The challenge:" then present the question and each answer option on its own line with a number emoji (1️⃣ 2️⃣ 3️⃣ …). DO NOT reveal, hint at, or imply which option is correct — the answer is revealed later in the comments. Frame it as a test for the viewer.`
      : `3. "🔑 What you'll learn:" then expand EVERY key point (aim for 6-8) into its own line, each starting with a number emoji (1️⃣ 2️⃣ 3️⃣ …) — a full, accurate 1-2 sentence explanation with the specific stat/number, the mechanism, AND why it matters.`;
    // The CTA must invite following on BOTH platforms regardless of where this
    // post is published — the same unified body runs on Instagram AND YouTube.
    const ctaSection = quiz
      ? `5. A warm, energetic call to action that invites following on BOTH platforms: ▶️ Subscribe on YouTube ${yt} AND 📸 Follow on Instagram ${ig} for daily ${niche}, 💬 drop your answer (A/B/C/D) in the comments, 💾 Save this for later, and ❤️ Share this with someone who'd find it useful.`
      : `5. A warm, energetic call to action that BOTH grows the audience AND drives engagement (engagement = reach): ▶️ Subscribe on YouTube ${yt} AND 📸 Follow on Instagram ${ig} for daily ${niche}, 💾 Save this for later, ❤️ Share this with someone who'd find it useful, 👇 Tag someone who needs to see this, and 💬 ask ONE specific question the viewer can answer in a word or two to spark comments.`;

    const prompt =
`Write a BEAUTIFUL, detailed, scroll-stopping caption for a ${niche} educational post. This SAME caption is used on both Instagram and YouTube, so make it engaging on both.

POST TYPE: ${post.type}
TITLE: ${post.title}
HOOK: ${post.hook ?? ""}
KEY POINTS / CONTENT:
${contentSource}
${quiz ? "\nIMPORTANT: This is a QUIZ post. NEVER state, reveal, or hint at the correct answer anywhere in the caption — the answer is only revealed later in the comments.\n" : ""}
Structure it EXACTLY like this, with real line breaks between sections and tasteful emojis:
1. An opening HOOK line with a relevant emoji (✨/⚠️/🚨) — 1 punchy sentence that stops the scroll.
2. A 2-3 sentence intro paragraph that frames why this matters and what the viewer will learn.
${learnSection}
4. "💡 Why it matters:" 1-2 sentences of real-world relevance.
${ctaSection}

Tone: authoritative but warm and accessible — like a brilliant expert who's a great teacher. Use tasteful emojis as section markers and bullet leads. NO markdown symbols (* # _), NO hashtags (added separately). Make it FULL, rich and genuinely DETAILED — aim for about 380-480 words. Expand EVERY key point thoroughly with the specific stat/number, the mechanism, and why it matters for the viewer. This is the complete description (it runs in full on YouTube; Instagram trims it cleanly at the end). Do NOT pad with filler — every line must be substantive and informative.`;

    const system =
      `You are a world-class ${niche} expert and social media creator writing rich, beautifully formatted, engaging captions optimized for engagement and search. Return ONLY the caption text — no preamble, no markdown symbols, no hashtags.` +
        (quiz ? " For quiz posts, NEVER reveal the correct answer." : "");

    // Tier order: Gemini FLASH → Grok → Gemini REASONING (the slow "thinking"
    // models are the last resort, AFTER Grok). Centralized in ai-factory.
    const { generateTextResilient } = await import("@/lib/ai-factory");
    // Generous token budget so the caption NEVER truncates mid-sentence — a 380-480
    // word caption is ~700 tokens, but "thinking" fallback models spend tokens
    // before the answer, so give ample headroom (was 2000 → cut captions off).
    // Validator: a tier's output must be a substantial (≥300 char) caption — a thin
    // or truncated flash result is rejected so the next tier (Grok) is tried.
    const out = await generateTextResilient(prompt, system, 4000,
      (t) => t.replace(/\*\*/g, "").trim().length >= 300);
    const clean = (out ?? "").replace(/\*\*/g, "").replace(/^#+\s.*$/gm, "").trim();
    if (clean.length >= 300) {
      result = clean;
    } else {
      console.warn(`[RichCaption] AI caption too short (${clean.length} chars) — using beautiful-caption fallback`);
    }
  } catch (err: any) {
    console.warn("[RichCaption] All AI providers failed, using beautiful-caption fallback:", err?.message ?? err);
  }

  // Always append the directly-clickable follow links for BOTH accounts (idempotent).
  result = appendFollowLinks(result, b);

  // Memoise by post.id (bounded — evict the oldest entry when over capacity) so the
  // other platform reuses the identical text and Grok is not called twice.
  if (post.id) {
    if (_richCaptionCache.size >= _RICH_CAPTION_CACHE_MAX) {
      const oldest = _richCaptionCache.keys().next().value;
      if (oldest !== undefined) _richCaptionCache.delete(oldest);
    }
    _richCaptionCache.set(post.id, result);
  }

  return result;
}

/**
 * The YouTube description = the shared rich caption + the optional descriptionSuffix.
 * Shares buildRichCaption()'s cache, so the same text appears on Instagram. (Music
 * attribution is still appended separately in buildShortForPost.)
 */
async function buildElaborateYtDescription(post: YtPostInput, brand: BrandConfig, suffix?: string): Promise<string> {
  const rich = await buildRichCaption(post, brand);
  return [rich, suffix?.trim() || ""].filter(Boolean).join("\n\n");
}

export interface PublishYtResult { videoId: string; url: string; slides: number }

/** The rendered Short MP4 plus the metadata needed to publish it (YouTube + IG Reel). */
export interface BuiltShort {
  mp4:                Buffer;
  description:        string;                       // full YouTube description (music attribution appended)
  music:              { attribution: string } | null;
  slides:             number;
  /** True when mp4 is the user's uploaded video passed through verbatim (no ffmpeg card render). */
  isPassthroughVideo: boolean;
  /** The hook intro card (1080×1080 JPEG) — also set as the custom YouTube thumbnail. null when none. */
  hookThumb:          Buffer | null;
}

// ── Rotating per-Short theme ───────────────────────────────────────────────────
// A counter cycles through ALL themes in order so EVERY Short gets a different
// palette (consecutive Shorts are guaranteed distinct — a hash could repeat by
// chance). Cached per post.id so re-rendering the SAME post is stable.
const _shortThemeByPost = new Map<string, Theme>();
let _shortThemeCounter = 0;
function pickRotatingShortTheme(postId?: string): Theme {
  if (postId && _shortThemeByPost.has(postId)) return _shortThemeByPost.get(postId)!;
  const theme = THEMES[_shortThemeCounter % THEMES.length];
  _shortThemeCounter++;
  if (postId) {
    if (_shortThemeByPost.size > 300) _shortThemeByPost.clear();
    _shortThemeByPost.set(postId, theme);
  }
  return theme;
}

/**
 * Render a post into a vertical Short MP4 (with music + an AI-expanded description),
 * WITHOUT uploading anywhere. Both the YouTube publisher and the Instagram-Reel
 * cross-poster reuse this so the same MP4 is rendered exactly once.
 * Throws on render failure (caller decides how to handle).
 */
export async function buildShortForPost(
  post: YtPostInput,
  yt: Pick<YouTubeSettings, "secondsPerImage" | "descriptionSuffix" | "voiceover" | "voiceoverVoice" | "burnCaptions">,
): Promise<BuiltShort> {
  // Serialize the ENTIRE build (slide + hook/outro render + music + ffmpeg) PROCESS-WIDE
  // so only ONE memory-heavy Short renders at a time. The publish triggers (30s scheduler
  // route, 5min catchup, auto-publish) aren't otherwise coordinated, and two concurrent
  // builds (~20 card buffers + 2 music buffers) OOM-killed the container.
  return withRenderLock(async (): Promise<BuiltShort> => {
  const brand = await getBrand();
  const uploadedUrl = post.mediaUrls?.find(Boolean) ?? null;

  // ── Media-folder upload: use the ACTUAL uploaded media (exactly like IG) ──────
  if (uploadedUrl) {
    // The description for a media post comes from the post's stored caption /
    // content — never fabricate a branded card description.
    const description = buildYtDescription(post, brand, yt.descriptionSuffix);

    if (isVideoUrl(uploadedUrl)) {
      // Real uploaded VIDEO → upload the bytes DIRECTLY (no ffmpeg, no music).
      const videoBytes = await fetchUrlToBuffer(uploadedUrl);
      // Passthrough video: do not re-render media.
      return { mp4: videoBytes, description, music: null, slides: 1, isPassthroughVideo: true, hookThumb: null };
    }

    // Real uploaded IMAGE → turn THAT image into the vertical Short.
    const imgBuf = await fetchUrlToBuffer(uploadedUrl);
    const music  = await selectMusicForCardSafe(imgBuf);
    const mp4    = await renderCardsToShortMp4([imgBuf], {
      secondsPerImage: yt.secondsPerImage ?? 5,
      audio:           music?.buffer ?? null,
    });
    if (!mp4) throw new Error("ffmpeg failed to render the Short MP4 from the uploaded image");
    const fullDesc = [description, music?.attribution ?? ""].filter(Boolean).join("\n\n");
    return {
      mp4,
      description: fullDesc,
      music: music ? { attribution: music.attribution } : null,
      slides: 1,
      isPassthroughVideo: false,
      hookThumb: null,
    };
  }

  // ── No uploaded media → re-render branded card(s) ────────────────────────────
  // Every Short is now a multi-slide CAROUSEL video (~45–60s): a HOOK cover, several
  // descriptive CONTENT slides (one point per slide), and a SUBSCRIBE CTA outro.
  //
  // Pick ONE theme PER SHORT that is DIFFERENT EVERY TIME: a rotating counter
  // cycles through ALL themes in order, so consecutive Shorts are GUARANTEED to use
  // distinct palettes (not a hash, which could repeat the same theme by chance).
  // The choice is cached per post.id so re-rendering the SAME post stays stable. The
  // SAME theme is passed to the hook cover, every content slide, AND the outro — so
  // all cards in one Short share a cohesive look while different Shorts look different.
  const shortTheme = pickRotatingShortTheme(post.id);

  let cardBuffers = await renderPostCardBuffers(post, shortTheme);
  if (cardBuffers.length === 0) throw new Error("Could not render card image(s) for the Short");

  // Cap the content slides (~10 total cards incl. hook+outro) so the Short never
  // runs absurdly long; leave room for the hook cover + outro CTA.
  const MAX_CONTENT_SLIDES = 8;
  if (cardBuffers.length > MAX_CONTENT_SLIDES) cardBuffers = cardBuffers.slice(0, MAX_CONTENT_SLIDES);

  // Wrap the content cards with a HOOK intro card (exciting opener) and a CTA
  // OUTRO card (subscribe / read-the-caption closer). Both best-effort and both
  // rendered on the SAME per-Short theme as the content slides for cohesion.
  // The opener uses an AI-crafted, curiosity-gap hook (also the YouTube thumbnail).
  const shortHook = await buildShortHook(post, brand);
  const hookCard  = await renderHookCard({ hook: shortHook, title: post.title, postType: post.type, theme: shortTheme });
  const outroCard = await renderOutroCard({ hook: shortHook, title: post.title, postType: post.type, theme: shortTheme });
  const hasHook  = !!hookCard;
  const hasOutro = !!outroCard;
  const buffers = [
    ...(hasHook ? [hookCard] : []),
    ...cardBuffers,
    ...(hasOutro ? [outroCard] : []),
  ];

  // ── Per-card durations: FRONT-LOAD THE HOOK ──────────────────────────────────
  // Live data showed 70–90% of viewers swipe away in the first ~2s, so the hook
  // cover must flash by FAST (≈2s) to get viewers into the value before they bounce;
  // content slides hold for the configured per-card duration, and the subscribe outro
  // is brief (≈3s). The renderer hard-caps the grand total at the ~3-min Shorts ceiling.
  // Content-card seconds come from the YouTube "Seconds per card" SETTING so the owner
  // can actually control Short length/pacing (clamped to the UI's 2–15s range). Previously
  // this was a fixed ~50s target that ignored the setting entirely. (These are the
  // SILENT-Short durations; with voiceover ON each card is timed to its narration below.)
  const HOOK_SECS = 2, OUTRO_SECS = 3;
  const contentCount = Math.max(1, cardBuffers.length);
  const contentSecs = Math.max(2, Math.min(15, Math.round(yt.secondsPerImage ?? 6)));
  const durations = [
    ...(hasHook ? [HOOK_SECS] : []),
    ...cardBuffers.map(() => contentSecs),
    ...(hasOutro ? [OUTRO_SECS] : []),
  ];

  // ── AI voiceover + per-card-synced timing, paced by "Seconds per card" ────────
  // Best-effort: any failure falls back to the silent music-only Short. When on, the
  // narration is the dominant audio (music auto-ducked). Each card is narrated as its
  // OWN segment (hook + each content spec body + CTA, in card order) so the voice
  // always matches the card on screen. The "Seconds per card" setting is the MINIMUM
  // hold per content card: if a card's narration is shorter, the card lingers and an
  // equal silence is inserted into the audio so the voice stays in sync; if it's
  // longer, the card shows for the full narration. Burned captions (opt-in) reuse the
  // assembled track. Falls back to a single narration + even split when the cards can't
  // be aligned 1:1 (carousel/story) or per-segment synthesis fails.
  // The CTA is NEUTRAL — built from the brand's niche, never a fixed niche.
  let voiceTrack: Buffer | null = null;
  let assSubtitles: string | null = null;
  let voDurations = durations;
  if (yt.voiceover && isTtsConfigured()) {
    const niche = (brand.niche ?? "").trim();
    const strip = (s: string) => (s || "").replace(/[*_#`>~]/g, "").replace(/\s+/g, " ").trim();
    const ctaText = `Follow for more ${niche || "tips"}.`;
    const ttsVoice = yt.voiceoverVoice || undefined;
    let synced = false;

    // PER-CARD PATH — one narration segment per card, paced by the seconds-per-card min.
    try {
      const specsForVoice = buildContentSlideSpecs(post);
      const canAlign = specsForVoice.length > 0 && specsForVoice.length === cardBuffers.length;
      if (canAlign) {
        let segTexts = [
          ...(hasHook ? [strip(shortHook || post.title)] : []),
          ...specsForVoice.map((s) => strip(s.body) || "and"),
          ...(hasOutro ? [ctaText] : []),
        ];
        // The Short's length ADAPTS to the content (long card text → longer card →
        // longer Short), so we narrate each card's FULL text. Only trim if the whole
        // narration would approach YouTube's ~3-min Shorts ceiling (~380 words ≈ 170s).
        const MAXW = 380;
        let segW = segTexts.map((s) => s.split(/\s+/).filter(Boolean));
        const totW = segW.reduce((a, w) => a + w.length, 0);
        if (totW > MAXW) {
          const r = MAXW / totW;
          segW = segW.map((w) => w.slice(0, Math.max(2, Math.round(w.length * r))));
          segTexts = segW.map((w) => w.join(" "));
        }

        if (segTexts.length === buffers.length) {
          // Narrate each segment separately and measure its spoken length.
          const clips: Buffer[] = [];
          const speech: number[] = [];
          let ok = true;
          for (const t of segTexts) {
            const c = await synthesizeSpeech(t, { voice: ttsVoice });
            if (!c?.audio?.length) { ok = false; break; }
            clips.push(c.audio);
            speech.push(await probeAudioDurationSec(c.audio));
          }

          if (ok && clips.length === buffers.length) {
            // Target hold per card: content cards honour the "Seconds per card" MINIMUM;
            // hook/outro use a small floor. Extra time over the spoken length → silence.
            const target = speech.map((d, i) => {
              const isHook  = hasHook  && i === 0;
              const isOutro = hasOutro && i === buffers.length - 1;
              const floor = isHook ? 1.5 : isOutro ? 2 : contentSecs;
              return Math.max(d, floor);
            });
            let pad = target.map((t, i) => Math.max(0, t - speech[i]));

            // Keep within the ~3-min Shorts ceiling by trimming pads (never the speech).
            const totSpeech = speech.reduce((a, b) => a + b, 0);
            const totPad = pad.reduce((a, b) => a + b, 0);
            const budget = 178 - totSpeech;
            if (budget <= 0) pad = pad.map(() => 0);
            else if (totPad > budget) { const k = budget / totPad; pad = pad.map((p) => p * k); }

            const vt = await assembleVoiceTrack(clips, pad);
            if (vt?.length) {
              voiceTrack  = vt;
              voDurations = speech.map((d, i) => Math.max(1.0, d + pad[i]));
              synced = true;
              if (yt.burnCaptions) {
                const w = await wordTimestamps(vt, "wav").catch(() => [] as CaptionWord[]);
                if (w.length) {
                  try { assSubtitles = buildAssCaptions(w, { width: 720, height: 1280 }); }
                  catch (e: any) { console.warn("[YouTube] caption build failed:", e?.message ?? e); }
                }
              }
              console.log(`[YouTube] Voiceover ON: per-card synced (${buffers.length} cards, min hold ${contentSecs}s), burnedCaptions=${assSubtitles ? "yes" : "no (YouTube auto-captions)"}`);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn("[YouTube] Per-card voiceover failed — trying single-track fallback:", e?.message ?? e);
    }

    // FALLBACK PATH — single narration + even split (carousel/story, or per-card failed).
    if (!synced) {
      try {
        const points = strip(post.content || "")
          .split(/\n|(?<=[.!?])\s+/).map(strip).filter((p) => p.length > 1);
        let s = [strip(shortHook || post.title), ...points].filter(Boolean).join(". ").replace(/\.{2,}/g, ".");
        const w = s.split(/\s+/);
        if (w.length > 130) s = w.slice(0, 130).join(" ");
        const script = `${s}. ${ctaText}`;
        const tts = await synthesizeSpeech(script, { voice: ttsVoice });
        if (tts?.audio?.length) {
          voiceTrack = tts.audio;
          const dur = await probeAudioDurationSec(tts.audio);
          if (dur > 1) {
            const totalV = Math.min(180, dur + 0.5);
            voDurations = buffers.map(() => Math.max(2, totalV / buffers.length));
          }
          if (yt.burnCaptions) {
            const w2 = await wordTimestamps(tts.audio, tts.format).catch(() => [] as CaptionWord[]);
            if (w2.length) {
              try { assSubtitles = buildAssCaptions(w2, { width: 720, height: 1280 }); }
              catch (e: any) { console.warn("[YouTube] caption build failed:", e?.message ?? e); }
            }
          }
          console.log(`[YouTube] Voiceover ON: even split (${buffers.length} cards), burnedCaptions=${assSubtitles ? "yes" : "no (YouTube auto-captions)"}`);
        } else {
          console.warn("[YouTube] Voiceover enabled but TTS returned no audio — music-only fallback");
        }
      } catch (e: any) {
        console.warn("[YouTube] Voiceover generation failed — music-only fallback:", e?.message ?? e);
      }
    }
  }

  const music = await selectMusicForCardSafe(buffers[0]);

  const mp4 = await renderCardsToShortMp4(buffers, {
    durations:       voDurations,
    secondsPerImage: contentSecs, // fallback for any unspecified card
    audio:           music?.buffer ?? null,
    voiceTrack,
    assSubtitles,
  });
  if (!mp4) throw new Error("ffmpeg failed to render the Short MP4");

  console.log(`[YouTube] Built carousel Short: ${buffers.length} cards${voiceTrack ? " + AI voiceover" : ` (hook ${HOOK_SECS}s + ${contentCount}×${contentSecs}s + outro ${OUTRO_SECS}s)`} ≈ ${voDurations.reduce((a,b)=>a+b,0).toFixed(0)}s`);

  // Build the ONE unified rich caption + suffix (shared identically with Instagram —
  // generated once and cached in-memory by post.id), then append the music attribution
  // (required for CC tracks). Hashtags are appended later by uploadShort.
  const elaborate = await buildElaborateYtDescription(post, brand, yt.descriptionSuffix);
  const description = [elaborate, music?.attribution ?? ""].filter(Boolean).join("\n\n");

  return {
    mp4,
    description,
    music: music ? { attribution: music.attribution } : null,
    slides: buffers.length,
    isPassthroughVideo: false,
    hookThumb: hookCard,   // also used as the custom YouTube thumbnail
  };
  }); // end withRenderLock
}

/**
 * Vision-driven background music with a hard ~20s time-box. Gemini analyses the
 * cover image → mood → a royalty-free instrumental track. Best-effort; returns
 * null (silent Short) on timeout or any failure.
 */
async function selectMusicForCardSafe(
  coverImage: Buffer,
): Promise<{ buffer: Buffer | null; attribution: string } | null> {
  const MUSIC_TIMEOUT_MS = 20_000;
  try {
    return await Promise.race([
      selectMusicForCard(coverImage),
      new Promise<null>((resolve) => setTimeout(() => {
        console.warn(`[YouTube] music selection exceeded ${MUSIC_TIMEOUT_MS / 1000}s — falling back to silent`);
        resolve(null);
      }, MUSIC_TIMEOUT_MS)),
    ]);
  } catch {
    return null; // silent fallback
  }
}

/**
 * Render the post → vertical Short MP4 → upload to YouTube.
 * Returns the video id (+ the rendered MP4 so callers can reuse it, e.g. to also
 * cross-post the same Short to Instagram as a Reel). Throws on failure.
 */
export async function publishPostToYouTubeShort(
  post: YtPostInput,
  yt: Pick<YouTubeSettings, "privacy" | "secondsPerImage" | "descriptionSuffix" | "voiceover" | "voiceoverVoice" | "burnCaptions">,
  creds?: YouTubeCreds,
): Promise<PublishYtResult & { mp4: Buffer; description: string }> {
  const brand = await getBrand();
  const built = await buildShortForPost(post, yt);

  // AI-assisted YouTube SEARCH tags (selected provider) — falls back to the
  // deterministic buildYouTubeTags on any failure. Generated once per post.
  const tags = await buildYouTubeTagsAI(post, brand);

  const { videoId, url } = await uploadShort(built.mp4, {
    title:       post.title || ytChannelName(brand),
    description: built.description,
    // YouTube-algorithm SEARCH tags (NOT the Instagram reach hashtags) — uploadShort
    // adds the "#" prefix and appends "#Shorts".
    tags,
    privacy:     (yt.privacy as "public" | "unlisted" | "private") ?? "public",
  }, creds);

  // Set the HOOK card as the custom YouTube thumbnail so the still shown in
  // feeds/lists is the exciting hook (not an auto-picked content-card frame).
  // Best-effort: never blocks/raises (channels without the feature just skip it).
  if (built.hookThumb && built.hookThumb.length > 0) {
    await setVideoThumbnail(videoId, built.hookThumb, creds);
  }

  // Seed an ENGAGEMENT QUESTION as a top-level comment from the channel — comment
  // velocity is a strong Shorts reach signal, and our videos were getting ~0
  // comments. Best-effort, never blocks. (The API can't pin it — pin in Studio for
  // max effect.) The own-comment skip in the reply bot ignores this seed.
  try {
    const { postVideoComment } = await import("@/lib/youtube");
    await postVideoComment(videoId, buildSeedComment(post, brand), creds);
  } catch (e: any) {
    console.warn("[YouTube] seed comment failed:", e?.message ?? e);
  }

  return { videoId, url, slides: built.slides, mp4: built.mp4, description: built.description };
}

/**
 * A short, friendly ENGAGEMENT QUESTION posted as the seed comment on each upload
 * to spark replies (comment velocity → reach). Deterministic (no AI), varied by a
 * hash of the post so it's not always identical.
 */
function buildSeedComment(post: YtPostInput, brand: BrandConfig): string {
  const niche = (brand.niche ?? "").trim() || "more";
  const qs = [
    "Did you already know this? 👍 or 👎 in the comments!",
    "Which one surprised you the most? 👇",
    "What would you add to this list? Drop it below 👇",
    "Be honest — were you doing this right? Comment below! ❤️",
    "Tag someone who needs to see this 👇",
    "What's the one thing you took away from this? Comment below 👇",
    "Which tip will you try first? Let me know 👇",
  ];
  const h = Math.abs([...((post.id ?? "") + (post.title ?? ""))].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
  return `${qs[h % qs.length]}\n\n▶️ Subscribe ${ytHandle(brand)} for daily ${niche} shorts!`;
}
