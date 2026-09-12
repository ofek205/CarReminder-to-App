#!/usr/bin/env node
/**
 * Finds a statement-start line repeated with only comments or blanks between
 * the two copies.
 *
 * WHY THIS EXISTS: on 2026-09-09 phase 2b of the monetization work failed in
 * the Supabase editor with `syntax error at or near "public"`, and left
 * itself PARTIALLY APPLIED against the database that staging and production
 * share. The cause was two adjacent copies of the same line:
 *
 *     update public.account_subscriptions        <- stray, left behind
 *     -- ⚠️ DOES NOT TOUCH ovr_note. ...
 *     update public.account_subscriptions        <- the real statement
 *        set grace_until = p_until
 *      where account_id = p_account_id;
 *
 * A comment was inserted above a statement and the original line was never
 * removed. Postgres consumed the second `update` as a table alias and then
 * choked on `public`, which is why the reported line looked perfectly fine
 * in isolation.
 *
 * ⚠️ AND NOTHING ELSE IN THE TOOLCHAIN COULD SEE IT. eslint does not read
 * SQL. check-sql-hazards is a pattern scanner for missing guards, not a
 * parser. Paren and `$$` balance checks pass, because the duplicate breaks
 * neither: the file was balanced WITH the bug, which is exactly why balance
 * was never enough. There is no Postgres and no SQL parser in this project,
 * so the only place this class can be caught before it reaches a live
 * database is a check shaped like this one.
 *
 * Deliberately NARROW. It does not look for a statement repeated anywhere in
 * a file, which is completely normal (dozens of functions contain
 * `update public.x`). It looks for the specific shape a comment-insertion
 * edit leaves behind: the SAME line, twice, with nothing but comments
 * between them. That is never valid SQL, so there is no baseline and no
 * grandfathering. As of 2026-09-10 all 223 .sql files in the repo are clean.
 */

const fs = require('fs');
const path = require('path');

/**
 * Lines that can begin a statement. `with` is included because a duplicated
 * CTE opener is the same mistake, and phase 1's backfill and the grandfather
 * freeze both start that way.
 */
const STATEMENT_START =
  /^\s*(update|insert\s+into|delete\s+from|select|alter\s+table|create\s+(or\s+replace\s+)?(function|table|trigger|policy|index|view)|grant|revoke|comment\s+on|perform|raise|truncate|with)\b/i;

/**
 * @param {string} text the file's contents
 * @returns {{first:number, second:number, text:string}[]} 1-based line numbers
 */
function findDuplicateStatements(text) {
  const lines = text.split(/\r?\n/);
  const found = [];

  for (let i = 0; i < lines.length; i++) {
    if (!STATEMENT_START.test(lines[i])) continue;

    const a = lines[i].trim();
    // A line that already terminates is a whole statement. Two identical
    // complete statements in a row are legal, if pointless.
    if (a.endsWith(';')) continue;

    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === '' || t.startsWith('--')) continue;   // skip comments/blanks
      // Only the FIRST real line matters. Anything else means the statement
      // continued normally, which is what keeps `select 1 / union all /
      // select 1` and multi-row VALUES lists from being reported.
      if (t === a) found.push({ first: i + 1, second: j + 1, text: a });
      break;
    }
  }

  return found;
}

/** Every .sql file in the repo, excluding vendored and worktree copies. */
function sqlFiles(root = path.resolve(__dirname, '..')) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (/node_modules|[\\/]\.git|worktrees|[\\/]dist|[\\/]build/.test(p)) continue;
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.sql')) out.push(p);
    }
  };
  walk(root);
  return out;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const files = sqlFiles(root);
  let total = 0;

  for (const f of files) {
    const hits = findDuplicateStatements(fs.readFileSync(f, 'utf8'));
    for (const h of hits) {
      console.error(`${path.relative(root, f).replace(/\\/g, '/')}`);
      console.error(`   line ${h.first} and line ${h.second} are identical, with only comments between:`);
      console.error(`   ${h.text}`);
      total++;
    }
  }

  if (total === 0) {
    console.log(`[ok] sql-duplicate-statements: ${files.length} files scanned, no duplicated statement starts.`);
    return 0;
  }
  console.error(`\n[fail] ${total} duplicated statement start(s). This is never valid SQL.`);
  console.error('A comment was probably inserted above a statement and the original line left behind.');
  return 1;
}

// Guarded so the module can be required by a test. Unguarded, requiring it
// would run the scan and call process.exit, killing the vitest worker rather
// than failing a test.
if (require.main === module) process.exit(main());

module.exports = { findDuplicateStatements, sqlFiles, STATEMENT_START };
