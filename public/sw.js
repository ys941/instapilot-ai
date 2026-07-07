/* Service worker — minimal & safe.
 * Its only jobs: satisfy PWA installability (a fetch handler) and cache
 * IMMUTABLE static assets for faster loads / basic offline shell.
 * It never caches /api/* or HTML pages, so no private or stale data is served. */
const STATIC_CACHE = "app-static-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Cache-first ONLY for fingerprinted/immutable static assets.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    /\.(?:png|svg|ico|webp|woff2?)$/.test(url.pathname);

  if (!isStatic) return; // everything else → default network handling

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
  );
});
