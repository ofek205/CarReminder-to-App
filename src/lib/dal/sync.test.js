/**
 * The sync engine's hard part is not the loop, it is deciding what a failure
 * MEANS. Getting that wrong is expensive in both directions: a wrong TERMINAL
 * parks a user's write in a review queue it never needed, and a wrong RETRY
 * hammers the server forever and then gives up on data they cannot get back.
 *
 * So `classify` is pinned code by code, and the drain is pinned on the
 * properties that follow from it — order, stopping, and never dropping.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';

vi.mock('idb-keyval', () => {
  const dbs = new Map();
  const nameOf = (store) => store?.__name || 'default';
  const mapFor = (store) => {
    const n = nameOf(store);
    if (!dbs.has(n)) dbs.set(n, new Map());
    return dbs.get(n);
  };
  return {
    createStore: (db, st) => ({ __name: `${db}/${st}` }),
    get: async (k, store) => mapFor(store).get(k),
    set: async (k, v, store) => { mapFor(store).set(k, v); },
    del: async (k, store) => { mapFor(store).delete(k); },
    update: async (k, fn, store) => { const m = mapFor(store); m.set(k, fn(m.get(k))); },
  };
});

const { classify, OUTCOME, drainOutbox, MAX_ATTEMPTS } = await import('./sync');
const { enqueue, listPending, listFailed, clearOutbox, __readQueueForTests, __setQueueForTests, OUTBOX_STATUS } = await import('./outbox');
const { defineCommand } = await import('./registry');

const USER = 'user-a';
let ran = [];

defineCommand('sync.ok', { run: (p) => { ran.push(p); return Promise.resolve({ id: 'server-1' }); } });
defineCommand('sync.throws', { run: () => { throw new Error('network unreachable'); } });
defineCommand('sync.rls', { run: () => { const e = new Error('permission denied'); e.code = '42501'; throw e; } });
defineCommand('sync.dupe', { run: () => { const e = new Error('duplicate key'); e.code = '23505'; throw e; } });
defineCommand('sync.envelopeErr', {
  returnsEnvelope: true,
  run: () => Promise.resolve({ data: null, error: { code: '42501', message: 'rls' } }),
});
defineCommand('sync.invalidates', {
  invalidates: () => [['cork-notes']],
  run: () => Promise.resolve({ id: 'server-2' }),
});

beforeEach(async () => { ran = []; await clearOutbox(); onlineManager.setOnline(true); });

describe('classify', () => {
  it('treats no error as success', () => {
    expect(classify(null)).toBe(OUTCOME.SUCCESS);
  });

  it('treats a unique violation on REPLAY as already applied', () => {
    // The subtle one. On a replay, 23505 almost always means the write landed
    // just as the connection dropped and we are seeing our own row. Calling it
    // a failure would retry forever and then tell the user their save was lost
    // when it never was.
    expect(classify({ code: '23505' })).toBe(OUTCOME.SUCCESS);
  });

  it('treats RLS refusal as terminal', () => {
    // Permission revoked while offline. No number of retries changes that.
    expect(classify({ code: '42501' })).toBe(OUTCOME.TERMINAL);
  });

  it('treats a missing parent or row as terminal', () => {
    expect(classify({ code: '23503' })).toBe(OUTCOME.TERMINAL);
    expect(classify({ code: 'PGRST116' })).toBe(OUTCOME.TERMINAL);
  });

  it('PAUSES on an auth problem instead of failing the item', () => {
    // The JWT can expire during a long offline stretch. That is not the write's
    // fault, so the queue waits rather than marking anything failed.
    expect(classify({ status: 401 })).toBe(OUTCOME.PAUSE);
    expect(classify(new Error('JWT expired'))).toBe(OUTCOME.PAUSE);
  });

  it('PAUSES when connectivity dropped again mid-drain', () => {
    expect(classify({ isOffline: true })).toBe(OUTCOME.PAUSE);
  });

  it('defaults an UNRECOGNISED error to retry, not terminal', () => {
    // Deliberately optimistic: an extra request costs a request, while a wrong
    // terminal costs the user a write parked in a queue for no reason.
    expect(classify(new Error('something nobody predicted'))).toBe(OUTCOME.RETRY);
  });
});

describe('drainOutbox', () => {
  it('replays a pending write and removes it once confirmed', async () => {
    await enqueue({ command: 'sync.ok', payload: { body: 'note' }, userId: USER });
    const summary = await drainOutbox(USER);
    expect(summary.synced).toBe(1);
    expect(ran).toEqual([{ body: 'note' }]);
    expect(await listPending(USER)).toEqual([]);
  });

  it('reads the error out of an ENVELOPE command instead of assuming a throw', async () => {
    // The drain has to honour the same contract the offline guard does, or an
    // envelope command's failure would look like a success and the write would
    // be deleted unsent.
    await enqueue({ command: 'sync.envelopeErr', payload: {}, userId: USER });
    const summary = await drainOutbox(USER);
    expect(summary.synced).toBe(0);
    expect(summary.failed).toBe(1);
    expect(await listFailed(USER)).toHaveLength(1);
  });

  it('keeps a transient failure queued rather than dropping it', async () => {
    await enqueue({ command: 'sync.throws', payload: {}, userId: USER });
    await drainOutbox(USER);
    const [item] = await listPending(USER);
    expect(item).toBeTruthy();
    expect(item.attempts).toBe(1);
    expect(item.lastError).toMatch(/network unreachable/);
  });

  it('STOPS at the first transient failure instead of skipping ahead', async () => {
    // Order matters: running the second item after the first failed would
    // apply writes out of order.
    await enqueue({ command: 'sync.throws', payload: {}, userId: USER });
    await enqueue({ command: 'sync.ok', payload: { second: true }, userId: USER });
    await drainOutbox(USER);
    expect(ran).toEqual([]);                       // the good one did NOT jump the queue
    expect(await listPending(USER)).toHaveLength(2);
  });

  it('moves a terminal failure to review and keeps going', async () => {
    // Unlike a transient failure, a terminal one cannot block the queue
    // forever — it is parked and the next write proceeds.
    await enqueue({ command: 'sync.rls', payload: {}, userId: USER });
    await enqueue({ command: 'sync.ok', payload: { after: true }, userId: USER });
    const summary = await drainOutbox(USER);
    expect(summary.failed).toBe(1);
    expect(summary.synced).toBe(1);
    expect(ran).toEqual([{ after: true }]);
    expect(await listFailed(USER)).toHaveLength(1);
  });

  it('treats an already-applied duplicate as done and removes it', async () => {
    await enqueue({ command: 'sync.dupe', payload: {}, userId: USER });
    const summary = await drainOutbox(USER);
    expect(summary.synced).toBe(1);
    expect(await __readQueueForTests()).toEqual([]);
  });

  it('gives up retrying after MAX_ATTEMPTS and parks the item for review', async () => {
    await __setQueueForTests([{
      opId: 'x', command: 'sync.throws', payload: {}, userId: USER,
      status: OUTBOX_STATUS.PENDING, attempts: MAX_ATTEMPTS - 1,
    }]);
    const summary = await drainOutbox(USER);
    expect(summary.failed).toBe(1);
    expect(await listPending(USER)).toEqual([]);
    expect(await listFailed(USER)).toHaveLength(1);
  });

  it('parks a write whose command no longer exists', async () => {
    // Renamed or deleted since the write was queued. It can never replay, so it
    // goes to review — not to /dev/null.
    await enqueue({ command: 'sync.doesNotExist', payload: {}, userId: USER });
    const summary = await drainOutbox(USER);
    expect(summary.failed).toBe(1);
    expect((await listFailed(USER))[0].lastError).toMatch(/unknown command/);
  });

  it('does nothing while offline', async () => {
    await enqueue({ command: 'sync.ok', payload: {}, userId: USER });
    onlineManager.setOnline(false);
    const summary = await drainOutbox(USER);
    expect(summary.synced).toBe(0);
    expect(ran).toEqual([]);
    expect(await listPending(USER)).toHaveLength(1);
  });

  it('never replays another user\'s writes', async () => {
    await enqueue({ command: 'sync.ok', payload: { theirs: true }, userId: 'someone-else' });
    const summary = await drainOutbox(USER);
    expect(summary.synced).toBe(0);
    expect(ran).toEqual([]);
  });
});
