import { describe, it, expect } from 'vitest';
import { documentStoragePaths } from './documentFiles';

// The row shapes the documents screen actually produces: a single upload, a
// multi-file upload, a guest/legacy base64 row, and the mixed row you get when
// one pick uploaded and another fell back to base64.
const single = {
  file_url: 'https://signed/one',
  storage_path: 'acct/veh/one.pdf',
};
const multi = {
  file_url: 'https://signed/one',
  storage_path: 'acct/veh/one.pdf',
  extra_file_urls: ['https://signed/two', 'https://signed/three'],
  extra_storage_paths: ['acct/veh/two.pdf', 'acct/veh/three.pdf'],
};
const legacyBase64 = {
  file_url: 'data:image/png;base64,AAAA',
  storage_path: '',
  extra_file_urls: ['data:image/png;base64,BBBB'],
  extra_storage_paths: [''],
};

describe('documentStoragePaths', () => {
  it('returns the primary path for a single-file document', () => {
    expect(documentStoragePaths(single)).toEqual(['acct/veh/one.pdf']);
  });

  it('returns the primary AND every extra for a multi-file document', () => {
    // The whole point of the helper: deleting only `storage_path` would leak
    // two of the three files on a row like this.
    expect(documentStoragePaths(multi)).toEqual([
      'acct/veh/one.pdf',
      'acct/veh/two.pdf',
      'acct/veh/three.pdf',
    ]);
  });

  it('drops empty paths so Storage is never asked to remove the bucket root', () => {
    expect(documentStoragePaths(legacyBase64)).toEqual([]);
  });

  it('keeps the uploaded path when only some picks reached the bucket', () => {
    expect(documentStoragePaths({
      storage_path: '',
      extra_storage_paths: ['', 'acct/veh/real.pdf', null, undefined],
    })).toEqual(['acct/veh/real.pdf']);
  });

  it('tolerates a row with no file fields at all', () => {
    expect(documentStoragePaths({ title: 'no attachment' })).toEqual([]);
  });

  it('tolerates a missing row instead of throwing', () => {
    // handleDelete looks the row up by id; a miss must not break the delete.
    expect(documentStoragePaths(undefined)).toEqual([]);
    expect(documentStoragePaths(null)).toEqual([]);
  });

  it('ignores a non-array extra_storage_paths', () => {
    expect(documentStoragePaths({
      storage_path: 'acct/veh/one.pdf',
      extra_storage_paths: 'acct/veh/two.pdf',
    })).toEqual(['acct/veh/one.pdf']);
  });

  it('de-duplicates repeated paths', () => {
    expect(documentStoragePaths({
      storage_path: 'acct/veh/one.pdf',
      extra_storage_paths: ['acct/veh/one.pdf', 'acct/veh/two.pdf'],
    })).toEqual(['acct/veh/one.pdf', 'acct/veh/two.pdf']);
  });

  it('does not treat a whitespace-only path as a real key', () => {
    expect(documentStoragePaths({ storage_path: '   ' })).toEqual([]);
  });
});
