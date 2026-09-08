/**
 * CarReminder Service Worker — basic offline support for web users.
 *
 * Strategy:
 *   - App shell (index.html, manifest, icons)  → cache-first, update in background
 *   - Built JS/CSS chunks                       → cache-first (hashed filenames = safe)
 *   - Supabase / gov.il / any API calls         → network-only (no stale auth data)
 *   - Leaflet tiles                             → cache-first with short TTL
 *
 * Skipped entirely on Capacitor native (the app loads from file:// and ships
 * its assets in-app, so there's nothing for a SW to do there).
 */

// Bump on each release that changes Vite chunk names. The activate
// handler purges any cache whose name doesn't start with this prefix,
// so existing browsers will discard stale `cr-v1-*` entries on next
// visit and re-fetch fresh assets that match the new index.html.
const CACHE_VERSION = 'cr-v6-4-2';
const APP_SHELL = `${CACHE_VERSION}-shell`;
const ASSETS    = `${CACHE_VERSION}-assets`;
const TILES     = `${CACHE_VERSION}-tiles`;
const IMAGES    = `${CACHE_VERSION}-images`;

const SHELL_STATIC = [
  './manifest.json',
  // Match the actual filenames on disk (public/icons/icon-<size>x<size>.png).
  // Earlier versions referenced ./icons/icon-192.png which doesn't exist —
  // pre-cache silently 404'd and the shell-cache stayed incomplete.
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
];

/**
 * Pre-cache index.html TOGETHER WITH the exact assets it references.
 *
 * Why this exists (diagnosed 2026-09-08 on the staging preview): an offline
 * reload showed the green boot splash forever. The console named the cause —
 * `assets/index-*.css` and `assets/vendor-charts-*.js` failed with
 * ERR_INTERNET_DISCONNECTED while the main JS chunk loaded fine. The cached
 * index.html was from one deploy and the cached assets from another, so the
 * document asked for hashes that had never been stored. The assets cache held
 * 160 entries including THREE different versions of some chunks.
 *
 * Runtime cache-first can never guarantee that pairing: it only stores what a
 * page happened to request, so any deploy leaves a partial, mixed set. Parsing
 * the freshly-fetched index.html and storing it alongside its own assets makes
 * the two a matched set by construction.
 *
 * Never rejects. If anything here fails we fall back to caching the static
 * shell alone, which is exactly today's behaviour — degraded, never worse.
 */
/**
 * Store one index.html together with the assets IT references.
 *
 * Shared by install and by every successful online navigation, so the pair
 * stays matched by construction rather than by luck.
 */
async function storeMatchedShell(html) {
  const shell = await caches.open(APP_SHELL);
  await shell.put('./index.html', new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }));

  // Both forms appear depending on Vite base: /assets/... and ./assets/...
  const refs = [...new Set(
    [...html.matchAll(/["'](\.?\/assets\/[^"']+)["']/g)].map((m) => m[1]),
  )];
  const assets = await caches.open(ASSETS);
  // Individually guarded: one 404 must not discard the whole set, which is
  // what cache.addAll would do.
  await Promise.all(refs.map(async (u) => {
    try {
      const r = await fetch(new Request(u, { cache: 'no-cache' }));
      if (r.ok) await assets.put(u, r);
    } catch { /* runtime cache-first may still pick it up */ }
  }));
}

/**
 * Fill the asset cache from the build manifest, in the background.
 *
 * storeMatchedShell only caches what index.html REFERENCES, which is enough
 * to boot but not to navigate: the app code-splits per route, so this build
 * emits ~258 assets while index.html names 6. Without this, opening a page
 * offline that was never visited online finds no chunk, Suspense hangs, and
 * the 8s recovery reloads straight into the same failure.
 *
 * A worker cannot list a directory, so scripts/build-precache-manifest.cjs
 * writes the list at build time (postbuild).
 *
 * Sequential on purpose: 258 parallel requests would be hostile on mobile.
 * Skips anything already cached, so a redeploy only fetches what changed.
 * Silently gives up on any failure — this is an enhancement, and half a
 * cache is still better than none.
 */
async function fillPrecacheFromManifest() {
  let list;
  try {
    const res = await fetch(new Request('./precache-manifest.json', { cache: 'no-cache' }));
    if (!res.ok) return;
    list = await res.json();
  } catch { return; }
  if (!Array.isArray(list)) return;

  const cache = await caches.open(ASSETS);
  for (const u of list) {
    try {
      if (await cache.match(u)) continue;
      const r = await fetch(new Request(u, { cache: 'no-cache' }));
      if (r.ok) await cache.put(u, r);
    } catch { /* keep going; one missing chunk is not fatal */ }
  }
}

async function precacheMatchedShell() {
  // `cache: 'reload'` bypasses the HTTP cache so we parse what is actually
  // deployed, not a copy the browser is still holding.
  const res = await fetch(new Request('./index.html', { cache: 'reload' }));
  if (!res.ok) throw new Error('shell fetch ' + res.status);
  await storeMatchedShell(await res.text());
}

// ── Install: pre-cache the shell and its matching assets ────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      await precacheMatchedShell();
    } catch {
      // Degrade to the previous behaviour rather than failing the install: a
      // service worker that refuses to install leaves the user with no offline
      // support at all.
    }
    try {
      const shell = await caches.open(APP_SHELL);
      await shell.addAll(SHELL_STATIC.map((u) => new Request(u, { cache: 'reload' })));
    } catch { /* icons/manifest missing must not block install */ }
    await self.skipWaiting();
  })());
});

// ── Activate: purge stale cache versions ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
      // Background top-up. Pages are already claimed, so this delays
      // nothing the user is waiting on.
      .then(() => fillPrecacheFromManifest())
  );
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function isApiRequest(url) {
  return url.hostname.includes('supabase.co')
      || url.hostname.includes('data.gov.il')
      || url.pathname.startsWith('/gov-api');
}

function isMapTile(url) {
  return url.hostname.includes('tile.openstreetmap.org')
      || url.hostname.includes('overpass-api.de');
}

// Vite emits /assets/foo-abc123.js — safe to cache aggressively.
//
// The character class MUST include `-`. Vite hashes are base64url-ish and
// routinely contain one (vendor-charts-BmoagQ-n.js, index-DFKz-CwQ.css), and
// the earlier /-[A-Za-z0-9_]{6,}./ rejected exactly those: they fell through
// to the network-only branch, were never cached, and offline they failed —
// which is why the app hung on the boot splash with no connection. Diagnosed
// 2026-09-08 from a staging console: the three files that failed were the
// three this predicate did not recognise.
function isHashedAsset(url) {
  // Vite outputs /assets/foo-abc123.js — safe to cache aggressively
  return url.pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]{6,}\.(js|css|woff2?|ttf)$/.test(url.pathname);
}

function isImage(url) {
  return /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(url.pathname);
}

// Cache-first with network fallback — used for static assets
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return hit || Response.error();
  }
}

/**
 * Navigations: network-first, cache fallback to the ONE canonical shell.
 *
 * Two deliberate differences from the generic networkFirst this replaces:
 *
 * 1. It does NOT store a copy per route. Doing that is what produced the bug
 *    this was fixed for: /Dashboard cached from one deploy and assets from
 *    another, so offline the document asked for hashes that had never been
 *    stored, and the app hung on the boot splash. This is a single-page app,
 *    so one index.html answers every route; a per-route copy adds nothing but
 *    a chance to disagree with the assets.
 *
 * 2. On a successful online navigation it refreshes index.html TOGETHER with
 *    the assets that exact HTML references. Without this the matched set is
 *    only ever written at install, and install re-runs when sw.js changes,
 *    NOT when the app is redeployed, so offline users would be pinned to
 *    whatever version was current the last time this file was edited. The
 *    page is fetching those assets anyway, so the refresh is nearly free.
 */
async function navigationStrategy(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      // Background: this must never delay the navigation itself.
      copy.text().then((html) => storeMatchedShell(html)).catch(() => {});
    }
    return res;
  } catch {
    const shell = await caches.open(APP_SHELL);
    return (await shell.match('./index.html')) || Response.error();
  }
}

// ── Fetch router ────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GETs (POST/PUT etc. should always go to the network)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't touch chrome-extension:// and other non-http schemes
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never cache auth/data calls — stale user data is worse than an error
  if (isApiRequest(url)) return; // let the browser handle it normally

  // Map tiles: cache-first (they rarely change)
  if (isMapTile(url)) {
    event.respondWith(cacheFirst(req, TILES));
    return;
  }

  // Hashed assets (JS/CSS/fonts): cache-first forever
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(req, ASSETS));
    return;
  }

  // Same-origin images: cache-first
  if (url.origin === self.location.origin && isImage(url)) {
    event.respondWith(cacheFirst(req, IMAGES));
    return;
  }

  // Navigation requests (HTML): network-first so updates are picked up fast
  // manifest.json is pre-cached at install but matched no branch here, so it
  // was served network-only and failed offline (it appeared as repeated
  // ERR_INTERNET_DISCONNECTED for manifest.json). Serve it from the cache.
  if (url.origin === self.location.origin && url.pathname.endsWith('/manifest.json')) {
    event.respondWith(cacheFirst(req, APP_SHELL));
    return;
  }

  // Navigation requests (HTML): network-first so updates are picked up fast.
  if (req.mode === 'navigate' || (req.destination === '' && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(navigationStrategy(req));
    return;
  }

  // Fallthrough — network only
});

// Allow the page to tell the SW to activate immediately after a new deploy
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
