import { NextResponse } from "next/server";
import { getWebhookEventCount } from "@/lib/webhookCounter";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/count
 * Returns the current webhook event counter.
 * The analytics frontend polls this every 5s; when the count changes it
 * invalidates queries to show fresh likes/comments data.
 */
export async function GET() {
  return NextResponse.json({ count: getWebhookEventCount() });
}

