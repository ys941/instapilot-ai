# Installation & Deployment

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

> **Windows one-click launcher** — `start-all.bat` brings the whole stack up in one step: it checks Docker, starts **PostgreSQL + Redis** via Compose, waits for the DB, runs `prisma generate` + `db push`, launches the Next.js dev server, opens the dashboard, and (optionally, if `NGROK_AUTHTOKEN` is set) starts an ngrok tunnel for Meta webhooks.

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

