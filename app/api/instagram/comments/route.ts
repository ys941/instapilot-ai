﻿/**
 * GET /api/instagram/comments
 *
 * Fetches comments with nested replies from Instagram Graph API.
 * The analytics page sets refetchInterval: false and relies on the webhook
 * counter (polled every 5s) to trigger refetches  -  so this only runs when
 * a real event arrives, not on a fixed timer.
 * Typical call rate: ~5-20x/hour (webhook-driven) vs the previous 360x/hour.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

const POSITIVE = ["great","amazing","excellent","love","perfect","helpful","informative","brilliant","thank","thanks","useful","good","nice","best","awesome","insightful","educational","learned","interesting","clear","well","superb","wonderful","fantastic"];
const NEGATIVE = ["bad","terrible","wrong","incorrect","misleading","disagree","confused","poor","awful","horrible","worst","hate","useless","boring","complicated","unclear","error","mistake","incorrect"];

function sentiment(text: string): "positive" | "negative" | "neutral" {
  const lower = text.toLowerCase();
  const pos = POSITIVE.filter(w => lower.includes(w)).length;
  const neg = NEGATIVE.filter(w => lower.includes(w)).length;
  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

export const dynamic = "force-dynamic";

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
    const limit = parseInt(searchParams.get("limit") ?? "30");

    // Fetch recent media IDs
    const mediaRes  = await fetch(
      `${GRAPH_BASE}/${igId}/media?fields=id,timestamp&limit=10&access_token=${token}`
    );
    const mediaData = await mediaRes.json();
    if (mediaData.error) throw new Error(mediaData.error.message);

    const mediaList: { id: string }[] = mediaData.data ?? [];

    // Fetch comments + nested replies for each post in parallel
    const commentArrays = await Promise.all(
      mediaList.map(async (post) => {
        try {
          const res  = await fetch(
            `${GRAPH_BASE}/${post.id}/comments?fields=id,text,username,timestamp,like_count,replies{id,text,username,timestamp}&limit=50&access_token=${token}`
          );
          const data = await res.json();
          if (data.error) return [];

          // Look up our reply text from DB so the UI can show what we replied
          const igIds = (data.data ?? []).map((c: any) => c.id);
          const dbReplies = igIds.length > 0
            ? await prisma.comment.findMany({
                where: { instagramCommentId: { in: igIds } },
                select: { instagramCommentId: true, replied: true, replyText: true },
              })
            : [];
          const replyMap = new Map(dbReplies.map(r => [r.instagramCommentId, r]));

          return (data.data ?? []).map((c: any) => ({
            id:        c.id,
            postId:    post.id,
            mediaId:   post.id,
            username:  c.username ?? "unknown",
            text:      c.text ?? "",
            timestamp: c.timestamp,
            createdAt: c.timestamp,
            likeCount: c.like_count ?? 0,
            sentiment: sentiment(c.text ?? ""),
            replied:   replyMap.get(c.id)?.replied   ?? false,
            replyText: replyMap.get(c.id)?.replyText ?? null,
            replies: (c.replies?.data ?? []).map((r: any) => ({
              id:        r.id,
              username:  r.username ?? "unknown",
              text:      r.text     ?? "",
              timestamp: r.timestamp,
            })),
          }));
        } catch {
          return [];
        }
      })
    );

    const allComments = commentArrays
      .flat()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    const sentimentCounts = {
      positive: allComments.filter(c => c.sentiment === "positive").length,
      negative: allComments.filter(c => c.sentiment === "negative").length,
      neutral:  allComments.filter(c => c.sentiment === "neutral").length,
    };

    return NextResponse.json({
      success: true,
      data: { comments: allComments, total: allComments.length, sentiment: sentimentCounts },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[IG Comments GET] Error:", message);
    return NextResponse.json({ success: false, error: message, data: null }, { status: 500 });
  }
}

