#!/usr/bin/env node
/**
 * sql-ledger — classify and fingerprint the hand-applied SQL in this repo.
 *
 * WHY THIS EXISTS
 * ---------------
 * This project has no migration runner. Every .sql file is pasted into the
 * Supabase SQL editor by hand, and until now nothing recorded what was run,
 * when, or against which database. staging and prod share one database, so a
 * mistake is a production mistake immediately.
 *
 * The ledger lives in Postgres (see supabase-sql-ledger-2026-09-01.sql). This
 * script is the local half: it fingerprints files and tells you which ones are
 * safe to re-run and which would cause damage.
 *
 * WHY NOT JUST REPLAY EVERYTHING
 * ------------------------------
 * Because the order is unrecoverable. 45 functions are defined in more than
 * one file -- email_dispatch_candidates() alone is written in six -- and 70
 * files share a commit with another .sql file, so git timestamps cannot break
 * the tie. A replay that runs cleanly and silently reverts a dozen
 * security-hardened functions is worse than no replay, because it looks like
 * it worked. The database is the source of truth; these files are a changelog
 * of how it might have got there.
 *
 * COMMANDS
 *   node scripts/sql-ledger.cjs scan            classify every .sql file
 *   node scripts/sql-ledger.cjs scan --json     same, machine-readable
 *   node scripts/sql-ledger.cjs hash <file>     sha256 of one file
 *   node scripts/sql-ledger.cjs record <file>   emit the SQL to log an apply
 *   node scripts/sql-ledger.cjs drift           files whose content changed
 *                                               since a recorded hash (needs
 *                                               ledger-export.json, see below)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Remove dollar-quoted bodies ($$ ... $$ / $tag$ ... $tag$) and comments.
 *
 * This is the whole game. A naive scan counts every INSERT/UPDATE inside a
 * CREATE FUNCTION body as a migration-time write and flags ~96 of 199 files as
 * dangerous. Stripping bodies first gives the true number, which is 17. Getting
 * this wrong in the safe direction means quarantining harmless files; getting
 * it wrong the other way means a seed file lands in the "replayable" pile.
 */
function stripBodiesAndComments(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    // line comment
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    // block comment
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    // single-quoted string
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      out += ' ';
      i = j;
      continue;
    }
    // dollar quote
    if (sql[i] === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        out += ' ';
        i = end === -1 ? sql.length : end + tag.length;
        continue;
      }
    }
    out += sql[i];
    i++;
  }
  return out;
}

/**
 * Find top-level data mutations that are NOT guarded.
 *
 * The distinction that matters: `INSERT ... ON CONFLICT DO NOTHING` is
 * completely safe to re-run and is the normal way config rows are seeded here.
 * Counting it as dangerous flags 42 files when the real number is far lower,
 * and a classifier that cries wolf gets ignored -- which is worse than not
 * having one. So each statement is judged on its own rather than the file as a
 * whole: one unguarded INSERT among ten guarded ones still condemns the file,
 * which is why seed-fake-fleet (2 ON CONFLICT across 4 insert targets) is
 * correctly dangerous while app-config (1 for 1) is correctly safe.
 *
 * UPDATE / DELETE / TRUNCATE have no guarded form. They always count.
 */
/**
 * The mutations a SINGLE statement performs.
 *
 * ⚠️ A DATA-MODIFYING CTE HIDES THE VERB, AND THAT WAS A REAL BLIND SPOT.
 *   Both of these write rows, and both begin with the word WITH:
 *     WITH x AS (...) UPDATE t SET ...
 *     WITH x AS (INSERT INTO t ... RETURNING *) SELECT ...
 *   The `^VERB` anchors below therefore never saw them. Two monetization
 *   files use exactly that form (phase 1's grace backfill and the 2026-09-09
 *   grandfather freeze) and were both reported REPLAY_SAFE without their
 *   writes ever being looked at. They happen to be safe, but this function
 *   is not what established that, which is the worst way for a classifier to
 *   be right.
 *
 *   For a WITH statement the verbs are collected from ANYWHERE in it, at any
 *   paren depth: a mutation inside a CTE body mutates exactly as much as one
 *   in the main clause.
 *
 * ⚠️ AND `UPDATE` IS A KEYWORD IN TWO PLACES THAT WRITE NOTHING.
 *     SELECT ... FOR UPDATE / FOR NO KEY UPDATE   row locking
 *     INSERT ... ON CONFLICT DO UPDATE            the upsert form
 *   Searching a whole statement for \bUPDATE\b without removing those first
 *   turns every row lock into a reported write. phase 2b locks rows that way
 *   on purpose, so this is not hypothetical.
 */
function mutationsIn(s) {
  const out = [];
  // Neutralise the non-mutating uses of the UPDATE keyword before looking.
  const clean = s
    .replace(/\bFOR\s+(NO\s+KEY\s+)?UPDATE\b/gi, ' ')
    .replace(/\bDO\s+UPDATE\b/gi, ' ');
  const guarded = /\bON\s+CONFLICT\b/i.test(s);
  const notSearchPath = !/\bSET\s+search_path\b/i.test(clean);

  if (/^WITH\b/i.test(clean)) {
    // Unanchored: the verb can sit before or inside the CTE parens.
    if (/\bINSERT\s+INTO\b/i.test(clean) && !guarded) out.push('INSERT');
    if (/\bUPDATE\b/i.test(clean) && notSearchPath) out.push('UPDATE');
    if (/\bDELETE\s+FROM\b/i.test(clean)) out.push('DELETE');
    if (/\bTRUNCATE\b/i.test(clean)) out.push('TRUNCATE');
    return out;
  }

  // Plain statement: the leading verb decides, as before.
  if (/^INSERT\s+INTO\b/i.test(clean)) {
    if (!guarded) out.push('INSERT');
  } else if (/^UPDATE\b/i.test(clean) && notSearchPath) {
    out.push('UPDATE');
  } else if (/^DELETE\s+FROM\b/i.test(clean)) {
    out.push('DELETE');
  } else if (/^TRUNCATE\b/i.test(clean)) {
    out.push('TRUNCATE');
  }
  return out;
}

function unguardedMutations(code) {
  const found = [];
  for (const stmt of code.split(';')) {
    const s = stmt.trim();
    if (!s) continue;
    found.push(...mutationsIn(s));
  }
  return found;
}

/**
 * pg_cron: `cron.schedule('name', ...)` replaces a job with the same name, so
 * the named form is effectively idempotent. The two-argument anonymous form
 * creates a new job on every run. Only the latter is a hazard, but both are
 * worth a human glance before re-applying.
 */
function cronCalls(code) {
  const named = /\bcron\.schedule\s*\(\s*'[^']+'\s*,/i.test(code);
  const any = /\bcron\.schedule\s*\(/i.test(code);
  if (!any) return null;
  return named ? 'CRON_NAMED' : 'CRON_ANONYMOUS';
}

const RULES = {
  // Structural statements that throw on a second run.
  bareCreateTable: /(^|;|\n)\s*CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i,
  bareCreateIndex: /(^|;|\n)\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS|CONCURRENTLY\s+IF\s+NOT\s+EXISTS)/i,
  bareAddColumn: /\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i,
  unguardedDrop: /(^|;|\n)\s*DROP\s+(TABLE|COLUMN|FUNCTION|POLICY|TRIGGER|VIEW)\s+(?!IF\s+EXISTS)/i,
  // Idempotency markers.
  createOrReplace: /\bCREATE\s+OR\s+REPLACE\b/i,
  ifNotExists: /\bIF\s+NOT\s+EXISTS\b/i,
  dropIfExists: /\bDROP\s+[A-Z ]*IF\s+EXISTS\b/i,
  // Self-declared intent, written by whoever authored the file.
  declaresOnce: /run\s+once|הרץ\s+פעם\s+אחת|one[- ]time/i,
};

function classify(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const code = stripBodiesAndComments(raw);
  const hit = (k) => RULES[k].test(code);

  const hazards = [];
  const muts = unguardedMutations(code);
  if (muts.length) hazards.push(`UNGUARDED_${[...new Set(muts)].sort().join('+')}(${muts.length})`);
  const cron = cronCalls(code);
  if (cron) hazards.push(cron);
  if (hit('bareCreateTable')) hazards.push('BARE_CREATE_TABLE');
  if (hit('bareCreateIndex')) hazards.push('BARE_CREATE_INDEX');
  if (hit('bareAddColumn')) hazards.push('BARE_ADD_COLUMN');
  if (hit('unguardedDrop')) hazards.push('UNGUARDED_DROP');

  // Three tiers, by what a second run actually does to you:
  //   ONE_TIME_DATA — rewrites or duplicates rows. Silent corruption. Never re-run.
  //   NEEDS_REVIEW  — throws partway, or registers a cron job. Loud, or needs a look.
  //   REPLAY_SAFE   — guarded throughout.
  const oneTimeData = muts.length > 0;
  const needsReview =
    cron === 'CRON_ANONYMOUS' ||
    hit('bareCreateTable') ||
    hit('bareCreateIndex') ||
    hit('bareAddColumn') ||
    hit('unguardedDrop');

  return {
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    bytes: raw.length,
    verdict: oneTimeData ? 'ONE_TIME_DATA' : needsReview ? 'NEEDS_REVIEW' : 'REPLAY_SAFE',
    hazards,
    guards: [
      hit('createOrReplace') && 'CREATE_OR_REPLACE',
      hit('ifNotExists') && 'IF_NOT_EXISTS',
      hit('dropIfExists') && 'DROP_IF_EXISTS',
    ].filter(Boolean),
    authorSaysRunOnce: hit('declaresOnce') || RULES.declaresOnce.test(raw),
  };
}

function collect() {
  const dirs = [ROOT, path.join(ROOT, 'sql', 'archive'), path.join(ROOT, 'sql', 'archive', 'one-time-data')];
  const seen = new Map();
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const name of fs.readdirSync(d)) {
      if (!name.toLowerCase().endsWith('.sql')) continue;
      const full = path.join(d, name);
      if (!fs.statSync(full).isFile()) continue;
      seen.set(full, true);
    }
  }
  return [...seen.keys()].sort();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdScan(asJson) {
  const results = collect().map(classify);
  if (asJson) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return 0;
  }
  const counts = results.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});
  const oneTime = results.filter((r) => r.verdict === 'ONE_TIME_DATA');
  const review = results.filter((r) => r.verdict === 'NEEDS_REVIEW');

  console.log(`\nscanned ${results.length} .sql files\n`);
  console.log(`  REPLAY_SAFE     ${counts.REPLAY_SAFE || 0}`);
  console.log(`  NEEDS_REVIEW    ${counts.NEEDS_REVIEW || 0}   <- throws, or registers a cron job`);
  console.log(`  ONE_TIME_DATA   ${counts.ONE_TIME_DATA || 0}   <- NEVER re-run: rewrites or duplicates rows\n`);

  if (oneTime.length) {
    console.log('ONE_TIME_DATA — a second run silently changes data:');
    for (const r of oneTime) console.log(`  ${r.file}\n      ${r.hazards.join(', ')}`);
    console.log('');
  }
  if (review.length) {
    console.log('NEEDS_REVIEW — look before re-applying:');
    for (const r of review) console.log(`  ${r.file}\n      ${r.hazards.join(', ')}`);
    console.log('');
  }
  const disagree = results.filter((r) => r.authorSaysRunOnce && r.verdict === 'REPLAY_SAFE');
  if (disagree.length) {
    console.log(`${disagree.length} file(s) say "run once" in their own text but scan as replay-safe.`);
    console.log('Trust the author over the scanner — they may know something structural does not show.\n');
  }
  return 0;
}

function cmdHash(file) {
  const full = path.resolve(ROOT, file);
  if (!fs.existsSync(full)) { console.error(`not found: ${file}`); return 1; }
  console.log(crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
  return 0;
}

function cmdRecord(file) {
  const full = path.resolve(ROOT, file);
  if (!fs.existsSync(full)) { console.error(`not found: ${file}`); return 1; }
  const c = classify(full);
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  console.log(`
-- Paste this into the Supabase SQL editor immediately AFTER running the file.
-- The hash pins the exact bytes you applied, so a later edit to the file is
-- detectable with:  node scripts/sql-ledger.cjs drift
select public.sql_ledger_record(
  p_filename       => ${q(c.file)},
  p_sha256         => ${q(c.sha256)},
  p_verdict        => ${q(c.verdict)},
  p_target         => 'shared',          -- staging and prod are one database
  p_notes          => 'TODO: what did you verify after applying?'
);
`);
  return 0;
}

function cmdDrift() {
  const exportPath = path.join(ROOT, 'scripts', 'ledger-export.json');
  if (!fs.existsSync(exportPath)) {
    console.error(
      'scripts/ledger-export.json not found.\n\n' +
      'Produce it from the database:\n' +
      "  select json_agg(json_build_object('filename', filename, 'sha256', sha256))\n" +
      '  from public.sql_ledger where rolled_back_at is null;\n\n' +
      'Save the result to scripts/ledger-export.json, then re-run.'
    );
    return 1;
  }
  const recorded = new Map(JSON.parse(fs.readFileSync(exportPath, 'utf8')).map((r) => [r.filename, r.sha256]));
  const current = new Map(collect().map(classify).map((r) => [r.file, r.sha256]));

  const changed = [];
  const missing = [];
  for (const [name, hash] of recorded) {
    if (!current.has(name)) missing.push(name);
    else if (current.get(name) !== hash) changed.push(name);
  }
  const unrecorded = [...current.keys()].filter((n) => !recorded.has(n));

  if (changed.length) {
    console.log(`\nCHANGED SINCE APPLIED (${changed.length}) — the database ran different bytes than the file now holds:`);
    changed.forEach((n) => console.log(`  ${n}`));
  }
  if (missing.length) {
    console.log(`\nRECORDED BUT FILE GONE (${missing.length}):`);
    missing.forEach((n) => console.log(`  ${n}`));
  }
  console.log(`\nNOT IN THE LEDGER (${unrecorded.length}) — applied before the ledger existed, or never applied.`);
  console.log('The ledger starts at the baseline dump; older files are expected here.\n');
  return changed.length ? 1 : 0;
}

// ⚠️ GUARDED, SO THIS FILE CAN BE REQUIRED BY A TEST. Unguarded, the
// dispatch ran on import and then called process.exit, which kills the
// vitest worker rather than failing a test. The classifier had no coverage
// at all until 2026-09-09, which is how a data-modifying CTE went unseen;
// the exports below are what let sql-ledger.test.js reach the logic.
// require.main === module is still true for every CLI invocation, so
// nothing about running it by hand changes.
if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  let code = 0;
  switch (cmd) {
    case 'scan':   code = cmdScan(arg === '--json'); break;
    case 'hash':   code = cmdHash(arg); break;
    case 'record': code = cmdRecord(arg); break;
    case 'drift':  code = cmdDrift(); break;
    default:
      console.log('usage: node scripts/sql-ledger.cjs <scan [--json] | hash <file> | record <file> | drift>');
      code = 1;
  }
  process.exit(code);
}

module.exports = { mutationsIn, unguardedMutations, stripBodiesAndComments };
