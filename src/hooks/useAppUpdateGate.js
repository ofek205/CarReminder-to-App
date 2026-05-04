/**
 * useAppUpdateGate — checks whether the running native app version is
 * still supported, by comparing against a minimum-version value stored
 * in the public.app_config table on Supabase.
 *
 * Only fires on Capacitor native (iOS/Android). Web users update
 * automatically via the Service Worker and never hit this path.
 *
 * Fails open: if anything goes wrong (no internet, table missing,
 * malformed value), the user is allowed in. Better to lose enforcement
 * for a moment than to lock everyone out due to a server hiccup.
 *
 * Returns:
 *   {
 *     checked,           // false until the first check completes
 *     needsUpdate,       // true → caller should render the gate UI
 *     currentVersion,    // installed app version, e.g. "2.8.0"
 *     minVersion,        // server-required min, e.g. "2.9.0"
 *     platform,          // 'android' | 'ios' | 'web'
 *   }
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isNative } from '@/lib/capacitor';

// Compare two semver strings. Returns negative if a<b, 0 if equal,
// positive if a>b. Tolerates "2.9.0-hotfix-1" by stripping non-numeric
// suffix on each segment — for the purpose of "minimum supported" the
// hotfix qualifier doesn't change the gate decision.
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
  // Capacitor exposes its platform via window.Capacitor.getPlatform()
  // when running natively. On web, this returns 'web'.
  try {
    const p = window?.Capacitor?.getPlatform?.();
    if (p === 'ios' || p === 'android') return p;
  } catch {}
  return 'web';
}

export default function useAppUpdateGate() {
  const [state, setState] = useState({
    checked:        false,
    needsUpdate:    false,
    currentVersion: null,
    minVersion:     null,
    platform:       detectPlatform(),
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Only check on native — web auto-updates via SW.
      if (!isNative) {
        if (!cancelled) setState(s => ({ ...s, checked: true, needsUpdate: false }));
        return;
      }

      try {
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        const currentVersion = info?.version || '0.0.0';
        const platform = detectPlatform();

        // iOS update gate is disabled while we're stabilising the native build.
        // Re-enable by removing this block when iOS is ready to enforce a
        // minimum version. Android keeps its own gate via android_min_version.
        if (platform === 'ios') {
          if (!cancelled) setState({
            checked: true, needsUpdate: false,
            currentVersion, minVersion: null, platform,
          });
          return;
        }

        const configKey = 'android_min_version';

        const { data, error } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', configKey)
          .maybeSingle();

        if (error || !data?.value) {
          // Table missing or no row → not configured yet → don't gate.
          if (!cancelled) setState({
            checked: true, needsUpdate: false,
            currentVersion, minVersion: null, platform,
          });
          return;
        }

        // value is jsonb. The server stores '"2.9.0"' (a JSON-string).
        // supabase-js parses JSON, so data.value === '2.9.0' as a JS string.
        const minVersion = String(data.value);
        const needsUpdate = compareVersions(currentVersion, minVersion) < 0;

        if (!cancelled) setState({
          checked: true, needsUpdate, currentVersion, minVersion, platform,
        });
      } catch (e) {
        // Anything else (network, malformed config, etc.): fail open.
        // eslint-disable-next-line no-console
        console.warn('app update gate check failed:', e?.message);
        if (!cancelled) setState(s => ({ ...s, checked: true, needsUpdate: false }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
