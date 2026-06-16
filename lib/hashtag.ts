// Hashtag Intelligence Library
// Niche-agnostic hashtag packs synthesised from the active brand's niche + seed
// keywords, blended with a generic high-reach booster pool. No niche is baked in.

export interface HashtagData {
  tag: string;
  category: "HIGH_VOLUME" | "MEDIUM_COMPETITION" | "NICHE" | "TRENDING";
  score: number;
  estimatedReach: number;
  engagementProbability: number;
  volume?: number;
}

/** Options to anchor hashtag synthesis to the active brand. */
export interface HashtagBuildOpts {
  /** The account's niche, e.g. "home cooking". */
  niche?: string;
  /** Seed hashtags/keywords from Settings → Brand (with or without #). */
  seeds?: string[];
}

// ---------------------------------------------
// GENERIC BOOSTER POOL (niche-agnostic, always applicable)
// ---------------------------------------------

const GENERIC_BOOSTERS: HashtagData[] = [
  { tag: "#instagood",   category: "HIGH_VOLUME",        score: 74, estimatedReach: 7200000, engagementProbability: 0.020, volume: 82000000 },
  { tag: "#explore",     category: "HIGH_VOLUME",        score: 76, estimatedReach: 5400000, engagementProbability: 0.022, volume: 60000000 },
  { tag: "#explorepage", category: "HIGH_VOLUME",        score: 75, estimatedReach: 4800000, engagementProbability: 0.024, volume: 55000000 },
  { tag: "#viral",       category: "HIGH_VOLUME",        score: 73, estimatedReach: 6100000, engagementProbability: 0.019, volume: 70000000 },
  { tag: "#trending",    category: "TRENDING",           score: 78, estimatedReach: 3800000, engagementProbability: 0.027, volume: 28000000 },
  { tag: "#reels",       category: "HIGH_VOLUME",        score: 77, estimatedReach: 4200000, engagementProbability: 0.026, volume: 40000000 },
  { tag: "#tips",        category: "MEDIUM_COMPETITION", score: 80, estimatedReach: 1400000, engagementProbability: 0.035, volume: 8500000 },
  { tag: "#didyouknow",  category: "HIGH_VOLUME",        score: 75, estimatedReach: 4800000, engagementProbability: 0.024, volume: 55000000 },
  { tag: "#learn",       category: "MEDIUM_COMPETITION", score: 79, estimatedReach: 980000,  engagementProbability: 0.039, volume: 5600000 },
  { tag: "#community",   category: "MEDIUM_COMPETITION", score: 82, estimatedReach: 520000,  engagementProbability: 0.057, volume: 1450000 },
  { tag: "#infographic", category: "HIGH_VOLUME",        score: 77, estimatedReach: 3200000, engagementProbability: 0.026, volume: 35000000 },
];

// ---------------------------------------------
// HELPERS
// ---------------------------------------------

/** Normalise a raw keyword/phrase into a lowercase alphanumeric hashtag (no #). */
function toTag(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Pick a category + heuristic score for a synthesised tag based on its length. */
function synthesise(
  raw: string,
  category: HashtagData["category"],
  score: number,
): HashtagData | null {
  const tag = toTag(raw);
  if (!tag) return null;
  // Shorter tags ≈ higher volume / lower engagement; longer ≈ more niche.
  const len = tag.length;
  const estimatedReach = Math.max(40000, Math.round(2000000 / Math.max(4, len)) * 4);
  const engagementProbability = Math.min(0.09, Math.max(0.02, 0.02 + len * 0.003));
  return { tag: `#${tag}`, category, score, estimatedReach, engagementProbability };
}

/**
 * Build the working pool for a topic from the brand niche, seeds, the topic
 * itself, and the generic boosters.
 */
function buildPool(topic: string, opts?: HashtagBuildOpts): HashtagData[] {
  const pool: HashtagData[] = [];
  const niche = (opts?.niche ?? "").trim();
  const seeds = opts?.seeds ?? [];

  // 1. The niche itself (and a couple of common derivations) — NICHE/high relevance.
  if (niche) {
    const base = toTag(niche);
    if (base) {
      [
        synthesise(base, "HIGH_VOLUME", 90),
        synthesise(`${base}tips`, "NICHE", 88),
        synthesise(`${base}community`, "NICHE", 85),
        synthesise(`${base}daily`, "NICHE", 84),
      ].forEach((h) => h && pool.push(h));
    }
  }

  // 2. Seed keywords from the brand config — high relevance.
  for (const seed of seeds) {
    const h = synthesise(seed, "NICHE", 86);
    if (h) pool.push(h);
  }

  // 3. Words from the topic string — medium relevance.
  for (const word of (topic ?? "").split(/[\s,/]+/)) {
    if (word.length < 3) continue;
    const h = synthesise(word, "MEDIUM_COMPETITION", 80);
    if (h) pool.push(h);
  }

  // 4. Generic boosters — always included for reach.
  pool.push(...GENERIC_BOOSTERS);

  return deduplicateTags(pool);
}

function deduplicateTags(tags: HashtagData[]): HashtagData[] {
  const seen = new Set<string>();
  return tags.filter((t) => {
    if (seen.has(t.tag)) return false;
    seen.add(t.tag);
    return true;
  });
}

// ---------------------------------------------
// PUBLIC API
// ---------------------------------------------

export interface HashtagPack {
  hashtags: HashtagData[];
  totalReach: number;
  byCategory: {
    HIGH_VOLUME: HashtagData[];
    MEDIUM_COMPETITION: HashtagData[];
    NICHE: HashtagData[];
    TRENDING: HashtagData[];
  };
}

export function buildHashtagPack(
  topic: string,
  count: number = 30,
  categories?: Array<"HIGH_VOLUME" | "MEDIUM_COMPETITION" | "NICHE" | "TRENDING">,
  opts?: HashtagBuildOpts,
): HashtagPack {
  let pool = buildPool(topic, opts);

  // Filter by categories if specified
  if (categories && categories.length > 0) {
    pool = pool.filter((h) => categories.includes(h.category));
  }

  // Sort by score descending, then limit
  pool.sort((a, b) => b.score - a.score);
  const selected = pool.slice(0, count);

  const totalReach = selected.reduce((sum, h) => sum + h.estimatedReach, 0);

  const byCategory = {
    HIGH_VOLUME: selected.filter((h) => h.category === "HIGH_VOLUME"),
    MEDIUM_COMPETITION: selected.filter((h) => h.category === "MEDIUM_COMPETITION"),
    NICHE: selected.filter((h) => h.category === "NICHE"),
    TRENDING: selected.filter((h) => h.category === "TRENDING"),
  };

  return { hashtags: selected, totalReach, byCategory };
}

export function scoreHashtag(tag: string): number {
  // Fallback heuristic based on tag length (shorter = higher volume = lower niche score)
  const len = tag.replace("#", "").length;
  return Math.min(95, Math.max(50, 60 + len * 1.5));
}

export function formatHashtagString(hashtags: HashtagData[]): string {
  return hashtags.map((h) => h.tag).join(" ");
}
