<div align="center">

# 🤝 Contributing to InstaPilot AI

### Come help build the content team that never sleeps.

<p>
  <img src="https://img.shields.io/badge/contributions-welcome-2ea44f?style=for-the-badge" />
  <img src="https://img.shields.io/badge/first%20timers-friendly-7C3AED?style=for-the-badge" />
  <img src="https://img.shields.io/badge/stack-Next.js%20%C2%B7%20TypeScript%20%C2%B7%20Prisma-0EA5E9?style=for-the-badge" />
</p>

**Every good idea here started as somebody being annoyed by something.**<br />
If something in this project irritates you, that's not a complaint — that's a contribution waiting to happen.

</div>

---

## 🌱 Start here — you don't need permission

You do **not** need to be an AI expert, a video engineer, or a Meta API veteran to help.
Most of what makes this project better is ordinary, careful software work.

| If you enjoy… | You'll like working on… |
|---|---|
| 🎨 **Design & CSS** | The dashboard themes, the mobile layout, the calendar view, the onboarding flow |
| ✍️ **Words** | Prompts, error messages, docs, the setup guide — plain language beats clever language |
| 🧩 **TypeScript** | The scheduler, the retry logic, the publishing queue, type-safety gaps |
| 🎞️ **Media** | The Shorts renderer, caption timing, image cards, music mixing (ffmpeg) |
| 🔌 **APIs** | Instagram / YouTube / Facebook Graph integrations, webhook handling |
| 🧪 **Testing** | Almost anything — coverage is thin and that's an honest invitation |
| 🌍 **Languages** | Caption translation, non-English replies, right-to-left layouts |

> **New to open source?** Open an issue that just says what confused you.
> A clear description of "I got stuck here" is genuinely useful work, and it's how most
> of this project's rough edges get found.

---

## 🚀 Get it running in five minutes

**You need:** Node.js 20+, a PostgreSQL database, and a package manager. That's it to boot the UI.

```bash
git clone https://github.com/ys941/instapilot-ai.git
cd instapilot-ai
npm install
cp .env.example .env.local     # fill in DATABASE_URL, APP_ACCESS_KEY, SESSION_SECRET
npm run db:push                # create the schema
npm run dev                    # http://localhost:3000
```

<details>
<summary><b>🔑 Which environment variables do I actually need?</b></summary>

<br />

To **explore the dashboard and work on UI**, four variables are enough:

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Your Postgres connection string |
| `APP_ACCESS_KEY` | The key you type to get past the login gate |
| `SESSION_SECRET` | Any long random string |
| `ATTRIBUTION_ACK` | Set to `https://github.com/ys941` — the server won't start without it ([why](#-attribution)) |

Everything else in `.env.example` — AI providers, Instagram, YouTube, Cloudinary — is only
needed for the feature it powers. **You never need working social accounts to contribute to
the interface, the docs, the scheduler logic, or the tests.**

No keys are bundled with this repo, and none are required to read the code.

</details>

<details>
<summary><b>🗺️ Where does everything live?</b></summary>

<br />

```
app/          Next.js routes — dashboard pages and API endpoints
lib/          The actual brain: generation, scheduling, publishing, replies
components/   Shared UI
prisma/       Database schema
scripts/      One-off tools (e.g. YouTube OAuth helper)
generated/    Runtime output — gitignored, safe to delete
```

Start in `lib/` if you want to understand how a post gets made. Start in `app/` if you
want to change what a human sees.

</details>

<details>
<summary><b>🧰 Useful commands</b></summary>

<br />

| Command | Does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build (runs `prisma generate` first) |
| `npm run lint` | ESLint |
| `npm run db:push` | Push schema changes to your database |
| `npm run db:studio` | Browse your data in Prisma Studio |

</details>

---

## 🧭 How we work

**Small and shipped beats big and perfect.** A twenty-line PR that fixes one real annoyance
is worth more here than a redesign that stalls.

1. **Open an issue first** for anything larger than a bug fix — it saves you building
   something that's already half-built on a branch somewhere.
2. **Branch** from `main`: `fix/duplicate-reply`, `feat/carousel-templates`, `docs/setup`.
3. **Keep the diff honest.** Unrelated reformatting makes review slow and hides real changes.
4. **Match the surrounding code.** This codebase has opinions; follow the ones you find
   in the file you're editing rather than importing your own.
5. **Run `npm run lint` and `npm run build`** before you push. If the build breaks, say so
   in the PR rather than leaving it to be discovered.
6. **Describe the *why*.** "What" is visible in the diff. "Why" is not.

### ✅ A pull request that gets merged quickly

- Does one thing
- Says what it changes and what it deliberately doesn't
- Includes a screenshot or clip if it touches the UI
- Notes what you tested, honestly — *"tested locally, didn't test the YouTube path"* is a
  perfectly good sentence and far better than silence

---

## ⭐ Attribution

This project is free to use, fork, self-host, rebrand and build a business on. There is
one condition, and it is deliberately small:

**Credit to the original author stays visible.**

- The dashboard footer links to [@ys941](https://github.com/ys941). The app name above it
  is fully white-label and follows your Brand settings — the author credit is not.
- The server runs two checks at start-up: `ATTRIBUTION_ACK="https://github.com/ys941"`
  must be set in your environment, **and** the footer must still contain the credit.
  Strip the credit and the app refuses to boot. Nothing is transmitted — both checks
  are local.

This is **clause 2 of the [licence](LICENSE)**, so it applies whether or not the check
is present — deleting the check in [`lib/attribution.ts`](lib/attribution.ts) does not
remove the obligation. A purely private deployment nobody else uses is exempt.

Full detail on what you may and may not do: [COPYRIGHT.md](COPYRIGHT.md).

---

## 🔐 Rules that aren't negotiable

This project holds API keys, publishes to real accounts, and answers real people. A few
things matter more than convenience:

| | |
|---|---|
| 🚫 **Never commit secrets** | No `.env`, no tokens, no keys — not even "temporarily", not even in a test fixture. `.env.example` stays blank. |
| 🎭 **Stay white-label** | No niche, brand, handle or personal detail may be hardcoded. If it describes a *particular* account, it belongs in configuration, not in the code. |
| 🛡️ **Treat inbound messages as untrusted** | Comments and DMs are user input. They must never be able to steer a reply, leak a prompt, or trigger an action. |
| ⚕️ **Don't let it give advice** | The bot never diagnoses, never prescribes, and always defers to a qualified human. Keep it that way. |
| 🔁 **Don't break idempotency** | It must not publish twice, reply to itself, or lose its place after a crash. If you touch the scheduler or the queue, prove it still recovers. |

> **Found a security issue?** Please don't open a public issue.
> Email **ys9410017064@gmail.com** and give it a little time before disclosing.

---

## 💡 Ideas looking for an owner

Genuinely open — no one is working on these:

- 🧪 **A test suite.** There isn't a meaningful one. Starting it is high-value and very welcome.
- 🌍 **More languages** for replies and captions beyond English / Hindi / Hinglish.
- 📊 **Better analytics** — the dashboard reports what happened; it doesn't yet suggest what to do next.
- ♿ **Accessibility** — keyboard navigation and screen-reader support across the dashboard.
- 🔌 **Another platform** — LinkedIn? Threads? The publishing layer is deliberately pluggable.
- 📦 **A one-command Docker setup** that a non-developer could actually follow.
- 📝 **Documentation.** Every "how do I…?" you had to answer yourself is a doc someone else needs.

---

## 🙏 A note on tone

This started as one person learning to build, after hours, on a two-core laptop. It's not a
polished corporate codebase and it doesn't pretend to be. You **will** find things that are
odd, over-engineered, or plainly wrong.

Say so — kindly, and with a suggestion. That's the whole deal.

Be patient with reviews, be generous with beginners, and assume the person on the other
side is doing their best with the time they have.

<div align="center">

<br />

**Thank you for even reading this far.** 🤍

<sub>Questions? Open a <a href="https://github.com/ys941/instapilot-ai/issues">discussion or an issue</a> — no question is too small.</sub>

</div>
