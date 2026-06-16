/**
 * POST /api/media/generate-hashtags
 * Returns 8-10 algorithm-aligned, HIGHLY RELEVANT hashtags.
 * Strategy (Instagram 2024-2026 — relevance ranks the post, volume no longer
 * boosts reach; 3-5 to ~10 relevant tags is best practice):
 *   - ~7 AI-generated topic-specific niche tags (specific + medium)
 *   - +2 relevant live-trending tags (from Instagram ig_hashtag_search API)
 *   - +1 branded account tag (derived from the brand handle)
 *   - NO engagement-bait boosters (#saveforlater/#learnontiktok/#didyouknow)
 * Body: { postType, title, caption? }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAIClient } from "@/lib/ai-factory";
import { buildEnrichedHashtags } from "@/lib/hashtagEnricher";
import { getBrand } from "@/lib/preferences";
import { atHandle, typeLabel } from "@/lib/brandConfig";

export async function POST(request: NextRequest) {
  try {
    const body     = await request.json();
    const postType = (body.postType as string) ?? "EDUCATIONAL";
    const title    = (body.title    as string) ?? "";
    const caption  = (body.caption  as string) ?? "";

    const brand = await getBrand();
    const niche = brand.niche;
    const handle = (brand.persona.handle || "").replace(/^@/, "");
    const acctTag = handle ? `#${handle.replace(/[^a-z0-9]/gi, "").toLowerCase()}` : "";

    // Topic keyword for hashtag selection — niche + the type's label.
    const topic       = `${niche} ${typeLabel(brand, postType)}`.trim();
    const contextHint = title || caption.slice(0, 150) || topic;

    // Default fallback — synthesised from the brand niche + seeds (used if AI returns nothing).
    const cleanTag = (t: string) => "#" + t.toLowerCase().replace(/[^a-z0-9]/g, "");
    const nicheTag = cleanTag(niche);
    const FALLBACK_TAGS = [
      nicheTag,
      ...(brand.hashtagSeeds ?? []).map(cleanTag),
      `${nicheTag}tips`,
      "#tips",
    ].filter((t) => t.length > 3);

    // Step 1 — AI generates ~7 HIGHLY RELEVANT topic-specific niche hashtags.
    // Uses generateContentJSON so it walks the model chain until it gets valid JSON
    // (the old plain generateContent silently produced an EMPTY array on the first
    // model that returned non-JSON — that was the "no topic tags" bug).
    let topicTags: string[] = [];
    try {
      const ai  = await getAIClient();
      const seedHint = (brand.hashtagSeeds ?? []).length
        ? `\nBrand seed keywords: ${(brand.hashtagSeeds ?? []).join(", ")}.`
        : "";
      const raw = await ai.generateContentJSON(
        `Generate exactly 7 HIGHLY RELEVANT Instagram hashtags for a ${niche} post about: "${contextHint}".

Account: ${atHandle(brand)} (${brand.persona.role || `a ${niche} creator`}).${seedHint}

Rules (Instagram 2025 — relevance matters, not volume):
- Start with #, no spaces, all lowercase
- Every tag must be SPECIFIC and directly relevant to this exact topic
- Mix: 4 specific long-tail tags + 3 medium ${niche} tags
- NO generic off-topic tags (#health #love #fitness unless truly on-topic)
${acctTag ? `- Do NOT include ${acctTag} (added separately)` : ""}
- Return ONLY a JSON array of 7 strings`,
        "Return ONLY a valid JSON array of 7 hashtag strings. No other text.",
        300,
      );
      const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
      const match   = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        topicTags = (JSON.parse(match[0]) as string[])
          .filter((t): t is string => typeof t === "string")
          // Sanitise: keep ONLY a-z0-9 in the tag body (strips spaces, emoji, and
          // stray non-ASCII/CJK chars the model sometimes injects, e.g. "#stroke…prevention")
          .map((t) => "#" + t.toLowerCase().replace(/[^a-z0-9]/g, ""))
          .filter((t) => t.length > 3 && t.length < 45)
          .slice(0, 8);
        // De-duplicate
        topicTags = [...new Set(topicTags)];
      }
    } catch { /* fall through to fallback below */ }

    // Bug guard: if the AI produced nothing usable, use the niche fallback
    if (topicTags.length === 0) {
      console.warn("[GenerateHashtags] AI returned no topic tags — using fallback");
      topicTags = [...FALLBACK_TAGS];
    }

    // Step 2 — Enrich with 2 relevant live-trending tags + branded account tag (cap 10)
    const igToken  = process.env.INSTAGRAM_ACCESS_TOKEN         ?? "";
    const igAcctId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";
    const finalTags = await buildEnrichedHashtags(topicTags, contextHint, igToken, igAcctId, 10);

    const hashtagStr   = finalTags.join(" ");
    const topicSet     = new Set(topicTags);
    const trendingTags = finalTags.filter((t) => !topicSet.has(t) && t !== acctTag);

    return NextResponse.json({
      success: true,
      data: {
        hashtags:       hashtagStr,
        tags:           finalTags,
        count:          finalTags.length,
        breakdown: {
          topicSpecific: topicTags,
          trending:      trendingTags,
          branded:       acctTag ? [acctTag] : [],
        },
      },
    });
  } catch (e: any) {
    console.error("[GenerateHashtags]", e?.message);
    return NextResponse.json({ success: false, error: e?.message ?? "Hashtag generation failed" }, { status: 500 });
  }
}
