/**
 * The outbox — a durable queue of writes made while offline.
 *
 * Design: docs/offline-architecture-spec.md §5.2. This is Phase 3's storage
 * layer; the drain engine lives in ./sync.js and the enqueue decision in
 * ./run.js.
 *
 * Three properties matter more than anything else here:
 *
 * 1. A QUEUED WRITE IS NEVER SILENTLY DROPPED. It is the user's data, made in
 *    good faith while they had no signal. Every removal is either a confirmed
 *    server success or an explicit terminal failure that keeps the item with
 *    its error for review (§5.4). "Something went wrong so we discarded it" is
 *    not an option this module offers.
 *
 * 2. IT IS A SEPARATE IndexedDB DATABASE from the React Query cache. The cache
 *    is disposable — `buster` wipes it on every release, and clearPersistedCache
 *    deletes it on identity boundaries. Unsynced writes are NOT disposable, so
 *    they must not share a store with something designed to be thrown away.
 *
 * 3. EVERY ITEM CARRIES ITS OWNER'S user id. The spec's §6 suggests scoping the
 *    IDB store by user.id, but that cannot be done at module load: the key would
 *    be fixed before auth resolves, which is exactly the trap that made the
 *    persister's first identity fix wrong. Stamping the owner INSIDE each item
 *    is timing-independent — the drain filters on it, so a stale item can never
 *    be replayed as the wrong user even if a clear was missed.
 *
 * Nothing here may throw into the app. A wedged IndexedDB degrades to "no
 * outbox", which means the offline write is refused as it was in Phase 2 —
 * worse for the user, but never a broken app or a lost session.
 */
import { createStore, get, set, update, del } from 'idb-keyval';

// A dedicated database, not a second key inside the cache's store.
const outboxStore = createStore('cr-outbox', 'queue');
const QUEUE_KEY = 'pending';

// Same WKWebView guard as the persister: an IDB call can hang forever after the
// app is backgrounded mid-transaction, so every call races a timeout that
// RESOLVES rather than rejects.
const IDB_TIMEOUT_MS = 2500;
function race(promise, fallback) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), IDB_TIMEOUT_MS)),
  ]);
}

/** Cap the queue so a long offline stretch cannot grow it without bound. */
export const OUTBOX_MAX_ITEMS = 200;

export const OUTBOX_STATUS = {
  PENDING: 'pending',   // waiting for connectivity, or retryable
  FAILED: 'failed',     // terminal — kept for the review inbox (Phase 6)
};

async function readAll() {
  const rows = await race(get(QUEUE_KEY, outboxStore), null);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Append a write to the queue.
 *
 * Uses idb-keyval's `update()`, which performs the read-modify-write inside ONE
 * readwrite transaction. That is deliberate: a plain get-then-set would let two
 * tabs interleave and silently drop one tab's write — the same
 * last-write-wins hazard the RQ cache still has (Appendix D, D-3). Here the
 * payload is a user's unsynced data, so it is worth the stricter primitive.
 *
 * Returns the opId, or null if the queue could not be written (caller then
 * treats the write as refused rather than pretending it was saved).
 */
export async function enqueue({ command, payload, userId, localId = null }) {
  if (!command || !userId) return null;
  const item = {
    opId: crypto.randomUUID(),
    command,
    payload,
    userId,
    localId,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: OUTBOX_STATUS.PENDING,
    lastError: null,
  };
  // Set inside the transaction's updater, which runs synchronously, so it is
  // readable afterwards. Needed because `update()` gives no return value and
  // enqueue must not report success for a write it did not store.
  let added = false;
  const ok = await race(
    update(QUEUE_KEY, (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      if (list.length < OUTBOX_MAX_ITEMS) {
        added = true;
        return [...list, item];
      }
      // Full: evict the OLDEST PENDING item. Never a FAILED one — those are
      // precisely the items a human still has to look at, and silently
      // dropping one would defeat the review inbox they exist for.
      const oldestPending = list.findIndex((r) => r.status === OUTBOX_STATUS.PENDING);
      if (oldestPending === -1) {
        // Every slot is a failure awaiting review. Refuse the new write rather
        // than discard someone's unresolved one; the caller then falls back to
        // the plain offline refusal, which is honest.
        added = false;
        return list;
      }
      added = true;
      return [...list.slice(0, oldestPending), ...list.slice(oldestPending + 1), item];
    }, outboxStore).then(() => true),
    false,
  );
  return ok && added ? item.opId : null;
}

/**
 * Items still to be replayed, oldest first, for one user.
 *
 * FIFO is load-bearing, not cosmetic: a create followed by an update to the
 * same row must replay in that order or the update targets a row the server has
 * never seen (§5.2).
 */
export async function listPending(userId) {
  const rows = await readAll();
  return rows.filter((r) => r.userId === userId && r.status === OUTBOX_STATUS.PENDING);
}

/** Terminal failures for one user — the review inbox's data source. */
export async function listFailed(userId) {
  const rows = await readAll();
  return rows.filter((r) => r.userId === userId && r.status === OUTBOX_STATUS.FAILED);
}

/** How many writes are waiting. Drives the pending-sync cue the §10.1 decision requires. */
export async function pendingCount(userId) {
  return (await listPending(userId)).length;
}

/** Remove an item. Only ever called after a CONFIRMED server success. */
export async function remove(opId) {
  await race(
    update(QUEUE_KEY, (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r.opId !== opId), outboxStore),
    undefined,
  );
}

/**
 * Record an attempt that did not succeed.
 *
 * `terminal` decides the item's fate: a transient failure stays PENDING and is
 * retried on the next drain, while a terminal one (RLS refused, validation,
 * a row that no longer exists) becomes FAILED and waits for a human. Either
 * way the item and its error survive — see property 1 at the top of this file.
 */
export async function recordFailure(opId, error, { terminal = false } = {}) {
  const message = String(error?.message || error || 'unknown error').slice(0, 500);
  await race(
    update(QUEUE_KEY, (rows) => (Array.isArray(rows) ? rows : []).map((r) => (
      r.opId === opId
        ? {
          ...r,
          attempts: (r.attempts || 0) + 1,
          lastError: message,
          status: terminal ? OUTBOX_STATUS.FAILED : OUTBOX_STATUS.PENDING,
        }
        : r
    )), outboxStore),
    undefined,
  );
}

/**
 * Fold changes into a queued item's payload.
 *
 * Used when the user edits a row whose create has not been sent yet: the queue
 * keeps ONE insert carrying the final values, rather than an insert followed by
 * an update for an id the server has never seen.
 */
export async function patchPayload(opId, changes) {
  await race(
    update(QUEUE_KEY, (rows) => (Array.isArray(rows) ? rows : []).map((r) => (
      r.opId === opId ? { ...r, payload: { ...r.payload, ...changes } } : r
    )), outboxStore),
    undefined,
  );
}

/**
 * Wipe the whole queue.
 *
 * Called at every identity boundary alongside clearPersistedCache (§6). This
 * DISCARDS unsynced writes, which is the §10.1 decision ("warn + discard" on
 * logout) — so a caller on a logout path must have warned the user first. The
 * warning is the caller's job; this function just does what it says.
 */
export async function clearOutbox() {
  await race(del(QUEUE_KEY, outboxStore), undefined);
}

/** Test seam: replace the queue wholesale. Not for application code. */
export async function __setQueueForTests(rows) {
  await race(set(QUEUE_KEY, rows, outboxStore), undefined);
}
/** Test seam: read the raw queue including failed items. */
export async function __readQueueForTests() {
  return readAll();
}
