/**
 * Coverage for the ledger's replay-safety classifier.
 *
 * WHY THIS FILE EXISTS: until 2026-09-09 the classifier had no tests at all,
 * and it silently missed every data-modifying CTE. `WITH x AS (...) UPDATE t
 * ...` writes rows and begins with the word WITH, so the ^VERB anchors never
 * saw it. Two monetization files use that exact form and were both reported
 * REPLAY_SAFE without their writes ever being examined.
 *
 * That is the worst failure mode a classifier has: not a wrong answer, but a
 * right-looking answer produced without checking. Nothing else in the
 * toolchain can catch it, because the output is a verdict rather than an
 * error, and the verdict was the reassuring one.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mutationsIn, unguardedMutations } = require('./sql-ledger.cjs');

describe('mutationsIn — plain statements', () => {
  it('flags an unguarded insert', () => {
    expect(mutationsIn("insert into public.t (a) values (1)")).toEqual(['INSERT']);
  });

  it('excuses an insert guarded by on conflict', () => {
    // The normal way config rows are seeded here, and completely safe to
    // re-run. Counting it would flag dozens of files and get the whole
    // classifier ignored.
    expect(mutationsIn("insert into public.t (a) values (1) on conflict (a) do nothing")).toEqual([]);
  });

  it('flags update, delete and truncate, which have no guarded form', () => {
    expect(mutationsIn("update public.t set a = 1")).toEqual(['UPDATE']);
    expect(mutationsIn("delete from public.t where a = 1")).toEqual(['DELETE']);
    expect(mutationsIn("truncate public.t")).toEqual(['TRUNCATE']);
  });

  it('ignores a plain select', () => {
    expect(mutationsIn("select * from public.t")).toEqual([]);
  });
});

// ── the blind spot this file was written for ──────────────────────────
//
// A CTE can carry the mutation either AFTER the parens (the main clause) or
// INSIDE them (a data-modifying CTE). Both write. Both start with WITH.

describe('mutationsIn — data-modifying CTEs', () => {
  it('sees an update behind a CTE', () => {
    const sql = 'with scored as (select id from public.accounts) '
      + 'update public.account_subscriptions s set grace_until = now() '
      + 'from scored o where s.account_id = o.id';
    expect(mutationsIn(sql)).toEqual(['UPDATE']);
  });

  it('sees an unguarded insert behind a CTE', () => {
    const sql = 'with scored as (select id from public.accounts) '
      + 'insert into public.account_subscriptions (account_id) select id from scored';
    expect(mutationsIn(sql)).toEqual(['INSERT']);
  });

  it('still excuses a CTE insert guarded by on conflict', () => {
    // This is phase 1's grace backfill. It must stay REPLAY_SAFE, but now
    // because it was checked rather than because it was invisible.
    const sql = 'with scored as (select id from public.accounts) '
      + 'insert into public.account_subscriptions (account_id) select id from scored '
      + 'on conflict (account_id) do nothing';
    expect(mutationsIn(sql)).toEqual([]);
  });

  it('sees a mutation INSIDE the CTE parens, not just after them', () => {
    // WITH ins AS (INSERT ... RETURNING) SELECT ... — the main clause is a
    // SELECT, so anything that only inspects the top-level verb reads this
    // as read-only.
    const sql = 'with ins as (insert into public.audit (action) values (\'x\') returning id) '
      + 'select id from ins';
    expect(mutationsIn(sql)).toEqual(['INSERT']);
  });
});

// ── the false positives the fix had to avoid ──────────────────────────
//
// UPDATE is a keyword in two constructs that write nothing. Searching a
// whole statement for \bUPDATE\b without removing them first turns every
// row lock into a reported write, and phase 2b locks rows on purpose.

describe('mutationsIn — UPDATE as a non-mutating keyword', () => {
  it('does not flag SELECT ... FOR UPDATE', () => {
    expect(mutationsIn("select * from public.t where id = 1 for update")).toEqual([]);
  });

  it('does not flag FOR NO KEY UPDATE', () => {
    expect(mutationsIn("select * from public.t for no key update")).toEqual([]);
  });

  it('does not flag a row lock inside a CTE', () => {
    // The dangerous combination: the CTE path searches the whole statement,
    // so this is where an unguarded \bUPDATE\b would misfire.
    const sql = 'with locked as (select * from public.t for no key update) select count(*) from locked';
    expect(mutationsIn(sql)).toEqual([]);
  });

  it('does not report DO UPDATE as a second, separate mutation', () => {
    // on conflict do update is the upsert form. It must be judged as the
    // insert it is, not counted again as an update.
    const sql = "insert into public.t (a) values (1) on conflict (a) do update set a = excluded.a";
    expect(mutationsIn(sql)).not.toContain('UPDATE');
  });
});

describe('unguardedMutations — statement splitting', () => {
  it('judges each statement on its own', () => {
    // One unguarded insert among guarded ones still condemns the file: this
    // is why seed-fake-fleet is correctly dangerous while app-config is not.
    const code = "insert into public.a (x) values (1) on conflict do nothing;"
      + " insert into public.b (x) values (2);";
    expect(unguardedMutations(code)).toEqual(['INSERT']);
  });

  it('returns empty for a file that only defines things', () => {
    expect(unguardedMutations("create or replace function f() returns int language sql as 'select 1';"))
      .toEqual([]);
  });
});
