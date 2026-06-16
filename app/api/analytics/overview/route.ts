﻿import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { subDays, startOfDay, format } from "date-fns";
import { resolveBrandId, getBrandCredentials, listBrands } from "@/lib/brands";
import { brandFromQuery, isAllBrands } from "@/lib/brandRequest";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

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
    const { searchParams } = new URL(request.url);
    const days = Math.min(90, Math.max(7, parseInt(searchParams.get("days") ?? "30", 10)));
    const since = startOfDay(subDays(new Date(), days));

    // ── Multi-brand scoping ────────────────────────────────────────────────────
    // brand from ?brand=. Build a Prisma filter fragment that is spread into every
    // Post `where` (and `post:` relation filters) below:
    //   - no brand / primary → match brandId NULL OR == primaryId (legacy rows are NULL).
    //   - specific brand     → match brandId == that id.
    //   - brand=all          → {} (no brand filter → aggregate across every brand).
    const brandParam = brandFromQuery(request);
    const aggregateAll = isAllBrands(brandParam);
    const primaryId = await resolveBrandId(null);
    const resolvedBrandId = aggregateAll ? null : await resolveBrandId(brandParam);
    const isPrimaryScope = !aggregateAll && resolvedBrandId === primaryId;

    // Post-level brand filter (spread into Post.where AND nested post:{} filters).
    const brandFilter: Record<string, unknown> = aggregateAll
      ? {}
      : isPrimaryScope
        ? { OR: [{ brandId: null }, { brandId: primaryId }] }
        : { brandId: resolvedBrandId };

    // AccountAnalytics brand filter (same NULL==primary convention).
    const acctBrandFilter: Record<string, unknown> = aggregateAll
      ? {}
      : isPrimaryScope
        ? { OR: [{ brandId: null }, { brandId: primaryId }] }
        : { brandId: resolvedBrandId };

    // -- Fetch live follower count from Instagram API --------------------------
    // Primary/no-brand → env creds (legacy). Specific brand → its IG creds.
    // brand=all → sum live followers across all active, IG-connected brands.
    let liveFollowers: number | null = null;
    let syncedAt: string | null = null;

    const fetchFollowers = async (token: string, acctId: string): Promise<number | null> => {
      if (!token || !acctId) return null;
      try {
        const res = await fetch(
          `${GRAPH_BASE}/${acctId}?fields=followers_count&access_token=${token}`,
          { signal: AbortSignal.timeout(8000) }
        );
        const data = await res.json();
        if (!data.error && typeof data.followers_count === "number") return data.followers_count;
      } catch {
        // best-effort — don't fail the entire overview
      }
      return null;
    };

    if (aggregateAll) {
      const brands = (await listBrands()).filter((b) => b.active && b.hasInstagram);
      const counts = await Promise.all(
        brands.map(async (b) => {
          const c = await getBrandCredentials(b.id);
          return fetchFollowers(c.igToken, c.igAcctId);
        })
      );
      const present = counts.filter((n): n is number => typeof n === "number");
      if (present.length > 0) {
        liveFollowers = present.reduce((s, n) => s + n, 0);
        syncedAt = new Date().toISOString();
      }
    } else {
      // Primary/no-brand keeps the exact legacy env-creds path; a specific brand
      // uses its own creds (getBrandCredentials returns env-wins for the primary).
      const igToken  = isPrimaryScope
        ? (process.env.INSTAGRAM_ACCESS_TOKEN ?? "")
        : (await getBrandCredentials(resolvedBrandId)).igToken;
      const igAcctId = isPrimaryScope
        ? (process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "")
        : (await getBrandCredentials(resolvedBrandId)).igAcctId;
      const followers = await fetchFollowers(igToken, igAcctId);
      if (followers !== null) {
        liveFollowers = followers;
        syncedAt = new Date().toISOString();
      }
    }

    // -- Aggregate post stats (exclude "deleted" posts tagged with FAILED + deleted marker) --
    const [
      totalPosts,
      publishedPosts,
      draftPosts,
      scheduledPosts,
      postsByType,
      recentPosts,
    ] = await Promise.all([
      // Exclude posts marked as deleted (FAILED with instagramPostId = null after deletion)
      prisma.post.count({ where: { userId, ...brandFilter, NOT: { status: "FAILED", instagramPostId: null, metrics: { equals: { deleted: true } } } } }),
      prisma.post.count({ where: { userId, ...brandFilter, status: "PUBLISHED" } }),
      prisma.post.count({ where: { userId, ...brandFilter, status: "DRAFT" } }),
      prisma.post.count({ where: { userId, ...brandFilter, status: "SCHEDULED" } }),
      prisma.post.groupBy({
        by: ["type"],
        where: { userId, ...brandFilter, status: { not: "FAILED" } },
        _count: { type: true },
      }),
      prisma.post.findMany({
        where: { userId, ...brandFilter, createdAt: { gte: since }, status: { not: "FAILED" } },
        include: { analytics: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // -- Aggregate analytics (skip posts with reach=0 to avoid polluting averages) --
    const allAnalytics = await prisma.analytics.findMany({
      where: { post: { userId, ...brandFilter, status: "PUBLISHED" } },
    });

    // For totals: sum all non-zero rows
    const nonZeroReachAnalytics = allAnalytics.filter((a) => a.reach > 0);

    const totals = allAnalytics.reduce(
      (acc, a) => ({
        likes:       acc.likes       + a.likes,
        comments:    acc.comments    + a.comments,
        shares:      acc.shares      + a.shares,
        saves:       acc.saves       + a.saves,
        reach:       acc.reach       + a.reach,
        impressions: acc.impressions + a.impressions,
      }),
      { likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, impressions: 0 }
    );

    // Average engagement rate: only use rows with reach > 0 to avoid 0-reach distortion
    const avgEngagementRate =
      nonZeroReachAnalytics.length > 0
        ? nonZeroReachAnalytics.reduce((s, a) => s + a.engagementRate, 0) / nonZeroReachAnalytics.length
        : 0;

    // -- Period-over-period change percentages ---------------------------------
    const prevSince = startOfDay(subDays(new Date(), days * 2));
    const prevEnd   = startOfDay(subDays(new Date(), days));

    const [prevPublished, prevAnalytics] = await Promise.all([
      prisma.post.count({ where: { userId, ...brandFilter, status: "PUBLISHED", publishedAt: { gte: prevSince, lt: prevEnd } } }),
      prisma.analytics.findMany({ where: { post: { userId, ...brandFilter, publishedAt: { gte: prevSince, lt: prevEnd } } } }),
    ]);

    const prevTotals = prevAnalytics.reduce(
      (acc, a) => ({ reach: acc.reach + a.reach, impressions: acc.impressions + a.impressions }),
      { reach: 0, impressions: 0 }
    );

    const pctChange = (curr: number, prev: number) =>
      prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 1000) / 10;

    const postsChange      = pctChange(publishedPosts, prevPublished);
    const reachChange      = pctChange(totals.reach,   prevTotals.reach);
    const impressionsChange = pctChange(totals.impressions, prevTotals.impressions);

    // -- Top posts (last 10, all statuses) -------------------------------------
    const topPosts = await prisma.post.findMany({
      where: { userId, ...brandFilter },
      include: { analytics: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    // -- Weekly trend  -  posts, reach, impressions, followers per day ----------
    const weeklyTrend: Array<{ date: string; posts: number; reach: number; impressions: number; followers: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const day      = subDays(new Date(), i);
      const dayStart = startOfDay(day);
      const dayEnd   = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

      const [postsCount, analyticsForDay, acctForDay] = await Promise.all([
        prisma.post.count({
          where: { userId, ...brandFilter, publishedAt: { gte: dayStart, lte: dayEnd } },
        }),
        prisma.analytics.findMany({
          where: { post: { userId, ...brandFilter, publishedAt: { gte: dayStart, lte: dayEnd } } },
        }),
        prisma.accountAnalytics.findFirst({
          where:   { ...acctBrandFilter, date: { gte: dayStart, lte: dayEnd } },
          orderBy: { date: "desc" },
        }),
      ]);

      weeklyTrend.push({
        date:        format(day, "yyyy-MM-dd"),
        posts:       postsCount,
        reach:       analyticsForDay.reduce((s, a) => s + a.reach, 0),
        impressions: analyticsForDay.reduce((s, a) => s + a.impressions, 0),
        followers:   acctForDay?.followers ?? 0,
      });
    }

    // -- Account analytics trend -----------------------------------------------
    const accountTrend = await prisma.accountAnalytics.findMany({
      where:   { ...acctBrandFilter, date: { gte: since } },
      orderBy: { date: "asc" },
    });

    // -- Viral score avg -------------------------------------------------------
    const viralPosts    = recentPosts.filter((p) => p.viralScore !== null);
    const avgViralScore =
      viralPosts.length > 0
        ? viralPosts.reduce((s, p) => s + (p.viralScore ?? 0), 0) / viralPosts.length
        : 0;

    // -- AI generation stats ---------------------------------------------------
    const [totalGenerations, generationsByType] = await Promise.all([
      prisma.aIGeneration.count({ where: { userId } }),
      prisma.aIGeneration.groupBy({
        by:    ["type"],
        where: { userId },
        _count: { type: true },
        _sum:   { tokensUsed: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      error:   null,
      data: {
        overview: {
          totalPosts:        publishedPosts, // show only published (Instagram-visible) count
          publishedPosts,
          draftPosts,
          scheduledPosts,
          totalLikes:        totals.likes,
          totalComments:     totals.comments,
          totalShares:       totals.shares,
          totalSaves:        totals.saves,
          totalReach:        totals.reach,
          totalImpressions:  totals.impressions,
          avgEngagementRate: Math.round(avgEngagementRate * 10000) / 100,
          avgViralScore:     Math.round(avgViralScore * 100) / 100,
          // Live Instagram account data
          followers:         liveFollowers,
          syncedAt,
          // Period-over-period changes (positive = growth)
          postsChange,
          reachChange,
          impressionsChange,
        },
        postsByType: postsByType.map((p) => ({
          type:  p.type,
          count: p._count.type,
        })),
        topPosts: topPosts.map((p) => ({
          id:              p.id,
          title:           p.title,
          type:            p.type,
          status:          p.status,
          content:         (p.content ?? "").slice(0, 300),
          hashtags:        p.hashtags ?? [],
          publishedAt:     p.publishedAt,
          instagramPostId: p.instagramPostId ?? null,
          mediaUrls:       p.mediaUrls       ?? [],
          // Flatten analytics so UI can access p.reach directly
          reach:           p.analytics?.reach          ?? 0,
          likes:           p.analytics?.likes          ?? 0,
          comments:        p.analytics?.comments       ?? 0,
          saves:           p.analytics?.saves          ?? 0,
          impressions:     p.analytics?.impressions    ?? 0,
          engagementRate:  p.analytics?.engagementRate ?? 0,
          viralScore:      p.viralScore,
        })),
        weeklyTrend,
        accountTrend: accountTrend.slice(-30),
        aiStats: {
          totalGenerations,
          byType: generationsByType.map((g) => ({
            type:        g.type,
            count:       g._count.type,
            totalTokens: g._sum.tokensUsed ?? 0,
          })),
        },
        dateRange: {
          from: since.toISOString(),
          to:   new Date().toISOString(),
          days,
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Analytics Overview GET] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

