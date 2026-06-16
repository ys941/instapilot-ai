﻿import { NextResponse } from "next/server";
import { runCommentCheck } from "@/lib/catchup";

export const dynamic = "force-dynamic";

/**
 * GET /api/comments/check
 * Fast 1-minute comment check  -  called by the dashboard every 60 seconds.
 * Only checks the 2 most recent posts; replies immediately with AI.
 * Has its own 60-second debounce inside runCommentCheck() so concurrent
 * calls from multiple open tabs are harmless.
 */
export async function GET() {
  try {
    const result = await runCommentCheck();
    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    console.error("[/api/comments/check] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message ?? "Comment check failed" },
      { status: 500 }
    );
  }
}

