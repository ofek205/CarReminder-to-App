/**
 * Connection diagnostic — tries every Supabase-supported route to the
 * production database and reports which (if any) accepts auth. Lets us
 * see whether the failure is "wrong password" (every route fails the
 * same way) vs "network / pooler" (one method works, another doesn't).
 *
 * Reads:
 *   • db-password.txt in the repo root (single line, the password only)
 *   • PROJECT_REF env var (defaults to the production ref)
 *
 * Tries:
 *   1. Session Pooler  (port 5432, dotted username)
 *   2. Transaction Pooler (port 6543, dotted username)
 *   3. Direct connection (port 5432, plain "postgres" username)
 *
 * For each method: connects, runs `select 1`, disconnects. Reports
 * success or the exact server-side error.
 */
const fs = require('fs');
const path = require('path');

const tmp = process.env.TEMP || '/tmp';
const { Client } = require(path.join(tmp, 'node_modules', 'pg'));

const PROJECT_REF = process.env.PROJECT_REF || 'zuqvolqapwcxomuzoodu';
const REGION = process.env.PROJECT_REGION || 'eu-west-1';

const PWD_FILE = path.resolve(__dirname, '..', 'db-password.txt');
if (!fs.existsSync(PWD_FILE)) {
  console.error('Missing password file:', PWD_FILE);
  console.error('Create db-password.txt in the repo root with ONE LINE — the database password.');
  process.exit(1);
}

const password = fs.readFileSync(PWD_FILE, 'utf8').trim();
if (!password) {
  console.error('db-password.txt is empty.');
  process.exit(1);
}
console.log(`Loaded password (${password.length} chars). Trying connection methods…\n`);

const methods = [
  {
    name: 'Session Pooler (5432)',
    config: {
      host:     `aws-1-${REGION}.pooler.supabase.com`,
      port:     5432,
      user:     `postgres.${PROJECT_REF}`,
      password,
      database: 'postgres',
      ssl:      { rejectUnauthorized: false },
    },
  },
  {
    name: 'Session Pooler (alt aws-0)',
    config: {
      host:     `aws-0-${REGION}.pooler.supabase.com`,
      port:     5432,
      user:     `postgres.${PROJECT_REF}`,
      password,
      database: 'postgres',
      ssl:      { rejectUnauthorized: false },
    },
  },
  {
    name: 'Transaction Pooler (6543)',
    config: {
      host:     `aws-1-${REGION}.pooler.supabase.com`,
      port:     6543,
      user:     `postgres.${PROJECT_REF}`,
      password,
      database: 'postgres',
      ssl:      { rejectUnauthorized: false },
    },
  },
  {
    name: 'Direct (db.<ref>.supabase.co)',
    config: {
      host:     `db.${PROJECT_REF}.supabase.co`,
      port:     5432,
      user:     'postgres',
      password,
      database: 'postgres',
      ssl:      { rejectUnauthorized: false },
    },
  },
];

(async () => {
  let anyWorked = null;
  for (const m of methods) {
    process.stdout.write(`[${m.name}] connecting… `);
    const client = new Client(m.config);
    const t0 = Date.now();
    try {
      await client.connect();
      await client.query('select 1');
      const ms = Date.now() - t0;
      console.log(`OK in ${ms}ms`);
      if (!anyWorked) anyWorked = m;
      try { await client.end(); } catch {}
    } catch (e) {
      console.log(`FAILED — ${e.message}`);
      try { await client.end(); } catch {}
    }
  }

  console.log('');
  if (anyWorked) {
    console.log(`✓ Working method: ${anyWorked.name}`);
    console.log(`  Use this in dump-prod-schema.cjs:`);
    console.log(`    host=${anyWorked.config.host}`);
    console.log(`    port=${anyWorked.config.port}`);
    console.log(`    user=${anyWorked.config.user}`);
  } else {
    console.log('✗ Every method failed.');
    console.log('  Most likely: the password in db-password.txt does not match the current Supabase database password.');
    console.log('  Try: Supabase Dashboard → Database → Reset password, copy the NEW password into db-password.txt, run again.');
  }
})().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
