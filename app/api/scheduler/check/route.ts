import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishOverdueScheduled } from "@/lib/catchup";
import { notifySystemError } from "@/lib/notifier";

export const dynamic = "force-dynamic";

// Debounce: don't publish more than once per 20 seconds from this endpoint.
let _lastCheckAt: Date | null = null;
const SCHEDULER_CHECK_INTERVAL_MS = 20_000;

/**
 * GET /api/scheduler/check
 * Called by the dashboard layout every 30 seconds.
 * Publishes any PENDING scheduled posts whose scheduledFor time has passed.
 * This is separate from runCatchup() so it runs on a tight loop without
 * the 5-minute full-catchup debounce.
 */
export async function GET() {
  const now = new Date();

  if (_lastCheckAt && now.getTime() - _lastCheckAt.getTime() < SCHEDULER_CHECK_INTERVAL_MS) {
    return NextResponse.json({ success: true, skipped: true });
  }
  _lastCheckAt = now;

  try {
    const errors: string[] = [];
    const igToken  = process.env.INSTAGRAM_ACCESS_TOKEN  ?? "";
    const igAcctId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";

    if (!igToken || !igAcctId) {
      return NextResponse.json({ success: false, error: "No Instagram credentials" });
    }

    // Quick peek  -  skip the expensive publishOverdueScheduled if nothing is due
    const dueCount = await prisma.scheduledPost.count({
      where: { status: "PENDING", scheduledFor: { lte: now } },
    });

    if (dueCount === 0) {
      return NextResponse.json({ success: true, published: 0, failed: 0 });
    }

    const { published, failed } = await publishOverdueScheduled(errors, igToken, igAcctId);
    return NextResponse.json({ success: true, published, failed, errors });
  } catch (err: any) {
    const msg = err?.message ?? "Scheduler check failed";
    console.error("[/api/scheduler/check] Error:", msg);
    notifySystemError({
      title:   "Scheduler Check Crashed",
      detail:  msg,
      rateKey: "scheduler_check_crash",
    }).catch(() => {});
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

