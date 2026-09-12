/**
 * Guards the bug class that took phase 2b down on 2026-09-09: a statement
 * line duplicated with only a comment between the copies, which left a
 * migration PARTIALLY APPLIED against the database staging shares with
 * production.
 *
 * ⚠️ WHERE THIS ACTUALLY BLOCKS. `npm test` runs in .githooks/pre-push, so
 * locally this stops a push. It also runs as the `Unit tests` job on every
 * PR to main, but as of 2026-09-10 that job is NOT among the ruleset's
 * required checks (Build, Lint, Query timeout gate, View-as identity gate),
 * so in CI it is advisory until that changes. The pre-push hook is the
 * binding half today.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { findDuplicateStatements, sqlFiles } = require('./sql-duplicate-statements.cjs');

// The real thing, reduced to its shape. This exact text failed in the
// Supabase editor with `syntax error at or near "public"` pointing at the
// SECOND copy, which is why the reported line looked fine on its own.
const THE_PHASE_2B_BUG = `
  s_old := public.admin_lock_subscription(p_account_id);

  update public.account_subscriptions
  -- ⚠️ DOES NOT TOUCH ovr_note. That column answers "why is this account
  -- an exception", and the exceptions screen renders it as THE reason.
  update public.account_subscriptions
     set grace_until = p_until
   where account_id = p_account_id;
`;

describe('findDuplicateStatements — the bug it was written for', () => {
  it('catches the phase 2b duplication', () => {
    const hits = findDuplicateStatements(THE_PHASE_2B_BUG);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('update public.account_subscriptions');
    // Both line numbers are reported, because "which one do I delete" is
    // the first question the reader has.
    expect(hits[0].first).toBeLessThan(hits[0].second);
  });

  it('catches it across any number of comment lines and blanks', () => {
    const sql = 'update public.t\n--a\n\n--b\n\n--c\nupdate public.t\n set x = 1;';
    expect(findDuplicateStatements(sql)).toHaveLength(1);
  });

  it('catches a duplicated CTE opener', () => {
    // Same mistake, and both phase 1's backfill and the grandfather freeze
    // begin with WITH.
    const sql = 'with owned as (select 1)\n-- note\nwith owned as (select 1)\nupdate public.t set x = 1;';
    expect(findDuplicateStatements(sql)).toHaveLength(1);
  });

  it('reports every occurrence, not just the first', () => {
    const sql = 'update public.a\n--x\nupdate public.a\n set y=1;\n'
      + 'insert into public.b\n--x\ninsert into public.b\n values (1);';
    expect(findDuplicateStatements(sql)).toHaveLength(2);
  });
});

// ── the false positives that would make it useless ──────────────────────
//
// A statement start repeated ELSEWHERE in a file is completely normal:
// dozens of functions in this repo contain `update public.x`. If the check
// flagged that, it would fire on most files and get deleted within a week.

describe('findDuplicateStatements — what it must not flag', () => {
  it('ignores the same statement far apart, separated by real code', () => {
    const sql = 'update public.t set a = 1;\n\nperform f();\n\nupdate public.t set a = 2;';
    expect(findDuplicateStatements(sql)).toEqual([]);
  });

  it('ignores two identical COMPLETE statements in a row', () => {
    // Legal, if pointless. Only an unterminated stub can be the bug.
    const sql = 'select 1;\nselect 1;';
    expect(findDuplicateStatements(sql)).toEqual([]);
  });

  it('ignores a UNION, where the repeat is real syntax', () => {
    const sql = 'select 1\nunion all\nselect 1;';
    expect(findDuplicateStatements(sql)).toEqual([]);
  });

  it('ignores a multi-row VALUES list', () => {
    const sql = 'insert into public.t (a) values\n  (1),\n  (2);';
    expect(findDuplicateStatements(sql)).toEqual([]);
  });

  it('ignores repeated grants, which are terminated one per line', () => {
    // The monetization files end with runs of these.
    const sql = 'revoke all on function public.f() from public;\n'
      + 'revoke all on function public.f() from anon;\n'
      + 'grant execute on function public.f() to authenticated;';
    expect(findDuplicateStatements(sql)).toEqual([]);
  });

  it('handles CRLF, which every file in this repo uses', () => {
    // JS `.` does not match \r, and a checker written without this in mind
    // silently matches nothing. That mistake was made once already while
    // verifying these same files.
    const sql = 'update public.t\r\n-- note\r\nupdate public.t\r\n set x = 1;';
    expect(findDuplicateStatements(sql)).toHaveLength(1);
  });

  it('is empty for an empty file', () => {
    expect(findDuplicateStatements('')).toEqual([]);
  });
});

describe('every .sql file in the repo', () => {
  const files = sqlFiles();

  it('finds the SQL files, so a broken walk cannot pass vacuously', () => {
    // Without this, a walk that returned nothing would make the assertion
    // below trivially true, which is the failure mode of every whole-repo
    // check.
    expect(files.length).toBeGreaterThan(200);
  });

  it('has no duplicated statement starts', () => {
    const offenders = [];
    for (const f of files) {
      for (const h of findDuplicateStatements(fs.readFileSync(f, 'utf8'))) {
        offenders.push(`${f} lines ${h.first} & ${h.second}: ${h.text}`);
      }
    }
    // No baseline on purpose: this shape is never valid SQL, so the correct
    // number is zero and every repo file already satisfies it.
    expect(offenders).toEqual([]);
  });
});
