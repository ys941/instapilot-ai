/**
 * POST /api/ai/setup — AI Brand Setup wizard (Settings → AI Setup).
 *
 * A user describes the brand they want; Groq (via the content chain) first asks
 * the tailored questions it needs, then generates the whole brand config. This
 * app is DUAL-PLATFORM: a "brand" pairs an Instagram account with a YouTube
 * channel, so the generated config carries BOTH the IG @handle and the YouTube
 * @handle + channel name, plus a dual-follow CTA.
 *
 * Stages (body `{ stage, description, answers? }`):
 *   - "questions" → { questions: [{ id, label, hint, type, options? }] }  (~6-10)
 *   - "generate"  → maps a constrained AI config onto the REAL preferences shape
 *                   and returns a PREVIEW. Does NOT persist.
 *   - "apply"     → persists the reviewed config via writePreferencesForBrand.
 *
 * White-label HARD rule: niche-neutral. Nothing about any specific vertical is
 * hardcoded — the module works for ANY niche the user types.
 *
 * Provider: Groq-first content chain (getAIClient/generateJSONResilient
 * "content" lane), so it honors the per-task AI Config + falls back.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession, authOptions } from "@/lib/auth";
import { generateJSONResilient } from "@/lib/ai-factory";
import { readPreferencesForBrand, writePreferencesForBrand } from "@/lib/preferences";
import { getBrand } from "@/lib/preferences";
import { resolveBrandId } from "@/lib/brands";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";
import {
  BrandConfig, ContentTypeId, DEFAULT_CONTENT_TYPES,
} from "@/lib/brandConfig";
import { AllPreferences } from "@/lib/preferences";

// ── constants ────────────────────────────────────────────────────────────────

/** The real content-type enum ids (stable, internal). AI ids resolve against these. */
const CONTENT_TYPE_IDS = Object.keys(DEFAULT_CONTENT_TYPES) as ContentTypeId[];
const CONTENT_TYPE_ID_SET = new Set<string>(CONTENT_TYPE_IDS);

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A niche-neutral fallback question set used when the AI returns junk. */
const FALLBACK_QUESTIONS: SetupQuestion[] = [
  { id: "brandName",   label: "Brand / app name",           hint: "What should this account be called?",                    type: "text" },
  { id: "niche",       label: "Niche / topic",              hint: "e.g. home cooking, personal finance, fitness",           type: "text" },
  { id: "audience",    label: "Who is it for?",             hint: "Describe your target audience in a sentence",            type: "text" },
  { id: "voice",       label: "Persona & voice",            hint: "Who is speaking, and how do they sound?",                type: "text" },
  { id: "tone",        label: "Default tone",               hint: "Pick the writing tone",   type: "select", options: ["Friendly", "Professional", "Educational", "Bold", "Playful", "Inspirational"] },
  { id: "language",    label: "Content language",           hint: "e.g. English, Hindi, Spanish",                           type: "text" },
  { id: "igHandle",    label: "Instagram @handle",          hint: "Without the @",                                          type: "text" },
  { id: "ytHandle",    label: "YouTube @handle",            hint: "Without the @",                                          type: "text" },
  { id: "ytChannel",   label: "YouTube channel name",       hint: "The channel's display name",                             type: "text" },
  { id: "postsPerDay", label: "Posts per day",              hint: "How many posts per day?", type: "select", options: ["1", "2", "3"] },
  { id: "days",        label: "Publishing days",            hint: "Which days do you want to post?", type: "chips", options: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  { id: "topics",      label: "Topic seeds",                hint: "A few topics to start rotating (comma separated)",       type: "text" },
];

// ── types ────────────────────────────────────────────────────────────────────

type QuestionType = "text" | "select" | "chips";

interface SetupQuestion {
  id: string;
  label: string;
  hint: string;
  type: QuestionType;
  options?: string[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Extract the first {...} JSON block from a raw model string and parse it. */
function parseJSONBlock(raw: string): any {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match ? match[0] : cleaned);
  } catch {
    return null;
  }
}

function clampStr(v: unknown, max: number, fallback = ""): string {
  if (typeof v !== "string") return fallback;
  return v.trim().slice(0, max);
}

function cleanHandle(v: unknown, max = 60): string {
  if (typeof v !== "string") return "";
  return v.trim().replace(/^@+/, "").slice(0, max);
}

/** Coerce one AI-returned question into a valid SetupQuestion, or null. */
function coerceQuestion(raw: any, idx: number): SetupQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const label = clampStr(raw.label, 120);
  if (!label) return null;
  const type: QuestionType =
    raw.type === "select" || raw.type === "chips" ? raw.type : "text";
  const id = clampStr(raw.id, 40) || `q${idx}`;
  const q: SetupQuestion = {
    id,
    label,
    hint: clampStr(raw.hint, 200),
    type,
  };
  if ((type === "select" || type === "chips") && Array.isArray(raw.options)) {
    const opts = raw.options
      .filter((o: unknown): o is string => typeof o === "string" && o.trim().length > 0)
      .map((o: string) => o.trim().slice(0, 80))
      .slice(0, 12);
    if (opts.length) q.options = opts;
  }
  // A select/chips without usable options degrades to text (still answerable).
  if ((q.type === "select" || q.type === "chips") && !q.options) q.type = "text";
  return q;
}

const WEEKDAY_MAP: Record<string, number> = {
  sun: 0, sunday: 0, "0": 0,
  mon: 1, monday: 1, "1": 1,
  tue: 2, tues: 2, tuesday: 2, "2": 2,
  wed: 3, weds: 3, wednesday: 3, "3": 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, "4": 4,
  fri: 5, friday: 5, "5": 5,
  sat: 6, saturday: 6, "6": 6,
};

/** Coerce a days array (numbers or names) into a sorted 0-6 unique list. */
function coerceDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const item of raw) {
    if (typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 6) {
      out.add(item);
    } else if (typeof item === "string") {
      const d = WEEKDAY_MAP[item.trim().toLowerCase()];
      if (d !== undefined) out.add(d);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Keep only valid HH:MM strings, de-duped + sorted. */
function coerceTimes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(raw.filter((t): t is string => typeof t === "string" && HHMM_RE.test(t))),
  ).sort();
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Build a compact "here's what the user already told us" block for the prompt. */
function answersBlock(answers: Record<string, string> | undefined): string {
  if (!answers || typeof answers !== "object") return "(none)";
  const lines = Object.entries(answers)
    .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
    .map(([k, v]) => `- ${k}: ${String(v).trim().slice(0, 400)}`);
  return lines.length ? lines.join("\n") : "(none)";
}

// ── prompts ──────────────────────────────────────────────────────────────────

const SETUP_SYSTEM = `You are a brand-setup assistant for a white-label, DUAL-PLATFORM social automation tool that posts to BOTH Instagram and YouTube. You help a user configure their whole brand from a short description. You are NICHE-NEUTRAL: you work for ANY topic the user names and never assume a specific vertical. Always respond with valid JSON only — no markdown, no preamble.`;

function questionsPrompt(description: string): string {
  return `The user wants to set up a new brand and described it as:
"""${description.slice(0, 2000)}"""

Generate 6 to 10 SHORT questions you need answered to fully configure this brand. Cover, as relevant to the description:
- niche/topic specifics and the target audience
- the persona/voice (who is speaking and how they sound) and the default writing tone
- the content language
- the Instagram @handle
- the YouTube @handle AND the YouTube channel display name
- how many posts per day (1-3) and which days of the week to publish
- which content types to enable, and a few topic seeds to start rotating

Tailor the questions to THIS description — skip anything the user already made obvious, and ask about specifics that matter for this niche.

Return ONLY this JSON shape:
{ "questions": [ { "id": "shortId", "label": "Question text", "hint": "one-line helper", "type": "text" | "select" | "chips", "options": ["only for select/chips"] } ] }

Rules:
- Every question needs a unique short id, a label, and a hint.
- Use "select" for single-choice (e.g. tone, posts/day), "chips" for multi-select (e.g. publishing days, content types), "text" otherwise.
- For content types, offer chips like: Educational, Quiz, Carousel, Myth vs Fact, Pro Tip, Story/Example, How-To/Tips, Call to Action, Reel, Story.
- Keep labels under 12 words. 6-10 questions total.`;
}

function generatePrompt(
  description: string,
  answers: Record<string, string> | undefined,
): string {
  const labelList = CONTENT_TYPE_IDS.map(
    (id) => `${id} (default label "${DEFAULT_CONTENT_TYPES[id].label}")`,
  ).join(", ");

  return `Configure a complete brand for a white-label DUAL-PLATFORM tool that posts to BOTH Instagram and YouTube.

USER DESCRIPTION:
"""${description.slice(0, 2000)}"""

USER ANSWERS:
${answersBlock(answers)}

Produce the brand config. Return ONLY this JSON shape (fill EVERY field; infer sensible values for anything the user did not specify — never leave a field blank, and never invent extra keys):
{
  "brand": {
    "appName": "the brand/app name",
    "niche": "the niche/topic in a few words",
    "persona": { "role": "who the persona is (one sentence)", "voice": "voice/tone notes for replies", "purpose": "one/two sentences on the account's purpose" },
    "audience": "who the content is for (one sentence)",
    "language": "content language, e.g. English",
    "defaultTone": "one of Friendly, Professional, Educational, Bold, Playful, Inspirational",
    "igHandle": "Instagram handle WITHOUT @",
    "ytHandle": "YouTube handle WITHOUT @",
    "ytChannelName": "YouTube channel display name",
    "dualFollowCTA": "a short 'follow us on both' call-to-action line"
  },
  "contentTypeLabels": { "TYPE_ID": "Renamed label" },
  "enabledTypes": ["TYPE_ID", "..."],
  "topics": ["8 to 15 topic seeds in this niche"],
  "schedule": { "scheduleDays": [0-6 weekday numbers, 0=Sun], "postTimes": ["HH:MM", "..."], "postsPerDay": 1-3 },
  "defaultPrompt": "a default content-generation instruction capturing this brand's voice + focus"
}

CONTENT TYPES — these are the ONLY valid TYPE_IDs (ignore any others): ${labelList}.
- "contentTypeLabels" may rename ONLY these ids to niche-appropriate labels (e.g. rename "Quiz" to something fitting). Do not add unknown ids.
- "enabledTypes" is the subset of these ids to turn on for this brand (pick the ones that fit the niche; 5-9 of them).

Constraints: postsPerDay 1-3; postTimes as "HH:MM" (24h); scheduleDays numbers 0-6; 8-15 topics; keep labels short.`;
}

// ── stage handlers ───────────────────────────────────────────────────────────

async function handleQuestions(
  description: string,
  brandId: string | null,
): Promise<SetupQuestion[]> {
  let questions: SetupQuestion[] = [];
  try {
    const raw = await generateJSONResilient(
      questionsPrompt(description),
      SETUP_SYSTEM,
      1800,
      brandId,
      "content",
    );
    const parsed = parseJSONBlock(raw);
    if (parsed && Array.isArray(parsed.questions)) {
      questions = parsed.questions
        .map((q: any, i: number) => coerceQuestion(q, i))
        .filter((q: SetupQuestion | null): q is SetupQuestion => q !== null)
        .slice(0, 10);
    }
  } catch {
    /* fall through to fallback */
  }
  // Need a healthy set; otherwise use the neutral fallback.
  if (questions.length < 4) return FALLBACK_QUESTIONS;
  return questions;
}

/** The mapped preview returned by "generate" and consumed by "apply". */
interface SetupPreview {
  brand: {
    appName: string;
    niche: string;
    purpose: string;
    audience: string;
    language: string;
    defaultTone: string;
    persona: { role: string; voice: string };
    igHandle: string;
    ytHandle: string;
    ytChannelName: string;
    dualFollowCTA: string;
  };
  contentTypes: Array<{ id: string; label: string; enabled: boolean }>;
  enabledTypes: string[];
  topics: string[];
  schedule: { scheduleDays: number[]; postTimes: string[]; postsPerDay: number };
  igDefaultPrompt: string;
  ytDefaultPrompt: string;
}

async function handleGenerate(
  description: string,
  answers: Record<string, string> | undefined,
  brandId: string | null,
): Promise<SetupPreview | null> {
  const raw = await generateJSONResilient(
    generatePrompt(description, answers),
    SETUP_SYSTEM,
    2600,
    brandId,
    "content",
  );
  const cfg = parseJSONBlock(raw);
  if (!cfg || typeof cfg !== "object") return null;

  const b = (cfg.brand && typeof cfg.brand === "object") ? cfg.brand : {};
  const persona = (b.persona && typeof b.persona === "object") ? b.persona : {};

  // Resolve content-type labels against the REAL enum; ignore unknown ids.
  const labelOverrides: Record<string, string> = {};
  if (cfg.contentTypeLabels && typeof cfg.contentTypeLabels === "object") {
    for (const [id, label] of Object.entries(cfg.contentTypeLabels)) {
      if (CONTENT_TYPE_ID_SET.has(id)) {
        const l = clampStr(label, 60);
        if (l) labelOverrides[id] = l;
      }
    }
  }

  const enabledFromAI = new Set<string>(
    (Array.isArray(cfg.enabledTypes) ? cfg.enabledTypes : [])
      .filter((id: unknown): id is string => typeof id === "string" && CONTENT_TYPE_ID_SET.has(id)),
  );

  const contentTypes = CONTENT_TYPE_IDS.map((id) => ({
    id,
    label: labelOverrides[id] || DEFAULT_CONTENT_TYPES[id].label,
    // If the AI provided an enabled set, honor it; else keep the built-in default.
    enabled: enabledFromAI.size > 0 ? enabledFromAI.has(id) : DEFAULT_CONTENT_TYPES[id].enabled,
  }));
  const enabledTypes = contentTypes.filter((c) => c.enabled).map((c) => c.id);

  const topics = (Array.isArray(cfg.topics) ? cfg.topics : [])
    .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t: string) => t.trim().slice(0, 200))
    .slice(0, 15);

  const sched = (cfg.schedule && typeof cfg.schedule === "object") ? cfg.schedule : {};
  const scheduleDays = coerceDays(sched.scheduleDays);
  const postTimes = coerceTimes(sched.postTimes);
  const postsPerDay = clampInt(sched.postsPerDay, 1, 3, 2);

  const igHandle = cleanHandle(b.igHandle);
  const ytHandle = cleanHandle(b.ytHandle);
  const ytChannelName = clampStr(b.ytChannelName, 100);
  const defaultPrompt = clampStr(cfg.defaultPrompt, 4000);

  // If the AI didn't give a dual-follow CTA, synthesize one from the handles.
  let cta = clampStr(b.dualFollowCTA, 200);
  if (!cta) {
    const parts: string[] = [];
    if (ytHandle) parts.push(`YouTube: @${ytHandle}`);
    if (igHandle) parts.push(`Instagram: @${igHandle}`);
    cta = parts.length ? `Follow us — ${parts.join("  •  ")}` : "Follow for more!";
  }

  return {
    brand: {
      appName: clampStr(b.appName, 80) || "Your Brand",
      niche: clampStr(b.niche, 120) || "your topic",
      purpose: clampStr(persona.purpose, 600) || clampStr(b.purpose, 600),
      audience: clampStr(b.audience, 300),
      language: clampStr(b.language, 40) || "English",
      defaultTone: clampStr(b.defaultTone, 40) || "Friendly",
      persona: {
        role: clampStr(persona.role, 200),
        voice: clampStr(persona.voice, 300),
      },
      igHandle,
      ytHandle,
      ytChannelName,
      dualFollowCTA: cta,
    },
    contentTypes,
    enabledTypes,
    topics,
    schedule: {
      scheduleDays: scheduleDays.length ? scheduleDays : [1, 2, 3, 4, 5],
      postTimes: postTimes.length ? postTimes : ["08:00", "19:00"],
      postsPerDay,
    },
    igDefaultPrompt: defaultPrompt,
    ytDefaultPrompt: defaultPrompt,
  };
}

/**
 * Map a (re-validated) preview onto the real preferences shape and persist it for
 * the brand. We re-derive the preview from description+answers on the server so a
 * client can't smuggle arbitrary values past the coercion; but we also accept a
 * client-provided `config` (the reviewed preview) as the source of truth when
 * present, re-sanitizing every field here.
 */
async function handleApply(
  config: any,
  brandId: string | null,
): Promise<AllPreferences> {
  const b = (config?.brand && typeof config.brand === "object") ? config.brand : {};
  const persona = (b.persona && typeof b.persona === "object") ? b.persona : {};
  const sched = (config?.schedule && typeof config.schedule === "object") ? config.schedule : {};

  // Re-sanitize content types against the real enum.
  const incomingTypes: Array<{ id: string; label: string; enabled: boolean }> =
    Array.isArray(config?.contentTypes) ? config.contentTypes : [];
  const typeById = new Map<string, { label: string; enabled: boolean }>();
  for (const t of incomingTypes) {
    if (t && typeof t === "object" && CONTENT_TYPE_ID_SET.has(t.id)) {
      typeById.set(t.id, {
        label: clampStr(t.label, 60) || DEFAULT_CONTENT_TYPES[t.id as ContentTypeId].label,
        enabled: t.enabled === true,
      });
    }
  }

  // Load current brand so we merge onto (not replace) untouched fields.
  const currentBrand = await getBrand(brandId);
  const mergedContentTypes: BrandConfig["contentTypes"] = { ...currentBrand.contentTypes };
  for (const id of CONTENT_TYPE_IDS) {
    const patch = typeById.get(id);
    if (patch) {
      mergedContentTypes[id] = {
        ...currentBrand.contentTypes[id],
        label: patch.label,
        enabled: patch.enabled,
      };
    }
  }

  const enabledTypeIds = CONTENT_TYPE_IDS.filter((id) => mergedContentTypes[id].enabled);

  const topics = (Array.isArray(config?.topics) ? config.topics : [])
    .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t: string) => t.trim().slice(0, 200))
    .slice(0, 20);

  const scheduleDays = coerceDays(sched.scheduleDays);
  const postTimes = coerceTimes(sched.postTimes);
  const postsPerDayIG = clampInt(sched.postsPerDay, 1, 3, 2);
  const postsPerDayYT = clampInt(sched.postsPerDay, 1, 5, 1);

  const igHandle = cleanHandle(b.igHandle);
  const ytHandle = cleanHandle(b.ytHandle);
  const ytChannelName = clampStr(b.ytChannelName, 100);
  const cta = clampStr(b.dualFollowCTA, 200);

  const defaultPromptIG = clampStr(config?.igDefaultPrompt, 4000);
  const defaultPromptYT = clampStr(config?.ytDefaultPrompt, 4000);

  // Build the brand skin patch.
  const brandPatch: Partial<BrandConfig> = {
    appName: clampStr(b.appName, 80) || currentBrand.appName,
    niche: clampStr(b.niche, 120) || currentBrand.niche,
    purpose: clampStr(persona.purpose ?? b.purpose, 600) || currentBrand.purpose,
    audience: clampStr(b.audience, 300) || currentBrand.audience,
    language: clampStr(b.language, 40) || currentBrand.language,
    defaultTone: clampStr(b.defaultTone, 40) || currentBrand.defaultTone,
    persona: {
      ...currentBrand.persona,
      handle: igHandle || currentBrand.persona.handle,
      role: clampStr(persona.role, 200) || currentBrand.persona.role,
      voice: clampStr(persona.voice, 300) || currentBrand.persona.voice,
    },
    youtube: {
      handle: ytHandle || currentBrand.youtube.handle,
      channelName: ytChannelName || currentBrand.youtube.channelName,
    },
    contentTypes: mergedContentTypes,
    topics: topics.length ? topics : currentBrand.topics,
    configured: true,
  };
  if (cta) brandPatch.commentCtaLine = cta;

  const effDays = scheduleDays.length ? scheduleDays : undefined;
  const effTimes = postTimes.length ? postTimes : undefined;

  const patch: Partial<AllPreferences> = {
    // deepMergeBrand (in writePreferences) merges this partial onto the full current
    // brand, so a Partial<BrandConfig> is safe here despite the full-shape type.
    brand: brandPatch as any,
    ai: {
      defaultTone: (brandPatch.defaultTone as string) || currentBrand.defaultTone,
      language: (brandPatch.language as string) || currentBrand.language,
    } as any,
    autoPost: {
      postTypes: enabledTypeIds,
      topics: topics.length ? topics : undefined,
      postsPerDay: postsPerDayIG,
      ...(effDays ? { scheduleDays: effDays } : {}),
      ...(effTimes ? { scheduleTimes: effTimes } : {}),
    } as any,
    youtube: {
      postTypes: enabledTypeIds,
      topics: topics.length ? topics : undefined,
      postsPerDay: postsPerDayYT,
      ...(effDays ? { scheduleDays: effDays } : {}),
      ...(effTimes ? { postTimes: effTimes } : {}),
    } as any,
    igDefaultPrompt: defaultPromptIG || undefined,
    ytDefaultPrompt: defaultPromptYT || undefined,
  };

  return writePreferencesForBrand(brandId, patch);
}

// ── route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
    }

    const stage = String((body as any).stage ?? "");
    const description = clampStr((body as any).description, 2000);
    const answers =
      (body as any).answers && typeof (body as any).answers === "object"
        ? ((body as any).answers as Record<string, string>)
        : undefined;

    // Brand from body OR ?brand=. Empty/omitted → primary.
    const brandParam = brandFromBody(body, brandFromQuery(request));
    const brandId = await resolveBrandId(brandParam);

    if (stage === "questions") {
      if (!description) {
        return NextResponse.json({ success: false, error: "A description is required" }, { status: 400 });
      }
      const questions = await handleQuestions(description, brandId);
      return NextResponse.json({ success: true, data: { questions } });
    }

    if (stage === "generate") {
      if (!description) {
        return NextResponse.json({ success: false, error: "A description is required" }, { status: 400 });
      }
      const preview = await handleGenerate(description, answers, brandId);
      if (!preview) {
        return NextResponse.json(
          { success: false, error: "The AI could not produce a usable config — try adding more detail and regenerate." },
          { status: 502 },
        );
      }
      return NextResponse.json({ success: true, data: { config: preview } });
    }

    if (stage === "apply") {
      const config = (body as any).config;
      if (!config || typeof config !== "object") {
        return NextResponse.json({ success: false, error: "No reviewed config to apply" }, { status: 400 });
      }
      const updated = await handleApply(config, brandId);
      return NextResponse.json({ success: true, data: { brand: updated.brand } });
    }

    return NextResponse.json(
      { success: false, error: `Unknown stage "${stage}" (expected questions | generate | apply)` },
      { status: 400 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[AI Setup] Error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
