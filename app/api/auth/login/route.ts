import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    const { key } = await request.json();

    const appKey = process.env.APP_ACCESS_KEY;
    if (!appKey) {
      return NextResponse.json({ error: "Server misconfiguration: APP_ACCESS_KEY not set." }, { status: 500 });
    }

    // Constant-time comparison to prevent timing attacks
    if (!key || key.length !== appKey.length || !constantTimeEqual(key, appKey)) {
      // Always wait a short time to prevent timing-based key enumeration
      await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
      return NextResponse.json({ error: "Invalid access key." }, { status: 401 });
    }

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
