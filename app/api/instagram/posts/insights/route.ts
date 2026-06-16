﻿/**
 * GET /api/instagram/posts/insights
 *
 * Fetches real-time per-post insights from Instagram Graph API,
 * upserts them into the Analytics table, and returns the enriched list.
 * Called by the analytics page on mount + every 60 s.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

export const dynamic = "force-dynamic";

export async function GET() {
  // Always fetch fresh token from DB so Settings updates take effect immediately
  const session  = await getServerSession();
  const IG_TOKEN = session?.user?.instagramToken || process.env.INSTAGRAM_ACCESS_TOKEN || "";

  if (!IG_TOKEN) {
    return NextResponse.json({ success: false, error: "No Instagram token configured", data: null }, { status: 422 });
  }

  const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";

  // -- Step 1: Fetch media list DIRECTLY from Instagram (source of truth) ------
  // This works even if the DB was cleared  -  Instagram is always the source of truth.
  let igMediaIds: string[] = [];
  try {
    const mediaListRes  = await fetch(
      `${GRAPH_BASE}/${IG_ACCOUNT_ID}/media?fields=id&limit=20&access_token=${IG_TOKEN}`
    );
    const mediaListData = await mediaListRes.json();
    if (!mediaListData.error && Array.isArray(mediaListData.data)) {
      igMediaIds = (mediaListData.data as { id: string }[]).map((m) => m.id);
    }
  } catch { /* fall through to DB-only path */ }

  // -- Step 2: Load DB posts (for metadata like title, type, content) -----------
  const dbPostsByIgId = new Map<string, any>();
  if (igMediaIds.length > 0) {
    const dbPosts = await prisma.post.findMany({
      where:   { instagramPostId: { in: igMediaIds } },
      select:  { id: true, instagramPostId: true, title: true, type: true, publishedAt: true, content: true, hashtags: true, brandId: true },
    });
    for (const p of dbPosts) {
      if (p.instagramPostId) dbPostsByIgId.set(p.instagramPostId, p);
    }
  }

  // -- Step 3: Also include any DB posts not yet in igMediaIds -----------------
  // (handles posts published before we started fetching IG media list)
  const dbOnlyPosts = await prisma.post.findMany({
    where:   { status: "PUBLISHED", instagramPostId: { not: null } },
    select:  { id: true, instagramPostId: true, title: true, type: true, publishedAt: true, content: true, hashtags: true, brandId: true },
    take:    20,
    orderBy: { publishedAt: "desc" },
  });
  for (const p of dbOnlyPosts) {
    if (p.instagramPostId && !igMediaIds.includes(p.instagramPostId)) {
      igMediaIds.push(p.instagramPostId);
      dbPostsByIgId.set(p.instagramPostId, p);
    }
  }

  if (igMediaIds.length === 0) {
    return NextResponse.json({ success: true, data: { posts: [], syncedAt: new Date().toISOString() } });
  }

  const results: any[] = [];

  for (const igPostId of igMediaIds) {
    // Build a synthetic post object  -  use DB data if available, IG id as fallback
    const post = dbPostsByIgId.get(igPostId) ?? {
      id: igPostId,               // use IG media id as stand-in DB id
      instagramPostId: igPostId,
      title: "Instagram Post",
      type:  "EDUCATIONAL",
      publishedAt: null,
      content: "",
      hashtags: [],
    };
    // Rewrite so the loop body sees { id, instagramPostId, ... }
    post.instagramPostId = igPostId;
    try {
      // -- Basic media stats (always available with instagram_basic scope) -----
      const mediaRes = await fetch(
        `${GRAPH_BASE}/${post.instagramPostId}?fields=like_count,comments_count,timestamp,media_url,thumbnail_url,permalink,media_type&access_token=${IG_TOKEN}`
      );
      const media = await mediaRes.json();
      if (media.error) {
        // Media not accessible — log the error so it's visible in Railway logs
        console.warn(`[IG Insights] Media fetch error for ${post.instagramPostId}: ${media.error.message} (code ${media.error.code})`);
        results.push({
          postId: post.id, instagramPostId: post.instagramPostId,
          title: post.title, type: post.type, publishedAt: post.publishedAt,
          content: (post.content ?? "").slice(0, 300),
          hashtags: post.hashtags ?? [],
          likes: 0, comments: 0, saves: 0, reach: 0, impressions: 0, engagementRate: 0,
          mediaUrl: null, thumbnail: null, permalink: null,
          error: media.error.message,
        });
        continue;
      }

      // like_count may be absent if the account hides likes — treat null as 0 but keep tracking
      const likes    = media.like_count     ?? 0;
      const comments = media.comments_count ?? 0;

      // -- Resolve thumbnail  -  CAROUSEL_ALBUM has no media_url on root node --
      let resolvedThumbnail: string | null = media.thumbnail_url ?? media.media_url ?? null;
      if (!resolvedThumbnail && media.media_type === "CAROUSEL_ALBUM") {
        try {
          const childRes  = await fetch(
            `${GRAPH_BASE}/${post.instagramPostId}/children?fields=id,media_url&limit=1&access_token=${IG_TOKEN}`
          );
          const childData = await childRes.json();
          resolvedThumbnail = childData?.data?.[0]?.media_url ?? null;
        } catch { /* ignore  -  thumbnail will be null */ }
      }

      // -- Per-post insights (requires instagram_manage_insights permission) ---
      // Metric availability differs by media type:
      //   IMAGE / CAROUSEL_ALBUM: impressions, reach, saved
      //   REEL / VIDEO: reach, saved, plays (impressions is not available for reels)
      let reach = 0, impressions = 0, saves = 0;
      try {
        const isReel = media.media_type === "REELS" || media.media_type === "VIDEO";
        // Use only metrics that work for ALL media types; skip impressions for reels
        const metricsForType = isReel
          ? "reach,saved,plays"
          : "impressions,reach,saved";

        // period=lifetime is required by IG Graph API v17+ for per-post media insights
        const insRes = await fetch(
          `${GRAPH_BASE}/${post.instagramPostId}/insights?metric=${metricsForType}&period=lifetime&access_token=${IG_TOKEN}`
        );
        const insData = await insRes.json();
        if (insData.error) {
          console.warn(`[IG Insights] Insights error for ${post.instagramPostId}: ${insData.error.message} (code ${insData.error.code}) — insight metrics require instagram_manage_insights permission`);
        } else if (insData.data) {
          for (const m of insData.data) {
            // period=lifetime: value is a direct number (no values[] array)
            // period=day:       value is in values[0].value
            // Handle both formats for compatibility
            const val = typeof m.value === "number"
              ? m.value
              : (m.values?.[0]?.value ?? 0);
            if (m.name === "reach")       reach       = val;
            if (m.name === "impressions") impressions = val;
            if (m.name === "plays")       impressions = val; // reels: plays = proxy for impressions
            if (m.name === "saved")       saves       = val;
          }
        }
      } catch (insErr: any) {
        console.warn(`[IG Insights] Insights fetch failed for ${post.instagramPostId}:`, insErr?.message);
      }

      // Engagement = (likes + comments + saves) / reach * 100
      const engagementRate = reach > 0 ? Math.round(((likes + comments + saves) / reach) * 10000) / 100 : 0;

      // -- Upsert Analytics record (only if post exists in DB) ------------
      const isDbPost = dbPostsByIgId.has(igPostId);
      if (isDbPost) {
        // Stamp brandId from the linked DB post (NULL for primary — unchanged).
        await prisma.analytics.upsert({
          where:  { postId: post.id },
          create: { postId: post.id, likes, comments, saves, reach, impressions, engagementRate, brandId: post.brandId ?? null } as any,
          update: { likes, comments, saves, reach, impressions, engagementRate, brandId: post.brandId ?? null } as any,
        }).catch(() => {}); // ignore FK errors if post was deleted between queries
      }

      // Use IG timestamp as publishedAt if no DB record
      const publishedAt = post.publishedAt ?? media.timestamp ?? null;
      // Derive a display title from media type when no DB title
      const title = post.title !== "Instagram Post"
        ? post.title
        : `${media.media_type ?? "Post"} Â· ${publishedAt ? new Date(publishedAt).toLocaleDateString() : igPostId.slice(-6)}`;

      results.push({
        postId:          post.id,
        instagramPostId: post.instagramPostId,
        title,
        type:            post.type,
        publishedAt,
        content:         (post.content ?? "").slice(0, 300),
        hashtags:        post.hashtags ?? [],
        likes,
        comments,
        saves,
        reach,
        impressions,
        engagementRate,
        mediaUrl:   media.media_url  ?? null,
        thumbnail:  resolvedThumbnail,
        permalink:  media.permalink  ?? null,
        mediaType:  media.media_type ?? null,
      });
    } catch (err: any) {
      // Never let one post failure abort the whole batch
      console.warn(`[IG Insights] Failed for post ${post.id}:`, err?.message);
    }
  }

  return NextResponse.json({
    success: true,
    data: { posts: results, syncedAt: new Date().toISOString() },
  });
}

