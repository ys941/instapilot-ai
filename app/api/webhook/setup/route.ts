/**
 * POST /api/webhook/setup
 *
 * One-click webhook subscription setup using the APP-level subscriptions endpoint.
 * Registers Instagram comment/DM/mention webhooks via:
 *   POST /{app-id}/subscriptions   (uses App Access Token = APP_ID|APP_SECRET)
 *
 * This is the correct approach  -  no user token permissions needed.
 * The old /{page-id}/subscribed_apps requires pages_manage_metadata which
 * is rarely available in generated tokens.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

async function getAppAccessToken(appId: string, appSecret: string): Promise<string | null> {
  try {
    const res  = await fetch(
      `https://graph.facebook.com/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`
    );
    const data = await res.json();
    if (data.error || !data.access_token) return null;
    return data.access_token as string;
  } catch {
    return null;
  }
}

async function subscribeAppWebhook(
  appId:       string,
  appToken:    string,
  object:      string,
  fields:      string[],
  callbackUrl: string,
  verifyToken: string
): Promise<{ success: boolean; error?: string; raw?: object }> {
  try {
    const params = new URLSearchParams({
      object,
      callback_url:      callbackUrl,
      fields:            fields.join(","),
      verify_token:      verifyToken,
      access_token:      appToken,
    });
    const res  = await fetch(`${GRAPH_BASE}/${appId}/subscriptions`, {
      method: "POST",
      body:   params,
    });
    const data = await res.json();
    if (data.error) return { success: false, error: data.error.message, raw: data };
    return { success: !!data.success, raw: data };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function getAppSubscriptions(
  appId:    string,
  appToken: string
): Promise<Record<string, string[]>> {
  try {
    const res  = await fetch(`${GRAPH_BASE}/${appId}/subscriptions?access_token=${appToken}`, { cache: "no-store" });
    const data = await res.json();
    const subs: Record<string, string[]> = {};
    for (const sub of data.data ?? []) {
      subs[sub.object] = ((sub.fields ?? []) as Array<{ name: string }>).map((f) => f.name);
    }
    return subs;
  } catch {
    return {};
  }
}

// Bind a specific Page / Instagram account to the app so Meta actually DELIVERS
// events. The app-level subscription above only DECLARES the desired fields;
// without this object-level binding, active:true is shown but nothing arrives.
// Requires the page token to carry `pages_manage_metadata`. Idempotent.
async function subscribeObjectNode(
  nodeId:           string,
  subscribedFields: string[],
  pageToken:        string
): Promise<{ success: boolean; error?: string; missingMetadataPerm?: boolean }> {
  try {
    const params = new URLSearchParams({
      subscribed_fields: subscribedFields.join(","),
      access_token:      pageToken,
    });
    const res  = await fetch(`${GRAPH_BASE}/${nodeId}/subscribed_apps`, { method: "POST", body: params });
    const data = await res.json();
    if (data.error) {
      const msg = String(data.error.message ?? "");
      const missingMetadataPerm = data.error.code === 200 || /pages_manage_metadata/i.test(msg);
      return { success: false, error: msg, missingMetadataPerm };
    }
    return { success: !!data.success };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function POST() {
  const appId      = process.env.FACEBOOK_APP_ID               ?? "";
  const appSecret  = process.env.FACEBOOK_APP_SECRET           ?? "";
  const appUrl     = process.env.NEXT_PUBLIC_APP_URL           ?? "";
  const verifyTok  = process.env.WEBHOOK_VERIFY_TOKEN          ?? "instapilot_webhook_token";

  if (!appId || !appSecret) {
    return NextResponse.json({
      success: false,
      error:   "FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be set in .env",
    }, { status: 422 });
  }

  if (!appUrl) {
    return NextResponse.json({
      success: false,
      error:   "NEXT_PUBLIC_APP_URL must be set  -  Meta needs a public HTTPS URL to deliver events",
    }, { status: 422 });
  }

  const isLocalhost = appUrl.includes("localhost") || appUrl.includes("127.0.0.1");
  // Target the SAFE webhook handler (verify-but-don't-drop), NOT the strict
  // /api/webhook route which drops events on a signature mismatch.
  const callbackUrl = `${appUrl}/api/webhooks/instagram`;

  // ── Get App Access Token ────────────────────────────────────────────────────
  const appToken = await getAppAccessToken(appId, appSecret);
  if (!appToken) {
    return NextResponse.json({
      success: false,
      error:   "Could not generate App Access Token. Check FACEBOOK_APP_ID and FACEBOOK_APP_SECRET  -  they must match exactly what's in Meta App Dashboard -> App Settings -> Basic.",
    }, { status: 400 });
  }

  const warnings: string[] = [];
  if (isLocalhost) {
    warnings.push("NEXT_PUBLIC_APP_URL is localhost  -  Meta CANNOT reach your server. Use ngrok: npx ngrok http 3000");
  }

  // ── Subscribe Instagram webhook fields ──────────────────────────────────────
  const igResult = await subscribeAppWebhook(
    appId, appToken,
    "instagram",
    ["comments", "messages", "mentions"],
    callbackUrl, verifyTok
  );

  // ── Subscribe Page webhook fields (for DM fallback) ─────────────────────────
  const pageResult = await subscribeAppWebhook(
    appId, appToken,
    "page",
    ["messages", "feed", "mention"],
    callbackUrl, verifyTok
  );

  // ── Object-level bindings — THIS is what makes events actually flow ─────────
  // Bind the Page + IG account to the app via /{id}/subscribed_apps. The two
  // app-level calls above only declare desired fields; this binds the accounts.
  const pageId    = process.env.FACEBOOK_PAGE_ID?.trim()             ?? "";
  const igId      = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim() ?? "";
  const pageToken =
    (process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim() ||
     process.env.INSTAGRAM_ACCESS_TOKEN?.trim()) ?? "";

  let pageBind: { success: boolean; error?: string; missingMetadataPerm?: boolean } | null = null;
  let igBind:   { success: boolean; error?: string; missingMetadataPerm?: boolean } | null = null;
  let needsManageMetadata = false;
  if (pageToken && pageId) {
    pageBind = await subscribeObjectNode(pageId, ["feed", "messages", "mention"], pageToken);
    if (pageBind.missingMetadataPerm) needsManageMetadata = true;
  }
  if (pageToken && igId) {
    igBind = await subscribeObjectNode(igId, ["comments", "messages", "mentions"], pageToken);
    if (igBind.missingMetadataPerm) needsManageMetadata = true;
  }

  // ── Verify what's now subscribed ────────────────────────────────────────────
  const activeSubs = await getAppSubscriptions(appId, appToken);
  const igFields   = activeSubs["instagram"] ?? [];
  const pageFields = activeSubs["page"]      ?? [];

  const hasComments = igFields.includes("comments") || pageFields.includes("feed");
  const hasMessages = igFields.includes("messages") || pageFields.includes("messages");
  const hasMentions = igFields.includes("mentions") || pageFields.includes("mention");

  const errors: string[] = [];
  if (!igResult.success   && igResult.error)   errors.push(`Instagram: ${igResult.error}`);
  if (!pageResult.success && pageResult.error) errors.push(`Page: ${pageResult.error}`);

  if (errors.length > 0 && !hasComments) {
    return NextResponse.json({
      success: false,
      error:   errors.join(" | "),
      hint:    "Make sure FACEBOOK_APP_SECRET matches Meta App Dashboard -> App Settings -> Basic -> App Secret",
    }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: {
      message: hasComments
        ? "Webhook fields subscribed successfully! Instagram will now deliver comment and DM events."
        : "Subscription calls sent. Fields may take up to 30 s to activate  -  refresh to verify.",
      callbackUrl,
      verifyToken: verifyTok,
      subscriptions: {
        instagram: igFields,
        page:      pageFields,
      },
      // Object-level account bindings — the part that actually makes Meta deliver.
      accountBindings: {
        page: pageBind ? { ok: pageBind.success, error: pageBind.error ?? null } : "skipped (no page id/token)",
        instagram: igBind ? { ok: igBind.success, error: igBind.error ?? null } : "skipped (no ig id/token)",
        needsManageMetadata,
      },
      checks: {
        comments: hasComments ? "subscribed" : "not confirmed yet",
        messages: hasMessages ? "subscribed" : "not confirmed yet",
        mentions: hasMentions ? "subscribed" : "not confirmed yet",
      },
      warnings,
      errors,
      nextSteps: [
        isLocalhost ? "Start ngrok: npx ngrok http 3000 then update NEXT_PUBLIC_APP_URL" : null,
        needsManageMetadata
          ? "⛔ ACTION REQUIRED: the Page/IG account could not be bound (missing `pages_manage_metadata`). " +
            "Regenerate the long-lived Page token WITH pages_manage_metadata, update FACEBOOK_PAGE_ACCESS_TOKEN " +
            "(+ INSTAGRAM_ACCESS_TOKEN) in Railway, then re-run this. Until then NO comment/DM events arrive."
          : null,
        "Restart your Next.js server so it picks up the updated FACEBOOK_APP_SECRET",
        "Post a comment on Instagram to verify events arrive in real time",
        "Check GET /api/webhook/debug for live status",
      ].filter(Boolean),
    },
  });
}
