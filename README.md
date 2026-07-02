<div align="center">

# 🚀 InstaPilot AI

### Autonomous, white-label AI content manager for **Instagram + YouTube Shorts** — for *any* niche

<p>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" />
  <img alt="React 18" src="https://img.shields.io/badge/React-18-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
  <img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="PostgreSQL + Prisma" src="https://img.shields.io/badge/Postgres-Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white" />
  <img alt="Grok + Gemini" src="https://img.shields.io/badge/AI-Grok%20%2B%20Gemini-7C3AED?style=for-the-badge&logo=google&logoColor=white" />
</p>

<p>
  <img alt="Instagram Graph API" src="https://img.shields.io/badge/Instagram-Graph%20API-E4405F?style=for-the-badge&logo=instagram&logoColor=white" />
  <img alt="YouTube Data API v3" src="https://img.shields.io/badge/YouTube-Data%20API%20v3-FF0000?style=for-the-badge&logo=youtube&logoColor=white" />
  <a href="#-deployment-railway"><img alt="Deploy on Railway" src="https://img.shields.io/badge/Deploy%20on-Railway-0B0D0E?style=for-the-badge&logo=railway&logoColor=white" /></a>
  <img alt="Docker ready" src="https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
</p>

<a href="https://railway.com/new"><img src="https://railway.com/button.svg" alt="Deploy on Railway" height="44" /></a>

<sub>One AI brain → branded image cards + carousels + Stories → vertical YouTube Shorts → cross-post Reels → auto-reply to comments &amp; DMs (incl. voice) → daily analytics digest — <b>fully unattended.</b></sub>

</div>

---

InstaPilot AI is a production SaaS that **fully automates** one or more content **brands** (paired Instagram + YouTube accounts) across **both platforms** — for **any niche** (cooking, fitness, finance, travel, education, tech, beauty, …). Everything that used to be hard-coded — app name, niche, topics, content-type labels, AI persona/prompts, account handles — is now configured entirely in **Settings**, so you can re-skin the whole product for your own brand **without touching code**. The env-seeded account is the **Primary** brand; you can add more paired IG + YouTube accounts in **Settings → Accounts**, and each runs **independently** with its own settings, prompts, schedule, topics, and brand skin.

Every day, per brand, it writes on-topic content with AI, renders branded image cards (posts, carousels, stories), turns those cards into vertical **YouTube Shorts** — each a multi-slide **carousel** (a fast curiosity HOOK cover → large-text content slides → SUBSCRIBE outro), with a different theme per Short, mood-matched royalty-free music, an AI-written full caption, and an auto-posted engagement seed comment. It publishes everything on the **per-weekday schedule** you set, cross-posts YouTube Shorts to Instagram as **Reels** (opt-in, on their own deferred timing), replies to Instagram comments and DMs (including **voice notes**) and to YouTube comments — never to itself — syncs analytics for both platforms, and emails a daily health report. It runs unattended via an in-process automation loop, Instagram webhooks, and a daily job — you mostly just watch.

---

## 📑 Table of Contents

1. [White-Label / Any-Niche](#-white-label--any-niche)
2. [Key Features](#-key-features)
3. [Multi-Account (Brands)](#-multi-account-brands)
4. [Tech Stack](#-tech-stack)
5. [Architecture](#-architecture)
6. [Settings Reference](#-settings-reference)
7. [Setup / Installation](#-setup--installation)
8. [Deployment](#-deployment)
9. [Project Structure](#-project-structure)
10. [Security](#-security)

---

## 🎨 White-Label / Any-Niche

InstaPilot ships **niche-neutral** and is re-skinnable for any brand entirely from the UI — **no code edits**.

- **Brand skin (per account)** — in **Settings → Brand** set your **app name**, **niche/topic**, **persona/voice**, **Instagram handle**, **YouTube handle + channel name**, and the **dual-follow CTA**. The skin is stored *per account* (`BrandConfig`), so each brand you add can carry its own identity. A neutral default ("InstaPilot AI") ships out of the box.
- **AI generators & prompts** — choose your content provider (**Grok**/Groq or **Gemini**), and override the **system prompt / persona** and **per-content-type prompts** in **Settings → AI** and **Settings → Prompts**. The brand's niche and persona are injected into every generation, so the AI writes about *your* topic in *your* voice.
- **Rename content types** — the fixed content slots keep stable internal IDs (so your data never breaks), but their **user-facing labels** are fully renameable in **Settings → Content Types** (e.g. relabel "Clinical Pearl" → "Pro Tip", "Quiz" → "Trivia"). Captions, cards, and the generator all read the label.
- **Bring your own keys** — no API keys are bundled. You supply your own Groq/Gemini/Meta/Cloudinary/Resend (and optional YouTube/Jamendo) credentials via env or the Settings UI. See [Environment variables](#environment-variables).
- **Handles resolve at render time** — captions use a neutral `@__HANDLE__` placeholder resolved to the active brand's handle when published, so switching brands never leaks another account's handle.

> **TL;DR for a new owner:** clone → set env keys → log in → **Settings → Brand** (name, niche, handles) → **Settings → AI/Prompts** (provider, voice) → **Settings → Content Types** (labels) → add your accounts → set the schedule. You're live in your own niche without editing a single file.

---

## ✨ Key Features

### 🧠 AI content generation
- **Selectable provider — per brand** — choose **Grok** (Groq Llama-3.3-70B) or **Gemini** as the active content provider in **Settings → AI** (`aiProvider`). For content JSON, Grok is tried first regardless, then a Gemini model-fallback chain (Grok is a clean, non-"thinking" instruct model that returns complete JSON reliably). The auto-poster resolves the provider **per brand** via `getAIClient(brandId)`, so each brand's auto-generated **IG posts, YouTube Shorts, and stories** use *its own* configured provider. **Known limitation:** vision **captions, hashtags, and YouTube tags** still call `getAIClient()` with no brand id, so they use the **primary** brand's provider regardless of which brand is publishing.
- **Brand-aware persona** — the active brand's **niche** and **persona/voice** are injected into the system prompt (`buildBrandSystemPrompt` / `buildBrandPersona`), so generated content matches your topic and tone.
- **Topic rotation + auto-expansion** — every used topic is logged; once your configured topics run out, the AI generates fresh same-style topics so content never repeats. Shared across stories, IG posts, and YouTube posts.
- **Theme-level anti-repetition + title-quality gate** — the auto-generators don't just avoid repeating *wording*; they steer away from recent posts at the **subject/theme** level, so two posts on the same idea with fresh words don't slip through (platforms suppress repetitive uploads). The YouTube generator compares against the last 40 titles, **enforces topic de-duplication**, and runs a **title-quality gate** that re-generates any weak title before publish (plus a subscribe/comment engagement loop on every upload).
- **Many content types (renameable labels)** — stable internal IDs `EDUCATIONAL`, `CLINICAL_PEARL`, `PREVENTIVE`, `QUIZ` / `ECG_QUIZ` / `ANGIOGRAPHY_QUIZ`, `MYTH_FACT`, `CASE_STUDY`, `CAROUSEL` (multi-slide), `CTA`, `REEL`, `STORY` — each with a **user-facing label you can rename** in Settings → Content Types.
- **Vision captions & hashtags** — Gemini multimodal reads uploaded media to write captions; AI-generated, relevance-scored hashtags via `hashtagEnricher` (live IG `ig_hashtag_search` + concise packs). The `/api/ai/hashtags` endpoint powers the generator.

### 📅 Scheduling (per-weekday)
All scheduling runs in a configurable timezone (per brand via `autoPost.timezone`; neutral default **UTC**). Both the Instagram auto-poster and the YouTube auto-poster share the same **per-weekday** model: each weekday can be set to **"Use global"** (inherit the global schedule) or **"Custom"** (override it).

- **Per-day scheduling** — **Settings** lets you configure, **per weekday**, whether to post, how many posts, and at what times — **separately** for the Instagram auto-poster and the YouTube auto-poster. So Mondays can be 3 posts at `08:00 / 13:00 / 19:00` while weekends are off, etc. Days left on **"Use global"** fall back to the global **Publishing Days/Times**.
- **Per-day on/off toggle** — each custom weekday row has an explicit **ON/OFF toggle** to enable or disable publishing on that day, independent of how many posts/times it carries (a day toggled OFF generates nothing).
- **`customScheduleOnly` toggle (per platform)** — when this master toggle is **ON**, days **without** a Custom `dailySchedule` entry generate **nothing**: the global Publishing Days/Times fallback is **disabled** and only your custom-enabled days post. When **OFF** (default) days on "Use global" fall back to the global schedule as usual. Available **separately** for the Instagram and YouTube auto-posters.
- **Per-day Instagram-Reel times** — in **Settings → YouTube**, each custom weekday can set its **OWN Instagram Reel publish time(s)** for the cross-posted Reel. When a day publishes **2+ Shorts**, you add **one Reel time per Short** so each Short's cross-posted Reel maps to its own slot (slots are filled in order). Days left on **"Use global"** fall back to the **global** `reelPublishTimes`.
- **Global vs. per-day (fallback model)** — the top-level **"Instagram Reel publish times"**, **"Publishing Days"**, and **"Publish Times"** are the **GLOBAL** schedule (`scheduleTimes` + `postsPerDay`, and YouTube's `postTimes` + `postsPerDay`). They are used as the **fallback whenever a weekday is set to "Use global"** (unless `customScheduleOnly` is on); the per-day section **overrides** them per weekday, so existing configs keep working unchanged.
- **Separate Instagram-Reel timing (deferred reels)** — when a YouTube Short cross-posts to Instagram as a Reel, the Reel can be **deferred to its own configurable time(s)** — globally, or **per weekday** (one slot per Short on multi-Short days) — independent of the YouTube publish time. The **Short publishes on its own schedule** and the **Reel publishes at the configured reel time**; with no Reel time set the Reel cross-posts **immediately** after the Short.
- **`autoPublish` (Instagram) — heads-up** — when **Settings → Auto-Post → `autoPublish`** is **ON**, auto-generated IG posts publish **immediately at generation time** (`scheduledFor = now`) rather than waiting for the configured slot times. In other words, the per-day/global **publish-times act only as a generation cadence when `autoPublish` is OFF**; with it ON the slot times are bypassed and posts go out as soon as they are generated.

### 📸 Instagram automation
- **Daily auto-posts** — `runAutoGeneratePosts()` generates posts/day per each brand's **Auto-Post** settings (default 2/day), with type + topic rotation, branded image cards, scheduled at your configured per-weekday times/days (or the global fallback). A per-brand daily cap (`postsPerDay`) prevents over-posting (YouTube-only posts don't skew the IG cap).
- **Carousels** — real multi-image carousels (cover + content slides + CTA), published as native IG carousels.
- **Daily auto-story** — one Instagram Story/day on a rotating topic (off by default; enable in Settings → Stories).
- **Large-media direct upload** — the **Media** page uploads big files (100 MB+ videos) **straight to Cloudinary from the browser** (unsigned preset, configured via `GET /api/upload`), then POSTs only the resulting URL + metadata as small JSON. This bypasses the server's multipart body limit, fixing the "Failed to parse body as FormData" crash on large videos; small files still fall back to the legacy server multipart path.
- **Instant comment replies** — webhook-driven replies in under a minute via **Grok Llama-3.3-70B** (resolves the correct quiz answer and gives a real on-topic explanation).
- **Instant DM replies** — webhook + polling fallback, context-aware (reads conversation history).
- **Transparent AI-assistant reply persona** — the comment and DM reply bot identifies as the **account's AI assistant** (built from the brand's niche/voice via `buildBrandPersona`). It never impersonates a specific named human or professional, and when asked "are you a bot/AI/real?" it answers honestly. For anything personal or sensitive it points the follower to a qualified expert.
- **Language mirroring** — both comment and DM replies answer in the **same language and script the person used** (e.g. Hinglish → Hinglish, Devanagari Hindi → Hindi, English → English, mixed → mirror the mix), sounding native rather than translated.
- **Voice-note DMs** — incoming voice note → **Groq Whisper** transcription → AI reply → **Gemini TTS** → sent back as an `.m4a` voice note.

### ▶️ YouTube Shorts automation
- **Independent YouTube auto-poster** — `runAutoGenerateYouTube()` is a *separate* pipeline driven entirely by each brand's **Settings → YouTube**: its own topics, post types, post times, days, and posts-per-day.
- **Every Short is a multi-slide carousel** — `publishPostToYouTubeShort()` → `buildShortForPost()` (`lib/youtubePublish.ts`) builds every Short as a vertical **carousel** video:
  - a fast **~2s curiosity HOOK cover** (an AI-written curiosity-gap line — also set as the **custom YouTube thumbnail**) — front-loaded fast because ~70–90% of viewers swipe in the first ~2s. Hooks and titles are **audit-driven**: they win the first second with a concrete, specific opener and are held to an **anti-fabrication** rule — never inventing or exaggerating a statistic or magnitude claim (use a question or a concrete image when unsure),
  - several **large-text CONTENT slides**, one point per slide (`buildContentSlideSpecs()` splits the post's full content; `CAROUSEL` posts render their authored slides, quiz types get setup/question/options slides and **never** reveal the answer),
  - a **SUBSCRIBE outro** (`lib/hookCard.ts`).
  Length **adapts to the content** — longer card text → longer card → longer Short — capped at YouTube's ~3-min Shorts ceiling (180s); cards stitched into a vertical MP4 via **ffmpeg-static** (`lib/videoGenerator.ts`).
- **A different theme per Short** — a rotating counter cycles through all `THEMES`, so consecutive Shorts are *guaranteed* distinct palettes; the one chosen theme is shared by the hook cover, every content slide, and the outro (cohesive within a Short, varied across Shorts). Cached per `post.id` so re-rendering the same post stays stable.
- **1080×1920 design, 720×1280 render** — cards are designed full-frame vertical 9:16 (**1080×1920**) and the Short renders at **720×1280** H.264 (the memory/CPU-constrained production container can't reliably encode 1080p — it stalls ffmpeg at `frame=0`). Cards are rendered with **satori → SVG → sharp** (NOT raw SVG), because the container's librsvg rejects hand-written SVG strings; satori output rasterizes reliably.
- **AI-written full caption (resilient fallback chain)** — `buildRichCaption()` writes one rich, detailed caption (hook → intro → expanded points → "💡 Why it matters" → dual-account CTA) via a tiered chain — **Gemini flash → Grok → Gemini reasoning** (`generateTextResilient`, with a completeness validator) — so the caption never silently degrades to a thin/truncated result. Generated once and cached per `post.id`, so Instagram and YouTube get byte-identical text.
- **Engagement seed comment on every upload** — after upload, the channel auto-posts a friendly engagement-question top-level comment (`buildSeedComment()`) to kick-start comment velocity (a strong Shorts reach signal). The own-comment skip in the reply bot ignores this seed.
- **Mood-matched music** — Gemini **vision** reads the cover card → picks a mood → **Jamendo** returns a CC-licensed instrumental, mixed under the video (faded) and credited in the description. Best-effort: any failure or missing `JAMENDO_CLIENT_ID` → silent Short.
- **🎙️ AI voiceover + per-card-synced timing (opt-in, default OFF)** — each Short can be narrated by an AI voice and carry TikTok-style burned captions:
  - **`voiceover`** (`Settings → YouTube`, default OFF) — narrates every Short with an AI voice mixed at full volume over the **auto-DUCKED** background music (it becomes the dominant track). **Each card is narrated as its own segment** (hook → each content slide's text → CTA, in card order) and **each card is shown exactly while ITS text is spoken**, so the voice never drifts from the card on screen. The pipeline builds one narration segment per card → **TTS each segment** → **assembles** the clips into one voice track with per-card silence padding (`lib/videoGenerator.ts` `assembleVoiceTrack`) → mixes the voice over the ducked music. Best-effort: any failure **falls back to a single narration + even split, then to the silent music-only Short**, so a Short is never lost.
  - **Length adapts to content + paced by "Seconds per card"** (`secondsPerImage`) — with voiceover ON, each card's full text is narrated, so a card with **long text automatically holds longer** (and the Short grows) while a short card is briefer — the total scales with the content up to the ~3-min (180s) ceiling. "Seconds per card" becomes the **minimum hold per content card**: a card always stays at least that long; if its narration is longer it shows for the full narration; any extra time becomes a short **silence inserted into the audio** so the voice stays in sync. (With voiceover OFF it's simply the fixed per-card duration.)
  - **`voiceoverVoice`** — the narration voice (**Orpheus**): male `daniel` (default), `austin`, `troy`; female `autumn`, `diana`, `hannah`.
  - **`burnCaptions`** (default OFF) — **OFF** → no hardcoded captions, so **YouTube auto-generates AND auto-translates** captions to each viewer's language (the upload now declares `defaultLanguage` / `defaultAudioLanguage = "en"`). **ON** → burns **word-by-word** captions into the video (bundled Geist font `public/fonts/CFSans.ttf` via **libass**; the active word pops **gold + scales** in a lower-middle safe zone) using **Groq Whisper** word-level timestamps (`whisper-large-v3`) → ASS subtitles → a re-encode.
  - **TTS providers** (`lib/tts.ts`; `TTS_PROVIDER` default `groq`, with auto-fallback to the other provider then **Gemini TTS**): **Groq Orpheus** (`canopylabs/orpheus-v1-english`; needs a one-time **org-admin terms acceptance** in the Groq console; tune via `GROQ_TTS_MODEL` / `GROQ_TTS_VOICE`), **Canopy self-hosted** (`CANOPY_TTS_URL` / `CANOPY_TTS_KEY` / `CANOPY_TTS_VOICE`, select with `TTS_PROVIDER=canopy`), and **Gemini TTS** (last-resort).
  - **Cost:** adds one TTS call per Short (plus Whisper + a re-encode **only** when `burnCaptions` is ON) — heavier on memory, which is why both are **opt-in**.
- **AI YouTube search tags** — `buildYouTubeTagsAI()` uses the selected AI provider to generate YouTube-search-optimized keyword tags (distinct from IG reach hashtags), with a deterministic `buildYouTubeTags()` fallback; `uploadShort()` adds the `#` prefix, appends `#Shorts`, and uploads via Data API v3.
- **YouTube comment auto-replies** — `replyToYouTubeComments()` reads recent-video comment threads (and nested replies) and replies with **Grok**, deduped via the `Comment` table and an atomic claim. **Robust own-comment skipping**: it compares the channel id, channel title, and `@handle` so it never replies to itself (including the seed comment). Toggle in **Settings → YouTube**.
- **Per-weekday scheduling** — YouTube posts are scheduled and published by the same catchup loop, routed by `platform`, on the YouTube auto-poster's own per-day plan (see [Scheduling](#-scheduling-per-weekday)).

### 🔁 Cross-posting toggles
- **YouTube → Instagram (Reels) — ✅ ON = cross-posted** — when **Settings → YouTube → Also publish to Instagram (as Reels)** (`publishToInstagram`) is on, each YouTube-native Short is **also** published to Instagram as a **Reel** (`crossPostYouTubeShortToInstagramReel()`) reusing the exact same rendered MP4 — no re-render, identical (cached) rich caption. The Reel can be **deferred to its own time(s)** (see [Scheduling](#-scheduling-per-weekday)); with no Reel time configured it posts immediately after the Short.
- **Instagram → YouTube — ⛔ effectively disabled** — Instagram feed posts are **NOT** cross-posted to YouTube. (Community posts can't be created via the YouTube Data API — there's no endpoint for them.) Instagram posts therefore stay on Instagram; dedicated YouTube content comes from the independent YouTube auto-poster instead.
- **Instagram → Facebook Page (opt-in)** — when **Settings → Auto-Post → Also publish to Facebook Page** (`autoPost.publishToFacebook`, default OFF) is on, each published post is **cross-posted to the linked Facebook Page feed** (`lib/facebook.ts`) — photos via `/{page}/photos`, videos/Reels via `/{page}/videos` — reusing the existing Page access token and the same Cloudinary media (before cleanup). Wired into both the scheduled/auto publish loop and the manual Publish-Now route. Best-effort: a Facebook failure never blocks the Instagram/YouTube publish; Stories are skipped.

### 📝 Unified rich captions
- **Identical caption on both platforms** — `buildRichCaption()` (`lib/richCaption.ts`) builds **one** rich, descriptive caption (hook → intro → expanded key points → "💡 Why it matters" → **dual-account CTA with clickable follow links**) used identically on Instagram and YouTube. It is generated once per post and cached on the post's `reelScript` field (`RICHCAP:`), so whichever platform publishes first pays the AI cost and the other reads byte-identical text.
- **Sized for Instagram's limit** — the AI is instructed to stay under Instagram's **2200-character** caption limit, and `capIgCaption()` (`lib/captionBuilder.ts`) is a safety net that trims the caption if it is ever exceeded.
- **Per-platform hashtags** — the caption itself carries no hashtags; each publisher appends platform-appropriate tags: **Instagram reach hashtags** vs. **AI-generated YouTube search tags** + `#Shorts`.
- **Dual-account CTA with clickable follow links** — a configurable "follow us" block links **both** of the brand's accounts (its YouTube handle + its Instagram handle), with clickable URLs on YouTube. Both handles come from the brand skin.

### 📊 Analytics & notifications
- **Real-time analytics** — live IG followers/reach/top posts/engagement from the Graph API (synced to the DB), plus YouTube channel + per-video stats from the Data API, surfaced on Overview + Analytics.
- **Daily health email** — health digest via Resend/Nodemailer: system health (DB / AI / Instagram), **Instagram webhook delivery status**, today's story status, **today's YouTube posts**, today's auto-generated posts, upcoming scheduled posts, 24h stats, failures, and rate-limit events.
- **Morning Digest (configurable daily summary)** — an opt-in **once-a-day email summarising the last 24 hours across Instagram + YouTube** (`lib/morningDigest.ts` + `sendMorningDigestEmail`). In **Settings → Morning Digest** you set a master toggle, the **send time (IST)**, and per-section toggles for what's included: IG insights/comments/published/followers, YouTube insights/comments/published/subscribers, plus top performer, auto-engagement, today's schedule, failures, growth deltas, system health, and AI usage. Polled from `instrumentation.ts`, self-gated to the configured IST hour, once per day; settings round-trip through the notifications blob.
- **Activity + live alerts** — every publish/reply/topic-use logged to `ActivityLog`; real-time alerts stream over SSE (`/api/notifications/stream`) and email (publish, fail, YouTube published/failed, comment replied).

---

## 👥 Multi-Account (Brands)

InstaPilot controls **multiple paired Instagram + YouTube "brand" accounts**. A *brand* = one Instagram account + one YouTube channel that run together, **each with its own brand skin** (name, niche, persona, handles).

- **Primary brand** — the account seeded from environment variables. It always exists, always resolves its credentials from **ENV** (env wins; brand-row columns are only a fallback), and **cannot be deleted**. This preserves the exact original single-account behaviour. Its brand skin lives in the `Preferences` singleton.
- **Add more brands** — in **Settings → Accounts**, click **Add Account** and paste that account's credentials:
  - **Instagram:** access token · business-account ID · username · (optional) Facebook Page ID
  - **YouTube:** client ID · client secret · refresh token
  - Non-primary brands store their credentials **and brand skin** in their own `Brand` row (`lib/brands.ts`).
- **Per-brand everything** — each brand has its **own** brand skin, settings, AI prompts, automation schedule, topics, and post types (stored in `Brand.settings`; the primary uses the `Preferences` singleton). The automation engine runs the **full pipeline independently for every active brand** every cycle.
- **Brand switcher** — a switcher in the dashboard header (plus an **"All accounts"** aggregate) scopes every page to the selected brand. Media publishing asks which account to publish to.
- **Data isolation** — `Post` / `ScheduledPost` / `Comment` / `Analytics` rows carry a `brandId`. A `null` brandId means "the primary brand"; non-primary brands are matched by their exact id, so each brand's content and analytics stay isolated.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 16** (App Router) + React 18, request gate in **`proxy.ts`** |
| Language | TypeScript 5 |
| Styling | Tailwind CSS + glassmorphism, Framer Motion, Radix UI, Recharts |
| Content AI | **Grok first** (Groq Llama-3.3-70B), then **Google Gemini** model-fallback chain |
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
- **`youtubeVideoId`** is stored on both `ScheduledPost` and `Post`; every YouTube path re-reads the freshest value before uploading, so retries never double-post.
- **Claim lock + timestamped reaper** — `publishOverdueScheduled` and the manual route both atomically flip a `PENDING` `ScheduledPost` to `FAILED("__CLAIMING__")`; only the caller that gets `count===1` proceeds. The claim-lock **embeds a timestamp**, and the **reaper resets stale claims by that embedded claim time** (older than ~10 min) — **not** by the row's `createdAt` — so genuinely-stuck claims recover while in-flight ones are left alone, stopping duplicate posts.
- **Render lock (OOM guard)** — a **process-wide single-flight queue** wraps the **entire memory-heavy build** (card render + music + ffmpeg) for **both** the YouTube Short build **and** the IG carousel render, so only **one** render is ever in memory at a time on memory-limited hosts. A 120s watchdog still SIGKILLs any wedged ffmpeg render.
- **JSON-resilient AI** — content-JSON generation tries the selected provider then **falls through to the other** on empty/quota-exhaustion responses (429 / `limit:0`), so Stories, IG posts, and Shorts never silently degrade to canned filler when a provider's free quota is gone.
- **Passed slots publish today** — if a day's slot time has already passed when the auto-generator runs, the post is scheduled for **now (today)** instead of being pushed to tomorrow — fixing over-generation and the "N posts at one time" same-time collision (in **both** the IG and YouTube generators).
- **AI fallback chains** everywhere; graceful degradation (silent Shorts, silent-Short voiceover fallback, default mood, branded fallback replies).

### Instagram events: webhook + polling
Real-time events arrive at `/api/webhooks/instagram` (HMAC-verified) for instant replies; the catchup loop's `fetchMissedComments()` / `replyMissedDMs()` provide a polling fallback for anything missed. Webhook subscription is **auto-ensured on startup**: the app-level + IG object-level fields are `comments` / `messages` / `mentions` (+ `story_insights`), and the **Page** object is auto-bound to `feed,messages,mention` via `POST /{page-id}/subscribed_apps`. That Page binding is what actually makes Meta deliver events and **requires a Page token with the `pages_manage_metadata` scope** — without it the bind is rejected and real-time delivery silently never starts (the polling fallback still works).

---

## ⚙️ Settings Reference

Settings persist per brand (`lib/preferences.ts`): the **Primary** brand uses the `Preferences` singleton row (id `"singleton"`); every other brand stores the same shape in its `Brand.settings`. They survive restarts. Every field below is wired into the automation, **per brand**.

### Brand (`Settings → Brand`)
| Field | Controls |
|-------|----------|
| `appName` | The product/app name shown in the UI |
| `niche` | Your topic/niche — injected into every AI generation |
| `persona` / voice | The AI's persona/voice for content + replies |
| `igHandle` | Instagram `@handle` used in CTAs/watermarks |
| `ytHandle` / `ytChannelName` | YouTube `@handle` + channel name used in CTAs/outros |
| `dualFollowCTA` | The dual-account "follow us" CTA text/links |

### Content Types (`Settings → Content Types`)
Rename the **user-facing label** of each fixed content slot (the internal ID is preserved so data never breaks). Labels flow into the generator, cards, and captions.

### AI (`Settings → AI`)
| Field | Controls |
|-------|----------|
| `aiProvider` | Active content provider: `grok` \| `gemini` (Grok still tried first for content JSON; conversations always use Grok) |
| `defaultTone` | Default content tone |
| `defaultType` | Default post type in the generator |
| `language` | Output language |
| `geminiApiKey` | Gemini key stored in DB (env `GEMINI_API_KEY` takes priority) |

### Auto-Post (`Settings → Auto-Post`)
| Field | Controls |
|-------|----------|
| `enabled` | Master switch for daily IG post generation |
| `postsPerDay` | 1–3 posts/day |
| `postTypes[]` | Which post types may be generated |
| `topics[]` | Rotating topic list (auto-expands when exhausted) |
| `scheduleDays[]` | **Publishing Days** — the **GLOBAL** days to run (0=Sun … 6=Sat); used as the fallback for any day on "Use global" |
| `scheduleTimes[]` | **Publish Times** — the **GLOBAL** publish times (e.g. `["08:00","19:00"]`); used as the fallback for any day on "Use global" |
| `dailySchedule[]` | **Per-day overrides** — per weekday → **ON/OFF toggle** · how many posts · at what times. Each Custom day **overrides** the global `postsPerDay` / `scheduleTimes`; days left on **"Use global"** fall back to them. |
| `customScheduleOnly` | When **ON**, only days with a Custom `dailySchedule` entry post — days without one generate **nothing** (the global Publishing Days/Times fallback is disabled). Default **OFF**. |
| `timezone` | Schedule timezone (neutral default `UTC`) |
| `autoPublish` | When **ON**, auto-generated posts publish **immediately at generation time** (`scheduledFor = now`) instead of waiting for the slot times — the publish-times act as a generation cadence only when this is **OFF**. |

### Stories (`Settings → Stories`)
| Field | Controls |
|-------|----------|
| `enabled` | Auto-post one story/day (off by default) |
| `postTime` | `HH:MM` (default `09:00`) |
| `scheduleDays[]` | Which days to post |
| `topics[]` | Rotating story topics |
| `customPromptExtra` | Extra prompt instructions |

### YouTube (`Settings → YouTube`)

**YouTube settings reference** — every field that drives the **independent YouTube auto-poster** (per brand):

| Setting | What it does |
|---------|--------------|
| `enabled` | Master switch for the **independent YouTube auto-poster + Grok comment replies** |
| `privacy` | Uploaded Short privacy: `public` \| `unlisted` \| `private` |
| `postsPerDay` | YouTube auto-posts/day (1–5) — **GLOBAL**, used as the fallback for any day on "Use global" |
| `postTimes[]` | **Publish Times** — the **GLOBAL** Short publish times (`HH:MM`); used as the fallback for any day on "Use global" |
| `scheduleDays[]` | **Publishing Days** — the **GLOBAL** days the poster runs (0=Sun … 6=Sat); used as the fallback for any day on "Use global" |
| `dailySchedule[]` | **Per-day overrides** — per weekday → **ON/OFF toggle** · how many posts · at what times · **own Instagram Reel time(s)** (`reelTimes`, below). Each Custom day **overrides** the global `postsPerDay` / `postTimes` / Reel times; days on "Use global" fall back to them. |
| `dailySchedule[].reelTimes[]` | **Per-day Instagram Reel time(s)** for *this weekday's* cross-posted Reel. On days with **2+ Shorts**, add **one Reel time per Short** so each Reel maps to its own slot (filled in order). Empty → fall back to the global `reelPublishTimes`. |
| `reelPublishTimes[]` | **GLOBAL** Instagram Reel publish time(s) for cross-posted Reels — the fallback whenever a weekday is on "Use global". Empty → cross-post the Reel immediately after the Short. |
| `customScheduleOnly` | When **ON**, only weekdays with a Custom `dailySchedule` entry post — days without one generate **nothing** (the global Publishing Days/Times fallback is disabled). Default **OFF**. |
| `publishToInstagram` | **YouTube → Instagram cross-post:** each YouTube Short is also published to Instagram as a **Reel** (deferred per the Reel times above, else immediate). |
| `secondsPerImage` | Seconds each content slide shows (2–15, default 5; hook ≈2s, outro ≈3s) |
| `voiceover` | **AI voiceover (default OFF)** — narrate each Short with an AI voice over the **auto-ducked** music; each card is narrated as its own segment and shown exactly while its text is spoken (per-card sync). Length adapts to the content (≤180s); `secondsPerImage` becomes the **minimum** hold per card. Falls back to single-narration even split, then the silent music-only Short. |
| `voiceoverVoice` | Narration voice (**Orpheus**): male `daniel` (default), `austin`, `troy`; female `autumn`, `diana`, `hannah` |
| `burnCaptions` | **Word-by-word captions (default OFF)** — **OFF** lets YouTube auto-generate + auto-translate captions per viewer (upload declares `defaultLanguage`/`defaultAudioLanguage = "en"`); **ON** burns TikTok-style word-by-word captions (Groq Whisper `whisper-large-v3` timestamps → ASS → re-encode, active word pops gold) |
| `descriptionSuffix` | Appended to every YouTube description (e.g. channel CTA) |
| `replyToComments` | Grok auto-replies to comments on the channel's videos, skipping its own (default on) |
| `topics[]` | Topics the **independent** YouTube poster writes about |
| `postTypes[]` | Post types the YouTube poster may publish |
| `customPromptExtra` | Extra prompt instructions appended for YouTube generation |

Live connection status (Connected / channel name) is returned by `GET /api/settings/youtube` via `checkYouTubeHealth()`.

### Notifications (`Settings → Notifications`)
| Field | Controls |
|-------|----------|
| `notificationEmail` | Recipient for digests/alerts (falls back to `NOTIFICATION_EMAIL` env) |
| `emailPublish` | Email on publish |
| `emailFails` | Email on failures |
| `emailAnalytics` | Email analytics / daily digest |
| `pushPublish` / `pushComments` / `pushWeeklyReport` | In-app/push notification toggles |

Other tabs: **Accounts** (add/edit/enable/delete brands — see [Multi-Account](#-multi-account-brands)), **Prompts** (per-post-type system-prompt overrides + per-account default IG/YouTube content prompts), **Account / Instagram / Webhook / Danger** (tokens, webhook subscription, destructive actions). The Brand, Content Types, AI Config, Auto-Post, Stories, YouTube, Prompts, and Instagram tabs are scoped to the brand selected in the header switcher.

---

## 🚀 Setup / Installation

### Prerequisites
- Node.js 20+, a PostgreSQL database, and accounts/keys for Groq, Gemini, Meta (Instagram/Facebook), Cloudinary, Resend, and (optionally) YouTube + Jamendo. **All keys are your own — none are bundled.**

### Local development
```bash
npm install
cp .env.example .env.local        # fill in the variables below
npm run db:generate && npm run db:push
npm run dev                        # http://localhost:3000
```

Then log in with your `APP_ACCESS_KEY`, open **Settings → Brand** and set your app name, niche, and handles — you're now running in your own niche.

### Run with Docker (no Node setup needed)
```bash
cp .env.example .env              # fill in your keys
docker compose up -d              # app + PostgreSQL
# app on http://localhost:3000
```

### NPM scripts
```bash
npm run dev           # dev server (Turbo, port 3000)
npm run build         # prisma generate && next build
npm run start         # production server
npm run lint          # ESLint
npm run db:push       # push Prisma schema
npm run db:generate   # regenerate Prisma client
npm run db:studio     # Prisma Studio GUI
npm run youtube:auth  # one-command YouTube OAuth → prints YOUTUBE_REFRESH_TOKEN
```

### Environment variables
✅ = required, – = optional.

| Variable | Req | Description |
|----------|-----|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `APP_ACCESS_KEY` | ✅ | Access key gating the dashboard login |
| `SESSION_SECRET` | ✅ | HMAC secret for the auth session cookie (verified in `proxy.ts`) |
| `BRAND_NAME` | – | Default app/brand name fallback (also overridable in Settings → Brand) |
| `NEXT_PUBLIC_APP_NAME` | – | Public app name shown in the browser/title |
| `NEXT_PUBLIC_APP_URL` | – | Public app URL |
| `GROK_API_KEY` | ✅ | Groq key — comments, DMs, Whisper, content (tried first), YouTube descriptions |
| `GROK_API_URL` | – | Default `https://api.groq.com/openai/v1` |
| `AI_MODEL_MAIN` | – | Main Groq model (`llama-3.3-70b-versatile`) |
| `AI_MODEL_FAST` | – | Fast Groq fallback (`llama-3.1-8b-instant`) |
| `GEMINI_API_KEY` | ✅ | Gemini key — content fallback, vision, TTS, music mood |
| `GEMINI_MODEL` | – | Optional override pinning the start of the Gemini chain |
| `INSTAGRAM_ACCESS_TOKEN` | ✅ | Long-lived IG user token |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | ✅ | IG Business account ID |
| `INSTAGRAM_USERNAME` | – | Account handle (self-reply suppression) |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | ✅ | **Page** token — required to send/read DMs |
| `FACEBOOK_PAGE_ID` | ✅ | Linked Facebook Page ID |
| `FACEBOOK_APP_ID` | ✅ | Meta app ID |
| `FACEBOOK_APP_SECRET` | ✅ | Meta app secret — **also used to verify webhook HMAC** |
| `WEBHOOK_VERIFY_TOKEN` | ✅ | Instagram webhook verification token (any random string you choose) |
| `CLOUDINARY_CLOUD_NAME` | ✅ | Media hosting (images + audio) |
| `CLOUDINARY_UPLOAD_PRESET` | ✅ | Unsigned upload preset |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | – | For deleting media after publish |
| `RESEND_API_KEY` | ✅ | Daily report + alert emails |
| `RESEND_FROM` | – | From address for Resend |
| `NOTIFICATION_EMAIL` | ✅ | Default report recipient |
| `DM_AUTO_REPLY` | – | Fallback DM text when AI is unavailable |
| `YOUTUBE_CLIENT_ID` | – | OAuth client ID (only if YouTube is enabled) |
| `YOUTUBE_CLIENT_SECRET` | – | OAuth client secret |
| `YOUTUBE_REFRESH_TOKEN` | – | Long-lived channel refresh token (upload + readonly + force-ssl + yt-analytics) |
| `YOUTUBE_CHANNEL_ID` | – | Channel ID — display only |
| `JAMENDO_CLIENT_ID` | – | Free Jamendo client ID — enables vision-selected background music |
| `FFMPEG_PATH` | – | Override path to an ffmpeg binary (fallback if `ffmpeg-static` is missing) |
| `TTS_PROVIDER` | – | Voiceover TTS provider: `groq` (default) \| `canopy` — auto-falls back to the other provider, then Gemini TTS |
| `GROQ_TTS_MODEL` | – | Groq Orpheus TTS model (default `canopylabs/orpheus-v1-english`) |
| `GROQ_TTS_VOICE` | – | Default Groq Orpheus voice (overridden per brand by `voiceoverVoice`) |
| `CANOPY_TTS_URL` | – | Self-hosted Canopy TTS endpoint (used when `TTS_PROVIDER=canopy`) |
| `CANOPY_TTS_KEY` | – | Auth key for the self-hosted Canopy TTS endpoint |
| `CANOPY_TTS_VOICE` | – | Default voice for the self-hosted Canopy TTS endpoint |

> `isYouTubeConfigured()` is true only when `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REFRESH_TOKEN` are all set. Without all three, every YouTube path silently no-ops and Instagram is unaffected. Without `JAMENDO_CLIENT_ID`, Shorts render silently (no music). `FACEBOOK_PAGE_ACCESS_TOKEN` must be a **Page** token (from `GET /me/accounts`), not a User token.

### Enabling YouTube (one-time OAuth)
InstaPilot authenticates to YouTube with a long-lived **refresh token** (no interactive login at runtime).

1. **Enable the API** — Google Cloud Console → APIs & Services → Library → "YouTube Data API v3" → Enable.
2. **OAuth consent screen** → User type **External** → publishing status **In production** (NOT Testing — Testing-status refresh tokens expire in 7 days).
3. **Credentials → Create OAuth client ID → Desktop app** → copy the Client ID + Secret.
4. **Mint the refresh token** from the project root:
   ```bash
   YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy npm run youtube:auth
   # or: node scripts/youtube-auth.mjs --id xxx --secret yyy
   ```
   It opens the consent screen, catches the localhost redirect automatically, and prints `YOUTUBE_REFRESH_TOKEN`. Authorize with the Google account that **owns the channel**. Scopes: `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`, `yt-analytics.readonly`.
5. Set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` (and optionally `YOUTUBE_CHANNEL_ID`) in `.env.local` / your host.
6. (Optional) Set `JAMENDO_CLIENT_ID` for background music.
7. Open **Settings → YouTube**, confirm "Connected", configure topics/times/days, and **Save**.

> The free YouTube Data API quota (10,000 units/day) allows ~6 uploads/day (`videos.insert` ≈ 1,600 units each).

---

## ☁️ Deployment

### Option A — Railway (Nixpacks)
```bash
railway up --detach          # build + deploy
railway logs --tail 40       # live logs
railway status               # confirm "Online", not "Deploy failed"
railway variables --kv       # list env vars
```

- **Build:** `prisma generate && next build` (`postinstall` also runs `prisma generate`). Push schema changes with `npm run db:push`.
- **Fonts + ffmpeg:** `nixpacks.toml` installs the fonts the Satori card renderer needs and ensures ffmpeg is available; ffmpeg is primarily bundled via `ffmpeg-static`. If the bundled binary doesn't survive a build, install a system ffmpeg (`NIXPACKS_PKGS=ffmpeg`) and/or set `FFMPEG_PATH`.
- **Database URL note:** use Railway's **`DATABASE_PUBLIC_URL`** when connecting/migrating from outside Railway's private network (e.g. local `db:push` against the hosted DB); the in-cluster app uses the private `DATABASE_URL`.
- **Healthcheck:** `/api/health` (public for uptime probes) reports DB / AI / Instagram status.
- **Typecheck before every deploy** — Railway keeps the old build running if the new one fails to compile:
  ```bash
  node_modules/.bin/tsc --noEmit
  ```

### Option B — Docker / Docker Compose (self-host anywhere)
```bash
cp .env.example .env
docker compose up -d --build     # app + PostgreSQL + (optional) Redis
docker compose logs -f app
```
The bundled `Dockerfile` builds a standalone Next.js image; `docker-compose.yml` provisions PostgreSQL and wires `DATABASE_URL` automatically. Set your keys in `.env` before bringing it up.

### One-time Instagram webhook setup
1. Set `WEBHOOK_VERIFY_TOKEN` (any random string).
2. Meta App → Webhooks → Instagram → Callback `https://<app>/api/webhooks/instagram`, same verify token.
3. Subscribe to **comments**, **messages**, **mentions**, **story_insights**.
4. Ensure the IG account has Messaging permissions (App Review for non-tester DMs).

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
│   ├── ai-factory.ts          # Picks active provider (Grok | Gemini)
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

## 🔒 Security

- **Access-key login.** The dashboard is gated by `APP_ACCESS_KEY`. `POST /api/auth/login` validates the key and sets a signed session cookie (signed/verified with `SESSION_SECRET`).
- **Session gate on everything** (`proxy.ts`). Every page **and every `/api` route** is checked against the session cookie. Unauthenticated page requests redirect to `/login`; unauthenticated API requests get `401 JSON`. (`getServerSession` is a local no-op, so this gate is the real protection for API routes.)
- **Public allowlist only:** `/login`, `/api/auth/login`, `/api/webhooks` (Meta has no cookie — guarded by HMAC instead), `/api/health` (uptime probes), plus static asset paths (`/_next`, `/favicon`, `/fonts`, `/images`).
- **Webhook HMAC verification.** `/api/webhooks/instagram` verifies Meta's `X-Hub-Signature-256` against `FACEBOOK_APP_SECRET` before processing any payload.
- **Security headers** (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) on every authenticated/public response.
- **No bundled secrets.** Ship the zip safely — every credential is supplied by the operator via env/Settings; nothing is hard-coded.

---

## License

Provided for use by the licensed operator. Configure your own brand in **Settings → Brand** and supply your own API keys. All third-party API usage (Meta, Groq, Google, Cloudinary, Jamendo, Resend) is subject to those providers' terms.
