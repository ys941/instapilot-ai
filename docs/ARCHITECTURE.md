# Architecture

How InstaPilot AI is put together. For setup see [DEPLOYMENT.md](DEPLOYMENT.md).

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 16** (App Router) + React 18, request gate in **`proxy.ts`** |
| Language | TypeScript 5 |
| Styling | Tailwind CSS + glassmorphism, Framer Motion, Radix UI, Recharts |
| Content AI | Per-task fallback **chains** across **Grok** (Groq Llama-3.3-70B), **Cerebras** (`gpt-oss-120b`) & **Google Gemini** (configured in Settings → AI) |
| Conversational AI | **Groq** — Llama-3.3-70B (comment/DM/YouTube replies), Llama-3.1-8B (fast fallback) |
| Voice | Groq **Whisper** (speech→text) + Gemini **TTS** (text→speech) |
| Vision | Gemini multimodal (captions + music-mood selection) |
| Image rendering | **Satori + Sharp** (server-side cards) |
| Video / Shorts | **ffmpeg-static** (cards → 720×1280 MP4) |
| Music | **Jamendo** API (Creative-Commons instrumentals) |
| YouTube | YouTube Data API v3 via **googleapis** (OAuth2 refresh token) |
| Media hosting | Cloudinary (images + audio transcode to m4a) |
| Database | **PostgreSQL + Prisma ORM** |
| Data fetching | TanStack Query v5 |
| Email | **Resend** / Nodemailer |
| Instagram | **Facebook Graph API** (publish, comments, DMs, insights) + webhooks |
| Deployment | **Railway** (Nixpacks) or **Docker** (Compose) |
| Automation engine | In-process catch-up loop (`lib/catchup.ts`, per-brand) + Instagram webhooks + daily timer |
| PWA | Installable web app — brand-driven manifest (`app/manifest.ts`) + service worker (`components/PWARegister.tsx`) |

---

## 🏗 Architecture

A single in-process loop (`lib/catchup.ts`) drives everything. It is started by `instrumentation.ts` on server boot (after a ~15s delay) and re-fired on an interval (`MIN_INTERVAL_MS`, 5 min), plus a separate daily timer. Dashboard polling (`/api/scheduler/check`, `/api/comments/check`, `/api/dms/check`) can also nudge it.

Each cycle, `runCatchup()` lists all brands and runs the **full pipeline independently for every *active* brand** (primary first). With only the primary brand present this is a single iteration whose credentials resolve from ENV — identical to the original single-account behaviour.

```
runCatchup()  (every MIN_INTERVAL_MS; comment poll throttled when webhooks active)
 └─ for each ACTIVE brand (own credentials + own preferences + own brand skin):
     ├─ scheduleAutoStory()          → create today's story (guarded against duplicates)
     ├─ runAutoGeneratePosts()       → today's IG posts (per-day count/times, type + topic rotation; postsPerDay cap)
     ├─ runAutoGenerateYouTube()     → independent YouTube Shorts (own per-day count/times/days/types/topics)
     ├─ publishOverdueScheduled()    → publish due posts/stories/carousels, routed per platform
     │     ├─ instagram  → igPublish / igPublishCarousel
     │     └─ youtube    → publishPostToYouTubeShort  (no IG creds needed; optional IG Reel cross-post)
     ├─ fetchMissedComments()        → IG comment reply fallback (webhook handles real-time)
     ├─ syncInstagramInsights()      → refresh IG analytics (throttled ~6h/brand)
     ├─ replyMissedDMs()             → IG DM reply fallback
     └─ replyToYouTubeComments()     → Grok replies on the channel's recent Shorts/videos
                                       (skips the channel's OWN comments — never replies to itself)

Daily timer  (runDailyHealthCheck):
 ├─ runAutoGeneratePosts() / runAutoGenerateYouTube()  → also kicked here
 └─ sendDailyHealthReport()      → morning digest (DB / AI / Instagram health, IG webhook status,
                                   today's YouTube posts + auto-posts, 24h stats, failures)

Webhooks  (/api/webhooks/instagram, HMAC-verified):
 ├─ comments       → instant Grok reply
 ├─ messaging[]    → instant Grok DM reply (text or voice)
 └─ story_insights → real-time analytics sync
```

> The auto-generators self-gate per brand (date guard + DB de-dupe + in-flight guard + `postsPerDay` cap), so being called every cycle never double-generates.

### Platform routing (`instagram` | `youtube`)
Both `Post` and `ScheduledPost` carry a `platform` column (default `"instagram"`):
- **Generator** sets it at creation; the **manual publish** route accepts a `{ platform }` override (persisted before routing).
- **Settings → YouTube** `enabled` is the **auto-poster master switch** (independent generator + Grok comment replies); `publishToInstagram` cross-posts each YouTube Short to Instagram as a Reel.
- **Note:** there is **no Instagram → YouTube cross-post** — IG feed posts stay on Instagram (community posts can't be created via the YouTube Data API). YouTube content is created independently by the YouTube auto-poster.

| Path | Entry point | Behavior |
|------|-------------|----------|
| **Manual** | `POST /api/posts/[id]/publish` | `youtube` → render → Short → upload, skip IG. `instagram` → IG flow. |
| **Scheduler / catchup** | `publishOverdueScheduled()` | Reads each overdue post's `platform`. `youtube` → `publishPostToYouTubeShort()` (+ optional IG Reel cross-post when `publishToInstagram` is on). YouTube-only posts publish even with **no** IG credentials. |
| **Media folder** | `POST /api/media/[id]/publish-youtube` | Publishes the **actual uploaded file** (video → direct upload; image → rendered Short). |

### Idempotency & self-healing
- **`youtubeVideoId` / `instagramPostId`** are stored on both `ScheduledPost` and `Post`; every publish path re-reads the freshest value before uploading, so retries never double-post. **The id-persist write after a successful publish is itself retried** (`persistWithRetry`, 3 attempts w/ backoff) — a transient DB blip right after an upload can no longer lose the id and trigger a re-publish on the next tick.
- **Claim lock + timestamped reaper** — `publishOverdueScheduled` and the manual route both atomically flip a `PENDING` `ScheduledPost` to `FAILED("__CLAIMING__")`; only the caller that gets `count===1` proceeds. The claim-lock **embeds a timestamp**, and the **reaper resets stale claims by that embedded claim time** (older than **45 min** — sized to exceed the worst-case legitimate render+upload so an *active* claim is never reaped mid-publish) — **not** by the row's `createdAt` — so genuinely-stuck claims recover while in-flight ones are left alone, stopping duplicate posts.
- **Single-run catch-up** — a module-level in-flight guard makes `runCatchup()` **non-re-entrant**: if a cycle runs longer than the 5-min interval, the next tick early-returns instead of overlapping it, so DM replies and story creation can't double-fire.
- **Atomic DM claim** — comment *and* DM auto-replies claim each message id (`claimDMForReply`/comment claim) before generating, so two overlapping ticks (or a catch-up racing a webhook redelivery) can never send two replies to the same message.
- **Render lock (OOM guard)** — a **process-wide single-flight queue** wraps the **entire memory-heavy build** (card render + music + ffmpeg) for **both** the YouTube Short build **and** the IG carousel render, so only **one** render is ever in memory at a time on memory-limited hosts. Every remote fetch inside the lock carries a **60 s `AbortSignal` timeout** (a hung media URL can't deadlock the whole publish queue), and a 120s watchdog still SIGKILLs any wedged ffmpeg render.
- **Black-frame render guard** — before a Short is encoded, every rendered card frame is variance-checked (`isBlankFrame` in `lib/videoGenerator.ts`): a transient satori→sharp rasterization glitch can emit valid-sized but visually **all-black** frames. If **every** frame is blank the render **aborts** (returns `null`), so the publish fails and **retries** with a proper render instead of ever shipping a dead all-black reel; a partial-blank render logs a warning and proceeds.
- **JSON-resilient AI** — content-JSON generation tries the selected provider then **falls through to the other** on empty/quota-exhaustion responses (429 / `limit:0`), so Stories, IG posts, and Shorts never silently degrade to canned filler when a provider's free quota is gone.
- **Passed slots publish today** — if a day's slot time has already passed when the auto-generator runs, the post is scheduled for **now (today)** instead of being pushed to tomorrow — fixing over-generation and the "N posts at one time" same-time collision (in **both** the IG and YouTube generators).
- **AI fallback chains** everywhere; graceful degradation (silent Shorts, silent-Short voiceover fallback, default mood, branded fallback replies).

### Instagram events: webhook + polling
Real-time events arrive at `/api/webhooks/instagram` (HMAC-verified) for instant replies; the catchup loop's `fetchMissedComments()` / `replyMissedDMs()` provide a polling fallback for anything missed. Webhook subscription is **auto-ensured on startup**: the app-level + IG object-level fields are `comments` / `messages` / `mentions` (+ `story_insights`), and the **Page** object is auto-bound to `feed,messages,mention` via `POST /{page-id}/subscribed_apps`. That Page binding is what actually makes Meta deliver events and **requires a Page token with the `pages_manage_metadata` scope** — without it the bind is rejected and real-time delivery silently never starts (the polling fallback still works).

---


## 📂 Project Structure

```
instapilot-ai/
├── app/
│   ├── (dashboard)/
│   │   ├── overview/          # Home: health, IG + YouTube stats, AI chat
│   │   ├── generator/         # Manual AI generator (with platform picker)
│   │   ├── scheduler/         # Calendar / schedule posts
│   │   ├── analytics/         # IG + YouTube analytics + comments/DMs inbox
│   │   ├── content-library/   # All posts: preview, schedule, publish, delete
│   │   ├── media/             # Upload media → AI caption + hashtags → publish
│   │   ├── activity/          # Activity feed
│   │   └── settings/          # Accounts · Brand · Content Types · AI · Auto-Post · Stories · YouTube · Prompts · …
│   ├── login/                 # Access-key login
│   └── api/
│       ├── webhooks/instagram/             # Real-time comments / DMs / insights (HMAC)
│       ├── brands/{,[id]}/                 # Multi-account: list/add brand, edit/enable/delete
│       ├── youtube/{overview,videos,comments}/   # YouTube stats + per-video + comments
│       ├── ai/{generate,chat,hashtags}/    # generator + chat + hashtag endpoint
│       ├── posts/[id]/publish/             # publish = platform routing
│       ├── media/[id]/publish-youtube/     # publish real uploaded media as a Short
│       ├── scheduler/{,[id],check,failed}/
│       ├── analytics/{overview,live,top-posts,sync}/
│       ├── instagram/{analytics,comments,dms,posts/insights,ai-reply,media}/
│       ├── settings/{account,brand,ai,auto-post,stories,prompts,notifications,instagram,youtube,danger}/
│       ├── stories/generate-now/ , catchup/ , auto-generate/ , comments/check , dms/check
│       └── webhook/{setup,debug}/ , health/ , notifications/{count,stream}/ , auth/{login,logout}/
│
├── lib/
│   ├── brandConfig.ts         # ★ White-label brand skin: BrandConfig, getBrand, persona/handle builders
│   ├── catchup.ts             # ★ Automation engine: runCatchup (per-brand loop),
│   │                          #   publishOverdueScheduled, crossPostYouTubeShortToInstagramReel,
│   │                          #   runAutoGeneratePosts, runAutoGenerateYouTube,
│   │                          #   scheduleAutoStory, replyToYouTubeComments, claim lock + reaper
│   ├── brands.ts              # Multi-account: brand CRUD + per-brand credential resolution (ENV-first for primary)
│   ├── youtube.ts             # YouTube Data API v3 client (upload/stats/comments/health, per-brand creds)
│   ├── youtubePublish.ts      # Post → carousel Short MP4 (hook cover + content slides + outro, themes,
│   │                          #   music, AI tags, seed comment); buildRichCaption + YT search-tag builders
│   ├── hookCard.ts            # Hook cover + SUBSCRIBE outro cards + THEMES (satori → SVG → sharp, container-safe)
│   ├── videoGenerator.ts      # Cards → 720×1280 MP4 (ffmpeg-static, watchdog, serialized single-flight)
│   ├── music.ts               # Vision mood → Jamendo CC instrumental + attribution
│   ├── richCaption.ts         # Unified IG/YouTube rich caption (cached on reelScript) + follow links
│   ├── grok.ts                # Groq client — replies, quiz logic, content JSON
│   ├── gemini.ts              # Gemini client — Grok-first JSON, vision, TTS, model chains
│   ├── aiModels.ts            # ★ Provider/model catalogs + per-task fallback chains (Grok/Cerebras/Gemini)
│   ├── ai-factory.ts          # Resolves each task's chain (content/reply/vision), Cerebras client
│   ├── shortLength.ts         # Selectable Short length (15/20/30/45/60s) → shortPlan pacing
│   ├── themes.ts              # ★ 10 app-wide themes (Settings → Appearance, CSS-variable driven)
│   ├── audioReply.ts          # Whisper transcription + Gemini TTS → m4a (voice DMs)
│   ├── hashtagEnricher.ts     # Live IG-trending + relevance hashtag builder
│   ├── postTypeImageGenerator.ts / storyImageGenerator.ts / slideImageGenerator.ts  # Satori renderers
│   ├── imageGenerator.ts      # Cloudinary upload + carousel image pipeline
│   ├── captionBuilder.ts      # Structured Instagram captions + capIgCaption (2200-char trim) + applyBrand
│   ├── notifier.ts            # Emails + SSE: daily report, publish/fail, YouTube events
│   ├── preferences.ts         # Per-brand settings + brand skin (primary→Preferences singleton, others→Brand.settings)
│   └── instagram.ts / prisma.ts / auth.ts / session.ts / webhookCounter.ts / utils.ts
│
├── prisma/schema.prisma       # Brand, Post, ScheduledPost (platform + youtubeVideoId + brandId),
│                              #   Analytics, AccountAnalytics, Comment, ActivityLog, Preferences (+ brand skin), User, …
├── scripts/youtube-auth.mjs   # One-command OAuth loopback → prints YOUTUBE_REFRESH_TOKEN
├── proxy.ts                   # Auth gate (session cookie) for pages AND /api routes (Next 16 middleware)
├── instrumentation.ts         # Starts the catch-up loop + daily timer on boot
├── Dockerfile / docker-compose.yml   # Container build + Postgres for self-hosting
├── nixpacks.toml              # Railway build: fonts + ffmpeg
├── components/                # Dashboard UI (cards, charts, dialogs, forms; incl. BrandSwitcher + useSelectedBrand)
└── README.md
```

> **Note (Next.js 16):** the request gate lives in **`proxy.ts`** (Next 16's renamed middleware). If a deploy fails on the gate, confirm this file's name/export matches what your Next version expects.

---

