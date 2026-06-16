import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────

const UpdatePostSchema = z.object({
  type: z
    .enum([
      "EDUCATIONAL", "QUIZ", "CAROUSEL", "MYTH_FACT", "CLINICAL_PEARL",
      "CASE_STUDY", "ANGIOGRAPHY_QUIZ", "ECG_QUIZ", "PREVENTIVE", "CTA", "REEL",
    ])
    .optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(5000).optional(),
  hook: z.string().max(500).optional(),
  cta: z.string().max(300).optional(),
  hashtags: z.array(z.string()).max(30).optional(),
  imagePrompt: z.string().max(1000).optional(),
  reelScript: z.string().max(5000).optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"]).optional(),
  scheduledFor: z.string().datetime().optional().nullable(),
  mediaUrls: z.array(z.string().url()).optional(),
  carouselSlides: z.array(z.any()).optional().nullable(),
  viralScore: z.number().min(0).max(1).optional(),
  engagementPrediction: z.number().min(0).max(1).optional(),
  metrics: z.record(z.any()).optional(),
});

// ─────────────────────────────────────────────
// Helper  -  verify post ownership
// ─────────────────────────────────────────────

async function getOwnedPost(userId: string, postId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { analytics: true },
  });
  if (!post) return null;
  if (post.userId !== userId) return null;
  return post;
}

// ─────────────────────────────────────────────
// GET  -  Fetch single post
// ─────────────────────────────────────────────

export async function GET(
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
    const post = await getOwnedPost(session.user.id, id);

    if (!post) {
      return NextResponse.json(
        { success: false, error: "Post not found", data: null },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, error: null, data: { post } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Post GET] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
// PUT  -  Update post
// ─────────────────────────────────────────────

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
    const existing = await getOwnedPost(session.user.id, id);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Post not found", data: null },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validation = UpdatePostSchema.safeParse(body);
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

    const post = await prisma.post.update({
      where: { id },
      data: {
        ...(updates.type !== undefined && { type: updates.type as any }),
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.content !== undefined && { content: updates.content }),
        ...(updates.hook !== undefined && { hook: updates.hook }),
        ...(updates.cta !== undefined && { cta: updates.cta }),
        ...(updates.hashtags !== undefined && { hashtags: updates.hashtags }),
        ...(updates.imagePrompt !== undefined && { imagePrompt: updates.imagePrompt }),
        ...(updates.reelScript !== undefined && { reelScript: updates.reelScript }),
        ...(updates.status !== undefined && { status: updates.status as any }),
        ...(updates.scheduledFor !== undefined && {
          scheduledFor: updates.scheduledFor ? new Date(updates.scheduledFor) : null,
        }),
        ...(updates.mediaUrls !== undefined && { mediaUrls: updates.mediaUrls }),
        ...(updates.carouselSlides !== undefined && {
          carouselSlides: updates.carouselSlides ?? undefined,
        }),
        ...(updates.viralScore !== undefined && { viralScore: updates.viralScore }),
        ...(updates.engagementPrediction !== undefined && {
          engagementPrediction: updates.engagementPrediction,
        }),
        ...(updates.metrics !== undefined && { metrics: updates.metrics as any }),
      },
      include: { analytics: true },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: "POST_UPDATED",
        entity: "Post",
        entityId: post.id,
        metadata: { updatedFields: Object.keys(updates) },
      },
    });

    return NextResponse.json({ success: true, error: null, data: { post } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Post PUT] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
// DELETE  -  Remove post
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
    const existing = await getOwnedPost(session.user.id, id);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Post not found", data: null },
        { status: 404 }
      );
    }

    // Cascade deletes analytics via Prisma relations
    await prisma.post.delete({ where: { id } });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: "POST_DELETED",
        entity: "Post",
        entityId: id,
        metadata: { title: existing.title, type: existing.type },
      },
    });

    return NextResponse.json({
      success: true,
      error: null,
      data: { message: "Post deleted successfully" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Post DELETE] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}
