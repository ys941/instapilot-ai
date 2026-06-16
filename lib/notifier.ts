/**
 * lib/notifier.ts
 *
 * Email notification system — beautiful HTML alerts via Resend API.
 *
 * TWO delivery modes:
 *   1. REAL-TIME — fires immediately for critical events:
 *        - Post publish failure
 *        - Instagram / AI API rate limit hit
 *        - API health degraded (token invalid, DB down, AI down)
 *        - Any other critical system error
 *   2. DAILY DIGEST — one comprehensive email at 9 AM IST with:
 *        - System health status (DB, AI, Instagram)
 *        - 24-hour activity summary (published, failed, comments, DMs)
 *        - Failed posts from the last 24 h (with error messages)
 *        - Rate limit events from the last 24 h
 *        - System errors from the last 24 h
 *        - Auto-generated posts for today
 *        - Upcoming scheduled posts
 *
 * Configuration (Railway env vars):
 *   RESEND_API_KEY      — Resend API key (https://resend.com/api-keys)
 *   RESEND_FROM         — optional "From" address (defaults to onboarding@resend.dev)
 *   NOTIFICATION_EMAIL  — recipient address for alerts
 *   BRAND_NAME          — white-label brand name used in subjects/HTML
 */

import { isYouTubeConfigured, checkYouTubeHealth } from "@/lib/youtube";
import { readPreferences } from "@/lib/preferences";
import { notifEmitter, LiveNotif, incrementWebhookCounter } from "@/lib/webhookCounter";

/** White-label brand name for email subjects + HTML chrome. */
const BRAND_NAME  = process.env.BRAND_NAME ?? "InstaPilot AI";
const RECIPIENT   = process.env.NOTIFICATION_EMAIL ?? "";
const RESEND_KEY  = process.env.RESEND_API_KEY     ?? "";

/**
 * Resolve the alert recipient address.
 * Priority: DB-saved notificationEmail (Settings → Notifications) > NOTIFICATION_EMAIL
 * env var > hardcoded default. This makes the "Recipient Email Address" field in the
 * Notifications settings tab actually control where alerts are delivered.
 */
async function resolveRecipient(): Promise<string> {
  try {
    const prefs = await readPreferences();
    const dbEmail = (prefs?.notifications?.notificationEmail ?? "").trim();
    if (dbEmail) return dbEmail;
  } catch { /* fall through to env default */ }
  return RECIPIENT;
}

/**
 * Honour the Settings → Notifications email toggles.
 *   "publish"   → emailPublish   (a post/Short published successfully)
 *   "fails"     → emailFails      (a post/Short failed to publish)
 *   "analytics" → emailAnalytics  (the daily 9 AM digest)
 * Defaults to TRUE when the pref is unset so existing behaviour is preserved.
 * Infrastructure-critical alerts (rate-limit, health degraded, webhook, system
 * error) are intentionally NOT gated — they always send.
 */
async function emailKindEnabled(kind: "publish" | "fails" | "analytics"): Promise<boolean> {
  try {
    const prefs = await readPreferences();
    const n = prefs?.notifications as unknown as Record<string, unknown> | undefined;
    if (!n) return true;
    const key = kind === "publish" ? "emailPublish" : kind === "fails" ? "emailFails" : "emailAnalytics";
    return n[key] !== false; // unset/true → send
  } catch {
    return true; // never silently drop alerts on a pref read error
  }
}
const RESEND_FROM = process.env.RESEND_FROM        ?? `${BRAND_NAME} <onboarding@resend.dev>`;
const APP_URL     = process.env.NEXT_PUBLIC_APP_URL ?? "";

// ── In-memory event log (24-hour rolling window) ─────────────────────────────
// These accumulate throughout the day and are included in the 9 AM digest.
// Cleared when the daily report is sent or on server restart.

const EVENT_TTL_MS = 24 * 60 * 60 * 1000; // keep events for 24 hours
const MAX_EVENTS   = 100;

export interface RateLimitEvent {
  service:  string;
  detail:   string;
  time:     Date;
}

export interface SystemErrorEvent {
  title:  string;
  detail: string;
  time:   Date;
}

export interface HealthChangeEvent {
  service: string;
  status:  "degraded" | "recovered";
  detail:  string;
  time:    Date;
}

const _rateLimitLog:  RateLimitEvent[]  = [];
const _errorLog:      SystemErrorEvent[] = [];
const _healthLog:     HealthChangeEvent[] = [];

/** Log a rate-limit event for the daily digest. */
export function logRateLimitEvent(service: string, detail: string): void {
  _rateLimitLog.push({ service, detail, time: new Date() });
  if (_rateLimitLog.length > MAX_EVENTS) _rateLimitLog.shift();
}

/** Log a system error for the daily digest. */
export function logSystemErrorEvent(title: string, detail: string): void {
  _errorLog.push({ title, detail, time: new Date() });
  if (_errorLog.length > MAX_EVENTS) _errorLog.shift();
}

/** Log a health change event for the daily digest. */
export function logHealthChangeEvent(service: string, status: "degraded" | "recovered", detail: string): void {
  _healthLog.push({ service, status, detail, time: new Date() });
  if (_healthLog.length > MAX_EVENTS) _healthLog.shift();
}

/** Get rate limit events from the last 24 h. */
export function getRecentRateLimitEvents(): RateLimitEvent[] {
  const cutoff = Date.now() - EVENT_TTL_MS;
  return _rateLimitLog.filter((e) => e.time.getTime() > cutoff);
}

/** Get system error events from the last 24 h. */
export function getRecentSystemErrors(): SystemErrorEvent[] {
  const cutoff = Date.now() - EVENT_TTL_MS;
  return _errorLog.filter((e) => e.time.getTime() > cutoff);
}

/** Get health change events from the last 24 h. */
export function getRecentHealthChanges(): HealthChangeEvent[] {
  const cutoff = Date.now() - EVENT_TTL_MS;
  return _healthLog.filter((e) => e.time.getTime() > cutoff);
}

// ── Rate-limit tracker (per-email deduplication) ──────────────────────────────
const _sentAt = new Map<string, number>();
const RATE_LIMIT_MS = 10 * 60 * 1000; // 10 minutes

function isRateLimited(key: string): boolean {
  const last = _sentAt.get(key) ?? 0;
  if (Date.now() - last < RATE_LIMIT_MS) return true;
  _sentAt.set(key, Date.now());
  return false;
}

// ── IST time formatter ────────────────────────────────────────────────────────
function toIST(d: Date, short = false): string {
  if (short) {
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  }
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short", year: "numeric", month: "short",
    day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Shared HTML wrapper — dark-themed, brand-aware ───────────────────────────
function emailWrapper(opts: {
  accentColor: string;
  icon:        string;
  heading:     string;
  subheading?: string;
  body:        string;
  ctaLabel?:   string;
  ctaUrl?:     string;
  badgeLabel?: string;
  badgeColor?: string;
}): string {
  const {
    accentColor, icon, heading, subheading = "", body,
    ctaLabel, ctaUrl, badgeLabel, badgeColor = "#374151",
  } = opts;
  const now = toIST(new Date());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Segoe UI',Arial,sans-serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0f;padding:32px 16px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;background:#12121c;border-radius:16px;
                      border:1px solid #1e1e2e;overflow:hidden;
                      box-shadow:0 0 60px rgba(0,0,0,0.6);">

          <!-- Top accent bar -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,${accentColor},${accentColor}88,transparent);"></td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:32px 36px 24px;background:linear-gradient(135deg,#12121c 0%,#1a1a2e 100%);">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <!-- Logo mark -->
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:linear-gradient(135deg,${accentColor}22,${accentColor}11);
                                   border:1px solid ${accentColor}44;border-radius:12px;
                                   padding:10px 14px;display:inline-block;">
                          <span style="font-size:24px;line-height:1;">${icon}</span>
                        </td>
                        <td style="padding-left:14px;vertical-align:middle;">
                          <div style="font-size:11px;letter-spacing:3px;color:${accentColor};
                                      text-transform:uppercase;font-weight:700;margin-bottom:3px;">
                            ${BRAND_NAME}
                          </div>
                          <div style="font-size:10px;color:#4b5563;letter-spacing:1px;text-transform:uppercase;">
                            System Alert
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    ${badgeLabel ? `
                    <span style="display:inline-block;background:${badgeColor}22;
                                 border:1px solid ${badgeColor}55;border-radius:20px;
                                 padding:4px 12px;font-size:10px;font-weight:700;
                                 color:${badgeColor};letter-spacing:1px;text-transform:uppercase;">
                      ${badgeLabel}
                    </span>` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="height:1px;background:linear-gradient(90deg,transparent,#1e1e2e,transparent);"></td>
          </tr>

          <!-- Heading section -->
          <tr>
            <td style="padding:28px 36px 20px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;line-height:1.3;">
                ${heading}
              </h1>
              ${subheading ? `<p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">${subheading}</p>` : ""}
            </td>
          </tr>

          <!-- Body content -->
          <tr>
            <td style="padding:0 36px 28px;">
              ${body}
            </td>
          </tr>

          <!-- CTA Button -->
          ${ctaLabel && ctaUrl ? `
          <tr>
            <td style="padding:0 36px 32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,${accentColor},${accentColor}cc);">
                    <a href="${ctaUrl}"
                       style="display:inline-block;padding:12px 28px;color:#fff;
                              font-weight:700;font-size:13px;text-decoration:none;
                              letter-spacing:0.5px;border-radius:10px;">
                      ${ctaLabel} →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : ""}

          <!-- Divider -->
          <tr>
            <td style="height:1px;background:linear-gradient(90deg,transparent,#1e1e2e,transparent);"></td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px;background:#0e0e18;border-radius:0 0 16px 16px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0 0 4px;font-size:11px;color:#374151;line-height:1.5;">
                      🕐 &nbsp;<span style="color:#4b5563;">${now} IST</span>
                    </p>
                    <p style="margin:0;font-size:11px;color:#374151;">
                      Sent by <span style="color:#4b5563;">${BRAND_NAME}</span> ·
                      <a href="${APP_URL}/settings" style="color:#4b5563;text-decoration:none;">Manage alerts</a>
                    </p>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="font-size:18px;">❤️</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- End card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}

// ── Reusable UI components ────────────────────────────────────────────────────

function infoRow(label: string, value: string): string {
  return `
  <tr>
    <td style="padding:8px 14px 8px 0;color:#64748b;font-size:12px;
               white-space:nowrap;vertical-align:top;width:110px;">${label}</td>
    <td style="padding:8px 0;color:#e2e8f0;font-size:13px;font-weight:500;vertical-align:top;">${value}</td>
  </tr>`;
}

function infoTable(rows: Array<[string, string]>): string {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#0e0e18;border:1px solid #1e1e2e;
                border-radius:10px;padding:4px 14px;margin-bottom:20px;">
    ${rows.map(([l, v]) => infoRow(l, v)).join("")}
  </table>`;
}

function errorBox(message: string, accentColor = "#ef4444"): string {
  return `
  <div style="background:${accentColor}0d;border:1px solid ${accentColor}33;
              border-left:3px solid ${accentColor};border-radius:8px;
              padding:14px 16px;margin-bottom:20px;">
    <p style="margin:0 0 4px;font-size:10px;font-weight:700;
               color:${accentColor};letter-spacing:2px;text-transform:uppercase;">Error</p>
    <p style="margin:0;font-size:12px;color:#fca5a5;font-family:monospace;
               line-height:1.6;word-break:break-all;">${message}</p>
  </div>`;
}

function tipBox(message: string): string {
  return `
  <div style="background:#1e1e2e;border-radius:8px;padding:12px 16px;">
    <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
      💡 &nbsp;${message}
    </p>
  </div>`;
}

// ── Resend HTTP API sender ────────────────────────────────────────────────────
async function sendViaResend(subject: string, html: string): Promise<void> {
  if (!RESEND_KEY) throw new Error("RESEND_API_KEY not configured");
  const recipient = await resolveRecipient();
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    RESEND_FROM,
      to:      [recipient],
      subject: `${BRAND_NAME} Alert: ${subject}`,
      html,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Resend API ${res.status}: ${text}`);
  }
}

// ── Core send function ────────────────────────────────────────────────────────
async function sendEmail(
  subject: string,
  html:    string,
  key?:    string,
  skipRateLimit = false,
): Promise<void> {
  if (!skipRateLimit) {
    const rateKey = key ?? subject;
    if (isRateLimited(rateKey)) {
      console.log("[Notifier] Rate-limited, skipping:", subject);
      return;
    }
  }

  try {
    await sendViaResend(subject, html);
    console.log(`[Notifier] ✅ Email sent via Resend: "${subject}"`);
  } catch (err: any) {
    console.error(`[Notifier] ❌ Failed to send email "${subject}":`, err?.message);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// REAL-TIME ALERT FUNCTIONS — fire immediately when something goes wrong
// ════════════════════════════════════════════════════════════════════════════════

/** REAL-TIME: Alert when a scheduled or media-folder post fails to publish. */
export async function notifyPostFailed(opts: {
  postId:   string;
  postType?: string;
  title?:   string;
  error:    string;
  isStory?: boolean;
}): Promise<void> {
  const { postId, postType = "POST", title = "Untitled", error, isStory = false } = opts;
  const kind = isStory ? "Story" : postType;

  // Log for daily digest (always — independent of the email toggle)
  logSystemErrorEvent(`${kind} Publish Failed: ${title}`, error);

  // Respect Settings → Notifications "email on failure" toggle.
  if (!(await emailKindEnabled("fails"))) return;

  const html = emailWrapper({
    accentColor: "#ef4444",
    icon:        "📵",
    heading:     `${kind} Failed to Publish`,
    subheading:  "An Instagram publishing attempt failed. Review the details below and check Railway logs.",
    badgeLabel:  "🚨 Publish Error",
    badgeColor:  "#ef4444",
    body: `
      ${infoTable([
        ["Post ID",   postId],
        ["Type",      kind],
        ["Title",     title],
        ["Time",      toIST(new Date()) + " IST"],
      ])}
      ${errorBox(error, "#ef4444")}
      ${tipBox(`Check <strong style="color:#94a3b8;">/api/scheduler/failed</strong> for full diagnostics, or visit the Scheduler page to retry manually.`)}
    `,
    ctaLabel: "Open Scheduler",
    ctaUrl:   `${APP_URL}/scheduler`,
  });
  await sendEmail(`${kind} Publish Failed — ${title}`, html, `post_failed:${postId}`);
}

/** REAL-TIME: Alert when Instagram or AI API rate limits are hit. */
export async function notifyRateLimit(opts: {
  service: string;
  detail?: string;
}): Promise<void> {
  const { service, detail } = opts;

  // Log for daily digest
  logRateLimitEvent(service, detail ?? "Rate limit hit");

  const html = emailWrapper({
    accentColor: "#f59e0b",
    icon:        "⏱️",
    heading:     `${service} Rate Limit Reached`,
    subheading:  "API quota exhausted. The system has automatically paused affected calls.",
    badgeLabel:  "⚠️ Rate Limit",
    badgeColor:  "#f59e0b",
    body: `
      ${infoTable([
        ["Service",  service],
        ["Time",     toIST(new Date()) + " IST"],
        ["Action",   "API calls paused automatically"],
        ["Recovery", "Will resume after backoff period"],
      ])}
      ${detail ? `
      <div style="background:#f59e0b0d;border:1px solid #f59e0b33;border-left:3px solid #f59e0b;
                  border-radius:8px;padding:14px 16px;margin-bottom:20px;">
        <p style="margin:0;font-size:12px;color:#fcd34d;line-height:1.6;">${detail}</p>
      </div>` : ""}
      ${tipBox("The system will automatically retry once the rate limit window resets. No action needed unless this persists.")}
    `,
    ctaLabel: "View Dashboard",
    ctaUrl:   `${APP_URL}/overview`,
  });
  await sendEmail(`${service} Rate Limit Hit`, html, `rate_limit:${service}`);
}

/** REAL-TIME: Alert when an API health check detects a service is down or degraded. */
export async function notifyApiHealthDegraded(opts: {
  service: string;
  detail:  string;
  action?: string;
}): Promise<void> {
  const { service, detail, action = "Review Railway logs and environment variables." } = opts;

  // Log for daily digest
  logHealthChangeEvent(service, "degraded", detail);
  logSystemErrorEvent(`API Health: ${service} Degraded`, detail);

  const html = emailWrapper({
    accentColor: "#ef4444",
    icon:        "🔴",
    heading:     `${service} Health Degraded`,
    subheading:  "A critical service is not responding correctly. Automation may be paused.",
    badgeLabel:  "🔴 Health Alert",
    badgeColor:  "#ef4444",
    body: `
      ${infoTable([
        ["Service",  service],
        ["Status",   "Degraded / Unreachable"],
        ["Time",     toIST(new Date()) + " IST"],
      ])}
      ${errorBox(detail, "#ef4444")}
      <div style="background:#1e1e2e;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
        <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
          🛠️ &nbsp;${action}
        </p>
      </div>
    `,
    ctaLabel: "View Health Dashboard",
    ctaUrl:   `${APP_URL}/overview`,
  });
  await sendEmail(`${service} Health Degraded`, html, `health_degraded:${service}`);
}

/** REAL-TIME: Alert when the Instagram webhook stops delivering events. */
export async function notifyWebhookIssue(detail: string): Promise<void> {
  logSystemErrorEvent("Instagram Webhook Issue", detail);

  const html = emailWrapper({
    accentColor: "#8b5cf6",
    icon:        "🔌",
    heading:     "Instagram Webhook Issue",
    subheading:  "Webhook events may have stopped. Comment and DM automation could be affected.",
    badgeLabel:  "⚠️ Webhook",
    badgeColor:  "#8b5cf6",
    body: `
      ${infoTable([
        ["Status",  "Webhook delivery interrupted"],
        ["Time",    toIST(new Date()) + " IST"],
        ["Impact",  "Comment replies · DM automation · Engagement tracking"],
      ])}
      <div style="background:#8b5cf60d;border:1px solid #8b5cf633;border-left:3px solid #8b5cf6;
                  border-radius:8px;padding:14px 16px;margin-bottom:20px;">
        <p style="margin:0;font-size:12px;color:#c4b5fd;line-height:1.6;">${detail}</p>
      </div>
      ${tipBox("Go to <strong style=\"color:#94a3b8;\">Meta Business Suite → App Settings → Webhooks</strong> and verify the subscription is active and the callback URL is reachable.")}
    `,
    ctaLabel: "Webhook Settings",
    ctaUrl:   `${APP_URL}/settings`,
  });
  await sendEmail("Instagram Webhook Issue", html, "webhook_issue");
}

/** REAL-TIME: Generic critical error alert. */
export async function notifySystemError(opts: {
  title:    string;
  detail:   string;
  rateKey?: string;
}): Promise<void> {
  const { title, detail, rateKey } = opts;

  // Log for daily digest
  logSystemErrorEvent(title, detail);

  const html = emailWrapper({
    accentColor: "#ef4444",
    icon:        "🔴",
    heading:     title,
    subheading:  "A critical system error was detected. Immediate review recommended.",
    badgeLabel:  "🚨 System Error",
    badgeColor:  "#ef4444",
    body: `
      ${infoTable([["Time", toIST(new Date()) + " IST"]])}
      ${errorBox(detail, "#ef4444")}
      ${tipBox("Check Railway logs for the full stack trace. If this error repeats, consider redeploying.")}
    `,
    ctaLabel: "View Settings",
    ctaUrl:   `${APP_URL}/settings`,
  });
  await sendEmail(title, html, rateKey ?? title);
}

// ════════════════════════════════════════════════════════════════════════════════
// YOUTUBE EVENTS — real-time SSE push (+ email for publish/failure)
// ════════════════════════════════════════════════════════════════════════════════
//
// These mirror the Instagram notification shapes so the UI renders them
// consistently. Each emits a LiveNotif on the SSE stream (instant) and bumps the
// webhook counter; publish + failure also send an email. All best-effort — they
// never throw into the publish flow.

/** Build a youtube.com/shorts URL from a video ID. */
function youtubeShortUrl(videoId: string): string {
  return `https://youtube.com/shorts/${videoId}`;
}

/** Fire a LiveNotif on the SSE stream + bump the counter. Best-effort. */
function emitLiveNotif(notif: LiveNotif): void {
  try {
    notifEmitter.emit("notif", notif);
    incrementWebhookCounter();
  } catch (err: any) {
    console.warn("[Notifier] emitLiveNotif failed:", err?.message);
  }
}

/** REAL-TIME: a YouTube Short was published. Emits a live notif + sends an email. */
export async function notifyYouTubePublished(opts: {
  spId:     string;
  videoId:  string;
  title?:   string;
  isStory?: boolean;
}): Promise<void> {
  const { spId, videoId, title = "Untitled", isStory = false } = opts;
  const url = youtubeShortUrl(videoId);

  // Instant SSE push — "success" type, matching the Instagram publish shape.
  emitLiveNotif({
    id:        `yt_pub:${videoId}`,
    type:      "success",
    message:   "▶️ YouTube Short published",
    detail:    `${title}: ${url}`,
    entityId:  videoId,
    action:    "YOUTUBE_PUBLISHED",
    createdAt: new Date().toISOString(),
    read:      false,
  });

  // Live SSE notif always fires; the EMAIL respects the "email on publish" toggle.
  if (!(await emailKindEnabled("publish"))) return;

  const html = emailWrapper({
    accentColor: "#ff0000",
    icon:        "▶️",
    heading:     "YouTube Short Published",
    subheading:  "A new Short was published to your YouTube channel.",
    badgeLabel:  "▶️ Published",
    badgeColor:  "#ff0000",
    body: `
      ${infoTable([
        ["Title",     title],
        ["Type",      isStory ? "Story → Short" : "Short"],
        ["Video ID",  videoId],
        ["URL",       `<a href="${url}" style="color:#f87171;text-decoration:none;">${url}</a>`],
        ["Time",      toIST(new Date()) + " IST"],
      ])}
      ${tipBox(`Watch it live on YouTube, or open the dashboard to track engagement.`)}
    `,
    ctaLabel: "Watch on YouTube",
    ctaUrl:   url,
  });
  await sendEmail(`YouTube Short Published — ${title}`, html, `yt_published:${spId}`)
    .catch((err: any) => console.warn("[Notifier] YouTube publish email failed:", err?.message));
}

/** REAL-TIME: a YouTube comment was replied to. Live notif only (optional). */
export function notifyYouTubeCommentReplied(opts: {
  commentId: string;
  videoTitle?: string;
  author?:    string;
  replyText?: string;
}): void {
  const { commentId, videoTitle = "your Short", author = "viewer", replyText = "" } = opts;
  emitLiveNotif({
    id:        `yt_reply:${commentId}`,
    type:      "comment",
    message:   "↩️ YouTube comment reply sent",
    detail:    `@${author} on "${videoTitle.slice(0, 40)}": "${replyText.slice(0, 80)}"`,
    entityId:  commentId,
    action:    "YOUTUBE_COMMENT_REPLIED",
    createdAt: new Date().toISOString(),
    read:      false,
  });
}

/** REAL-TIME: a YouTube publish FAILED. Emits a live error notif + sends an email. */
export async function notifyYouTubeFailed(opts: {
  spId:    string;
  title?:  string;
  error:   string;
  context?: string;
}): Promise<void> {
  const { spId, title = "Untitled", error, context = "YouTube" } = opts;

  // Log for daily digest (matches existing youtube-failure logging shape).
  logSystemErrorEvent(`${context} Publish Failed: ${title}`, error);

  // Instant SSE push — "error" type, matching the Instagram failure shape.
  emitLiveNotif({
    id:        `yt_fail:${spId}:${Date.now()}`,
    type:      "error",
    message:   "⚠️ YouTube Short failed to publish",
    detail:    `${title}: ${error.slice(0, 120)}`,
    entityId:  spId,
    action:    "YOUTUBE_FAILED",
    createdAt: new Date().toISOString(),
    read:      false,
  });

  // Live SSE notif always fires; the EMAIL respects the "email on failure" toggle.
  if (!(await emailKindEnabled("fails"))) return;

  const html = emailWrapper({
    accentColor: "#ef4444",
    icon:        "📵",
    heading:     "YouTube Short Failed to Publish",
    subheading:  "A YouTube publishing attempt failed. Review the details below and check Railway logs.",
    badgeLabel:  "🚨 Publish Error",
    badgeColor:  "#ef4444",
    body: `
      ${infoTable([
        ["Post ID",   spId],
        ["Title",     title],
        ["Source",    context],
        ["Time",      toIST(new Date()) + " IST"],
      ])}
      ${errorBox(error, "#ef4444")}
      ${tipBox(`Check the Settings → YouTube tab to verify OAuth/credentials, or visit the Scheduler page to retry.`)}
    `,
    ctaLabel: "Open Scheduler",
    ctaUrl:   `${APP_URL}/scheduler`,
  });
  await sendEmail(`YouTube Publish Failed — ${title}`, html, `yt_failed:${spId}`)
    .catch((err: any) => console.warn("[Notifier] YouTube failure email failed:", err?.message));
}

// ════════════════════════════════════════════════════════════════════════════════
// DAILY DIGEST — one comprehensive email at 9 AM IST
// ════════════════════════════════════════════════════════════════════════════════

/** Daily 9 AM health report — everything in one email. */
export async function sendDailyHealthReport(opts: {
  health: { db: boolean; ai: boolean; instagram: boolean; aiProvider: string; grok?: boolean; grokDetail?: string };
  storyStatus?: { title: string; status: string; scheduledFor: Date | null; publishedAt: Date | null } | null;
  generatedPosts:    Array<{ type: string; title: string; scheduledFor: Date }>;
  upcomingPosts:     Array<{ title: string; scheduledFor: Date; status: string }>;
  autoGenerated:     number;
  errors:            string[];
  // 24-hour activity stats
  publishedCount24h: number;
  failedPosts24h:    Array<{ title: string; error: string; failedAt: Date; postType?: string }>;
  commentsReplied24h: number;
  dmsReplied24h:     number;
  // In-memory event logs
  rateLimitEvents:   RateLimitEvent[];
  systemErrors:      SystemErrorEvent[];
  healthChanges:     HealthChangeEvent[];
  // Feature 3: Instagram webhook status + today's YouTube posts (both optional so
  // older callers keep compiling and rendering unchanged).
  webhookStatus?: {
    configured: boolean;
    active: boolean;
    lastEventSecondsAgo: number | null;
  };
  youtubePosts24h?: Array<{ title: string; videoId: string; url: string; publishedAt: Date | null }>;
}): Promise<void> {
  const {
    health, storyStatus, generatedPosts, upcomingPosts, autoGenerated, errors,
    publishedCount24h, failedPosts24h, commentsReplied24h, dmsReplied24h,
    rateLimitEvents, systemErrors, healthChanges,
    webhookStatus, youtubePosts24h = [],
  } = opts;

  // Respect Settings → Notifications "email analytics/report" toggle.
  if (!(await emailKindEnabled("analytics"))) {
    console.log("[Notifier] Daily report suppressed — emailAnalytics toggle is off");
    return;
  }

  // Grok powers DM replies; treat undefined as healthy (older callers) to avoid false alarms
  const grokOk       = health.grok !== false;
  const overall      = health.db && health.ai && health.instagram && grokOk ? "healthy" : "degraded";
  const hasIssues    = !health.db || !health.ai || !health.instagram || !grokOk || failedPosts24h.length > 0 || rateLimitEvents.length > 0;
  const statusColor  = overall === "healthy" && !hasIssues ? "#10b981" : hasIssues ? "#ef4444" : "#f59e0b";
  const statusLabel  = overall === "healthy" && !hasIssues ? "All Systems Go" : hasIssues ? "Attention Needed" : "Degraded";

  // ── Helper: status row (service health table) ─────────────────────────────
  const statusRow = (label: string, ok: boolean, detail: string) => `
  <tr>
    <td style="padding:6px 0;color:#64748b;font-size:12px;width:130px;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;vertical-align:top;">
      <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;
                   background:${ok ? "#10b98122" : "#ef444422"};
                   color:${ok ? "#34d399" : "#fca5a5"};
                   border:1px solid ${ok ? "#10b98144" : "#ef444444"};">
        ${ok ? "✓ OK" : "✗ FAIL"}
      </span>
      &nbsp;<span style="color:#94a3b8;font-size:12px;">${detail}</span>
    </td>
  </tr>`;

  // ── YouTube mirroring status ──────────────────────────────────────────────
  const ytConfigured = isYouTubeConfigured();
  const prefs        = await readPreferences().catch(() => null);
  const ytEnabled    = !!prefs?.youtube?.enabled;
  const ytHealth: { ok: boolean; channel?: string; error?: string } =
    ytConfigured
      ? await checkYouTubeHealth().catch(() => ({ ok: false, error: "check failed" }))
      : { ok: false };

  // YouTube API / OAuth status (healthy only when enabled, configured, and connected)
  const ytApiOk    = ytEnabled && ytConfigured && ytHealth.ok;
  const ytApiLabel = !ytEnabled
    ? "Mirroring disabled"
    : !ytConfigured
      ? "Credentials missing (OAuth)"
      : ytHealth.ok
        ? `Connected${ytHealth.channel ? " – " + ytHealth.channel : ""}`
        : `OAuth/token error: ${ytHealth.error || "unknown"}`;

  // OAuth/token row — distinct from the API status for clarity
  const ytOAuthOk    = ytConfigured && ytHealth.ok;
  const ytOAuthLabel = !ytConfigured
    ? "No OAuth credentials configured"
    : ytHealth.ok
      ? "Token valid"
      : `Token error: ${ytHealth.error || "unknown"}`;

  // Auto-post (mirror) status
  const ytAutoLabel = ytEnabled ? "Auto-mirror ON" : "Auto-mirror OFF";

  // ── Instagram Webhook status (Feature 3) ──────────────────────────────────
  // Healthy ⇒ configured AND a webhook comment event arrived within the last 10 min.
  // When configured but idle we still show OK-ish wording (no events ≠ broken), but
  // surface "configured, no recent events" so the owner can tell at a glance.
  const fmtAgo = (secs: number | null): string => {
    if (secs == null) return "no events received yet";
    if (secs < 60)    return `${secs}s ago`;
    if (secs < 3600)  return `${Math.round(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
    return `${Math.round(secs / 86400)}d ago`;
  };
  const wh = webhookStatus ?? { configured: false, active: false, lastEventSecondsAgo: null };
  const webhookOk    = wh.configured && wh.active;
  const webhookLabel = !wh.configured
    ? "Not subscribed (WEBHOOK_VERIFY_TOKEN unset)"
    : wh.active
      ? `Active · last event ${fmtAgo(wh.lastEventSecondsAgo)}`
      : `Subscribed · idle (last event ${fmtAgo(wh.lastEventSecondsAgo)})`;

  // ── Section: 24h activity summary stat cards ──────────────────────────────
  const stat = (num: number, label: string, color: string) => `
    <td align="center" style="padding:0 6px;">
      <div style="background:#0e0e18;border:1px solid #1e1e2e;border-radius:10px;padding:14px 10px;min-width:90px;">
        <div style="font-size:26px;font-weight:800;color:${color};line-height:1;">${num}</div>
        <div style="font-size:10px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:1px;">${label}</div>
      </div>
    </td>`;

  // ── Section: today's auto-story status ───────────────────────────────────
  const storySection = storyStatus ? (() => {
    const ist = (d: Date | null) => d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : "—";
    const st = (storyStatus.status || "").toUpperCase();
    const color = st === "PUBLISHED" ? "#10b981" : st === "PENDING" ? "#f59e0b" : st === "FAILED" ? "#ef4444" : "#64748b";
    const label = st === "PUBLISHED" ? `✅ Published at ${ist(storyStatus.publishedAt)}`
      : st === "PENDING" ? `🕒 Scheduled for ${ist(storyStatus.scheduledFor)}`
      : st === "FAILED" ? "🔴 Failed to publish"
      : st;
    return `
  <div style="margin-bottom:16px;">
    <div style="font-size:10px;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;font-weight:700;margin-bottom:10px;">
      📖 Today's Story
    </div>
    <div style="background:#0e0e18;border:1px solid #1e1e2e;border-radius:10px;padding:12px 14px;">
      <div style="color:#e2e8f0;font-size:14px;font-weight:600;margin-bottom:4px;">${storyStatus.title || "Auto Story"}</div>
      <div style="color:${color};font-size:12px;font-weight:600;">${label}</div>
    </div>
  </div>`;
  })() : `
  <div style="margin-bottom:16px;">
    <div style="font-size:10px;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;font-weight:700;margin-bottom:10px;">
      📖 Today's Story
    </div>
    <div style="background:#0e0e18;border:1px solid #1e1e2e;border-radius:10px;padding:12px 14px;">
      <div style="color:#64748b;font-size:12px;">No story generated yet today.</div>
    </div>
  </div>`;

  const activityStats = `
  <div style="margin-bottom:16px;">
    <div style="font-size:10px;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;font-weight:700;margin-bottom:10px;">
      📊 Last 24 Hours
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${stat(publishedCount24h,     "Published",  "#10b981")}
      ${stat(failedPosts24h.length, "Failed",     failedPosts24h.length > 0 ? "#ef4444" : "#64748b")}
      ${stat(commentsReplied24h,    "Comments",   "#3b82f6")}
      ${stat(dmsReplied24h,         "DMs",        "#8b5cf6")}
      ${stat(rateLimitEvents.length,"Rate Limits", rateLimitEvents.length > 0 ? "#f59e0b" : "#64748b")}
    </tr></table>
  </div>`;

  // ── Section: failed posts ─────────────────────────────────────────────────
  const failedSection = failedPosts24h.length > 0 ? `
  <div style="background:#ef44440d;border:1px solid #ef444433;border-radius:10px;margin-bottom:16px;overflow:hidden;">
    <div style="padding:10px 14px;background:#1a0a0a;border-bottom:1px solid #ef444433;">
      <span style="color:#ef4444;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
        ❌ Failed Posts (${failedPosts24h.length})
      </span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${failedPosts24h.map((p) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #ef444422;">
          <div style="color:#f1f5f9;font-size:13px;font-weight:600;margin-bottom:3px;">${p.title}</div>
          <div style="color:#ef4444;font-size:11px;font-family:monospace;margin-bottom:3px;word-break:break-all;">${p.error.slice(0, 200)}</div>
          <div style="color:#64748b;font-size:10px;">${toIST(p.failedAt)} IST${p.postType ? ` · ${p.postType}` : ""}</div>
        </td>
      </tr>`).join("")}
    </table>
  </div>` : "";

  // ── Section: rate limit events ────────────────────────────────────────────
  const rateLimitSection = rateLimitEvents.length > 0 ? `
  <div style="background:#f59e0b0d;border:1px solid #f59e0b33;border-radius:10px;margin-bottom:16px;overflow:hidden;">
    <div style="padding:10px 14px;background:#1a1200;border-bottom:1px solid #f59e0b33;">
      <span style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
        ⏱️ Rate Limit Events (${rateLimitEvents.length})
      </span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${rateLimitEvents.slice(-10).map((e) => `
      <tr>
        <td style="padding:8px 14px;border-bottom:1px solid #f59e0b22;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="display:inline-block;background:#f59e0b22;border:1px solid #f59e0b44;
                         border-radius:8px;padding:2px 8px;font-size:10px;font-weight:700;
                         color:#fcd34d;letter-spacing:1px;">${e.service}</span>
            <span style="color:#94a3b8;font-size:12px;">${e.detail.slice(0, 120)}</span>
            <span style="color:#475569;font-size:10px;margin-left:auto;">${toIST(e.time, true)} IST</span>
          </div>
        </td>
      </tr>`).join("")}
    </table>
  </div>` : "";

  // ── Section: health change events ─────────────────────────────────────────
  const healthChangesSection = healthChanges.length > 0 ? `
  <div style="background:#8b5cf60d;border:1px solid #8b5cf633;border-radius:10px;margin-bottom:16px;overflow:hidden;">
    <div style="padding:10px 14px;background:#0e0a1a;border-bottom:1px solid #8b5cf633;">
      <span style="color:#a78bfa;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
        🔄 Service Health Changes
      </span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${healthChanges.slice(-8).map((e) => `
      <tr>
        <td style="padding:8px 14px;border-bottom:1px solid #8b5cf622;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="display:inline-block;background:${e.status === "degraded" ? "#ef444422" : "#10b98122"};
                         border:1px solid ${e.status === "degraded" ? "#ef444444" : "#10b98144"};
                         border-radius:8px;padding:2px 8px;font-size:10px;font-weight:700;
                         color:${e.status === "degraded" ? "#fca5a5" : "#34d399"};letter-spacing:1px;">
              ${e.status === "degraded" ? "DEGRADED" : "RECOVERED"}
            </span>
            <span style="color:#e2e8f0;font-size:12px;font-weight:600;">${e.service}</span>
            <span style="color:#94a3b8;font-size:11px;">${e.detail.slice(0, 80)}</span>
            <span style="color:#475569;font-size:10px;margin-left:auto;">${toIST(e.time, true)} IST</span>
          </div>
        </td>
      </tr>`).join("")}
    </table>
  </div>` : "";

  // ── Section: system errors ────────────────────────────────────────────────
  const systemErrorsSection = systemErrors.length > 0 ? `
  <div style="background:#ef44440d;border:1px solid #ef444433;border-left:3px solid #ef4444;
              border-radius:8px;padding:12px 16px;margin-bottom:16px;">
    <p style="margin:0 0 8px;font-size:10px;font-weight:700;color:#ef4444;letter-spacing:2px;text-transform:uppercase;">
      System Errors (${systemErrors.length})
    </p>
    ${systemErrors.slice(-8).map((e) => `
    <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #ef444422;">
      <div style="font-size:12px;color:#fca5a5;font-weight:600;">${e.title}</div>
      <div style="font-size:11px;color:#ef9999;font-family:monospace;word-break:break-all;margin-top:2px;">${e.detail.slice(0, 200)}</div>
      <div style="font-size:10px;color:#64748b;margin-top:2px;">${toIST(e.time, true)} IST</div>
    </div>`).join("")}
  </div>` : "";

  // ── Section: auto-generated posts ─────────────────────────────────────────
  const generatedSection = generatedPosts.length > 0 ? `
  <div style="background:#0e0e18;border:1px solid #1e1e2e;border-radius:10px;margin-bottom:16px;overflow:hidden;">
    <div style="padding:10px 14px;background:#12121c;border-bottom:1px solid #1e1e2e;">
      <span style="color:#10b981;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
        ✨ Auto-Generated Today (${generatedPosts.length} posts)
      </span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${generatedPosts.map((p) => `
      <tr>
        <td style="padding:8px 14px;border-bottom:1px solid #1e1e2e;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="display:inline-block;background:#10b98122;border:1px solid #10b98144;
                         border-radius:8px;padding:2px 8px;font-size:10px;font-weight:700;
                         color:#34d399;letter-spacing:1px;">${p.type}</span>
            <span style="color:#e2e8f0;font-size:13px;">${p.title}</span>
            <span style="color:#475569;font-size:11px;margin-left:auto;">
              @ ${toIST(p.scheduledFor, true)} IST
            </span>
          </div>
        </td>
      </tr>`).join("")}
    </table>
  </div>` : "";

  // ── Section: today's YouTube posts (Feature 3) ────────────────────────────
  const youtubePostsSection = youtubePosts24h.length > 0 ? `
  <div style="background:#0e0e18;border:1px solid #1e1e2e;border-radius:10px;margin-bottom:16px;overflow:hidden;">
    <div style="padding:10px 14px;background:#12121c;border-bottom:1px solid #1e1e2e;">
      <span style="color:#ff4d4d;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
        ▶️ YouTube Shorts Published (last 24h · ${youtubePosts24h.length})
      </span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${youtubePosts24h.map((p) => `
      <tr>
        <td style="padding:8px 14px;border-bottom:1px solid #1e1e2e;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="display:inline-block;background:#ff000022;border:1px solid #ff000044;
                         border-radius:8px;padding:2px 8px;font-size:10px;font-weight:700;
                         color:#f87171;letter-spacing:1px;">SHORT</span>
            <a href="${p.url}" style="color:#e2e8f0;font-size:13px;text-decoration:none;">${p.title}</a>
            <span style="color:#475569;font-size:11px;margin-left:auto;">
              ${p.publishedAt ? toIST(p.publishedAt, true) + " IST" : ""}
            </span>
          </div>
          <a href="${p.url}" style="color:#f87171;font-size:11px;text-decoration:none;">${p.url}</a>
        </td>
      </tr>`).join("")}
    </table>
  </div>` : `
  <div style="margin-bottom:16px;">
    <div style="font-size:10px;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;font-weight:700;margin-bottom:10px;">
      ▶️ YouTube Shorts (last 24h)
    </div>
    <div style="background:#0e0e18;border:1px solid #1e1e2e;border-radius:10px;padding:12px 14px;">
      <div style="color:#64748b;font-size:12px;">No YouTube Shorts published in the last 24 hours.</div>
    </div>
  </div>`;

  // ── Section: upcoming scheduled posts ─────────────────────────────────────
  const upcomingSection = upcomingPosts.length > 0 ? `
  <div style="background:#0e0e18;border:1px solid #1e1e2e;border-radius:10px;margin-bottom:16px;overflow:hidden;">
    <div style="padding:10px 14px;background:#12121c;border-bottom:1px solid #1e1e2e;">
      <span style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
        📅 Upcoming Scheduled Posts
      </span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${upcomingPosts.slice(0, 8).map((p) => `
      <tr>
        <td style="padding:8px 14px;border-bottom:1px solid #1e1e2e;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="display:inline-block;background:#ffffff11;border:1px solid #ffffff22;
                         border-radius:8px;padding:2px 8px;font-size:10px;font-weight:700;
                         color:#94a3b8;letter-spacing:1px;">${p.status}</span>
            <span style="color:#e2e8f0;font-size:13px;">${p.title}</span>
            <span style="color:#475569;font-size:11px;margin-left:auto;">
              ${p.scheduledFor.toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                weekday: "short", month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit", hour12: true,
              })} IST
            </span>
          </div>
        </td>
      </tr>`).join("")}
    </table>
  </div>` : "";

  // ── Section: catchup errors ───────────────────────────────────────────────
  const errorsSection = errors.length > 0 ? `
  <div style="background:#ef44440d;border:1px solid #ef444433;border-left:3px solid #ef4444;
              border-radius:8px;padding:12px 16px;margin-bottom:16px;">
    <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#ef4444;letter-spacing:2px;text-transform:uppercase;">Runtime Errors</p>
    ${errors.slice(0, 5).map((e) => `<p style="margin:2px 0;font-size:11px;color:#fca5a5;font-family:monospace;">${e}</p>`).join("")}
  </div>` : "";

  // ── Assemble email ────────────────────────────────────────────────────────
  const html = emailWrapper({
    accentColor: statusColor,
    icon:        overall === "healthy" && !hasIssues ? "🟢" : hasIssues ? "🔴" : "🟡",
    heading:     `Good Morning — Daily Health Report`,
    subheading:  `${BRAND_NAME} system status for ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
    badgeLabel:  statusLabel,
    badgeColor:  statusColor,
    body: `
      <!-- 1. System health -->
      <div style="font-size:10px;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;font-weight:700;margin-bottom:10px;">
        🩺 System Health
      </div>
      <div style="background:#0e0e18;border:1px solid #1e1e2e;border-radius:10px;padding:4px 14px;margin-bottom:16px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          ${statusRow("Database",        health.db,        health.db        ? "PostgreSQL connected"            : "Cannot reach database")}
          ${statusRow("AI (content)",    health.ai,        health.ai        ? `${health.aiProvider} API valid`  : `${health.aiProvider} API error`)}
          ${statusRow("Grok AI (DMs)",   grokOk,           grokOk           ? (health.grokDetail ?? "API key valid") : (health.grokDetail ?? "Grok API error"))}
          ${statusRow("Instagram",       health.instagram, health.instagram ? "Access token configured"         : "Token missing")}
          ${statusRow("IG Webhook",       webhookOk,        webhookLabel)}
          ${statusRow("YouTube API",      ytApiOk,          ytApiLabel)}
          ${statusRow("YouTube OAuth",    ytOAuthOk,        ytOAuthLabel)}
          <tr>
            <td style="padding:6px 0;color:#64748b;font-size:12px;width:130px;vertical-align:top;">YouTube Mirror</td>
            <td style="padding:6px 0;vertical-align:top;">
              <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;
                           background:${ytEnabled ? "#10b98122" : "#37415122"};
                           color:${ytEnabled ? "#34d399" : "#94a3b8"};
                           border:1px solid ${ytEnabled ? "#10b98144" : "#37415155"};">
                ${ytEnabled ? "● ON" : "○ OFF"}
              </span>
              &nbsp;<span style="color:#94a3b8;font-size:12px;">${ytAutoLabel}</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- 1b. Today's story status -->
      ${storySection}

      <!-- 2. 24h activity stats -->
      ${activityStats}

      <!-- 3. Failed posts -->
      ${failedSection}

      <!-- 4. Rate limit events -->
      ${rateLimitSection}

      <!-- 5. Health changes -->
      ${healthChangesSection}

      <!-- 6. System errors -->
      ${systemErrorsSection}

      <!-- 7. Catchup errors -->
      ${errorsSection}

      <!-- 8. Auto-generated today -->
      ${generatedSection}

      <!-- 8b. YouTube Shorts published (last 24h) -->
      ${youtubePostsSection}

      <!-- 9. Upcoming scheduled -->
      ${upcomingSection}

      <!-- 10. Summary banner -->
      ${autoGenerated > 0
        ? `<div style="background:#10b9810d;border:1px solid #10b98133;border-radius:8px;padding:10px 14px;margin-bottom:16px;">
             <p style="margin:0;font-size:12px;color:#6ee7b7;">
               ✨ &nbsp;Auto-generated <strong>${autoGenerated} post${autoGenerated === 1 ? "" : "s"}</strong> for today and scheduled them automatically.
             </p>
           </div>`
        : `<div style="background:#1e1e2e;border-radius:8px;padding:10px 14px;">
             <p style="margin:0;font-size:12px;color:#64748b;">
               💡 &nbsp;No posts auto-generated today. Check Auto-Post settings to enable automatic content generation.
             </p>
           </div>`
      }
    `,
    ctaLabel: "Open Dashboard",
    ctaUrl:   APP_URL,
  });

  await sendEmail("Daily Health Report", html, "daily_health_report", true /* skip rate limit */);
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST EMAIL
// ════════════════════════════════════════════════════════════════════════════════

/** Test email — verifies Resend is working. */
export async function sendTestEmail(): Promise<{ ok: boolean; error?: string }> {
  const recipient = await resolveRecipient();
  const html = emailWrapper({
    accentColor: "#10b981",
    icon:        "✅",
    heading:     "Email Alerts Are Working!",
    subheading:  `Your ${BRAND_NAME} notification system is correctly configured.`,
    badgeLabel:  "Test Email",
    badgeColor:  "#10b981",
    body: `
      ${infoTable([
        ["Transport",  "Resend API (HTTPS)"],
        ["From",       RESEND_FROM],
        ["Recipient",  recipient],
      ])}
      <div style="background:#10b9810d;border:1px solid #10b98133;border-left:3px solid #10b981;
                  border-radius:8px;padding:14px 16px;margin-bottom:20px;">
        <p style="margin:0;font-size:13px;color:#6ee7b7;line-height:1.7;">
          🎉 &nbsp;Everything looks great! You will now receive instant email alerts for:<br/>
          <span style="color:#34d399;">•</span> Failed post / reel / story publishing<br/>
          <span style="color:#34d399;">•</span> Instagram or AI API rate limits<br/>
          <span style="color:#34d399;">•</span> API health degradation (token expired, DB down, AI down)<br/>
          <span style="color:#34d399;">•</span> Webhook delivery interruptions<br/>
          <span style="color:#34d399;">•</span> Any other critical system errors<br/>
          <span style="color:#34d399;">•</span> Daily 9 AM digest with everything in one email
        </p>
      </div>
      ${tipBox("Real-time alerts are rate-limited to 1 email per error type per 10 minutes to prevent inbox spam. The 9 AM digest always arrives regardless.")}
    `,
    ctaLabel: `Open ${BRAND_NAME} Dashboard`,
    ctaUrl:   APP_URL,
  });

  try {
    await sendEmail("Test — Email Notifications Verified ✓", html, undefined, true /* skip rate limit */);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}
