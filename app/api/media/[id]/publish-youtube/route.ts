import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readPreferencesForBrand } from "@/lib/preferences";
import { renderCardsToShortMp4 } from "@/lib/videoGenerator";
import { uploadShort, isYouTubeConfigured, type YouTubeCreds } from "@/lib/youtube";
import { getBrandCredentials, resolveBrandId } from "@/lib/brands";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";

export const dynamic = "force-dynamic";
// Rendering a Short (ffmpeg) + uploading can take a while — give it room.
export const maxDuration = 300;

/**
 * Media-specific YouTube publish.
 *
 * Unlike /api/posts/[id]/publish (which RE-renders a branded card from the
 * post's text fields), media-folder items are real user uploads stored on
 * Cloudinary. We publish the ACTUAL uploaded media:
 *   • a VIDEO  → upload the bytes straight to YouTube as a Short
 *   • an IMAGE → render it into a vertical Short MP4, then upload
 *
 * Instagram behavior is untouched — the media page still calls
 * /api/posts/[id]/publish for the Instagram side.
 */

function isVideoUrl(url: string): boolean {
  return (
    /\.(mp4|mov|webm|avi|m4v)(\?|#|$)/i.test(url) ||
    url.includes("/video/upload/") // Cloudinary video URL
  );
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not fetch media (HTTP ${res.status}) from ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  // Tracks the post's platform at function scope so the catch block can decide
  // whether a YouTube failure should flip the Post to FAILED.
  let postPlatform: string | null = null;
  // Brand from body OR ?brand= query (may be overridden by the post's own brandId below).
  let brandParam: string | null = brandFromQuery(_request);
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", data: null },
        { status: 401 }
      );
    }
    try {
      const body = await _request.json();
      brandParam = brandFromBody(body, brandParam);
    } catch {
      // No/invalid JSON body — keep the query brand (commonly none).
    }

    const post = await prisma.post.findUnique({ where: { id } });
    if (!post || post.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: "Post not found", data: null },
        { status: 404 }
      );
    }
    postPlatform = post.platform;

    // Resolve the brand: an explicit param wins, else fall back to the post's own
    // brandId (set at upload time). No brand → primary (NULL == primary, legacy path).
    const resolvedBrandId = await resolveBrandId(brandParam ?? post.brandId);
    const primaryId       = await resolveBrandId(null);
    const postBrandId     = resolvedBrandId === primaryId ? null : resolvedBrandId;
    const brandCreds      = await getBrandCredentials(resolvedBrandId);
    const ytCreds: YouTubeCreds | undefined = postBrandId
      ? { clientId: brandCreds.ytClientId, clientSecret: brandCreds.ytClientSecret, refreshToken: brandCreds.ytRefreshToken }
      : undefined;

    // Idempotency: a Short already exists for this post.
    if (post.youtubeVideoId) {
      return NextResponse.json(
        { success: false, error: "Post is already published to YouTube", data: null },
        { status: 409 }
      );
    }

    if (!isYouTubeConfigured(ytCreds)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "YouTube is not connected. Configure YouTube OAuth credentials to publish Shorts.",
          data: null,
        },
        { status: 422 }
      );
    }

    const mediaUrl = post.mediaUrls.find(Boolean);
    if (!mediaUrl) {
      return NextResponse.json(
        {
          success: false,
          error: "This media item has no uploaded file to publish to YouTube.",
          data: null,
        },
        { status: 422 }
      );
    }

    // ── Read YouTube prefs for privacy / per-image duration / description suffix ──
    const prefs = await readPreferencesForBrand(resolvedBrandId);
    const yt = prefs.youtube;

    // Build title / description / tags from the user-written media fields.
    const title = (post.title || process.env.BRAND_NAME || "InstaPilot AI").trim();
    const descBase = (post.content ?? "").trim();
    const description = yt.descriptionSuffix
      ? `${descBase}\n\n${yt.descriptionSuffix}`.trim()
      : descBase;
    const tags = (post.hashtags ?? []).map((t) => t.replace(/^#/, "")).filter(Boolean);

    // ── Get the MP4 buffer: video → direct bytes, image → render to Short ───────
    let mp4: Buffer | null;
    if (isVideoUrl(mediaUrl)) {
      mp4 = await fetchBytes(mediaUrl);
    } else {
      const imageBuffer = await fetchBytes(mediaUrl);
      mp4 = await renderCardsToShortMp4([imageBuffer], {
        secondsPerImage: yt.secondsPerImage,
      });
    }

    if (!mp4 || mp4.length === 0) {
      const error =
        "Could not produce a YouTube Short from this media. " +
        "For images this needs ffmpeg available on the server.";
      // Only fail the Post when YouTube is the sole target. For "both", Instagram is
      // the primary target (owned by /api/posts/[id]/publish) — record the error but
      // do NOT flip the Post to FAILED.
      if (post.platform === "youtube") {
        await prisma.post
          .update({ where: { id }, data: { status: "FAILED" } })
          .catch(() => {});
      } else {
        console.warn(`[Media YouTube Publish] YouTube mirror failed (platform=${post.platform}): ${error}`);
      }
      return NextResponse.json(
        { success: false, error, data: null, youtube: { ok: false, error } },
        { status: 500 }
      );
    }

    const result = await uploadShort(mp4, {
      title,
      description,
      tags,
      privacy: (yt.privacy as "public" | "unlisted" | "private") || "public",
    }, ytCreds);

    const now = new Date();
    await prisma.post.update({
      where: { id },
      data: {
        // Only flip to PUBLISHED when YouTube is the sole target. For "both",
        // the Instagram publish route owns the PUBLISHED status; here we just
        // record the YouTube video id so we don't double-upload.
        ...(post.platform === "youtube"
          ? { status: "PUBLISHED", publishedAt: now }
          : {}),
        // Stamp the resolved brand (only when non-primary → leaves legacy rows null).
        ...(postBrandId && post.brandId !== postBrandId ? { brandId: postBrandId } : {}),
        youtubeVideoId: result.videoId,
      },
    });

    await prisma.activityLog
      .create({
        data: {
          userId: session.user.id,
          action: "POST_PUBLISHED",
          entity: "Post",
          entityId: id,
          metadata: { youtubeVideoId: result.videoId, publishedAt: now.toISOString() },
        },
      })
      .catch(() => {});

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        platform: "youtube",
        youtubeVideoId: result.videoId,
        youtubeUrl: result.url,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "YouTube publish failed";
    console.error("[Media YouTube Publish] Error:", message);
    // Only fail the Post when YouTube is the sole target. For "both", Instagram is
    // the primary target (owned by /api/posts/[id]/publish) — record the error but
    // do NOT flip the Post to FAILED.
    if (postPlatform === "youtube") {
      await prisma.post
        .update({ where: { id }, data: { status: "FAILED" } })
        .catch(() => {});
    }
    return NextResponse.json(
      { success: false, error: message, data: null, youtube: { ok: false, error: message } },
      { status: 500 }
    );
  }
}
