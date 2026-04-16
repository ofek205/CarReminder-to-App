/**
 * Base44 → Supabase Migration Script
 *
 * Reads the Base44 JSON export and generates SQL INSERT statements
 * to run in the Supabase SQL Editor (runs as postgres, bypasses RLS).
 *
 * Also creates a migration_email_map table for auto-linking users on registration.
 *
 * Usage: node scripts/migrate-base44.js
 * Output: scripts/migration-output.sql
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Load Base44 export ──
const INPUT_PATH = path.join(__dirname, '..', '..', 'vehicle-app-export-2026-04-16.json');
const OUTPUT_PATH = path.join(__dirname, 'migration-output.sql');

const raw = fs.readFileSync(INPUT_PATH, 'utf8');
const accounts = JSON.parse(raw);

// ── Helpers ──
function uuid() {
  return crypto.randomUUID();
}

function esc(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

function escDate(val) {
  if (!val) return 'NULL';
  // Validate date format
  const d = new Date(val);
  if (isNaN(d.getTime())) return 'NULL';
  return `'${val}'`;
}

function escInt(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  const n = Number(val);
  if (isNaN(n)) return 'NULL';
  return String(Math.round(n));
}

function escBool(val) {
  return val ? 'TRUE' : 'FALSE';
}

// ── Vehicle type normalization ──
function normalizeVehicleType(type) {
  if (!type) return 'רכב';
  const t = type.trim();
  // Map Base44 types to Supabase vehicle_type values
  const map = {
    'רכב': 'רכב',
    'רכב פרטי': 'רכב',
    'פרטי נוסעים': 'רכב',
    'רכב ניסן': 'רכב',
    'קטנוע': 'קטנוע',
    'אופנוע': 'אופנוע',
    'אופנוע שטח': 'אופנוע שטח',
    'אופנוע כביש': 'אופנוע כביש',
    'עגלה נגררת': 'עגלה נגררת',
    'ימאהה': 'אופנוע',
  };
  return map[t] || t;
}

// ── ID mapping (Base44 hex → Supabase UUID) ──
const idMap = {};
function mapId(base44Id) {
  if (!base44Id) return null;
  if (!idMap[base44Id]) {
    idMap[base44Id] = uuid();
  }
  return idMap[base44Id];
}

// ── Dedup tracking ──
const seenEmails = new Set();
const seenPlates = new Set();

// ── Build SQL ──
const sql = [];

sql.push('-- ═══════════════════════════════════════════════════════════');
sql.push('-- Base44 → Supabase Migration');
sql.push(`-- Generated: ${new Date().toISOString()}`);
sql.push(`-- Source: ${accounts.length} accounts, from vehicle-app-export-2026-04-16.json`);
sql.push('-- ═══════════════════════════════════════════════════════════');
sql.push('');

// ── 1. Create migration_email_map table ──
sql.push('-- ── Step 1: Migration email map table ──');
sql.push('CREATE TABLE IF NOT EXISTS migration_email_map (');
sql.push('  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),');
sql.push('  email TEXT NOT NULL UNIQUE,');
sql.push('  account_id UUID NOT NULL,');
sql.push('  full_name TEXT,');
sql.push('  phone TEXT,');
sql.push('  birth_date DATE,');
sql.push('  driver_license_number TEXT,');
sql.push('  license_expiration_date DATE,');
sql.push('  migrated_at TIMESTAMPTZ DEFAULT now(),');
sql.push('  claimed_by_user_id UUID DEFAULT NULL,');
sql.push('  claimed_at TIMESTAMPTZ DEFAULT NULL');
sql.push(');');
sql.push('');
sql.push('-- Allow authenticated users to read/update their own email mapping');
sql.push('ALTER TABLE migration_email_map ENABLE ROW LEVEL SECURITY;');
sql.push("DROP POLICY IF EXISTS migration_email_read ON migration_email_map;");
sql.push("CREATE POLICY migration_email_read ON migration_email_map FOR SELECT TO authenticated USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));");
sql.push("DROP POLICY IF EXISTS migration_email_update ON migration_email_map;");
sql.push("CREATE POLICY migration_email_update ON migration_email_map FOR UPDATE TO authenticated USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));");
sql.push('');

// ── 2. Insert accounts, vehicles, logs, documents ──
sql.push('-- ── Step 2: Insert migrated data ──');
sql.push('BEGIN;');
sql.push('');

let stats = { accounts: 0, members: 0, vehicles: 0, maintenance: 0, repairs: 0, documents: 0, emailMaps: 0 };

for (const account of accounts) {
  const accountUuid = mapId(account.account_id);

  // Skip accounts without meaningful data AND no vehicles
  // (still create accounts with vehicles even if 0 logs)

  sql.push(`-- Account: ${account.account_name}`);
  sql.push(`INSERT INTO accounts (id, name, created_at) VALUES (${esc(accountUuid)}, ${esc(account.account_name)}, ${escDate(account.created_date)}) ON CONFLICT (id) DO NOTHING;`);
  stats.accounts++;

  // ── Members ──
  for (const member of (account.members || [])) {
    const email = member.email?.toLowerCase().trim();
    if (!email) continue;

    // Email map for auto-linking on registration
    if (!seenEmails.has(email)) {
      seenEmails.add(email);
      const owner = account.owner || {};
      sql.push(`INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES (${esc(email)}, ${esc(accountUuid)}, ${esc(member.full_name || owner.full_name)}, ${esc(owner.phone || null)}, ${escDate(owner.birth_date || null)}, ${esc(owner.driver_license_number || null)}, ${escDate(owner.license_expiration_date || null)}) ON CONFLICT (email) DO NOTHING;`);
      stats.emailMaps++;
    }

    // Note: account_members are NOT inserted here because user_id must reference auth.users.
    // They will be created when the user registers and the migration map is claimed.
    stats.members++;
  }

  // ── Vehicles ──
  for (const v of (account.vehicles || [])) {
    const vehicleUuid = mapId(v.id);
    const plate = v.license_plate?.replace(/[-\s]/g, '') || '';

    // Skip duplicate plates
    if (plate && seenPlates.has(plate)) {
      sql.push(`-- SKIPPED duplicate plate: ${v.license_plate} (${v.manufacturer} ${v.model})`);
      continue;
    }
    if (plate) seenPlates.add(plate);

    const vType = normalizeVehicleType(v.type);

    sql.push(`INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES (${esc(vehicleUuid)}, ${esc(accountUuid)}, ${esc(vType)}, ${esc(v.manufacturer)}, ${esc(v.model)}, ${escInt(v.year)}, ${esc(v.license_plate)}, ${esc(v.nickname)}, ${escInt(v.current_km)}, ${escDate(v.test_due_date)}, ${escDate(v.insurance_due_date)}) ON CONFLICT (id) DO NOTHING;`);
    stats.vehicles++;
  }

  // ── Maintenance logs ──
  for (const log of (account.maintenance_logs || [])) {
    const logUuid = mapId(log.id);
    const vehicleUuid = mapId(log.vehicle_id);
    if (!vehicleUuid) continue;

    sql.push(`INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES (${esc(logUuid)}, ${esc(vehicleUuid)}, ${esc(log.service_type)}, ${esc(log.service_type === 'large' ? 'טיפול גדול' : log.service_type === 'small' ? 'טיפול קטן' : 'טיפול')}, ${escDate(log.performed_at)}, ${esc(log.performed_by)}, ${escInt(log.cost)}, ${esc(log.notes)}, ${escInt(log.km_at_service)}) ON CONFLICT (id) DO NOTHING;`);
    stats.maintenance++;
  }

  // ── Repair logs → maintenance_logs (type = 'תיקון') ──
  for (const rep of (account.repair_logs || [])) {
    const repUuid = mapId(rep.id);
    const vehicleUuid = mapId(rep.vehicle_id);
    if (!vehicleUuid) continue;

    sql.push(`INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES (${esc(repUuid)}, ${esc(vehicleUuid)}, 'תיקון', ${esc(rep.title || 'תיקון')}, ${escDate(rep.occurred_at)}, ${esc(rep.repaired_by)}, ${escInt(rep.cost)}, ${esc(rep.description)}) ON CONFLICT (id) DO NOTHING;`);
    stats.repairs++;
  }

  // ── Documents ──
  for (const doc of (account.documents || [])) {
    const docUuid = mapId(doc.id);
    const vehicleUuid = mapId(doc.vehicle_id);

    sql.push(`INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES (${esc(docUuid)}, ${esc(accountUuid)}, ${esc(vehicleUuid)}, ${esc(doc.document_type)}, ${esc(doc.title)}, ${escDate(doc.issue_date)}, ${escDate(doc.expiry_date)}) ON CONFLICT (id) DO NOTHING;`);
    stats.documents++;
  }

  sql.push('');
}

sql.push('COMMIT;');
sql.push('');

// ── 3. Validation queries ──
sql.push('-- ── Step 3: Validation queries (run after migration) ──');
sql.push("SELECT 'accounts' AS entity, COUNT(*) FROM accounts WHERE id IN (SELECT account_id FROM migration_email_map);");
sql.push("SELECT 'vehicles' AS entity, COUNT(*) FROM vehicles WHERE account_id IN (SELECT account_id FROM migration_email_map);");
sql.push("SELECT 'maintenance_logs' AS entity, COUNT(*) FROM maintenance_logs WHERE vehicle_id IN (SELECT id FROM vehicles WHERE account_id IN (SELECT account_id FROM migration_email_map));");
sql.push("SELECT 'documents' AS entity, COUNT(*) FROM documents WHERE account_id IN (SELECT account_id FROM migration_email_map);");
sql.push("SELECT 'email_mappings' AS entity, COUNT(*) FROM migration_email_map;");

// ── Write output ──
fs.writeFileSync(OUTPUT_PATH, sql.join('\n'), 'utf8');

console.log('═══════════════════════════════════════════');
console.log('Migration SQL generated successfully!');
console.log('═══════════════════════════════════════════');
console.log(`Output: ${OUTPUT_PATH}`);
console.log('');
console.log('Stats:');
console.log(`  Accounts:         ${stats.accounts}`);
console.log(`  Email mappings:   ${stats.emailMaps}`);
console.log(`  Vehicles:         ${stats.vehicles}`);
console.log(`  Maintenance logs: ${stats.maintenance}`);
console.log(`  Repair logs:      ${stats.repairs}`);
console.log(`  Documents:        ${stats.documents}`);
console.log('');
console.log('Next steps:');
console.log('1. Review migration-output.sql');
console.log('2. Run it in Supabase SQL Editor (Dashboard → SQL Editor)');
console.log('3. Verify with the validation queries at the bottom');
console.log('4. Deploy the updated app code (auto-link on registration)');
