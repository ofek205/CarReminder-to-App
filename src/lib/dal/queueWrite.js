/**
 * Turning a refused offline write into a queued one.
 *
 * run.js asks "can this write be queued?" and everything about what that means
 * lives here. Phase 4 moved the ANSWER out of this file: what a command does
 * offline is now declared on the command itself (`outboxOp`, `invalidates`,
 * `optimistic`), and this module only decides WHETHER it is switched on and
 * carries out the mechanics. Enabling a command is a one-line addition to
 * OUTBOX_ENABLED instead of a new special case in here.
 *
 * ── WHY THE ENABLED SET IS SMALL ─────────────────────────────────────────────
 *
 * 52 commands declare `offlineCapable: true`, and a handful are switched on.
 * That is what the open prerequisites permit (spec §5.1, §5.5):
 *
 *   • CONFLICT DETECTION needs `updated_at` + a trigger on every offline-write
 *     table, and `vehicles` has none — only `created_at`. Without it, an UPDATE
 *     queued three hours ago silently overwrites a newer server value on flush:
 *     the "silently corrupt data" class the seam refactor closed. So updates to
 *     SERVER rows stay off until that SQL runs.
 *
 *   • CLIENT-SUPPLIED IDS on insert are unverified against each table's RLS
 *     `WITH CHECK`. So none is sent: a queued create carries no `id`, the server
 *     assigns it, and the optimistic row's local id is replaced when
 *     `invalidates` refetches after the flush. The prerequisite is sidestepped
 *     rather than waited on.
 *
 *   • THE §10.1 LOGOUT WARNING does not exist yet. clearOutbox() discards
 *     unsynced writes on sign-out, which is the decided policy, but the warning
 *     that makes it a choice is UI (Phase 6). The more commands are enabled, the
 *     more there is to lose silently, so that warning gates any widening.
 *
 * A pure INSERT of an owner-scoped row needs none of the first two: nothing
 * exists to clobber and no client id is sent.
 *
 * ── MUTATING A ROW THAT ONLY EXISTS LOCALLY ──────────────────────────────────
 *
 * A queued create leaves a row in the cache with a `local_` id. Enqueuing a
 * later edit or delete of it would send an update for an id the server has never
 * seen — a guaranteed terminal failure, landing in the review inbox for
 * something the user already resolved. So those never become queue items: an
 * edit PATCHES the pending create so the server receives one insert with the
 * final values, and a delete CANCELS it.
 */
import { getCommand } from './registry';
import { enqueue, listPending, remove, patchPayload } from './outbox';
import { supabase } from '@/lib/supabase';

/** Prefix marking a row that exists only in the local cache. */
export const LOCAL_ID_PREFIX = 'local_';

export function isLocalId(id) {
  return typeof id === 'string' && id.startsWith(LOCAL_ID_PREFIX);
}

/**
 * Commands whose offline writes are queued instead of refused.
 *
 * Adding a name here is a deliberate act — read the three prerequisites above
 * first. The command must also declare `outboxOp`, and an insert must declare
 * `invalidates` so the flush can refetch and replace the optimistic row.
 */
export const OUTBOX_ENABLED = new Set([
  'corkNote.create',
  'task.create',
  // The local-row-only operations for the two creates above. These never reach
  // the server; they edit or cancel a pending create.
  'corkNote.update',
  'corkNote.delete',
  'task.toggleDone',
  'task.delete',
]);

/** Is there an offline path for this command and payload? */
export function canQueue(commandName, payload) {
  if (!OUTBOX_ENABLED.has(commandName)) return false;
  const cmd = getCommand(commandName);
  if (!cmd?.offlineCapable) return false;   // the declared flag still governs
  if (cmd.outboxOp === 'insert') return true;
  // A SERVER row may be updated offline only when the command opts into
  // conflict detection AND the caller supplied the version the edit was
  // composed against. Without a base version there is no way to tell a stale
  // overwrite from a fresh one, so it falls through to the honest refusal.
  // The base rides in the payload, which enqueue already persists whole, so
  // the outbox needs no new field for it.
  if (cmd.outboxOp === 'update' && cmd.conflict === 'detect' && !isLocalId(payload?.id)) {
    return typeof payload?.baseUpdatedAt === 'string' && payload.baseUpdatedAt.length > 0;
  }
  // Everything else: queueable ONLY against a row that has not been sent yet.
  // A delete of a server row is still refused — it has no conflict story, and
  // "the row moved" means something different for a delete than for an edit.
  if (cmd.outboxOp === 'update' || cmd.outboxOp === 'delete') return isLocalId(payload?.id);
  return false;   // no declared op → not queueable, whatever the set says
}

/**
 * The user the write belongs to.
 *
 * `getSession()` reads the stored session rather than calling the server, so it
 * resolves offline — unlike `getUser()`, which would hit the network and fail in
 * exactly the situation this path exists for.
 */
async function currentUserId() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch {
    return null;
  }
}

/**
 * Queue a write and return whatever the command's contract says a caller gets.
 *
 * Returns `{ queued: false }` when it could not be queued, so run.js falls
 * through to the plain refusal rather than telling the user it was saved.
 */
export async function queueWrite(commandName, payload) {
  const cmd = getCommand(commandName);
  const userId = await currentUserId();
  // No attributable user means no queue entry: an unattributed write could be
  // replayed as the wrong person after a later sign-in.
  if (!cmd || !userId) return { queued: false };

  if (cmd.outboxOp === 'update' || cmd.outboxOp === 'delete') {
    const handled = await mutatePendingCreate(cmd, payload, userId);
    return handled ? { queued: true, result: payload } : { queued: false };
  }

  const localId = `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`;
  const opId = await enqueue({ command: commandName, payload, userId, localId, table: cmd.table });
  if (!opId) return { queued: false };   // queue unavailable — refuse honestly

  const optimisticRow = { ...payload, id: localId, _pendingSync: true };
  await applyOptimistic(cmd, optimisticRow);
  return { queued: true, result: optimisticRow };
}

/**
 * Edit or cancel a create that is still sitting in the queue.
 *
 * The pending item is found by TABLE, not by command name: `corkNote.create` and
 * `task.create` both write cork_notes, and a task edited offline must be able to
 * find the create that is holding it whichever command made it.
 */
async function mutatePendingCreate(cmd, payload, userId) {
  const pending = await listPending(userId);
  const target = pending.find((i) => i.localId === payload.id && i.table === cmd.table);
  // A local id with no queue item means it was already flushed, or the queue was
  // cleared. Refusing is right: we do not know what the server now holds.
  if (!target) return false;

  const createCmd = getCommand(target.command);
  if (cmd.outboxOp === 'delete') {
    await remove(target.opId);
    await removeOptimistic(createCmd, target.payload, payload.id);
    return true;
  }
  const { id, ...changes } = payload;
  await patchPayload(target.opId, changes);
  await patchOptimistic(createCmd, target.payload, id, changes);
  return true;
}

// ── Cache application ────────────────────────────────────────────────────────
// The query client is imported lazily so this module stays testable without it,
// and so a cache failure can never break an enqueue that already succeeded: the
// durable queue is the source of truth, the cache is only what the user sees.

async function withCache(fn) {
  try {
    const { queryClientInstance } = await import('../query-client');
    fn(queryClientInstance);
  } catch { /* the write is queued; a stale screen is the only cost */ }
}

/**
 * The list query this row appears in.
 *
 * Taken from the command's own `invalidates`, so there is ONE declaration per
 * command rather than a second mapping here that could drift out of step with
 * the one the drain uses.
 *
 * The ROW is passed in, and that is not incidental. The real keys are
 * parameterised — `['cork-notes', vehicleId]`, `['tasks-v2', vehicleId]` — and
 * `setQueriesData` matches by PREFIX. Patching `['cork-notes']` would therefore
 * prepend the new note to every vehicle's cork board, so a note added to one car
 * would appear on all of them. Resolving the key against the row keeps the patch
 * on the one list it belongs to.
 *
 * Two defences, because one relies on every future declaration being careful:
 * a key with an `undefined` part is refused here, and the patches themselves
 * use `exact: true`. So a command that declares only a bare prefix patches
 * NOTHING rather than everything — wrong-but-harmless instead of
 * wrong-and-visible-on-every-screen. The drain's `invalidateQueries` keeps
 * prefix matching, where hitting every related list is exactly what is wanted.
 */
function listKeyOf(cmd, row) {
  if (typeof cmd?.invalidates !== 'function') return null;
  try {
    const [first] = cmd.invalidates(row) || [];
    if (!Array.isArray(first)) return null;
    // A key whose parameter came back undefined would match by prefix and hit
    // every list. Refuse it rather than patch the wrong screens.
    return first.some((part) => part === undefined) ? null : first;
  } catch {
    return null;
  }
}

/**
 * Apply a command's own optimistic patch if it declares one; otherwise prepend
 * the row to its list query, which is the right default for an insert.
 */
async function applyOptimistic(cmd, row) {
  if (typeof cmd.optimistic === 'function') {
    await withCache((qc) => cmd.optimistic(qc, row));
    return;
  }
  const key = listKeyOf(cmd, row);
  if (!key) return;
  await withCache((qc) => {
    qc.setQueriesData({ queryKey: key, exact: true }, (old) => (Array.isArray(old) ? [row, ...old] : old));
  });
}

// `queuedPayload` is the pending create's payload, which is what carries the
// scoping field (vehicle_id) the key needs — the incoming `changes` may be a
// single toggled field.
async function patchOptimistic(createCmd, queuedPayload, localId, changes) {
  const key = listKeyOf(createCmd, queuedPayload);
  if (!key) return;
  await withCache((qc) => {
    qc.setQueriesData({ queryKey: key, exact: true }, (old) => (Array.isArray(old)
      ? old.map((r) => (r?.id === localId ? { ...r, ...changes } : r))
      : old));
  });
}

async function removeOptimistic(createCmd, queuedPayload, localId) {
  const key = listKeyOf(createCmd, queuedPayload);
  if (!key) return;
  await withCache((qc) => {
    qc.setQueriesData({ queryKey: key, exact: true }, (old) => (Array.isArray(old)
      ? old.filter((r) => r?.id !== localId)
      : old));
  });
}
