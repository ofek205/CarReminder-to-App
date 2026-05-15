/**
 * useUpdateAvailable — non-blocking "newer version exists in store" hook.
 *
 * Sister to useAppUpdateGate. Same data shape, soft semantics:
 *
 *   useAppUpdateGate  → currentVersion < `*_min_version`    → hard block
 *   useUpdateAvailable → currentVersion < `*_latest_version` → soft nudge
 *
 * The admin updates `android_latest_version` / `ios_latest_version` in
 * `app_config` after each release is approved by the store. Users on
 * older versions see a dismissible banner; users on the latest see
 * nothing.
 *
 * Behavior matrix (from the ux skill spec):
 *   • Web (Capacitor.isNative === false)        → never show
 *   • Native + flag fetch fails (no cache)      → never show
 *   • Native + cached value < 24h stale         → use cached
 *   • Native + latest_version IS NULL           → never show
 *   • Native + latest <= currentVersion         → never show (steady state)
 *   • Native + latest >  currentVersion         → snooze check → maybe show
 *   • Snoozed (within 3 days of dismissal)      → never show
 *   • AppUpdateGate hard-block is active        → not our concern; the
 *                                                  gate fully replaces
 *                                                  children, so the
 *                                                  banner never renders
 *
 * The 24h flag cache rides on top of the natural app_config caching to
 * survive a Supabase blip without nuking the banner. The hook reads
 * cache synchronously on mount for an instant initial state, then
 * refreshes from the server in the background.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isNative } from '@/lib/capacitor';

const SNOOZE_KEY      = 'update_banner_snoozed_until';   // ISO timestamp
const CACHE_KEY       = 'update_banner_flag_cache';       // { value, ts }
const CACHE_TTL_MS    = 24 * 60 * 60 * 1000;              // 24 hours
const SNOOZE_DAYS     = 3;
const FIRST_SHOW_DELAY_MS = 2500;                          // settle time after boot

// Same comparator the hard-block gate uses. Copy rather than re-export
// because that file's default-export-only structure would force a
// larger refactor for one shared util.
function compareVersions(a, b) {
  const norm = (s) => String(s || '0.0.0')
    .split('.')
    .map(seg => parseInt(String(seg).replace(/[^0-9].*/, ''), 10) || 0);
  const ap = norm(a);
  const bp = norm(b);
  for (let i = 0; i < 3; i++) {
    const ai = ap[i] || 0;
    const bi = bp[i] || 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

function detectPlatform() {
  try {
    const p = window?.Capacitor?.getPlatform?.();
    if (p === 'ios' || p === 'android') return p;
  } catch {}
  return 'web';
}

function readSnoozedUntil() {
  try {
    const v = localStorage.getItem(SNOOZE_KEY);
    if (!v) return 0;
    const ts = Date.parse(v);
    return Number.isFinite(ts) ? ts : 0;
  } catch { return 0; }
}

function isSnoozed() {
  const until = readSnoozedUntil();
  return until > Date.now();
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.value || null;
  } catch { return null; }
}

function writeCache(value) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ value, ts: Date.now() }));
  } catch {}
}

/**
 * Snooze the banner for SNOOZE_DAYS days. Called when the user taps
 * "אחר כך" or "עדכן עכשיו" (the latter assumes they'll actually
 * install; if they don't, the next 3-day check fires the banner again).
 */
export function snoozeUpdateBanner() {
  try {
    const until = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000);
    localStorage.setItem(SNOOZE_KEY, until.toISOString());
  } catch {}
}

export default function useUpdateAvailable() {
  // Initial state mirrors useAppUpdateGate's shape so callers can
  // pattern-match the same fields if they ever need both.
  const [state, setState] = useState({
    ready:           false,
    show:            false,
    currentVersion:  null,
    latestVersion:   null,
    platform:        detectPlatform(),
    storeUrl:        null,
  });

  useEffect(() => {
    let cancelled = false;
    let revealTimer = null;

    (async () => {
      // Step 1 — short-circuit on web. Web auto-updates on next visit
      // via the service worker, so a "go to store" banner makes no
      // sense and there's no app store to deep-link to.
      if (!isNative) {
        if (!cancelled) setState(s => ({ ...s, ready: true, show: false }));
        return;
      }

      // Step 2 — gather context (installed version, platform).
      let currentVersion = '0.0.0';
      let platform = detectPlatform();
      try {
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        currentVersion = info?.version || '0.0.0';
      } catch {
        // Plugin import failed (extremely unlikely on native) — fail
        // safe: skip the banner rather than risking a false-positive
        // version comparison against '0.0.0'.
        if (!cancelled) setState(s => ({ ...s, ready: true, show: false }));
        return;
      }

      // Step 3 — try cache first for instant render.
      const cached = readCache();
      let latestVersion = cached?.[platform] || null;

      // Step 4 — background refresh from app_config.
      const configKey = platform === 'ios' ? 'ios_latest_version' : 'android_latest_version';
      try {
        const { data, error } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', configKey)
          .maybeSingle();
        if (!error && data?.value != null) {
          const fresh = String(data.value);
          // Merge into the same cache shape as readCache so future loads
          // get both platforms if the device ever flips (e.g., iPad on
          // Android emulator during dev — defensive only).
          const nextCache = { ...(cached || {}), [platform]: fresh };
          writeCache(nextCache);
          latestVersion = fresh;
        }
      } catch {
        // Network error — fall through to whatever the cache said.
      }

      if (cancelled) return;

      // Step 5 — version compare. The banner only shows when the
      // installed version is strictly OLDER than the latest. Equal
      // (steady state) and somehow-higher (misconfiguration) both
      // suppress.
      const url = platform === 'ios'
        ? 'https://apps.apple.com/app/carreminder/id6764073107'
        : 'https://play.google.com/store/apps/details?id=com.carreminder.app';
      const needsUpdate = latestVersion
        ? compareVersions(currentVersion, latestVersion) < 0
        : false;
      const snoozed = isSnoozed();

      // Step 6 — respect the 2.5s post-boot grace period to avoid
      // stacking with welcome modals / toast splash.
      const reveal = () => {
        if (cancelled) return;
        setState({
          ready: true,
          show: needsUpdate && !snoozed,
          currentVersion,
          latestVersion,
          platform,
          storeUrl: url,
        });
      };

      // Stash the timer in the closure-shared `revealTimer` ref so the
      // useEffect cleanup below can cancel it on unmount. Important —
      // without this, a rapidly-mounted-then-unmounted Layout (HMR,
      // route guard double-mount) would still flip `show: true` after
      // the component is gone, which React then warns about.
      revealTimer = setTimeout(reveal, FIRST_SHOW_DELAY_MS);
    })();

    return () => {
      cancelled = true;
      if (revealTimer) clearTimeout(revealTimer);
    };
  }, []);

  return state;
}
