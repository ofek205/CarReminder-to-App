/**
 * The sync engine — replays the outbox when connectivity returns.
 *
 * Design: docs/offline-architecture-spec.md §5.3 and §5.4.
 *
 * The hard part of this file is not the loop, it is DECIDING WHAT A FAILURE
 * MEANS. Replaying a write blindly on every error would hammer the server and
 * eventually give up on data the user cannot get back; treating every error as
 * terminal would throw away writes that only needed a second attempt. So each
 * outcome is classified into exactly one of four buckets, and the rules are
 * written down next to the codes that produce them.
 *
 * A queued write leaves this engine in only two ways: the server confirmed it,
 * or it is marked FAILED and kept with its error for a human to review. There
 * is no path that drops one quietly.
 */
import { onlineManager } from '@tanstack/react-query';
import { getCommand } from './registry';
import { listPending, remove, recordFailure } from './outbox';

/** What to do about a failed replay attempt. */
export const OUTCOME = {
  SUCCESS: 'success',       // confirmed, or provably already applied
  RETRY: 'retry',          // transient; keep PENDING, try the next drain
  TERMINAL: 'terminal',    // will never succeed; keep for review
  PAUSE: 'pause',          // stop the whole drain (auth expired / offline again)
};

/**
 * Postgres / PostgREST codes that mean "this will never succeed, stop trying".
 *
 * 42501 insufficient_privilege — RLS refused. The user's permission was revoked
 *   while they were offline, or they were removed from the workspace. Retrying
 *   cannot help.
 * 23503 foreign_key_violation — the parent row is gone (a vehicle deleted on
 *   another device), so this child write has nowhere to land.
 * 23514 check_violation / 22P02 invalid_text_representation — the payload is not
 *   acceptable to the schema. A retry sends the same bytes.
 * PGRST116 — the row the update targeted does not exist any more.
 */
const TERMINAL_CODES = new Set(['42501', '23503', '23514', '22P02', 'PGRST116']);

/**
 * 23505 unique_violation is deliberately NOT terminal-or-retry: on a REPLAY it
 * usually means the write ALREADY LANDED and we are seeing our own row. The
 * item is therefore treated as done. This is the idempotency rule from §5.3 —
 * without it, a write that succeeded just as the connection dropped would be
 * retried forever and then marked failed, telling the user their save was lost
 * when it was not.
 */
const ALREADY_APPLIED_CODES = new Set(['23505']);

/** Auth trouble: pause the queue and keep everything. Never a failure. */
function isAuthProblem(err) {
  const msg = String(err?.message || '').toLowerCase();
  const status = err?.status ?? err?.statusCode;
  return status === 401
    || msg.includes('jwt expired')
    || msg.includes('invalid refresh token')
    || msg.includes('not authenticated');
}

/**
 * Classify one replay result.
 *
 * Takes the outcome of a command, whichever contract it uses: an envelope
 * command resolves `{ data, error }`, everything else throws. Both shapes reach
 * here, so both are handled — the same rule the offline guard in run.js follows.
 */
export function classify(error) {
  if (!error) return OUTCOME.SUCCESS;
  if (isAuthProblem(error)) return OUTCOME.PAUSE;
  const code = error?.code ?? error?.details?.code;
  if (code && ALREADY_APPLIED_CODES.has(String(code))) return OUTCOME.SUCCESS;
  if (code && TERMINAL_CODES.has(String(code))) return OUTCOME.TERMINAL;
  // An OfflineError means we lost the connection again mid-drain: stop, keep
  // everything, and wait for the next reconnect.
  if (error?.isOffline) return OUTCOME.PAUSE;
  // Anything unrecognised is treated as transient. That is the safe default:
  // the cost of an extra attempt is a request, while the cost of a wrong
  // TERMINAL is the user's data sitting in a review queue it never needed.
  return OUTCOME.RETRY;
}

/** Give up retrying after this many attempts, and move the item to review. */
export const MAX_ATTEMPTS = 5;

let draining = false;

/**
 * Replay every pending write for one user, oldest first.
 *
 * Strictly serial and ordered, because a create followed by an update to the
 * same row must reach the server in that order (§5.2). It also stops at the
 * first RETRY or PAUSE rather than skipping ahead, for the same reason: running
 * item 2 after item 1 failed would apply writes out of order.
 *
 * Returns a summary so a caller (or a test) can assert on what happened.
 */
export async function drainOutbox(userId) {
  if (draining || !userId) return { skipped: true, synced: 0, failed: 0, remaining: 0 };
  draining = true;
  const summary = { skipped: false, synced: 0, failed: 0, remaining: 0, paused: false };
  try {
    const items = await listPending(userId);
    for (const item of items) {
      if (!onlineManager.isOnline()) { summary.paused = true; break; }

      const cmd = getCommand(item.command);
      if (!cmd) {
        // The command was renamed or removed since the write was queued. It can
        // never be replayed, so it goes to review rather than being dropped.
        await recordFailure(item.opId, `unknown command "${item.command}"`, { terminal: true });
        summary.failed += 1;
        continue;
      }

      let error = null;
      try {
        const res = await cmd.run(item.payload);
        // Honour the command's declared contract, exactly as run.js does.
        if (cmd.returnsEnvelope) error = res?.error ?? null;
      } catch (e) {
        error = e;
      }

      const outcome = classify(error);
      if (outcome === OUTCOME.SUCCESS) {
        await remove(item.opId);
        summary.synced += 1;
        await invalidateFor(cmd, item);
      } else if (outcome === OUTCOME.PAUSE) {
        summary.paused = true;
        break;
      } else if (outcome === OUTCOME.TERMINAL) {
        await recordFailure(item.opId, error, { terminal: true });
        summary.failed += 1;
      } else {
        // RETRY — but not forever. Past MAX_ATTEMPTS it becomes a review item,
        // because silently retrying something for days is its own kind of
        // losing it.
        const terminal = (item.attempts || 0) + 1 >= MAX_ATTEMPTS;
        await recordFailure(item.opId, error, { terminal });
        if (terminal) summary.failed += 1;
        break;
      }
    }
    summary.remaining = (await listPending(userId)).length;
  } finally {
    draining = false;
  }
  return summary;
}

/**
 * Refetch what the replayed write affected, so the UI shows server truth rather
 * than the optimistic row. Best-effort: a failure here is a stale screen, not
 * lost data, and must not abort the drain.
 */
async function invalidateFor(cmd, item) {
  if (typeof cmd.invalidates !== 'function') return;
  try {
    const keys = cmd.invalidates(item.payload) || [];
    const { queryClientInstance } = await import('../query-client');
    for (const queryKey of keys) queryClientInstance.invalidateQueries({ queryKey });
  } catch { /* stale screen at worst */ }
}

/**
 * Resolve the signed-in user at drain time.
 *
 * `getSession()` reads the stored session instead of calling the server, so it
 * works the instant connectivity returns without waiting on a round trip — and
 * it is resolved at DRAIN time, not at subscribe time, because the engine starts
 * at boot before auth exists and the user can change mid-session. Reading it
 * late is what stops a reconnect from replaying the previous identity's writes.
 */
async function sessionUserId() {
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch {
    return null;
  }
}

/**
 * Drain whenever connectivity returns.
 *
 * Started once at boot from query-client.js. `getUserId` exists only so a test
 * can supply an identity without a real session.
 */
export function startOutboxSync(getUserId = sessionUserId) {
  return onlineManager.subscribe((online) => {
    if (!online) return;
    Promise.resolve()
      .then(() => getUserId())
      .then((userId) => (userId ? drainOutbox(userId) : null))
      .catch(() => { /* never throw into the app */ });
  });
}
