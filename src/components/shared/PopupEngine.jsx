import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import PopupRenderer from '@/components/shared/PopupRenderer';
import {
  frequencyGateOk, globalThrottleOk, recordImpression, recordDismissal,
} from '@/lib/popups/frequencyGate';
import { matchesConditions, withinWindow, matchesTrigger } from '@/lib/popups/conditions';

/**
 * PopupEngine — runtime brain for admin-managed popups.
 *
 * Responsibilities:
 *   1. Load the currently active popup definitions from `admin_popups`.
 *   2. Listen to trigger events: login, page_view (via react-router),
 *      after_delay (internal tick), and manual (via a custom event).
 *   3. On each event, filter candidates by:
 *      trigger match → window match → condition match → frequency gate
 *      → global throttle.
 *   4. Pick the highest-priority candidate.
 *   5. Render ONE popup at a time.
 *   6. Record `shown`/`dismissed`/`clicked` events to admin_popup_events
 *      (batched best-effort; failures are swallowed).
 *
 * Mounted once at the top of Layout. Never renders more than one popup.
 */
export default function PopupEngine({ vehicles = [], mountGate = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isGuest } = useAuth();

  const [popups, setPopups] = useState([]);
  const [active, setActive] = useState(null);
  const sessionShownRef = useRef(new Set());   // popup IDs shown in this session
  const engineStartedAtRef = useRef(Date.now());
  const loginFiredRef = useRef(false);

  //  Load active popups
  // RLS allows authenticated users to SELECT status='active'. We pull all
  // candidates at once — the dataset is small (<< 100 rows even in heavy
  // marketing orgs) so filtering client-side is simpler than per-event
  // server queries.
  useEffect(() => {
    if (!mountGate) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('admin_popups')
          .select('*')
          .eq('status', 'active')
          .eq('is_system', false)  // system popups are code-driven; the row exists only for admin catalog + analytics
          .order('priority', { ascending: false });
        if (cancelled || error) return;
        setPopups(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setPopups([]);
      }
    })();
    return () => { cancelled = true; };
  }, [mountGate, user?.id]);

  // Context object passed to the matcher.
  const ctx = useMemo(
    () => ({ user, isAuthenticated, isGuest, vehicles }),
    [user, isAuthenticated, isGuest, vehicles]
  );

  // Core selection function. Given a firing event, return the winning popup
  // (highest priority passing every gate), or null if nothing qualifies.
  const selectForEvent = (event) => {
    if (active) return null;                    // one popup on screen at a time
    if (!globalThrottleOk()) return null;       // respect 15-min cooldown

    const candidates = popups
      .filter(p => matchesTrigger(p, event))
      .filter(p => withinWindow(p))
      .filter(p => matchesConditions(p, ctx))
      .filter(p => frequencyGateOk(p, sessionShownRef.current));

    // popups already sorted by priority DESC on fetch; first match wins.
    return candidates[0] || null;
  };

  // Dispatch helper — when we pick a popup, wire everything up.
  const fireEvent = (event) => {
    const winner = selectForEvent(event);
    if (!winner) return;
    setActive(winner);
    sessionShownRef.current.add(winner.id);
    recordImpression(winner.id);
    logEvent(winner.id, 'shown', user?.id);
  };

  //  Trigger: login
  useEffect(() => {
    if (!isAuthenticated || loginFiredRef.current) return;
    loginFiredRef.current = true;
    // Let React settle + initial routing complete before firing.
    const t = setTimeout(() => fireEvent({ kind: 'login' }), 400);
    return () => clearTimeout(t);
  // We intentionally depend on just `isAuthenticated` + `popups` so the
  // engine only fires login once per session even if user object updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, popups.length]);

  //  Trigger: page_view
  useEffect(() => {
    if (!isAuthenticated && !isGuest) return;
    fireEvent({ kind: 'page_view', path: location.pathname });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, popups.length]);

  //  Trigger: after_delay (ticks every 1s, fires matcher for each elapsed popup)
  useEffect(() => {
    if (!isAuthenticated && !isGuest) return;
    const id = setInterval(() => {
      const elapsedMs = Date.now() - engineStartedAtRef.current;
      fireEvent({ kind: 'delay_tick', elapsedMs });
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isGuest, popups.length]);

  //  Trigger: manual (custom browser event)
  // Admin "הצג עכשיו" button dispatches window.dispatchEvent(new
  // CustomEvent('cr:popup:manual', { detail: { popupId } })).
  useEffect(() => {
    const handler = (e) => {
      const popupId = e?.detail?.popupId;
      if (!popupId) return;
      // Manual firing bypasses frequency/throttle checks — it's a test
      // action initiated by admin. Still respects `active` (one at a time).
      if (active) return;
      const popup = popups.find(p => p.id === popupId);
      if (!popup) return;
      setActive(popup);
      logEvent(popupId, 'shown', user?.id);
    };
    window.addEventListener('cr:popup:manual', handler);
    return () => window.removeEventListener('cr:popup:manual', handler);
  }, [popups, active, user?.id]);

  //  Handle close from rendered popup
  const handleClose = (result, meta) => {
    if (!active) return;
    const id = active.id;
    if (result === 'dismissed') {
      recordDismissal(id);
      logEvent(id, 'dismissed', user?.id);
    } else if (result === 'clicked') {
      logEvent(id, 'clicked', user?.id);
      // Side effects based on primary CTA action
      if (meta?.action === 'navigate' && meta.target) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        Promise.resolve().then(() => navigate(meta.target));
      } else if (meta?.action === 'external' && meta.target) {
        try { window.open(meta.target, '_blank', 'noopener'); } catch {}
      }
    }
    setActive(null);
  };

  if (!active) return null;
  return <PopupRenderer popup={active} open={!!active} onClose={handleClose} />;
}

// Fire-and-forget analytics write. Swallows any error — we never want to
// break the UI because an event insert failed (RLS, network, etc).
function logEvent(popupId, kind, userId) {
  try {
    supabase.from('admin_popup_events').insert({
      popup_id: popupId, kind, user_id: userId || null,
    }).then(() => {}, () => {});
  } catch {}
}
