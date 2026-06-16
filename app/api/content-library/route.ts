﻿import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ---------------------------------------------
// ROUTE HANDLER  -  GET content library
// All posts + drafts for the authenticated user,
// with full-text search and multi-filter support
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

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);

    // Pagination
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

    // Filters
    const search = searchParams.get("search");
    const status = searchParams.get("status"); // DRAFT, SCHEDULED, PUBLISHED, FAILED
    const type = searchParams.get("type"); // PostType enum
    const sortBy = searchParams.get("sortBy") ?? "createdAt"; // createdAt, updatedAt, viralScore
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const hasMedia = searchParams.get("hasMedia"); // "true" / "false"
    const minViralScore = searchParams.get("minViralScore")
      ? parseFloat(searchParams.get("minViralScore")!)
      : undefined;

    // Build where clause
    const where: Prisma.PostWhereInput = {
      userId,
      ...(status ? { status: status as any } : {}),
      ...(type ? { type: type as any } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
      ...(hasMedia === "true"
        ? { mediaUrls: { isEmpty: false } }
        : hasMedia === "false"
        ? { mediaUrls: { isEmpty: true } }
        : {}),
      ...(minViralScore !== undefined ? { viralScore: { gte: minViralScore } } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { content: { contains: search, mode: "insensitive" } },
              { hook: { contains: search, mode: "insensitive" } },
              { cta: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    // Build order by (safe allowlist)
    const allowedSortFields = ["createdAt", "updatedAt", "viralScore", "publishedAt"];
    const orderByField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
    const orderBy: Prisma.PostOrderByWithRelationInput = {
      [orderByField]: sortOrder,
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: { analytics: true },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    // Compute content library stats for the current user
    const [statusBreakdown, typeBreakdown] = await Promise.all([
      prisma.post.groupBy({
        by: ["status"],
        where: { userId },
        _count: { status: true },
      }),
      prisma.post.groupBy({
        by: ["type"],
        where: { userId },
        _count: { type: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        posts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
        filters: {
          search,
          status,
          type,
          sortBy: orderByField,
          sortOrder,
          dateFrom,
          dateTo,
          hasMedia,
          minViralScore,
        },
        stats: {
          byStatus: statusBreakdown.map((s) => ({
            status: s.status,
            count: s._count.status,
          })),
          byType: typeBreakdown.map((t) => ({
            type: t.type,
            count: t._count.type,
          })),
          totalInLibrary: await prisma.post.count({ where: { userId } }),
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Content Library GET] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

