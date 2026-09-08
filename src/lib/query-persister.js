/**
 * IndexedDB persistence for the React Query cache — the mechanism behind
 * offline READS. Full design: docs/offline-architecture-spec.md §4.
 *
 * Why IndexedDB and not localStorage: the persisted set spans vehicles,
 * documents and service history across many accounts. localStorage is
 * synchronous and ~5MB, so it would both block paint and overflow.
 *
 * Why this works on native too: Capacitor loads the app from
 * https://localhost (Android) / capacitor://localhost (iOS) — real secure
 * origins, so IndexedDB behaves normally. It needs no Service Worker, which
 * matters because the SW is skipped entirely on native.
 *
 * Treat the persisted cache as BEST-EFFORT and disposable: iOS can evict
 * script-writable storage after ~7 idle days, and a private window may refuse
 * it outright. Losing it degrades to a cold fetch — today's behavior — so
 * nothing here may ever block boot or throw into the app.
 */
import { get, set, del } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { isPersistableQueryKey } from './query-persist-allowlist';

const IDB_KEY = 'cr-rq-cache';

/**
 * How old a persisted snapshot may be and still be restored.
 *
 * MUST be <= the default gcTime in query-client.js (24h), or restored queries
 * get garbage-collected before they can be used. It is also deliberately far
 * below the 7-day signed-URL TTL, as a second line of defence behind the
 * URL-stripping below.
 */
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

// WKWebView has a long-standing bug where an IndexedDB open can hang forever
// after the app is backgrounded or killed mid-transaction. Every IDB call is
// therefore raced against a short timeout that RESOLVES (never rejects) —
// mirroring the proven raceWithFallback pattern in lib/supabase.js. A wedged
// IndexedDB must degrade to "no cache", not to a stalled first paint.
const IDB_TIMEOUT_MS = 2500;
function race(promise, fallback) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise(resolve => setTimeout(() => resolve(fallback), IDB_TIMEOUT_MS)),
  ]);
}

/**
 * Fields that must NEVER reach disk, stripped from every persisted row.
 *
 * The allowlist decides WHICH QUERIES may be persisted. This decides which
 * COLUMNS may be, because a query can be worth caching while still carrying a
 * field that must not sit on disk. Both are needed: an audit found three cases
 * where a forbidden value rode in on an otherwise-legitimate query.
 *
 * 1. EXPIRING URLS. Rows carry a signed URL (7-day TTL) next to a durable
 *    `*_storage_path`. Persisting the URL is a time bomb: offline we cannot
 *    re-sign it, so an expired URL renders as a broken image or a dead link,
 *    precisely when offline reading is the point. Keeping only the path means
 *    the URL is re-derived online and degrades to a placeholder offline.
 *
 * 2. AUTHORIZATION VERDICTS. `role` arrives on `user-workspaces`, which must be
 *    persisted or the app cannot resolve a workspace offline at all. But `role`
 *    is the app's permission source (it gates member removal, role changes,
 *    owner-only and manager-only screens), and caching a permission verdict to
 *    disk is exactly what the allowlist forbids. Stripping it is fail-closed:
 *    `activeWorkspace?.role ?? null` makes every capability check false, so
 *    offline you get read-only affordances, which is correct since every
 *    role-gated action is an online-required command anyway. Business-vs-
 *    personal UI is unaffected because it reads `account_type`, not `role`.
 *    `share_count` / `is_shared_with_me` / `share_role` are the same story on
 *    `my_vehicles_v`: `vehicle-share-info` was kept OUT of the allowlist
 *    because shareCount decides whether deleting a vehicle cascades to every
 *    sharee, and these columns would have smuggled the same values back in.
 *
 * 3. THIRD-PARTY PII. Accident rows carry the OTHER driver's name and phone,
 *    plus the witnesses. `user-profile` is excluded from the allowlist for the
 *    user's own PII; someone else's contact details deserve at least that. The
 *    accident record itself (date, damage, status) still persists.
 */
const STRIPPED_FIELDS = [
  // 1. expiring signed URLs (the durable *_storage_path is kept)
  'vehicle_photo', 'file_url', 'extra_file_urls',
  'receipt_url', 'license_photo_url', 'image_url',
  // 2. authorization verdicts
  'role', 'share_count', 'is_shared_with_me', 'share_role',
  // 3. third-party PII
  'other_driver_name', 'other_driver_phone', 'witnesses',
];

function stripSignedUrls(value) {
  if (Array.isArray(value)) return value.map(stripSignedUrls);
  if (!value || typeof value !== 'object') return value;
  // Date/Map/etc. would be mangled by a naive rebuild; Supabase rows are plain
  // objects (timestamps arrive as ISO strings), so guard anyway.
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;

  let next = value;
  for (const field of STRIPPED_FIELDS) {
    if (field in next) {
      if (next === value) next = { ...value };
      delete next[field];
    }
  }
  for (const [k, v] of Object.entries(next)) {
    if (v && typeof v === 'object') {
      const stripped = stripSignedUrls(v);
      if (stripped !== v) {
        if (next === value) next = { ...value };
        next[k] = stripped;
      }
    }
  }
  return next;
}

export const idbPersister = createAsyncStoragePersister({
  key: IDB_KEY,
  // Coalesce writes: a data-heavy screen can settle several queries at once,
  // and each write re-serializes the whole snapshot.
  throttleTime: 1000,
  storage: {
    getItem:    (k) => race(get(k), null),
    setItem:    (k, v) => race(set(k, v), undefined),
    removeItem: (k) => race(del(k), undefined),
  },
  // Strip signed URLs on the way out, and never let a serialization failure
  // (e.g. QuotaExceeded on iOS) escape into the app.
  serialize: (client) => {
    try {
      return JSON.stringify(stripSignedUrls(client));
    } catch {
      return '';
    }
  },
  deserialize: (cached) => {
    try {
      return cached ? JSON.parse(cached) : undefined;
    } catch {
      return undefined;
    }
  },
});

/** Only successful, allowlisted reads are written to disk. */
export function shouldDehydrateQuery(query) {
  return query.state.status === 'success' && isPersistableQueryKey(query.queryKey);
}

/**
 * Wipe the cache on an identity boundary — sign-out, account switch, entering
 * or leaving admin view-as, account deletion.
 *
 * It clears MEMORY FIRST, then disk, and that order is the whole point.
 *
 * Deleting only the IndexedDB key does not work, and this was reproduced: the
 * persister subscribes to query-cache changes and writes on a 1s throttle, so
 * with the previous identity's rows still sitting in memory, the very next
 * cache activity — a query mounting on the login screen, a GC tick, a failed
 * refetch, or simply a write that was already throttled when the clear ran —
 * re-persists that data straight back to disk. The teardown appeared to work
 * and then silently undid itself.
 *
 * Clearing memory first means any write that lands afterwards can only persist
 * an empty snapshot. Callers that already call queryClient.clear() themselves
 * are unaffected; clearing twice is harmless. Keeping both halves inside this
 * one function is deliberate, so a future call site cannot get the order wrong.
 */
export async function clearPersistedCache() {
  // Imported lazily: this module is loaded from contexts that sit outside the
  // React tree, and a static import would couple them to the client instance.
  try {
    const { queryClientInstance } = await import('./query-client');
    queryClientInstance.clear();
  } catch { /* best effort — the disk wipe below still runs */ }
  try { await race(del(IDB_KEY), undefined); } catch { /* best effort */ }
}
