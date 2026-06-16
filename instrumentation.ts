/**
 * instrumentation.ts
 *
 * Next.js instrumentation hook -- runs ONCE when the server starts.
 * Handles:
 *   1. Startup catch-up (missed scheduled posts, comments, unanswered DMs)
 *   2. Periodic catch-up every 5 minutes so comments/DMs are always replied to
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in the Node.js runtime (not Edge), and only in the main process
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const runAndLog = async () => {
      try {
        const { runCatchup } = await import("@/lib/catchup");
        const result = await runCatchup();

        if (
          result.scheduledPublished > 0 ||
          result.newComments > 0 ||
          result.dmsReplied > 0
        ) {
          console.log(
            `[Catchup] ${result.scheduledPublished} posts published, ` +
            `${result.newComments} new comments (replied), ` +
            `${result.dmsReplied} DMs replied`
          );
        }

        if (result.errors.length > 0) {
          console.warn("[Catchup] Errors:", result.errors.join(" | "));
        }
      } catch (err) {
        console.error("[Catchup] Failed:", err);
      }
    };

    // Daily 9 AM IST: auto-generate posts + send health report email.
    // Runs on a 10-minute polling cadence — fires only when IST hour === 9
    // and hasn't already run today.
    const runDailyCheck = async () => {
      try {
        const { runDailyHealthCheck } = await import("@/lib/catchup");
        await runDailyHealthCheck();
      } catch (err) {
        console.error("[DailyHealth] Timer error:", err);
      }
    };

    // Delay first run by 15s so DB connection + env sync are ready
    // (catchup fires before any page request triggers getServerSession token sync)
    const STARTUP_DELAY_MS  = 15_000;
    // runCatchup() internally debounces within MIN_INTERVAL_MS, so firing more often
    // than that just produces no-op ticks. Drive the interval at the SAME cadence so
    // every tick does real work. Imported from catchup so the two never drift.
    const { MIN_INTERVAL_MS } = await import("@/lib/catchup");
    const CATCHUP_INTERVAL  = MIN_INTERVAL_MS;   // comment + DM auto-reply + overdue publish
    const DAILY_CHECK_INTERVAL = 10 * 60 * 1000; // 10 min — daily health + auto-generate

    console.log(`[Instrumentation] Server started -- first catch-up in ${STARTUP_DELAY_MS / 1000}s...`);

    // Best-effort: ensure the Instagram webhook fields (comments/messages/mentions)
    // are subscribed so comment events arrive in real time. No-ops safely if
    // FACEBOOK_APP_SECRET is wrong/missing (can't break the live DM webhook).
    const ensureWebhook = async () => {
      try {
        const { ensureInstagramWebhookSubscribed } = await import("@/lib/webhookSubscribe");
        const r = await ensureInstagramWebhookSubscribed();
        if (r.ok) {
          console.log(
            `[Webhook] Startup auto-subscribe OK — fields: ${(r.fields ?? []).join(", ")} ` +
            `(app-level=${r.appLevel?.ok} page-bind=${r.pageBinding?.ok ?? "n/a"} ig-bind=${r.igBinding?.ok ?? "n/a"})`
          );
        } else if (r.skipped) {
          console.log(`[Webhook] Startup auto-subscribe skipped — ${r.error}`);
        } else {
          console.warn(
            `[Webhook] Startup auto-subscribe failed — ${r.error} ` +
            `(app-level=${r.appLevel?.ok} page-bind=${r.pageBinding?.ok ?? "n/a"} ig-bind=${r.igBinding?.ok ?? "n/a"})`
          );
        }
        // The object-level binding (/{id}/subscribed_apps) is what actually makes
        // Meta deliver events. If the page token lacks pages_manage_metadata it
        // fails — surface a LOUD, actionable message because this requires a
        // manual token re-grant in the Meta dashboard (code can't fix a scope).
        if (r.needsManageMetadata) {
          console.error(
            "[Webhook] ⛔ ACTION REQUIRED — the Page/Instagram account could NOT be bound to the app " +
            "(POST /{id}/subscribed_apps was rejected: missing `pages_manage_metadata`). " +
            "The app-level subscription shows active:true but NO comment/DM events will be delivered until the " +
            "account is bound. FIX: regenerate the long-lived Page token WITH the `pages_manage_metadata` scope " +
            "(Graph API Explorer / Business Login), update FACEBOOK_PAGE_ACCESS_TOKEN (and INSTAGRAM_ACCESS_TOKEN) " +
            "in Railway, then restart — OR in Meta App Dashboard → Instagram/Messenger → Webhooks, manually " +
            "subscribe the page to comments/messages/mentions."
          );
        }
      } catch (err) {
        console.warn("[Webhook] Startup auto-subscribe threw:", err);
      }
    };

    // Best-effort: make sure the primary brand row exists (multi-account
    // foundation). Never blocks startup — failures (e.g. Brand table not yet
    // pushed) are logged and ignored.
    const ensurePrimaryBrandSeed = async () => {
      try {
        const { ensurePrimaryBrand } = await import("@/lib/brands");
        const id = await ensurePrimaryBrand();
        console.log(`[Brands] Primary brand ready (id=${id}).`);
      } catch (err) {
        console.warn("[Brands] ensurePrimaryBrand failed (non-fatal):", err);
      }
    };

    setTimeout(async () => {
      await ensurePrimaryBrandSeed();
      await ensureWebhook();
      await runAndLog();

      // Run on the same cadence as runCatchup's internal debounce so every tick
      // does real work (no wasted no-op ticks).
      setInterval(runAndLog, CATCHUP_INTERVAL);
      console.log(`[Instrumentation] Periodic catch-up scheduled every ${CATCHUP_INTERVAL / 1000} seconds.`);

      // Run daily health check every 10 minutes; it self-gates to 9 AM IST once/day
      await runDailyCheck(); // run immediately on startup in case it's already 9 AM
      setInterval(runDailyCheck, DAILY_CHECK_INTERVAL);
      console.log("[Instrumentation] Daily health check (9 AM IST) polling every 10 minutes.");
    }, STARTUP_DELAY_MS);
  }
}
