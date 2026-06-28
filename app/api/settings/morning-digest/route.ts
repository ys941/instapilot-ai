/**
 * GET  /api/settings/morning-digest  — return Morning Digest settings
 * POST /api/settings/morning-digest  — save Morning Digest settings
 */
import { NextRequest, NextResponse } from "next/server";
import { readPreferences, writePreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

export async function GET() {
  try {
    const prefs = await readPreferences();
    return NextResponse.json({ success: true, data: prefs.morningDigest });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const updated = await writePreferences({
      morningDigest: {
        enabled:       bool(body.enabled, false),
        sendTime:      HHMM.test(body.sendTime) ? body.sendTime : "08:00",
        igInsights:    bool(body.igInsights, true),
        igComments:    bool(body.igComments, true),
        igPublished:   bool(body.igPublished, true),
        igFollowers:   bool(body.igFollowers, true),
        ytInsights:    bool(body.ytInsights, true),
        ytComments:    bool(body.ytComments, true),
        ytPublished:   bool(body.ytPublished, true),
        ytSubscribers: bool(body.ytSubscribers, true),
        topContent:    bool(body.topContent, true),
        engagement:    bool(body.engagement, true),
        upcomingToday: bool(body.upcomingToday, true),
        failures:      bool(body.failures, true),
        systemHealth:  bool(body.systemHealth, true),
        growthDeltas:  bool(body.growthDeltas, true),
        aiUsage:       bool(body.aiUsage, false),
      },
    });
    return NextResponse.json({ success: true, data: updated.morningDigest });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}
