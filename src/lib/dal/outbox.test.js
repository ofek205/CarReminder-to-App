/**
 * The outbox holds writes a user made in good faith with no signal. Its one
 * unbreakable property is that it never loses one quietly, so these tests are
 * mostly about what must NOT disappear.
 *
 * idb-keyval is mocked with an in-memory store: what needs pinning is this
 * module's own logic — ordering, user scoping, the eviction rule, and that a
 * failure keeps the item — not IndexedDB itself.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    // Single-transaction read-modify-write, like the real one.
    update: async (k, fn, store) => {
      const m = mapFor(store);
      m.set(k, fn(m.get(k)));
    },
  };
});

const {
  enqueue, listPending, listFailed, pendingCount, remove, recordFailure,
  patchPayload, clearOutbox, __readQueueForTests, __setQueueForTests,
  OUTBOX_MAX_ITEMS, OUTBOX_STATUS,
} = await import('./outbox');

const USER = 'user-a';
const OTHER = 'user-b';

beforeEach(async () => { await clearOutbox(); });

describe('enqueue', () => {
  it('stores the write with the fields the drain needs', async () => {
    const opId = await enqueue({ command: 'corkNote.create', payload: { body: 'x' }, userId: USER, localId: 'local_1' });
    expect(opId).toBeTruthy();
    const [item] = await listPending(USER);
    expect(item).toMatchObject({
      command: 'corkNote.create',
      payload: { body: 'x' },
      userId: USER,
      localId: 'local_1',
      attempts: 0,
      status: OUTBOX_STATUS.PENDING,
    });
    expect(item.createdAt).toBeTruthy();
  });

  it('refuses to queue a write with no owner', async () => {
    // An unattributed write could be replayed as the wrong person after a
    // later sign-in, so it must not enter the queue at all.
    expect(await enqueue({ command: 'corkNote.create', payload: {}, userId: null })).toBe(null);
    expect(await __readQueueForTests()).toEqual([]);
  });

  it('keeps FIFO order, which dependent writes depend on', async () => {
    // A create followed by an update to the same row must reach the server in
    // that order or the update targets a row the server has never seen.
    await enqueue({ command: 'a', payload: { n: 1 }, userId: USER });
    await enqueue({ command: 'b', payload: { n: 2 }, userId: USER });
    await enqueue({ command: 'c', payload: { n: 3 }, userId: USER });
    expect((await listPending(USER)).map((i) => i.command)).toEqual(['a', 'b', 'c']);
  });
});

describe('user scoping', () => {
  it('never returns another user\'s writes', async () => {
    // The security property: a stale item can never be replayed as the wrong
    // user even if an identity-boundary clear was missed.
    await enqueue({ command: 'mine', payload: {}, userId: USER });
    await enqueue({ command: 'theirs', payload: {}, userId: OTHER });
    expect((await listPending(USER)).map((i) => i.command)).toEqual(['mine']);
    expect((await listPending(OTHER)).map((i) => i.command)).toEqual(['theirs']);
  });
});

describe('recordFailure', () => {
  it('KEEPS a transient failure pending, with the error and a bumped attempt', async () => {
    const opId = await enqueue({ command: 'a', payload: {}, userId: USER });
    await recordFailure(opId, new Error('network down'));
    const [item] = await listPending(USER);
    expect(item.attempts).toBe(1);
    expect(item.lastError).toBe('network down');
    expect(item.status).toBe(OUTBOX_STATUS.PENDING);
  });

  it('KEEPS a terminal failure too, moved to the review list', async () => {
    // "It will never succeed" is not a reason to discard a user's data — it is
    // a reason to show it to them.
    const opId = await enqueue({ command: 'a', payload: {}, userId: USER });
    await recordFailure(opId, { message: 'row-level security' }, { terminal: true });
    expect(await listPending(USER)).toEqual([]);
    const failed = await listFailed(USER);
    expect(failed).toHaveLength(1);
    expect(failed[0].lastError).toBe('row-level security');
  });

  it('truncates a huge error rather than storing it whole', async () => {
    const opId = await enqueue({ command: 'a', payload: {}, userId: USER });
    await recordFailure(opId, new Error('x'.repeat(5000)));
    expect((await listPending(USER))[0].lastError.length).toBeLessThanOrEqual(500);
  });
});

describe('remove', () => {
  it('takes exactly one item and leaves the rest', async () => {
    const a = await enqueue({ command: 'a', payload: {}, userId: USER });
    await enqueue({ command: 'b', payload: {}, userId: USER });
    await remove(a);
    expect((await listPending(USER)).map((i) => i.command)).toEqual(['b']);
  });
});

describe('patchPayload', () => {
  it('folds an edit into a create that has not been sent yet', async () => {
    // So the server receives ONE insert with the final values, instead of an
    // insert plus an update for an id it has never seen.
    const opId = await enqueue({ command: 'corkNote.create', payload: { body: 'first', color: 'y' }, userId: USER });
    await patchPayload(opId, { body: 'edited' });
    const [item] = await listPending(USER);
    expect(item.payload).toEqual({ body: 'edited', color: 'y' });
    expect(await pendingCount(USER)).toBe(1);   // still one write, not two
  });
});

describe('the queue cap', () => {
  it('evicts the oldest PENDING item when full, never a failed one', async () => {
    // Failed items are the ones a human still has to look at, so they are not
    // eviction candidates.
    const rows = [
      { opId: 'failed-1', command: 'old-failure', payload: {}, userId: USER, status: OUTBOX_STATUS.FAILED, attempts: 5 },
      ...Array.from({ length: OUTBOX_MAX_ITEMS - 1 }, (_, i) => ({
        opId: `p${i}`, command: `p${i}`, payload: {}, userId: USER, status: OUTBOX_STATUS.PENDING, attempts: 0,
      })),
    ];
    await __setQueueForTests(rows);
    await enqueue({ command: 'newest', payload: {}, userId: USER });
    const all = await __readQueueForTests();
    expect(all).toHaveLength(OUTBOX_MAX_ITEMS);
    expect(all.some((i) => i.command === 'newest')).toBe(true);
    expect(all.some((i) => i.opId === 'failed-1')).toBe(true);
    expect(all.some((i) => i.command === 'p0')).toBe(false);   // oldest pending went
  });

  it('refuses a new write rather than discarding an unresolved failure', async () => {
    // A queue made entirely of review items has nothing evictable. Reporting
    // failure lets run.js fall back to the honest offline refusal, instead of
    // telling the user their note was saved while dropping someone else's.
    await __setQueueForTests(Array.from({ length: OUTBOX_MAX_ITEMS }, (_, i) => ({
      opId: `f${i}`, command: 'x', payload: {}, userId: USER, status: OUTBOX_STATUS.FAILED, attempts: 5,
    })));
    expect(await enqueue({ command: 'newest', payload: {}, userId: USER })).toBe(null);
    const all = await __readQueueForTests();
    expect(all).toHaveLength(OUTBOX_MAX_ITEMS);
    expect(all.every((i) => i.status === OUTBOX_STATUS.FAILED)).toBe(true);
  });
});

describe('clearOutbox', () => {
  it('empties the queue for every user', async () => {
    await enqueue({ command: 'a', payload: {}, userId: USER });
    await enqueue({ command: 'b', payload: {}, userId: OTHER });
    await clearOutbox();
    expect(await __readQueueForTests()).toEqual([]);
  });
});
