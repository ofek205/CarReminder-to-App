/**
 * Every RPC the app calls must have its definition in this repo.
 *
 * WHY THIS IS A TEST AND NOT A LINT RULE: an RPC name is a STRING. No type,
 * no lint rule and no build step can tell `supabase.rpc('my_plate_quota')`
 * from `supabase.rpc('my_plate_quotaa')`. The failure is a runtime PGRST202
 * that usually lands inside a try/catch and turns into a silent no-op. This
 * is the same exposure `npm test` already pins for dal.run('name'), and the
 * same reason: the compiler cannot see it.
 *
 * It also guards a second thing, which is what it actually found when it was
 * written. The project has NO migration runner: all SQL is applied by hand
 * in the Supabase editor, and CLAUDE.md is explicit that there is no record
 * of what ran. So a function can exist in production while its source was
 * never committed. The app works, and the repo cannot rebuild it. This test
 * makes that gap visible and countable instead of invisible.
 *
 * ⚠️ BASELINE, NOT ZERO, and deliberately so. Five such functions already
 * exist (below). Asserting zero would fail on commit one and get deleted;
 * asserting "no MORE than these" lets existing debt sit while every new
 * name is checked. Same design as scripts/.query-timeout-baseline.json and
 * check-sql-hazards' baseline.
 *
 * WHEN THIS FAILS with a name you just added:
 *   • typo → fix the string;
 *   • real new function → commit its .sql file (and record it in the ledger,
 *     see CLAUDE.md);
 *   • genuinely defined elsewhere → add it below WITH the reason. Do not
 *     widen the list to make a red test green.
 *
 * ONE KNOWN FRAGILITY: the scan reads raw file text, so a `.rpc('name')`
 * written inside a COMMENT counts as a call. That is the right trade (a
 * parser would be far more code for a marginal gain, and the false positive
 * is loud and instantly obvious), but if you want to name an RPC in prose,
 * write it without the `.rpc(` call syntax.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Functions called by the app whose CREATE FUNCTION is not in this repo.
 *
 * These were applied by hand and never committed. The features work in
 * production, which is exactly why nobody noticed. Each one is a thing the
 * repo cannot rebuild.
 *
 * ⚠️ DO NOT "FIX" THESE BY DELETING THE CALLS. They are live and working.
 * The fix is to dump each definition out of production (pg_get_functiondef)
 * into a .sql file, then remove it from this list.
 */
const MISSING_FROM_REPO = new Set([
  // Admin surfaces. Shipped around v6.2.0 per the release history; the SQL
  // was applied in the editor and the file never landed.
  'admin_user_accounts',
  'admin_delete_vehicle',
  'admin_update_vehicle',
  'admin_delete_user_full',
  // Called by supabase/functions/backfill-welcome. Guards the dispatch
  // secret, so its absence from the repo is the least comfortable of the
  // five: a security check whose source nobody can review here.
  'verify_dispatch_secret',
]);

const IGNORED_DIRS = /node_modules|[\\/]dist|[\\/]\.git|worktrees|[\\/]build/;

function collect(dir, match, onFile) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (IGNORED_DIRS.test(p)) continue;
    if (entry.isDirectory()) collect(p, match, onFile);
    else if (match.test(entry.name)) onFile(p);
  }
}

/** name -> the .sql file that defines it */
function definedFunctions() {
  const defined = new Map();
  collect('.', /\.sql$/, (p) => {
    const src = fs.readFileSync(p, 'utf8');
    // Covers both `create function` and `create or replace function`, with
    // or without the public. prefix.
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)/gi;
    for (const m of src.matchAll(re)) {
      const name = m[1].toLowerCase();
      if (!defined.has(name)) defined.set(name, p);
    }
  });
  return defined;
}

/** name -> the first source file that calls it */
function calledRpcs() {
  const called = new Map();
  const onFile = (p) => {
    // Skip tests: a test may reference a name deliberately as a fixture.
    if (/\.test\./.test(p)) return;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)) {
      if (!called.has(m[1])) called.set(m[1], p);
    }
  };
  collect('src', /\.(js|jsx|ts|tsx)$/, onFile);
  collect(path.join('supabase', 'functions'), /\.(js|ts)$/, onFile);
  return called;
}

describe('RPC names resolve to committed SQL', () => {
  const defined = definedFunctions();
  const called = calledRpcs();

  it('finds both sides, so a broken scan cannot pass vacuously', () => {
    // Without this, a regex that matched nothing would make every
    // assertion below trivially true.
    expect(defined.size).toBeGreaterThan(150);
    expect(called.size).toBeGreaterThan(80);
  });

  it('has no unresolved RPC beyond the documented baseline', () => {
    const unresolved = [...called]
      .filter(([name]) => !defined.has(name) && !MISSING_FROM_REPO.has(name))
      .map(([name, file]) => `${name}  (called from ${file})`);

    expect(unresolved, [
      'These RPCs are called but no .sql in this repo defines them.',
      'A typo here is a runtime PGRST202 that a try/catch turns into silence.',
      'See the header of this file for what to do.',
    ].join('\n')).toEqual([]);
  });

  it('keeps the baseline honest: every entry is still genuinely missing', () => {
    // Stops the list rotting. Once a definition IS committed, the entry has
    // to go, or the list slowly stops meaning anything and starts hiding
    // real breakage.
    const nowDefined = [...MISSING_FROM_REPO].filter((n) => defined.has(n));
    expect(nowDefined, 'These are now committed. Remove them from MISSING_FROM_REPO.')
      .toEqual([]);
  });

  it('keeps the baseline honest: every entry is still actually called', () => {
    // If the call site is gone, the exemption is dead weight.
    const stillCalled = [...MISSING_FROM_REPO].filter((n) => called.has(n));
    expect(stillCalled.sort(), 'Entries no longer called anywhere. Remove them.')
      .toEqual([...MISSING_FROM_REPO].sort());
  });

  // The monetization work added nine SQL files that have never been
  // executed, so a name mismatch between them and their callers would not
  // surface until Ofek applies them. Named explicitly rather than left to
  // the general check, so a failure says which feature broke.
  it('resolves every monetization and consent RPC', () => {
    for (const name of [
      'my_account_plan', 'my_feature_usage', 'my_plate_quota',
      'ai_quota_check', 'feature_usage_count',
      'bump_feature_usage', 'bump_my_feature_usage', 'resolve_usage_account',
      'vehicle_cap_room', 'admin_list_plan_exceptions',
    ]) {
      expect(defined.has(name), `${name} is not defined in any repo .sql`).toBe(true);
    }
  });
});
