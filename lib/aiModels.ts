/**
 * lib/aiModels.ts
 *
 * Single source of truth for AI providers + their selectable models. Pure constants
 * (no imports) so it can be imported by BOTH the client Settings UI and the server
 * (ai-factory, the /api/settings/ai route). Keep it dependency-free.
 */

export const AI_PROVIDERS = ["groq", "cerebras", "gemini"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export interface ProviderCatalog {
  label:   string;
  models:  string[];
  /** How the API key is supplied. */
  keyEnv:  string;
  /** Whether a key can also be stored in Settings (DB). */
  dbKey:   boolean;
}

export const MODEL_CATALOG: Record<AIProvider, ProviderCatalog> = {
  groq: {
    label:  "Groq",
    keyEnv: "GROK_API_KEY",
    dbKey:  false,
    models: [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
    ],
  },
  cerebras: {
    label:  "Cerebras",
    keyEnv: "CEREBRAS_API_KEY",
    dbKey:  true,
    models: [
      "gpt-oss-120b",
      "zai-glm-4.7",
      "gemma-4-31b",
    ],
  },
  gemini: {
    label:  "Gemini",
    keyEnv: "GEMINI_API_KEY",
    dbKey:  true,
    models: [
      "gemini-2.5-flash",
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite",
      "gemini-flash-latest",
      "gemini-flash-lite-latest",
      "gemini-3.1-pro-preview",
      "gemini-pro-latest",
      "gemma-4-31b-it",
      "gemma-4-26b-a4b-it",
    ],
  },
};

export const DEFAULT_MODEL: Record<AIProvider, string> = {
  groq:     "openai/gpt-oss-120b",
  cerebras: "gpt-oss-120b",
  gemini:   "gemini-2.5-flash",
};

/** Normalize legacy / loose provider values ("grok" → "groq") to a valid provider. */
export function normalizeProvider(p: unknown): AIProvider {
  const v = String(p ?? "").toLowerCase().trim();
  if (v === "grok" || v === "groq") return "groq";
  if (v === "cerebras") return "cerebras";
  if (v === "gemini" || v === "google") return "gemini";
  return "groq";
}

/**
 * Models the providers have shut down, mapped to their replacements. Groq retired
 * Llama 3.x/4, Qwen 2.5/3-32B, Gemma 2 and friends in 2026; Google retired the
 * Gemini 2.0 family, 2.5 Flash-Lite, 2.5 Pro and 3 Pro Preview. Chains saved before
 * then would otherwise fail on every step that names one of them.
 */
export const RETIRED_MODELS: Record<string, string> = {
  "llama-3.3-70b-versatile":                        "openai/gpt-oss-120b",
  "llama-3.1-8b-instant":                           "openai/gpt-oss-20b",
  "llama3-70b-8192":                                "openai/gpt-oss-120b",
  "llama3-8b-8192":                                 "openai/gpt-oss-20b",
  "gemma2-9b-it":                                   "openai/gpt-oss-20b",
  "deepseek-r1-distill-llama-70b":                  "openai/gpt-oss-120b",
  "qwen-2.5-32b":                                   "qwen/qwen3.8-27b",
  "qwen-2.5-coder-32b":                             "openai/gpt-oss-120b",
  "qwen/qwen3-32b":                                 "qwen/qwen3.8-27b",
  "qwen/qwen3.6-27b":                               "qwen/qwen3.8-27b",
  "mistral-saba-24b":                               "openai/gpt-oss-20b",
  "allam-2-7b":                                     "openai/gpt-oss-20b",
  "meta-llama/llama-4-scout-17b-16e-instruct":      "qwen/qwen3.8-27b",
  "meta-llama/llama-4-maverick-17b-128e-instruct":  "qwen/qwen3.8-27b",
  "gemini-2.0-flash":                               "gemini-flash-latest",
  "gemini-2.0-flash-lite":                          "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite":                          "gemini-flash-lite-latest",
  "gemini-2.5-pro":                                 "gemini-pro-latest",
  "gemini-3-pro-preview":                           "gemini-3.1-pro-preview",
};

/** A model ID with any retired model swapped for its replacement. */
export function currentModel(model: string): string {
  return RETIRED_MODELS[model] ?? model;
}

/**
 * gpt-oss reasons before it answers, and that reasoning counts against max_tokens —
 * at short budgets it can spend every token and return empty content. Low effort
 * keeps it quick. (Only Groq's "openai/" IDs; Cerebras names it plain "gpt-oss-120b".)
 */
export function groqReasoningOpts(model: string): { reasoning_effort?: "low" } {
  return model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {};
}

/** Pick a valid model for a provider — the given one if known, else the provider default. */
export function resolveModel(provider: AIProvider, model: unknown): string {
  const m = currentModel(String(model ?? "").trim());
  if (m && MODEL_CATALOG[provider].models.includes(m)) return m;
  return m || DEFAULT_MODEL[provider]; // allow custom strings, else default
}

export interface ChainStep { provider: AIProvider; model: string; }

/** Default fallback chain used when the user hasn't configured one. */
export const DEFAULT_FALLBACKS: ChainStep[] = [
  { provider: "cerebras", model: DEFAULT_MODEL.cerebras },
  { provider: "gemini",   model: DEFAULT_MODEL.gemini },
];

/* ─── VISION (image / video understanding) ──────────────────────────────────
 * Only multimodal models. Gemini handles images AND video; Groq's
 * llama-4 handles IMAGES only (the dispatcher skips it for video).
 */
// Vision providers only — Cerebras is omitted (its models here are text-only).
export const VISION_CATALOG: Partial<Record<AIProvider, ProviderCatalog>> = {
  gemini: {
    label:  "Gemini",
    keyEnv: "GEMINI_API_KEY",
    dbKey:  true,
    models: ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-flash-latest"],
  },
  groq: {
    label:  "Groq",
    keyEnv: "GROK_API_KEY",
    dbKey:  false,
    models: ["qwen/qwen3.8-27b"],
  },
};

/** Providers that can do vision (have a VISION_CATALOG entry). */
export const VISION_PROVIDERS = Object.keys(VISION_CATALOG) as AIProvider[];

export const VISION_DEFAULT_MODEL: Record<AIProvider, string> = {
  gemini:   "gemini-2.5-flash",
  groq:     "qwen/qwen3.8-27b",
  cerebras: "gemini-2.5-flash", // unused — cerebras has no vision model
};

/** Resolve a vision model: the given one if known, else the provider's vision default. */
export function resolveVisionModel(provider: AIProvider, model: unknown): string {
  const cat = VISION_CATALOG[provider];
  const m   = currentModel(String(model ?? "").trim());
  if (!cat) return VISION_DEFAULT_MODEL.gemini;          // non-vision provider → Gemini default
  if (m && cat.models.includes(m)) return m;
  return m || cat.models[0] || VISION_DEFAULT_MODEL.gemini;
}

/** Provider can do VIDEO (not just images)? Only Gemini today. */
export function providerSupportsVideo(provider: AIProvider): boolean {
  return provider === "gemini";
}

export const DEFAULT_VISION_PROVIDER: AIProvider = "gemini";
export const DEFAULT_VISION_FALLBACKS: ChainStep[] = [
  { provider: "groq", model: "qwen/qwen3.8-27b" },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * PER-TASK CHAINS
 * The app routes three task lanes, each with its own primary provider+model and
 * an ordered fallback chain:
 *   • content  — post/caption/hook generation
 *   • reply    — DM + comment auto-replies
 *   • vision   — image/video analysis (Gemini/Groq only)
 * ═══════════════════════════════════════════════════════════════════════════ */

export const AI_TASKS = ["content", "reply", "vision"] as const;
export type AITask = (typeof AI_TASKS)[number];

/** Gemini split into FLASH (fast) and REASONING (slow/think) — used to seed the
 *  "flash → grok → reasoning" Gemini chain. */
export const GEMINI_FLASH_MODELS:     string[] = ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"];
export const GEMINI_REASONING_MODELS: string[] = ["gemini-3.1-pro-preview", "gemini-pro-latest"];

export interface Chain { provider: AIProvider; model: string; fallbacks: ChainStep[]; }

/** Flatten a Chain to an ordered, de-duplicated [primary, ...fallbacks] list. */
export function chainSteps(chain: Chain): ChainStep[] {
  const out: ChainStep[] = [];
  const seen = new Set<string>();
  for (const s of [{ provider: chain.provider, model: chain.model }, ...(chain.fallbacks ?? [])]) {
    const k = `${s.provider}|${s.model}`;
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

/** Default CONTENT/REPLY chain for a primary provider, per the configured templates:
 *  - gemini   → gemini FLASH models, then GROK, then gemini REASONING models
 *  - groq     → grok, then cross-provider defaults (cerebras → gemini)
 *  - cerebras → cerebras models, then grok models
 */
export function defaultChainFor(provider: AIProvider): Chain {
  if (provider === "gemini") {
    return {
      provider: "gemini",
      model:    "gemini-2.5-flash",
      fallbacks: [
        { provider: "gemini", model: "gemini-3.5-flash" },
        { provider: "gemini", model: "gemini-3.1-flash-lite" },
        { provider: "groq",   model: "openai/gpt-oss-120b" }, // grok BEFORE reasoning
        { provider: "gemini", model: "gemini-3.1-pro-preview" },
        { provider: "gemini", model: "gemini-pro-latest" },
      ],
    };
  }
  if (provider === "cerebras") {
    return {
      provider: "cerebras",
      model:    "gpt-oss-120b",
      fallbacks: [
        { provider: "cerebras", model: "zai-glm-4.7" },
        { provider: "cerebras", model: "gemma-4-31b" },
        { provider: "groq",     model: "openai/gpt-oss-120b" },
        { provider: "groq",     model: "openai/gpt-oss-20b" },
      ],
    };
  }
  // groq — cross-provider defaults so a Groq outage never guts the chain
  // (steps whose provider has no API key are skipped at runtime by the chain walker)
  return { provider: "groq", model: "openai/gpt-oss-120b", fallbacks: [...DEFAULT_FALLBACKS] };
}

/** Default VISION chain for a primary provider (gemini/groq only). */
export function defaultVisionChainFor(provider: AIProvider): Chain {
  if (provider === "groq") {
    return {
      provider: "groq",
      model:    "qwen/qwen3.8-27b",
      fallbacks: [{ provider: "gemini", model: "gemini-flash-latest" }],
    };
  }
  return {
    provider: "gemini",
    model:    "gemini-2.5-flash",
    fallbacks: [{ provider: "groq", model: "qwen/qwen3.8-27b" }],
  };
}

export const TASK_DEFAULT_PROVIDER: Record<AITask, AIProvider> = {
  content: "groq",
  reply:   "groq",
  vision:  "gemini",
};

/** Resolve a model for a task lane (vision uses the vision catalog). */
export function resolveTaskModel(task: AITask, provider: AIProvider, model: unknown): string {
  return task === "vision" ? resolveVisionModel(provider, model) : resolveModel(provider, model);
}

/** Build a validated Chain from loose stored data for a given task. */
export function coerceChain(task: AITask, raw: any): Chain {
  const isVision = task === "vision";
  const fallbackDefault = isVision ? defaultVisionChainFor(TASK_DEFAULT_PROVIDER.vision) : defaultChainFor(TASK_DEFAULT_PROVIDER[task]);
  if (!raw || typeof raw !== "object") return fallbackDefault;
  let provider = normalizeProvider(raw.provider);
  if (isVision && !VISION_PROVIDERS.includes(provider)) provider = "gemini";
  const model = resolveTaskModel(task, provider, raw.model);
  const fbsRaw: any[] = Array.isArray(raw.fallbacks) ? raw.fallbacks : [];
  const seen = new Set<string>([`${provider}|${model}`]);
  const fallbacks: ChainStep[] = [];
  for (const f of fbsRaw) {
    let p = normalizeProvider(f?.provider);
    if (isVision && !VISION_PROVIDERS.includes(p)) continue; // skip non-vision providers in vision chain
    const m = resolveTaskModel(task, p, f?.model);
    const k = `${p}|${m}`;
    if (seen.has(k)) continue;
    seen.add(k);
    fallbacks.push({ provider: p, model: m });
    if (fallbacks.length >= 8) break;
  }
  return { provider, model, fallbacks };
}
