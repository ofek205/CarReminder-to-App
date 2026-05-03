/**
 * scripts/verify-storage-migration-schema.mjs
 *
 * Schema-level verification for Sprint A.B-1 — does NOT require user login.
 *
 * Strategy: PostgREST returns HTTP 400 with an error body when you SELECT a
 * column that doesn't exist — even when RLS blocks the row (the parser
 * resolves columns before evaluating RLS). We send a `select=<col>&limit=0`
 * request per (table, column) pair and inspect the response:
 *
 *   - 200 / 206              → column exists, RLS may or may not let us see rows
 *   - 400 with "column ... does not exist" → DDL not applied
 *   - 401 / 403              → auth blocking, can't conclude (anon key issue)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

async function loadEnvFile(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '');
    }
  } catch {}
}
await loadEnvFile(path.join(REPO_ROOT, '.env'));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const headers = { apikey: ANON, Authorization: `Bearer ${ANON}` };

const checks = [
  ['documents', 'storage_path'],
  ['vehicles', 'vehicle_photo_storage_path'],
  ['accidents', 'other_driver_insurance_photo_storage_path'],
  ['community_posts', 'image_storage_path'],
];

let allGreen = true;
console.log('Probing PostgREST for migration columns (anon, RLS-aware)…\n');

for (const [tbl, col] of checks) {
  const url = `${SUPABASE_URL}/rest/v1/${tbl}?select=${col}&limit=0`;
  const r = await fetch(url, { headers });
  let verdict, detail = '';
  if (r.ok) {
    verdict = '✅ EXISTS';
  } else if (r.status === 400) {
    const body = await r.text();
    if (/does not exist/i.test(body) || /unknown.*column/i.test(body)) {
      verdict = '❌ COLUMN MISSING';
      detail = body.slice(0, 200);
      allGreen = false;
    } else {
      verdict = `⚠️  400 (other) — ${body.slice(0, 200)}`;
    }
  } else if (r.status === 401 || r.status === 403) {
    verdict = `⚠️  ${r.status} (auth) — column existence inconclusive`;
  } else {
    verdict = `⚠️  ${r.status} — ${(await r.text()).slice(0, 120)}`;
  }
  console.log(`  ${verdict.padEnd(30)} ${tbl}.${col}${detail ? ` (${detail})` : ''}`);
}

console.log('\nVerdict:', allGreen ? '✅ schema OK' : '❌ at least one column missing — DDL not fully applied');
process.exit(allGreen ? 0 : 1);
