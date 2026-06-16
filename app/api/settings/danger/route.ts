/**
 * POST /api/settings/danger
 * Body: { action: "delete-drafts" | "clear-library" | "reset-ai" | "delete-scheduled" }
 *
 * Performs destructive operations with full authorization check.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writePreferences } from "@/lib/preferences";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await request.json();
    const action: string = body.action ?? "";

    switch (action) {
      case "delete-drafts": {
        const { count } = await prisma.post.deleteMany({
          where: { userId, status: "DRAFT" },
        });
        await prisma.activityLog.create({
          data: { userId, action: "DELETE_ALL_DRAFTS", entity: "Post", entityId: "bulk", metadata: { count } },
        }).catch(() => {});
        return NextResponse.json({ success: true, data: { deleted: count, action } });
      }

      case "delete-scheduled": {
        // Cancel all pending scheduled posts
        const { count } = await prisma.scheduledPost.updateMany({
          where: { userId, status: "PENDING" },
          data:  { status: "CANCELLED" },
        });
        // Also mark linked Post records as DRAFT
        await prisma.post.updateMany({
          where: { userId, status: "SCHEDULED" },
          data:  { status: "DRAFT" },
        }).catch(() => {});
        await prisma.activityLog.create({
          data: { userId, action: "CANCEL_ALL_SCHEDULED", entity: "ScheduledPost", entityId: "bulk", metadata: { count } },
        }).catch(() => {});
        return NextResponse.json({ success: true, data: { cancelled: count, action } });
      }

      case "clear-library": {
        // Delete all posts (cascade deletes analytics, etc.)
        const { count } = await prisma.post.deleteMany({ where: { userId } });
        // Cancel all scheduled posts too
        await prisma.scheduledPost.updateMany({
          where: { userId, status: "PENDING" },
          data:  { status: "CANCELLED" },
        }).catch(() => {});
        await prisma.activityLog.create({
          data: { userId, action: "CLEAR_LIBRARY", entity: "Post", entityId: "bulk", metadata: { count } },
        }).catch(() => {});
        return NextResponse.json({ success: true, data: { deleted: count, action } });
      }

      case "reset-ai": {
        // Reset AI preferences to defaults
        await writePreferences({
          ai: {
            defaultTone:  "Professional",
            defaultType:  "Educational",
            language:     "English",
            aiProvider:   "grok",
            geminiApiKey: "",
          },
        });
        return NextResponse.json({ success: true, data: { action } });
      }

      case "clear-activity": {
        const { count } = await prisma.activityLog.deleteMany({ where: { userId } });
        return NextResponse.json({ success: true, data: { deleted: count, action } });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[Settings Danger]", e?.message);
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

