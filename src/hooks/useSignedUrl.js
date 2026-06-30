/**
 * useSignedUrl — returns a fresh signed URL for a file in
 * Supabase Storage, given its storage_path.
 *
 * Why a hook (and not just reading row.file_url directly)?
 *   - Signed URLs in our setup are valid for 7 days (see
 *     SIGNED_URL_TTL_SEC in supabaseStorage.js). After that, the URL
 *     in the DB returns 401 and the image breaks silently.
 *   - For rows that have a storage_path, we can transparently refresh
 *     the URL on each read without ever persisting the new one — which
 *     keeps the DB clean and makes the URL effectively never-expire from
 *     the user's perspective.
 *
 * Usage:
 *
 *   // Modern (preferred for new code):
 *   const { url, loading } = useSignedUrl(row.storage_path);
 *   <img src={url} alt="" />
 *
 *   // Backward-compat: legacy rows have a base64 in `file_url` and no
 *   // `storage_path`. Fall through to that:
 *   const { url } = useSignedUrl(row.storage_path, { fallback: row.file_url });
 *
 * Caching:
 *   Resolved URLs are cached in memory for 6 days (TTL is 7, we leave
 *   24 hours of slack). Cache key is the storage_path. Multiple
 *   components mounting `useSignedUrl(samePath)` therefore share one
 *   network round-trip per app session.
 */
import { useEffect, useRef, useState } from 'react';
import { refreshSignedUrl } from '@/lib/supabaseStorage';

// Module-level cache. Persists for the lifetime of the app session.
// Map<storage_path, { url: string, expiresAt: number }>
const urlCache = new Map();

// 6 days in ms — 24h shy of the actual signed-URL TTL.
const CACHE_TTL_MS = 6 * 24 * 60 * 60 * 1000;

function getCachedUrl(path) {
  const entry = urlCache.get(path);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    urlCache.delete(path);
    return null;
  }
  return entry.url;
}

function setCachedUrl(path, url) {
  urlCache.set(path, { url, expiresAt: Date.now() + CACHE_TTL_MS });
}

export default function useSignedUrl(storagePath, options = {}) {
  const { fallback = null } = options;

  // Initial state: cached URL if hot, fallback otherwise. This avoids
  // a flash of empty <img> on first render when the data is already
  // available synchronously.
  const [url, setUrl] = useState(() => getCachedUrl(storagePath) || fallback || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Track the in-flight request so a fast remount with the same path
  // doesn't double-fetch.
  const lastRequestedPathRef = useRef(null);

  useEffect(() => {
    if (!storagePath) {
      // No path → either a legacy row (use fallback) or an empty cell.
      setUrl(fallback || null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    const cached = getCachedUrl(storagePath);
    if (cached) {
      setUrl(cached);
      setLoading(false);
      setError(null);
      return undefined;
    }

    // Avoid a redundant refresh if the path matches the one we already
    // have in flight (StrictMode double-invokes this effect in dev).
    if (lastRequestedPathRef.current === storagePath) return undefined;
    lastRequestedPathRef.current = storagePath;

    let cancelled = false;
    setLoading(true);
    setError(null);

    refreshSignedUrl(storagePath)
      .then((fresh) => {
        if (cancelled) return;
        setCachedUrl(storagePath, fresh);
        setUrl(fresh);
      })
      .catch((err) => {
        if (cancelled) return;
        // On failure, fall back to whatever the row had (legacy base64
        // OR a stale persisted signed URL). Better a probably-broken
        // image than a definitely-broken empty src.
        setError(err?.message || 'signed URL refresh failed');
        setUrl(fallback || null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [storagePath, fallback]);

  return { url, loading, error };
}

/**
 * Imperative variant for code that's not inside a React component
 * (e.g. a service worker, a download helper, a one-off util). Same
 * cache as the hook above — calls share results.
 */
export async function getSignedUrl(storagePath) {
  if (!storagePath) return null;
  const cached = getCachedUrl(storagePath);
  if (cached) return cached;
  const fresh = await refreshSignedUrl(storagePath);
  setCachedUrl(storagePath, fresh);
  return fresh;
}
