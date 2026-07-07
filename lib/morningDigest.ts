/**
 * lib/morningDigest.ts
 *
 * Builds and sends the once-a-day "Morning Digest" email — a last-24h summary across
 * Instagram and YouTube. Which sections appear is controlled entirely by the user's
 * Settings → Morning Digest toggles (preferences.morningDigest). Every collector is
 * best-effort and isolated in try/catch so one failing source never blocks the digest.
 *
 * Scheduling: runMorningDigest() is polled from instrumentation.ts on the same ~10-min
 * loop as the daily health check; it gates on the configured IST send-hour + a
 * once-per-day guard.
 */

import { prisma } from "@/lib/prisma";
import { readPreferences, type MorningDigestSettings } from "@/lib/preferences";
import { getRecentVideos, getChannelStats, listCommentThreads } from "@/lib/youtube";
import { sendMorningDigestEmail, getRecentRateLimitEvents, getRecentSystemErrors, type MorningDigestPayload } from "@/lib/notifier";
import { wallTimeToUTC } from "@/lib/utils";

const IST_TZ = "Asia/Kolkata";

function istParts(d = new Date()) {
  const p: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    // hourCycle "h23" (NOT hour12:false) — some ICU builds map hour12:false to
    // h24, which renders midnight as "24" and breaks the send-time compare.
    timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d)) if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
  return p;
}

const istTime = (d: Date) => d.toLocaleTimeString("en-IN", { timeZone: IST_TZ, hour: "2-digit", minute: "2-digit", hour12: true });

let _lastDigestDate: string | null = null;

// ── Persistent once-per-day marker (survives container restarts) ─────────────
// The in-memory var above is only a cheap same-process fast path — a restart
// right after a send would wipe it and cause a SECOND digest. So the real guard
// is an ActivityLog row (action MORNING_DIGEST_SENT, entityId = IST date key)
// created BEFORE the email goes out (claim-first, same shape as safeLog rows).

async function digestAlreadySent(dateKey: string): Promise<boolean> {
  try {
    const row = await prisma.activityLog.findFirst({
      where: { action: "MORNING_DIGEST_SENT", entityId: dateKey }, select: { id: true },
    });
    return !!row;
  } catch { return false; } // DB hiccup → fall back to the in-memory guard
}

async function markDigestSent(dateKey: string): Promise<void> {
  try {
    const user = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
    if (!user) return; // no users in DB yet — skip silently (mirrors safeLog)
    await prisma.activityLog.create({
      data: { userId: user.id, action: "MORNING_DIGEST_SENT", entity: "Digest", entityId: dateKey, metadata: { dateKey } as any },
    });
  } catch { /* best-effort — in-memory guard still covers this process */ }
}

/** Poll-gated entry: send the digest once per day at the configured IST time. */
export async function runMorningDigest(): Promise<boolean> {
  let cfg: MorningDigestSettings | undefined;
  try { cfg = (await readPreferences()).morningDigest; } catch { return false; }
  if (!cfg?.enabled) return false;

  const now = istParts();
  const todayKey = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;
  if (_lastDigestDate === todayKey) return false;

  // Honor the full HH:MM send time. The poll runs every ~10 min, so fire once the
  // current IST time has REACHED today's target (hour*60+minute compare). A
  // same-hour-only gate would skip sendTimes with minutes ≥ ~50 for the whole
  // day; the persistent once-per-day marker below makes the wide window safe.
  const [hStr, mStr] = (cfg.sendTime || "08:00").split(":");
  const targetHour = parseInt(hStr || "8", 10);
  const targetMin = parseInt(mStr || "0", 10) || 0;
  if (now.hour * 60 + now.minute < targetHour * 60 + targetMin) return false; // not yet at HH:MM

  // Restart-proof guard: already sent today (marker row exists) → skip.
  if (await digestAlreadySent(todayKey)) { _lastDigestDate = todayKey; return false; }

  _lastDigestDate = todayKey;
  // Claim today BEFORE sending — a restart between send and a post-send write
  // could otherwise produce a duplicate digest tomorrow's poll can't detect.
  await markDigestSent(todayKey);
  console.log("[MorningDigest] Composing & sending digest…");
  try {
    const payload = await collectDigest(cfg);
    await sendMorningDigestEmail(payload);
    console.log("[MorningDigest] Sent.");
    return true;
  } catch (e: any) {
    console.warn("[MorningDigest] Failed:", e?.message ?? e);
    return false;
  }
}

/** Build the payload, including only the sections the user enabled. */
export async function collectDigest(cfg: MorningDigestSettings): Promise<MorningDigestPayload> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateLabel = new Date().toLocaleDateString("en-IN", { timeZone: IST_TZ, weekday: "long", day: "numeric", month: "short" });
  const p: MorningDigestPayload = { dateLabel };

  // ── Instagram posts published in last 24h (for insights / published / top) ──
  // IG content is published as ScheduledPost rows (Reels/Stories usually have NO
  // linked Post record — postId NULL — and the Post rows that do exist are the
  // YouTube pipeline's, platform "youtube"), so the old Post-table query matched
  // nothing and the section rendered empty. Collect every row with a real
  // instagramPostId instead, then pull LIVE metrics from the Graph API so the
  // numbers are correct at send time (the local analytics relation is never synced).
  type IgItem = { title: string; kind: string; mediaId: string; likes: number; comments: number; views: number; reach: number; saves: number; shares: number; url: string | null };
  const igItems: IgItem[] = [];
  try {
    const seen = new Set<string>();
    const sps = await prisma.scheduledPost.findMany({
      where: { status: "PUBLISHED", publishedAt: { gte: since }, instagramPostId: { not: null } },
      orderBy: { publishedAt: "desc" }, take: 20,
      select: { title: true, postType: true, instagramPostId: true },
    });
    for (const s of sps) {
      if (!s.instagramPostId || seen.has(s.instagramPostId)) continue;
      seen.add(s.instagramPostId);
      igItems.push({ title: s.title, kind: s.postType || "POST", mediaId: s.instagramPostId, likes: 0, comments: 0, views: 0, reach: 0, saves: 0, shares: 0, url: null });
    }
    const posts = await prisma.post.findMany({
      where: { status: "PUBLISHED", publishedAt: { gte: since }, instagramPostId: { not: null } },
      orderBy: { publishedAt: "desc" }, take: 20,
      select: { title: true, type: true, instagramPostId: true },
    });
    for (const x of posts) {
      if (!x.instagramPostId || seen.has(x.instagramPostId)) continue;
      seen.add(x.instagramPostId);
      igItems.push({ title: x.title, kind: String(x.type || "POST"), mediaId: x.instagramPostId, likes: 0, comments: 0, views: 0, reach: 0, saves: 0, shares: 0, url: null });
    }
  } catch { /* best-effort */ }

  // Live per-media metrics. Per-item try/catch: STORY media rejects like_count and
  // expires after 24h — a 400 there must not blank the Reels' numbers.
  const igTok = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (igTok && igItems.length) {
    for (const it of igItems.slice(0, 12)) {
      try {
        const r = await fetch(`https://graph.facebook.com/v25.0/${it.mediaId}?fields=like_count,comments_count,permalink&access_token=${igTok}`, { signal: AbortSignal.timeout(8000) });
        const d: any = await r.json();
        if (!d.error) { it.likes = d.like_count ?? 0; it.comments = d.comments_count ?? 0; it.url = d.permalink ?? null; }
      } catch { /* keep zeros */ }
      try {
        const ir = await fetch(`https://graph.facebook.com/v25.0/${it.mediaId}/insights?metric=views,reach,saved,shares&access_token=${igTok}`, { signal: AbortSignal.timeout(8000) });
        const idata: any = await ir.json();
        if (Array.isArray(idata.data)) for (const m of idata.data) {
          const v = m?.values?.[0]?.value ?? 0;
          if (m.name === "views") it.views = v; else if (m.name === "reach") it.reach = v; else if (m.name === "saved") it.saves = v; else if (m.name === "shares") it.shares = v;
        }
      } catch { /* insights unavailable for this media type — fine */ }
    }
  }

  if (cfg.igInsights) {
    const s = igItems.reduce((a, x) => ({
      likes: a.likes + x.likes, comments: a.comments + x.comments, views: a.views + x.views,
      reach: a.reach + x.reach, saves: a.saves + x.saves, shares: a.shares + x.shares,
    }), { likes: 0, comments: 0, views: 0, reach: 0, saves: 0, shares: 0 });
    p.ig = { posts24h: igItems.length, ...s };
  }
  if (cfg.igPublished) p.igPublished = igItems.map((x) => ({ title: x.title, url: x.url, kind: x.kind, likes: x.likes, comments: x.comments }));

  if (cfg.igComments) {
    try {
      const cs = await prisma.comment.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 20, select: { username: true, text: true, sentiment: true } });
      if (cs.length) p.igComments = cs.map((c) => ({ author: c.username, text: c.text, sentiment: c.sentiment }));
    } catch { /* best-effort */ }
  }

  if (cfg.igFollowers) {
    try {
      const tok = process.env.INSTAGRAM_ACCESS_TOKEN?.trim(), acct = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim();
      if (tok && acct) {
        const r = await fetch(`https://graph.facebook.com/v25.0/${acct}?fields=followers_count&access_token=${tok}`, { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        if (typeof d.followers_count === "number") p.igFollowers = { count: d.followers_count, delta: null };
      }
    } catch { /* best-effort */ }
  }

  // ── YouTube ──
  let ytVideos: any[] = [];
  try { ytVideos = await getRecentVideos(15); } catch { /* not configured */ }
  const yt24 = ytVideos.filter((v) => v.publishedAt && new Date(v.publishedAt) >= since);

  if (cfg.ytInsights) {
    const s = yt24.reduce((a, v) => ({ views: a.views + (v.views || 0), likes: a.likes + (v.likes || 0), comments: a.comments + (v.comments || 0) }), { views: 0, likes: 0, comments: 0 });
    p.yt = { videos24h: yt24.length, ...s };
  }
  if (cfg.ytPublished) p.ytPublished = yt24.map((v) => ({ title: v.title, url: v.url }));
  if (cfg.ytSubscribers) {
    try { const cs = await getChannelStats(); if (cs) p.ytSubscribers = { count: cs.subscribers, delta: null }; } catch { /* best-effort */ }
  }
  if (cfg.ytComments) {
    try {
      const out: Array<{ author: string; text: string; videoTitle?: string }> = [];
      for (const v of ytVideos.slice(0, 5)) {
        const threads = await listCommentThreads(v.videoId, 30).catch(() => []);
        for (const t of threads) if (t.publishedAt && new Date(t.publishedAt) >= since) out.push({ author: t.author, text: t.text, videoTitle: v.title });
      }
      if (out.length) p.ytComments = out.slice(0, 20);
    } catch { /* best-effort */ }
  }

  // ── Top performer (across IG likes + YT views in the last 24h) ──
  if (cfg.topContent) {
    const cands: Array<{ platform: string; title: string; score: number; metric: string }> = [];
    const igBest = igItems.map((x) => ({ platform: "Instagram", title: x.title, score: x.likes, metric: `${x.likes} likes` })).sort((a, b) => b.score - a.score)[0];
    const ytBest = yt24.map((v) => ({ platform: "YouTube", title: v.title, score: v.views || 0, metric: `${v.views || 0} views` })).sort((a, b) => b.score - a.score)[0];
    if (igBest) cands.push(igBest); if (ytBest) cands.push(ytBest);
    const best = cands.sort((a, b) => b.score - a.score)[0];
    if (best && best.score > 0) p.topContent = { platform: best.platform, title: best.title, metric: best.metric };
  }

  // ── Auto-engagement (comments + DMs the bot replied to) ──
  if (cfg.engagement) {
    try {
      const acts = await prisma.activityLog.findMany({ where: { createdAt: { gte: since } }, select: { action: true } });
      const commentsReplied = acts.filter((a) => /comment/i.test(a.action) && /repl/i.test(a.action)).length;
      const dmsReplied = acts.filter((a) => /dm/i.test(a.action) && /repl/i.test(a.action)).length;
      p.engagement = { commentsReplied, dmsReplied };
    } catch { /* best-effort */ }
  }

  // ── Scheduled for today (IST) ──
  if (cfg.upcomingToday) {
    try {
      const t = istParts();
      const start = wallTimeToUTC(t.year, t.month, t.day, 0, 0, IST_TZ);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const sp = await prisma.scheduledPost.findMany({
        where: { status: "PENDING", scheduledFor: { gte: start, lt: end } },
        orderBy: { scheduledFor: "asc" }, select: { title: true, platform: true, scheduledFor: true },
      });
      if (sp.length) p.upcoming = sp.map((x) => ({ title: x.title, platform: x.platform, when: istTime(x.scheduledFor) }));
    } catch { /* best-effort */ }
  }

  // ── Failures (last 24h, excluding the transient __CLAIMING__ sentinel) ──
  if (cfg.failures) {
    try {
      const f = await prisma.scheduledPost.findMany({
        where: { status: "FAILED", scheduledFor: { gte: since }, NOT: { error: { startsWith: "__CLAIMING__" } } },
        orderBy: { scheduledFor: "desc" }, take: 10, select: { title: true, error: true },
      });
      if (f.length) p.failures = f.map((x) => ({ title: x.title, error: x.error || "Unknown error" }));
    } catch { /* best-effort */ }
  }

  // ── Growth vs prior day (followers from AccountAnalytics snapshots) ──
  if (cfg.growthDeltas) {
    try {
      const rows = await prisma.accountAnalytics.findMany({ orderBy: { date: "desc" }, take: 2, select: { followers: true } });
      const g: Array<{ label: string; value: string }> = [];
      if (rows.length >= 2) { const d = rows[0].followers - rows[1].followers; g.push({ label: "Instagram followers", value: `${rows[0].followers} (${d >= 0 ? "+" : ""}${d})` }); }
      if (g.length) p.growth = g;
    } catch { /* best-effort */ }
  }

  // ── System health ──
  if (cfg.systemHealth) {
    let dbOk = false;
    try { await prisma.$queryRaw`SELECT 1`; dbOk = true; } catch { dbOk = false; }

    // Recent rate-limit hits + system errors from the last 24h (logged as they happen).
    const rateLimits = getRecentRateLimitEvents();
    const sysErrors  = getRecentSystemErrors();
    const aiRateLimited = rateLimits.some((e) => /\bAI\b|groq|gemini|cerebras/i.test(e.service));
    const groqKeySet = !!(process.env.GROK_API_KEY || process.env.GROQ_API_KEY);

    p.health = [
      { label: "Database", ok: dbOk },
      { label: "Instagram token", ok: !!process.env.INSTAGRAM_ACCESS_TOKEN },
      { label: "YouTube connected", ok: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_REFRESH_TOKEN) },
      { label: "Webhook configured", ok: !!process.env.WEBHOOK_VERIFY_TOKEN },
      // Reflect ACTUAL AI health, not just whether a key is set: if a provider was
      // rate-limited in the last 24h, mark it degraded (this is what breaks posts).
      { label: aiRateLimited ? "AI provider — rate-limited (24h)" : "AI provider", ok: groqKeySet && !aiRateLimited },
    ];

    // Surface the actual rate-limit + error events under System Health so a bad day
    // (e.g. AI daily token cap → no posts) is visible instead of a silent 🟢.
    const alerts: Array<{ label: string; detail: string }> = [];
    for (const e of rateLimits.slice(-6).reverse()) alerts.push({ label: `Rate limit · ${e.service}`, detail: e.detail });
    for (const e of sysErrors.slice(-6).reverse())  alerts.push({ label: e.title, detail: e.detail });
    if (alerts.length) p.systemAlerts = alerts.slice(0, 8);
  }

  // ── AI usage ──
  if (cfg.aiUsage) {
    try {
      const rows = await prisma.aIGeneration.findMany({ where: { createdAt: { gte: since } }, select: { tokensUsed: true } });
      p.aiUsage = { generations: rows.length, tokens: rows.reduce((a, r) => a + (r.tokensUsed || 0), 0) };
    } catch { /* best-effort */ }
  }

  return p;
}
