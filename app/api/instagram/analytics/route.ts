﻿import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveBrandId, getPrimaryBrandId, getBrandCredentials } from "@/lib/brands";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

export async function GET(request: NextRequest) {
  try {
    // Resolve the requested brand (no ?brand= ⇒ primary). For the primary brand the
    // credentials below resolve exactly as before (session/env), so single-account
    // behaviour is byte-for-byte unchanged.
    const brandParam = request.nextUrl.searchParams.get("brand");
    const resolvedBrandId = await resolveBrandId(brandParam);
    const primaryId       = await getPrimaryBrandId();
    const isPrimaryBrand  = resolvedBrandId === primaryId;

    const session = await getServerSession();
    let token: string | undefined;
    let igId:  string | undefined;
    if (isPrimaryBrand) {
      // Unchanged primary path: session token wins, then env.
      token = session?.user?.instagramToken || process.env.INSTAGRAM_ACCESS_TOKEN;
      igId  = session?.user?.instagramAccountId || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    } else {
      const creds = await getBrandCredentials(resolvedBrandId);
      token = creds.igToken;
      igId  = creds.igAcctId;
    }

    if (!token || !igId) {
      return NextResponse.json(
        { success: false, error: "Instagram credentials not configured in .env.local", data: null },
        { status: 422 }
      );
    }

    // -- 1. Profile (always works with any IG token) ------------------------
    const profileRes = await fetch(
      `${GRAPH_BASE}/${igId}?fields=id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url&access_token=${token}`
    );
    const profile = await profileRes.json();

    if (profile.error) {
      throw new Error(`Graph API: ${profile.error.message}`);
    }

    // -- 2. Recent media (last 12 posts) ------------------------------------
    const mediaRes = await fetch(
      `${GRAPH_BASE}/${igId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,like_count,comments_count,timestamp,is_shared_to_feed&limit=12&access_token=${token}`
    );
    const mediaData = await mediaRes.json();
    const media = mediaData.data ?? [];

    // -- 3. Insights (requires Business/Creator account  -  fail gracefully) --
    // NOTE: "impressions" and "profile_views" were REMOVED in Graph API v22+ and
    // make the whole call error (→ empty insights). Only "reach" is reliably
    // available at account level with period=day on this account.
    let insights: Record<string, number> = {};
    try {
      const insightRes = await fetch(
        `${GRAPH_BASE}/${igId}/insights?metric=reach&period=day&access_token=${token}`
      );
      const insightData = await insightRes.json();
      if (!insightData.error && insightData.data) {
        for (const item of insightData.data) {
          const latest = item.values?.[item.values.length - 1]?.value ?? 0;
          insights[item.name] = latest;
        }
      }
    } catch {
      // Insights require Business account  -  skip silently
    }

    // -- 4. Calculate engagement --------------------------------------------
    const followers = profile.followers_count ?? 0;
    const totalLikes    = media.reduce((s: number, p: any) => s + (p.like_count    ?? 0), 0);
    const totalComments = media.reduce((s: number, p: any) => s + (p.comments_count ?? 0), 0);
    const avgEngagement = media.length > 0 && followers > 0
      ? (((totalLikes + totalComments) / media.length) / followers) * 100
      : 0;

    // -- 5. Persist snapshot ------------------------------------------------
    await prisma.accountAnalytics.create({
      data: {
        followers,
        following:    profile.follows_count ?? 0,
        posts:        profile.media_count   ?? 0,
        reach:        insights["reach"]         ?? 0,
        impressions:  insights["impressions"]   ?? 0,
        profileVisits:insights["profile_views"] ?? 0,
        websiteClicks:insights["website_clicks"]?? 0,
        engagementRate: Math.round(avgEngagement * 100) / 100,
        // Stamp brandId: NULL for the primary brand (unchanged), the brand id otherwise.
        brandId: isPrimaryBrand ? null : resolvedBrandId,
      } as any,
    });

    return NextResponse.json({
      success: true,
      data: {
        profile: {
          username:     profile.username,
          name:         profile.name,
          biography:    profile.biography,
          website:      profile.website,
          profilePicture: profile.profile_picture_url,
          followers,
          following:    profile.follows_count,
          mediaCount:   profile.media_count,
        },
        insights: {
          reach:         insights["reach"]         ?? 0,
          impressions:   insights["impressions"]   ?? 0,
          profileVisits: insights["profile_views"] ?? 0,
          websiteClicks: insights["website_clicks"]?? 0,
          engagementRate: Math.round(avgEngagement * 100) / 100,
          totalLikes,
          totalComments,
        },
        recentMedia: media.slice(0, 6),
        topPosts: [...media]
          .sort((a: any, b: any) => (b.like_count + b.comments_count) - (a.like_count + a.comments_count))
          .slice(0, 5),
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[IG Analytics GET] Error:", message);
    return NextResponse.json({ success: false, error: message, data: null }, { status: 500 });
  }
}

