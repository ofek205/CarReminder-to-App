/**
 * Turning a refused offline write into a queued one.
 *
 * This is the Phase 3 decision layer: run.js asks "can this write be queued?",
 * and everything about what that means lives here.
 *
 * ── WHY ONLY SOME COMMANDS ────────────────────────────────────────────────────
 *
 * 52 commands declare `offlineCapable: true`, and this enables the outbox for
 * three of them. That is not timidity, it is what the two open DB prerequisites
 * actually permit (spec §5.1, §5.5):
 *
 *   • CONFLICT DETECTION needs `updated_at` + a trigger on every offline-write
 *     table, and `vehicles` has no `updated_at` at all — only `created_at`.
 *     Without it, an UPDATE queued three hours ago silently overwrites a newer
 *     server value on flush. That is precisely the "destroy or silently corrupt
 *     data" class the whole seam refactor was built to close, so queueing
 *     updates to SERVER rows stays off until Ofek runs that SQL.
 *
 *   • CLIENT-SUPPLIED IDS on insert need to be verified against each table's RLS
 *     `WITH CHECK`. So nothing here sends one: a queued create carries no `id`,
 *     the server assigns it, and the optimistic row's local id is replaced when
 *     `invalidates` refetches after the flush. The prerequisite is sidestepped
 *     rather than waited on.
 *
 * A pure INSERT of an owner-scoped row needs neither: there is no existing row
 * to clobber, and no client id is sent. That is the whole unblocked set, and it
 * is genuinely useful — adding a note or a task in a parking garage is the
 * canonical offline moment.
 *
 * ── MUTATING A ROW THAT ONLY EXISTS LOCALLY ──────────────────────────────────
 *
 * A queued create leaves a row in the cache with a `local_` id. If the user then
 * edits or deletes it while still offline, enqueuing that as a second operation
 * would send an update or delete for an id the server has never seen — a
 * guaranteed terminal failure, landing in the review inbox for something the
 * user already resolved themselves.
 *
 * So those two cases never become queue items at all: an edit PATCHES the
 * pending create in place, and a delete CANCELS it. Both are purely local, need
 * no server round trip, and leave the queue in the state it would have been in
 * had the user never made the row.
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
 * Commands whose offline writes are queued rather than refused.
 *
 * Each entry names the create that may be queued, and the update/delete
 * commands that may act on a row that create is still holding locally. Adding
 * to this map is a deliberate act: read the two prerequisites at the top of
 * this file first.
 */
export const OUTBOX_COMMANDS = {
  'corkNote.create': { kind: 'create', invalidates: ['cork-notes'] },
  'task.create':     { kind: 'create', invalidates: ['tasks-v2'] },

  // Local-row-only operations. These are NEVER sent to the server; they edit or
  // cancel a pending create. Acting on a real server id falls through to the
  // normal offline refusal, because that would need conflict detection.
  'corkNote.update': { kind: 'localOnly', op: 'patch',  creates: ['corkNote.create'] },
  'corkNote.delete': { kind: 'localOnly', op: 'delete', creates: ['corkNote.create'] },
  'task.toggleDone': { kind: 'localOnly', op: 'patch',  creates: ['task.create'] },
  'task.delete':     { kind: 'localOnly', op: 'delete', creates: ['task.create'] },
};

/** Is there an offline path for this command and payload? */
export function canQueue(commandName, payload) {
  const entry = OUTBOX_COMMANDS[commandName];
  if (!entry) return false;
  const cmd = getCommand(commandName);
  if (!cmd?.offlineCapable) return false;   // the declared flag still governs
  if (entry.kind === 'create') return true;
  // localOnly: only when the target row is one of ours, still unsynced.
  return isLocalId(payload?.id);
}

/**
 * The user the write belongs to.
 *
 * `getSession()` reads the stored session rather than calling the server, so it
 * resolves offline — unlike `getUser()`, which would hit the network and fail
 * in exactly the situation this whole path exists for.
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
 * Queue a write, and return whatever the command's contract says a caller gets.
 *
 * Returns `{ queued: false }` when the write could not be queued, so run.js can
 * fall through to the plain refusal rather than telling the user it was saved.
 */
export async function queueWrite(commandName, payload) {
  const entry = OUTBOX_COMMANDS[commandName];
  const userId = await currentUserId();
  // No attributable user means no queue entry: an unattributed write could be
  // replayed as the wrong person after a sign-in.
  if (!entry || !userId) return { queued: false };

  if (entry.kind === 'localOnly') {
    const handled = await mutatePendingCreate(entry, payload, userId);
    return handled ? { queued: true, result: payload } : { queued: false };
  }

  const localId = `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`;
  const opId = await enqueue({ command: commandName, payload, userId, localId });
  if (!opId) return { queued: false };   // IDB unavailable — refuse honestly

  // The row the UI shows until the flush replaces it with the server's.
  const optimisticRow = { ...payload, id: localId, _pendingSync: true };
  await applyOptimistic(entry, optimisticRow);
  return { queued: true, result: optimisticRow };
}

/** Edit or cancel a create that is still sitting in the queue. */
async function mutatePendingCreate(entry, payload, userId) {
  const pending = await listPending(userId);
  const target = pending.find(
    (i) => i.localId === payload.id && entry.creates.includes(i.command),
  );
  // The row has a local id but no queue item — it was already flushed, or the
  // queue was cleared. Refusing is right: we do not know what the server holds.
  if (!target) return false;

  if (entry.op === 'delete') {
    await remove(target.opId);
    await removeOptimistic(target.command, payload.id);
    return true;
  }
  // patch: fold the change into the create that has not left yet, so the server
  // eventually receives one insert carrying the final values.
  const { id, ...changes } = payload;
  await patchPayload(target.opId, changes);
  await patchOptimistic(target.command, id, changes);
  return true;
}

// ── Cache application ────────────────────────────────────────────────────────
// Imported lazily so this module stays usable from a test without pulling in
// the whole query client, and so a cache failure can never break the enqueue
// that already succeeded — the durable queue is the source of truth, the cache
// is just what the user is looking at.

async function withCache(fn) {
  try {
    const { queryClientInstance } = await import('../query-client');
    fn(queryClientInstance);
  } catch { /* the write is queued; a stale screen is the only cost */ }
}

const keyFor = (commandName) => OUTBOX_COMMANDS[commandName]?.invalidates?.[0];

async function applyOptimistic(entry, row) {
  const key = entry.invalidates?.[0];
  if (!key) return;
  await withCache((qc) => {
    qc.setQueriesData({ queryKey: [key] }, (old) => (Array.isArray(old) ? [row, ...old] : old));
  });
}

async function patchOptimistic(createCommand, localId, changes) {
  const key = keyFor(createCommand);
  if (!key) return;
  await withCache((qc) => {
    qc.setQueriesData({ queryKey: [key] }, (old) => (Array.isArray(old)
      ? old.map((r) => (r?.id === localId ? { ...r, ...changes } : r))
      : old));
  });
}

async function removeOptimistic(createCommand, localId) {
  const key = keyFor(createCommand);
  if (!key) return;
  await withCache((qc) => {
    qc.setQueriesData({ queryKey: [key] }, (old) => (Array.isArray(old)
      ? old.filter((r) => r?.id !== localId)
      : old));
  });
}
