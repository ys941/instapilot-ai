// lib/session.ts
// Pure Web-Crypto session — works in Next.js Edge middleware AND Node.js API routes.

export const SESSION_COOKIE  = "cf_auth";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET ?? "";
  if (!s) throw new Error("SESSION_SECRET env var is not set");
  return s;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

/** Create a signed session token. */
export async function createSessionToken(): Promise<string> {
  const payload = btoa(JSON.stringify({ iat: Date.now() }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const key = await importKey(getSecret());
  const sig = b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${sig}`;
}

/** Verify a session token. Returns true if valid. */
export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 0) return false;
    const payload = token.slice(0, dot);
    const sigB64  = token.slice(dot + 1);
    const key = await importKey(getSecret());
    // Re-compute expected signature
    const expected = b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
    if (sigB64.length !== expected.length) return false;
    // Constant-time compare
    let diff = 0;
    for (let i = 0; i < sigB64.length; i++) diff |= sigB64.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}
