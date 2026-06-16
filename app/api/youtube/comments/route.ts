/**
 * GET /api/youtube/comments
 * Gathers top-level comment threads for the most recent N videos (capped to
 * respect quota) and returns a flat, newest-first list.
 *
 * Multi-brand:
 *   - ?brand=<id>  → that brand's channel (uses its YouTube OAuth creds).
 *   - no brand     → primary channel (env creds), identical to legacy.
 *   - ?brand=all   → merge comments across ALL active, YouTube-connected brands,
 *                    each item labelled with { brandId, brandLabel }, newest-first.
 *
 * { success, data: [{ commentId, text, author, publishedAt, videoId, videoTitle, url, brandId?, brandLabel? }] }
 */
import { NextRequest, NextResponse } from "next/server";
import { isYouTubeConfigured, getRecentVideos, listCommentThreads, type YouTubeCreds } from "@/lib/youtube";
import { listBrands, getBrandCredentials } from "@/lib/brands";
import { brandFromQuery, isAllBrands } from "@/lib/brandRequest";

export const dynamic = "force-dynamic";

// Cap the number of videos we fan out to (quota-friendly).
const MAX_VIDEOS = 5;
// Top-level comments fetched per video.
const PER_VIDEO  = 20;

interface YouTubeFlatComment {
  commentId:   string;
  text:        string;
  author:      string;
  publishedAt: string;
  videoId:     string;
  videoTitle:  string;
  url:         string;
  brandId?:    string;
  brandLabel?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Build a brand's YouTube OAuth creds object for the youtube.ts helpers. */
async function ytCredsFor(brandId: string): Promise<YouTubeCreds> {
  const c = await getBrandCredentials(brandId);
  return { clientId: c.ytClientId, clientSecret: c.ytClientSecret, refreshToken: c.ytRefreshToken };
}

/** Collect a flat list of recent comments for one channel (by creds). */
async function collectComments(
  creds: YouTubeCreds | undefined,
  label?: { brandId: string; brandLabel: string },
): Promise<YouTubeFlatComment[]> {
  const flat: YouTubeFlatComment[] = [];
  const videos = await getRecentVideos(MAX_VIDEOS, creds);
  for (const video of videos.slice(0, MAX_VIDEOS)) {
    const threads = await listCommentThreads(video.videoId, PER_VIDEO, creds);
    for (const t of threads) {
      flat.push({
        commentId:   t.commentId,
        text:        t.text,
        author:      t.author,
        publishedAt: t.publishedAt,
        videoId:     video.videoId,
        videoTitle:  video.title,
        url:         `https://youtube.com/shorts/${video.videoId}`,
        ...(label ?? {}),
      });
    }
    // Throttle slightly between videos to stay gentle on quota / rate limits.
    await sleep(120);
  }
  return flat;
}

export async function GET(request: NextRequest) {
  try {
    const brand = brandFromQuery(request);

    // ── brand=all → merge comments across all active, configured brands ───────
    if (isAllBrands(brand)) {
      const brands = (await listBrands()).filter((b) => b.active && b.hasYouTube);
      const merged = (
        await Promise.all(
          brands.map(async (b) => {
            try {
              const c = b.isPrimary ? undefined : await ytCredsFor(b.id);
              return await collectComments(c, { brandId: b.id, brandLabel: b.label });
            } catch {
              return [];
            }
          })
        )
      ).flat();
      merged.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      return NextResponse.json({ success: true, data: merged });
    }

    // ── single brand (or primary/no-brand → env creds, unchanged) ─────────────
    const creds = brand ? await ytCredsFor(brand) : undefined;
    if (!isYouTubeConfigured(creds)) {
      return NextResponse.json({ success: true, data: [] });
    }

    const flat = await collectComments(creds);
    // Newest comment first.
    flat.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    return NextResponse.json({ success: true, data: flat });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[YouTube Comments GET] Error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
