﻿import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderPostToJpeg } from "@/lib/postTypeImageGenerator";
import { uploadBufferToStableCdn } from "@/lib/imageGenerator";
import { Prisma } from "@prisma/client";

// ---------------------------------------------
// VALIDATION
// ---------------------------------------------

// nullish() = optional() + nullable()  -  accepts string | null | undefined
// AI returns null for fields not relevant to the post type (e.g. reelScript on MYTH_FACT)
const CreatePostSchema = z.object({
  type: z.enum([
    "EDUCATIONAL", "QUIZ", "CAROUSEL", "MYTH_FACT", "CLINICAL_PEARL",
    "CASE_STUDY", "ANGIOGRAPHY_QUIZ", "ECG_QUIZ", "PREVENTIVE", "CTA", "REEL",
  ]),
  title:   z.string().min(1).max(500),
  content: z.string().min(1).max(50000),
  hook:        z.string().max(2000).nullish(),
  cta:         z.string().max(1000).nullish(),
  hashtags:    z.array(z.string()).max(50).default([]),
  imagePrompt: z.string().max(2000).nullish(),
  reelScript:  z.string().max(20000).nullish(),
  platform:    z.enum(["instagram", "youtube", "both"]).default("instagram"),
  status:      z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"]).default("DRAFT"),
  scheduledFor: z.string().datetime({ offset: true }).nullish(),
  mediaUrls:    z.array(z.string().url()).default([]),
  carouselSlides: z.union([z.array(z.any()), z.null()]).optional(),
  // Accept null/undefined/any number  -  clamp to 0-1
  viralScore: z.number().nullish().transform((v) =>
    v == null ? undefined : Math.min(1, Math.max(0, v > 1 ? v / 100 : v))
  ),
  engagementPrediction: z.number().nullish().transform((v) =>
    v == null ? undefined : Math.min(1, Math.max(0, v > 1 ? v / 100 : v))
  ),
});

// ---------------------------------------------
// GET  -  List posts (paginated + filtered)
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
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const search = searchParams.get("search");

    const where: Prisma.PostWhereInput = {
      userId: session.user.id,
      ...(status && { status: status as any }),
      ...(type && { type: type as any }),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { content: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: { analytics: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.post.count({ where }),
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
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Posts GET] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

// ---------------------------------------------
// POST  -  Create new post
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
    const validation = CreatePostSchema.safeParse(body);
    if (!validation.success) {
      const flat = validation.error.flatten();
      console.error("[Posts POST] Validation failed:", JSON.stringify(flat, null, 2));
      return NextResponse.json(
        {
          success: false,
          error: `Invalid request body: ${Object.entries(flat.fieldErrors).map(([k, v]) => `${k}: ${v?.join(", ")}`).join(" | ")}`,
          details: flat,
          data: null,
        },
        { status: 400 }
      );
    }

    const data = validation.data;

    const post = await prisma.post.create({
      data: {
        userId: session.user.id,
        type: data.type as any,
        title: data.title,
        content: data.content,
        hook: data.hook,
        cta: data.cta,
        hashtags: data.hashtags,
        imagePrompt: data.imagePrompt,
        reelScript: data.reelScript,
        platform: data.platform,
        status: data.status as any,
        scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : undefined,
        mediaUrls: data.mediaUrls,
        carouselSlides: data.carouselSlides ? (data.carouselSlides as any) : undefined,
        viralScore: data.viralScore,
        engagementPrediction: data.engagementPrediction,
      },
      include: { analytics: true },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: "POST_CREATED",
        entity: "Post",
        entityId: post.id,
        metadata: { type: post.type, title: post.title },
      },
    });

    // ── Pre-generate branded image in background (non-blocking) ───────────────
    // Runs after the response is sent so publish clicks are near-instant.
    // Skipped for CAROUSEL (handled separately) and if mediaUrls already present.
    if (post.type !== "CAROUSEL" && post.mediaUrls.length === 0) {
      void (async () => {
        try {
          const buf = await renderPostToJpeg({
            postType:   post.type,
            title:      post.title,
            hook:       post.hook       ?? "",
            content:    post.content    ?? "",
            cta:        post.cta        ?? "",
            reelScript: post.reelScript ?? undefined,
          });
          if (!buf) return;
          const cdnUrl = await uploadBufferToStableCdn(buf, ".jpg", `card-${post.type.toLowerCase()}`);
          if (cdnUrl) {
            await prisma.post.update({
              where: { id: post.id },
              data:  { mediaUrls: [cdnUrl] },
            });
            console.log(`[Posts] Pre-cached image for post ${post.id}: ${cdnUrl}`);
          }
        } catch (err: any) {
          // Best-effort  -  publish route will regenerate if this fails
          console.warn("[Posts] Background image pre-gen failed:", err?.message);
        }
      })();
    }

    return NextResponse.json(
      { success: true, error: null, data: { post } },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Posts POST] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

