/**
 * Host-allowlist validator for server-fetched media URLs (SSRF guard).
 *
 * The app stores a caller-supplied mediaUrl at upload time and the SERVER later
 * fetches it at publish (verifyImageUrl / fetchBytes / fetchUrlToBuffer). Without
 * a guard, a caller could point that URL at an internal service or cloud metadata
 * endpoint (169.254.169.254) and have the server fetch it — a classic SSRF.
 *
 * We allow only:
 *   - res.cloudinary.com           (our media CDN)
 *   - *.cdninstagram.com           (Instagram-served media)
 *   - files.catbox.moe             (free CDN fallback used by the app)
 *   - the app's own host           (NEXT_PUBLIC_APP_URL — local /uploads fallback)
 * and reject everything else, plus any non-http(s) scheme and any host that is a
 * private / link-local / loopback IP literal.
 */

// Exact hosts and suffix-matched host groups we trust.
const ALLOWED_EXACT_HOSTS = new Set<string>([
  "res.cloudinary.com",
  "files.catbox.moe",
]);
const ALLOWED_HOST_SUFFIXES = [
  ".cdninstagram.com",
];

/** The app's own host, derived from NEXT_PUBLIC_APP_URL (for the local /uploads fallback). */
function appHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True for an IPv4/IPv6 literal that is loopback, private, link-local, or otherwise
 *  not a public routable address. Hostnames (DNS names) return false here. */
function isPrivateIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // IPv4 dotted quad
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const o = m.slice(1).map(Number);
    if (o.some((n) => n > 255)) return true; // malformed → reject
    const [a, b] = o;
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 127) return true;                      // loopback
    if (a === 0) return true;                        // 0.0.0.0/8
    if (a === 169 && b === 254) return true;         // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT 100.64.0.0/10
    if (a >= 224) return true;                       // multicast / reserved
    return false;
  }

  // IPv6 loopback / link-local / unique-local
  const lower = h.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true;        // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc.) — extract the tail and re-check
  const mapped = lower.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpLiteral(mapped[1]);

  return false;
}

/** Validate a media URL for server-side fetching. Returns ok=false with a reason
 *  when the URL is not on the allowlist or targets a private/link-local address. */
export function validateMediaUrl(raw: string): { ok: boolean; reason?: string } {
  if (!raw || typeof raw !== "string") return { ok: false, reason: "empty URL" };

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `scheme '${u.protocol}' not allowed (http/https only)` };
  }

  const host = u.hostname.toLowerCase();

  if (isPrivateIpLiteral(host)) {
    return { ok: false, reason: "host is a private/link-local/loopback address" };
  }

  if (ALLOWED_EXACT_HOSTS.has(host)) return { ok: true };
  if (ALLOWED_HOST_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s))) return { ok: true };
  const own = appHost();
  if (own && host === own) return { ok: true };

  return { ok: false, reason: `host '${host}' is not on the media allowlist` };
}
