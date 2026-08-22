# Security Policy

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Email **ys9410017064@gmail.com** with what you found and how to reproduce it. You'll get
an acknowledgement, and a fix or an explanation. Please allow a few days before
disclosing publicly.

You'll be credited for the report unless you'd rather not be.

## What's in scope

InstaPilot AI is **self-hosted** — you run it, on your infrastructure, with your own API keys.
There's no service to attack, so "in scope" means the code in this repository:

- Anything that could leak an operator's API keys, tokens or session
- Bypassing the access-key gate on the dashboard
- Prompt injection that makes the bot act against its operator — inbound comments and
  DMs are treated as **untrusted input** by design, so a hole there is a real bug
- Anything that could publish, delete or reply on an account without the operator's intent

## What's not

- Vulnerabilities in third-party services (report those to the provider)
- Missing hardening on *your own* deployment — exposing it to the internet without an
  access key, reusing a weak `SESSION_SECRET`, or committing your `.env`
- The attribution check in `lib/attribution.ts`. It's a request, not a security control,
  and it's meant to be easy to find

## Handling your own keys

No API keys ship with this repository. `.env.example` is entirely blank, `.env*` is
gitignored, and secrets are write-only in the settings UI — the browser is told *that* a
key is set, never what it is.

If you think you've committed a key, rotate it at the provider first, then clean history.
