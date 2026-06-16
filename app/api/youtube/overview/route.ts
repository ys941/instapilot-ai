/**
 * GET /api/youtube/overview
 * Returns YouTube configuration state, channel stats and recent videos.
 *
 * Multi-brand:
 *   - ?brand=<id>  → that brand's channel (uses its YouTube OAuth creds + prefs).
 *   - no brand     → primary channel (env creds + primary prefs), identical to legacy.
 *   - ?brand=all   → aggregate: SUM channel stats and MERGE recent videos across all
 *                    active, YouTube-connected brands; recentVideos are labelled with
 *                    { brandId, brandLabel }. `configured` is true if ANY brand is.
 *
 * { success, data: { configured, enabled, channel, stats, recentVideos } }
 */
import { NextRequest, NextResponse } from "next/server";
import { isYouTubeConfigured, getChannelStats, getRecentVideos } from "@/lib/youtube";
import { readPreferencesForBrand } from "@/lib/preferences";
import { listBrands, getBrandCredentials } from "@/lib/brands";
import { brandFromQuery, isAllBrands } from "@/lib/brandRequest";

export const dynamic = "force-dynamic";

/** Build a brand's YouTube OAuth creds object for the youtube.ts helpers. */
async function ytCredsFor(brandId: string) {
  const c = await getBrandCredentials(brandId);
  return { clientId: c.ytClientId, clientSecret: c.ytClientSecret, refreshToken: c.ytRefreshToken };
}

export async function GET(request: NextRequest) {
  try {
    const brand = brandFromQuery(request);

    // ── brand=all → aggregate across all active, configured brands ────────────
    if (isAllBrands(brand)) {
      const brands = (await listBrands()).filter((b) => b.active && b.hasYouTube);
      if (brands.length === 0) {
        return NextResponse.json({ success: true, data: { configured: false } });
      }

      const per = await Promise.all(
        brands.map(async (b) => {
          try {
            const c = b.isPrimary ? undefined : await ytCredsFor(b.id);
            const [stats, vids] = await Promise.all([getChannelStats(c), getRecentVideos(10, c)]);
            return { b, stats, vids: vids.map((v) => ({ ...v, brandId: b.id, brandLabel: b.label })) };
          } catch {
            return null;
          }
        })
      );

      const ok = per.filter((x): x is NonNullable<typeof x> => x !== null);
      const recentVideos = ok.flatMap((x) => x.vids)
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

      // SUM the per-brand channel counters; for each brand take the same max-of
      // (channel total, sum of its videos) correction the single-brand path uses.
      const agg = ok.reduce(
        (acc, { stats, vids }) => {
          const videosViewsSum = vids.reduce((s, v) => s + (v.views ?? 0), 0);
          acc.views        += Math.max(stats.views ?? 0, videosViewsSum);
          acc.subscribers  += stats.subscribers ?? 0;
          acc.videos       += stats.videos ?? 0;
          return acc;
        },
        { views: 0, subscribers: 0, videos: 0 }
      );

      return NextResponse.json({
        success: true,
        data: {
          configured:  true,
          enabled:     true, // mixed across brands — treat as enabled if any are configured
          channel:     { title: `All brands (${ok.length})`, thumbnail: null },
          stats:       agg,
          recentVideos,
        },
      });
    }

    // ── single brand (or primary/no-brand → env creds, unchanged) ─────────────
    const creds = brand ? await ytCredsFor(brand) : undefined;
    if (!isYouTubeConfigured(creds)) {
      return NextResponse.json({ success: true, data: { configured: false } });
    }

    const prefs = await readPreferencesForBrand(brand);
    const [stats, recentVideos] = await Promise.all([
      getChannelStats(creds),
      getRecentVideos(10, creds),
    ]);

    // Total Views = the HIGHER of YouTube's channel-level statistics.viewCount
    // and the live sum of the fetched videos' views (channel totals LAG real-time
    // per-video counts). Taking the max keeps the number current & never lower than
    // the listed videos — still sourced entirely from YouTube's own data.
    const channelViews   = stats.views ?? 0;
    const videosViewsSum = recentVideos.reduce((sum, v) => sum + (v.views ?? 0), 0);
    const correctedStats = { ...stats, views: Math.max(channelViews, videosViewsSum), channelViews };

    return NextResponse.json({
      success: true,
      data: {
        configured:   true,
        enabled:      prefs.youtube.enabled,
        channel:      { title: stats.channelTitle, thumbnail: stats.thumbnail },
        stats:        correctedStats,
        recentVideos,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[YouTube Overview GET] Error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
