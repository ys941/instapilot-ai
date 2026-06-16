/**
 * PATCH  /api/brands/[id]  -  update a brand's label/active flag and/or credentials
 *        Body: { label?, active?,
 *                igToken?, igAcctId?, igUsername?, fbPageId?,
 *                ytClientId?, ytClientSecret?, ytRefreshToken?, ytChannelId?, ytChannelTitle? }
 * DELETE /api/brands/[id]  -  delete a brand (400 if it is the primary brand)
 *
 * Session-gated like the other /api/settings/* routes (getServerSession()).
 * Responses contain BrandRecord summaries only — credential secrets are never returned.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  updateBrandCredentials,
  deleteBrand,
  getBrandSummary,
  type BrandCredentials,
} from "@/lib/brands";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const existing = await getBrandSummary(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: "Brand not found" }, { status: 404 });
    }

    const body = await request.json();

    // ── label / active live on the Brand row directly (not credential columns) ──
    const meta: Record<string, string | boolean> = {};
    if (typeof body?.label === "string") {
      const label = body.label.trim();
      if (label) meta.label = label;
    }
    if (typeof body?.active === "boolean") meta.active = body.active;
    if (Object.keys(meta).length > 0) {
      await prisma.brand.update({ where: { id }, data: meta });
    }

    // ── credential columns via the dedicated helper (only defined keys written) ──
    const creds: Partial<BrandCredentials> = {};
    const keys: (keyof BrandCredentials)[] = [
      "igToken", "igAcctId", "igUsername", "fbPageId",
      "ytClientId", "ytClientSecret", "ytRefreshToken", "ytChannelId", "ytChannelTitle",
    ];
    for (const k of keys) {
      if (typeof body?.[k] === "string") creds[k] = body[k];
    }
    if (Object.keys(creds).length > 0) {
      await updateBrandCredentials(id, creds);
    }

    const updated = await getBrandSummary(id);
    return NextResponse.json({ success: true, data: updated });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    try {
      await deleteBrand(id);
    } catch (delErr: any) {
      // deleteBrand throws when asked to delete the primary brand.
      return NextResponse.json(
        { success: false, error: delErr?.message ?? "Cannot delete this brand" },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, data: { id, deleted: true } });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}
