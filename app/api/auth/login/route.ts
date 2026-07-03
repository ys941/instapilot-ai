import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

// ── Per-IP in-memory failed-attempt limiter ──────────────────────────────────
// Slows down brute-force key enumeration. Best-effort (per process; resets on
// restart) — enough to make online guessing impractical without a datastore.
const MAX_FAILURES = 8;
const WINDOW_MS    = 10 * 60 * 1000; // 10 minutes
const _attempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Returns true if this IP is currently over the failure limit. */
function isRateLimited(ip: string): boolean {
  const rec = _attempts.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) { _attempts.delete(ip); return false; }
  return rec.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = _attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    _attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    rec.count++;
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many failed attempts. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const { key } = await request.json();

    const appKey = process.env.APP_ACCESS_KEY;
    if (!appKey) {
      return NextResponse.json({ error: "Server misconfiguration: APP_ACCESS_KEY not set." }, { status: 500 });
    }

    // Constant-time comparison to prevent timing attacks
    if (!key || key.length !== appKey.length || !constantTimeEqual(key, appKey)) {
      recordFailure(ip);
      // Always wait a short time to prevent timing-based key enumeration
      await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
      return NextResponse.json({ error: "Invalid access key." }, { status: 401 });
    }

    // Success — clear any accumulated failures for this IP.
    _attempts.delete(ip);

    const token = await createSessionToken();
    const res   = NextResponse.json({ success: true });

    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   SESSION_MAX_AGE,
      path:     "/",
    });

    return res;
  } catch (err) {
    console.error("[Login] Error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
