/**
 * lib/webhookCounter.ts
 *
 * In-memory counter + real-time event emitter for instant SSE push.
 *
 * Two mechanisms:
 *  1. Counter  -- analytics frontend polls /api/notifications/count every 5s
 *               and triggers a refetch when the counter changes.
 *  2. Emitter  -- SSE notification stream subscribes to "notif" events and
 *               pushes them to the browser the INSTANT the webhook fires
 *               (no polling delay).
 */

import { EventEmitter } from "events";

// -- Counter ------------------------------------------------------------------
let _webhookEventCount = 0;

export function incrementWebhookCounter(): void {
  _webhookEventCount++;
}

export function getWebhookEventCount(): number {
  return _webhookEventCount;
}

// -- Webhook liveness tracker -------------------------------------------------
// When the webhook receives a real comment event, it calls markWebhookActive().
// runCommentCheck() reads isWebhookActive() and skips the Instagram API poll
// entirely when the webhook has delivered events recently  -  saving API quota.
//
// Threshold: if no webhook event in the last 10 minutes, assume webhook is down
// and fall back to API polling so comments are never missed.
const WEBHOOK_ACTIVE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
let _lastWebhookCommentAt: Date | null = null;

/** Call this every time the webhook receives a real Instagram comment. */
export function markWebhookActive(): void {
  _lastWebhookCommentAt = new Date();
}

/** Returns true if a webhook comment event arrived within the last 10 minutes. */
export function isWebhookActive(): boolean {
  if (!_lastWebhookCommentAt) return false;
  return Date.now() - _lastWebhookCommentAt.getTime() < WEBHOOK_ACTIVE_WINDOW_MS;
}

/** Returns how many seconds ago the last webhook comment arrived (or null). */
export function secondsSinceLastWebhookComment(): number | null {
  if (!_lastWebhookCommentAt) return null;
  return Math.round((Date.now() - _lastWebhookCommentAt.getTime()) / 1000);
}

// -- Real-time notification emitter -------------------------------------------
// Each SSE connection subscribes to "notif" events.
// The webhook handler emits an event the moment it processes a comment/DM.

export interface LiveNotif {
  id:        string;
  type:      "comment" | "dm" | "mention" | "success" | "info" | "error";
  message:   string;
  detail:    string;
  entityId?: string;
  action:    string;
  createdAt: string;
  read:      false;
}

export const notifEmitter = new EventEmitter();
// Allow up to 200 concurrent SSE connections without the "too many listeners" warning
notifEmitter.setMaxListeners(200);
