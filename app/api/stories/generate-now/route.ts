/**
 * POST /api/stories/generate-now
 *
 * Manually generate AND publish a fresh Instagram Story RIGHT NOW.
 * Bypasses the once-per-day guard (force = true) so it works even if today's
 * story already posted. Used by the "Post a Story Now" button in Settings.
 */

import { NextResponse } from "next/server";
import { scheduleAutoStory, publishOverdueScheduled, getCredentials } from "@/lib/catchup";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // 1. Force-create a new story scheduled for NOW (skips the daily guard).
    //    This is the slow part (AI generation) but completes in ~10s.
    const storyId = await scheduleAutoStory(true);
    if (!storyId) {
      return NextResponse.json(
        { success: false, error: "Could not generate a story (check story settings / AI provider)" },
        { status: 500 },
      );
    }

    // 2. Kick off the publish in the BACKGROUND so the request returns fast and
    //    never hits an edge/proxy timeout. The story is scheduled for now, so the
    //    regular 30-second catch-up cycle would publish it anyway — this just makes
    //    it instant. We don't await it.
    (async () => {
      try {
        const { igToken, igAcctId } = await getCredentials();
        if (igToken && igAcctId) {
          const errors: string[] = [];
          const { published, failed } = await publishOverdueScheduled(errors, igToken, igAcctId);
          console.log(`[generate-now] Background publish — published:${published} failed:${failed} ${errors[0] ?? ""}`);
        }
      } catch (e) {
        console.error("[generate-now] Background publish error:", e);
      }
    })();

    return NextResponse.json({
      success: true,
      data: { storyId, message: "Story generated 🎉 — posting to Instagram now (a few seconds)" },
    });
  } catch (err) {
    console.error("[/api/stories/generate-now] Error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
