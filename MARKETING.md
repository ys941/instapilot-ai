<div align="center">

# 🚀 InstaPilot AI

### Your entire content team for **Instagram + YouTube** — automated, for *any* niche

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
  <img alt="Docker ready" src="https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
</p>

<a href="https://railway.com/new"><img src="https://railway.com/button.svg" alt="Deploy on Railway" height="44" /></a>

**One AI brain. Two platforms. Zero daily effort.**
Posts, carousels, Stories, Shorts, Reels, comments, DMs — all on autopilot.

</div>

---

## 💡 The idea

Running a serious Instagram **and** YouTube presence is two full-time jobs: ideate, write, design, render, schedule, cross-post, and then answer every comment and DM — every day, on both platforms, forever.

**InstaPilot AI collapses all of that into one app.** It writes the content, designs the visuals, builds the videos, publishes to both platforms on your schedule, cross-posts Shorts to Reels, and replies to your audience — including **voice-note DMs** — in a niche and voice you choose, on accounts that are entirely yours.

> A writer, a designer, a video editor, and a 24/7 community manager — working both platforms at once, from a single dashboard you control.

---

## ✨ Why it's different

- **🎨 Truly white-label, zero code.** App name, niche, persona, account handles, content-type labels — all from the **Settings UI**. Re-skin it for cooking, fitness, finance, anything, in minutes.
- **📱 + ▶️ Two platforms, one brain.** Native Instagram posts, carousels, and Stories **and** vertical YouTube Shorts — written once, published everywhere, with identical rich captions.
- **🔁 Smart cross-posting.** Turn a YouTube Short into an Instagram Reel automatically — same render, on its own deferred schedule.
- **🎙️ AI voiceover + auto-translated captions.** Give every Short a natural AI narration over auto-ducked music, and let YouTube auto-translate your captions into every viewer's language — or burn TikTok-style word-by-word captions right into the video. Reach a global audience, hands-free.
- **🤖 Real conversations.** Auto-replies to Instagram comments and DMs (even **voice notes → transcribed → spoken reply**) and YouTube comments — context-aware, in your voice, never to itself.
- **🧠 Two AI brains, never stalls.** Grok *and* Gemini with automatic fallback chains.
- **🏢 Run a whole network.** Many paired Instagram + YouTube brands from one dashboard, each independent.
- **🔑 Your keys, your data, your accounts.** Bring your own API keys. Self-host on Railway or Docker.

---

## 🎬 What happens every day — automatically

For each brand (a paired Instagram + YouTube account), on the schedule you set:

1. **🧪 Invents topics** — from your rotating list, auto-expanded by AI so content never repeats.
2. **✍️ Writes the content** — hooks, body, CTA, hashtags — in your niche and voice.
3. **🎨 Designs the visuals** — branded image cards, multi-image **carousels**, and a daily **Story**.
4. **🎞️ Builds the Shorts** — vertical multi-slide videos (hook → content → subscribe outro) with mood-matched music, AI search tags, and optional AI voiceover + word-by-word captions.
5. **📤 Publishes everywhere** — native IG posts/carousels/Stories and YouTube Shorts, on a per-weekday schedule.
6. **🔁 Cross-posts** — Shorts become Instagram Reels on their own timing (opt-in).
7. **💬 Engages** — instant replies to IG comments & DMs (incl. voice notes) and YouTube comments.
8. **📊 Reports** — syncs analytics for both platforms and emails a daily health digest.

You mostly just watch the dashboard.

---

## 🧠 Architecture at a glance

A single, self-healing automation loop runs your entire content operation — no external cron, no queues, no babysitting.

```
  ┌──────────────────────── In-process engine (every ~5 min, per brand) ─────────────────────┐
  │                                                                                            │
  │  runCatchup()  ──▶  for each ACTIVE brand (own credentials · own brand skin · own plan):    │
  │                       ├─ 📸 generate today's IG posts / carousels / Story                   │
  │                       ├─ 🎬 generate today's YouTube Shorts                                 │
  │                       ├─ 📤 publish everything due  →  IG  ·  YouTube  ·  cross-posted Reel  │
  │                       ├─ 💬 reply to IG comments + DMs (text & voice)                        │
  │                       └─ 💬 reply to YouTube comments (never to itself)                      │
  │                                                                                            │
  │  Webhooks  ──▶  instant comment / DM replies        Daily timer  ──▶  health digest email   │
  └──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Multi-tenant by design** — every brand runs the full pipeline independently with isolated data.
- **Idempotent & self-healing** — atomic claim-locks stop double-posting, a reaper recovers stuck jobs, AI fallback chains keep content flowing, and an ffmpeg watchdog guards every render.
- **Real-time + resilient** — Instagram webhooks deliver instant replies, with a polling fallback so nothing is ever missed.

---

## 🎥 How content is made

```
  IDEA ─▶ SCRIPT ─▶ CARDS / CAROUSEL ─▶ (video) SHORT ─▶ CAPTION + TAGS ─▶ PUBLISH ─▶ ENGAGE
  (AI)    (AI)      (Satori + Sharp)    (ffmpeg+music)   (AI, shared)       IG + YT     (AI)
```

Visuals render server-side with **Satori → SVG → Sharp** (container-proof), videos assemble through a hardened **ffmpeg** pipeline, and one rich AI caption is shared byte-for-byte across Instagram and YouTube. Every stage degrades gracefully — the system never blocks on a single failure.

---

## 🧰 Built with

| | |
|---|---|
| **Framework** | Next.js 16 (App Router) · React 18 · TypeScript |
| **AI** | Grok (Groq Llama-3.3-70B) + Google Gemini · Whisper (voice) · Gemini TTS |
| **Media** | Satori + Sharp (cards) · ffmpeg (Shorts) · Jamendo (music) · Cloudinary (hosting) |
| **Platforms** | Instagram/Facebook Graph API + webhooks · YouTube Data API v3 |
| **Data** | PostgreSQL + Prisma · TanStack Query |
| **Delivery** | Resend (email) · in-process automation engine |
| **Deploy** | Railway (Nixpacks) or Docker |

---

## ⚡ Get started

```bash
# Docker — app + Postgres in one command
cp .env.example .env          # add your own API keys
docker compose up -d --build  # → http://localhost:3000
```

Then log in, open **Settings → Brand**, set your app name / niche / handles, connect your accounts, and set your schedule — live in your own niche **without touching a line of code.**

<div align="center">

### 🚂 One-click deploy

<a href="https://railway.com/new"><img src="https://railway.com/button.svg" alt="Deploy on Railway" height="44" /></a>

*Railway-ready out of the box — Postgres plugin, auto-migrations, health checks, and ffmpeg/fonts all pre-configured.*

</div>

> 📚 **Full setup, API-key sourcing, environment variables, multi-account, scheduling, deployment, and troubleshooting:** see the **[full README](README.md)**.

---

## 📄 License

Proprietary. Configure your own brand and supply your own API keys. Third-party usage (Meta, Groq, Google/YouTube, Cloudinary, Jamendo, Resend) is subject to those providers' terms.

<div align="center">
<sub>One dashboard. Two platforms. Your whole content operation, automated. 🚀</sub>
</div>
