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

const CACHE_VERSION = 'cr-v1';
const APP_SHELL = `${CACHE_VERSION}-shell`;
const ASSETS    = `${CACHE_VERSION}-assets`;
const TILES     = `${CACHE_VERSION}-tiles`;
const IMAGES    = `${CACHE_VERSION}-images`;

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL).then((cache) => cache.addAll(SHELL_URLS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

// ── Activate: purge stale cache versions ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
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

function isHashedAsset(url) {
  // Vite outputs /assets/foo-abc123.js — safe to cache aggressively
  return url.pathname.startsWith('/assets/') && /-[A-Za-z0-9_]{6,}\.(js|css|woff2?|ttf)$/.test(url.pathname);
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

// Network-first with cache fallback — used for the app shell
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    return hit || cache.match('./index.html') || Response.error();
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
  if (req.mode === 'navigate' || (req.destination === '' && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(networkFirst(req, APP_SHELL));
    return;
  }

  // Fallthrough — network only
});

// Allow the page to tell the SW to activate immediately after a new deploy
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
