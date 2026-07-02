/**
 * lib/ai-factory.ts
 *
 * Central AI dispatch. The operator configures, in Settings → AI Config, a
 * PRIMARY provider + model and an ordered FALLBACK CHAIN of {provider, model}
 * PER TASK LANE:
 *   • content — post/caption/hook generation
 *   • reply   — DM + comment auto-replies
 *   • vision  — image/video analysis (gemini/groq only)
 *
 * Providers: "groq" | "cerebras" (both OpenAI-compatible → GrokClient) | "gemini".
 * Every generation path flows through here, so the operator's model + chain
 * choices apply to EVERYTHING.
 *
 * Usage:
 *   import { getAIClient } from "@/lib/ai-factory";
 *   const ai = await getAIClient("reply");     // task lane; defaults to "content"
 *   const reply = await ai.generateCommentReply(...);
 */

import { GrokClient, getGrokClient } from "@/lib/grok";
import { GeminiClient } from "@/lib/gemini";
import { readPreferences, readPreferencesForBrand } from "@/lib/preferences";
import {
  providerSupportsVideo, coerceChain, chainSteps,
  type AIProvider, type ChainStep, type AITask, type Chain,
} from "@/lib/aiModels";

export type AIClient = GrokClient | GeminiClient;

const CEREBRAS_BASE = "https://api.cerebras.ai/v1";

async function readAi(brandId?: string | null): Promise<any> {
  try {
    if (brandId) return (await readPreferencesForBrand(brandId)).ai ?? {};
    return (await readPreferences()).ai ?? {};
  } catch {
    return {};
  }
}

/** Resolve the API key for a provider: env var first, then the DB-stored key. */
function keyFor(provider: AIProvider, ai: any): string {
  if (provider === "gemini")   return (process.env.GEMINI_API_KEY?.trim())   || (ai?.geminiApiKey?.trim()   ?? "");
  if (provider === "cerebras") return (process.env.CEREBRAS_API_KEY?.trim()) || (ai?.cerebrasApiKey?.trim() ?? "");
  return (process.env.GROK_API_KEY?.trim()) || ""; // groq (env-only)
}

/** Concrete client for a provider+model, or null when its key is missing. */
function clientInstance(provider: AIProvider, model: string, ai: any): AIClient | null {
  const key = keyFor(provider, ai);
  if (!key) return null;
  if (provider === "gemini") return new GeminiClient(key);
  const baseURL = provider === "cerebras" ? CEREBRAS_BASE : (process.env.GROK_API_URL || undefined);
  return new GrokClient(key, { baseURL, model });
}

/** text/json runner bound to one provider+model, or null when the key is missing. */
function makeRunner(provider: AIProvider, model: string, ai: any):
  | { text: (p: string, s: string, m: number) => Promise<string>; json: (p: string, s: string, m: number) => Promise<string> }
  | null {
  const c = clientInstance(provider, model, ai);
  if (!c) return null;
  if (c instanceof GeminiClient) {
    // Run EXACTLY the chosen Gemini model (not Gemini's internal chain) so the
    // operator's model selection is honoured; the outer chain provides fallback.
    return {
      text: (p, s, m) => c.generateContentInModels([model], p, s, m),
      json: (p, s, m) => c.generateContentInModels([model], p, s, m),
    };
  }
  const g = c as GrokClient;
  return {
    text: (p, s, m) => g.generateContent(p, s, m),
    json: (p, s, m) => g.generateContentJSON(p, s, m),
  };
}

/**
 * Build the ordered execution chain for a TASK lane (content/reply/vision) from the
 * stored per-task chain, migrating from legacy single-chain fields when present,
 * else the task default. Returns [primary, ...fallbacks], de-duplicated.
 */
function chainForTask(ai: any, task: AITask): ChainStep[] {
  let raw: any = null;
  if (task === "content") raw = ai?.contentChain;
  else if (task === "reply") raw = ai?.replyChain;
  else if (task === "vision") raw = ai?.visionChain;

  // Legacy migration: derive a chain from the old flat fields if no per-task chain.
  if (!raw) {
    if (task === "vision" && ai?.aiVisionProvider) {
      raw = { provider: ai.aiVisionProvider, model: ai.aiVisionModel, fallbacks: ai.aiVisionFallbacks ?? [] };
    } else if (task !== "vision" && ai?.aiProvider) {
      // Legacy "grok" maps to "groq" via normalizeProvider inside coerceChain.
      raw = { provider: ai.aiProvider, model: ai.aiModel, fallbacks: ai.aiFallbacks ?? [] };
    }
  }
  const chain: Chain = coerceChain(task, raw ?? undefined);
  return chainSteps(chain);
}

/**
 * Returns the active AI client (PRIMARY provider+model) for a TASK lane. Used by the
 * provider-level methods (comment/DM replies = "reply", topic gen = "content", etc.).
 * Falls back down the lane's chain if the primary's key is missing, then to Groq env.
 */
export async function getAIClient(task: AITask = "content", brandId?: string | null): Promise<AIClient> {
  const ai = await readAi(brandId);
  for (const step of chainForTask(ai, task)) {
    const c = clientInstance(step.provider, step.model, ai);
    if (c) return c;
  }
  console.warn(`[AIFactory] No provider key for task "${task}" — using Groq env client`);
  return getGrokClient();
}

/**
 * Resilient plain-text generation across the operator's configured chain
 * (primary → fallbacks) for a task lane. Returns the first non-empty result that
 * passes `validate`; if none passes, the best non-empty result; throws only if
 * EVERY tier fails.
 */
export async function generateTextResilient(
  prompt: string,
  system: string,
  maxTokens = 2000,
  validate?: (text: string) => boolean,
  brandId?: string | null,
  task: AITask = "content",
): Promise<string> {
  const ai    = await readAi(brandId);
  const chain = chainForTask(ai, task);

  let lastErr: unknown;
  let bestNonEmpty = "";
  for (let i = 0; i < chain.length; i++) {
    const step   = chain[i];
    const runner = makeRunner(step.provider, step.model, ai);
    if (!runner) { console.warn(`[AIFactory] skip ${step.provider}/${step.model} — no API key`); continue; }
    try {
      const out = await runner.text(prompt, system, maxTokens);
      if (out && out.trim().length > 0) {
        if (!validate || validate(out)) {
          if (i > 0) console.log(`[AIFactory] text served by fallback: ${step.provider}/${step.model}`);
          return out;
        }
        if (!bestNonEmpty) bestNonEmpty = out;
        console.warn(`[AIFactory] ${step.provider}/${step.model} failed quality gate — trying next`);
      }
    } catch (err: any) {
      lastErr = err;
      console.warn(`[AIFactory] ${step.provider}/${step.model} failed:`, err?.message ?? err);
    }
  }
  if (bestNonEmpty) return bestNonEmpty;
  throw lastErr ?? new Error("[AIFactory] all text tiers failed");
}

/**
 * Resilient JSON generation across the configured chain for a task lane. A tier's
 * result is accepted only if, after stripping ```json fences, it starts with { or [.
 * Returns a RAW JSON string (caller parses), the best non-empty raw string if none
 * look like JSON, or "".
 */
export async function generateJSONResilient(
  prompt: string,
  system: string,
  maxTokens = 2000,
  brandId?: string | null,
  task: AITask = "content",
): Promise<string> {
  const ai    = await readAi(brandId);
  const chain = chainForTask(ai, task);

  const looksLikeJSON = (raw: string): boolean => {
    const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
    return cleaned.startsWith("{") || cleaned.startsWith("[");
  };

  let bestNonEmpty = "";
  for (let i = 0; i < chain.length; i++) {
    const step   = chain[i];
    const runner = makeRunner(step.provider, step.model, ai);
    if (!runner) { console.warn(`[AIFactory] skip ${step.provider}/${step.model} — no API key`); continue; }
    try {
      const out = await runner.json(prompt, system, maxTokens);
      if (out && out.trim().length > 0) {
        if (looksLikeJSON(out)) {
          if (i > 0) console.log(`[AIFactory] JSON served by fallback: ${step.provider}/${step.model}`);
          return out;
        }
        if (!bestNonEmpty) bestNonEmpty = out;
        console.warn(`[AIFactory] ${step.provider}/${step.model} returned non-JSON — trying next`);
      }
    } catch (err: any) {
      console.warn(`[AIFactory] JSON tier ${step.provider}/${step.model} failed:`, err?.message ?? err);
    }
  }
  return bestNonEmpty;
}

// ─────────────────────────────────────────────────────────────────────────────
// VISION — configurable image/video analysis chain (Settings → AI Config → Vision)
// ─────────────────────────────────────────────────────────────────────────────

/** Brand context supplied by the caller so the vision prompt stays niche-neutral. */
export interface VisionContext {
  /** Content niche, e.g. from BrandConfig.niche. */
  niche?:       string;
  /** Target audience description, e.g. BrandConfig.audience. */
  audience?:    string;
  /** @handle for CTA copy, e.g. atHandle(brand). */
  handle?:      string;
  /** Post-type instruction (what kind of caption to write). */
  instruction?: string;
  /** Human-readable label for the post type. */
  typeLabel?:   string;
}

function buildVisionPrompt(postType: string, ctx: VisionContext): string {
  const niche       = ctx.niche       || "social media";
  const audience    = ctx.audience    || "this account's followers";
  const label       = ctx.typeLabel   || postType;
  const instruction = ctx.instruction ||
    "Write an engaging caption with a bold hook, 3-4 lines of genuine insight from what you see, and a save/share CTA (150-220 words).";

  return `You are a world-class ${niche} content creator analysing this image/video for a ${label} post.

Post type: ${postType}
Audience: ${audience}
Instructions: ${instruction}

Rules:
- Write specifically about what you actually SEE in this image/video — real details, not generic filler.
- If it's a reel/video: describe what is being demonstrated.
- Start with a HOOK line that stops the scroll. Use line breaks between sections.
- NO hashtags in the caption text. No asterisks/markdown. End with a strong CTA${ctx.handle ? ` (you may reference ${ctx.handle})` : ""}.

After the caption, output exactly 4 relevant Instagram hashtags starting with #.
Return ONLY valid JSON: { "caption": "...", "hashtags": ["#tag1","#tag2","#tag3","#tag4"] }`;
}

/**
 * Analyse an image/video (base64) into a caption + hashtags, walking the operator's
 * configured VISION chain (primary → fallbacks). Returns null if all tiers fail.
 * Video is routed only to providers that support it (Gemini).
 *
 * `ctx` supplies niche-neutral brand context (niche/audience/handle/instruction)
 * so the prompt carries the operator's brand rather than any hardcoded vertical.
 */
export async function analyzeMediaResilient(
  data: string,
  mimeType: string,
  postType: string,
  brandId?: string | null,
  ctx: VisionContext = {},
): Promise<{ caption: string; hashtags: string[] } | null> {
  const ai    = await readAi(brandId);
  const chain = chainForTask(ai, "vision");
  const norm  = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  const isVideo = norm.startsWith("video/");
  const prompt  = buildVisionPrompt(postType, ctx);

  const parse = (raw: string): { caption: string; hashtags: string[] } | null => {
    try {
      const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(match ? match[0] : cleaned);
      if (!obj?.caption) return null;
      return {
        caption:  String(obj.caption).trim(),
        hashtags: (Array.isArray(obj.hashtags) ? obj.hashtags : []).map((h: string) => (String(h).startsWith("#") ? h : `#${h}`)).slice(0, 4),
      };
    } catch { return null; }
  };

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (isVideo && !providerSupportsVideo(step.provider)) {
      console.warn(`[AIFactory/vision] skip ${step.provider} — no video support`);
      continue;
    }
    const key = keyFor(step.provider, ai);
    if (!key) { console.warn(`[AIFactory/vision] skip ${step.provider}/${step.model} — no API key`); continue; }
    try {
      let raw = "";
      if (step.provider === "gemini") {
        raw = await new GeminiClient(key).visionRaw(step.model, data, norm, prompt);
      } else {
        const baseURL = step.provider === "cerebras" ? CEREBRAS_BASE : (process.env.GROK_API_URL || undefined);
        raw = await new GrokClient(key, { baseURL, model: step.model }).visionRaw(step.model, data, norm, prompt);
      }
      const parsed = parse(raw);
      if (parsed) {
        if (i > 0) console.log(`[AIFactory/vision] served by fallback: ${step.provider}/${step.model}`);
        return parsed;
      }
      console.warn(`[AIFactory/vision] ${step.provider}/${step.model} returned no usable caption — trying next`);
    } catch (err: any) {
      console.warn(`[AIFactory/vision] ${step.provider}/${step.model} failed:`, err?.message ?? err);
    }
  }
  return null;
}
