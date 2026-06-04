/**
 * useReleaseAnnouncement — admin-published "what's new" popup, shown to each
 * user EXACTLY ONCE per announcement.
 *
 * Replaces the old automatic daily "טוב שחזרת / מה חדש" WelcomePopup (which
 * popped every day with hardcoded, non-editable content). Now NOTHING pops
 * automatically: the admin publishes an announcement from the Versions tab
 * (publish_release_announcement RPC → app_config key 'release_announcement'),
 * and this hook surfaces it once.
 *
 * Data shape (app_config.value jsonb):
 *   { id, title, body, published_at }
 *
 * One-shot dedup: localStorage `release_ann_seen_<id>`. Publishing a NEW
 * announcement mints a fresh id, so the popup re-arms for everyone. Clearing
 * it (admin "הפסק") deletes the row → nothing shows.
 *
 * Fail-safe: any error (offline, missing row, malformed value) → show nothing.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const SEEN_PREFIX = 'release_ann_seen_';
// Small settle delay so the popup doesn't race the first paint / splash.
const REVEAL_DELAY_MS = 1500;

export default function useReleaseAnnouncement(enabled = true) {
  const [state, setState] = useState({ ready: false, show: false, announcement: null });

  useEffect(() => {
    if (!enabled) {
      setState({ ready: true, show: false, announcement: null });
      return undefined;
    }
    let cancelled = false;
    let timer = null;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'release_announcement')
          .maybeSingle();

        if (cancelled) return;

        const ann = (!error && data?.value && typeof data.value === 'object') ? data.value : null;
        if (!ann || !ann.id || !ann.body) {
          setState({ ready: true, show: false, announcement: null });
          return;
        }

        let seen = false;
        try { seen = localStorage.getItem(SEEN_PREFIX + ann.id) === '1'; } catch { /* storage off */ }
        if (seen) {
          setState({ ready: true, show: false, announcement: ann });
          return;
        }

        timer = setTimeout(() => {
          if (!cancelled) setState({ ready: true, show: true, announcement: ann });
        }, REVEAL_DELAY_MS);
      } catch {
        if (!cancelled) setState({ ready: true, show: false, announcement: null });
      }
    })();

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [enabled]);

  // Mark the current announcement as seen so it never re-opens on this device.
  const dismiss = () => {
    setState((s) => {
      try { if (s.announcement?.id) localStorage.setItem(SEEN_PREFIX + s.announcement.id, '1'); } catch { /* storage off */ }
      return { ...s, show: false };
    });
  };

  return { ...state, dismiss };
}
