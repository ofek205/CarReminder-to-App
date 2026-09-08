/**
 * The offline upload path. Two properties carry the weight:
 *
 * 1. A row must never end up pointing at a file that exists nowhere. Every
 *    failure mode therefore REFUSES rather than returning a path, because a
 *    refusal is retryable and a permanently broken reference is not.
 *
 * 2. No file content ever reaches a database column. That is what
 *    `assertNotBase64` / `guardFileFields` exist to enforce and what §5.6 calls
 *    out; the blob goes to IndexedDB as a Blob and the row gets a path string.
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
    keys: async (s) => [...mapFor(s).keys()],
    clear: async (s) => { mapFor(s).clear(); },
    update: async (k, fn, s) => { const m = mapFor(s); m.set(k, fn(m.get(k))); },
  };
});

let session = { user: { id: 'user-a' } };
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session } }) } },
}));

// Track what the real uploader would have been asked to do.
let uploads = [];
let uploadShouldFail = false;
vi.mock('@/lib/supabaseStorage', async () => {
  let n = 0;
  return {
    buildStoragePath: (prefix, name) => `${prefix}/uuid-${++n}-${name || 'upload.bin'}`,
    uploadToBucket: async (file, prefix) => {
      uploads.push({ online: true, prefix, name: file.name });
      return { file_url: 'https://signed/url', storage_path: `${prefix}/direct-${file.name}` };
    },
    uploadToPath: async (file, path, opts) => {
      uploads.push({ online: false, path, sign: opts?.sign, size: file.size });
      if (uploadShouldFail) throw new Error('network died mid-upload');
      return { file_url: null, storage_path: path };
    },
  };
});

const { attachFile } = await import('./uploadQueue');
const { getBlob, clearBlobs, totalBytes, MAX_BLOB_BYTES } = await import('./blobStore');
const { listPending, clearOutbox } = await import('./outbox');
const { drainOutbox } = await import('./sync');
await import('./commands/storage');   // registers storage.upload

// A stand-in for a File. Only size/type/name are read.
const fakeFile = (name, size = 1024) => ({ name, size, type: 'image/jpeg' });

beforeEach(async () => {
  uploads = [];
  uploadShouldFail = false;
  session = { user: { id: 'user-a' } };
  await clearBlobs();
  await clearOutbox();
  onlineManager.setOnline(true);
  globalThis.URL.createObjectURL = () => 'blob:local-preview';
});

describe('attachFile while ONLINE', () => {
  it('uploads immediately and queues nothing', async () => {
    // Positive control: the offline machinery must not intercept a normal
    // upload.
    const res = await attachFile({ file: fakeFile('a.jpg'), pathPrefix: 'acc1/veh1' });
    expect(res.storage_path).toContain('acc1/veh1');
    expect(uploads[0].online).toBe(true);
    expect(await listPending('user-a')).toEqual([]);
  });
});

describe('attachFile while OFFLINE', () => {
  beforeEach(() => { onlineManager.setOnline(false); });

  it('returns the REAL final path, not a placeholder', async () => {
    // The row is written once with its permanent path, because the path is
    // computed client-side. Nothing needs patching after the upload.
    const res = await attachFile({ file: fakeFile('a.jpg'), pathPrefix: 'acc1/veh1' });
    expect(res.storage_path).toBe('acc1/veh1/uuid-1-a.jpg');
    expect(res._pendingUpload).toBe(true);
  });

  it('hands back a local URL so the image renders before the upload', async () => {
    const res = await attachFile({ file: fakeFile('a.jpg'), pathPrefix: 'acc1/veh1' });
    expect(res.file_url).toBe('blob:local-preview');
  });

  it('stores the blob as a BLOB, never as base64 in the payload', async () => {
    // §5.6's hard rule, and the reason dbGuards' assertNotBase64 keeps working
    // untouched: the queue item carries a path string, and the bytes live in
    // their own store.
    const res = await attachFile({ file: fakeFile('a.jpg', 2048), pathPrefix: 'acc1/veh1' });
    const [item] = await listPending('user-a');
    expect(item.command).toBe('storage.upload');
    expect(item.payload).toEqual({ storagePath: res.storage_path });
    expect(JSON.stringify(item.payload)).not.toMatch(/base64|data:/);

    const rec = await getBlob(res.storage_path);
    expect(rec.size).toBe(2048);
    expect(rec.userId).toBe('user-a');
  });

  it('REFUSES rather than returning a path it cannot back with a file', async () => {
    // A row pointing at a file that exists nowhere would be permanently broken.
    // A thrown error is retryable.
    await expect(attachFile({ file: fakeFile('huge.jpg', MAX_BLOB_BYTES + 1), pathPrefix: 'acc1/veh1' }))
      .rejects.toThrow(/could not store/);
    expect(await listPending('user-a')).toEqual([]);
    expect(await totalBytes()).toBe(0);
  });

  it('refuses when there is no session to own the blob', async () => {
    // The drain filters by owner, so an unowned blob could never be uploaded.
    session = null;
    await expect(attachFile({ file: fakeFile('a.jpg'), pathPrefix: 'acc1/veh1' }))
      .rejects.toThrow(/no session/);
    expect(await totalBytes()).toBe(0);
  });
});

describe('the queued upload draining', () => {
  it('uploads to the path the row already references, and frees the blob', async () => {
    onlineManager.setOnline(false);
    const res = await attachFile({ file: fakeFile('a.jpg', 4096), pathPrefix: 'acc1/veh1' });
    onlineManager.setOnline(true);

    const summary = await drainOutbox('user-a');
    expect(summary.synced).toBe(1);
    expect(uploads.at(-1)).toMatchObject({ online: false, path: res.storage_path, sign: false });
    // The local copy is only dropped after the upload confirmed.
    expect(await getBlob(res.storage_path)).toBeFalsy();
    expect(await totalBytes()).toBe(0);
  });

  it('KEEPS the blob when the upload fails', async () => {
    // The whole point of a durable queue: a failed attempt must not consume the
    // only copy of the user's photo.
    onlineManager.setOnline(false);
    const res = await attachFile({ file: fakeFile('a.jpg'), pathPrefix: 'acc1/veh1' });
    onlineManager.setOnline(true);
    uploadShouldFail = true;

    await drainOutbox('user-a');
    expect(await getBlob(res.storage_path)).toBeTruthy();
    expect(await listPending('user-a')).toHaveLength(1);
  });

  it('parks the item instead of retrying forever when the blob has vanished', async () => {
    // Quota eviction or a cleared store. Retrying cannot conjure the file back,
    // so it goes to review rather than looping.
    onlineManager.setOnline(false);
    const res = await attachFile({ file: fakeFile('a.jpg'), pathPrefix: 'acc1/veh1' });
    onlineManager.setOnline(true);
    await clearBlobs();

    const summary = await drainOutbox('user-a');
    expect(summary.failed).toBe(1);
    expect(await listPending('user-a')).toEqual([]);
    expect(uploads.some((u) => u.path === res.storage_path)).toBe(false);
  });
});
