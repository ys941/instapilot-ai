﻿/**
 * GET  /api/settings/auto-post  -  return auto-post configuration
 * POST /api/settings/auto-post  -  save auto-post configuration
 */
import { NextRequest, NextResponse } from "next/server";
import { readPreferencesForBrand, writePreferencesForBrand, sanitizeDailySchedule } from "@/lib/preferences";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";

export async function GET(request: NextRequest) {
  try {
    const brand = brandFromQuery(request);
    const prefs = await readPreferencesForBrand(brand);
    return NextResponse.json({ success: true, data: prefs.autoPost });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const brand = brandFromBody(body, brandFromQuery(request));
    const updated = await writePreferencesForBrand(brand, {
      autoPost: {
        enabled:       typeof body.enabled      === "boolean"  ? body.enabled      : false,
        postsPerDay:   typeof body.postsPerDay  === "number"   ? Math.min(5, Math.max(1, body.postsPerDay)) : 2,
        postTypes:     Array.isArray(body.postTypes)    ? body.postTypes    : [],
        topics:        Array.isArray(body.topics)       ? body.topics       : [],
        scheduleDays:  Array.isArray(body.scheduleDays) ? body.scheduleDays : [1,2,3,4,5],
        scheduleTimes: Array.isArray(body.scheduleTimes)? body.scheduleTimes: ["08:00","19:00"],
        timezone:      typeof body.timezone     === "string"   ? body.timezone     : "Asia/Kolkata",
        autoPublish:   typeof body.autoPublish  === "boolean"  ? body.autoPublish  : false,
        publishToYouTube: typeof body.publishToYouTube === "boolean" ? body.publishToYouTube : false,
        publishToFacebook: typeof body.publishToFacebook === "boolean" ? body.publishToFacebook : false,
        // Per-day timing/post-count overrides (validated: day 0-6, postsPerDay 1-5, HH:MM times).
        dailySchedule: sanitizeDailySchedule(body.dailySchedule),
        // Master toggle: only post on custom days (ignore global Publishing Days/Times for days with no custom entry).
        customScheduleOnly: typeof body.customScheduleOnly === "boolean" ? body.customScheduleOnly : false,
      },
    });
    return NextResponse.json({ success: true, data: updated.autoPost });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

