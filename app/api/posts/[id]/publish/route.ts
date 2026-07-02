import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateCarouselImages, uploadBufferToStableCdn, deleteFromCloudinary } from "@/lib/imageGenerator";
import { renderPostToJpeg } from "@/lib/postTypeImageGenerator";
import { buildBeautifulCaption, capIgCaption } from "@/lib/captionBuilder";
import { buildRichCaption } from "@/lib/richCaption";
import { notifyPostFailed } from "@/lib/notifier";
import { publishPostToYouTubeShort } from "@/lib/youtubePublish";
import { isYouTubeConfigured, type YouTubeCreds } from "@/lib/youtube";
import { readPreferencesForBrand, getBrand } from "@/lib/preferences";
import { DEFAULT_SHORT_SECONDS } from "@/lib/shortLength";
import { getBrandCredentials, resolveBrandId } from "@/lib/brands";
import { getPageToken } from "@/lib/catchup";
import { crossPostToFacebookPage } from "@/lib/facebook";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";

const GRAPH_API_VERSION = "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ── Verify a CDN URL actually serves a valid image before giving it to Instagram ──
// catbox.moe and other free CDNs can return HTML/errors instead of image bytes.
// Instagram's container will hang at IN_PROGRESS forever if the URL is bad.
async function verifyImageUrl(url: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MetaBot/1.0)" },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status} from CDN` };
    }
    const contentType = res.headers.get("content-type") ?? "";
    const isVid = contentType.startsWith("video/") || isVideoUrl(url);
    if (!isVid && !contentType.startsWith("image/")) {
      return { ok: false, reason: `CDN returned '${contentType}' instead of image/video` };
    }
    // Read a small chunk to confirm it's real media data (not an HTML error page)
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5_000) {
      return { ok: false, reason: `Media too small (${buf.length} bytes)  -  likely an error response` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: `URL unreachable: ${err?.message}` };
  }
}

// ── Generate a fresh CDN URL (re-renders + re-uploads, used as retry) ─────────
async function generateFreshCdnUrl(post: {
  type: string; title: string; hook?: string | null;
  content?: string | null; cta?: string | null; reelScript?: string | null;
}): Promise<string | null> {
  try {
    const buf = await renderPostToJpeg({
      postType:   post.type,
      title:      post.title,
      hook:       post.hook       ?? "",
      content:    post.content    ?? "",
      cta:        post.cta        ?? "",
      reelScript: post.reelScript ?? undefined,
    });
    if (!buf) return null;
    return await uploadBufferToStableCdn(buf, ".jpg", `retry-${post.type.toLowerCase()}-${Date.now()}`);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Facebook Graph API  -  publish to Instagram
// ─────────────────────────────────────────────

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|avi|m4v)(\?|#|$)/i.test(url) ||
    url.includes("/video/upload/"); // Cloudinary video URL
}

async function createMediaContainer(
  igAccountId: string,
  accessToken: string,
  mediaUrl: string,
  caption: string
): Promise<string> {
  caption = capIgCaption(caption);
  const isVideo = isVideoUrl(mediaUrl);
  const params: Record<string, string> = isVideo
    ? { video_url: mediaUrl, media_type: "REELS", caption, access_token: accessToken }
    : { image_url: mediaUrl, caption, access_token: accessToken };

  const res = await fetch(`${GRAPH_BASE}/${igAccountId}/media?${new URLSearchParams(params)}`, {
    method: "POST",
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(
      `Failed to create media container: ${err.error?.message ?? res.statusText}`
    );
  }

  const data = await res.json();
  return data.id as string;
}

// ── Poll container status until FINISHED ──────────────────────────────────────
// Root cause of IN_PROGRESS hang: when the token cannot query container status,
// the API returns {error:{code:100,error_subcode:33}} — no status_code field.
// Old code defaulted to "IN_PROGRESS" and looped forever.
// Fix: detect auth/not-found errors → skip polling, wait fixed 30s, proceed.
async function waitForContainerReady(
  containerId: string,
  accessToken: string,
  maxWaitMs = 120_000   // 2 minutes max
): Promise<void> {
  const initialDelay = 8_000;  // wait 8 s before first check
  const interval     = 6_000;  // poll every 6 s

  await new Promise((r) => setTimeout(r, initialDelay));

  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  let authErrorCount = 0;

  while (Date.now() < deadline) {
    attempt++;
    const res  = await fetch(
      `${GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${accessToken}`
    );
    const data = await res.json();

    // ── Handle API error responses ──────────────────────────────────────────
    if (data.error) {
      const code    = data.error.code;
      const subcode = data.error.error_subcode;
      // Auth error (100/33) or object-not-found: token can't query container status.
      // Skip polling — wait remaining time then let media_publish decide.
      if (code === 100 || code === 10 || code === 190) {
        authErrorCount++;
        console.warn(`[Publish] Container status check blocked (code ${code}/${subcode}) — skipping poll, will attempt publish directly`);
        if (authErrorCount >= 2) {
          // Wait 45s for Instagram to finish processing (images: 5-20s, busy servers: up to 40s)
          console.log(`[Publish] Container ${containerId} — waiting 45s for Instagram processing (status polling blocked)`);
          await new Promise((r) => setTimeout(r, 45_000));
          console.log(`[Publish] Container ${containerId} — 45s wait done, attempting publish`);
          return;
        }
      } else {
        throw new Error(`Container status error: ${data.error.message} (code ${code})`);
      }
    }

    const statusCode: string = data.status_code ?? "UNKNOWN";
    const statusMsg:  string = data.status      ?? "";
    const elapsed = Math.round((Date.now() - (deadline - maxWaitMs)) / 1000);
    console.log(`[Publish] Container ${containerId} — ${statusCode}${statusMsg ? ` (${statusMsg})` : ""} | attempt ${attempt} | ${elapsed}s`);

    if (statusCode === "FINISHED") return;
    if (statusCode === "ERROR")    throw new Error(`Instagram rejected the media: ${statusMsg || "check image format/size"}`);
    if (statusCode === "EXPIRED")  throw new Error(`Instagram container expired — media URL was unreachable by Meta's servers`);

    await new Promise((r) => setTimeout(r, interval));
  }

  // Timed out — attempt publish anyway; Instagram may have finished silently
  console.warn(`[Publish] Container ${containerId} status poll timed out — attempting publish anyway`);
}

async function publishMediaContainer(
  igAccountId: string,
  accessToken: string,
  creationId: string
): Promise<string> {
  // Wait for Instagram to finish downloading/processing the image
  await waitForContainerReady(creationId, accessToken);

  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: accessToken,
  });

  const res = await fetch(`${GRAPH_BASE}/${igAccountId}/media_publish?${params}`, {
    method: "POST",
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(
      `Failed to publish media: ${err.error?.message ?? res.statusText}`
    );
  }

  const data = await res.json();
  return data.id as string;
}

async function createCarouselContainer(
  igAccountId: string,
  accessToken: string,
  children: string[],
  caption: string
): Promise<string> {
  const params = new URLSearchParams({
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: capIgCaption(caption),
    access_token: accessToken,
  });

  const res = await fetch(`${GRAPH_BASE}/${igAccountId}/media?${params}`, {
    method: "POST",
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(
      `Failed to create carousel container: ${err.error?.message ?? res.statusText}`
    );
  }

  const data = await res.json();
  return data.id as string;
}

async function createCarouselItem(
  igAccountId: string,
  accessToken: string,
  imageUrl: string
): Promise<string> {
  const params = new URLSearchParams({
    image_url: imageUrl,
    is_carousel_item: "true",
    access_token: accessToken,
  });

  const res = await fetch(`${GRAPH_BASE}/${igAccountId}/media?${params}`, {
    method: "POST",
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(
      `Failed to create carousel item: ${err.error?.message ?? res.statusText}`
    );
  }

  const data = await res.json();
  return data.id as string;
}

// ─────────────────────────────────────────────
// YouTube Short publish (platform youtube / both)
// ─────────────────────────────────────────────

// Map a Post row to the YtPostInput shape expected by publishPostToYouTubeShort,
// read the user's YouTube prefs, render the post → Short MP4 → upload. Throws on failure.
async function publishYouTubeShortForPost(post: {
  id: string; type: string; title: string;
  hook?: string | null; content?: string | null; cta?: string | null;
  reelScript?: string | null; hashtags?: string[];
  carouselSlides?: unknown;
}, brandId?: string | null, creds?: YouTubeCreds): Promise<{ videoId: string; url: string; slides: number }> {
  // Per-brand YouTube settings (no brand → primary, identical to legacy readPreferences()).
  const prefs = await readPreferencesForBrand(brandId ?? null);
  const yt = prefs.youtube;
  return publishPostToYouTubeShort(
    {
      id:             post.id,
      type:           post.type,
      title:          post.title,
      hook:           post.hook ?? null,
      content:        post.content ?? null,
      cta:            post.cta ?? null,
      reelScript:     post.reelScript ?? null,
      hashtags:       post.hashtags ?? [],
      carouselSlides: (post.carouselSlides as Array<{ slide: number; headline: string; body: string }> | null) ?? null,
    },
    // Pass the FULL pacing/voiceover prefs (same defaults as the scheduler's
    // forceYouTubeShort in lib/catchup.ts) — omitting them built silent,
    // default-paced Shorts on manual "Publish Now".
    {
      privacy:            yt.privacy,
      secondsPerImage:    yt.secondsPerImage,
      targetShortSeconds: yt?.targetShortSeconds ?? DEFAULT_SHORT_SECONDS,
      descriptionSuffix:  yt.descriptionSuffix,
      voiceover:          yt?.voiceover ?? false,
      voiceoverVoice:     yt?.voiceoverVoice ?? "daniel",
      burnCaptions:       yt?.burnCaptions ?? false,
    },
    // Omit creds for the primary brand → env/primary path (exact legacy behaviour).
    creds,
  );
}

// ─────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // Tracks the ScheduledPost(s) we atomically claimed (PENDING→FAILED "__CLAIMING__").
  // Declared at function scope so the catch block can restore them to PENDING on failure.
  // NOTE: this is an ARRAY — a single Post can have MORE THAN ONE linked PENDING
  // ScheduledPost (e.g. scheduled twice, or auto-generate + manual schedule). We must
  // claim ALL of them, otherwise the scheduler (publishOverdueScheduled) can pick up a
  // leftover PENDING SP during the slow publish and double-publish the same content.
  const claimedScheduledPostIds: string[] = [];
  try {
    const session = await getServerSession();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", data: null },
        { status: 401 }
      );
    }

    // ── Optional platform override from request body ──────────────────────────
    // If the client sends { platform: "instagram" | "youtube" | "both" }, treat it
    // as an override: persist it to the post BEFORE the routing logic below so the
    // existing platform branches publish to the chosen target. If absent/invalid,
    // fall back to whatever is already stored on the post.
    let platformOverride: "instagram" | "youtube" | "both" | null = null;
    // Multi-brand: brand from body OR ?brand= query. Empty/omitted → primary brand.
    let brandParam: string | null = brandFromQuery(_request);
    try {
      const body = await _request.json();
      const requested = body?.platform;
      if (requested === "instagram" || requested === "youtube" || requested === "both") {
        platformOverride = requested;
      }
      brandParam = brandFromBody(body, brandParam);
    } catch {
      // No/invalid JSON body — keep using the post's stored platform + query brand
    }

    // Resolve the brand once. No brand / unknown → primary id (NULL-equivalent), so
    // the per-brand reads/writes below behave EXACTLY as the legacy single-account path.
    const brandId = await resolveBrandId(brandParam);
    // Stamp the primary brand's posts with brandId=null (legacy rows use NULL == primary).
    const primaryId = await resolveBrandId(null);
    const postBrandId = brandId === primaryId ? null : brandId;
    // Build that brand's YouTube OAuth creds (undefined for primary → env/primary path).
    const brandCreds = await getBrandCredentials(brandId);
    const ytCreds: YouTubeCreds | undefined = postBrandId
      ? { clientId: brandCreds.ytClientId, clientSecret: brandCreds.ytClientSecret, refreshToken: brandCreds.ytRefreshToken }
      : undefined;

    // Fetch post and verify ownership
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post || post.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: "Post not found", data: null },
        { status: 404 }
      );
    }

    if (post.status === "PUBLISHED") {
      return NextResponse.json(
        { success: false, error: "Post is already published", data: null },
        { status: 409 }
      );
    }

    // ── Platform routing ──────────────────────────────────────────────────────
    // post.platform: "instagram" (default) | "youtube" | "both".
    //   youtube  → skip Instagram entirely, publish only a YouTube Short.
    //   both     → run the Instagram flow first, then best-effort mirror to YouTube.
    //   instagram→ unchanged legacy behavior.
    // A platform override in the request body wins — persist it before routing so the
    // branches below (and any DB reads of post.platform) reflect the chosen target.
    if (platformOverride && platformOverride !== post.platform) {
      post.platform = platformOverride;
      await prisma.post.update({
        where: { id },
        data: { platform: platformOverride },
      });
    }
    const platform = (post.platform ?? "instagram") as "instagram" | "youtube" | "both";

    // ── Stamp the resolved brand onto the Post ────────────────────────────────
    // Only write when it actually changes (postBrandId is null for the primary
    // brand, so primary/no-brand posts are left untouched → identical legacy rows).
    if (post.brandId !== postBrandId) {
      post.brandId = postBrandId;
      await prisma.post.update({ where: { id }, data: { brandId: postBrandId } }).catch(() => {});
    }

    // ── Claim lock: participate in the same atomic claim the scheduler uses ────
    // When a post has a linked PENDING ScheduledPost, the scheduler (lib/catchup.ts)
    // may pick it up at the same time as this manual publish. To prevent a
    // double-publish, atomically flip those SPs PENDING→FAILED "__CLAIMING__" the same
    // way the scheduler does.
    //
    // BUG FIX (double-publish): we now claim ALL linked PENDING ScheduledPosts for this
    // postId — not just the first. A post can legitimately have more than one linked
    // PENDING SP (scheduled twice, or auto-generate + a manual schedule). The old code
    // used findFirst() and claimed only one; any remaining PENDING SP stayed PENDING for
    // the whole 30-60s+ publish, so a concurrent publishOverdueScheduled() run picked it
    // up and published the SAME content a second time (a duplicate IG post / YT video).
    // Claiming every PENDING SP up-front closes that window. On success each publish path
    // resets them to PUBLISHED; on failure the catch block restores them to PENDING so
    // they aren't stuck on the __CLAIMING__ sentinel.
    const linkedScheduledList = await prisma.scheduledPost.findMany({
      where: { postId: id, status: "PENDING" },
      select: { id: true },
    });
    for (const sp of linkedScheduledList) {
      const claimed = await prisma.scheduledPost.updateMany({
        where: { id: sp.id, status: "PENDING" },
        data:  { status: "FAILED", error: "__CLAIMING__" },
      }).catch(() => ({ count: 0 }));
      if (claimed.count === 1) {
        claimedScheduledPostIds.push(sp.id);
      }
      // count===0 → the scheduler claimed this particular SP first; that's fine, the
      // scheduler's Guard 1 will defer to this manual publish once the Post is PUBLISHED.
    }

    // Stamp the resolved brand onto every ScheduledPost this publish claimed.
    // postBrandId is null for the primary brand → leaves legacy rows untouched.
    if (postBrandId && claimedScheduledPostIds.length > 0) {
      await prisma.scheduledPost.updateMany({
        where: { id: { in: claimedScheduledPostIds } },
        data:  { brandId: postBrandId },
      }).catch(() => {});
    }

    // ── YOUTUBE-ONLY: do not touch the Instagram flow at all ───────────────────
    if (platform === "youtube") {
      // Idempotency: a Short was already uploaded for this post → treat as published.
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
            error: "YouTube is not connected. Configure YouTube OAuth credentials to publish Shorts.",
            data: null,
          },
          { status: 422 }
        );
      }

      try {
        const ytResult = await publishYouTubeShortForPost(post, brandId, ytCreds);
        const now = new Date();
        await prisma.post.update({
          where: { id },
          data: {
            status: "PUBLISHED",
            youtubeVideoId: ytResult.videoId,
            publishedAt: now,
          },
        });
        // Release ALL claimed ScheduledPosts as PUBLISHED with the resulting video id.
        // (This branch returns early, so it must finalize every SP it claimed — the
        // postId-based PUBLISHED cleanup further below only runs on the Instagram path.)
        if (claimedScheduledPostIds.length > 0) {
          await prisma.scheduledPost.updateMany({
            where: { id: { in: claimedScheduledPostIds } },
            data:  { status: "PUBLISHED", youtubeVideoId: ytResult.videoId, publishedAt: now, error: null },
          }).catch(() => {});
        }
        return NextResponse.json({
          success: true,
          error: null,
          data: {
            platform: "youtube",
            youtubeVideoId: ytResult.videoId,
            youtubeUrl: ytResult.url,
          },
        });
      } catch (ytErr: unknown) {
        const ytMessage = ytErr instanceof Error ? ytErr.message : "YouTube publish failed";
        console.error("[Post Publish] YouTube error:", ytMessage);
        await prisma.post
          .update({ where: { id }, data: { status: "FAILED" } })
          .catch(() => {});
        // Restore ALL claimed ScheduledPosts to PENDING so none stay stuck on the sentinel.
        if (claimedScheduledPostIds.length > 0) {
          await prisma.scheduledPost.updateMany({
            where: { id: { in: claimedScheduledPostIds } },
            data:  { status: "PENDING", error: null },
          }).catch(() => {});
        }
        return NextResponse.json(
          { success: false, error: ytMessage, data: null },
          { status: 500 }
        );
      }
    }

    // Fetch Instagram credentials.
    //  - PRIMARY / no-brand: legacy path (User table override → env fallback), UNCHANGED.
    //  - NON-PRIMARY brand:  that brand's stored IG credentials.
    let instagramToken: string;
    let instagramAccountId: string;
    if (postBrandId) {
      instagramToken     = brandCreds.igToken;
      instagramAccountId = brandCreds.igAcctId;
    } else {
      const user = await prisma.user.findUnique({ where: { id: session.user.id } });
      instagramToken =
        user?.instagramToken ?? process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
      instagramAccountId =
        user?.instagramAccountId ?? process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";
    }

    if (!instagramToken || !instagramAccountId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Instagram account not connected. Add INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID to .env.local.",
          data: null,
        },
        { status: 422 }
      );
    }

    // ── Build caption ────────────────────────────────────────────────────────
    // Media-folder uploads already have their own caption written by the user.
    // Detect them by the presence of a stable CDN URL in mediaUrls — these posts
    // were uploaded directly (not AI-generated) so we use the raw caption + hashtags.
    // AI-generated posts have empty mediaUrls at this point → get the full branded caption.
    const hasUploadedMedia = post.mediaUrls.some((url) => {
      try {
        const h = new URL(url).hostname;
        return (
          h.includes("cloudinary.com") ||
          h.includes("amazonaws.com")  ||
          h.includes("catbox.moe")     ||
          h.includes("cdninstagram.com")
        );
      } catch { return false; }
    });

    const hashtagStr = post.hashtags.filter(Boolean).join(" ");
    let caption: string;
    if (hasUploadedMedia) {
      // Raw caption from media folder — keep exactly what the user wrote
      caption = [post.content ?? "", hashtagStr].filter(Boolean).join("\n\n");
    } else {
      // AI-generated post → ONE unified rich caption (identical on IG + YT, generated
      // once & cached as RICHCAP: on the post). Best-effort: fall back to the beautiful
      // type-specific caption if the rich-caption build throws.
      try {
        const rich = await buildRichCaption({
          id:         post.id,
          type:       post.type,
          title:      post.title,
          hook:       post.hook,
          content:    post.content,
          cta:        post.cta,
          reelScript: post.reelScript,
          hashtags:   post.hashtags,
        });
        caption = [rich, hashtagStr].filter(Boolean).join("\n\n");
      } catch (capErr: any) {
        console.warn(`[Publish] Rich caption failed for ${id}, using fallback:`, capErr?.message ?? capErr);
        caption = buildBeautifulCaption({
          postType:   post.type,
          title:      post.title,
          hook:       post.hook       ?? "",
          content:    post.content    ?? "",
          cta:        post.cta        ?? "",
          reelScript: post.reelScript ?? undefined,
          hashtags:   post.hashtags,
        }, await getBrand(brandId));
      }
    }

    // ── Resolve media URLs ────────────────────────────────────────────────────
    // Start with whatever is stored on the post (works for ALL post types).
    // Media-folder posts already have a stable Cloudinary URL here — we keep it.
    // AI-generated posts have an empty array — they fall through to card generation below.
    let mediaUrls: string[] = [...post.mediaUrls];

    // Helper: check if a URL is a stable CDN URL that Meta's servers can fetch.
    // Only Cloudinary and similar enterprise CDNs are trusted.
    // Free/unreliable CDNs are excluded  -  Instagram's crawler can't reliably fetch from them.
    const isStableCdnUrl = (url: string) => {
      if (!url) return false;
      try {
        const u = new URL(url);
        const host = u.hostname;
        if (host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.")) return false;
        if (url.includes("PASTE_YOUR_NGROK_URL_HERE")) return false;
        // Exclude free/unreliable CDNs  -  Instagram's crawler can't always reach them
        if (host.includes("pollinations.ai")) return false;
        if (host.includes("picsum.photos"))   return false;
        if (host.includes("catbox.moe"))      return false; // unreliable for Instagram  -  causes IN_PROGRESS hang
        // Only trust known enterprise CDNs
        const trusted =
          host.includes("cloudinary.com")   ||
          host.includes("amazonaws.com")    ||
          host.includes("googleapis.com")   ||
          host.includes("imgur.com")        ||
          host.includes("cdninstagram.com");
        return trusted;
      } catch {
        return false;
      }
    };

    // Keep only stable CDN URLs (Cloudinary, catbox.moe, etc.)
    // Pollinations URLs get stripped so we regenerate with proper hosting
    mediaUrls = mediaUrls.filter(isStableCdnUrl);

    // Also use isStableCdnUrl for the is-publicly-accessible check elsewhere
    const isPubliclyAccessible = isStableCdnUrl;

    // ── CAROUSEL: generate one image per slide ────────────────────────────────
    const slides = post.carouselSlides as Array<{ slide: number; headline: string; body: string }> | null;

    if (post.type === "CAROUSEL" && mediaUrls.length < 2) {
      console.log(`[Publish] Carousel post  -  generating ${slides?.length ?? 9} slide images...`);

      if (slides && slides.length >= 2) {
        // Generate one image per slide
        const carouselUrls = await generateCarouselImages(
          slides,
          post.imagePrompt || "clean modern educational infographic, dark background",
          post.title        // used as cover slide title
        );

        if (carouselUrls.length >= 2) {
          mediaUrls = carouselUrls;
          await prisma.post.update({ where: { id }, data: { mediaUrls } });
          console.log(`[Publish] Generated ${mediaUrls.length} carousel slide images`);
        } else {
          // Not enough slides generated — abort rather than use stock photos
          await prisma.post.update({ where: { id }, data: { status: "FAILED" } }).catch(() => {});
          return NextResponse.json(
            {
              success: false,
              error: "Carousel image generation failed — not enough slides. Check that the canvas renderer (sharp/skia-canvas) is installed.",
              data: null,
            },
            { status: 422 }
          );
        }
      } else {
        // No slide data — abort
        await prisma.post.update({ where: { id }, data: { status: "FAILED" } }).catch(() => {});
        return NextResponse.json(
          {
            success: false,
            error: "Carousel image generation failed — not enough slides. Check that the canvas renderer (sharp/skia-canvas) is installed.",
            data: null,
          },
          { status: 422 }
        );
      }
    }

    // ── NON-CAROUSEL: generate branded dark-card image ───────────────────────
    if (mediaUrls.length === 0) {
      console.log(`[Publish] No media  -  rendering branded ${post.type} card...`);

      let generatedUrl: string | null = null;

      // 1. Branded Satori renderer  -  matches dashboard visual card design exactly
      try {
        const buf = await renderPostToJpeg({
          postType:   post.type,
          title:      post.title,
          hook:       post.hook       ?? "",
          content:    post.content    ?? "",
          cta:        post.cta        ?? "",
          reelScript: post.reelScript ?? undefined,
        });
        if (buf) {
          generatedUrl = await uploadBufferToStableCdn(buf, ".jpg", `card-${post.type.toLowerCase()}`);
          if (generatedUrl) console.log(`[Publish] Branded card: ${generatedUrl}`);
        }
      } catch (brandErr: any) {
        console.warn("[Publish] Branded renderer failed, falling back to Picsum:", brandErr?.message);
      }

      // No Picsum fallback — log and let the caller handle the null case
      if (!generatedUrl) {
        console.warn("[Publish] Branded renderer failed and no CDN URL available — aborting publish");
      }

      if (generatedUrl) {
        // Trust URLs returned by uploadBufferToStableCdn — they were just successfully uploaded.
        // verifyImageUrl() below will do the real accessibility check before giving to Instagram.
        mediaUrls = [generatedUrl];
        await prisma.post.update({ where: { id }, data: { mediaUrls } });
      } else {
        return NextResponse.json(
          {
            success: false,
            error:
              "Could not generate a branded image for this post. " +
              "Add CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET to your Railway environment " +
              "variables to enable image hosting.",
            data: null,
          },
          { status: 422 }
        );
      }
    }

    let instagramPostId: string;

    if (post.type === "CAROUSEL" && mediaUrls.length > 1) {
      // Multi-image carousel publish flow
      // Create carousel items SERIALLY to avoid Instagram rate-limiting ("Fatal" errors)
      // Deduplicate URLs first  -  Instagram rejects duplicate images in a carousel
      const uniqueUrls = [...new Set(mediaUrls)];
      const childIds: string[] = [];
      for (const url of uniqueUrls) {
        try {
          const itemId = await createCarouselItem(instagramAccountId, instagramToken, url);
          // NOTE: We intentionally skip waitForContainerReady here.
          // The token cannot query carousel item status (returns code 100/33 — Authorization Error).
          // Waiting 8s + 25s per item for 9 items = ~300s, which exceeds Railway's HTTP timeout.
          // Live testing confirms Instagram accepts carousel publish without item status polling —
          // Instagram processes items asynchronously and the carousel publish call handles it.
          childIds.push(itemId);
        } catch (itemErr: any) {
          console.warn(`[Publish] Skipping carousel item (${url.slice(-20)}): ${itemErr?.message}`);
          // Skip failed items  -  continue if we still have enough
        }
      }

      // Give Instagram a brief moment to register all the item containers before building carousel
      if (childIds.length > 0) {
        await new Promise((r) => setTimeout(r, 5_000));
      }

      if (childIds.length < 2) {
        throw new Error(
          `Not enough carousel items created (${childIds.length}/${uniqueUrls.length}). ` +
          "Instagram requires at least 2 items for a carousel."
        );
      }

      console.log(`[Publish] Created ${childIds.length} carousel item containers`);
      const carouselContainerId = await createCarouselContainer(
        instagramAccountId,
        instagramToken,
        childIds,
        caption
      );
      instagramPostId = await publishMediaContainer(
        instagramAccountId,
        instagramToken,
        carouselContainerId
      );
    } else {
      // Single image publish flow  -  verify URL is accessible before giving it to Instagram
      let finalUrl = mediaUrls[0];

      // Step A: verify the URL actually serves a real image
      console.log(`[Publish] Verifying image URL: ${finalUrl}`);
      const check = await verifyImageUrl(finalUrl);

      if (!check.ok) {
        console.warn(`[Publish] URL failed verification (${check.reason})  -  re-generating fresh image`);
        // Step B: re-render + re-upload to get a fresh working URL
        const freshUrl = await generateFreshCdnUrl(post);
        if (freshUrl) {
          const recheck = await verifyImageUrl(freshUrl);
          if (recheck.ok) {
            finalUrl = freshUrl;
            // Cache the working URL so next publish is instant
            await prisma.post.update({ where: { id }, data: { mediaUrls: [freshUrl] } });
            console.log(`[Publish] Fresh URL verified OK: ${freshUrl}`);
          } else {
            throw new Error(
              `Image CDN is not publicly accessible (${recheck.reason}). ` +
              "Add CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET to .env.local for reliable image hosting."
            );
          }
        } else {
          throw new Error(
            `Image URL is not accessible by Instagram (${check.reason}). ` +
            "Add CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET to .env.local for reliable image hosting."
          );
        }
      } else {
        console.log(`[Publish] Image URL verified OK  -  creating container`);
      }

      const containerId = await createMediaContainer(
        instagramAccountId,
        instagramToken,
        finalUrl,
        caption
      );
      instagramPostId = await publishMediaContainer(
        instagramAccountId,
        instagramToken,
        containerId
      );
    }

    const now = new Date();

    // Update post status in DB
    const updatedPost = await prisma.post.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        instagramPostId,
        publishedAt: now,
      },
    });

    // ── Guard: cancel any pending ScheduledPost for this postId ──────────────
    // When a post is uploaded from the media folder, both a Post (status=SCHEDULED)
    // and a ScheduledPost (status=PENDING) are created. If the user manually clicks
    // "Publish Now", we mark the Post PUBLISHED here. We must also cancel the
    // ScheduledPost so the scheduler doesn't publish the same content a second time.
    // Also clear the __CLAIMING__ sentinel in case the scheduler atomically claimed
    // this SP milliseconds before the manual publish completed.
    await prisma.scheduledPost.updateMany({
      where: {
        postId: id,
        status: { in: ["PENDING"] },
      },
      data: { status: "PUBLISHED", instagramPostId, publishedAt: now },
    }).catch(() => {});

    // Also catch the transient __CLAIMING__ sentinel (scheduler claimed but not yet published)
    await prisma.scheduledPost.updateMany({
      where: { postId: id, status: "FAILED", error: "__CLAIMING__" },
      data:  { status: "PUBLISHED", instagramPostId, publishedAt: now, error: null },
    }).catch(() => {});

    // Create analytics record (starts at zero, fetched later via /instagram/analytics)
    // Stamp brandId from the resolved post so the row is scoped to the same brand
    // (NULL for the primary brand — byte-for-byte unchanged in single-account use).
    await prisma.analytics.upsert({
      where: { postId: id },
      create: { postId: id, brandId: (updatedPost as any).brandId } as any,
      update: {},
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: "POST_PUBLISHED",
        entity: "Post",
        entityId: id,
        metadata: { instagramPostId, publishedAt: now.toISOString() },
      },
    });

    // ── Delete from Cloudinary after successful Instagram publish ─────────────
    // Instagram has already downloaded and cached the image  -  the Cloudinary copy
    // is now redundant. We await deletion so it actually completes, then clear
    // mediaUrls from the DB (prevents a broken-image link in the dashboard).
    const cloudinaryUrls = mediaUrls.filter((u) => u.includes("res.cloudinary.com"));

    // ── Facebook Page cross-post (Settings → "Also publish to Facebook Page") ──
    // Must run BEFORE the Cloudinary cleanup below — it reuses the same public media
    // URL. Best-effort: never fails the (already successful) Instagram publish.
    try {
      const fbPrefs = await readPreferencesForBrand(brandId ?? null);
      if (fbPrefs.autoPost?.publishToFacebook && cloudinaryUrls.length > 0) {
        const creds        = await getBrandCredentials(brandId ?? null);
        const fbPageId     = (process.env.FACEBOOK_PAGE_ID?.trim()) || (creds as any)?.fbPageId || "";
        const isPrimaryBrand = (brandId ?? null) === null || brandId === primaryId;
        if (fbPageId && instagramToken) {
          const pageToken = await getPageToken(instagramToken, fbPageId, isPrimaryBrand);
          if (pageToken) {
            const fbUrl = cloudinaryUrls[0];
            await crossPostToFacebookPage({ pageId: fbPageId, pageToken, mediaUrl: fbUrl, isVideo: isVideoUrl(fbUrl), caption });
          }
        }
      }
    } catch (fbErr: any) {
      console.warn("[Publish] Facebook cross-post failed:", fbErr?.message ?? fbErr);
    }

    if (cloudinaryUrls.length > 0) {
      const deleteResults = await Promise.allSettled(
        cloudinaryUrls.map((url) => deleteFromCloudinary(url))
      );
      deleteResults.forEach((r, i) => {
        if (r.status === "rejected") {
          console.warn(`[Publish] Cloudinary delete failed for ${cloudinaryUrls[i]}:`, r.reason);
        }
      });

      // Clear the Cloudinary URLs from the DB  -  post is now on Instagram, we don't need them
      await prisma.post.update({
        where: { id },
        data:  { mediaUrls: [] },
      }).catch(() => {});
    }

    // ── BOTH: best-effort mirror to YouTube as a Short ───────────────────────
    // The Instagram post is already live, so a YouTube failure must NOT fail the
    // request. On success we store youtubeVideoId and surface it in the response.
    let youtube: { ok: true; youtubeVideoId: string; youtubeUrl: string } | { ok: false; error: string } | undefined;
    if (platform === "both" && !post.youtubeVideoId) {
      if (!isYouTubeConfigured(ytCreds)) {
        youtube = { ok: false, error: "YouTube is not connected." };
        console.warn("[Post Publish] Skipping YouTube mirror — YouTube not configured");
      } else {
        try {
          const ytResult = await publishYouTubeShortForPost(post, brandId, ytCreds);
          await prisma.post.update({
            where: { id },
            data: { youtubeVideoId: ytResult.videoId },
          }).catch(() => {});
          // Mirror the video id onto every claimed ScheduledPost (already PUBLISHED) too.
          if (claimedScheduledPostIds.length > 0) {
            await prisma.scheduledPost.updateMany({
              where: { id: { in: claimedScheduledPostIds } },
              data:  { youtubeVideoId: ytResult.videoId },
            }).catch(() => {});
          }
          youtube = { ok: true, youtubeVideoId: ytResult.videoId, youtubeUrl: ytResult.url };
        } catch (ytErr: unknown) {
          const ytMessage = ytErr instanceof Error ? ytErr.message : "YouTube publish failed";
          console.warn(`[Post Publish] YouTube mirror failed (IG post is live): ${ytMessage}`);
          youtube = { ok: false, error: ytMessage };
        }
      }
    }

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        post: updatedPost,
        instagramPostId,
        publishedAt: now,
        ...(youtube?.ok ? { youtubeVideoId: youtube.youtubeVideoId, youtubeUrl: youtube.youtubeUrl } : {}),
        ...(youtube ? { youtube } : {}),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Post Publish] Error:", message);

    // Mark post as failed in DB (id was already resolved at the top of try block)
    const { id } = await params; // params is a resolved Promise  -  safe to await again
    await prisma.post
      .update({
        where: { id },
        data: { status: "FAILED" },
      })
      .catch(() => {});

    // Restore ALL claimed ScheduledPosts to PENDING so the scheduler can retry them,
    // rather than leaving any stuck on the __CLAIMING__ sentinel.
    if (claimedScheduledPostIds.length > 0) {
      await prisma.scheduledPost
        .updateMany({
          where: { id: { in: claimedScheduledPostIds } },
          data:  { status: "PENDING", error: null },
        })
        .catch(() => {});
    }

    // Send failure email notification (best-effort, rate-limited per post)
    notifyPostFailed({ postId: id, error: message }).catch(() => {});

    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}
