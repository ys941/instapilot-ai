/**
 * lib/webhookSubscribe.ts
 *
 * Ensures Instagram comment/DM/mention webhook events actually arrive in real time.
 *
 * Real-time delivery requires TWO independent bindings — BOTH must be in place:
 *
 *   1. APP-LEVEL field subscription   — POST /{app-id}/subscriptions
 *        Declares "this app wants the comments/messages/mentions fields delivered
 *        to this callback URL." Uses an App Access Token (APP_ID|APP_SECRET).
 *        This is what shows up as object="instagram" active:true. It does NOT,
 *        by itself, cause any events to fire.
 *
 *   2. OBJECT-LEVEL subscription      — POST /{page-id}/subscribed_apps  AND
 *                                       POST /{ig-id}/subscribed_apps
 *        Binds THIS specific Page / Instagram account to the app so Meta has
 *        something to deliver. WITHOUT this, the app-level subscription shows
 *        active:true but NO events are ever delivered — the exact "webhook not
 *        working / total silence" symptom. Requires the page access token to
 *        carry the `pages_manage_metadata` permission.
 *
 * A previous version only did step 1, so the IG account was never bound and no
 * comment/DM events were delivered. Step 2 is added here, idempotently.
 *
 * Called best-effort on server startup (instrumentation.ts). Never throws.
 * No-ops safely when secrets/ids are missing so it can never break the app.
 */

const GRAPH_BASE = "https://graph.facebook.com/v25.0";

async function getAppAccessToken(appId: string, appSecret: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const data = await res.json();
    if (data.error || !data.access_token) return null;
    return data.access_token as string;
  } catch {
    return null;
  }
}

export interface SubscribeResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  fields?: string[];
  /** App-level /{app-id}/subscriptions result. */
  appLevel?: { ok: boolean; error?: string };
  /** Page object-level /{page-id}/subscribed_apps result. */
  pageBinding?: { ok: boolean; error?: string };
  /** Instagram object-level /{ig-id}/subscribed_apps result. */
  igBinding?: { ok: boolean; error?: string };
  /** True when an object binding failed specifically due to a missing
   *  pages_manage_metadata permission (requires a manual token re-grant). */
  needsManageMetadata?: boolean;
}

/**
 * POST /{node-id}/subscribed_apps with the given subscribed_fields.
 * Idempotent — Meta treats repeated calls as a no-op update.
 */
async function subscribeObject(
  nodeId: string,
  subscribedFields: string[],
  pageToken: string
): Promise<{ ok: boolean; error?: string; missingMetadataPerm?: boolean }> {
  try {
    const params = new URLSearchParams({
      subscribed_fields: subscribedFields.join(","),
      access_token:      pageToken,
    });
    const res  = await fetch(`${GRAPH_BASE}/${nodeId}/subscribed_apps`, {
      method: "POST",
      body:   params,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    if (data.error) {
      // code 200 / "Requires pages_manage_metadata permission" → the token is
      // missing the scope needed to bind the object. Surface this distinctly so
      // the operator knows a manual token re-grant is required.
      const msg = String(data.error.message ?? "");
      const missingMetadataPerm =
        data.error.code === 200 || /pages_manage_metadata/i.test(msg);
      return { ok: false, error: msg, missingMetadataPerm };
    }
    return { ok: !!data.success };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/**
 * Ensure BOTH the app-level field subscription AND the per-account object
 * bindings (Page + Instagram) are in place so events actually flow.
 * Never throws. Returns a detailed status object.
 */
export async function ensureInstagramWebhookSubscribed(): Promise<SubscribeResult> {
  const appId      = process.env.FACEBOOK_APP_ID?.trim()       ?? "";
  const appSecret  = process.env.FACEBOOK_APP_SECRET?.trim()   ?? "";
  const appUrl     = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const verifyTok  = process.env.WEBHOOK_VERIFY_TOKEN          ?? "instapilot_webhook_token";
  const pageId     = process.env.FACEBOOK_PAGE_ID?.trim()             ?? "";
  const igId       = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim() ?? "";
  // Prefer an explicit page token; fall back to the IG/long-lived token, which
  // in this deployment IS a Page token (debug_token confirms type=PAGE).
  const pageToken  =
    (process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim() ||
     process.env.INSTAGRAM_ACCESS_TOKEN?.trim()) ?? "";

  if (!appId || !appSecret) return { ok: false, skipped: true, error: "FACEBOOK_APP_ID/SECRET not set" };
  if (!appUrl || appUrl.includes("localhost") || appUrl.includes("127.0.0.1")) {
    return { ok: false, skipped: true, error: "NEXT_PUBLIC_APP_URL is not a public https URL" };
  }

  // A wrong/stale app secret fails here → we no-op (never touch the live subscription).
  const appToken = await getAppAccessToken(appId, appSecret);
  if (!appToken) {
    return { ok: false, skipped: true, error: "Could not mint app access token (check FACEBOOK_APP_SECRET)" };
  }

  // Target the SAFE handler (verify-but-don't-drop), not the strict /api/webhook.
  const callbackUrl = `${appUrl}/api/webhooks/instagram`;
  const fields = ["comments", "messages", "mentions"];

  // ── Step 1: APP-LEVEL field subscription ──────────────────────────────────
  let appLevel: { ok: boolean; error?: string };
  try {
    const params = new URLSearchParams({
      object:       "instagram",
      callback_url: callbackUrl,
      fields:       fields.join(","),
      verify_token: verifyTok,
      access_token: appToken,
    });
    const res  = await fetch(`${GRAPH_BASE}/${appId}/subscriptions`, {
      method: "POST",
      body:   params,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    appLevel = data.error ? { ok: false, error: data.error.message } : { ok: !!data.success };
  } catch (e: any) {
    appLevel = { ok: false, error: e?.message ?? String(e) };
  }

  // ── Step 2: OBJECT-LEVEL bindings (the part that was missing) ──────────────
  // Without these, the app-level subscription is active:true but Meta has no
  // Page/IG account bound to deliver from → zero events arrive.
  let pageBinding: { ok: boolean; error?: string } | undefined;
  let igBinding:   { ok: boolean; error?: string } | undefined;
  let needsManageMetadata = false;

  if (pageToken && pageId) {
    // Page object fields are DIFFERENT from the instagram object fields: a Page
    // uses `feed` (carries comment events) and `mention` (SINGULAR) — NOT the
    // instagram-style `comments`/`mentions`. Sending an invalid value makes Meta
    // reject the WHOLE call with (#100), so the binding silently never updates.
    const r = await subscribeObject(pageId, ["feed", "messages", "mention"], pageToken);
    pageBinding = { ok: r.ok, error: r.error };
    if (r.missingMetadataPerm) needsManageMetadata = true;
  }
  // NOTE: classic Facebook-Page-linked Instagram accounts do NOT expose
  // /{ig-id}/subscribed_apps (it 404s with "nonexisting field") — for them the
  // Page binding above is the delivery point. We only attempt the IG-level bind
  // when an IG id is configured, and a failure here is non-fatal (page binding
  // is what actually enables delivery for this account type).
  if (pageToken && igId) {
    const r = await subscribeObject(igId, ["comments", "messages", "mentions"], pageToken);
    igBinding = { ok: r.ok, error: r.error };
    if (r.missingMetadataPerm) needsManageMetadata = true;
  }

  // Overall ok = app-level subscribed AND at least one object binding succeeded.
  const anyBindingOk = !!(pageBinding?.ok || igBinding?.ok);
  const ok = appLevel.ok && anyBindingOk;

  const errorParts: string[] = [];
  if (!appLevel.ok && appLevel.error)     errorParts.push(`app-level: ${appLevel.error}`);
  if (pageBinding && !pageBinding.ok && pageBinding.error) errorParts.push(`page-bind: ${pageBinding.error}`);
  if (igBinding   && !igBinding.ok   && igBinding.error)   errorParts.push(`ig-bind: ${igBinding.error}`);

  return {
    ok,
    fields,
    appLevel,
    pageBinding,
    igBinding,
    needsManageMetadata,
    error: errorParts.length ? errorParts.join(" | ") : undefined,
  };
}
