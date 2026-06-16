﻿import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ---------------------------------------------
// ROUTE HANDLER  -  GET recent activity logs
// ---------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    const user = session?.user ?? { id: "local-user" };

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const action = searchParams.get("action");
    const entity = searchParams.get("entity");

    const where: Prisma.ActivityLogWhereInput = {
      userId: user.id,
      ...(action ? { action } : {}),
      ...(entity ? { entity } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.activityLog.count({ where }),
    ]);

    // Group by action for stats
    const actionStats = await prisma.activityLog.groupBy({
      by: ["action"],
      where: { userId: user.id },
      _count: { action: true },
      orderBy: { _count: { action: "desc" } },
      take: 10,
    });

    // Compute human-readable labels for each activity
    const ACTION_LABELS: Record<string, string> = {
      POST_CREATED: "Created a post",
      POST_UPDATED: "Updated a post",
      POST_DELETED: "Deleted a post",
      POST_PUBLISHED: "Published to Instagram",
      POST_SCHEDULED: "Scheduled a post",
      SCHEDULE_UPDATED: "Updated schedule",
      SCHEDULE_CANCELLED: "Cancelled schedule",
    };

    const enrichedLogs = logs.map((log) => ({
      ...log,
      label: ACTION_LABELS[log.action] ?? log.action,
    }));

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        logs: enrichedLogs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
        actionStats: actionStats.map((s) => ({
          action: s.action,
          label: ACTION_LABELS[s.action] ?? s.action,
          count: s._count.action,
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Activity GET] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
// POST /api/activity   -  called by n8n workflows to log events
// ─────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    const actUserId = session?.user?.id ?? "local-user";
    const body = await request.json();

    const {
      type,
      action,
      title,
      description,
      entity,
      entityId,
      metadata,
    } = body as {
      type?: string;
      action?: string;
      title?: string;
      description?: string;
      entity?: string;
      entityId?: string;
      metadata?: Record<string, unknown>;
    };

    const resolvedAction = action ?? type ?? "WORKFLOW_EVENT";

    const log = await prisma.activityLog.create({
      data: {
        userId: actUserId,
        action: resolvedAction,
        entity: entity ?? "Workflow",
        entityId: entityId ?? null,
        metadata: (metadata ?? { title, description }) as any,
      },
    });

    return NextResponse.json(
      { success: true, error: null, data: { id: log.id, action: log.action } },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Activity POST] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

