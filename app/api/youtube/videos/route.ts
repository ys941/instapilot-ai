/**
 * GET /api/youtube/videos
 * Returns the channel's recent uploads with per-video stats.
 *
 * Multi-brand:
 *   - ?brand=<id>  → that brand's channel (uses its YouTube OAuth creds).
 *   - no brand     → primary channel (env creds), identical to legacy.
 *   - ?brand=all   → merge recent videos across ALL active brands, each item
 *                    labelled with { brandId, brandLabel }, newest-first.
 *
 * { success, data: recentVideos }
 */
import { NextRequest, NextResponse } from "next/server";
import { getRecentVideos } from "@/lib/youtube";
import { listBrands, getBrandCredentials } from "@/lib/brands";
import { brandFromQuery, isAllBrands } from "@/lib/brandRequest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const brand = brandFromQuery(request);

    // ── brand=all → aggregate (merge) recent videos across active brands ──────
    if (isAllBrands(brand)) {
      const brands = (await listBrands()).filter((b) => b.active);
      const merged = (
        await Promise.all(
          brands.map(async (b) => {
            try {
              const c = b.isPrimary ? undefined : await ytCredsFor(b.id);
              const vids = await getRecentVideos(10, c);
              return vids.map((v) => ({ ...v, brandId: b.id, brandLabel: b.label }));
            } catch {
              return [];
            }
          })
        )
      ).flat();
      // Newest-first across all brands.
      merged.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      return NextResponse.json({ success: true, data: merged });
    }

    // ── single brand (or primary/no-brand → env creds, unchanged) ─────────────
    const creds = brand ? await ytCredsFor(brand) : undefined;
    const recentVideos = await getRecentVideos(10, creds);
    return NextResponse.json({ success: true, data: recentVideos });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[YouTube Videos GET] Error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** Build a brand's YouTube OAuth creds object for the youtube.ts helpers. */
async function ytCredsFor(brandId: string) {
  const c = await getBrandCredentials(brandId);
  return { clientId: c.ytClientId, clientSecret: c.ytClientSecret, refreshToken: c.ytRefreshToken };
}
