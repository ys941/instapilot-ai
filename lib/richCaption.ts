/**
 * lib/richCaption.ts
 *
 * Builds ONE unified, beautiful, detailed caption that is used IDENTICALLY on
 * both Instagram and YouTube for every post — whether the post originates on IG,
 * YouTube, or both.
 *
 * The caption is a Grok-elaborated, emoji-structured prose caption:
 *   hook line → intro → 1️⃣2️⃣3️⃣ expanded key points → "💡 Why it matters" → CTA.
 * It contains NO hashtags — callers append the post's hashtags themselves.
 *
 * Caching (guarantees identical text + avoids duplicate Grok calls):
 *   The prose caption is stored on the post's `reelScript` field. Once a rich
 *   caption is generated it is persisted back as `reelScript = "RICHCAP:" + text`.
 *   On any later read (the other platform's publisher) we return that stored text
 *   verbatim, so IG and YT always carry the same caption and Grok runs only once.
 *   The legacy `"CAPTION:"` prefix is still accepted as a fallback source.
 */

import { buildBeautifulCaption } from "@/lib/captionBuilder";
import { prisma } from "@/lib/prisma";
import { getBrand } from "@/lib/preferences";
import { atHandle, ytHandle, type BrandConfig } from "@/lib/brandConfig";

/** The minimal post shape the rich caption builder needs. */
export interface RichCaptionPost {
  id?:         string;
  type:        string;            // PostType
  title:       string;
  hook?:       string | null;
  content?:    string | null;
  cta?:        string | null;
  reelScript?: string | null;
  hashtags?:   string[];
}

const RICHCAP_PREFIX = "RICHCAP:";
const CAPTION_PREFIX = "CAPTION:";

/**
 * Append a clean "follow us" links block — directly-clickable account links for
 * BOTH platforms. On YouTube both URLs are clickable; on Instagram the handle
 * mention is clickable (IG doesn't linkify caption URLs).
 * Idempotent: skips if the YouTube URL is already present.
 */
function appendFollowLinks(caption: string, brand: BrandConfig): string {
  const ytH = ytHandle(brand);
  const igH = atHandle(brand);
  const ytUrl = `https://youtube.com/${ytH}`;
  const igUrl = `https://instagram.com/${igH.replace(/^@/, "")}`;
  if (caption.includes(ytUrl)) return caption;
  const block =
`━━━━━━━━━━━━━━
▶️ Subscribe on YouTube ${ytH}: ${ytUrl}
📸 Follow on Instagram ${igH}: ${igUrl}`;
  return [caption.trim(), block].filter(Boolean).join("\n\n");
}

/** Quiz-style post types must NEVER reveal the answer in the caption. */
function isQuizType(type: string): boolean {
  return /QUIZ/i.test(type);
}

/** The robust, deterministic fallback caption (no hashtags). */
function fallbackCaption(post: RichCaptionPost, brand: BrandConfig): string {
  return buildBeautifulCaption({
    postType:   post.type,
    title:      post.title,
    hook:       post.hook ?? null,
    content:    post.content ?? "",
    cta:        post.cta ?? null,
    reelScript: post.reelScript ?? undefined,
    hashtags:   [],
  }, brand);
}

/**
 * Generate the elaborate AI caption (moved from youtubePublish.ts's
 * buildElaborateYtDescription). Falls back to buildBeautifulCaption when Grok
 * fails or returns a thin (<300 char) result. Returns body text only — no
 * hashtags, no music attribution, no suffix.
 */
async function generateRichCaption(post: RichCaptionPost, brand: BrandConfig): Promise<string> {
  const fallback = fallbackCaption(post, brand);
  const ytH = ytHandle(brand);
  const igH = atHandle(brand);
  // Backward compat: a legacy "CAPTION:" prose caption is a valid content source.
  const stored = post.reelScript ?? "";
  const contentSource = stored.startsWith(CAPTION_PREFIX)
    ? stored.slice(CAPTION_PREFIX.length).trim()
    : (post.content ?? "");
  try {
    const quiz = isQuizType(post.type);
    // For quizzes, the key-points expansion must present the question/options and
    // explicitly NOT reveal which option is correct (the answer lives in comments).
    const learnSection = quiz
      ? `3. "🔑 The challenge:" then present the question and each answer option on its own line with a number emoji (1️⃣ 2️⃣ 3️⃣ …). DO NOT reveal, hint at, or imply which option is correct — the answer is revealed later in the comments. Frame it as a test for the viewer.`
      : `3. "🔑 What you'll learn:" then expand the key points into AT LEAST 5 (ideally 6-8) lines, each starting with a number emoji (1️⃣ 2️⃣ 3️⃣ …) — a full, accurate 1-2 sentence explanation. EVERY line MUST contain a concrete number, percentage, or statistic (e.g. "reduces risk by 24%", "raises the odds 4.5-fold"), the mechanism, AND why it matters. Never write a point without a specific figure.`;
    const ctaSection = quiz
      ? `5. A warm, energetic call to action that invites following on BOTH platforms: ▶️ Subscribe on YouTube ${ytH} AND 📸 Follow on Instagram ${igH} for daily ${brand.niche}, 💬 drop your answer (A/B/C/D) in the comments, 💾 Save this for later, and ❤️ Share this.`
      : `5. A warm, energetic call to action that BOTH grows the audience AND drives engagement (engagement = reach): ▶️ Subscribe on YouTube ${ytH} AND 📸 Follow on Instagram ${igH} for daily ${brand.niche}, 💾 Save this for later, ❤️ Share this with someone who needs it, 👇 Tag someone who needs to see this, and 💬 ask ONE specific question the viewer can answer in a word or two to spark comments.`;

    const prompt =
`Write a BEAUTIFUL, detailed, scroll-stopping caption for a ${brand.niche} educational post aimed at ${brand.audience}. This SAME caption is used on both Instagram and YouTube, so make it engaging on both.

POST TYPE: ${post.type}
TITLE: ${post.title}
HOOK: ${post.hook ?? ""}
KEY POINTS / CONTENT (these are the EXACT points shown on the video cards — your caption MUST explain THESE, expanding every one):
${contentSource}

CRITICAL FIDELITY RULES:
- Cover EVERY key point above — one caption line per card point, in the same order.
- Use the EXACT statistic/number from each point. NEVER invent, change, round, or substitute a different figure. If a point says "43%", the caption says "43%".
- Do not skip a number in the sequence (no jumping ①②③⑤). Do not add points that aren't in the content.
- Then ADD depth to each: the mechanism (why/how it happens) and why it matters for the viewer — but keep the card's own fact intact.
${quiz ? "\nIMPORTANT: This is a QUIZ post. NEVER state, reveal, or hint at the correct answer anywhere in the caption — the answer is only revealed later in the comments.\n" : ""}
Structure it EXACTLY like this, with real line breaks between sections and tasteful emojis:
1. An opening HOOK line with a relevant emoji — 1 punchy sentence that stops the scroll.
2. A 2-3 sentence intro paragraph that frames why this matters and what the viewer will learn.
${learnSection}
4. "💡 Why it matters:" 1-2 sentences of real-world relevance.
${ctaSection}

Tone: authoritative but warm and accessible — like a brilliant expert who's a great teacher. Use tasteful emojis as section markers and bullet leads. NO markdown symbols (* # _), NO hashtags (added separately). Make it FULL, rich and genuinely DETAILED — aim for about 380-480 words. Expand EVERY key point thoroughly with the specific stat/number, the mechanism, and why it matters for the viewer. This is the complete description (it runs in full on YouTube; Instagram trims it cleanly at the end). Do NOT pad with filler — every line must be substantive and informative.`;

    const system =
      `You are a world-class ${brand.niche} expert and social media creator writing rich, beautifully formatted, engaging captions optimized for engagement and search. Return ONLY the caption text — no preamble, no markdown symbols, no hashtags.` +
        (isQuizType(post.type) ? " For quiz posts, NEVER reveal the correct answer." : "");

    // Tier order: Gemini FLASH → Grok → Gemini REASONING (the slow "thinking"
    // models are the last resort, AFTER Grok). Centralized in ai-factory.
    const { generateTextResilient } = await import("@/lib/ai-factory");
    // Quality gate. The TARGET is ~380-480 words (~2000+ chars) with a numbered
    // key-points body (see the reference style). Demand a genuinely FULL caption from
    // each tier — length AND at least 3 numbered points — so a thin/degraded provider
    // is SKIPPED and the next tier is tried. This is what keeps captions "full and
    // detailed" instead of shipping a 2-line stub when one provider returns short.
    // Count numbered points in ANY style the models use: circled ①-⑳ (U+2460-2473),
    // keycap 1️⃣, or plain "1." / "2)" at line start.
    const numberedCount = (t: string) => (t.match(/[①-⑳]|\d️?⃣|^\s*\d+[.)]\s/gm) || []).length;
    const richEnough = (t: string) => {
      const c = t.replace(/\*\*/g, "").trim();
      return c.length >= 1100 && numberedCount(c) >= 3;
    };
    // Generous token budget so the caption NEVER truncates mid-sentence.
    const out = await generateTextResilient(prompt, system, 4000, richEnough);
    const clean = (out ?? "").replace(/\*\*/g, "").replace(/^#+\s.*$/gm, "").trim();
    // Accept any substantial AI caption over the deterministic fallback — the strict
    // validator above already pushed the chain toward the fullest tier; this floor
    // (500 chars) only guards against an all-tiers-thin day.
    if (clean.length >= 500) {
      return clean;
    }
    console.warn(`[RichCaption] AI caption too short (${clean.length} chars) — using beautiful-caption fallback`);
  } catch (err: any) {
    console.warn("[RichCaption] All AI providers failed, using beautiful-caption fallback:", err?.message ?? err);
  }
  return fallback;
}

/**
 * Put a BLANK line between consecutive numbered points (① ② ③ … / 1️⃣ / "1.") so the
 * key-points list breathes and is easy to read on Instagram. Only point lines are
 * spaced — the hook, intro paragraph, "Why it matters" and CTA are untouched.
 */
function spaceCaptionPoints(text: string): string {
  const isPoint = (l: string) => /^\s*(?:[①-⑳]|\d️?⃣|\d+[.)])\s/.test(l);
  const lines = (text || "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (isPoint(line) && out.length && out[out.length - 1].trim() !== "") out.push("");
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Build the ONE unified rich caption for a post (NO hashtags). Generated once and
 * cached on the post's `reelScript` as "RICHCAP:<text>" so both the IG and YT
 * publishers read the identical stored caption (and Grok is not called twice).
 */
export async function buildRichCaption(post: RichCaptionPost): Promise<string> {
  // 1. Already cached → return verbatim (identical text on every platform).
  const stored = post.reelScript ?? "";
  if (stored.startsWith(RICHCAP_PREFIX)) {
    return stored.slice(RICHCAP_PREFIX.length).trim();
  }

  const brand = await getBrand();

  // 2. Generate the rich caption, space the numbered points, + append follow links.
  const text = appendFollowLinks(spaceCaptionPoints(await generateRichCaption(post, brand)), brand);

  // 3. Best-effort: persist it back so the other platform reuses the same text.
  //    Only when the post has a real id (otherwise there's nothing to update).
  if (post.id) {
    try {
      await prisma.post.update({
        where: { id: post.id },
        data:  { reelScript: RICHCAP_PREFIX + text },
      });
      // Keep the in-memory post consistent for any subsequent reads in this run.
      post.reelScript = RICHCAP_PREFIX + text;
    } catch (err: any) {
      console.warn("[RichCaption] Could not persist RICHCAP cache:", err?.message ?? err);
    }
  }

  return text;
}
