/**
 * GET /api/instagram/dms/debug
 *
 * Returns raw API responses so you can diagnose permission issues.
 * Open this URL in the browser while logged in to see exactly what Meta says.
 */
import { NextResponse } from "next/server";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";
const TOKEN      = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
const PAGE_ID    = process.env.FACEBOOK_PAGE_ID ?? "";
const IG_ID      = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";

export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, any> = {};

  // 1. Check token info
  try {
    const r = await fetch(`${GRAPH_BASE}/me?fields=id,name&access_token=${TOKEN}`);
    results["1_me"] = await r.json();
  } catch (e: any) { results["1_me"] = { error: e.message }; }

  // 2. Check pages — strip Page access_token before returning (never echo secrets).
  try {
    const r = await fetch(`${GRAPH_BASE}/me/accounts?access_token=${TOKEN}`);
    const d = await r.json();
    if (Array.isArray(d?.data)) {
      d.data = d.data.map((p: any) =>
        p && typeof p === "object" && "access_token" in p
          ? { ...p, access_token: p.access_token ? "[REDACTED]" : "[MISSING]" }
          : p
      );
    }
    results["2_me_accounts"] = d;
  } catch (e: any) { results["2_me_accounts"] = { error: e.message }; }

  // 3. Page token
  try {
    const r = await fetch(`${GRAPH_BASE}/${PAGE_ID}?fields=access_token,name&access_token=${TOKEN}`);
    const d = await r.json();
    results["3_page"] = { ...d, access_token: d.access_token ? "[PRESENT]" : "[MISSING]" };
  } catch (e: any) { results["3_page"] = { error: e.message }; }

  // 4. Conversations via Page ID
  try {
    const r = await fetch(`${GRAPH_BASE}/${PAGE_ID}/conversations?platform=instagram&limit=5&access_token=${TOKEN}`);
    results["4_conversations_page"] = await r.json();
  } catch (e: any) { results["4_conversations_page"] = { error: e.message }; }

  // 5. Conversations via IG Account ID
  try {
    const r = await fetch(`${GRAPH_BASE}/${IG_ID}/conversations?platform=instagram&limit=5&access_token=${TOKEN}`);
    results["5_conversations_ig"] = await r.json();
  } catch (e: any) { results["5_conversations_ig"] = { error: e.message }; }

  // 6. Token debug (permissions)
  try {
    const r = await fetch(`${GRAPH_BASE}/debug_token?input_token=${TOKEN}&access_token=${TOKEN}`);
    results["6_token_debug"] = await r.json();
  } catch (e: any) { results["6_token_debug"] = { error: e.message }; }

  return NextResponse.json({
    config: { PAGE_ID, IG_ID, tokenPresent: !!TOKEN },
    results,
  }, { status: 200 });
}

