/**
 * Pins the two rules that decide what the offline cache is allowed to put on
 * disk. Both were verified once by hand in a browser probe that was then
 * deleted, which left the most privacy-sensitive part of the offline work with
 * no automated protection at all.
 *
 * These are exactly the rules a future refactor breaks silently: add a column
 * to an allowlisted query and it rides to disk unnoticed; change the session
 * check and the tab-clobbering leak reopens. Neither shows up as a failing
 * build.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stripSignedUrls, shouldDehydrateQuery, shouldDehydrateMutation } from './query-persister';
import { setViewAs } from './viewAsState';

// The test env is node, so there is no localStorage. Stubbing it explicitly is
// better than pulling in jsdom: the fail-closed behaviour when storage THROWS
// is itself part of the contract, and a stub is the only way to test that.
let store;
function stubLocalStorage() {
  store = {};
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}
function stubThrowingLocalStorage() {
  globalThis.localStorage = {
    getItem: () => { throw new Error('storage denied (private mode)'); },
  };
}
function signedIn() { globalThis.localStorage.setItem('cr_has_session', '1'); }

const successQuery = (queryKey) => ({ state: { status: 'success' }, queryKey });

beforeEach(() => {
  stubLocalStorage();
  setViewAs(null);
});
afterEach(() => {
  setViewAs(null);
  delete globalThis.localStorage;
});

describe('stripSignedUrls — what may never reach disk', () => {
  it('removes every forbidden field from a row', () => {
    const out = stripSignedUrls({
      id: 'v1',
      // expiring signed URLs
      vehicle_photo: 'https://x/signed?token=abc',
      file_url: 'https://x/doc?token=abc',
      extra_file_urls: ['https://x/1?token=a'],
      receipt_url: 'u', license_photo_url: 'u', image_url: 'u',
      // authorization verdicts
      role: 'מנהל', share_count: 3, is_shared_with_me: true, share_role: 'צופה',
      // third-party PII
      other_driver_name: 'plaintiff', other_driver_phone: '050', witnesses: ['w'],
    });
    for (const forbidden of [
      'vehicle_photo', 'file_url', 'extra_file_urls', 'receipt_url',
      'license_photo_url', 'image_url', 'role', 'share_count',
      'is_shared_with_me', 'share_role', 'other_driver_name',
      'other_driver_phone', 'witnesses',
    ]) {
      expect(out, `${forbidden} must not reach disk`).not.toHaveProperty(forbidden);
    }
    expect(out.id).toBe('v1');
  });

  it('KEEPS the durable *_storage_path next to the stripped URL', () => {
    // The whole design depends on this pair: the signed URL expires and cannot
    // be re-minted offline, but the path can be re-signed once online. Strip
    // both and offline photos are unrecoverable rather than merely absent.
    const out = stripSignedUrls({
      vehicle_photo: 'https://x?token=abc',
      vehicle_photo_storage_path: 'accounts/a1/v1.jpg',
      file_url: 'https://x?token=abc',
      file_storage_path: 'accounts/a1/doc.pdf',
    });
    expect(out.vehicle_photo_storage_path).toBe('accounts/a1/v1.jpg');
    expect(out.file_storage_path).toBe('accounts/a1/doc.pdf');
    expect(out).not.toHaveProperty('vehicle_photo');
  });

  it('reaches fields nested inside the real snapshot shape', () => {
    // A React Query snapshot is clientState.queries[].state.data[], so a walk
    // that only checked the top level would strip nothing at all in practice.
    const out = stripSignedUrls({
      clientState: {
        queries: [{
          queryKey: ['my-vehicles', 'acc1'],
          state: { data: [{ id: 'v1', role: 'מנהל', vehicle_photo: 'https://x?token=t' }] },
        }],
      },
    });
    const row = out.clientState.queries[0].state.data[0];
    expect(row).not.toHaveProperty('role');
    expect(row).not.toHaveProperty('vehicle_photo');
    expect(row.id).toBe('v1');
  });

  it('does not mutate its input', () => {
    // The persister is handed the LIVE cache object. Mutating it would delete
    // the user's data from memory as a side effect of saving it.
    const input = { id: 'v1', role: 'מנהל' };
    const out = stripSignedUrls(input);
    expect(input.role).toBe('מנהל');
    expect(out).not.toHaveProperty('role');
  });

  it('survives primitives, null and arrays without throwing', () => {
    expect(stripSignedUrls(null)).toBe(null);
    expect(stripSignedUrls(undefined)).toBe(undefined);
    expect(stripSignedUrls('s')).toBe('s');
    expect(stripSignedUrls(7)).toBe(7);
    expect(stripSignedUrls([{ role: 'x' }])[0]).not.toHaveProperty('role');
  });

  it('leaves a non-plain object alone rather than rebuilding it', () => {
    // A naive rebuild would turn a Date into {} and corrupt the row.
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(stripSignedUrls({ when: d }).when).toBe(d);
  });

  it('does not treat an inherited property name as present', () => {
    // The hasOwnProperty guard: a `in`-based check would match names from
    // Object.prototype and clone every object the walk touched.
    const out = stripSignedUrls({ id: 'v1' });
    expect(out).toEqual({ id: 'v1' });
  });
});

describe('shouldDehydrateQuery — whether anything may be written at all', () => {
  it('persists a successful allowlisted query while signed in', () => {
    // Positive control. Without this, every assertion below could pass simply
    // because the function always returns false.
    signedIn();
    expect(shouldDehydrateQuery(successQuery(['my-vehicles', 'acc1']))).toBe(true);
  });

  it('refuses to write anything when no session exists (D-3)', () => {
    // The tab-clobbering leak: a background tab that has not yet processed
    // SIGNED_OUT would otherwise re-persist the previous identity's rows after
    // another tab wiped memory and disk.
    expect(shouldDehydrateQuery(successQuery(['my-vehicles', 'acc1']))).toBe(false);
  });

  it('refuses to write while an admin is impersonating a customer', () => {
    signedIn();
    setViewAs({ target_account_id: 'acc-customer' });
    expect(shouldDehydrateQuery(successQuery(['my-vehicles', 'acc1']))).toBe(false);
  });

  it('refuses a query that is not on the allowlist', () => {
    signedIn();
    expect(shouldDehydrateQuery(successQuery(['is-admin']))).toBe(false);
    expect(shouldDehydrateQuery(successQuery(['admin-users']))).toBe(false);
    expect(shouldDehydrateQuery(successQuery(['vehicle-share-info', 'v1']))).toBe(false);
  });

  it('refuses anything that is not a settled success', () => {
    signedIn();
    expect(shouldDehydrateQuery({ state: { status: 'error' }, queryKey: ['my-vehicles'] })).toBe(false);
    expect(shouldDehydrateQuery({ state: { status: 'pending' }, queryKey: ['my-vehicles'] })).toBe(false);
  });

  it('fails CLOSED when localStorage throws', () => {
    stubThrowingLocalStorage();
    expect(shouldDehydrateQuery(successQuery(['my-vehicles', 'acc1']))).toBe(false);
  });
});

describe('shouldDehydrateMutation', () => {
  it('never persists a mutation', () => {
    // React Query dehydrates PAUSED mutations by default. Nothing here calls
    // setMutationDefaults, so a rehydrated mutation has no mutationFn: the next
    // reconnect resumes it, it rejects, and it is reported as a user-visible
    // error for a write from a previous session. Offline writes get a real
    // outbox in Phase 3.
    expect(shouldDehydrateMutation()).toBe(false);
  });
});
