/**
 * Only a deliberate, listed callsite may write a file to the PERSONAL
 * `scans/{user_id}` prefix. Everything else must anchor on account_id.
 *
 * WHY THIS IS A TEST. The Storage policy on `vehicle-files` has two arms:
 *
 *   folder[1] IN (accounts the user is an active member of)     ← shared
 *   OR (folder[1] = 'scans' AND folder[2] = auth.uid()::text)   ← personal
 *
 * A file written to the second arm is signable ONLY by the exact user who
 * uploaded it. That is correct for a driving-licence photo and wrong for
 * anything the ACCOUNT owns, because the row points at the account while the
 * file sits outside it. The co-owner of a shared vehicle, a driver, and an
 * admin viewing as the user all get a card that silently refuses to open —
 * no error, no log, nothing to notice. It is invisible until a human reports
 * "I cannot see my document", which is exactly how it was found.
 *
 * Nothing else can catch this. It is a string prefix, so there is no type to
 * check; the upload SUCCEEDS, so there is no error to report; and the
 * uploader can always read their own file, so it works perfectly for whoever
 * would have noticed. It only breaks for someone else, later.
 *
 * The cost is already on the board twice: 26 vehicle photos stranded at
 * `scans/{old-uid}` by the 2026-05-31 account migration, and 21 document
 * rows found on 2026-09-26 whose files no second person can open.
 *
 * WHEN THIS FAILS: you added an upload. Ask who must be able to READ it.
 *   • anyone in the account (a document, a vehicle photo, a receipt on a
 *     shared vehicle) → pass accountId and let the path be account-scoped.
 *     This is almost always the answer.
 *   • that one human being and nobody else → add the file below WITH the
 *     reason. Do not widen the list to turn a red test green.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Files allowed to target the personal prefix, and why each one is personal
 * rather than account-owned.
 */
const ALLOWED = {
  'src/lib/supabaseStorage.js':
    'defines uploadScanFile() itself — the helper every entry below calls',
  'src/components/profile/DriverLicenseScanDialog.jsx':
    'a driving licence belongs to the person, not to any account they are in',
  'src/components/vehicle/VesselScanWizard.jsx':
    'vessel licence scan, captured before any vehicle or account row exists',
  'src/components/expenses/ExpenseFormDialog.jsx':
    'expense receipt, filed against the user who paid',
  'src/pages/Expenses.jsx':
    'same receipt upload, from the list screen',
};

/** Every source file under src/, excluding tests. */
function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { sourceFiles(full, out); continue; }
    if (!/\.jsx?$/.test(entry.name)) continue;
    if (entry.name.endsWith('.test.js') || entry.name.endsWith('.test.jsx')) continue;
    out.push(full);
  }
  return out;
}

describe('personal scans/ storage prefix', () => {
  it('is written to only by the listed, deliberate callsites', () => {
    const offenders = [];

    for (const file of sourceFiles('src')) {
      const src = fs.readFileSync(file, 'utf8');
      // Two ways to reach the prefix: the helper, or building the path by
      // hand. Both are matched on CALL/TEMPLATE syntax rather than on the
      // bare word, so prose that merely mentions scans/ does not trip this.
      const usesHelper = src.includes('uploadScanFile(');
      const buildsPath = src.includes('scans/${');
      if (!usesHelper && !buildsPath) continue;

      const rel = file.split(path.sep).join('/');
      if (!(rel in ALLOWED)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it('is unreachable from useFileUpload, the shared account-scoped hook', () => {
    // The regression this pins directly. The hook used to fall back to
    // `scans/${userId}` when accountId was null — which cannot be told apart
    // from "the account has not loaded yet", so an ordinary render race sent
    // account-owned files into the personal prefix. It now refuses instead.
    const src = fs.readFileSync('src/hooks/useFileUpload.js', 'utf8');
    expect(src.includes('scans/${')).toBe(false);
    expect(src.includes('uploadScanFile(')).toBe(false);
  });

  it('keeps every allowlist entry honest — no stale names', () => {
    // An entry that no longer exists means the list is drifting out of date
    // and quietly granting permission to nothing.
    for (const rel of Object.keys(ALLOWED)) {
      expect(fs.existsSync(rel), `${rel} is listed but does not exist`).toBe(true);
    }
  });
});
