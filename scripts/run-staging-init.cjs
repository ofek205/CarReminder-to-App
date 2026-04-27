/**
 * One-shot loader: reads staging-init-consolidated.sql and applies it
 * to the database identified by DATABASE_URL.
 *
 * Run from the repo root with the staging branch's POSTGRES connection
 * string (Pooler URL, NOT the API URL):
 *
 *   DATABASE_URL="postgresql://postgres:..." node scripts/run-staging-init.cjs
 *
 * Splits the SQL on top-level semicolons (skipping ones inside dollar-
 * quoted blocks like function bodies) and runs each statement
 * separately so a duplicate-key / already-exists error on one file
 * doesn't abort the whole load.
 *
 * Reports per-statement: ok / skipped (already-exists) / failed.
 */
const fs = require('fs');
const path = require('path');

const tmp = process.env.TEMP || '/tmp';
const { Client } = require(path.join(tmp, 'node_modules', 'pg'));
const pgConn = require(path.join(tmp, 'node_modules', 'pg-connection-string'));

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('Missing DATABASE_URL env var.');
  console.error('Get it from: Supabase Dashboard → Project Settings → Database → Connection string → URI');
  console.error('Make sure to use the STAGING branch, not main.');
  process.exit(1);
}

const SQL_PATH = path.resolve(__dirname, '..', 'staging-init-consolidated.sql');
if (!fs.existsSync(SQL_PATH)) {
  console.error('Cannot find:', SQL_PATH);
  process.exit(1);
}

const SAFE_ERRORS = [
  'already exists',
  'does not exist, skipping',
  'cannot drop',
];

function isSafeError(msg) {
  const m = String(msg || '').toLowerCase();
  return SAFE_ERRORS.some(s => m.includes(s));
}

/**
 * Splits a SQL string into statements by semicolons that are NOT
 * inside dollar-quoted blocks (e.g. function bodies between $$ ... $$).
 * Comment lines starting with `--` are kept in-place.
 */
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let dollarTag = null; // null when outside a $tag$ block; the tag string when inside

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (dollarTag) {
      buf += ch;
      // Look for closing $tag$
      if (ch === '$') {
        const closeIdx = sql.indexOf(`$${dollarTag}$`, i);
        if (closeIdx === i) {
          // Already at the start of a $tag$. Include and exit block.
          buf += sql.substring(i + 1, i + 1 + dollarTag.length + 1);
          i += dollarTag.length + 1;
          dollarTag = null;
        }
      }
      continue;
    }

    // Outside dollar block: detect $tag$ open
    if (ch === '$') {
      const m = sql.substring(i).match(/^\$([A-Za-z0-9_]*)\$/);
      if (m) {
        dollarTag = m[1];
        buf += m[0];
        i += m[0].length - 1;
        continue;
      }
    }

    if (ch === ';') {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = '';
      continue;
    }

    buf += ch;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

(async () => {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  const statements = splitStatements(sql);
  console.log(`Loaded ${statements.length} statements from ${path.basename(SQL_PATH)}`);

  // pg-connection-string handles dotted usernames correctly, unlike
  // the WHATWG URL parser which mangles them for non-HTTP schemes.
  const cfg = pgConn.parse(DB_URL);
  const client = new Client({ ...cfg, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected. Applying…');

  let ok = 0, skipped = 0, failed = 0;
  const failures = [];

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt || stmt.startsWith('--')) continue;
    try {
      await client.query(stmt);
      ok++;
    } catch (e) {
      if (isSafeError(e.message)) {
        skipped++;
      } else {
        failed++;
        failures.push({ index: i + 1, message: e.message, snippet: stmt.slice(0, 120) });
      }
    }
    if ((i + 1) % 50 === 0) {
      process.stdout.write(`  progress: ${i + 1}/${statements.length}  ok=${ok}  skipped=${skipped}  failed=${failed}\r`);
    }
  }

  await client.end();
  console.log('');
  console.log('Done.');
  console.log(`  ok:      ${ok}`);
  console.log(`  skipped: ${skipped}  (already-exists, safe)`);
  console.log(`  failed:  ${failed}`);

  if (failed > 0) {
    console.log('\nFailures:');
    failures.slice(0, 30).forEach(f => {
      console.log(`  [${f.index}] ${f.message}`);
      console.log(`        ${f.snippet}…`);
    });
    if (failures.length > 30) console.log(`  …and ${failures.length - 30} more`);
    process.exit(1);
  }
})().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
