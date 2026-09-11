import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_ITEMS, MANIFEST_KEYS, defaultManifest } from './manifest';

// Resolved from this file, not from process.cwd(). The repo's eslint config
// declares no node globals, so `process` is a no-undef error here, and a
// cwd-relative path would also break the moment the suite runs from anywhere
// but the repo root.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATION = join(REPO_ROOT, 'supabase-vehicle-transfer-2026-09-11.sql');

// The applied migration is the other half of this contract. Reading the file
// is a proxy for reading the database, and an imperfect one — the file can be
// edited without being re-applied. It still catches the failure that actually
// happens, which is someone adding a checkbox to the dialog and never touching
// the SQL at all.
const sql = readFileSync(MIGRATION, 'utf8');
const acceptBody = sql.slice(
  sql.indexOf('create or replace function public.accept_vehicle_transfer'),
);

describe('transfer manifest', () => {
  it('every key the seller can tick is read by accept_vehicle_transfer', () => {
    // The whole point of this file. A key that exists only on the client is a
    // checkbox that does nothing, and nothing anywhere reports it.
    for (const key of MANIFEST_KEYS) {
      expect(acceptBody, `manifest key "${key}" is never read by the RPC`)
        .toContain(`v_manifest->>'${key}'`);
    }
  });

  it('reads no manifest key the seller cannot set', () => {
    // The mirror failure: the RPC branches on something the dialog never
    // writes, so it silently takes the coalesce default forever.
    const readByRpc = [...acceptBody.matchAll(/v_manifest->>'([a-z_]+)'/g)].map(m => m[1]);
    for (const key of new Set(readByRpc)) {
      expect(MANIFEST_KEYS, `RPC reads "${key}" but no one can set it`).toContain(key);
    }
  });

  it('defaults costs OFF and the rest ON', () => {
    // Pinned deliberately. A future edit that flips costs to true would start
    // disclosing what every seller paid for every repair, to a stranger, with
    // no visible change anywhere in the UI.
    expect(defaultManifest()).toEqual({
      services: true,
      accidents: true,
      costs: false,
    });
  });

  it('agrees with the RPC about what happens when a key is absent', () => {
    // accept_vehicle_transfer coalesces services/accidents to TRUE and costs to
    // FALSE when the key is missing from the stored jsonb. An older pending
    // offer, written before a key existed, is exactly that case — so the
    // fallbacks and the defaults have to tell the same story.
    expect(acceptBody).toContain("coalesce((v_manifest->>'services')::boolean, true)");
    expect(acceptBody).toContain("coalesce((v_manifest->>'accidents')::boolean, true)");
    expect(acceptBody).toContain("coalesce((v_manifest->>'costs')::boolean, false)");
  });

  it('gives every item something to render', () => {
    for (const item of MANIFEST_ITEMS) {
      expect(item.label, `${item.key} has no label`).toBeTruthy();
      expect(item.description, `${item.key} has no description`).toBeTruthy();
      expect(item.icon, `${item.key} has no icon`).toBeTruthy();
    }
  });
});
