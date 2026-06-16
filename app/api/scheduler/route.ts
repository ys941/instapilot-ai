﻿import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ---------------------------------------------
// VALIDATION
// ---------------------------------------------

const SchedulePostSchema = z.object({
  postId:  z.string().nullish(),
  postType: z.string().nullish(),                   // "STORY" for stories; null = regular post
  title:   z.string().min(1).max(500).nullish(),   // looked up from postId if omitted
  content: z.string().min(1).max(50000).nullish(),  // looked up from postId if omitted
  hashtags: z.array(z.string()).max(50).default([]),
  mediaUrl: z.string().url().nullish(),
  scheduledFor: z.string().datetime({ offset: true }),
  timezone: z.string().default("Asia/Kolkata"),
  isRecurring: z.boolean().default(false),
  recurringRule: z.string().max(200).nullish(),
  platform: z.enum(["instagram", "youtube", "both"]).default("instagram"),
});

// ---------------------------------------------
// GET  -  List scheduled posts for calendar view
// ---------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", data: null },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const status = searchParams.get("status");

    const where: Prisma.ScheduledPostWhereInput = {
      userId: session.user.id,
      ...(status ? { status: status as any } : {}),
      ...(from || to
        ? {
            scheduledFor: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const scheduledPosts = await prisma.scheduledPost.findMany({
      where,
      orderBy: { scheduledFor: "asc" },
    });

    // Collect post IDs already covered by a ScheduledPost entry so we can deduplicate.
    // When a post is scheduled via the scheduler, BOTH a ScheduledPost row AND a
    // Post.status="SCHEDULED" update are written  -  querying both causes the same post
    // to appear twice on the calendar. Only include a Post-based entry if it has NO
    // corresponding ScheduledPost (i.e. it was scheduled via a different code path).
    const coveredPostIds = new Set(
      scheduledPosts.map((sp) => sp.postId).filter(Boolean)
    );

    const draftScheduled = await prisma.post.findMany({
      where: {
        userId: session.user.id,
        status: "SCHEDULED",
        scheduledFor: { not: null },
        // Only include posts that are NOT already represented in the ScheduledPost table
        id: { notIn: coveredPostIds.size > 0 ? Array.from(coveredPostIds) as string[] : ["__none__"] },
        ...(from || to
          ? {
              scheduledFor: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        title: true,
        content: true,
        hashtags: true,
        scheduledFor: true,
        status: true,
        type: true,
        mediaUrls: true,
      },
    });

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        scheduledPosts,
        draftScheduled,
        total: scheduledPosts.length + draftScheduled.length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Scheduler GET] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

// ---------------------------------------------
// POST  -  Schedule a new post
// ---------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", data: null },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validation = SchedulePostSchema.safeParse(body);
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

    const data = validation.data;
    const scheduledForDate = new Date(data.scheduledFor);

    // Ensure the scheduled time is in the future
    if (scheduledForDate <= new Date()) {
      return NextResponse.json(
        {
          success: false,
          error: "Scheduled time must be in the future",
          data: null,
        },
        { status: 400 }
      );
    }

    // If postId provided but title/content omitted  -  look them up
    let resolvedTitle = data.title ?? "";
    let resolvedContent = data.content ?? "";
    let resolvedHashtags = data.hashtags;
    let resolvedMediaUrl = data.mediaUrl;

    // Whether the client explicitly sent a platform  -  if not, we can inherit
    // it from the linked Post (the Zod default would otherwise mask omission).
    const platformProvided = body != null && typeof body === "object" && "platform" in body;
    let resolvedPlatform = data.platform;

    if (data.postId && (!resolvedTitle || !resolvedContent || !platformProvided)) {
      const linkedPost = await prisma.post.findUnique({
        where: { id: data.postId, userId: session.user.id },
      });
      if (!linkedPost) {
        return NextResponse.json(
          { success: false, error: "Post not found", data: null },
          { status: 404 }
        );
      }
      resolvedTitle = resolvedTitle || linkedPost.title;
      resolvedContent = resolvedContent || linkedPost.content;
      resolvedHashtags = resolvedHashtags.length ? resolvedHashtags : linkedPost.hashtags;
      resolvedMediaUrl = resolvedMediaUrl ?? (linkedPost.mediaUrls[0] ?? undefined);
      if (!platformProvided) {
        resolvedPlatform = (linkedPost.platform as typeof resolvedPlatform) ?? "instagram";
      }
    }

    if (!resolvedTitle || !resolvedContent) {
      return NextResponse.json(
        { success: false, error: "title and content are required (or provide a valid postId)", data: null },
        { status: 400 }
      );
    }

    const scheduledPost = await prisma.scheduledPost.create({
      data: {
        userId:       session.user.id,
        postId:       data.postType === "STORY" ? null : (data.postId ?? null),
        postType:     data.postType ?? null,
        title:        resolvedTitle,
        content:      resolvedContent,
        hashtags:     resolvedHashtags,
        mediaUrl:     resolvedMediaUrl,
        scheduledFor: scheduledForDate,
        timezone:     data.timezone,
        isRecurring:  data.isRecurring,
        recurringRule: data.recurringRule,
        platform:     resolvedPlatform,
        status:       "PENDING",
      },
    });

    // If a linked post exists, update its scheduledFor and status
    if (data.postId) {
      await prisma.post.updateMany({
        where: { id: data.postId, userId: session.user.id },
        data: { scheduledFor: scheduledForDate, status: "SCHEDULED" },
      });
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: "POST_SCHEDULED",
        entity: "ScheduledPost",
        entityId: scheduledPost.id,
        metadata: {
          scheduledFor: scheduledForDate.toISOString(),
          timezone: data.timezone,
          isRecurring: data.isRecurring,
        },
      },
    });

    return NextResponse.json(
      { success: true, error: null, data: { scheduledPost } },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Scheduler POST] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

