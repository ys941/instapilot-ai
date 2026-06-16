import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────

const UpdateScheduleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(5000).optional(),
  hashtags: z.array(z.string()).max(30).optional(),
  mediaUrl: z.string().url().optional().nullable(),
  scheduledFor: z.string().datetime().optional(),
  timezone: z.string().optional(),
  isRecurring: z.boolean().optional(),
  recurringRule: z.string().max(200).optional().nullable(),
});

// ─────────────────────────────────────────────
// Helper  -  verify scheduled post ownership
// ─────────────────────────────────────────────

async function getOwnedSchedule(userId: string, scheduleId: string) {
  const s = await prisma.scheduledPost.findUnique({ where: { id: scheduleId } });
  if (!s || s.userId !== userId) return null;
  return s;
}

// ─────────────────────────────────────────────
// PUT / PATCH  -  Update scheduled post
// ─────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return PUT(request, ctx);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", data: null },
        { status: 401 }
      );
    }

    const { id } = await params;
    const existing = await getOwnedSchedule(session.user.id, id);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Scheduled post not found", data: null },
        { status: 404 }
      );
    }

    if (existing.status !== "PENDING") {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot update a scheduled post with status: ${existing.status}`,
          data: null,
        },
        { status: 409 }
      );
    }

    const body = await request.json();
    const validation = UpdateScheduleSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: validation.error.flatten(),
          data: null,
        },
        { status: 400 }
      );
    }

    const updates = validation.data;

    // Validate new scheduled time if provided
    if (updates.scheduledFor) {
      const newDate = new Date(updates.scheduledFor);
      if (newDate <= new Date()) {
        return NextResponse.json(
          {
            success: false,
            error: "Rescheduled time must be in the future",
            data: null,
          },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.scheduledPost.update({
      where: { id },
      data: {
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.content !== undefined && { content: updates.content }),
        ...(updates.hashtags !== undefined && { hashtags: updates.hashtags }),
        ...(updates.mediaUrl !== undefined && { mediaUrl: updates.mediaUrl }),
        ...(updates.scheduledFor !== undefined && {
          scheduledFor: new Date(updates.scheduledFor),
        }),
        ...(updates.timezone !== undefined && { timezone: updates.timezone }),
        ...(updates.isRecurring !== undefined && { isRecurring: updates.isRecurring }),
        ...(updates.recurringRule !== undefined && {
          recurringRule: updates.recurringRule,
        }),
      },
    });

    // Sync linked post if exists
    if (existing.postId && updates.scheduledFor) {
      await prisma.post.updateMany({
        where: { id: existing.postId, userId: session.user.id },
        data: { scheduledFor: new Date(updates.scheduledFor) },
      });
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: "SCHEDULE_UPDATED",
        entity: "ScheduledPost",
        entityId: id,
        metadata: { updatedFields: Object.keys(updates) },
      },
    });

    return NextResponse.json({ success: true, error: null, data: { scheduledPost: updated } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Scheduler PUT] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
// DELETE  -  Cancel scheduled post
// ─────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", data: null },
        { status: 401 }
      );
    }

    const { id } = await params;
    const existing = await getOwnedSchedule(session.user.id, id);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Scheduled post not found", data: null },
        { status: 404 }
      );
    }

    if (existing.status === "PUBLISHED") {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot cancel an already-published post",
          data: null,
        },
        { status: 409 }
      );
    }

    // Mark as cancelled (soft delete keeps audit trail)
    const cancelled = await prisma.scheduledPost.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    // Revert linked post status to DRAFT
    if (existing.postId) {
      await prisma.post.updateMany({
        where: { id: existing.postId, userId: session.user.id },
        data: { status: "DRAFT", scheduledFor: null },
      });
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: "SCHEDULE_CANCELLED",
        entity: "ScheduledPost",
        entityId: id,
        metadata: { title: existing.title },
      },
    });

    return NextResponse.json({
      success: true,
      error: null,
      data: { scheduledPost: cancelled, message: "Schedule cancelled successfully" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Scheduler DELETE] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}
