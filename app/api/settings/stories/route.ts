﻿/**
 * GET  /api/settings/stories  -  return story auto-post settings
 * POST /api/settings/stories  -  save story auto-post settings
 */
import { NextRequest, NextResponse } from "next/server";
import { readPreferencesForBrand, writePreferencesForBrand } from "@/lib/preferences";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";

export async function GET(request: NextRequest) {
  try {
    const brand = brandFromQuery(request);
    const prefs = await readPreferencesForBrand(brand);
    return NextResponse.json({ success: true, data: prefs.stories });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const brand = brandFromBody(body, brandFromQuery(request));
    const updated = await writePreferencesForBrand(brand, {
      stories: {
        enabled:           typeof body.enabled           === "boolean" ? body.enabled           : true,
        postTime:          typeof body.postTime          === "string"  ? body.postTime          : "09:00",
        scheduleDays:      Array.isArray(body.scheduleDays)            ? body.scheduleDays      : [0,1,2,3,4,5,6],
        topics:            Array.isArray(body.topics)                  ? body.topics            : [],
        customPromptExtra: typeof body.customPromptExtra === "string"  ? body.customPromptExtra : "",
        publishToYouTube:  typeof body.publishToYouTube  === "boolean" ? body.publishToYouTube  : false,
      },
    });
    return NextResponse.json({ success: true, data: updated.stories });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

