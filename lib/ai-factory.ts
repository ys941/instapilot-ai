/**
 * lib/ai-factory.ts
 *
 * Returns the active AI client (Grok or Gemini) based on the user's
 * saved preference (aiProvider in the AI Config settings tab).
 *
 * Usage (everywhere that currently imports getGrokClient):
 *
 *   import { getAIClient } from "@/lib/ai-factory";
 *   const ai = await getAIClient();
 *   const reply = await ai.generateCommentReply(...);
 */

import { GrokClient, getGrokClient } from "@/lib/grok";
import { GeminiClient } from "@/lib/gemini";
import { readPreferences, readPreferencesForBrand } from "@/lib/preferences";

export type AIClient = GrokClient | GeminiClient;

/**
 * Read preferences for a specific brand when a brandId is supplied, else the
 * primary/global singleton. This makes the AI provider/key per-brand: a secondary
 * brand configured for Gemini no longer silently generates with the primary's
 * provider. Falls back to the global prefs if the brand read fails. Passing no
 * brandId preserves the exact previous (primary-only) behavior.
 */
async function readPrefsFor(brandId?: string | null) {
  if (brandId) {
    try { return await readPreferencesForBrand(brandId); } catch { /* fall through to global */ }
  }
  return readPreferences();
}

/**
 * Returns the active AI client.
 * Reads preferences from DB so changes in Settings take effect on next call.
 * Gemini API key: env var GEMINI_API_KEY takes priority; DB value is fallback.
 * Falls back to Grok if Gemini key is missing.
 */
export async function getAIClient(brandId?: string | null): Promise<AIClient> {
  try {
    const prefs      = await readPrefsFor(brandId);
    const ai         = prefs.ai as any;
    const provider   = ai.aiProvider ?? "grok";

    if (provider === "gemini") {
      // Priority: env var > DB stored key
      const apiKey = (process.env.GEMINI_API_KEY?.trim()) || (ai.geminiApiKey?.trim() ?? "");
      if (apiKey) {
        return new GeminiClient(apiKey);
      }
      console.warn("[AIFactory] aiProvider=gemini but no GEMINI_API_KEY found — falling back to Grok");
    }
  } catch (err) {
    console.warn("[AIFactory] Could not read preferences:", String(err));
  }
  return getGrokClient();
}

/** Build a GeminiClient if a key is available (env > DB), else null. */
async function maybeGemini(brandId?: string | null): Promise<GeminiClient | null> {
  try {
    const prefs  = await readPrefsFor(brandId);
    const ai     = prefs.ai as any;
    const apiKey = (process.env.GEMINI_API_KEY?.trim()) || (ai?.geminiApiKey?.trim() ?? "");
    return apiKey ? new GeminiClient(apiKey) : null;
  } catch {
    const envKey = process.env.GEMINI_API_KEY?.trim();
    return envKey ? new GeminiClient(envKey) : null;
  }
}

async function selectedProvider(brandId?: string | null): Promise<"gemini" | "grok"> {
  try {
    const prefs = await readPrefsFor(brandId);
    const p = (prefs.ai as any)?.aiProvider ?? "grok";
    if (p === "gemini") {
      const key = (process.env.GEMINI_API_KEY?.trim()) || ((prefs.ai as any)?.geminiApiKey?.trim() ?? "");
      if (key) return "gemini";
    }
  } catch { /* fall through */ }
  return "grok";
}

/**
 * Resilient plain-text generation with the tier order the owner wants for
 * captions/hooks:
 *
 *   Gemini FLASH models → GROK → Gemini REASONING/"thinking" models
 *
 * The slow, "think-out-loud" reasoning models (gemini-2.5-pro, gemma) truncate
 * and muddy captions, so Grok (fast, reliable, clean) is tried BEFORE them — and
 * the reasoning tier is only the very last resort. When Grok is the SELECTED
 * provider it leads, then Gemini flash, then Gemini reasoning. Returns the first
 * non-empty result; throws only if EVERY tier fails (caller then uses its own
 * deterministic fallback).
 */
export async function generateTextResilient(
  prompt: string,
  system: string,
  maxTokens = 2000,
  /**
   * Optional QUALITY gate. A tier's output is only ACCEPTED if validate(out)
   * returns true; otherwise the next tier is tried. This is critical: a Gemini
   * flash model can return a NON-EMPTY but TRUNCATED result (its internal
   * "thinking" eats the token budget) — without this check that truncated text
   * was accepted and Grok was never reached. With it, a bad flash result falls
   * through to Grok (then reasoning). If NO tier passes, the best non-empty
   * result is returned so the caller can apply its own deterministic fallback.
   */
  validate?: (text: string) => boolean,
  /** When set, selects the AI provider/key for THIS brand (else primary/global). */
  brandId?: string | null,
): Promise<string> {
  const provider = await selectedProvider(brandId);
  const gemini   = await maybeGemini(brandId);

  const tiers: Array<{ name: string; run: () => Promise<string> }> = [];
  const grokTier      = { name: "grok",             run: () => getGrokClient().generateContent(prompt, system, maxTokens) };
  const flashTier     = gemini ? { name: "gemini-flash",     run: () => gemini.generateContentFlash(prompt, system, maxTokens) }     : null;
  const reasoningTier = gemini ? { name: "gemini-reasoning", run: () => gemini.generateContentReasoning(prompt, system, maxTokens) } : null;

  if (provider === "gemini") {
    if (flashTier) tiers.push(flashTier);   // 1. Gemini flash
    tiers.push(grokTier);                    // 2. Grok (before reasoning)
    if (reasoningTier) tiers.push(reasoningTier); // 3. Gemini reasoning (last)
  } else {
    tiers.push(grokTier);                    // 1. Grok (selected)
    if (flashTier) tiers.push(flashTier);    // 2. Gemini flash
    if (reasoningTier) tiers.push(reasoningTier); // 3. Gemini reasoning (last)
  }

  let lastErr: unknown;
  let bestNonEmpty = "";
  for (const t of tiers) {
    try {
      const out = await t.run();
      if (out && out.trim().length > 0) {
        if (!validate || validate(out)) {
          if (t.name !== tiers[0].name) console.log(`[AIFactory] text served by tier: ${t.name}`);
          return out;
        }
        // Non-empty but failed the quality gate (e.g. truncated/dangling) — keep it
        // as a last-ditch option and TRY THE NEXT TIER (this is what lets Grok run
        // when a flash model returns a truncated result).
        if (!bestNonEmpty) bestNonEmpty = out;
        console.warn(`[AIFactory] tier ${t.name} output failed quality gate — trying next tier`);
      }
    } catch (err: any) {
      lastErr = err;
      console.warn(`[AIFactory] tier ${t.name} failed:`, err?.message ?? err);
    }
  }
  if (bestNonEmpty) return bestNonEmpty; // no tier passed the gate — caller validates/falls back
  throw lastErr ?? new Error("[AIFactory] all text tiers failed");
}

/**
 * Resilient JSON generation — the JSON analogue of generateTextResilient.
 *
 * The Gemini-only JSON path (gemini.ts#generateContentJSON) walks just the Gemini
 * model chain and, when EVERY model 429s (free quota fully exhausted, limit:0),
 * returns "" without ever trying Grok — so callers ship canned filler. This wrapper
 * tiers Gemini JSON ↔ Grok JSON the same way generateTextResilient tiers text.
 *
 * Tiers:
 *   provider "gemini" → [Gemini JSON, Grok JSON]
 *   otherwise         → [Grok JSON,  Gemini JSON]
 *
 * A tier's result is ACCEPTED only if it's non-empty AND, after stripping
 * ```json / ``` fences and trimming, it STARTS WITH `{` or `[` (looks like JSON).
 * The first acceptable RAW string is returned un-stripped (callers already strip).
 * If no tier passes, the best non-empty raw string is returned; else "".
 *
 * Returns a RAW JSON string (caller parses), or "" if all tiers fail.
 */
export async function generateJSONResilient(
  prompt: string,
  system: string,
  maxTokens = 2000,
  /** When set, selects the AI provider/key for THIS brand (else primary/global). */
  brandId?: string | null,
): Promise<string> {
  const provider = await selectedProvider(brandId);
  const gemini   = await maybeGemini(brandId);

  // A raw model reply "looks like JSON" if, after fence-strip + trim, it starts
  // with { or [. Same fence-strip pattern used by gemini.ts#parseJson.
  const looksLikeJSON = (raw: string): boolean => {
    const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
    return cleaned.startsWith("{") || cleaned.startsWith("[");
  };

  const tiers: Array<{ name: string; run: () => Promise<string> }> = [];
  const grokTier   = { name: "grok-json",   run: () => getGrokClient().generateContentJSON(prompt, system, maxTokens) };
  const geminiTier = gemini ? { name: "gemini-json", run: () => gemini.generateContentJSON(prompt, system, maxTokens) } : null;

  if (provider === "gemini") {
    if (geminiTier) tiers.push(geminiTier); // 1. Gemini JSON
    tiers.push(grokTier);                    // 2. Grok JSON
  } else {
    tiers.push(grokTier);                    // 1. Grok JSON (selected)
    if (geminiTier) tiers.push(geminiTier);  // 2. Gemini JSON
  }

  let bestNonEmpty = "";
  for (const t of tiers) {
    try {
      const out = await t.run();
      if (out && out.trim().length > 0) {
        if (looksLikeJSON(out)) {
          if (t.name !== tiers[0].name) console.log(`[AIFactory] JSON served by tier: ${t.name}`);
          return out; // raw, un-stripped — callers already strip fences
        }
        // Non-empty but not JSON-shaped — keep as a last-ditch option, try next tier.
        if (!bestNonEmpty) bestNonEmpty = out;
        console.warn(`[AIFactory] tier ${t.name} returned non-JSON output — trying next tier`);
      }
    } catch (err: any) {
      // 429/throw — advance to the next tier (this is what lets Grok run when
      // every Gemini model is rate-limited).
      console.warn(`[AIFactory] JSON tier ${t.name} failed:`, err?.message ?? err);
    }
  }
  return bestNonEmpty; // "" if no tier produced anything — caller falls back
}
