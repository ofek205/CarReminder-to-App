/**
 * The Phase 3 integration seam: offline, a queueable write now SUCCEEDS instead
 * of being refused. That is a user-visible contract change at every call site
 * for those commands, so it is pinned here.
 *
 * The two things most worth protecting are the boundaries of the allowlist.
 * Widening it by accident would start queueing updates to server rows, which
 * cannot be done safely until `updated_at` exists to detect conflicts — and
 * narrowing it silently would take offline writes away again.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';

vi.mock('idb-keyval', () => {
  const dbs = new Map();
  const nameOf = (s) => s?.__name || 'default';
  const mapFor = (s) => { const n = nameOf(s); if (!dbs.has(n)) dbs.set(n, new Map()); return dbs.get(n); };
  return {
    createStore: (db, st) => ({ __name: `${db}/${st}` }),
    get: async (k, s) => mapFor(s).get(k),
    set: async (k, v, s) => { mapFor(s).set(k, v); },
    del: async (k, s) => { mapFor(s).delete(k); },
    update: async (k, fn, s) => { const m = mapFor(s); m.set(k, fn(m.get(k))); },
  };
});

// A stored session, which is what getSession() returns offline.
let session = { user: { id: 'user-a' } };
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session } }) } },
}));

const { runCommand } = await import('./run');
const { defineCommand } = await import('./registry');
const { canQueue, isLocalId, LOCAL_ID_PREFIX } = await import('./queueWrite');
const { listPending, clearOutbox } = await import('./outbox');

// Register the real command names the allowlist refers to, without importing
// dal/index.js (which would pull in the live Supabase client).
let serverCalls = [];
const T = 'cork_notes';
defineCommand('corkNote.create', { offlineCapable: true, outboxOp: 'insert', table: T, invalidates: (p) => [['cork-notes', p?.vehicle_id]], run: (p) => { serverCalls.push(p); return Promise.resolve({ id: 'server-1' }); } });
defineCommand('corkNote.update', { offlineCapable: true, outboxOp: 'update', table: T, run: (p) => { serverCalls.push(p); return Promise.resolve({}); } });
defineCommand('corkNote.delete', { offlineCapable: true, outboxOp: 'delete', table: T, run: (p) => { serverCalls.push(p); return Promise.resolve({}); } });
// offlineCapable AND an insert, but NOT in OUTBOX_ENABLED — the flag alone must
// never be enough to start queueing.
defineCommand('expense.create', { offlineCapable: true, outboxOp: 'insert', table: 'vehicle_expenses', run: (p) => { serverCalls.push(p); return Promise.resolve({}); } });
defineCommand('share.revoke', { offlineCapable: false, returnsEnvelope: true, run: () => Promise.resolve({ data: null, error: null }) });
// Enabled by name but declaring no outboxOp: must still refuse, so a
// half-registered command cannot slip through the set.
defineCommand('task.toggleDone', { offlineCapable: true, table: T, run: (p) => { serverCalls.push(p); return Promise.resolve({}); } });

beforeEach(async () => {
  serverCalls = [];
  session = { user: { id: 'user-a' } };
  await clearOutbox();
  onlineManager.setOnline(true);
});

describe('canQueue — the allowlist boundary', () => {
  it('allows the creates that carry no clobber risk', () => {
    expect(canQueue('corkNote.create', {})).toBe(true);
  });

  it('refuses a command that is enabled but declares no outboxOp', () => {
    // Behaviour comes from the command's own declaration, so a name in the set
    // without one is a half-registration and must not queue silently.
    expect(canQueue('task.toggleDone', { id: `${LOCAL_ID_PREFIX}abc` })).toBe(false);
  });

  it('does NOT allow an offlineCapable command that is merely offline-capable', () => {
    // expense.create declares offlineCapable:true but is not on the outbox
    // allowlist. The flag alone must not be enough, or adding the flag anywhere
    // would silently start queueing.
    expect(canQueue('expense.create', {})).toBe(false);
  });

  it('never allows an online-required command', () => {
    expect(canQueue('share.revoke', {})).toBe(false);
  });

  it('allows an update/delete ONLY against a local row', () => {
    // Against a server id these need conflict detection, which needs
    // `updated_at`. Against a local id they are purely local edits.
    expect(canQueue('corkNote.update', { id: `${LOCAL_ID_PREFIX}abc` })).toBe(true);
    expect(canQueue('corkNote.update', { id: 'real-server-uuid' })).toBe(false);
    expect(canQueue('corkNote.delete', { id: `${LOCAL_ID_PREFIX}abc` })).toBe(true);
    expect(canQueue('corkNote.delete', { id: 'real-server-uuid' })).toBe(false);
  });
});

describe('runCommand offline, for a queueable create', () => {
  beforeEach(() => { onlineManager.setOnline(false); });

  it('RESOLVES with the optimistic row instead of throwing', async () => {
    const row = await runCommand('corkNote.create', { body: 'in a parking garage' });
    expect(row.body).toBe('in a parking garage');
    expect(isLocalId(row.id)).toBe(true);
    expect(row._pendingSync).toBe(true);
  });

  it('puts exactly one item on the queue, and does not touch the server', async () => {
    await runCommand('corkNote.create', { body: 'x' });
    const pending = await listPending('user-a');
    expect(pending).toHaveLength(1);
    expect(pending[0].command).toBe('corkNote.create');
    expect(serverCalls).toEqual([]);
  });

  it('does NOT send a client-supplied id — the server assigns it', async () => {
    // Sidesteps the open RLS prerequisite: nothing verifies that a client id
    // passes each table's WITH CHECK, so no client id is ever sent.
    await runCommand('corkNote.create', { body: 'x' });
    const [item] = await listPending('user-a');
    expect(item.payload).not.toHaveProperty('id');
    expect(isLocalId(item.localId)).toBe(true);
  });

  it('still REFUSES a command that is not on the allowlist', async () => {
    await expect(runCommand('expense.create', { amount: 1 })).rejects.toMatchObject({ isOffline: true });
    expect(await listPending('user-a')).toEqual([]);
  });

  it('refuses honestly when there is no session to attribute the write to', async () => {
    // Better a refusal than a queued write that could replay as the wrong
    // person after the next sign-in.
    session = null;
    await expect(runCommand('corkNote.create', { body: 'x' })).rejects.toMatchObject({ isOffline: true });
    expect(await listPending('user-a')).toEqual([]);
  });
});

describe('editing a row whose create has not been sent yet', () => {
  beforeEach(() => { onlineManager.setOnline(false); });

  it('folds an edit into the pending create instead of queueing a second op', async () => {
    // Queueing an update for a local id would guarantee a terminal failure at
    // flush, landing in the review inbox for something the user already fixed.
    const row = await runCommand('corkNote.create', { body: 'first' });
    await runCommand('corkNote.update', { id: row.id, body: 'edited' });
    const pending = await listPending('user-a');
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.body).toBe('edited');
  });

  it('cancels the pending create when the local row is deleted', async () => {
    const row = await runCommand('corkNote.create', { body: 'oops' });
    await runCommand('corkNote.delete', { id: row.id });
    expect(await listPending('user-a')).toEqual([]);
    expect(serverCalls).toEqual([]);
  });
});

describe('the optimistic patch stays on the right list', () => {
  beforeEach(() => { onlineManager.setOnline(false); });

  it('does NOT put the new row on another vehicle\'s list', async () => {
    // The real keys are parameterised (['cork-notes', vehicleId]) and
    // setQueriesData matches by PREFIX, so patching ['cork-notes'] would put a
    // note added to one car onto every car's board.
    const { queryClientInstance: qc } = await import('../query-client');
    qc.setQueryData(['cork-notes', 'veh-A'], [{ id: 'a1' }]);
    qc.setQueryData(['cork-notes', 'veh-B'], [{ id: 'b1' }]);

    await runCommand('corkNote.create', { vehicle_id: 'veh-A', body: 'for A only' });

    const listA = qc.getQueryData(['cork-notes', 'veh-A']);
    const listB = qc.getQueryData(['cork-notes', 'veh-B']);
    expect(listA).toHaveLength(2);
    expect(listA[0].body).toBe('for A only');
    expect(listB).toEqual([{ id: 'b1' }]);   // untouched
  });

  it('patches no list at all when the scoping field is missing', async () => {
    // A key of ['cork-notes', undefined] would match by prefix and hit every
    // list, so it is refused rather than applied to the wrong screens. The
    // write is still queued — the queue is the source of truth.
    const { queryClientInstance: qc } = await import('../query-client');
    qc.setQueryData(['cork-notes', 'veh-C'], [{ id: 'c1' }]);
    await runCommand('corkNote.create', { body: 'no vehicle id' });
    expect(qc.getQueryData(['cork-notes', 'veh-C'])).toEqual([{ id: 'c1' }]);
    expect(await listPending('user-a')).toHaveLength(1);
  });
});

describe('runCommand ONLINE', () => {
  it('goes straight to the server and queues nothing', async () => {
    // Positive control: the outbox must not intercept a normal online write.
    await runCommand('corkNote.create', { body: 'online' });
    expect(serverCalls).toEqual([{ body: 'online' }]);
    expect(await listPending('user-a')).toEqual([]);
  });
});
