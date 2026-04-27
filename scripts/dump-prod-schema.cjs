/**
 * Schema introspection — pure Node, no Docker, no external pg_dump.
 * Connects to a Postgres database (via DATABASE_URL_PROD) and produces
 * a SQL file that recreates the schema on a fresh database.
 *
 * Covers:
 *   • CREATE EXTENSION for every installed non-builtin extension
 *   • CREATE TABLE (columns + defaults + nullability + comments)
 *   • Primary keys / unique / check / foreign-key constraints
 *   • CREATE INDEX (non-PK indexes only)
 *   • CREATE SEQUENCE for any standalone sequences
 *   • CREATE FUNCTION (uses pg_get_functiondef which gives the canonical body)
 *   • CREATE TRIGGER
 *   • RLS enable + every policy
 *   • Grants on functions to authenticated/anon
 *
 * Output goes to schema-prod.sql in the repo root, ordered so each
 * statement runs cleanly on a blank target. Run with:
 *
 *   $env:DATABASE_URL_PROD="postgres://..."
 *   node scripts/dump-prod-schema.cjs
 *
 * Then load the resulting schema-prod.sql onto staging via the existing
 * run-staging-init.cjs script.
 */
const fs = require('fs');
const path = require('path');

const tmp = process.env.TEMP || '/tmp';
const { Client } = require(path.join(tmp, 'node_modules', 'pg'));
const pgConn = require(path.join(tmp, 'node_modules', 'pg-connection-string'));

const DB_URL = process.env.DATABASE_URL_PROD;
if (!DB_URL) {
  console.error('Missing DATABASE_URL_PROD env var.');
  console.error('Get it from: Supabase Dashboard → main branch → Connect → Session pooler');
  process.exit(1);
}

const OUT = path.resolve(__dirname, '..', 'schema-prod.sql');

const lines = [];
function L(s) { lines.push(s); }

(async () => {
  // Parse via pg-connection-string (the same library pg uses
  // internally). WHATWG's `new URL()` mangles dotted usernames in
  // non-HTTP schemes, which is what Supabase's Session Pooler
  // returns ("postgres.<project_ref>"). pg-connection-string is
  // purpose-built for postgresql:// URLs and gets the user right.
  const cfg = pgConn.parse(DB_URL);
  console.log(`Parsed: user=${cfg.user}, host=${cfg.host}, db=${cfg.database}`);
  const client = new Client({
    ...cfg,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected to production. Introspecting…');

  L('-- =====================================================');
  L('-- Schema dump from production via Node introspection');
  L(`-- Generated: ${new Date().toISOString()}`);
  L('-- =====================================================');
  L('');

  // ── Extensions ────────────────────────────────────────────
  const exts = await client.query(`
    SELECT e.extname
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE n.nspname IN ('public', 'extensions')
      AND e.extname NOT IN ('plpgsql')
    ORDER BY e.extname
  `);
  if (exts.rows.length) {
    L('-- Extensions');
    for (const r of exts.rows) {
      L(`CREATE EXTENSION IF NOT EXISTS "${r.extname}";`);
    }
    L('');
  }

  // ── Standalone sequences (not the ones backing serial cols) ────
  const seqs = await client.query(`
    SELECT c.relname AS seq_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S' AND n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = c.oid AND d.deptype = 'a'
      )
    ORDER BY c.relname
  `);
  if (seqs.rows.length) {
    L('-- Sequences');
    for (const r of seqs.rows) {
      L(`CREATE SEQUENCE IF NOT EXISTS public."${r.seq_name}";`);
    }
    L('');
  }

  // ── Tables, columns, defaults ─────────────────────────────
  const tables = await client.query(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public'
    ORDER BY c.relname
  `);
  console.log(`Tables: ${tables.rows.length}`);

  L('-- Tables');
  for (const t of tables.rows) {
    const tname = t.table_name;
    const cols = await client.query(`
      SELECT
        a.attname AS column_name,
        format_type(a.atttypid, a.atttypmod) AS data_type,
        a.attnotnull AS not_null,
        pg_get_expr(d.adbin, d.adrelid) AS default_value
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = ('public.' || quote_ident($1))::regclass
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `, [tname]);

    L(`CREATE TABLE IF NOT EXISTS public."${tname}" (`);
    const defs = cols.rows.map(c => {
      let line = `  "${c.column_name}" ${c.data_type}`;
      if (c.default_value) line += ` DEFAULT ${c.default_value}`;
      if (c.not_null) line += ' NOT NULL';
      return line;
    });
    L(defs.join(',\n'));
    L(');');
    L('');
  }

  // ── Constraints (PK, FK, UNIQUE, CHECK) ───────────────────
  const constraints = await client.query(`
    SELECT
      c.conname AS name,
      n.nspname AS schema_name,
      cl.relname AS table_name,
      pg_get_constraintdef(c.oid) AS def,
      c.contype AS type
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY (c.contype = 'f') ASC, cl.relname, c.conname
  `);
  console.log(`Constraints: ${constraints.rows.length}`);

  if (constraints.rows.length) {
    L('-- Constraints');
    for (const c of constraints.rows) {
      L(`ALTER TABLE public."${c.table_name}" ADD CONSTRAINT "${c.name}" ${c.def};`);
    }
    L('');
  }

  // ── Indexes (skipping ones that back PK/UNIQUE constraints) ────
  const indexes = await client.query(`
    SELECT i.indexname, i.indexdef
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.indexname NOT IN (
        SELECT conname FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE n.nspname = 'public' AND c.contype IN ('p','u')
      )
    ORDER BY i.tablename, i.indexname
  `);
  console.log(`Indexes: ${indexes.rows.length}`);

  if (indexes.rows.length) {
    L('-- Indexes');
    for (const ix of indexes.rows) {
      // Convert CREATE INDEX -> CREATE INDEX IF NOT EXISTS for idempotency
      const def = ix.indexdef.replace(/^CREATE INDEX\b/, 'CREATE INDEX IF NOT EXISTS')
                              .replace(/^CREATE UNIQUE INDEX\b/, 'CREATE UNIQUE INDEX IF NOT EXISTS');
      L(`${def};`);
    }
    L('');
  }

  // ── Functions ─────────────────────────────────────────────
  const fns = await client.query(`
    SELECT
      p.proname AS name,
      pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        JOIN pg_extension e ON e.oid = d.refobjid
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
    ORDER BY p.proname
  `);
  console.log(`Functions: ${fns.rows.length}`);

  if (fns.rows.length) {
    L('-- Functions');
    for (const f of fns.rows) {
      L(f.def + ';');
      L('');
    }
  }

  // ── Triggers ──────────────────────────────────────────────
  const trigs = await client.query(`
    SELECT
      t.tgname AS name,
      pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
    ORDER BY t.tgname
  `);
  console.log(`Triggers: ${trigs.rows.length}`);

  if (trigs.rows.length) {
    L('-- Triggers');
    for (const tr of trigs.rows) {
      L(`${tr.def};`);
    }
    L('');
  }

  // ── RLS enable + policies ────────────────────────────────
  const rlsTables = await client.query(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relrowsecurity
    ORDER BY c.relname
  `);
  if (rlsTables.rows.length) {
    L('-- RLS enable');
    for (const r of rlsTables.rows) {
      L(`ALTER TABLE public."${r.table_name}" ENABLE ROW LEVEL SECURITY;`);
    }
    L('');
  }

  const policies = await client.query(`
    SELECT
      schemaname, tablename, policyname, cmd, permissive,
      roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);
  console.log(`RLS policies: ${policies.rows.length}`);

  if (policies.rows.length) {
    L('-- RLS policies');
    for (const p of policies.rows) {
      let policy = `CREATE POLICY "${p.policyname}" ON public."${p.tablename}"`;
      if (p.permissive === 'PERMISSIVE') policy += ' AS PERMISSIVE';
      else if (p.permissive === 'RESTRICTIVE') policy += ' AS RESTRICTIVE';
      policy += ` FOR ${p.cmd}`;
      // pg_policies.roles can come back as a JS array (when pg parses
      // name[]) or as a Postgres array literal string like "{authenticated,anon}".
      // Normalize both to a comma list for the TO clause.
      let roleList = null;
      if (Array.isArray(p.roles) && p.roles.length) {
        roleList = p.roles.join(', ');
      } else if (typeof p.roles === 'string' && p.roles.length > 2) {
        roleList = p.roles.replace(/^\{|\}$/g, '').split(',').filter(Boolean).join(', ');
      }
      if (roleList) policy += ` TO ${roleList}`;
      if (p.qual) policy += ` USING (${p.qual})`;
      if (p.with_check) policy += ` WITH CHECK (${p.with_check})`;
      L(`${policy};`);
    }
    L('');
  }

  // ── Grants on functions ──────────────────────────────────
  const grants = await client.query(`
    SELECT
      grantee,
      routine_name,
      privilege_type
    FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND grantee IN ('authenticated', 'anon', 'service_role')
    ORDER BY routine_name, grantee
  `);
  console.log(`Function grants: ${grants.rows.length}`);

  if (grants.rows.length) {
    L('-- Function grants');
    for (const g of grants.rows) {
      L(`GRANT ${g.privilege_type} ON FUNCTION public."${g.routine_name}" TO ${g.grantee};`);
    }
    L('');
  }

  await client.end();

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`Done. Wrote ${lines.length} lines to ${OUT}`);
})().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
