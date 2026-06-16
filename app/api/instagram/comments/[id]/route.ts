import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

// ─── POST /api/instagram/comments/[id]/reply ──────────────────
// Replies to a comment on an Instagram post.
// Uses the IG Graph API: POST /{comment-id}/replies
// ─────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    const token = session?.user?.instagramToken || process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Instagram not configured", data: null },
        { status: 422 }
      );
    }

    const { id: commentId } = await params;
    const body = await request.json();
    const { message } = body as { message?: string };

    if (!message?.trim()) {
      return NextResponse.json(
        { success: false, error: "Reply message is required", data: null },
        { status: 400 }
      );
    }

    // POST /{comment-id}/replies with message
    const res = await fetch(
      `${GRAPH_BASE}/${commentId}/replies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          access_token: token,
        }),
      }
    );

    const data = await res.json();

    if (data.error) {
      // Instagram may block replies if the token lacks instagram_manage_comments scope
      return NextResponse.json(
        {
          success: false,
          error: `Instagram API: ${data.error.message}`,
          hint: "Ensure your token has the 'instagram_manage_comments' permission.",
          data: null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      error: null,
      data: { replyId: data.id, commentId },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[IG Comment Reply POST] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

// ─── POST /api/instagram/comments/[id]/like ──────────────────
// Likes an Instagram comment.
// Uses: POST /{comment-id}/likes
// ─────────────────────────────────────────────────────────────
export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    const token = session?.user?.instagramToken || process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Instagram not configured", data: null },
        { status: 422 }
      );
    }

    const { id: commentId } = await params;

    const res = await fetch(
      `${GRAPH_BASE}/${commentId}/likes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token }),
      }
    );

    const data = await res.json();

    if (data.error) {
      return NextResponse.json(
        { success: false, error: `Instagram API: ${data.error.message}`, data: null },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      error: null,
      data: { liked: true, commentId },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[IG Comment Like PUT] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}
