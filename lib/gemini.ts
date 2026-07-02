/**
 * lib/gemini.ts
 *
 * Google Gemini AI client with automatic model fallback.
 *
 * Model priority (tried in order on 429 or model-unavailable errors):
 *
 * TEXT chain:
 *   1.  gemini-3.5-flash       – fastest, highest quality
 *   2.  gemini-3-flash         – Gemini 3 flash, very capable
 *   3.  gemini-2.5-flash       – Gemini 2.5 flash
 *   4.  gemini-3.1-flash-lite  – lite variant, high RPD quota (500/day)
 *   5.  gemma-4-31b            – Gemma 4 31B, unlimited tokens
 *   6.  gemma-4-26b            – Gemma 4 26B, unlimited tokens
 *   7.  gemini-2.0-flash       – stable 2.0 fallback
 *   8.  gemini-1.5-flash       – proven fallback
 *   9.  gemini-1.5-flash-8b    – lightest last resort
 *
 *   (gemini-3-flash-live is a Live API model — excluded; it returns broken
 *    text fragments when driven via the standard generateContent SDK.)
 *
 * VISION chain (multimodal — Gemma + Live models excluded):
 *   1.  gemini-3.5-flash       – best multimodal quality
 *   2.  gemini-3-flash         – Gemini 3 multimodal
 *   3.  gemini-2.5-flash       – Gemini 2.5 multimodal
 *   4.  gemini-3.1-flash-lite  – lite multimodal
 *   5.  gemini-2.0-flash       – stable multimodal fallback
 *   6.  gemini-1.5-flash       – proven multimodal fallback
 *   7.  gemini-1.5-flash-8b    – lightest last resort
 *
 * Advances on: 429 Too Many Requests, quota exceeded, model not found.
 * Resets to top of chain every hour so preferred models get another chance.
 * Override starting model: GEMINI_MODEL=gemini-3.5-flash (Railway env var)
 */

import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import { PostCommentContext } from "@/lib/grok";
import { notifyRateLimit } from "@/lib/notifier";
import { atHandle, buildBrandPersona } from "@/lib/brandConfig";
import { getBrand } from "@/lib/preferences";

// ── Model fallback chain (text / non-vision) — full 11-model chain ────────────
// Reliable, clean instruct models first; problematic ones last as a safety net.
// Robustness is handled at the call layer:
//   • generateContentJSON walks this chain and SKIPS any model that returns
//     non-JSON / truncated output (protects story + structured generation).
//   • withFallback advances on 429 / 404, so limit:0 and invalid models are
//     skipped automatically.
// IDs are the VALID Generative-Language API ids (display names differ):
//   "Gemini 3 Flash"  → gemini-3-flash-preview   (bare gemini-3-flash 404s)
//   "Gemma 4 31B/26B" → gemma-4-31b-it / gemma-4-26b-a4b-it
// Notes per model: 2.0-flash / 2.0-flash-lite are free-tier limit:0 (429),
// gemma models "think out loud", gemini-3-flash-live is a Live API model — all
// kept only as last-resort fallbacks per user request.
// FLASH tier — fast, clean instruct models. Tried FIRST. These give clean,
// untruncated prose (good for captions/hooks).
export const FLASH_MODELS: string[] = [
  "gemini-3.5-flash",        // 1. Fastest, highest quality
  "gemini-3-flash-preview",  // 2. Gemini 3 Flash (preview = valid id)
  "gemini-2.5-flash",        // 3. Gemini 2.5 Flash — reliable workhorse
  "gemini-3.1-flash-lite",   // 4. Lite — 15 RPM / 500 RPD (best availability)
  "gemini-2.5-flash-lite",   // 5. 2.5 Flash Lite
  "gemini-2.0-flash",        // 6. 2.0 Flash (free-tier limit:0 — fallback)
  "gemini-2.0-flash-lite",   // 7. 2.0 Flash Lite (limit:0 — fallback)
];

// REASONING / "thinking" tier — slower, and they "think out loud" / truncate,
// which produces messy captions. Per the owner's request these are the VERY LAST
// resort: for caption/hook text the call layer tries Grok BEFORE falling to these.
export const REASONING_MODELS: string[] = [
  "gemini-2.5-pro",          // Gemini 2.5 Pro — reasoning, higher quality, slower
  "gemma-4-31b-it",          // Gemma 4 31B — unlimited (thinking model)
  "gemma-4-26b-a4b-it",      // Gemma 4 26B — unlimited (thinking model)
  "gemini-3-flash-live",     // Live API — last-resort only
];

const MODEL_CHAIN: string[] = (() => {
  const defaults = [...FLASH_MODELS, ...REASONING_MODELS];
  // Allow pinning the starting point via env var
  const envModel = process.env.GEMINI_MODEL?.trim();
  if (envModel && envModel !== defaults[0]) {
    return [envModel, ...defaults.filter(m => m !== envModel)];
  }
  return defaults;
})();

// ── Vision-capable model chain (for image/video analysis) ────────────────────
// Same clean gemini-3.x models — they support multimodal. (Gemma has no vision;
// 2.0/1.5 are limit:0 on this key.)
const VISION_CHAIN: string[] = [
  "gemini-3.5-flash",        // 1. Best multimodal quality
  "gemini-3-flash-preview",  // 2. Gemini 3 multimodal
  "gemini-2.5-flash",        // 3. Gemini 2.5 multimodal
  "gemini-3.1-flash-lite",   // 4. Lite multimodal (best availability)
];

// ── Global model state (shared across all GeminiClient instances) ─────────────
let _modelIdx    = 0;             // current position in MODEL_CHAIN
let _resetAt     = Date.now();    // when to try falling back to the top
const RESET_MS   = 60 * 60 * 1000; // retry preferred model after 1 hour
const REQUEST_TIMEOUT_MS = 30_000; // per-request SDK timeout — a hung call must never stall the chain

function activeModel(): string {
  // Every hour, reset back to top of chain so preferred models get another chance
  if (Date.now() - _resetAt > RESET_MS && _modelIdx > 0) {
    console.log(`[Gemini] Hourly reset: retrying from ${MODEL_CHAIN[0]}`);
    _modelIdx = 0;
    _resetAt  = Date.now();
  }
  return MODEL_CHAIN[_modelIdx] ?? MODEL_CHAIN[MODEL_CHAIN.length - 1];
}

function advanceModel(failedModel: string): string | null {
  // Don't advance if another concurrent call already moved past this model
  if (MODEL_CHAIN[_modelIdx] !== failedModel && _modelIdx < MODEL_CHAIN.length - 1) {
    return MODEL_CHAIN[_modelIdx]; // already on a newer model
  }
  _modelIdx++;
  if (_modelIdx >= MODEL_CHAIN.length) {
    _modelIdx = MODEL_CHAIN.length - 1;
    console.error("[Gemini] All models exhausted — no more fallbacks available");
    return null;
  }
  const next = MODEL_CHAIN[_modelIdx];
  console.warn(`[Gemini] Switched to fallback model: ${next}`);
  return next;
}

function isRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("resource_exhausted") ||
    // 404 = model doesn't exist / not available for this API version
    msg.includes("404") ||
    msg.includes("not found") ||
    msg.includes("is not supported for generatecontent") ||
    msg.includes("model not found") ||
    // Model doesn't support multimodal / this feature — skip to next
    msg.includes("does not support") ||
    msg.includes("unsupported") ||
    msg.includes("invalid_argument") ||
    msg.includes("only text") ||
    msg.includes("multimodal") ||
    msg.includes("inline_data") ||
    // 503/500 "high demand" / overloaded — TRANSIENT capacity errors. These must
    // ALSO advance the chain: previously a single 503 on the preferred model
    // bypassed the fallback entirely (propagated immediately) and rich captions
    // silently degraded to the deterministic text while lower-chain models
    // (gemma, flash-lite) had plenty of free quota.
    msg.includes("503") ||
    msg.includes("service unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("high demand") ||
    msg.includes("internal error") ||
    msg.includes("500 ")
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Generic, niche-agnostic module default. Methods that have loaded a brand pass
// buildBrandSystemPrompt(brand) instead of relying on this constant.
const CARDIOLOGY_SYSTEM = `You are an expert Instagram content creator. You craft accurate, valuable, engaging content optimised for the Instagram feed. Always respond in valid JSON format unless instructed otherwise.`;

/**
 * Clean a conversational reply (DM / comment) from any model.
 * Gemma models often prepend reasoning/scaffolding lines like:
 *   "*   Context: ..."   "*   Goal: ..."   "Here's my reply:"   "Reply:"
 * before the actual message. Strip all that so only the human reply remains.
 */
function cleanConversationalReply(raw: string): string {
  let text = (raw ?? "").trim();

  // Drop fenced code blocks if any
  text = text.replace(/```[\s\S]*?```/g, "").trim();

  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  const reasoningLine = /^\s*(?:[*\-•#>]+\s*)?(?:context|goal|task|note|reply|response|output|answer|message|persona|rules?|tone|step\s*\d*|thinking|reasoning|draft|here(?:'|’)?s?\b)\s*[:\-]/i;
  const bulletScaffold = /^\s*[*\-•]\s/;            // markdown bullet (Gemma scaffolding)
  const labelPrefix    = /^\s*(?:reply|response|answer|message)\s*[:\-]\s*/i;

  for (const line of lines) {
    if (!line.trim()) { if (kept.length) kept.push(""); continue; }
    // Skip leading reasoning/scaffolding lines until we hit real prose
    if (kept.length === 0 && (reasoningLine.test(line) || bulletScaffold.test(line))) continue;
    kept.push(line);
  }

  let out = kept.join("\n").trim();
  out = out.replace(labelPrefix, "");                // strip leading "Reply:" label
  out = out.replace(/^["'`]+|["'`]+$/g, "").trim();  // strip wrapping quotes
  // If stripping removed everything (model emitted only scaffolding), fall back to raw
  if (!out) out = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  return out;
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  try { return JSON.parse(cleaned) as T; } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("Failed to parse Gemini response as JSON: " + cleaned.slice(0, 200));
  }
}

async function urlToBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const ct   = res.headers.get("content-type") ?? "image/jpeg";
    const mime = ct.split(";")[0].trim();
    const buf  = await res.arrayBuffer();
    return { data: Buffer.from(buf).toString("base64"), mimeType: mime };
  } catch { return null; }
}

// ── GeminiClient ──────────────────────────────────────────────────────────────

export class GeminiClient {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("Gemini API key is required");
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Core wrapper: tries the active model, falls back to the next on 429.
   * Retries up to MODEL_CHAIN.length times total.
   */
  private async withFallback<T>(
    label: string,
    fn: (model: string) => Promise<T>,
  ): Promise<T> {
    let attempts = 0;
    while (attempts < MODEL_CHAIN.length) {
      const model = activeModel();
      try {
        const result = await fn(model);
        // Log which model is actually serving (only when not the preferred one)
        if (_modelIdx > 0) {
          console.log(`[Gemini/${label}] Served by fallback model: ${model}`);
        }
        return result;
      } catch (err: unknown) {
        if (isRateLimitError(err)) {
          // Surface stale / invalid model IDs explicitly. isRateLimitError also
          // matches 404 / not-found / unsupported, which previously got silently
          // lumped in with rate limits — making a deprecated model ID invisible.
          const emsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
          if (emsg.includes("404") || emsg.includes("not found") || emsg.includes("model not found") ||
              emsg.includes("is not supported for generatecontent") || emsg.includes("does not support") ||
              emsg.includes("unsupported")) {
            console.warn(`[Gemini/${label}] Model "${model}" skipped — not found / unsupported (possible stale model ID): ${err instanceof Error ? err.message : err}`);
          }
          const next = advanceModel(model);
          const nextName = next ?? "none";
          console.warn(`[Gemini/${label}] Rate limit on ${model} — switching to ${nextName}`);
          // Email alert (rate-limited to once per 10 min per model so no spam)
          notifyRateLimit({
            service: `Gemini (${model})`,
            detail:  `Rate limit hit on model ${model}. Auto-switched to ${nextName}. Model chain: ${MODEL_CHAIN.join(" → ")}`,
          }).catch((e: any) => console.warn("[Gemini] Rate-limit email failed:", e?.message));
          if (!next) throw new Error(`[Gemini] All ${MODEL_CHAIN.length} models exhausted. Last error: ${err instanceof Error ? err.message : err}`);
          attempts++;
          // Small delay before next attempt
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        throw err; // non-429 error — propagate immediately
      }
    }
    throw new Error(`[Gemini/${label}] Exhausted all model fallbacks`);
  }

  // ── Shared single-call helper ─────────────────────────────────────────────
  // Live models (gemini-*-live) support streamGenerateContent REST but NOT
  // the non-streaming generateContent endpoint. This helper centralises the
  // detection so every method gets the fix automatically.
  private async callModel(
    model:       string,
    prompt:      string | object[],
    systemInstruction?: string,
    maxTokens    = 2000,
    temperature  = 0.7,
    jsonOutput   = false,
  ): Promise<string> {
    // Gemma models on the Generative Language API do NOT support systemInstruction.
    // Passing one makes them error or emit broken output. Fold it into the prompt.
    const isGemma = model.startsWith("gemma");
    const isLive  = model.includes("-live");
    let effectivePrompt = prompt;
    let effectiveSystem = systemInstruction;
    if (isGemma && systemInstruction && typeof prompt === "string") {
      effectivePrompt = `${systemInstruction}\n\n${prompt}`;
      effectiveSystem = undefined;
    }

    const m = this.genAI.getGenerativeModel({
      model,
      ...(effectiveSystem ? { systemInstruction: effectiveSystem } : {}),
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        // Structured-output mode: only gemini (non-live) models support the
        // application/json response mime type — gemma/live would error on it.
        ...(jsonOutput && !isGemma && !isLive ? { responseMimeType: "application/json" } : {}),
      },
    }, { timeout: REQUEST_TIMEOUT_MS });

    if (isLive) {
      const streamResult = await m.generateContentStream(effectivePrompt as any);
      let text = "";
      for await (const chunk of streamResult.stream) {
        text += chunk.text();
      }
      return text;
    }

    const result = await m.generateContent(effectivePrompt as any);
    return result.response.text();
  }

  // ── Core text generation ───────────────────────────────────────────────────

  async generateContent(
    prompt: string,
    systemPrompt = CARDIOLOGY_SYSTEM,
    maxTokens    = 2000,
  ): Promise<string> {
    return this.withFallback("generateContent", (model) =>
      this.callModel(model, prompt, systemPrompt, maxTokens, 0.7)
    );
  }

  /**
   * Generate plain text trying each model in `models` IN ORDER, skipping a model
   * on rate-limit / 503 / unsupported errors. Returns the first non-empty result,
   * or throws if every model in the tier fails. Unlike generateContent, this does
   * NOT touch the shared fallback index — it's an explicit caller-curated tier,
   * used to split FLASH vs REASONING models so the call layer can insert Grok
   * between them.
   */
  async generateContentInModels(
    models:      string[],
    prompt:      string,
    systemPrompt = CARDIOLOGY_SYSTEM,
    maxTokens    = 2000,
    jsonOutput   = false,
  ): Promise<string> {
    let lastErr: unknown;
    for (const model of models) {
      try {
        const out = await this.callModel(model, prompt, systemPrompt, maxTokens, 0.7, jsonOutput);
        if (out && out.trim().length > 0) {
          if (model !== models[0]) console.log(`[Gemini] tier served by fallback model: ${model}`);
          return out;
        }
      } catch (err) {
        lastErr = err;
        // Surface stale / invalid model IDs (404 / not-found / unsupported) which
        // would otherwise be silently skipped within this tier.
        const emsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
        if (emsg.includes("404") || emsg.includes("not found") || emsg.includes("model not found") ||
            emsg.includes("is not supported for generatecontent") || emsg.includes("does not support") ||
            emsg.includes("unsupported")) {
          console.warn(`[Gemini] tier model "${model}" skipped — not found / unsupported (possible stale model ID): ${err instanceof Error ? err.message : err}`);
        }
        // Best-effort tier: on ANY error (rate-limit, 503, unsupported, etc.) move
        // to the next model in this tier.
        continue;
      }
    }
    throw lastErr ?? new Error("[Gemini] all tier models failed");
  }

  /** FLASH tier only (fast, clean prose). Tried before Grok. */
  async generateContentFlash(prompt: string, systemPrompt = CARDIOLOGY_SYSTEM, maxTokens = 2000): Promise<string> {
    return this.generateContentInModels(FLASH_MODELS, prompt, systemPrompt, maxTokens);
  }

  /** REASONING/"thinking" tier only — the VERY last resort, AFTER Grok. */
  async generateContentReasoning(prompt: string, systemPrompt = CARDIOLOGY_SYSTEM, maxTokens = 2000): Promise<string> {
    return this.generateContentInModels(REASONING_MODELS, prompt, systemPrompt, maxTokens);
  }

  /**
   * VISION: run EXACTLY the given multimodal model against a base64 image/video
   * inline part. Returns the raw model text (caller parses). Unlike the internal
   * vision chain, this honours the operator's per-task vision model selection;
   * the outer ai-factory chain provides the fallback.
   */
  async visionRaw(
    model: string,
    data: string,      // raw base64, no data: prefix
    mimeType: string,  // e.g. "image/jpeg" or "video/mp4"
    prompt: string,
    systemInstruction = "You are a social media content expert analysing images and videos. Return only valid JSON.",
    maxTokens = 1000,
  ): Promise<string> {
    const m = this.genAI.getGenerativeModel({
      model,
      systemInstruction,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    }, { timeout: REQUEST_TIMEOUT_MS });
    const textPart:  Part = { text: prompt };
    const mediaPart: Part = { inlineData: { data, mimeType: mimeType as any } };
    const result = await m.generateContent([textPart, mediaPart]);
    return result.response.text();
  }

  /**
   * Generate content that MUST be valid JSON. Walks the full MODEL_CHAIN and
   * returns the first response that actually parses as a JSON object/array.
   * Unlike generateContent (which stops at the first model and only advances on
   * 429s), this also advances when a model returns non-JSON / truncated output —
   * so a model that "thinks out loud" or truncates never poisons the result.
   * Returns the last raw response if none parse (caller can still fall back).
   */
  async generateContentJSON(
    prompt: string,
    systemPrompt = CARDIOLOGY_SYSTEM,
    maxTokens    = 2000,
  ): Promise<string> {
    // Walk the Gemini model chain directly (selected-provider behaviour — the
    // ai-factory returns GrokClient when Grok is the chosen provider).
    let lastRaw = "";
    for (const model of MODEL_CHAIN) {
      try {
        const raw = await this.callModel(model, prompt, systemPrompt, maxTokens, 0.7, true);
        lastRaw = raw;
        const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
        const match   = cleaned.match(/\{[\s\S]*\}/) ?? cleaned.match(/\[[\s\S]*\]/);
        if (match) {
          JSON.parse(match[0]);   // throws if invalid
          console.log(`[Gemini/json] valid JSON from ${model}`);
          return raw;
        }
        console.warn(`[Gemini/json] ${model} returned no JSON — trying next model`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Gemini/json] ${model} failed (${msg.slice(0, 80)}) — trying next model`);
      }
    }
    console.warn("[Gemini/json] No model produced valid JSON — returning last raw response");
    return lastRaw;
  }

  // ── Vision: analyse an image or video URL ─────────────────────────────────

  async analyzeMedia(
    mediaUrl: string,
    postType: string,
  ): Promise<{ caption: string; hashtags: string[] } | null> {
    const media = await urlToBase64(mediaUrl);
    if (!media) {
      console.warn("[Gemini] Could not fetch media for vision analysis:", mediaUrl.slice(0, 80));
      return null;
    }

    const supportedMimes = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm"];
    if (!supportedMimes.includes(media.mimeType)) {
      console.warn("[Gemini] Unsupported media type for vision:", media.mimeType);
      return null;
    }

    const brand = await getBrand();
    const typeInstructions: Record<string, string> = {
      QUIZ:             "Write a quiz caption — pose a question and prompt followers to 'Drop your answer below!' (80-120 words, no answer in caption)",
      ECG_QUIZ:         "Describe what you see and ask 'What's the answer?' (80-120 words)",
      ANGIOGRAPHY_QUIZ: "Describe what you see and ask followers to identify it (80-120 words)",
      EDUCATIONAL:      "Write an educational caption with a bold hook, 3-4 bullet insights, and a save/share CTA (150-220 words)",
      CLINICAL_PEARL:   "Write a pro-tip caption — one high-value insight from this image, then context (100-150 words)",
      CASE_STUDY:       "Write a story/example caption — brief scenario based on this image, key takeaways, an engaging CTA (150-200 words)",
      CAROUSEL:         "Write a carousel caption with a powerful hook that makes followers swipe. End with 'Save this for later' (100-150 words)",
      PREVENTIVE:       "Write a how-to/tips caption with a shocking statistic hook, actionable tips, and share CTA (150-200 words)",
      REEL:             "Write a reel caption with a punchy hook, key takeaway, and 'Watch till end!' (80-100 words)",
    };

    const instruction = typeInstructions[postType] ?? typeInstructions["EDUCATIONAL"];
    const mediaPart: Part = { inlineData: { data: media.data, mimeType: media.mimeType as any } };
    const textPart:  Part = {
      text: `You are a world-class ${brand.niche} Instagram content creator analysing this image/video for the account ${atHandle(brand)}.

Post type: ${postType}
Niche: ${brand.niche}. Audience: ${brand.audience}.
Instructions: ${instruction}

Rules:
- Write specifically about what you actually SEE in this image/video — real, concrete details.
- Start with a HOOK line that stops the scroll. Use line breaks (\\n) between sections
- NO hashtags in the caption text. No asterisks, no markdown. End with a strong CTA.

After the caption, output exactly 4 relevant Instagram hashtags starting with #.
Return ONLY valid JSON: { "caption": "...", "hashtags": ["#tag1","#tag2","#tag3","#tag4"] }`,
    };

    try {
      return await this.withFallback("analyzeMedia", async (model) => {
        const m = this.genAI.getGenerativeModel({
          model,
          systemInstruction: `You are a ${brand.niche} Instagram content expert. Return only valid JSON.`,
          generationConfig:  { maxOutputTokens: 800, temperature: 0.7 },
        });
        const result = await m.generateContent([textPart, mediaPart]);
        const parsed = parseJson<{ caption: string; hashtags: string[] }>(result.response.text());
        if (!parsed.caption) throw new Error("Empty caption in vision response");
        return {
          caption:  parsed.caption.trim(),
          hashtags: (parsed.hashtags ?? []).map((h: string) => h.startsWith("#") ? h : `#${h}`).slice(0, 4),
        };
      });
    } catch (err: any) {
      console.warn("[Gemini] Vision analysis failed:", err?.message);
      return null;
    }
  }

  /**
   * Vision analysis using already-decoded base64 data (avoids server fetching a blob URL).
   * Used when the client sends the file as base64 directly.
   */
  async analyzeMediaInline(
    data:     string,   // raw base64, no "data:..." prefix
    mimeType: string,   // e.g. "image/jpeg"
    postType: string,
  ): Promise<{ caption: string; hashtags: string[] } | null> {
    const supportedMimes = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime","image/jpg"];
    const normalised = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    if (!supportedMimes.includes(normalised)) {
      console.warn("[Gemini] Unsupported mime for inline vision:", mimeType);
      return null;
    }

    const brand = await getBrand();
    const typeInstructions: Record<string, string> = {
      QUIZ:             "Write a quiz caption — pose a question about what you see and prompt followers to 'Drop your answer below!' (80-120 words, no answer in caption)",
      ECG_QUIZ:         "Describe what you see and ask 'What's the answer?' (80-120 words)",
      ANGIOGRAPHY_QUIZ: "Describe what you see and ask followers to identify it (80-120 words)",
      EDUCATIONAL:      "Write an educational caption with a bold hook, 3-4 bullet insights from this image, and a save/share CTA (150-220 words)",
      CLINICAL_PEARL:   "Write a pro-tip caption — one high-value insight from this image, then context (100-150 words)",
      CASE_STUDY:       "Write a story/example caption — brief scenario based on this image, key takeaways, an engaging CTA (150-200 words)",
      CAROUSEL:         "Write a carousel caption with a powerful hook about this image that makes followers swipe. End with 'Save this for later' (100-150 words)",
      PREVENTIVE:       "Write a how-to/tips caption using insights from this image, a shocking statistic hook, actionable tips, share CTA (150-200 words)",
      REEL:             "Write a reel caption with a punchy hook about what's shown, key takeaway, and 'Watch till end!' (80-100 words)",
      MYTH_FACT:        "Write a myth vs fact caption based on this image. Open with 'MYTH:' then 'FACT:' rebuttal with evidence. CTA to share (120-180 words)",
      CTA:              `Write a warm CTA caption inspired by this image, explaining why following ${atHandle(brand)} is valuable (80-120 words)`,
    };

    const instruction = typeInstructions[postType] ?? typeInstructions["EDUCATIONAL"];
    const mediaPart: Part = { inlineData: { data, mimeType: normalised as any } };
    const textPart:  Part = {
      text: `You are a world-class ${brand.niche} Instagram content creator analysing this image/video for the account ${atHandle(brand)}.

Post type: ${postType}
Niche: ${brand.niche}. Audience: ${brand.audience}.
Instructions: ${instruction}

Rules:
- Write specifically about what you actually SEE in this image/video — real, concrete details.
- If it's a reel/video: describe what is being demonstrated
- Start with a HOOK line that stops the scroll. Use line breaks (\\n) between sections
- NO hashtags in the caption text. No asterisks, no markdown. End with a strong CTA.

After the caption, output exactly 4 relevant Instagram hashtags starting with #.
Return ONLY valid JSON: { "caption": "...", "hashtags": ["#tag1","#tag2","#tag3","#tag4"] }`,
    };

    // Use VISION_CHAIN — skips gemini-3-flash-live which doesn't support multimodal
    let visionAttempts = 0;
    for (const model of VISION_CHAIN) {
      try {
        console.log(`[Gemini/vision] Trying ${model} for inline vision (${mimeType})...`);
        const m = this.genAI.getGenerativeModel({
          model,
          systemInstruction: `You are a ${brand.niche} Instagram content expert analysing images and videos. Return only valid JSON.`,
          generationConfig:  { maxOutputTokens: 1000, temperature: 0.7 },
        });
        const result = await m.generateContent([textPart, mediaPart]);
        const parsed = parseJson<{ caption: string; hashtags: string[] }>(result.response.text());
        if (!parsed.caption) throw new Error("Empty caption in vision response");
        console.log(`[Gemini/vision] Caption generated by ${model}`);
        return {
          caption:  parsed.caption.trim(),
          hashtags: (parsed.hashtags ?? []).map((h: string) => h.startsWith("#") ? h : `#${h}`).slice(0, 4),
        };
      } catch (err: any) {
        const msg = (err?.message ?? String(err)).toLowerCase();
        const isSkippable = isRateLimitError(err);
        console.warn(`[Gemini/vision] ${model} failed (skippable=${isSkippable}): ${err?.message}`);
        if (isSkippable) {
          visionAttempts++;
          continue; // try next model
        }
        // Non-skippable error — still try next model since vision support varies
        visionAttempts++;
        if (visionAttempts >= VISION_CHAIN.length) break;
        continue;
      }
    }
    console.warn("[Gemini/vision] All vision models failed — falling back to text generation");
    return null;
  }

  // ── Comment reply ─────────────────────────────────────────────────────────

  async generateCommentReply(
    commentText: string,
    username:    string,
    postContext?: PostCommentContext,
  ): Promise<string> {
    const brand = await getBrand();
    const ctx  = postContext ?? {};
    const isQuizType = ["QUIZ","ECG_QUIZ","ANGIOGRAPHY_QUIZ"].includes(ctx.postType ?? "");

    const trimmedComment    = commentText.trim();
    const singleLetterMatch = trimmedComment.match(/^([A-Da-d])[.)!?\s]*$/);
    const commentLetter     = (singleLetterMatch
      ? singleLetterMatch[1].toUpperCase()
      : (commentText.match(/\b([A-Da-d])\b/)?.[1] ?? "").toUpperCase());

    // Resolve the correct quiz answer if it wasn't provided, so the reply is
    // CORRECT (not a guess). Reads the post content/caption to determine A/B/C/D.
    if (isQuizType && !ctx.correctLetter) {
      const source = `${ctx.postContent ?? ""}\n${(ctx as any).caption ?? ""}\n${ctx.postTitle ?? ""}`.trim();
      if (source) {
        try {
          const resolved = await this.determineQuizAnswer(source);
          if (resolved) { ctx.correctLetter = resolved.correctLetter; ctx.correctAnswer = resolved.correctAnswer; }
        } catch { /* best-effort */ }
      }
    }

    const correctLetter    = ctx.correctLetter ?? "";
    const answeredCorrectly = commentLetter && correctLetter && commentLetter === correctLetter;
    const answeredWrong     = commentLetter && correctLetter && commentLetter !== correctLetter;

    let postDesc = "";
    if (ctx.postTitle)   postDesc += `Post title: "${ctx.postTitle}". `;
    if (ctx.postContent) postDesc += `Post content:\n"${ctx.postContent.slice(0, 600)}"`;
    if (!postDesc)       postDesc  = `Post: ${brand.niche}.`;

    let quizSection = "";
    if (isQuizType && correctLetter) {
      quizSection = answeredCorrectly
        ? `Quiz: the answer is ${correctLetter}. Commenter answered CORRECTLY. Congratulate warmly and give a 2-sentence explanation.`
        : answeredWrong
          ? `Quiz: the answer is ${correctLetter}${ctx.correctAnswer ? ` — ${ctx.correctAnswer}` : ""}. Commenter answered ${commentLetter} which is WRONG. Gently correct them and explain why ${correctLetter} is right in 2 sentences.`
          : `Quiz post: invite them to guess (A/B/C/D).`;
    }

    const lengthRule = isQuizType
      ? "Keep it to 2-4 sentences: confirm/correct the answer, then a concise explanation of WHY. Write the COMPLETE reply — never cut off mid-sentence."
      : "1-3 sentences max. Write the COMPLETE reply — never cut off mid-sentence.";
    const prompt = `POST CONTEXT: ${postDesc}\n${quizSection}\n\nCOMMENT from @${username}: "${commentText}"\n\nWrite YOUR reply to this comment. ${lengthRule} Be specific to exactly what they said. 1-2 emojis max, only if natural. Never start with "Great question!", "Thanks for...", or any hollow opener.\nWrite ONLY the reply text — no quotes, no labels, no explanation.`;

    return this.withFallback("commentReply", async (model) => {
      // High token budget: these flash models spend output tokens on internal
      // "thinking", so a low cap (e.g. 250) left replies truncated/empty. 1024
      // leaves ample room for thinking PLUS a complete reply.
      const raw = await this.callModel(
        model,
        prompt,
        buildBrandPersona(brand),
        1024,
        0.9,
      );
      const clean = cleanConversationalReply(raw);
      if (!clean) throw new Error("empty reply after cleaning");
      return clean;
    });
  }

  // ── DM reply ──────────────────────────────────────────────────────────────

  async generateDMReply(
    messages:       Array<{ from: string; text: string; time: string }>,
    senderUsername: string,
  ): Promise<string> {
    const brand = await getBrand();
    const thread = [...messages].reverse().map(m => `[${m.from}]: ${m.text}`).join("\n");
    const latest = messages[0]?.text ?? "";
    const prompt = `CONVERSATION SO FAR:\n${thread}\n\nLatest message from @${senderUsername}: "${latest}"\n\nWrite YOUR DM reply. 2-3 sentences max, warm and personal, specific to what they actually said. Never "Thank you for your message!" or any canned opener. At most 1 emoji.\nWrite ONLY the reply text — no quotes, no labels.`;

    return this.withFallback("dmReply", async (model) => {
      const raw = await this.callModel(
        model,
        prompt,
        buildBrandPersona(brand),
        200,
        0.88,
      );
      const clean = cleanConversationalReply(raw);
      if (!clean) throw new Error("empty reply after cleaning");
      return clean;
    });
  }

  // ── Quiz answer detection ─────────────────────────────────────────────────

  async determineQuizAnswer(
    caption: string,
  ): Promise<{ correctLetter: string; correctAnswer: string } | null> {
    try {
      const raw = await this.withFallback("quizAnswer", (model) =>
        this.callModel(
          model,
          `Multiple-choice quiz caption:\n"${caption.slice(0, 1500)}"\n\nWhich single option (A/B/C/D) is correct?\n\nReturn JSON: {"correctLetter":"B","correctAnswer":"Full text of option B"}`,
          "You are an expert quiz solver. Return only valid JSON.",
          120,
          0.1,
        )
      );
      const parsed = parseJson<{ correctLetter: string; correctAnswer: string }>(raw);
      if (parsed.correctLetter && /^[A-Da-d]$/.test(parsed.correctLetter.trim())) {
        return {
          correctLetter: parsed.correctLetter.trim().toUpperCase(),
          correctAnswer: (parsed.correctAnswer ?? "").trim(),
        };
      }
    } catch { /* best-effort */ }
    return null;
  }

  /** Expose which model is currently active (for logging/debugging) */
  static currentModel(): string { return activeModel(); }
  static modelChain():   string[] { return [...MODEL_CHAIN]; }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let geminiInstance: GeminiClient | null = null;

export function getGeminiClient(): GeminiClient {
  if (!geminiInstance) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY not set in environment variables");
    geminiInstance = new GeminiClient(apiKey);
  }
  return geminiInstance;
}
