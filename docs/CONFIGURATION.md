# Configuration

Every setting and environment variable. For a 4-command quickstart see the [README](../README.md).

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

### AI Setup (`Settings → AI Setup`)
Set up a whole brand by **describing it**. Groq asks the questions it needs, then generates the full config (brand skin + Instagram/YouTube handles + channel name + dual-follow CTA, content-type labels & which to enable, topic seeds, per-weekday schedule, persona/tone/language, and default prompts). Review the preview, then **Apply** to persist it (per brand) — or refine each area in the tabs below. Toggle to **Manual** for the hand-configured path (unchanged).

### Content Types (`Settings → Content Types`)
Rename the **user-facing label** of each fixed content slot (the internal ID is preserved so data never breaks). Labels flow into the generator, cards, and captions.

### AI (`Settings → AI`)
| Field | Controls |
|-------|----------|
| `contentChain` | **Content lane** — ordered `provider · model` fallback chain for posts/captions/hooks/stories (providers: `grok` \| `cerebras` \| `gemini`) |
| `replyChain` | **Reply lane** — ordered fallback chain for comment + DM auto-replies |
| `visionChain` | **Vision lane** — ordered fallback chain for image/video analysis (**`gemini`/`groq` only**) |
| `cerebrasApiKey` | Cerebras key stored in DB (env `CEREBRAS_API_KEY` takes priority) |
| `geminiApiKey` | Gemini key stored in DB (env `GEMINI_API_KEY` takes priority) |
| `defaultTone` | Default content tone |
| `defaultType` | Default post type in the generator |
| `language` | Output language |
| `aiProvider` | *(legacy)* single content provider — retained for back-compat; superseded by `contentChain` |

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
| `targetShortSeconds` | **Short length** — target Short duration: `15` \| `20` \| `30` \| `45` \| `60`s (default **30**). Paces the cards toward this target while still adapting to the content; hard-capped at 180s. |
| `secondsPerImage` | Seconds each content slide shows (2–15, default 5; hook ≈2s, outro ≈3s) — the per-card **minimum**; `targetShortSeconds` sets the overall target |
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

Other tabs: **Accounts** (add/edit/enable/delete brands — see [Multi-Account](FEATURES.md#-multi-account-brands)), **Appearance** (pick one of 10 app-wide themes; per-device), **Prompts** (per-post-type system-prompt overrides + per-account default IG/YouTube content prompts), **Account / Instagram / Webhook / Danger** (tokens, webhook subscription, destructive actions). The Brand, Content Types, AI Config, Auto-Post, Stories, YouTube, Prompts, and Instagram tabs are scoped to the brand selected in the header switcher.

---


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
| `CEREBRAS_API_KEY` | – | Cerebras key for the per-task AI Config chains (can also be set in Settings → AI) |
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

