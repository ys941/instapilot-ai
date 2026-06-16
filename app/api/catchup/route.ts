/**
 * POST /api/catchup
 *
 * Manually trigger a full catch-up cycle:
 *   1. Publish any overdue scheduled posts
 *   2. Fetch new comments on published posts and store them
 *   3. Auto-reply to DMs that have not been responded to
 *
 * Called by the "Post a Story Now" / "Run Now" buttons in Settings -> Stories tab.
 * The endpoint is rate-limited internally  -  repeated calls within 2 minutes are
 * debounced by lib/catchup.ts (returns the previous result instantly).
 *
 * GET /api/catchup  -  returns the last catch-up result (or a placeholder if never run).
 */

import { NextResponse } from "next/server";
import { runCatchup } from "@/lib/catchup";

export const dynamic = "force-dynamic";

// Last result cache for GET requests
let lastResult: Awaited<ReturnType<typeof runCatchup>> | null = null;

export async function POST() {
  try {
    const result = await runCatchup();
    lastResult = result;
    return NextResponse.json({
      success: true,
      data:    result,
    });
  } catch (err) {
    console.error("[/api/catchup] Error:", err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  if (!lastResult) {
    return NextResponse.json({
      success: true,
      data: {
        scheduledPublished: 0,
        scheduledFailed:    0,
        newComments:        0,
        commentsReplied:    0,
        dmsReplied:         0,
        errors:             [],
        ranAt:              null,
        note:               "Catchup has not run yet since the last server start.",
      },
    });
  }
  return NextResponse.json({ success: true, data: lastResult });
}
