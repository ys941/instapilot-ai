/**
 * GET /api/scheduler/failed
 * Returns recent FAILED scheduled posts + FAILED posts with their error messages.
 * Useful for diagnosing why a post was not published.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Recent failed scheduled posts (last 20, newest first)
    const failedScheduled = await prisma.scheduledPost.findMany({
      where:   { status: "FAILED" },
      orderBy: { scheduledFor: "desc" },
      take:    20,
      select: {
        id:           true,
        title:        true,
        postType:     true,
        scheduledFor: true,
        publishedAt:  true,
        error:        true,
        retryCount:   true,
      },
    });

    // Recent failed posts (last 10, newest first)
    const failedPosts = await prisma.post.findMany({
      where:   { userId: session.user.id, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take:    10,
      select: {
        id:        true,
        title:     true,
        type:      true,
        updatedAt: true,
        status:    true,
      },
    });

    // Also get any activity log entries for failed actions
    const failedLogs = await prisma.activityLog.findMany({
      where:   {
        userId:  session.user.id,
        action:  { in: ["POST_FAILED", "SCHEDULE_FAILED", "PUBLISH_ERROR"] },
      },
      orderBy: { createdAt: "desc" },
      take:    10,
      select:  { id: true, action: true, entity: true, entityId: true, createdAt: true, metadata: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        failedScheduledPosts: failedScheduled,
        failedPosts,
        failedLogs,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("[/api/scheduler/failed] Error:", err?.message);
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 });
  }
}
