﻿/**
 * GET  /api/settings/notifications  -  return current notification preferences
 * POST /api/settings/notifications  -  save notification preferences
 */
import { NextRequest, NextResponse } from "next/server";
import { readPreferences, writePreferences } from "@/lib/preferences";

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

export async function GET() {
  try {
    const prefs = await readPreferences();
    return NextResponse.json({ success: true, data: prefs.notifications });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
    const updated = await writePreferences({
      notifications: {
        emailPublish:      bool(body.emailPublish, true),
        emailAnalytics:    bool(body.emailAnalytics, true),
        emailFails:        bool(body.emailFails, true),
        pushPublish:       bool(body.pushPublish, false),
        pushComments:      bool(body.pushComments, false),
        pushWeeklyReport:  bool(body.pushWeeklyReport, true),
        notificationEmail: typeof body.notificationEmail === "string" ? body.notificationEmail.trim() : "",
      },
    });
    return NextResponse.json({ success: true, data: updated.notifications });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

