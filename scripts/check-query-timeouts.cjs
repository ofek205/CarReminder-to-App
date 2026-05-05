#!/usr/bin/env node
/**
 * Gate: enforces that every Supabase call inside a React Query
 * `useQuery` queryFn is wrapped with a timeout — either via the
 * `withTimeout(...)` helper from `src/lib/supabaseQuery.js` or an
 * inline `Promise.race(...)`.
 *
 * Why: a Supabase call that hangs leaves React Query's `isLoading`
 * true forever, which in turn keeps the page on a permanent loading
 * spinner. We've shipped six fixes for "stuck on loading" — the root
 * cause every time was an unprotected useQuery body. This gate makes
 * sure no new code reintroduces the hazard.
 *
 * Baseline behaviour:
 *   The codebase has many pre-existing unprotected calls. Wrapping
 *   them all in one commit is too risky to review. Instead the gate
 *   stores a per-file violation count in
 *   `scripts/.query-timeout-baseline.json` and fails only when the
 *   count for a file goes UP. Existing code is grandfathered; new
 *   code is forced to use the wrapper. To migrate a file, lower its
 *   number in the baseline (or run `node scripts/check-query-timeouts.cjs
 *   --update-baseline` after wrapping calls).
 *
 * Exit codes:
 *   0 — no new violations beyond baseline
 *   1 — at least one file has more violations than its baseline
 *
 * Wired in via:
 *   - .githooks/pre-push (runs before every push)
 *   - .github/workflows/production-gates.yml (runs on every PR to main)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const SUPABASE_CALL_PATTERNS = [
  /\bsupabase\.from\s*\(/,
  /\bsupabase\.rpc\s*\(/,
  /\bdb\.[A-Za-z_][A-Za-z0-9_]*\.(filter|create|update|delete|get|list)\s*\(/,
];
const TIMEOUT_PATTERNS = [
  /\bwithTimeout\s*\(/,
  /\bPromise\.race\s*\(/,
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) files.push(full);
  }
  return files;
}

// Returns the full `{...}` body that follows `useQuery(` at index `start`.
// Uses brace counting; treats strings and comments naively but the
// patterns we look for are not ambiguous in practice in this codebase.
function extractUseQueryBody(content, start) {
  const open = content.indexOf('{', start);
  if (open === -1) return null;
  let depth = 1, i = open + 1;
  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return { open, close: i, body: content.slice(open, i) };
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

function checkFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const violations = [];
  let cursor = 0;
  while (true) {
    const m = content.indexOf('useQuery(', cursor);
    if (m === -1) break;
    const block = extractUseQueryBody(content, m);
    if (!block) { cursor = m + 9; continue; }
    const body = block.body;
    const hasSupabaseCall = SUPABASE_CALL_PATTERNS.some(rx => rx.test(body));
    if (hasSupabaseCall) {
      const hasTimeout = TIMEOUT_PATTERNS.some(rx => rx.test(body));
      if (!hasTimeout) {
        violations.push({
          file: path.relative(ROOT, file),
          line: lineNumberAt(content, m),
          snippet: body.split('\n').slice(0, 4).join('\n').trim().slice(0, 200),
        });
      }
    }
    cursor = block.close;
  }
  return violations;
}

const BASELINE_PATH = path.join(__dirname, '.query-timeout-baseline.json');

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); }
  catch { return {}; }
}

function saveBaseline(counts) {
  // Strip zero-count entries to keep the file tidy.
  const filtered = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
  fs.writeFileSync(
    BASELINE_PATH,
    JSON.stringify(filtered, Object.keys(filtered).sort(), 2) + '\n',
    'utf8'
  );
}

function main() {
  const files = walk(SRC);
  const violationsByFile = {};
  const allViolations = [];
  for (const f of files) {
    const v = checkFile(f);
    if (v.length > 0) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      violationsByFile[rel] = v.length;
      allViolations.push(...v);
    }
  }

  if (process.argv.includes('--update-baseline')) {
    saveBaseline(violationsByFile);
    const total = Object.values(violationsByFile).reduce((a, b) => a + b, 0);
    console.log(`\x1b[0;33m[baseline updated] ${Object.keys(violationsByFile).length} file(s), ${total} violation(s) recorded.\x1b[0m`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  const regressions = [];
  for (const [file, count] of Object.entries(violationsByFile)) {
    const allowed = baseline[file] || 0;
    if (count > allowed) {
      regressions.push({ file, count, allowed });
    }
  }
  // Also surface any baselined files that no longer exist or now have
  // ZERO violations — these are stale entries the dev should clean up.
  const stale = Object.keys(baseline).filter(f => (violationsByFile[f] || 0) < (baseline[f] || 0));

  if (regressions.length === 0) {
    const totalCurrent = Object.values(violationsByFile).reduce((a, b) => a + b, 0);
    const totalBaseline = Object.values(baseline).reduce((a, b) => a + b, 0);
    let msg = `\x1b[0;32m[ok] check-query-timeouts: ${files.length} files scanned. ${totalCurrent} grandfathered violation(s) at or below baseline (${totalBaseline}).\x1b[0m`;
    if (stale.length > 0) {
      msg += `\n\x1b[0;33m[hint] ${stale.length} file(s) improved below baseline — run \`node scripts/check-query-timeouts.cjs --update-baseline\` to lock the gain in.\x1b[0m`;
    }
    console.log(msg);
    process.exit(0);
  }

  console.error(`\x1b[0;31m[BLOCKED] check-query-timeouts: new unprotected Supabase call(s) inside useQuery — these will cause "stuck on loading" if the request hangs.\x1b[0m\n`);
  for (const r of regressions) {
    console.error(`  ${r.file} — ${r.count} violation(s), baseline allows ${r.allowed}`);
    const fileViolations = allViolations.filter(v => v.file.replace(/\\/g, '/') === r.file);
    for (const v of fileViolations) {
      console.error(`    line ${v.line}: ${v.snippet.split('\n')[0].slice(0, 120)}`);
    }
    console.error('');
  }
  console.error(`Fix: wrap the Supabase call with \`withTimeout(...)\` from \`@/lib/supabaseQuery\`:\n`);
  console.error(`    const { data, error } = await withTimeout(`);
  console.error(`      supabase.from('table').select('*'),`);
  console.error(`      'table_label'`);
  console.error(`    );\n`);
  console.error(`Or, if you intentionally migrated a file, run:`);
  console.error(`    node scripts/check-query-timeouts.cjs --update-baseline\n`);
  process.exit(1);
}

main();
