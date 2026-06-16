﻿/**
 * GET  /api/settings/notifications  -  return current notification preferences
 * POST /api/settings/notifications  -  save notification preferences
 */
import { NextRequest, NextResponse } from "next/server";
import { readPreferences, writePreferences } from "@/lib/preferences";

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
    const body = await request.json();
    const updated = await writePreferences({
      notifications: {
        emailPublish:      body.emailPublish      ?? true,
        emailAnalytics:    body.emailAnalytics    ?? true,
        emailFails:        body.emailFails        ?? true,
        pushPublish:       body.pushPublish       ?? false,
        pushComments:      body.pushComments      ?? false,
        pushWeeklyReport:  body.pushWeeklyReport  ?? true,
        notificationEmail: body.notificationEmail ?? "",
      },
    });
    return NextResponse.json({ success: true, data: updated.notifications });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

