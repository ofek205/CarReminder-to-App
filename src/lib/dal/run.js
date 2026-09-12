/**
 * runCommand — the single entry point for every write in the app.
 *
 * Phase 0 made this pure routing. Phase 2 adds the offline guard, which is the
 * payoff of having routed everything through one function: a write that cannot
 * work offline now fails immediately, with a sentence the user can act on,
 * instead of sitting on a spinner until an 8s timeout produces a generic
 * network error. That behaviour arrives everywhere at once rather than as a
 * guard bolted onto each of ~200 call sites.
 *
 * Phase 3 replaces the `queueable` branch below with a durable outbox: an
 * offline-capable command will apply optimistically to the cache and enqueue,
 * instead of being refused.
 */
import { onlineManager } from '@tanstack/react-query';
import { getCommand } from './registry';
import { canQueue, queueWrite } from './queueWrite';
import {
  OfflineError,
  OFFLINE_QUEUEABLE_MESSAGE,
  OFFLINE_REQUIRED_MESSAGE,
} from './errors';

export async function runCommand(name, payload) {
  const cmd = getCommand(name);
  if (!cmd) {
    // A typo / unregistered command is a programming error — fail loudly
    // rather than silently no-op a user's write.
    throw new Error(`[dal] unknown command: "${name}"`);
  }

  // Offline: refuse before touching the network.
  //
  // onlineManager is the single source of truth for connectivity — seeded from
  // navigator.onLine and, on native, driven by the OS signal via
  // @capacitor/network (see src/lib/nativeConnectivity.js). Reading it here
  // rather than navigator.onLine directly is what keeps this guard, the paused
  // reads, and the offline banner from ever disagreeing.
  if (!onlineManager.isOnline()) {
    // Phase 3: if this write can be queued, queue it instead of refusing.
    //
    // Only a narrow, deliberate set qualifies today — see OUTBOX_COMMANDS in
    // ./queueWrite.js for why, which comes down to the two open DB
    // prerequisites (no `updated_at` means no conflict detection, so queueing
    // an UPDATE to a server row could silently clobber newer data). Everything
    // else still takes the Phase 2 refusal below, unchanged.
    if (canQueue(name, payload)) {
      const { queued, result } = await queueWrite(name, payload);
      if (queued) {
        // The call site gets the shape it already handles, so a queued write
        // looks like the success it is: the row is durably saved, just not on
        // the server yet.
        return cmd.returnsEnvelope ? { data: result, error: null } : result;
      }
      // Could not queue (no session, IndexedDB unavailable). Fall through and
      // refuse honestly rather than claim it was saved.
    }

    const queueable = !!cmd.offlineCapable;
    const err = new OfflineError(
      queueable ? OFFLINE_QUEUEABLE_MESSAGE : OFFLINE_REQUIRED_MESSAGE,
      { queueable },
    );
    // Respect the command's declared contract instead of always throwing.
    //
    // 32 of the 118 commands resolve to a raw `{ data, error }` envelope
    // precisely because their call sites branch on `error` rather than using
    // try/catch. Throwing at those sites would skip the error branch they
    // already have — landing in an outer catch if one exists, and surfacing as
    // an unhandled rejection if not. So an envelope command gets an envelope,
    // exactly as it would for a server-side failure, and only the commands
    // that throw, throw. Offline then needs no special handling at any call
    // site: it arrives in the shape that site already handles.
    if (cmd.returnsEnvelope) return { data: null, error: err };
    throw err;
  }

  return cmd.run(payload);
}
