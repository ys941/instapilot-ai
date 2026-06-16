﻿import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { resolveBrandId, getPrimaryBrandId } from "@/lib/brands";
import { z } from "zod";

// ---------------------------------------------
// VALIDATION
// ---------------------------------------------

const AccountSchema = z.object({
  followers: z.number().int().nonnegative().optional(),
  following: z.number().int().nonnegative().optional(),
  posts: z.number().int().nonnegative().optional(),
  reach: z.number().int().nonnegative().optional(),
  impressions: z.number().int().nonnegative().optional(),
  profileVisits: z.number().int().nonnegative().optional(),
  websiteClicks: z.number().int().nonnegative().optional(),
  engagementRate: z.number().nonnegative().optional(),
  // calculated averages forwarded from the n8n Code node
  avgLikes: z.number().optional(),
  avgComments: z.number().optional(),
  avgSaves: z.number().optional(),
  avgReach: z.number().optional(),
});

const SyncPayloadSchema = z.object({
  account: AccountSchema.optional(),
  topPosts: z.array(z.record(z.unknown())).optional(),
  totalPostsAnalyzed: z.number().int().nonnegative().optional(),
  syncedAt: z.string().optional(),
});

// ---------------------------------------------
// POST /api/analytics/sync
// Called by the n8n analytics-sync workflow after
// it fetches and calculates Instagram metrics.
// Saves data to AccountAnalytics and logs activity.
// ---------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Local-only mode: always use the local session (no auth required)
    const session = await getServerSession();
    const userId: string = session?.user?.id ?? "local-user";

    const body = await request.json();
    const validation = SyncPayloadSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid analytics payload",
          details: validation.error.flatten(),
          data: null,
        },
        { status: 400 }
      );
    }

    const { account = {}, totalPostsAnalyzed, syncedAt } = validation.data;

    // Resolve the requested brand (no ?brand= ⇒ primary). The primary brand stamps
    // brandId=NULL and matches rows where brandId IS NULL OR == primaryId, so the
    // single-account behaviour is byte-for-byte unchanged.
    const brandParam = request.nextUrl.searchParams.get("brand");
    const resolvedBrandId = await resolveBrandId(brandParam);
    const primaryId       = await getPrimaryBrandId();
    const isPrimaryBrand  = resolvedBrandId === primaryId;
    const brandIdForWrite = isPrimaryBrand ? null : resolvedBrandId;
    // null==primary filter: primary matches NULL or its own id; brands match exactly.
    const brandWhere = isPrimaryBrand
      ? { OR: [{ brandId: null }, { brandId: primaryId }] }
      : { brandId: resolvedBrandId };

    // -- 1. Upsert AccountAnalytics row for today --
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const analyticsData = {
      date: syncedAt ? new Date(syncedAt) : new Date(),
      followers: account.followers ?? 0,
      following: account.following ?? 0,
      posts: account.posts ?? 0,
      reach: account.reach ?? account.avgReach ?? 0,
      impressions: account.impressions ?? 0,
      profileVisits: account.profileVisits ?? 0,
      websiteClicks: account.websiteClicks ?? 0,
      engagementRate: account.engagementRate ?? 0,
      brandId: brandIdForWrite,
    };

    // Check for an existing row for today to avoid duplicate rows (date has no @unique constraint)
    const existingRow = await prisma.accountAnalytics.findFirst({
      where: {
        date: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
        ...brandWhere,
      } as any,
    });

    const analyticsRecord = existingRow
      ? await prisma.accountAnalytics.update({
          where: { id: existingRow.id },
          data: analyticsData as any,
        })
      : await prisma.accountAnalytics.create({ data: analyticsData as any });

    // -- 2. Log the sync as an ActivityLog entry --
    await prisma.activityLog.create({
      data: {
        userId,
        action: "ANALYTICS_SYNCED",
        entity: "AccountAnalytics",
        entityId: analyticsRecord.id,
        metadata: {
          followers: account.followers ?? 0,
          engagementRate: account.engagementRate ?? 0,
          totalPostsAnalyzed: totalPostsAnalyzed ?? 0,
          syncedAt: syncedAt ?? new Date().toISOString(),
          source: "n8n-analytics-sync",
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        error: null,
        data: {
          analyticsId: analyticsRecord.id,
          followers: analyticsRecord.followers,
          engagementRate: analyticsRecord.engagementRate,
          syncedAt: analyticsRecord.date.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[Analytics Sync POST] Error:", message);
    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}

