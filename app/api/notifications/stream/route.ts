import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifEmitter, LiveNotif } from "@/lib/webhookCounter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// -- SSE Notifications Stream ------------------------------------------------
//
// Two delivery paths for notifications:
//  1. INSTANT   -  EventEmitter push from webhook/route.ts (sub-second latency)
//  2. FALLBACK  -  DB poll every 2 s for anything the emitter might have missed
//                (e.g. events that happened while no SSE connection was open)
//
// Frontend subscribes via:  new EventSource('/api/notifications/stream')

// Notification message labels  -  all emojis as Unicode escapes (encoding-safe)
const LABEL: Record<string, string> = {
  DM_RECEIVED:      "💬 New DM received",           // 💬
  COMMENT_RECEIVED: "🗨️ New comment on your post", // 🗨️
  MENTION_RECEIVED: "📣 You were mentioned",         // 📣
  POST_PUBLISHED:   "✅ Post published to Instagram",      // ✅
  POST_SCHEDULED:   "📅 Post scheduled",             // 📅
  POST_CREATED:     "📝 New draft created",          // 📝
  DM_AUTO_REPLIED:  "🤖 Auto-replied to DM",         // 🤖
  COMMENT_REPLIED:  "↩️ Comment reply sent",         // ↩️
  YOUTUBE_PUBLISHED:       "▶️ YouTube Short published",      // ▶️
  YOUTUBE_COMMENT_REPLIED: "↩️ YouTube comment reply sent",  // ↩️
  YOUTUBE_FAILED:          "⚠️ YouTube Short failed to publish", // ⚠️
};

const TYPE_MAP: Record<string, LiveNotif["type"]> = {
  DM_RECEIVED:      "dm",
  DM_AUTO_REPLIED:  "dm",
  COMMENT_RECEIVED: "comment",
  COMMENT_REPLIED:  "comment",
  MENTION_RECEIVED: "mention",
  POST_PUBLISHED:   "success",
  POST_SCHEDULED:   "info",
  POST_CREATED:     "info",
  YOUTUBE_PUBLISHED:       "success",
  YOUTUBE_COMMENT_REPLIED: "comment",
  YOUTUBE_FAILED:          "error",
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const afterParam = searchParams.get("after");

  let lastSeenId = afterParam ?? "";
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {}
      };

      // Immediate keep-alive so the browser EventSource doesn't time out
      if (!closed) {
        try { controller.enqueue(": connected\n\n"); } catch {}
      }

      // ── Dedup tracking: entity IDs already delivered by the instant emitter ──
      // Prevents the DB poll from re-sending the same event that was already
      // pushed via Path 1 (which causes duplicate notifications in the UI).
      const deliveredEntityIds = new Set<string>();

      // ── Path 1: Instant push via EventEmitter ─────────────────────────────
      // webhook/route.ts calls notifEmitter.emit("notif", LiveNotif) the moment
      // a comment or DM arrives  -  no polling delay.
      const liveListener = (notif: LiveNotif) => {
        // Track the entityId so Path 2 (DB poll) can skip it
        if (notif.entityId) deliveredEntityIds.add(notif.entityId);
        send("notification", notif);
      };
      notifEmitter.on("notif", liveListener);

      // ── Path 2: DB poll fallback (every 2 s) ──────────────────────────────
      // Catches events that arrived while this SSE connection wasn't open yet,
      // e.g. comments received just before the page loaded.
      const poll = async () => {
        if (closed) return;
        try {
          const where = lastSeenId
            ? { id: { gt: lastSeenId } }
            : { createdAt: { gte: new Date(Date.now() - 15_000) } }; // last 15 s on first connect

          const logs = await prisma.activityLog.findMany({
            where,
            orderBy: { createdAt: "asc" },
            take: 20,
          });

          for (const log of logs) {
            lastSeenId = log.id;

            // Skip events already delivered via the instant emitter (Path 1)
            if (log.entityId && deliveredEntityIds.has(log.entityId)) continue;

            const meta = (log.metadata as Record<string, any>) ?? {};
            // Build a rich detail line matching the live emitter format
            const username = meta.username ? `@${meta.username}` : null;
            const text     = meta.text ?? meta.replyText ?? meta.title ?? null;
            const detail   = username && text
              ? `${username}: "${text}"`
              : text ?? username ?? "";

            send("notification", {
              id:        log.id,
              type:      TYPE_MAP[log.action] ?? "info",
              message:   LABEL[log.action]    ?? log.action,
              detail,
              entityId:  log.entityId ?? undefined,
              action:    log.action,
              createdAt: log.createdAt.toISOString(),
              read:      false,
            } satisfies LiveNotif);
          }
        } catch (err) {
          console.error("[SSE] poll error:", err);
        }

        if (!closed) setTimeout(poll, 2_000); // poll every 2 s (down from 3 s)
      };

      // Start first poll after 500 ms (let instant emitter fire first)
      setTimeout(poll, 500);

      // ── Cleanup on disconnect ─────────────────────────────────────────────
      request.signal.addEventListener("abort", () => {
        closed = true;
        notifEmitter.off("notif", liveListener);
        try { controller.close(); } catch {}
      });
    },

    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":       "text/event-stream",
      "Cache-Control":      "no-cache, no-transform",
      "Connection":         "keep-alive",
      "X-Accel-Buffering":  "no",   // disable nginx/proxy buffering
    },
  });
}
