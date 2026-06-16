import { NextResponse } from "next/server";
import { runCatchup } from "@/lib/catchup";

export const dynamic = "force-dynamic";

/**
 * GET /api/startup
 * Called by the dashboard layout on mount.
 * Returns the catch-up summary so the UI can show a banner.
 */
export async function GET() {
  try {
    const result = await runCatchup();
    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    console.error("[/api/startup] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message ?? "Catch-up failed", data: null },
      { status: 500 }
    );
  }
}

