/**
 * GET  /api/settings/brand  — return the current brand config (merged w/ defaults)
 * POST /api/settings/brand  — save brand config (partial merge)
 *
 * The brand config drives the entire app: app name, niche, persona, colours,
 * content-type labels/prompts, default topics and hashtag seeds. Editing it from
 * Settings → Brand re-skins the whole platform for any niche — no code changes.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readPreferencesForBrand, writePreferencesForBrand } from "@/lib/preferences";
import { brandFromQuery, brandFromBody, isAllBrands } from "@/lib/brandRequest";

export async function GET(request: NextRequest) {
  try {
    // Follow the selected account (?brand=<id>); "all"/empty → primary.
    const sel = brandFromQuery(request);
    const brandId = isAllBrands(sel) ? null : sel;
    const prefs = await readPreferencesForBrand(brandId);
    return NextResponse.json({ success: true, data: prefs.brand });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

const ContentTypeSchema = z.object({
  label:       z.string().max(60).optional(),
  description: z.string().max(300).optional(),
  prompt:      z.string().max(4000).optional(),
  enabled:     z.boolean().optional(),
});

const BrandSchema = z.object({
  appName:     z.string().max(80).optional(),
  tagline:     z.string().max(160).optional(),
  niche:       z.string().max(120).optional(),
  purpose:     z.string().max(600).optional(),
  audience:    z.string().max(300).optional(),
  language:    z.string().max(40).optional(),
  defaultTone: z.string().max(40).optional(),
  persona: z.object({
    handle:      z.string().max(60).optional(),
    displayName: z.string().max(80).optional(),
    role:        z.string().max(200).optional(),
    voice:       z.string().max(300).optional(),
  }).partial().optional(),
  dmAutoReply:    z.string().max(1000).optional(),
  commentCtaLine: z.string().max(200).optional(),
  colors: z.object({
    bg:      z.string().max(20).optional(),
    bg2:     z.string().max(20).optional(),
    accent:  z.string().max(20).optional(),
    accent2: z.string().max(20).optional(),
    accent3: z.string().max(20).optional(),
  }).partial().optional(),
  lockCardTheme: z.boolean().optional(),
  youtube: z.object({
    handle:      z.string().max(60).optional(),
    channelName: z.string().max(100).optional(),
  }).partial().optional(),
  contentTypes:  z.record(z.string(), ContentTypeSchema).optional(),
  topics:        z.array(z.string().max(200)).max(100).optional(),
  hashtagSeeds:  z.array(z.string().max(80)).max(100).optional(),
  configured:    z.boolean().optional(),
}).partial();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = BrandSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid brand payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Save to the selected account (?brand=<id> or body.brand id); else primary.
    const sel = brandFromBody(body, brandFromQuery(request));
    const brandId = isAllBrands(sel) ? null : sel;
    // Any explicit save marks the brand as configured (hides the setup banner).
    const incoming = { configured: true, ...parsed.data } as any;
    const updated = await writePreferencesForBrand(brandId, { brand: incoming });
    return NextResponse.json({ success: true, data: updated.brand });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}
