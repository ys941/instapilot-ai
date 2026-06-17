/**
 * lib/preferences.ts
 * Read / write app preferences stored in the PostgreSQL `Preferences` table.
 * Uses a singleton row (id = "singleton") so settings survive Railway restarts.
 *
 * All functions are async — call sites must await them.
 */

import { prisma } from "@/lib/prisma";
import { BrandConfig, NEUTRAL_DEFAULT, mergeBrand } from "@/lib/brandConfig";

export interface AiPreferences {
  defaultTone: string;
  defaultType: string;
  language:    string;
  /** "grok" | "gemini" — which AI provider to use for all generation tasks */
  aiProvider:  string;
  /** Gemini API key (stored in DB so user can update from Settings UI) */
  geminiApiKey: string;
}

export interface NotificationPreferences {
  emailPublish:     boolean;
  emailAnalytics:   boolean;
  emailFails:       boolean;
  pushPublish:      boolean;
  pushComments:     boolean;
  pushWeeklyReport: boolean;
  /** Recipient address for failure alerts */
  notificationEmail: string;
}

/** Per-post-type system prompt overrides. Key = type id e.g. "QUIZ" */
export type PromptPreferences = Record<string, string>;

/**
 * Per-weekday schedule override (one entry per weekday, 0=Sun..6=Sat).
 * When a day's entry is present it SUPERSEDES the global postsPerDay/scheduleTimes/
 * scheduleDays for THAT weekday. An empty/absent `dailySchedule` array falls back to
 * the global fields exactly as before (backward compatible).
 */
export interface DayScheduleEntry {
  day:         number;    // 0=Sun ... 6=Sat
  enabled:     boolean;   // false → generate nothing that day
  postsPerDay: number;    // 1–5
  times:       string[];  // ["08:00","19:00"]
  /**
   * Optional per-day Instagram-Reel publish times ("HH:MM"). ONLY meaningful on the
   * YouTube `dailySchedule` (the IG auto-poster ignores it). When this day is "Custom"
   * and this list is NON-EMPTY, a YT→IG cross-posted Reel for this weekday is DEFERRED
   * to one of these slots (one Reel time per Short ideally). Empty/absent → fall back
   * to the global `youtube.reelPublishTimes`. Carried through only for the YouTube
   * section (sanitizeDailySchedule(raw, { withReelTimes:true })); omitted elsewhere so
   * the Auto-Post schedule is byte-identical to before.
   */
  reelTimes?:  string[];
}

export interface AutoPostSettings {
  enabled:      boolean;
  postsPerDay:  number;          // 1 | 2 | 3
  postTypes:    string[];        // subset of POST_TYPE enum values
  topics:       string[];        // rotating topic strings
  scheduleDays: number[];        // 0=Sun ... 6=Sat
  scheduleTimes: string[];       // ["08:00","19:00"]
  timezone:     string;
  autoPublish:  boolean;         // true=publish immediately, false=save as draft
  publishToYouTube: boolean;     // ON → daily IG auto-posts also publish to YouTube as Shorts (platform="both")
  /**
   * Optional per-weekday timing + post-count overrides. When present for today's
   * weekday, the IG auto-poster uses that entry's enabled/postsPerDay/times instead
   * of the global postsPerDay/scheduleTimes/scheduleDays. Empty/absent → global fallback.
   */
  dailySchedule?: DayScheduleEntry[];
  /**
   * Master toggle: when true, only post on weekdays that have a custom `dailySchedule`
   * entry. Days with NO custom entry are skipped entirely (the global Publishing
   * Days/Times are ignored). Default false → unchanged behaviour (global fallback).
   */
  customScheduleOnly?: boolean;
}

export interface StorySettings {
  enabled:           boolean;    // auto-post one story per day
  postTime:          string;     // "HH:MM" in IST (Asia/Kolkata)  -  default "09:00"
  scheduleDays:      number[];   // 0=Sun ... 6=Sat  -  which days to post
  topics:            string[];   // rotating topic strings fed to Grok prompt
  customPromptExtra: string;     // extra instructions appended to Grok prompt
  publishToYouTube:  boolean;    // ON → the daily story also publishes to YouTube as a Short
}

export interface YouTubeSettings {
  /** Mirror every published Instagram post to YouTube as a Short. */
  enabled:       boolean;
  /** Privacy of uploaded Shorts: "public" | "unlisted" | "private". */
  privacy:       string;
  /** Seconds each card is shown in the Short (2–15). */
  secondsPerImage: number;
  /** Append this text to every YouTube description (e.g. channel CTA). */
  descriptionSuffix: string;
  /** Grok auto-replies to YouTube comments. */
  replyToComments: boolean;
  /** How many YouTube auto-posts to publish per day (1–5). */
  postsPerDay: number;
  /** YouTube-targeted content topics. */
  topics: string[];
  /** Which post types the YouTube auto-poster may publish (subset of PostType). */
  postTypes: string[];
  /** Extra prompt instructions appended for YouTube generation. */
  customPromptExtra: string;
  /** Preferred Short publish times ("HH:MM"). */
  postTimes: string[];
  /** Which days to publish (0=Sun ... 6=Sat). */
  scheduleDays: number[];
  /** ON → YouTube-native auto-posts also publish to Instagram as Reels. */
  publishToInstagram: boolean;
  /** ON → narrate each Short with an AI voice and (optionally) burn in word-by-word captions (beta, opt-in). */
  voiceover?: boolean;
  /** Which AI narration voice. Orpheus: female (autumn, diana, hannah) · male (austin, daniel, troy). */
  voiceoverVoice?: string;
  /**
   * ON → burn hardcoded word-by-word captions into the video. OFF (default) → no burned
   * captions, so YouTube can auto-generate captions and auto-translate them per viewer's
   * location/language (burned-in text can't be translated). Narration still plays.
   */
  burnCaptions?: boolean;
  /**
   * Optional per-weekday timing + post-count overrides for the YouTube auto-poster.
   * When present for today's weekday, it supersedes postsPerDay/postTimes/scheduleDays
   * for that weekday. Empty/absent → global fallback (unchanged behaviour).
   */
  dailySchedule?: DayScheduleEntry[];
  /**
   * Master toggle: when true, only post on weekdays that have a custom `dailySchedule`
   * entry. Days with NO custom entry are skipped entirely (the global Publishing
   * Days/Times are ignored). Default false → unchanged behaviour (global fallback).
   */
  customScheduleOnly?: boolean;
  /**
   * Separate Instagram-Reel publish time(s) ("HH:MM") for YT→IG cross-posts. When
   * NON-EMPTY and youtube.publishToInstagram is on, a published Short's Instagram Reel
   * is DEFERRED to the next upcoming time here (scheduled, not published immediately).
   * Empty/absent → the Reel cross-posts immediately (current behaviour).
   */
  reelPublishTimes?: string[];
}

export interface AllPreferences {
  ai:            AiPreferences;
  notifications: NotificationPreferences;
  prompts:       PromptPreferences;
  autoPost:      AutoPostSettings;
  stories:       StorySettings;
  youtube:       YouTubeSettings;
  /**
   * Per-account default content prompt for Instagram generation.
   * Optional — empty string means "use the built-in default". Stored in
   * Brand.settings for non-primary brands; in the Preferences singleton for the
   * primary brand. Backward compatible: existing rows simply lack this key.
   */
  igDefaultPrompt?: string;
  /** Per-account default content prompt for YouTube generation. See igDefaultPrompt. */
  ytDefaultPrompt?: string;
  /**
   * The white-label brand "skin" for THIS account — app name, niche, persona,
   * handles, colours, content-type labels, topics. Each account carries its own.
   */
  brand: BrandConfig;
}

export const DEFAULTS: AllPreferences = {
  ai: {
    defaultTone:  "Friendly",
    defaultType:  "Educational",
    language:     "English",
    aiProvider:   "grok",   // "grok" | "gemini"
    geminiApiKey: "",
  },
  notifications: {
    emailPublish:      true,
    emailAnalytics:    true,
    emailFails:        true,
    pushPublish:       false,
    pushComments:      false,
    pushWeeklyReport:  true,
    notificationEmail: "",  // fallback: NOTIFICATION_EMAIL env var
  },
  prompts: {},
  autoPost: {
    enabled:       false,
    postsPerDay:   2,
    postTypes:     ["EDUCATIONAL", "CLINICAL_PEARL", "QUIZ", "CAROUSEL"],
    topics:        [],   // seeded from Settings → Brand
    scheduleDays:  [1, 2, 3, 4, 5],   // Mon - Fri
    scheduleTimes: ["08:00", "19:00"],
    timezone:      "UTC",
    autoPublish:   false,
    publishToYouTube: false,
    dailySchedule: [],   // empty → fall back to the global fields above
    customScheduleOnly: false,   // true → skip days with no custom entry (ignore global)
  },
  stories: {
    enabled:           false,
    postTime:          "09:00",
    scheduleDays:      [0, 1, 2, 3, 4, 5, 6],   // every day
    topics:            [],   // seeded from Settings → Brand
    customPromptExtra: "",
    publishToYouTube:  false,
  },
  youtube: {
    enabled:           false,
    privacy:           "public",
    secondsPerImage:   5,
    descriptionSuffix: "",
    replyToComments:   true,
    postsPerDay:       1,
    topics:            [],
    postTypes:         ["EDUCATIONAL", "CLINICAL_PEARL", "PREVENTIVE"],
    customPromptExtra: "",
    postTimes:         ["19:00"],
    scheduleDays:      [0, 1, 2, 3, 4, 5, 6],
    publishToInstagram: false,
    voiceover:         false,   // opt-in: AI voiceover + word-by-word captions (beta)
    voiceoverVoice:    "daniel", // default male narration voice (Orpheus)
    burnCaptions:      false,   // OFF → let YouTube auto-caption + auto-translate per viewer location
    dailySchedule:     [],   // empty → fall back to the global fields above
    customScheduleOnly: false,   // true → skip days with no custom entry (ignore global)
    reelPublishTimes:  [],   // empty → cross-post Reels immediately (current behaviour)
  },
  igDefaultPrompt: "",
  ytDefaultPrompt: "",
  brand: NEUTRAL_DEFAULT,
};

// ───────────────────────────────────────────────────────────────────────────
// Per-day schedule sourcing (Feature 1) — shared by the IG + YouTube auto-posters
// ───────────────────────────────────────────────────────────────────────────

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Resolve the effective (enabled, postsPerDay, times) for a given weekday, sourcing
 * from `dailySchedule` when an entry for that weekday exists and falling back to the
 * supplied global values otherwise. Returns `null` ONLY when a custom day entry is
 * present and explicitly disabled (caller should generate nothing). When no custom
 * entry exists the global fields are returned verbatim → byte-identical to before.
 *
 * When `customOnly` is true, weekdays with NO custom entry return `null` (skip the
 * day) instead of falling back to the global values — the global Publishing
 * Days/Times are ignored entirely. Default false → fully backward compatible
 * (existing 4-arg callers are unaffected).
 */
export function resolveDaySchedule(
  weekday: number,
  dailySchedule: DayScheduleEntry[] | undefined | null,
  globalPostsPerDay: number,
  globalTimes: string[],
  customOnly: boolean = false,
): { postsPerDay: number; times: string[] } | null {
  const entry = Array.isArray(dailySchedule)
    ? dailySchedule.find((e) => e && Number(e.day) === weekday)
    : undefined;
  if (!entry) {
    // No per-day override for this weekday.
    // customOnly → skip the day entirely; otherwise → global fallback (unchanged behaviour).
    if (customOnly) return null;
    return { postsPerDay: globalPostsPerDay, times: globalTimes };
  }
  if (entry.enabled === false) return null; // explicitly off today → generate nothing
  const ppd   = Number(entry.postsPerDay);
  const count = Number.isFinite(ppd) ? Math.min(5, Math.max(1, Math.round(ppd))) : globalPostsPerDay;
  const times = Array.isArray(entry.times) && entry.times.filter((t) => HHMM_RE.test(t)).length
    ? entry.times.filter((t) => HHMM_RE.test(t))
    : globalTimes;
  return { postsPerDay: count, times };
}

/**
 * Validate + normalise a raw `dailySchedule` array from a settings POST body.
 * Drops invalid days, clamps postsPerDay to 1–5, keeps only HH:MM times, and
 * de-dupes by weekday. Returns `[]` for non-arrays.
 *
 * `opts.withReelTimes` (YouTube section ONLY) additionally carries each day's
 * per-day Instagram-Reel times (HH:MM, validated). When false/omitted the
 * `reelTimes` field is dropped entirely so the Auto-Post schedule stays
 * byte-identical to before (backward compatible).
 */
export function sanitizeDailySchedule(
  raw: unknown,
  opts: { withReelTimes?: boolean } = {},
): DayScheduleEntry[] {
  if (!Array.isArray(raw)) return [];
  const byDay = new Map<number, DayScheduleEntry>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const day = Number(o.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    const ppd = Number(o.postsPerDay);
    const postsPerDay = Number.isFinite(ppd) ? Math.min(5, Math.max(1, Math.round(ppd))) : 1;
    const times = Array.isArray(o.times)
      ? Array.from(new Set((o.times as unknown[]).filter((t): t is string => typeof t === "string" && HHMM_RE.test(t)))).sort()
      : [];
    const entry: DayScheduleEntry = {
      day,
      enabled: o.enabled !== false, // default true
      postsPerDay,
      times,
    };
    if (opts.withReelTimes) {
      // Preserve Reel-slot ORDER (do NOT sort/dedupe-then-sort) so the catchup
      // slot mapping reelTimes[count] follows the user's intended sequence.
      entry.reelTimes = Array.isArray(o.reelTimes)
        ? (o.reelTimes as unknown[]).filter((t): t is string => typeof t === "string" && HHMM_RE.test(t))
        : [];
    }
    byDay.set(day, entry);
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day);
}

/** Validate + normalise a raw `reelPublishTimes` array (HH:MM list). */
export function sanitizeTimeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((t): t is string => typeof t === "string" && HHMM_RE.test(t)))).sort();
}

/**
 * Merge a raw settings blob (from the Preferences singleton or Brand.settings)
 * over DEFAULTS. Single source of truth for both primary and per-brand reads, so
 * an empty/absent blob always yields a fresh default config.
 */
function mergeOverDefaults(raw: Partial<AllPreferences> | null | undefined): AllPreferences {
  const r = (raw ?? {}) as any;
  return {
    ai:            { ...DEFAULTS.ai,            ...((r.ai            as any) ?? {}) },
    notifications: { ...DEFAULTS.notifications, ...((r.notifications as any) ?? {}) },
    prompts:       { ...((r.prompts             as any) ?? {}) },
    autoPost:      { ...DEFAULTS.autoPost,      ...((r.autoPost      as any) ?? {}) },
    stories:       { ...DEFAULTS.stories,       ...((r.stories       as any) ?? {}) },
    youtube:       { ...DEFAULTS.youtube,       ...((r.youtube       as any) ?? {}) },
    igDefaultPrompt: typeof r.igDefaultPrompt === "string" ? r.igDefaultPrompt : (DEFAULTS.igDefaultPrompt ?? ""),
    ytDefaultPrompt: typeof r.ytDefaultPrompt === "string" ? r.ytDefaultPrompt : (DEFAULTS.ytDefaultPrompt ?? ""),
    brand:         mergeBrand((r.brand as any) ?? null),
  };
}

/** Deep-merge a partial brand skin onto a complete current brand. */
function deepMergeBrand(current: BrandConfig, partial: Partial<BrandConfig>): BrandConfig {
  const contentTypes = { ...current.contentTypes } as any;
  if (partial.contentTypes) {
    for (const [id, cfg] of Object.entries(partial.contentTypes)) {
      contentTypes[id] = { ...(current.contentTypes as any)[id], ...(cfg as any) };
    }
  }
  return {
    ...current,
    ...partial,
    persona:      { ...current.persona, ...(partial.persona ?? {}) },
    colors:       { ...current.colors,  ...(partial.colors  ?? {}) },
    youtube:      { ...current.youtube, ...(partial.youtube ?? {}) },
    contentTypes,
    topics:       Array.isArray(partial.topics)       ? partial.topics       : current.topics,
    hashtagSeeds: Array.isArray(partial.hashtagSeeds) ? partial.hashtagSeeds : current.hashtagSeeds,
  };
}

/** Shallow-merge a partial over a base AllPreferences (per-section merge). */
function mergePartial(base: AllPreferences, prefs: Partial<AllPreferences>): AllPreferences {
  return {
    ai:            { ...base.ai,            ...(prefs.ai            ?? {}) },
    notifications: { ...base.notifications, ...(prefs.notifications ?? {}) },
    prompts:       { ...base.prompts,       ...(prefs.prompts       ?? {}) },
    autoPost:      { ...base.autoPost,      ...(prefs.autoPost      ?? {}) },
    stories:       { ...base.stories,       ...(prefs.stories       ?? {}) },
    youtube:       { ...base.youtube,       ...(prefs.youtube       ?? {}) },
    igDefaultPrompt: prefs.igDefaultPrompt ?? base.igDefaultPrompt ?? "",
    ytDefaultPrompt: prefs.ytDefaultPrompt ?? base.ytDefaultPrompt ?? "",
    brand:         prefs.brand ? deepMergeBrand(base.brand, prefs.brand) : base.brand,
  };
}

/**
 * Read all preferences from the Preferences singleton row. This is the PRIMARY
 * brand's storage and behaves EXACTLY as before. Falls back to DEFAULTS if no
 * row exists yet. (For per-brand reads use readPreferencesForBrand.)
 */
export async function readPreferences(): Promise<AllPreferences> {
  try {
    const row = await prisma.preferences.findUnique({ where: { id: "singleton" } });
    if (!row) return structuredClone(DEFAULTS);
    // Re-shape the singleton row (its columns are the section blobs) so it can
    // flow through the shared merge helper.
    return mergeOverDefaults({
      ai:            (row.ai            as any) ?? undefined,
      notifications: (row.notifications as any) ?? undefined,
      prompts:       (row.prompts       as any) ?? undefined,
      autoPost:      (row.autoPost      as any) ?? undefined,
      stories:       (row.stories       as any) ?? undefined,
      youtube:       (row.youtube       as any) ?? undefined,
      // igDefaultPrompt/ytDefaultPrompt are persisted inside the `ai` blob for the
      // primary brand (the singleton schema has no dedicated columns for them).
      igDefaultPrompt: (row.ai as any)?.igDefaultPrompt,
      ytDefaultPrompt: (row.ai as any)?.ytDefaultPrompt,
      brand:           (row as any).brand ?? undefined,
    });
  } catch {
    return structuredClone(DEFAULTS);
  }
}

/**
 * Merge partial preferences into the Preferences singleton (upsert). Operates on
 * the PRIMARY brand; behaves EXACTLY as before. Returns the updated full
 * preferences. (For per-brand writes use writePreferencesForBrand.)
 */
export async function writePreferences(prefs: Partial<AllPreferences>): Promise<AllPreferences> {
  const current = await readPreferences();
  const merged  = mergePartial(current, prefs);
  // The singleton has no columns for igDefaultPrompt/ytDefaultPrompt, so stash
  // them inside the `ai` blob (round-trips via readPreferences above).
  const aiBlob = {
    ...merged.ai,
    igDefaultPrompt: merged.igDefaultPrompt ?? "",
    ytDefaultPrompt: merged.ytDefaultPrompt ?? "",
  };
  // Prisma expects Json fields as `InputJsonValue` (no custom type index signatures).
  // Casting via `as any` is safe here — these are plain serialisable objects.
  await prisma.preferences.upsert({
    where:  { id: "singleton" },
    create: {
      id:            "singleton",
      ai:            aiBlob             as any,
      notifications: merged.notifications as any,
      prompts:       merged.prompts       as any,
      autoPost:      merged.autoPost      as any,
      stories:       merged.stories       as any,
      youtube:       merged.youtube       as any,
      brand:         merged.brand         as any,
    },
    update: {
      ai:            aiBlob             as any,
      notifications: merged.notifications as any,
      prompts:       merged.prompts       as any,
      autoPost:      merged.autoPost      as any,
      stories:       merged.stories       as any,
      youtube:       merged.youtube       as any,
      brand:         merged.brand         as any,
    },
  });
  _brandCache.clear();
  return merged;
}

// ───────────────────────────────────────────────────────────────────────────
// Brand-aware preferences (Phase 1 multi-account foundation)
//
// For the PRIMARY brand these delegate to the Preferences singleton above, so
// the primary keeps its existing storage and behaviour. For NON-primary brands
// they read/write Brand.settings (merged over the same DEFAULTS).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Read preferences for a specific brand. `null`/undefined resolves to the
 * primary brand (→ Preferences singleton). Non-primary brands read Brand.settings.
 * Always returns a complete config (empty settings → DEFAULTS).
 */
export async function readPreferencesForBrand(brandId?: string | null): Promise<AllPreferences> {
  try {
    // Local imports avoid a static import cycle (brands.ts imports preferences.ts).
    const { resolveBrandId, getPrimaryBrandId } = await import("@/lib/brands");
    const resolvedId = await resolveBrandId(brandId);
    const primaryId  = await getPrimaryBrandId();
    if (resolvedId === primaryId) {
      return readPreferences();
    }
    const brand = await prisma.brand.findUnique({ where: { id: resolvedId }, select: { settings: true } });
    return mergeOverDefaults((brand?.settings as any) ?? null);
  } catch {
    // Any failure (e.g. Brand table not yet pushed) → safe primary/default behaviour.
    return readPreferences();
  }
}

/**
 * Write partial preferences for a specific brand. `null` brandId resolves to the
 * primary brand (→ Preferences singleton). Non-primary brands persist the merged
 * config into Brand.settings. Returns the updated full preferences.
 */
export async function writePreferencesForBrand(
  brandId: string | null,
  prefs: Partial<AllPreferences>,
): Promise<AllPreferences> {
  const { resolveBrandId, getPrimaryBrandId } = await import("@/lib/brands");
  const resolvedId = await resolveBrandId(brandId);
  const primaryId  = await getPrimaryBrandId();

  if (resolvedId === primaryId) {
    return writePreferences(prefs);
  }

  const current = await readPreferencesForBrand(resolvedId);
  const merged  = mergePartial(current, prefs);
  await prisma.brand.update({
    where: { id: resolvedId },
    data:  { settings: merged as any },
  });
  _brandCache.delete(resolvedId);
  return merged;
}

// ───────────────────────────────────────────────────────────────────────────
// Brand SKIN loader (white-label) — per account, cached ~15s.
// Used by AI prompt builders, card renderers, UI, etc. Pass the active account's
// brandId; null/undefined → the primary account's skin.
// ───────────────────────────────────────────────────────────────────────────
const _brandCache = new Map<string, { value: BrandConfig; at: number }>();
const BRAND_TTL_MS = 15_000;

/** Returns the white-label brand skin for an account, merged with defaults. Cached. */
export async function getBrand(brandId?: string | null): Promise<BrandConfig> {
  const key = brandId ?? "__primary__";
  const hit = _brandCache.get(key);
  if (hit && Date.now() - hit.at < BRAND_TTL_MS) return hit.value;
  try {
    const prefs = await readPreferencesForBrand(brandId ?? null);
    _brandCache.set(key, { value: prefs.brand, at: Date.now() });
    return prefs.brand;
  } catch {
    return mergeBrand(null);
  }
}

/** Force the next getBrand() to re-read from the DB. */
export function invalidateBrandCache(): void { _brandCache.clear(); }
