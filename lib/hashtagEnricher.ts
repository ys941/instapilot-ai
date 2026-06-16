/**
 * lib/hashtagEnricher.ts
 *
 * Viral hashtag enrichment — sources hashtags from Instagram's own trending
 * data, NOT from the account's own posts.
 *
 * Strategy:
 *   1. Check a curated pool of high-reach hashtags against Instagram's
 *      ig_hashtag_search API to get their current media_count (proxy for virality).
 *   2. Sort by media_count to surface what's actively trending RIGHT NOW.
 *   3. AI picks the 2 most relevant to the post topic from the hot pool.
 *   4. Results cached 24 hours to stay within Instagram's 30 unique hashtag
 *      searches per week per user limit.
 *
 * Hashtag tiers (research-backed, 2025–2026 Instagram):
 *   Mega (100M+ posts)  — max reach, cross-niche
 *   High (10M–100M)    — broad community viral
 *   Medium (1M–10M)    — engaged niche community
 *   Niche (<1M)        — highly targeted to the brand niche
 */

import { getAIClient } from "@/lib/ai-factory";
import { getBrand } from "@/lib/preferences";
import { BrandConfig } from "@/lib/brandConfig";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";

/** Branded account tag derived from the active brand's handle. */
function accountTag(brand: BrandConfig): string {
  const h = (brand.persona.handle || "").replace(/^@/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return h ? `#${h}` : "";
}

interface PoolEntry { tag: string; tier: 1 | 2 | 3 | 4; category: string }

// ── Generic, niche-agnostic reach pool ───────────────────────────────────────
// Always-applicable boosters + community tags. The brand's niche + seeds are
// blended in at runtime (see buildHashtagPoolForBrand) so the pool adapts to any
// account without code edits.
const GENERIC_POOL: PoolEntry[] = [
  // Tier 1: mega cross-niche reach boosters
  { tag: "instagood",   tier: 1, category: "general" },
  { tag: "explore",     tier: 1, category: "general" },
  { tag: "explorepage", tier: 1, category: "general" },
  { tag: "viral",       tier: 1, category: "general" },
  { tag: "reels",       tier: 1, category: "general" },
  // Tier 2: high-reach education/community
  { tag: "tips",          tier: 2, category: "education" },
  { tag: "howto",         tier: 2, category: "education" },
  { tag: "learnonreels",  tier: 2, category: "education" },
  { tag: "knowledge",     tier: 2, category: "education" },
  { tag: "trending",      tier: 2, category: "community" },
  // Tier 3: engaged community
  { tag: "community",     tier: 3, category: "community" },
  { tag: "dailytips",     tier: 3, category: "education" },
  { tag: "contentcreator",tier: 3, category: "community" },
];

/**
 * Build the working pool for the active brand: the brand's niche + seed keywords
 * (high-relevance niche tiers) blended with the generic reach pool.
 */
function buildHashtagPoolForBrand(brand: BrandConfig): PoolEntry[] {
  const norm = (s: string) => (s ?? "").toLowerCase().replace(/^#/, "").replace(/[^a-z0-9]+/g, "");
  const pool: PoolEntry[] = [];

  const niche = norm(brand.niche);
  if (niche && niche !== "yourtopic") {
    pool.push({ tag: niche, tier: 3, category: "niche" });
    pool.push({ tag: `${niche}tips`, tier: 4, category: "niche" });
    pool.push({ tag: `${niche}community`, tier: 4, category: "niche" });
    pool.push({ tag: `${niche}education`, tier: 4, category: "niche" });
  }
  for (const seed of brand.hashtagSeeds ?? []) {
    const t = norm(seed);
    if (t) pool.push({ tag: t, tier: 3, category: "niche" });
  }

  pool.push(...GENERIC_POOL);

  // De-dupe by tag.
  const seen = new Set<string>();
  return pool.filter((p) => (seen.has(p.tag) ? false : (seen.add(p.tag), true)));
}

// ── 24-hour virality cache ────────────────────────────────────────────────────
interface CacheEntry { scores: Map<string, number>; fetchedAt: number }
let _cache: CacheEntry | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Probe Instagram hashtag API for live media_count ─────────────────────────
// Queries Instagram's ig_hashtag_search for up to `limit` hashtags and returns
// a map of tag → media_count. We limit to 10 probes per call to stay well within
// Instagram's 30 unique searches/week/user limit.
async function probeHashtagCounts(
  tags: string[],
  igToken: string,
  igAcctId: string,
  limit = 10,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const sample = tags.slice(0, limit);

  await Promise.allSettled(sample.map(async (tag) => {
    try {
      // Step 1: get hashtag ID
      const searchRes = await fetch(
        `${GRAPH_BASE}/ig_hashtag_search?q=${encodeURIComponent(tag)}&user_id=${igAcctId}&access_token=${igToken}`,
        { signal: AbortSignal.timeout(6000) },
      );
      const searchData = await searchRes.json();
      const hashtagId: string | undefined = searchData?.data?.[0]?.id;
      if (!hashtagId) return;

      // Step 2: get media_count for the hashtag
      const infoRes = await fetch(
        `${GRAPH_BASE}/${hashtagId}?fields=media_count&access_token=${igToken}`,
        { signal: AbortSignal.timeout(6000) },
      );
      const infoData = await infoRes.json();
      if (typeof infoData.media_count === "number") {
        result.set(tag, infoData.media_count);
      }
    } catch {
      // ignore individual failures — fallback scoring handles them
    }
  }));

  return result;
}

// ── Get or refresh virality scores ───────────────────────────────────────────
async function getViralityScores(
  igToken: string,
  igAcctId: string,
  pool: PoolEntry[],
): Promise<Map<string, number>> {
  // Return cached scores if still fresh
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.scores;
  }

  // Pick a sample that covers all tiers — prioritise tier 2 (most useful) and tier 3
  const sampleTags = [
    ...pool.filter((h) => h.tier === 2).slice(0, 5).map((h) => h.tag),
    ...pool.filter((h) => h.tier === 3).slice(0, 3).map((h) => h.tag),
    ...pool.filter((h) => h.tier === 1).slice(0, 2).map((h) => h.tag),
  ];

  const liveScores = await probeHashtagCounts(sampleTags, igToken, igAcctId, 10);

  // Fill in missing scores with tier-based estimates
  const allScores = new Map<string, number>();
  const TIER_FALLBACK = { 1: 150_000_000, 2: 30_000_000, 3: 3_000_000, 4: 300_000 };
  for (const { tag, tier } of pool) {
    allScores.set(tag, liveScores.get(tag) ?? TIER_FALLBACK[tier]);
  }

  _cache = { scores: allScores, fetchedAt: Date.now() };
  console.log(`[HashtagEnricher] Refreshed virality scores — probed ${liveScores.size} live, ${allScores.size} total`);
  return allScores;
}

// ── AI-powered hashtag selector ───────────────────────────────────────────────
async function aiPickViralHashtags(
  topic: string,
  rankedPool: Array<{ tag: string; mediaCount: number; category: string }>,
  count: number,
  brand: BrandConfig,
): Promise<string[]> {
  try {
    const ai = await getAIClient();
    const poolStr = rankedPool
      .slice(0, 35)
      .map((h) => `#${h.tag} (~${(h.mediaCount / 1_000_000).toFixed(1)}M posts est., ${h.category})`)
      .join("\n");
    const niche = brand.niche;
    const handle = (brand.persona.handle || "").replace(/^@/, "");

    const prompt = `You are an Instagram growth expert for ${niche} content${handle ? ` (@${handle})` : ""}.

Post topic: "${topic}"

Below are candidate ${niche} hashtags (media counts are rough estimates only). Pick exactly ${count} that are STRICTLY relevant to the SPECIFIC subject of THIS post — match the actual terms, concepts, or themes mentioned. These ${count} are mid-reach "niche community" tags that complement the post's own specific long-tail tags.

${poolStr}

Rules (Instagram 2025 algorithm — relevance ranks the post into the right topic; raw volume does NOT boost reach):
- RELEVANCE FIRST: every pick must genuinely describe THIS exact topic.
- Target mid-reach niche tags (roughly 1M–30M posts) that an engaged ${niche} audience actually follows.
- NEVER pick generic, off-topic, or engagement-bait tags (no #saveforlater, #learnontiktok, #fyp).
- All picks must be directly relevant to ${niche} or this specific subject.

Return ONLY a JSON array: ["#tag1", "#tag2"]
No explanation. No markdown.`;

    const raw = await ai.generateContent(
      prompt,
      `Return ONLY a valid JSON array of exactly ${count} hashtag strings with # prefix. No other text.`,
      150,
    );
    const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
    const arr = JSON.parse(cleaned.match(/\[[\s\S]*?\]/)?.[0] ?? "[]");
    if (!Array.isArray(arr) || arr.length === 0) throw new Error("empty array");

    return (arr as string[])
      .filter((h) => typeof h === "string" && h.startsWith("#"))
      .slice(0, count);
  } catch {
    // Fallback: pick highest media_count tags that loosely match the topic
    const topicLower = topic.toLowerCase();
    const relevant = rankedPool
      .filter((h) => {
        const t = h.tag.toLowerCase();
        return (
          h.category === "niche" ||
          h.category === "education" ||
          topicLower.split(/\s+/).some((w) => w.length > 3 && t.includes(w))
        );
      })
      .slice(0, count)
      .map((h) => `#${h.tag}`);
    return relevant.length ? relevant : rankedPool.slice(0, count).map((h) => `#${h.tag}`);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Builds a tight 5-tag pack for AI-generated posts, balanced across reach tiers
 * so the post is discoverable AND ranks for its specific subject:
 *   - 3 best topic-specific tags (the AI's own long-tail / mid-niche tags
 *     derived from the exact terms / concepts in the content)
 *   - 2 mid-reach niche-community tags vetted live against Instagram's
 *     ig_hashtag_search and filtered for strict topical relevance
 * Optimised for reach + relevance without spammy tag walls or engagement bait.
 */
export async function buildConciseHashtags(
  topicHashtags: string[],
  topic: string,
  igToken: string,
  igAcctId: string,
): Promise<string[]> {
  const viral = await getViralHashtags(topic, igToken, igAcctId, 2);
  const normalise = (h: string) => h.toLowerCase().replace(/^#/, "");
  const seen = new Set<string>();
  const result: string[] = [];

  const addTag = (tag: string) => {
    const norm = normalise(tag);
    if (!seen.has(norm)) { seen.add(norm); result.push(tag.startsWith("#") ? tag : `#${tag}`); }
  };

  // 3 topic tags + 2 viral = 5
  topicHashtags.slice(0, 3).forEach(addTag);
  viral.forEach(addTag);
  return result.slice(0, 5);
}

/**
 * Returns `count` viral hashtags sourced from Instagram's live trending data.
 * Fetches real media_count via ig_hashtag_search API, caches 24 hours,
 * then AI-picks the most viral + relevant ones for the given topic.
 */
export async function getViralHashtags(
  topic: string,
  igToken: string,
  igAcctId: string,
  count = 5,
): Promise<string[]> {
  try {
    const brand = await getBrand();
    const pool  = buildHashtagPoolForBrand(brand);

    // 1. Get live virality scores (cached 24h)
    const scores = await getViralityScores(igToken, igAcctId, pool);

    // 2. Build ranked pool — RELEVANT categories only (niche/education/community).
    //    Generic mega reach tags are excluded: under the 2025 algorithm relevance
    //    ranks the post, not raw volume, and broad tags just dilute topical signal.
    const RELEVANT = new Set(["niche", "education", "community"]);
    const rankedPool = pool
      .filter((h) => RELEVANT.has(h.category) && h.tier >= 2) // drop tier-1 generic megas
      .map((h) => ({ ...h, mediaCount: scores.get(h.tag) ?? 0 }))
      .sort((a, b) => b.mediaCount - a.mediaCount);

    // 3. AI picks the best N viral + relevant hashtags
    const picked = await aiPickViralHashtags(topic, rankedPool, count, brand);

    console.log(`[HashtagEnricher] Viral picks for "${topic}": ${picked.join(" ")}`);
    return picked;
  } catch (err: any) {
    console.warn("[HashtagEnricher] Failed, using fallback:", err?.message);
    // Fallback: relevant niche-community tags derived from the brand niche.
    try {
      const brand = await getBrand();
      const niche = (brand.niche || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const seeds = (brand.hashtagSeeds ?? []).map((s) => `#${s.replace(/^#/, "")}`);
      const base  = [niche ? `#${niche}` : "", ...seeds, "#community", "#tips"].filter(Boolean);
      return base.slice(0, count);
    } catch {
      return ["#community", "#tips", "#trending"].slice(0, count);
    }
  }
}

/**
 * Builds an algorithm-aligned hashtag set for a media-folder post, mixing reach
 * tiers while keeping every tag strictly on-topic for the subject.
 * Instagram 2024-2026 best practice: a SMALL set of HIGHLY RELEVANT hashtags
 * (relevance ranks the post into the right topic, volume no longer boosts reach).
 *   - topicHashtags: AI-generated topic-specific tags (up to ~8) — these
 *     supply the broad + mid + highly-specific long-tail mix tied to the actual
 *     terms / concepts in the content
 *   - +2 mid-reach niche-community tags from Instagram's live trending pool,
 *     filtered for strict topical relevance via ig_hashtag_search
 *   - +1 branded account tag derived from the brand handle
 *   - NO engagement-bait boosters (#learnontiktok/#saveforlater/#didyouknow/#fyp) —
 *     they are off-topic, look spammy, and can suppress reach in 2025.
 *   - Deduplicated and capped at maxTotal (default 10)
 */
export async function buildEnrichedHashtags(
  topicHashtags: string[],
  topic: string,
  igToken: string,
  igAcctId: string,
  maxTotal = 10,
): Promise<string[]> {
  // Only 2 extra trending tags, and they must be topic-RELEVANT (handled inside).
  const viral = await getViralHashtags(topic, igToken, igAcctId, 2);

  const normalise = (h: string) => h.toLowerCase().replace(/^#/, "");
  const seen = new Set<string>();
  const merged: string[] = [];

  const addTag = (tag: string) => {
    const norm = normalise(tag);
    if (!seen.has(norm)) { seen.add(norm); merged.push(tag.startsWith("#") ? tag : `#${tag}`); }
  };

  // Order: topic-specific tags → 2 relevant trending → branded account tag
  topicHashtags.slice(0, maxTotal - 3).forEach(addTag);
  viral.forEach(addTag);
  const brand = await getBrand();
  const acct = accountTag(brand);
  if (acct) addTag(acct);

  return merged.slice(0, maxTotal);
}
