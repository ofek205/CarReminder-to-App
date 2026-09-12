#!/usr/bin/env node
/**
 * Gate: static hazards in hand-applied SQL migrations.
 *
 * Why: this project has no migration runner. Every `supabase-*.sql` file is
 * pasted into the SQL editor by hand, the repo has drifted from the live DB,
 * and `run-staging-init.cjs` even treats "already exists" as SAFE — so an
 * ordering conflict or a privilege hole reaches production silently. A
 * multi-agent review before v6.4.0 found a SECURITY DEFINER attribution
 * trigger bug that no mechanical gate could see; this gate closes the
 * statically-decidable part of that class.
 *
 * Hazards flagged (each scoped to avoid comment/false-positive noise):
 *   SEARCH_PATH   a SECURITY DEFINER function with no `set search_path`.
 *                 Mutable search_path on a definer function is the classic
 *                 privilege-escalation vector.
 *   PUBLIC_GRANT  a SECURITY DEFINER function the file never `revoke`s from
 *                 public. Postgres grants EXECUTE to PUBLIC by default, so a
 *                 definer function is world-executable unless revoked
 *                 (documented hazard: supabase-security-hotfix-2026-06-06.sql).
 *   POLICY_IDEM   `create policy` with no matching `drop policy if exists`
 *                 (name+table) — fails on re-apply with "already exists".
 *   TRIGGER_IDEM  `create trigger` with no matching `drop trigger if exists`.
 *   COLUMN_IDEM   `alter table … add column` without `if not exists`.
 *   TABLE_IDEM    `create table` without `if not exists`.
 *
 * Baseline mechanism (identical to scripts/check-query-timeouts.cjs): per-file
 * violation counts live in scripts/.sql-hazard-baseline.json; the gate fails
 * only when a file's count RISES above its baseline. Existing debt is
 * grandfathered; new SQL must be clean. `--update-baseline` re-records.
 *
 * STATUS, and read it precisely, because this comment has lied before.
 *
 *   .githooks/pre-push          WIRED, gate 8, since 2026-09-11.
 *   production-gates.yml        NOT wired. There is no CI backstop.
 *
 * An earlier version of this block claimed both, while a grep for the script
 * name across the whole repo returned nothing but this file. It is the
 * reason gate 5 (DB Safety) sat automated-on-paper and unautomated in fact,
 * so the split above is written as two lines that can each be checked rather
 * than one sentence that can be half true.
 *
 * Baselined at the same moment it was wired: 237 hazards across 81 files.
 * With no .sql-hazard-baseline.json every finding counts as a regression and
 * a cold run would block every push, which is precisely why it went unwired
 * for so long. `--update-baseline` re-records after a deliberate change.
 *
 * Complements scripts/sql-ledger.cjs rather than duplicating it: the ledger
 * classifies re-run safety and records what was applied; this finds security
 * and idempotency defects inside the SQL itself.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, '.sql-hazard-baseline.json');

// Root-level supabase-*.sql migration fragments (the hand-applied set). Seeds
// and one-shot data mutations are migrations too — they still must not break
// on the idempotency checks — so they are in scope.
function sqlFiles() {
  return fs.readdirSync(ROOT)
    .filter((f) => /^supabase.*\.sql$/i.test(f))
    .map((f) => path.join(ROOT, f));
}

const lineAt = (content, index) => content.slice(0, index).split('\n').length;

/**
 * Walk a SQL file and return each CREATE FUNCTION with its header text (the
 * part before the body's opening dollar-quote, where SECURITY DEFINER and SET
 * search_path live) and its name. Dollar-quote aware so a `$$ … $$` body — which
 * can itself contain the word "function" or "policy" — is skipped, not scanned.
 */
function findFunctions(content) {
  const out = [];
  const re = /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:(?:public|auth|storage)\.)?"?([a-zA-Z0-9_]+)"?/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    const sigStart = m.index;
    // The body opens at the first `as $tag$` after the signature. The header is
    // everything between the CREATE and that opener.
    const openRe = /\bas\s+(\$[a-zA-Z0-9_]*\$)/gi;
    openRe.lastIndex = re.lastIndex;
    const open = openRe.exec(content);
    let headerEnd, bodyEnd;
    if (open) {
      headerEnd = open.index;
      const tag = open[1];
      const close = content.indexOf(tag, open.index + open[0].length);
      bodyEnd = close === -1 ? content.length : close + tag.length;
    } else {
      // No dollar-quoted body (rare one-liner form). Header runs to the next `;`.
      headerEnd = content.indexOf(';', sigStart);
      if (headerEnd === -1) headerEnd = content.length;
      bodyEnd = headerEnd;
    }
    out.push({
      name,
      line: lineAt(content, sigStart),
      header: content.slice(sigStart, headerEnd),
      bodyEnd,
    });
    re.lastIndex = bodyEnd; // resume past the body so its text is never scanned
  }
  return out;
}

// Names appearing in any `revoke … from public` statement in the file.
function revokedFromPublic(content) {
  const names = new Set();
  const re = /\brevoke\b[\s\S]{0,300}?\bfrom\s+public\b/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const seg = m[0];
    const fn = /\bfunction\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi;
    let f;
    while ((f = fn.exec(seg)) !== null) names.add(f[1].toLowerCase());
    // A blanket `revoke … on all functions in schema public from public`
    // covers everything.
    if (/all\s+functions\s+in\s+schema/i.test(seg)) names.add('*');
  }
  return names;
}

// Extract (name, table) pairs for create/drop of a given object kind.
function pairs(content, verb) {
  // e.g. create policy "x" on public.t   /   drop policy if exists "x" on public.t
  const re = new RegExp(
    `\\b${verb}\\s+(?:if\\s+exists\\s+)?"?([a-zA-Z0-9_]+)"?\\s+on\\s+(?:(?:public|auth|storage)\\.)?"?([a-zA-Z0-9_]+)"?`,
    'gi'
  );
  const set = new Set();
  const list = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    const key = `${m[1].toLowerCase()}::${m[2].toLowerCase()}`;
    set.add(key);
    list.push({ key, line: lineAt(content, m.index) });
  }
  return { set, list };
}

// Trigger create/drop are `… on <table>` too but the drop form is
// `drop trigger if exists <name> on <table>` — same shape as policy.
function checkFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const v = [];

  // SEARCH_PATH + PUBLIC_GRANT — per SECURITY DEFINER function.
  const revoked = revokedFromPublic(content);
  const blanketRevoke = revoked.has('*');
  for (const fn of findFunctions(content)) {
    if (!/security\s+definer/i.test(fn.header)) continue;
    if (!/set\s+search_path/i.test(fn.header)) {
      v.push({ type: 'SEARCH_PATH', line: fn.line, detail: fn.name });
    }
    if (!blanketRevoke && !revoked.has(fn.name.toLowerCase())) {
      v.push({ type: 'PUBLIC_GRANT', line: fn.line, detail: fn.name });
    }
  }

  // POLICY_IDEM
  const cp = pairs(content, 'create\\s+policy');
  const dp = pairs(content, 'drop\\s+policy');
  for (const c of cp.list) {
    if (!dp.set.has(c.key)) v.push({ type: 'POLICY_IDEM', line: c.line, detail: c.key });
  }

  // TRIGGER_IDEM
  const ct = pairs(content, 'create\\s+trigger');
  const dt = pairs(content, 'drop\\s+trigger');
  for (const c of ct.list) {
    if (!dt.set.has(c.key)) v.push({ type: 'TRIGGER_IDEM', line: c.line, detail: c.key });
  }

  // COLUMN_IDEM — add column without if not exists
  let m;
  const addCol = /\badd\s+column\s+(?!if\s+not\s+exists)/gi;
  while ((m = addCol.exec(content)) !== null) {
    v.push({ type: 'COLUMN_IDEM', line: lineAt(content, m.index), detail: 'add column' });
  }

  // TABLE_IDEM — create table without if not exists
  const createTbl = /\bcreate\s+table\s+(?!if\s+not\s+exists)/gi;
  while ((m = createTbl.exec(content)) !== null) {
    v.push({ type: 'TABLE_IDEM', line: lineAt(content, m.index), detail: 'create table' });
  }

  return v;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); } catch { return {}; }
}
function saveBaseline(counts) {
  const filtered = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(filtered, Object.keys(filtered).sort(), 2) + '\n', 'utf8');
}

function main() {
  const files = sqlFiles();
  const byFile = {};
  const all = {};
  for (const f of files) {
    const v = checkFile(f);
    if (v.length) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      byFile[rel] = v.length;
      all[rel] = v;
    }
  }

  if (process.argv.includes('--update-baseline')) {
    saveBaseline(byFile);
    const total = Object.values(byFile).reduce((a, b) => a + b, 0);
    console.log(`\x1b[0;33m[baseline updated] ${Object.keys(byFile).length} file(s), ${total} hazard(s) recorded.\x1b[0m`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  const regressions = Object.entries(byFile).filter(([f, n]) => n > (baseline[f] || 0));

  if (regressions.length === 0) {
    const cur = Object.values(byFile).reduce((a, b) => a + b, 0);
    const base = Object.values(baseline).reduce((a, b) => a + b, 0);
    console.log(`\x1b[0;32m[ok] check-sql-hazards: ${files.length} migration file(s) scanned. ${cur} grandfathered hazard(s) at or below baseline (${base}).\x1b[0m`);
    process.exit(0);
  }

  console.error(`\x1b[0;31m[BLOCKED] check-sql-hazards: new SQL hazard(s) beyond baseline.\x1b[0m\n`);
  for (const [file, count] of regressions) {
    console.error(`  ${file} — ${count} hazard(s), baseline allows ${baseline[file] || 0}`);
    for (const h of all[file]) console.error(`    line ${h.line}  ${h.type}  (${h.detail})`);
    console.error('');
  }
  console.error('Fixes: add `set search_path = public` + `revoke execute … from public` to SECURITY DEFINER');
  console.error('functions; precede create policy/trigger with `drop … if exists`; use `if not exists` on');
  console.error('add column / create table. If intentional, run:');
  console.error('    node scripts/check-sql-hazards.cjs --update-baseline\n');
  process.exit(1);
}

main();
