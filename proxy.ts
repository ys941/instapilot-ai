import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";

// Only these are reachable WITHOUT a valid access-key session.
// NOTE: `/api/` as a whole is intentionally NOT public — getServerSession is a
// local no-op, so every other /api route must be gated by the session cookie here.
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",     // validates the access key + sets the cookie
  "/api/webhooks",       // Meta calls this with no cookie — guarded by HMAC instead
  "/api/health",         // Railway healthcheck / uptime probes
  "/_next",
  "/favicon",
  "/fonts",
  "/images",
  // PWA assets must be publicly reachable so the app is installable even when
  // logged out (Chrome "Install app" / Safari "Add to Home Screen").
  "/manifest.webmanifest",
  "/sw.js",
  "/icon-",              // icon-192.png / icon-512.png / icon-maskable-512.png
  "/apple-touch-icon",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p) || pathname.startsWith(p + "?"));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always add security headers
  const secHeaders = {
    "X-Frame-Options":           "SAMEORIGIN",
    "X-Content-Type-Options":    "nosniff",
    "Referrer-Policy":           "strict-origin-when-cross-origin",
    "Permissions-Policy":        "camera=(), microphone=(), geolocation=()",
  };

  // Let public paths through immediately
  if (isPublic(pathname)) {
    const res = NextResponse.next();
    Object.entries(secHeaders).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }

  // Check session cookie
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? "";

  if (!token || !(await verifySessionToken(token))) {
    // API routes → 401 JSON
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Pages → redirect to login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated — pass through with security headers
  const res = NextResponse.next();
  Object.entries(secHeaders).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
