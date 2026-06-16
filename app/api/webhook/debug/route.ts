/**
 * GET /api/webhook/debug
 *
 * Full webhook health diagnostic  -  tells you EXACTLY why webhooks
 * are (or aren't) delivering Instagram comment / DM events.
 *
 * Checks (in order of likelihood to be the problem):
 *  1. FACEBOOK_APP_SECRET  -  wrong = ALL events silently dropped
 *  2. Webhook URL reachability  -  must be public HTTPS, not localhost
 *  3. Instagram app mode  -  Development blocks real-user comment webhooks
 *  4. Required env vars  -  which are missing
 *  5. Recent webhook activity  -  did ANY events arrive in the last hour?
 *  6. Field subscription status  -  are `comments` / `messages` subscribed?
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

// ── Helpers ───────────────────────────────────────────────────────────────────
function mask(val: string | undefined, show = 6): string {
  if (!val) return "❌ NOT SET";
  if (val.length <= show) return "✅ SET (short)";
  return `✅ SET (...${val.slice(-show)})`;
}

/** Generate an App Access Token using App ID + App Secret.
 *  This token can read /{app-id}/subscriptions without any user permissions. */
async function getAppAccessToken(appId: string, appSecret: string): Promise<string | null> {
  if (!appId || !appSecret) return null;
  try {
    const res  = await fetch(
      `https://graph.facebook.com/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`,
      { cache: "no-store" }
    );
    const data = await res.json();
    if (data.error || !data.access_token) return null;
    return data.access_token as string;
  } catch {
    return null;
  }
}

/** Fetch app-level webhook subscriptions via GET /{app-id}/subscriptions.
 *  Returns a map of { object -> string[] of field names } e.g. { instagram: ["comments","messages"] }
 *  This is the correct endpoint  -  no user permissions needed, only App Secret. */
async function getAppSubscriptions(
  appId:    string,
  appToken: string
): Promise<{ subs: Record<string, string[]>; callbackUrl?: string; callbacks: Record<string, string>; error?: string }> {
  try {
    const res  = await fetch(
      `${GRAPH_BASE}/${appId}/subscriptions?access_token=${appToken}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    if (data.error) return { subs: {}, callbacks: {}, error: data.error.message };

    const subs: Record<string, string[]> = {};
    // Per-object callback URL. Different objects legitimately use DIFFERENT
    // callbacks (instagram → /api/webhooks/instagram, page → /api/webhook), so we
    // must compare each object against its OWN expected URL — not a single global.
    const callbacks: Record<string, string> = {};
    let callbackUrl: string | undefined;
    for (const sub of data.data ?? []) {
      const obj    = sub.object as string;
      const fields = ((sub.fields ?? []) as Array<{ name: string }>).map((f) => f.name);
      subs[obj] = fields;
      if (sub.callback_url) callbacks[obj] = sub.callback_url as string;
      if (!callbackUrl && sub.callback_url) callbackUrl = sub.callback_url as string;
    }
    return { subs, callbackUrl, callbacks };
  } catch (e) {
    return { subs: {}, callbacks: {}, error: String(e) };
  }
}

/** Probe whether the Page/IG account is actually BOUND to the app via
 *  /{id}/subscribed_apps. This is separate from the app-level field
 *  subscription: app-level can be active:true while NO account is bound, in
 *  which case zero events are ever delivered. Reading subscribed_apps (and
 *  binding it) needs `pages_manage_metadata` — a #200 error here is the
 *  smoking gun for "subscription active but webhook silent". */
async function probeAccountBinding(
  nodeId:    string,
  pageToken: string
): Promise<{ bound: boolean | null; fields: string[]; error?: string; missingMetadataPerm?: boolean }> {
  if (!nodeId || !pageToken) return { bound: null, fields: [], error: "node id or page token not set" };
  try {
    const res  = await fetch(`${GRAPH_BASE}/${nodeId}/subscribed_apps?access_token=${pageToken}`, { cache: "no-store" });
    const data = await res.json();
    if (data.error) {
      const msg = String(data.error.message ?? "");
      const missingMetadataPerm = data.error.code === 200 || /pages_manage_metadata/i.test(msg);
      return { bound: null, fields: [], error: msg, missingMetadataPerm };
    }
    const apps = (data.data ?? []) as Array<{ subscribed_fields?: string[] }>;
    const fields = apps.flatMap((a) => a.subscribed_fields ?? []);
    return { bound: apps.length > 0, fields };
  } catch (e) {
    return { bound: null, fields: [], error: String(e) };
  }
}

/** Test that the App Secret produces a valid HMAC for a dummy payload */
function testAppSecretHmac(secret: string): boolean {
  try {
    const payload = JSON.stringify({ test: true });
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return sig.startsWith("sha256=") && sig.length === 71;
  } catch {
    return false;
  }
}

/** Count recent webhook-triggered ActivityLog rows */
async function recentWebhookActivity(hoursBack = 1): Promise<{
  comments: number;
  dms: number;
  total: number;
}> {
  try {
    const since = new Date(Date.now() - hoursBack * 3600 * 1000);
    const logs  = await prisma.activityLog.findMany({
      where: {
        action:    { in: ["COMMENT_RECEIVED", "DM_RECEIVED", "MENTION_RECEIVED"] },
        createdAt: { gte: since },
      },
      select: { action: true },
    });
    const comments = logs.filter(l => l.action === "COMMENT_RECEIVED").length;
    const dms      = logs.filter(l => l.action === "DM_RECEIVED").length;
    return { comments, dms, total: logs.length };
  } catch {
    return { comments: 0, dms: 0, total: 0 };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET() {
  const appId         = process.env.FACEBOOK_APP_ID                 ?? "";
  const appSecret     = process.env.FACEBOOK_APP_SECRET             ?? "";
  const verifyToken   = process.env.WEBHOOK_VERIFY_TOKEN            ?? "";
  const igToken       = process.env.INSTAGRAM_ACCESS_TOKEN          ?? "";
  const igAccountId   = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID  ?? "";
  const pageId        = process.env.FACEBOOK_PAGE_ID                ?? "";
  const pageToken     = process.env.FACEBOOK_PAGE_ACCESS_TOKEN      ?? "";
  const appUrl        = process.env.NEXT_PUBLIC_APP_URL             ?? "";
  const igUsername    = process.env.INSTAGRAM_USERNAME              ?? "";

  // ── 1. Environment variable status ─────────────────────────────────────────
  const envStatus = {
    FACEBOOK_APP_SECRET:            { value: mask(appSecret),   critical: true,  issue: !appSecret ? "Signature check skipped  -  unsafe in production" : null },
    WEBHOOK_VERIFY_TOKEN:           { value: mask(verifyToken), critical: true,  issue: !verifyToken ? "Using hardcoded fallback 'instapilot_webhook_token'" : null },
    INSTAGRAM_ACCESS_TOKEN:         { value: mask(igToken),     critical: true,  issue: !igToken ? "Cannot call Instagram API or reply to comments" : null },
    INSTAGRAM_BUSINESS_ACCOUNT_ID: { value: mask(igAccountId), critical: true,  issue: !igAccountId ? "Cannot poll comments or check media" : null },
    FACEBOOK_PAGE_ID:               { value: mask(pageId),      critical: true,  issue: !pageId ? "DM replies will fail  -  Page ID required" : null },
    FACEBOOK_PAGE_ACCESS_TOKEN:     { value: mask(pageToken),   critical: false, issue: !pageToken ? "Will try to exchange token via /me/accounts (may fail)" : null },
    NEXT_PUBLIC_APP_URL:            { value: appUrl || "NOT SET", critical: true, issue: !appUrl ? "Webhook URL unknown  -  Meta cannot reach your server" : null },
    INSTAGRAM_USERNAME:             { value: igUsername || "NOT SET", critical: false, issue: !igUsername ? "Self-reply filter disabled  -  bot may reply to its own comments" : null },
  };

  // ── 2. Webhook URL check ────────────────────────────────────────────────────
  // The Instagram events (comments/messages/mentions) are delivered to the
  // dedicated IG handler at /api/webhooks/instagram (plural) — that's what the app
  // registers with Meta. /api/webhook (singular) is the SEPARATE page-object
  // endpoint; comparing Meta's IG callback against it produced a phantom mismatch.
  const webhookUrl    = appUrl ? `${appUrl}/api/webhooks/instagram` : null;
  const isLocalhost   = !!(appUrl && (appUrl.includes("localhost") || appUrl.includes("127.0.0.1")));
  const isHttps       = !!(appUrl && appUrl.startsWith("https://"));
  const urlOk         = webhookUrl && !isLocalhost && isHttps;

  // ── 2b. ngrok status ─────────────────────────────────────────────────────────
  const isNgrokUrl    = !!(appUrl && (
    appUrl.includes("ngrok-free.app") ||
    appUrl.includes("ngrok-free.dev") ||
    appUrl.includes("ngrok.io") ||
    appUrl.includes("ngrok.app") ||
    appUrl.includes(".ngrok.")
  ));
  // Try a quick reachability ping to the webhook URL (server-side)
  let ngrokReachable: boolean | null = null;
  if (isNgrokUrl && webhookUrl) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const pingRes = await fetch(webhookUrl + "?hub.mode=ping_check", {
        method: "GET",
        signal: ctrl.signal,
        headers: { "User-Agent": `${process.env.BRAND_NAME ?? "InstaPilot"}-Debug/1.0` },
      }).catch(() => null);
      clearTimeout(timer);
      // Any response (even 403) means the tunnel is UP
      ngrokReachable = pingRes !== null;
    } catch {
      ngrokReachable = false;
    }
  }

  // ── 3. App Secret HMAC test ─────────────────────────────────────────────────
  const hmacWorks = appSecret ? testAppSecretHmac(appSecret) : null;

  // ── 4. Effective verify token (fallback) ────────────────────────────────────
  const effectiveVerifyToken = verifyToken || "instapilot_webhook_token";

  // ── 5. App-level webhook subscriptions (correct endpoint) ───────────────────
  // Webhooks are registered at the APP level via GET /{app-id}/subscriptions.
  // This uses an App Access Token (APP_ID|APP_SECRET)  -  no user permissions needed.
  // The old /{page-id}/subscribed_apps endpoint requires pages_manage_metadata
  // and is unreliable. The app-level endpoint is authoritative.
  let appToken: string | null = null;
  let subData: { subs: Record<string, string[]>; callbackUrl?: string; callbacks: Record<string, string>; error?: string } = { subs: {}, callbacks: {} };
  let subCheckError: string | null = null;

  if (appId && appSecret) {
    appToken = await getAppAccessToken(appId, appSecret);
    if (appToken) {
      subData = await getAppSubscriptions(appId, appToken);
      subCheckError = subData.error ?? null;
    } else {
      subCheckError = "Could not generate App Access Token  -  check FACEBOOK_APP_ID and FACEBOOK_APP_SECRET";
    }
  } else {
    subCheckError = "FACEBOOK_APP_ID or FACEBOOK_APP_SECRET not set";
  }

  // comments = instagram object has "comments" field
  // messages = instagram object has "messages" OR page object has "messages"
  // mentions = instagram object has "mentions"
  const igFields   = subData.subs["instagram"] ?? [];
  const pageFields = subData.subs["page"]      ?? [];
  const allFields  = [...new Set([...igFields, ...pageFields])];

  const hasComments = igFields.includes("comments") || pageFields.includes("feed");
  const hasMessages = igFields.includes("messages") || pageFields.includes("messages");
  const hasMentions = igFields.includes("mentions") || pageFields.includes("mention") || pageFields.includes("mention");
  // Compare Meta's INSTAGRAM-object callback against the expected IG handler — the
  // page object legitimately uses a different callback (/api/webhook), so a single
  // global comparison falsely flagged a mismatch.
  const igCallbackUrl = subData.callbacks?.["instagram"] ?? null;
  const registeredCallbackUrl = igCallbackUrl ?? subData.callbackUrl ?? null;

  // ── 5b. Object-level account binding (the part that makes events flow) ──────
  // The app-level subscription above can show active:true while NO Page/IG
  // account is bound — in which case Meta delivers nothing. Probe the binding.
  const probeToken = pageToken || igToken;
  const pageBinding = await probeAccountBinding(pageId,      probeToken);
  const igBinding   = await probeAccountBinding(igAccountId, probeToken);
  const accountBound = pageBinding.bound === true || igBinding.bound === true;
  const bindingNeedsMetadataPerm =
    !!pageBinding.missingMetadataPerm || !!igBinding.missingMetadataPerm;

  // ── 6. Recent activity (did webhook deliver anything?) ──────────────────────
  const activity = await recentWebhookActivity(1);
  const webhookWorking = activity.total > 0;

  // ── 7. Overall diagnosis ────────────────────────────────────────────────────
  const issues: string[] = [];

  if (!appSecret) {
    issues.push("⚠️  FACEBOOK_APP_SECRET not set  -  signature verification skipped (unsafe)");
  } else if (!hmacWorks) {
    issues.push("❌ FACEBOOK_APP_SECRET appears invalid  -  HMAC generation failed");
  }

  if (isLocalhost) {
    issues.push("❌ NEXT_PUBLIC_APP_URL is localhost  -  Meta CANNOT reach your server. Use ngrok / Cloudflare Tunnel / a deployed URL");
  } else if (!isHttps) {
    issues.push("❌ NEXT_PUBLIC_APP_URL must be HTTPS  -  Meta rejects plain HTTP webhook URLs");
  } else if (!appUrl) {
    issues.push("❌ NEXT_PUBLIC_APP_URL is not set  -  webhook URL is unknown");
  }

  if (subCheckError && !appToken) {
    issues.push(`⚠️  Cannot verify subscriptions: ${subCheckError}`);
  } else if (!hasComments) {
    issues.push("❌ 'comments' field NOT subscribed  -  comment events will never arrive. Restart server then click Auto-Subscribe.");
  }
  if (!hasMessages) {
    issues.push("⚠️  'messages' field not subscribed  -  DM events won't arrive via webhook");
  }
  if (!hasMentions) {
    issues.push("⚠️  'mentions' field not subscribed  -  @mention events won't arrive via webhook");
  }

  if (igCallbackUrl && webhookUrl && igCallbackUrl !== webhookUrl) {
    issues.push(`❌ Instagram callback URL mismatch  -  Meta has: ${igCallbackUrl} but expected: ${webhookUrl}`);
  }

  // Object-level binding diagnosis — the most common "active:true but silent" cause.
  if (bindingNeedsMetadataPerm) {
    issues.push(
      "⛔ Page/Instagram account is NOT bound to the app and CANNOT be bound automatically  -  " +
      "the page token is missing `pages_manage_metadata`. App-level subscription shows active:true but " +
      "Meta delivers NOTHING until the account is bound. FIX: regenerate the long-lived Page token WITH " +
      "pages_manage_metadata, update FACEBOOK_PAGE_ACCESS_TOKEN (+ INSTAGRAM_ACCESS_TOKEN) in Railway, restart."
    );
  } else if (!accountBound && hasComments) {
    issues.push(
      "❌ App-level fields subscribed but NO Page/IG account bound (/{id}/subscribed_apps empty)  -  " +
      "events will not be delivered. Restart the server (startup auto-subscribe binds the account) or POST /api/webhook/setup."
    );
  }

  if (!webhookWorking && issues.length === 0) {
    issues.push("⚠️  No webhook events in the last hour  -  post a comment on Instagram to test");
  }

  // ── 8. Fix instructions ─────────────────────────────────────────────────────
  const fixSteps = [
    {
      step: 1,
      title: "Public HTTPS URL",
      done: !!urlOk,
      instruction: isLocalhost
        ? "Run: npx ngrok http 3000  -  copy the https URL and set it as NEXT_PUBLIC_APP_URL in .env.local"
        : urlOk
        ? `URL OK: ${webhookUrl}`
        : "Set NEXT_PUBLIC_APP_URL in .env.local to your public HTTPS URL",
    },
    {
      step: 2,
      title: "App Secret correct",
      done: !!appToken,
      instruction: "Go to: developers.facebook.com -> Your App -> App Settings -> Basic -> App Secret (click Show)\nPaste into .env.local as: FACEBOOK_APP_SECRET=<value>",
    },
    {
      step: 3,
      title: "Instagram comments subscribed",
      done: hasComments,
      instruction: `App-level subscriptions are set via POST /${appId}/subscriptions.\nCurrent instagram fields: ${igFields.join(", ") || "none"}\nCurrent page fields: ${pageFields.join(", ") || "none"}\n\nClick the Auto-Subscribe button below to register all fields automatically.`,
    },
    {
      step: 4,
      title: "Messages & mentions subscribed",
      done: hasMessages && hasMentions,
      instruction: "Click Auto-Subscribe below  -  it registers comments, messages, and mentions in one call using the App Access Token.",
    },
    {
      step: 5,
      title: "Restart server after .env changes",
      done: webhookWorking || (hasComments && hasMessages),
      instruction: "After updating .env.local, stop the dev server (Ctrl+C) and run: npm run dev\nThe new App Secret and Page Token will be picked up on restart.",
    },
    {
      step: 6,
      title: "Webhook receiving events",
      done: webhookWorking,
      instruction: "Post a comment on one of your Instagram posts, then refresh this page.\nIf the count above stays 0, check that ngrok is running and the Meta app is in Live mode.",
    },
  ];

  // ── Response ────────────────────────────────────────────────────────────────
  return NextResponse.json({
    success: true,
    data: {
      summary: {
        webhookWorking,
        issueCount: issues.length,
        issues,
        overallStatus: issues.length === 0
          ? "Webhook appears correctly configured"
          : `${issues.length} issue(s) found`,
      },
      webhookUrl: webhookUrl ?? "Unknown  -  set NEXT_PUBLIC_APP_URL",
      registeredCallbackUrl,
      urlChecks: {
        isHttps,
        isLocalhost,
        ok: urlOk,
      },
      appSecret: {
        set:         !!appSecret,
        tokenWorks:  !!appToken,
        hmacWorks:   hmacWorks ?? "N/A (not set)",
        maskedValue: mask(appSecret),
      },
      verifyToken: {
        set:            !!verifyToken,
        effectiveValue: effectiveVerifyToken,
        note: !verifyToken ? "Using hardcoded fallback  -  set WEBHOOK_VERIFY_TOKEN in .env.local" : "Using env var",
      },
      subscriptions: {
        raw:      allFields,
        igFields,
        pageFields,
        comments: hasComments,
        messages: hasMessages,
        mentions: hasMentions,
        error:    subCheckError,
      },
      accountBinding: {
        // Whether THIS Page/IG account is actually bound to the app. Without a
        // binding, app-level subscriptions are active but no events are delivered.
        bound:                accountBound,
        page:                 { bound: pageBinding.bound, fields: pageBinding.fields, error: pageBinding.error ?? null },
        instagram:            { bound: igBinding.bound,   fields: igBinding.fields,   error: igBinding.error ?? null },
        needsManageMetadata:  bindingNeedsMetadataPerm,
        note: bindingNeedsMetadataPerm
          ? "Page token lacks pages_manage_metadata — cannot bind the account; events will NOT arrive. Re-grant the scope."
          : accountBound
            ? "Account is bound — Meta can deliver events for it."
            : "Account NOT bound — restart the server or POST /api/webhook/setup to bind it.",
      },
      recentActivity: {
        windowHours: 1,
        comments:    activity.comments,
        dms:         activity.dms,
        total:       activity.total,
        note: webhookWorking
          ? "Webhook IS delivering events"
          : "No webhook events in the last hour",
      },
      ngrokStatus: {
        needed:      isLocalhost,
        configured:  isNgrokUrl,
        reachable:   ngrokReachable,
        url:         isNgrokUrl ? appUrl : null,
        state: isLocalhost
          ? "needed"                          // localhost - must use tunnel
          : isNgrokUrl
            ? (ngrokReachable ? "active" : "unreachable")  // ngrok URL set
            : appUrl
              ? "custom-domain"               // proper domain, no tunnel needed
              : "unknown",
        hint: isLocalhost
          ? "Run: npx ngrok http 3000  then set NEXT_PUBLIC_APP_URL in .env.local to the https URL"
          : isNgrokUrl && !ngrokReachable
            ? "ngrok URL is set but tunnel is not responding - restart ngrok and update NEXT_PUBLIC_APP_URL"
            : isNgrokUrl
              ? "Tunnel is live - Meta can deliver webhook events to your local server"
              : appUrl
                ? "Using a deployed/custom domain - no tunnel required"
                : "Set NEXT_PUBLIC_APP_URL to your server URL",
      },
      envVars: envStatus,
      fixSteps,
    },
  });
}
