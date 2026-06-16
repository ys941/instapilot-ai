/**
 * POST /api/ai/hashtags
 * Generates REAL, topic-relevant tags via AI, grouped into volume tiers with
 * HONEST tier-based reach estimates (not fabricated per-tag precise numbers).
 * Used by the standalone Hashtags page.
 *
 * Platform-aware (backward compatible — defaults to Instagram):
 *   - Instagram: a reach-tiered MIX of hashtags derived from the specific clinical
 *     entities in the topic (1-2 broad + 2-3 mid-niche + 1-2 long-tail), all on-topic.
 *   - YouTube (platform=youtube|both or youtubeMode): a SMALL set (3-5) of searchable,
 *     content-specific keyword tags + always #shorts, optimized for YT search/suggested.
 * Body: { topic, count?, platform?, youtubeMode? }
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { getAIClient } from "@/lib/ai-factory";
import { getBrand } from "@/lib/preferences";

// Honest, clearly-bucketed tier estimates (NOT fabricated per-tag precision).
const TIER = {
  HIGH_VOLUME:        { reach: 1_000_000, eng: 0.02, score: 0.7 },
  MEDIUM_COMPETITION: { reach: 250_000,   eng: 0.05, score: 0.82 },
  NICHE:              { reach: 60_000,    eng: 0.08, score: 0.9 },
  TRENDING:           { reach: 500_000,   eng: 0.06, score: 0.85 },
} as const;

type Cat = keyof typeof TIER;

const clean = (t: string) => "#" + String(t).toLowerCase().replace(/[^a-z0-9]/g, "");

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized", data: null }, { status: 401 });
    }

    const body  = await request.json();
    const topic = String(body.topic ?? "").trim();
    if (topic.length < 2) {
      return NextResponse.json({ success: false, error: "Topic required", data: null }, { status: 400 });
    }

    // Platform targeting (backward compatible — defaults to Instagram)
    const platform = String(body.platform ?? "instagram").toLowerCase();
    const targetsYouTube = platform === "youtube" || platform === "both" || body.youtubeMode === true;

    const brand = await getBrand();
    const niche = brand.niche;
    const seedStr = (brand.hashtagSeeds ?? []).length
      ? ` Brand seed keywords to anchor relevance: ${(brand.hashtagSeeds ?? []).join(", ")}.`
      : "";

    // AI generates relevant hashtags grouped by volume tier
    let groups: Record<Cat, string[]> = { HIGH_VOLUME: [], MEDIUM_COMPETITION: [], NICHE: [], TRENDING: [] };
    try {
      const ai  = await getAIClient();
      const igPrompt =
        `Generate Instagram hashtags that are STRICTLY relevant to the SPECIFIC subject of this ${niche} post: "${topic}".${seedStr}
First identify the concrete entities in the topic (the actual terms and concepts) and derive every tag from THOSE — not from generic themes.
Build a deliberate reach-tier mix so the post is both discoverable and ranked for its exact subject:
Return ONLY this JSON shape:
{
  "HIGH_VOLUME": ["1-2 broad high-volume but still ON-TOPIC ${niche} tags (>500k posts) — e.g. the umbrella topic"],
  "MEDIUM_COMPETITION": ["2-3 mid-niche ${niche} tags an engaged audience follows (50k-500k posts) — the specific subtopic"],
  "NICHE": ["1-2 highly-specific long-tail tags (<50k posts) — the exact term in the topic"],
  "TRENDING": ["1-2 currently-relevant ${niche} tags that still match this exact subject"]
}
Rules: all lowercase, start with #, no spaces. Every tag MUST genuinely describe THIS topic's subject — no generic off-topic tags, and NO engagement-bait/banned/spammy tags (#fyp #viral #likeforlike #followme #saveforlater #didyouknow #learnontiktok).`;
      const ytPrompt =
        `Produce a SMALL set of YouTube-search-optimized tags/keywords for a vertical ${niche} YouTube SHORT about: "${topic}".${seedStr}
YouTube Shorts discovery is keyword/search/suggested-driven, NOT hashtag-flooded — so return only 3-5 searchable, content-specific keyword tags total (plus #shorts), never an Instagram-style 20-tag dump.
First identify the concrete entities in the topic (the actual terms and concepts) and base the keywords on what a viewer would actually TYPE into YouTube to find this exact subject.
Distribute the small set across these tiers (most fields will hold just 1 tag, some may be empty):
Return ONLY this JSON shape:
{
  "HIGH_VOLUME": ["#shorts plus the single main searchable topic keyword"],
  "MEDIUM_COMPETITION": ["1-2 mid-volume searchable keyword tags people query on YouTube for this subject"],
  "NICHE": ["1 specific long-tail keyword tag for targeted suggested-video discovery"],
  "TRENDING": []
}
Rules: 3-5 tags TOTAL excluding #shorts is the ceiling — keep it small. All lowercase, start with #, no spaces, keyword-driven and searchable. ALWAYS include #shorts. Every tag must genuinely relate to this exact topic. Do NOT apply Instagram-banned-tag logic and do NOT pad with generic tags.`;
      const raw = await ai.generateContentJSON(
        targetsYouTube ? ytPrompt : igPrompt,
        "Return ONLY valid JSON with the four tier arrays. No other text.",
        500,
      );
      const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
      const parsed  = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned);
      for (const cat of Object.keys(groups) as Cat[]) {
        if (Array.isArray(parsed[cat])) {
          groups[cat] = [...new Set((parsed[cat] as string[]).map(clean).filter((t) => t.length > 3 && t.length < 45))];
        }
      }
    } catch { /* fall through to fallback */ }

    // Fallback if AI produced nothing — synthesise from the brand niche + seeds.
    if (Object.values(groups).every((g) => g.length === 0)) {
      const nicheTag = clean(niche);
      const seedTags = (brand.hashtagSeeds ?? []).map(clean).filter((t) => t.length > 3);
      groups = targetsYouTube
        ? {
            // Small, searchable keyword set for YouTube Shorts discovery (not a tag dump)
            HIGH_VOLUME: ["#shorts", nicheTag].filter((t) => t.length > 1),
            MEDIUM_COMPETITION: seedTags.slice(0, 1),
            NICHE: seedTags.slice(1, 2),
            TRENDING: [],
          }
        : {
            HIGH_VOLUME: [nicheTag, "#tips"].filter((t) => t.length > 1),
            MEDIUM_COMPETITION: seedTags.slice(0, 3).length ? seedTags.slice(0, 3) : [`${nicheTag}education`],
            NICHE: seedTags.slice(3, 5),
            TRENDING: ["#community"],
          };
      // Drop any empties that may have crept in.
      for (const cat of Object.keys(groups) as Cat[]) {
        groups[cat] = groups[cat].filter((t) => t && t.length > 1);
      }
    }

    // YouTube: Shorts discovery is keyword/search-driven — enforce a SMALL set
    // (#shorts always present + at most 5 other searchable keyword tags). Never an
    // Instagram-style tag dump even if the model over-generated.
    if (targetsYouTube) {
      const ytSeen = new Set<string>();
      let ytKept = 0;
      const YT_MAX_KEYWORDS = 5; // excludes #shorts
      const hasShorts = Object.values(groups).some((g) => g.includes("#shorts"));
      for (const cat of Object.keys(groups) as Cat[]) {
        const trimmed: string[] = [];
        for (const tag of groups[cat]) {
          if (ytSeen.has(tag)) continue;
          ytSeen.add(tag);
          if (tag === "#shorts") { trimmed.push(tag); continue; }
          if (ytKept >= YT_MAX_KEYWORDS) continue;
          ytKept++;
          trimmed.push(tag);
        }
        groups[cat] = trimmed;
      }
      // Guarantee #shorts is present (it anchors Shorts discovery)
      if (!hasShorts) groups.HIGH_VOLUME = ["#shorts", ...groups.HIGH_VOLUME];
    }

    const seen = new Set<string>();
    const byCategory: Record<Cat, any[]> = { HIGH_VOLUME: [], MEDIUM_COMPETITION: [], NICHE: [], TRENDING: [] };
    let totalReach = 0;
    for (const cat of Object.keys(groups) as Cat[]) {
      for (const tag of groups[cat]) {
        if (seen.has(tag)) continue;
        seen.add(tag);
        const t = TIER[cat];
        byCategory[cat].push({ tag, category: cat, score: t.score, estimatedReach: t.reach, engagementProbability: t.eng, estimated: true });
        totalReach += t.reach;
      }
    }

    const all = Object.values(byCategory).flat();
    return NextResponse.json({
      success: true,
      error: null,
      data: {
        hashtags: all,
        totalReach,
        totalHashtags: all.length,
        byCategory,
        formattedString: all.map((h) => h.tag).join(" "),
        topic,
        platform: targetsYouTube ? "youtube" : "instagram",
        note: targetsYouTube
          ? "YouTube: a small set of searchable, content-specific keyword tags (+#shorts) for Shorts search/suggested discovery. Reach figures are tier-based estimates, not exact metrics."
          : "Instagram: a reach-tiered mix of tags derived from this topic's subject. Reach figures are tier-based estimates, not exact metrics.",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[AI Hashtags] Error:", message);
    return NextResponse.json({ success: false, error: message, data: null }, { status: 500 });
  }
}
