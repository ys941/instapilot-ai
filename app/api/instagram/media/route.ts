import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    const token = session?.user?.instagramToken || process.env.INSTAGRAM_ACCESS_TOKEN;
    const igId  = session?.user?.instagramAccountId || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    if (!token || !igId) {
      return NextResponse.json(
        { success: false, error: "Instagram not configured", data: null },
        { status: 422 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit  = searchParams.get("limit")  ?? "20";
    const after  = searchParams.get("after")  ?? "";

    const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,like_count,comments_count,timestamp,is_shared_to_feed";
    const params = new URLSearchParams({ fields, limit, access_token: token });
    if (after) params.set("after", after);

    const res  = await fetch(`${GRAPH_BASE}/${igId}/media?${params}`);
    const data = await res.json();

    if (data.error) throw new Error(data.error.message);

    const media = (data.data ?? []).map((m: any) => ({
      id:            m.id,
      caption:       m.caption ?? "",
      mediaType:     m.media_type,
      mediaUrl:      m.media_url ?? m.thumbnail_url ?? null,
      permalink:     m.permalink,
      likeCount:     m.like_count     ?? 0,
      commentsCount: m.comments_count ?? 0,
      timestamp:     m.timestamp,
      engagementRate: 0, // filled below if followers known
    }));

    return NextResponse.json({
      success: true,
      data: {
        media,
        paging: data.paging ?? null,
        total: media.length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[IG Media GET] Error:", message);
    return NextResponse.json({ success: false, error: message, data: null }, { status: 500 });
  }
}

