# Security model


- **Access-key login.** The dashboard is gated by `APP_ACCESS_KEY`. `POST /api/auth/login` validates the key and sets a signed session cookie (signed/verified with `SESSION_SECRET`).
- **Session gate on everything** (`proxy.ts`). Every page **and every `/api` route** is checked against the session cookie. Unauthenticated page requests redirect to `/login`; unauthenticated API requests get `401 JSON`. (`getServerSession` is a local no-op, so this gate is the real protection for API routes.)
- **Public allowlist only:** `/login`, `/api/auth/login`, `/api/webhooks` (Meta has no cookie — guarded by HMAC instead), `/api/health` (uptime probes), plus static asset paths (`/_next`, `/favicon`, `/fonts`, `/images`).
- **Webhook HMAC — fail-closed.** `/api/webhooks/instagram` verifies Meta's `X-Hub-Signature-256` against `FACEBOOK_APP_SECRET` before processing any payload; if the secret is unset it **rejects** rather than processing, and the signature-check bypass switch is gated to non-production only.
- **Login brute-force protection.** The access-key login uses a constant-time compare **plus** a per-IP rate limiter (≈8 failed attempts / 10 min → `429`), so the single shared `APP_ACCESS_KEY` can't be guessed at speed.
- **SSRF guard on media URLs.** User-supplied `mediaUrl`s the server later fetches are validated against a host allowlist (Cloudinary / IG CDN / catbox / the app's own host) and reject private, link-local, and loopback addresses (`lib/urlSafety.ts`).
- **No secret echo.** Diagnostic routes return booleans/redacted values only — the webhook verify-token and Facebook Page access tokens are never sent back in a response body.
- **Security headers** (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) on every authenticated/public response.
- **No bundled secrets.** Ship the zip safely — every credential is supplied by the operator via env/Settings; nothing is hard-coded.

---

