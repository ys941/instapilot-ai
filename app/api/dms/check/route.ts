﻿import { NextResponse } from "next/server";
import { replyMissedDMs } from "@/lib/catchup";

export const dynamic = "force-dynamic";

// Simple debounce  -  prevent overlapping DM checks from multiple tabs
let lastRanAt = 0;
const DEBOUNCE_MS = 25_000; // 25s  -  safe under 30s poll interval

/**
 * GET /api/dms/check
 * Called by the dashboard every 30 seconds.
 * Fetches unanswered Instagram DMs and replies with AI.
 * Has its own 25-second debounce so overlapping calls from multiple tabs are harmless.
 */
export async function GET() {
  const now = Date.now();
  if (now - lastRanAt < DEBOUNCE_MS) {
    return NextResponse.json({ success: true, data: { skipped: true, reason: "debounce" } });
  }
  lastRanAt = now;

  try {
    const igToken  = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
    const igAcctId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";
    const errors: string[] = [];
    const dmsReplied = await replyMissedDMs(errors, igToken, igAcctId);
    return NextResponse.json({ success: true, data: { dmsReplied, errors } });
  } catch (err: any) {
    console.error("[/api/dms/check] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message ?? "DM check failed" },
      { status: 500 }
    );
  }
}

