/**
 * How many offline writes are waiting, and how many gave up.
 *
 * Feeds the banner and the logout guard. Deliberately a poll rather than a
 * subscription: the outbox is written from non-React code (dal/run.js,
 * dal/sync.js) and from OTHER TABS, so a store subscription inside this tab
 * would miss half the changes it needs to reflect. A 3s poll of a handful of
 * IndexedDB records is cheap, and the numbers are advisory — being a second
 * stale never changes a decision.
 *
 * The `lingering` flag is the one piece of real logic. A drain normally
 * finishes in well under a second, so rendering "syncing" on every reconnect
 * would flash a strip at the user constantly. It is only worth telling them
 * when the queue is NOT emptying: pending, while online, for long enough that
 * something is evidently stuck. Same asymmetric-debounce reasoning as
 * useSettledOnlineStatus, applied to a different signal.
 */
import { useEffect, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { useAuth } from '@/components/shared/GuestContext';
import { pendingCount, listFailed } from '@/lib/dal/outbox';

const POLL_MS = 3000;
// How long a non-empty queue may sit while online before we say so.
const LINGER_MS = 6000;

export default function useOutboxStatus() {
  const { user, isGuest } = useAuth();
  const userId = !isGuest ? user?.id : null;
  const [status, setStatus] = useState({ pending: 0, failed: 0, lingering: false });

  useEffect(() => {
    if (!userId) {
      setStatus({ pending: 0, failed: 0, lingering: false });
      return undefined;
    }
    let cancelled = false;
    // When the queue first became non-empty while online. Reset whenever it
    // empties or we go offline, so "lingering" only ever describes the current
    // stretch rather than accumulating across the session.
    let busySince = null;

    const tick = async () => {
      try {
        const [pending, failed] = await Promise.all([
          pendingCount(userId),
          listFailed(userId),
        ]);
        if (cancelled) return;

        const online = onlineManager.isOnline();
        if (pending > 0 && online) {
          if (busySince === null) busySince = Date.now();
        } else {
          busySince = null;
        }
        setStatus({
          pending,
          failed: failed.length,
          lingering: busySince !== null && Date.now() - busySince >= LINGER_MS,
        });
      } catch {
        // The outbox is unreadable (wedged IndexedDB). Report nothing rather
        // than a wrong number: a false "0 pending" is what would let the logout
        // guard wave someone through.
        if (!cancelled) setStatus({ pending: 0, failed: 0, lingering: false, unknown: true });
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId]);

  return status;
}
