/**
 * GET  /api/brands  -  list all brands (safe summaries only, NO secret tokens)
 * POST /api/brands  -  create a new (non-primary) brand
 *      Body: { label: string,
 *              igToken?, igAcctId?, igUsername?, fbPageId?,
 *              ytClientId?, ytClientSecret?, ytRefreshToken?, ytChannelId?, ytChannelTitle? }
 *
 * Session-gated like the other /api/settings/* routes (getServerSession()).
 * Responses contain BrandRecord summaries only — credential secrets are never returned.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { listBrands, createBrand, type BrandCredentials } from "@/lib/brands";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const brands = await listBrands();
    return NextResponse.json({ success: true, data: brands });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const label = (body?.label ?? "").trim();
    if (!label) {
      return NextResponse.json({ success: false, error: "Brand label is required" }, { status: 400 });
    }

    // Only forward defined credential keys (all optional).
    const creds: Partial<BrandCredentials> = {};
    const keys: (keyof BrandCredentials)[] = [
      "igToken", "igAcctId", "igUsername", "fbPageId",
      "ytClientId", "ytClientSecret", "ytRefreshToken", "ytChannelId", "ytChannelTitle",
    ];
    for (const k of keys) {
      if (typeof body?.[k] === "string") creds[k] = body[k];
    }

    const brand = await createBrand({ label, ...creds });
    // createBrand returns a BrandRecord (no secrets) — safe to return as-is.
    return NextResponse.json({ success: true, data: brand });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}
