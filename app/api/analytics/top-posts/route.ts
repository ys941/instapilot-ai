/**
 * /api/analytics/top-posts
 *
 * Returns real-time top performing posts fetched directly from the Instagram
 * Graph API, cross-referenced with DB for additional metadata (title, type).
 * Sorted by engagement (likes + comments + saves).
 *
 * This gives 100% accurate top posts regardless of DB state / deleted posts.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveBrandId, getPrimaryBrandId, getBrandCredentials } from "@/lib/brands";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

interface MediaItem {
  id: string;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
  media_url?: string;
  permalink?: string;
  media_type?: string;
}

interface InsightMetric {
  name: string;
  value?: number;
  values?: Array<{ value: number }>;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", data: null },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Resolve the requested brand (no ?brand= ⇒ primary). For the primary brand
    // creds resolve from env (env wins in getBrandCredentials) and the DB filter
    // matches brandId NULL OR primaryId, so behaviour is byte-for-byte unchanged.
    const brandParam = request.nextUrl.searchParams.get("brand");
    const resolvedBrandId = await resolveBrandId(brandParam);
    const primaryId       = await getPrimaryBrandId();
    const isPrimaryBrand  = resolvedBrandId === primaryId;
    const brandWhere = isPrimaryBrand
      ? { OR: [{ brandId: null }, { brandId: primaryId }] }
      : { brandId: resolvedBrandId };

    let igToken  = "";
    let igAcctId = "";
    if (isPrimaryBrand) {
      // Unchanged primary path: read straight from env.
      igToken  = process.env.INSTAGRAM_ACCESS_TOKEN         ?? "";
      igAcctId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";
    } else {
      const creds = await getBrandCredentials(resolvedBrandId);
      igToken  = creds.igToken;
      igAcctId = creds.igAcctId;
    }

    if (!igToken || !igAcctId) {
      return NextResponse.json(
        { success: false, error: "Instagram credentials not configured", data: null },
        { status: 503 }
      );
    }

    // -- Fetch last 20 media from Instagram -----------------------------------
    const mediaRes = await fetch(
      `${GRAPH_BASE}/${igAcctId}/media?fields=id,like_count,comments_count,timestamp,media_url,permalink,media_type&limit=20&access_token=${igToken}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const mediaData = await mediaRes.json();

    if (mediaData.error) {
      return NextResponse.json(
        { success: false, error: mediaData.error.message, data: null },
        { status: 502 }
      );
    }

    const igPosts: MediaItem[] = mediaData.data ?? [];

    // -- Load DB posts to cross-reference title / type ------------------------
    const dbPosts = await prisma.post.findMany({
      where:   { userId, instagramPostId: { not: null }, ...brandWhere } as any,
      select:  { instagramPostId: true, title: true, type: true },
    });
    const dbMap = new Map(dbPosts.map((p) => [p.instagramPostId!, p]));

    // -- Fetch insights for each post (saves / reach) -------------------------
    const results: Array<{
      id: string;
      likeCount: number;
      commentsCount: number;
      saves: number;
      reach: number;
      engagementScore: number;
      timestamp: string;
      mediaUrl: string | null;
      permalink: string | null;
      mediaType: string;
      title: string | null;
      postType: string | null;
    }> = [];

    for (const post of igPosts) {
      let saves = 0;
      let reach = 0;

      try {
        const isReel = post.media_type === "REELS" || post.media_type === "VIDEO";
        // Reels: use plays instead of impressions; skip impressions (not available for reels)
        const metrics = isReel ? "reach,saved,plays" : "impressions,reach,saved";
        const insRes  = await fetch(
          `${GRAPH_BASE}/${post.id}/insights?metric=${metrics}&period=lifetime&access_token=${igToken}`,
          { signal: AbortSignal.timeout(8000) }
        );
        const insData = await insRes.json();

        if (!insData.error && Array.isArray(insData.data)) {
          for (const m of insData.data as InsightMetric[]) {
            const val = typeof m.value === "number" ? m.value : (m.values?.[0]?.value ?? 0);
            if (m.name === "reach") reach = val;
            if (m.name === "saved") saves = val;
          }
        }
      } catch {
        // Non-critical — insights may not be available for very old or deleted posts
      }

      const likes    = post.like_count     ?? 0;
      const comments = post.comments_count ?? 0;
      const engagementScore = likes + comments + saves;

      const dbPost = dbMap.get(post.id);

      results.push({
        id:              post.id,
        likeCount:       likes,
        commentsCount:   comments,
        saves,
        reach,
        engagementScore,
        timestamp:       post.timestamp   ?? "",
        mediaUrl:        post.media_url   ?? null,
        permalink:       post.permalink   ?? null,
        mediaType:       post.media_type  ?? "IMAGE",
        title:           dbPost?.title    ?? null,
        postType:        dbPost?.type     ?? null,
      });

      // Small throttle to stay within rate limits
      await new Promise((r) => setTimeout(r, 300));
    }

    // Sort by engagement descending
    results.sort((a, b) => b.engagementScore - a.engagementScore);

    return NextResponse.json({
      success: true,
      error:   null,
      data: {
        posts:     results,
        fetchedAt: new Date().toISOString(),
        count:     results.length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Analytics Top-Posts GET] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}
