/**
 * lib/demo/api.ts
 *
 * The browser-side stand-in for the whole /api surface, used only by the public
 * demo (NEXT_PUBLIC_DEMO=1, a static export with no server).
 *
 * `installDemoApi()` wraps window.fetch: any request to /api/* is answered from
 * the fixtures built by scripts/demo/make-fixtures.cjs (loaded once from
 * /demo/fixtures.json), and everything else passes through untouched. Writes —
 * creating, editing, scheduling, publishing — update an in-memory copy, so the
 * dashboard behaves like the real thing for the length of the visit. Nothing is
 * sent anywhere, and no AI is called: "generated" posts are drawn from the
 * fixture library.
 */

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

type Json = Record<string, any>;
type Handler = (ctx: { url: URL; method: string; body: any; params: string[] }) => any | Promise<any>;

let fixtures: Json | null = null;
let loading: Promise<Json> | null = null;

function load(realFetch: typeof fetch): Promise<Json> {
  if (fixtures) return Promise.resolve(fixtures);
  loading ??= realFetch(`${BASE}/demo/fixtures.json`)
    .then((r) => r.json())
    .then((f) => (fixtures = f));
  return loading;
}

const ok = (data: any, extra: Json = {}) => ({ success: true, error: null, data, ...extra });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function paginate<T>(items: T[], url: URL, defaultLimit = 20) {
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.max(1, Number(url.searchParams.get("limit") || defaultLimit));
  const total = items.length;
  return {
    items: items.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
  };
}

function byNewest<T extends Json>(key = "createdAt") {
  return (a: T, b: T) => String(b[key] ?? "").localeCompare(String(a[key] ?? ""));
}

function log(f: Json, action: string, label: string, post: Json) {
  f.logs.unshift({ id: newId("log"), userId: "demo-user", action, label, entity: "Post", entityId: post.id, metadata: { title: post.title }, createdAt: new Date().toISOString() });
}

/** A "generated" post for the requested type, drawn from the fixture library. */
function generate(f: Json, body: Json) {
  const type = body?.type || "EDUCATIONAL";
  const pool = f.posts.filter((p: Json) => p.type === type);
  const src = pool[Math.floor(Math.random() * pool.length)] || f.posts[0];
  const topic = String(body?.topic || "").trim();
  return {
    generationId: newId("gen"),
    title: topic ? `${topic.replace(/^\w/, (c: string) => c.toUpperCase())}` : src.title,
    hook: src.hook, content: src.content, cta: src.cta, hashtags: src.hashtags,
    imagePrompt: null, reelScript: null, viralScore: src.viralScore, carouselSlides: null,
    tokensUsed: 0, duration: 1200,
  };
}

const PREF_ROUTES: Record<string, string> = {
  "/api/settings/ai": "ai",
  "/api/settings/notifications": "notifications",
  "/api/settings/morning-digest": "morningDigest",
  "/api/settings/auto-post": "autoPost",
  "/api/settings/stories": "stories",
};

// [method, path pattern, handler]. `:x` segments are captured into params.
const ROUTES: Array<[string, string, Handler]> = [
  ["GET", "/api/health", () => ok({
    overall: "healthy", provider: "groq",
    services: {
      database: { ok: true, label: "Database", detail: "Demo data (in your browser)" },
      ai: { ok: true, label: "AI (content)", detail: "Demo — no AI calls are made" },
      grok: { ok: true, label: "AI (replies)", detail: "Demo — replies are simulated" },
      youtube: { ok: true, label: "YouTube API", detail: "Demo channel" },
      email: { ok: true, label: "Email", detail: "Demo" },
    },
  })],
  ["GET", "/api/startup", () => ok({ scheduledPublished: 0, scheduledFailed: 0, newComments: 0, commentsReplied: 0, dmsReplied: 0, errors: [], ranAt: new Date().toISOString() })],
  ["GET", "/api/scheduler/check", () => ({ success: true, skipped: true })],

  ["GET", "/api/brands", () => ok(fixtures!.brands)],
  ["POST", "/api/brands", ({ body }) => {
    const b = { id: newId("brand"), label: body?.label || "New account", isPrimary: false, active: true, ytChannelTitle: "", hasYouTube: false };
    fixtures!.brands.push(b);
    return ok(b);
  }],
  ["*", "/api/brands/:id", () => ok(null)],

  ["GET", "/api/settings/brand", () => ok(fixtures!.brand)],
  ["*", "/api/settings/brand", ({ body }) => ok(Object.assign(fixtures!.brand, body?.brand ?? body ?? {}))],
  ["GET", "/api/settings/prompts", () => ok({ saved: fixtures!.prefs.prompts ?? {}, defaults: {}, igDefaultPrompt: "", ytDefaultPrompt: "" })],
  ["GET", "/api/settings/youtube", () => ({ ...ok(fixtures!.prefs.youtube), status: { ok: true, configured: true, channelTitle: "Demo Kitchen", detail: "Demo channel" } })],
  ["*", "/api/settings/youtube", ({ body }) => ok(Object.assign(fixtures!.prefs.youtube, body ?? {}))],
  ["GET", "/api/settings/account", () => ok(fixtures!.account)],

  ["GET", "/api/analytics/overview", () => ok(fixtures!.analytics)],
  ["GET", "/api/youtube/overview", () => ok(fixtures!.youtube)],
  ["GET", "/api/youtube/comments", () => ok(fixtures!.comments)],

  // ── Instagram ──────────────────────────────────────────────────────────────
  ["GET", "/api/instagram/analytics", () => {
    const ig = fixtures!.instagram;
    return ok({ profile: ig.profile, insights: ig.insights, recentMedia: ig.recentMedia, topPosts: ig.topPosts, fetchedAt: ig.fetchedAt });
  }],
  ["GET", "/api/instagram/comments", () => {
    const list = fixtures!.instagram.comments;
    const sentiment = { positive: 0, negative: 0, neutral: 0 } as Json;
    for (const c of list) sentiment[c.sentiment] = (sentiment[c.sentiment] || 0) + 1;
    return ok({ comments: list, total: list.length, sentiment });
  }],
  ["POST", "/api/instagram/comments/sync", () => ok({ synced: fixtures!.instagram.comments.length })],
  ["GET", "/api/instagram/dms", () => ok({ conversations: fixtures!.instagram.dms, total: fixtures!.instagram.dms.length })],
  ["GET", "/api/instagram/posts/insights", () => ok({ posts: fixtures!.instagram.postInsights, syncedAt: new Date().toISOString() })],
  ["POST", "/api/instagram/ai-reply", async ({ body }) => {
    await wait(900);
    const c = fixtures!.instagram.comments.find((x: Json) => x.id === body?.commentId);
    const reply = "Thanks so much for watching — glad it helped! 🙌";
    if (c) Object.assign(c, { replied: true, replyText: reply });
    return ok({ reply, replied: true, message: "Replied (demo — nothing was sent to Instagram)" });
  }],
  ["GET", "/api/settings/instagram", () => ok({
    tokenMasked: "IGQVJXdemo123...0a9f", tokenPresent: true, accountId: "17841400000000000", pageId: "1000000000000000",
    tokenValid: true, accountName: "Demo Kitchen", expiresAt: new Date(Date.now() + 45 * 86_400_000).toISOString(),
  })],
  ["GET", "/api/notifications/count", () => ({ count: 0 })],
  ["POST", "/api/ai/hashtags", async () => {
    await wait(700);
    return ok({ hashtags: ["#homecooking", "#easyrecipes", "#weeknightdinner", "#mealprep", "#cookingtips", "#quickmeals", "#dinnerideas", "#foodreels"] });
  }],
  ["POST", "/api/stories/generate-now", async () => { await wait(1000); return ok({ generated: 0, message: "Stories are generated on your own server — this is a demo." }); }],
  ["GET", "/api/comments/check", () => ok({ checked: 0, replied: 0 })],
  ["GET", "/api/dms/check", () => ok({ checked: 0, replied: 0 })],
  ["GET", "/api/webhook/debug", () => ok({ events: [], subscribed: true, note: "Webhooks run on your own server — this is a demo." })],

  ["GET", "/api/posts", ({ url }) => {
    const status = url.searchParams.get("status");
    const list = fixtures!.posts.filter((p: Json) => !status || p.status === status).sort(byNewest());
    const { items, pagination } = paginate(list, url);
    return ok({ posts: items, pagination });
  }],
  ["POST", "/api/posts", ({ body }) => {
    const t = new Date().toISOString();
    const post = {
      id: newId("post"), userId: "demo-user", status: "DRAFT", platform: "youtube", hashtags: [], mediaUrls: [],
      viralScore: 0.8, createdAt: t, updatedAt: t, analytics: null, brandId: null, ...body,
    };
    fixtures!.posts.unshift(post);
    log(fixtures!, "POST_CREATED", "Created a post", post);
    return ok({ post });
  }],
  ["POST", "/api/posts/:id/publish", ({ params }) => {
    const p = fixtures!.posts.find((x: Json) => x.id === params[0]);
    if (p) { Object.assign(p, { status: "PUBLISHED", publishedAt: new Date().toISOString() }); log(fixtures!, "POST_PUBLISHED", "Published to YouTube", p); }
    return ok({ post: p, published: true, message: "Published (demo — nothing was uploaded)" });
  }],
  ["GET", "/api/posts/:id", ({ params }) => ok(fixtures!.posts.find((x: Json) => x.id === params[0]) ?? null)],
  ["PATCH", "/api/posts/:id", ({ params, body }) => {
    const p = fixtures!.posts.find((x: Json) => x.id === params[0]);
    if (p) Object.assign(p, body, { updatedAt: new Date().toISOString() });
    return ok(p ?? null);
  }],
  ["PUT", "/api/posts/:id", ({ params, body }) => {
    const p = fixtures!.posts.find((x: Json) => x.id === params[0]);
    if (p) Object.assign(p, body, { updatedAt: new Date().toISOString() });
    return ok(p ?? null);
  }],
  ["DELETE", "/api/posts/:id", ({ params }) => {
    fixtures!.posts = fixtures!.posts.filter((x: Json) => x.id !== params[0]);
    return ok(null);
  }],

  ["GET", "/api/content-library", ({ url }) => {
    const q = (url.searchParams.get("search") || "").toLowerCase();
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");
    const sortBy = url.searchParams.get("sortBy") || "createdAt";
    const asc = url.searchParams.get("sortOrder") === "asc";
    let list = fixtures!.posts.filter((p: Json) =>
      (!status || p.status === status) && (!type || p.type === type) &&
      (!q || `${p.title} ${p.content} ${p.hook}`.toLowerCase().includes(q)));
    list = list.sort(byNewest(sortBy));
    if (asc) list.reverse();
    const { items, pagination } = paginate(list, url);
    const count = (k: string) => Object.entries(fixtures!.posts.reduce((m: Json, p: Json) => ((m[p[k]] = (m[p[k]] || 0) + 1), m), {}))
      .map(([v, c]) => ({ [k === "status" ? "status" : "type"]: v, count: c }));
    return ok({ posts: items, pagination, filters: {}, stats: { byStatus: count("status"), byType: count("type"), totalInLibrary: fixtures!.posts.length } });
  }],

  ["GET", "/api/scheduler", ({ url }) => {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const list = fixtures!.scheduledPosts.filter((s: Json) => (!from || s.scheduledFor >= from) && (!to || s.scheduledFor <= to));
    return ok({ scheduledPosts: list, draftScheduled: [], total: list.length });
  }],
  ["POST", "/api/scheduler", ({ body }) => {
    const post = fixtures!.posts.find((x: Json) => x.id === body?.postId);
    const s = {
      id: newId("sched"), userId: "demo-user", platform: "youtube", status: "PENDING", timezone: "UTC", retryCount: 0,
      isRecurring: false, hashtags: [], createdAt: new Date().toISOString(),
      title: post?.title ?? body?.title ?? "Scheduled Short", content: post?.content ?? body?.content ?? "",
      mediaUrl: post?.mediaUrls?.[0] ?? null, postType: post?.type ?? null, ...body,
    };
    fixtures!.scheduledPosts.push(s);
    if (post) { Object.assign(post, { status: "SCHEDULED", scheduledFor: s.scheduledFor }); log(fixtures!, "POST_SCHEDULED", "Scheduled a post", post); }
    return ok(s);
  }],
  ["PATCH", "/api/scheduler/:id", ({ params, body }) => {
    const s = fixtures!.scheduledPosts.find((x: Json) => x.id === params[0]);
    if (s) Object.assign(s, body);
    return ok(s ?? null);
  }],
  ["PUT", "/api/scheduler/:id", ({ params, body }) => {
    const s = fixtures!.scheduledPosts.find((x: Json) => x.id === params[0]);
    if (s) Object.assign(s, body);
    return ok(s ?? null);
  }],
  ["DELETE", "/api/scheduler/:id", ({ params }) => {
    fixtures!.scheduledPosts = fixtures!.scheduledPosts.filter((x: Json) => x.id !== params[0]);
    return ok(null);
  }],

  ["GET", "/api/activity", ({ url }) => {
    const { items, pagination } = paginate(fixtures!.logs, url, 50);
    const counts = fixtures!.logs.reduce((m: Json, l: Json) => ((m[l.action] = m[l.action] || { action: l.action, label: l.label, count: 0 }), m[l.action].count++, m), {});
    return ok({ logs: items, pagination, actionStats: Object.values(counts) });
  }],

  ["POST", "/api/ai/generate", async ({ body }) => { await wait(1200); return ok(generate(fixtures!, body)); }],
  ["POST", "/api/ai/chat", async () => {
    await wait(800);
    return ok({ response: "This is the demo, so I'm not connected to an AI model. In your own install I'd plan content, suggest hooks and review your channel's numbers — with your own API keys." });
  }],
  ["POST", "/api/media/generate-caption", async () => { await wait(700); return ok({ caption: "Dinner in 15 minutes, one pan, zero stress. Save this for your next busy night!", hashtags: ["#homecooking", "#easyrecipes", "#shorts"] }); }],
  ["POST", "/api/media/generate-hashtags", async () => { await wait(500); return ok({ hashtags: ["#homecooking", "#easyrecipes", "#weeknightdinner", "#cookingtips", "#shorts"] }); }],
  ["POST", "/api/upload", () => ({ success: false, error: "Uploading is switched off in the demo — self-host to use your own media." })],
  ["POST", "/api/media/:id/publish-youtube", () => ok({ published: true, message: "Published (demo — nothing was uploaded)" })],
  ["POST", "/api/auto-generate", async () => { await wait(900); return ok({ generated: 0, message: "Auto-generation runs on your own server — this is a demo." }); }],
];

function match(pattern: string, path: string): string[] | null {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return null;
  const params: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params.push(decodeURIComponent(b[i]));
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function handle(url: URL, method: string, body: any): Promise<any> {
  const path = url.pathname.replace(/\/$/, "");
  const prefKey = PREF_ROUTES[path];
  if (prefKey) {
    if (method !== "GET" && body && typeof body === "object") Object.assign(fixtures!.prefs[prefKey], body);
    return ok(fixtures!.prefs[prefKey]);
  }
  for (const [m, pattern, fn] of ROUTES) {
    if (m !== "*" && m !== method) continue;
    const params = match(pattern, path);
    if (params) return fn({ url, method, body, params });
  }
  // Anything else (logout, settings saves we don't model, …) simply succeeds.
  return ok(null);
}

/** EventSource that never connects: the demo has no live notification stream. */
class SilentEventSource {
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2;
  readyState = 1; url: string; withCredentials = false;
  onopen: any = null; onmessage: any = null; onerror: any = null;
  constructor(url: string) { this.url = String(url); }
  addEventListener() {} removeEventListener() {} dispatchEvent() { return true; }
  close() { this.readyState = 2; }
}

let installed = false;

export function installDemoApi() {
  if (!IS_DEMO || installed || typeof window === "undefined") return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  const RealEventSource = window.EventSource;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    const path = BASE && url.pathname.startsWith(`${BASE}/api/`) ? url.pathname.slice(BASE.length) : url.pathname;
    if (url.origin !== window.location.origin || !path.startsWith("/api/")) return realFetch(input as any, init);

    await load(realFetch);
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    let body: any = null;
    if (typeof init?.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    const result = await handle(new URL(path + url.search, window.location.origin), method, body);
    return new Response(JSON.stringify(result), {
      status: result?.success === false ? 400 : 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  window.EventSource = function (this: any, url: string | URL, cfg?: EventSourceInit) {
    const u = new URL(String(url), window.location.origin);
    if (u.pathname.includes("/api/")) return new SilentEventSource(u.href) as any;
    return new RealEventSource(url, cfg);
  } as any;
}
