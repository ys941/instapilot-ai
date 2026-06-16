/**
 * /api/analytics/live
 *
 * Returns real-time Instagram account stats and recent post metrics
 * fetched directly from the Instagram Graph API (not DB).
 * Used by the overview page "Live data" badge.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { resolveBrandId, getPrimaryBrandId, getBrandCredentials } from "@/lib/brands";

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

    // Resolve the requested brand (no ?brand= ⇒ primary). getBrandCredentials for the
    // primary brand returns env creds (env wins), so the live-data path is byte-for-byte
    // identical to today when no brand is supplied.
    const brandParam = request.nextUrl.searchParams.get("brand");
    const resolvedBrandId = await resolveBrandId(brandParam);
    const primaryId       = await getPrimaryBrandId();
    const isPrimaryBrand  = resolvedBrandId === primaryId;

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

    // -- Fetch live account stats ---------------------------------------------
    // profile_views requires special permissions — use only guaranteed available fields
    const acctRes = await fetch(
      `${GRAPH_BASE}/${igAcctId}?fields=followers_count,media_count&access_token=${igToken}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const acctData = await acctRes.json();

    if (acctData.error) {
      return NextResponse.json(
        { success: false, error: acctData.error.message, data: null },
        { status: 502 }
      );
    }

    // -- Fetch last 10 posts with live metrics ---------------------------------
    const mediaRes = await fetch(
      `${GRAPH_BASE}/${igAcctId}/media?fields=id,like_count,comments_count,timestamp,media_url,permalink,media_type,caption&limit=10&access_token=${igToken}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const mediaData = await mediaRes.json();

    const posts: Array<{
      id: string;
      likeCount: number;
      commentsCount: number;
      timestamp: string;
      mediaUrl: string | null;
      permalink: string | null;
      mediaType: string;
      caption: string | null;
    }> = [];

    if (!mediaData.error && Array.isArray(mediaData.data)) {
      for (const m of mediaData.data) {
        posts.push({
          id:            m.id,
          likeCount:     m.like_count      ?? 0,
          commentsCount: m.comments_count  ?? 0,
          timestamp:     m.timestamp       ?? "",
          mediaUrl:      m.media_url       ?? null,
          permalink:     m.permalink       ?? null,
          mediaType:     m.media_type      ?? "IMAGE",
          caption:       m.caption         ?? null,
        });
      }
    }

    return NextResponse.json({
      success: true,
      error:   null,
      data: {
        account: {
          followersCount: acctData.followers_count ?? null,
          mediaCount:     acctData.media_count     ?? null,
        },
        posts,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Analytics Live GET] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}
