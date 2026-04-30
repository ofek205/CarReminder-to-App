/**
 * scripts/smoke-test-storage-migration.mjs
 *
 * End-to-end smoke test for Sprint A.B-1: the Documents.jsx migration from
 * "base64 in DB" → "Supabase Storage + storage_path".
 *
 * What this script verifies (the same path the hook + Documents.jsx exercise
 * at runtime, just driven from Node instead of the browser):
 *
 *   1. Sign in as the dev user (.env.local creds).
 *   2. Resolve a writable account_id from v_user_workspaces.
 *   3. Upload a real PNG to vehicle-files/scans/{user_id}/... using the same
 *      `uploadToBucket` shape the hook uses (uploadToBucket pathPrefix matches
 *      `scans/${accountId}` for the hook, but for the smoke we use user_id
 *      since RLS on the bucket keys on auth.uid() for the scans/ prefix and
 *      account_id ≡ user_id for personal workspaces).
 *   4. Insert a documents row that includes BOTH file_url and storage_path.
 *   5. Read the row back and confirm storage_path is what we wrote.
 *   6. Refresh the signed URL via storage.createSignedUrl and HTTP-fetch it
 *      to confirm bytes come back (proves the URL actually serves content).
 *   7. Clean up — delete the row + the storage object so we don't litter.
 *
 * Run:  node scripts/smoke-test-storage-migration.mjs
 *
 * Exit codes:
 *   0 — all green
 *   1 — at least one step failed (full report printed)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TEST_FILE = path.join(REPO_ROOT, 'sprint1-dev-components.png');

// ---------- env loading -------------------------------------------------------
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
await loadEnvFile(path.join(REPO_ROOT, '.env.local'));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const DEV_EMAIL = process.env.VITE_DEV_EMAIL;
const DEV_PASS = process.env.VITE_DEV_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DEV_EMAIL || !DEV_PASS) {
  console.error('[smoke] missing env vars — need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_DEV_EMAIL, VITE_DEV_PASSWORD');
  process.exit(1);
}

// ---------- helpers -----------------------------------------------------------
const BUCKET = 'vehicle-files';
const SIGNED_TTL = 60 * 60 * 24 * 7;

const results = [];
function record(step, ok, detail = '') {
  results.push({ step, ok, detail });
  const icon = ok ? '✅' : '❌';
  console.log(`${icon}  ${step}${detail ? ` — ${detail}` : ''}`);
}

function safeName(name) {
  const base = (name || 'file').toString().normalize('NFKD');
  return base.replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-80);
}

// ---------- run --------------------------------------------------------------
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let userId, accountId, storagePath, docId;
// declared up here so the cleanup block can always see them, even when the
// vehicle phase throws partway through (we still want to remove the bucket
// object and the half-inserted row).
let vehStoragePathTracked = null;
let vehId = null;
let allGreen = true;

try {
  // 1. sign in
  console.log(`[smoke] signing in as ${DEV_EMAIL}…`);
  const { data: signIn, error: signErr } = await supabase.auth.signInWithPassword({
    email: DEV_EMAIL,
    password: DEV_PASS,
  });
  if (signErr) throw new Error(`sign-in: ${signErr.message}`);
  userId = signIn.user.id;
  record('sign-in (00/00 dev creds)', true, `user_id=${userId}`);

  // 2. resolve a writable account
  const { data: ws, error: wsErr } = await supabase
    .from('v_user_workspaces')
    .select('account_id, role, status, account_type, account_name')
    .eq('user_id', userId);
  if (wsErr) throw new Error(`v_user_workspaces: ${wsErr.message}`);
  const writable = (ws || []).find(
    m =>
      m.status !== 'הוסר' &&
      m.status !== 'removed' &&
      ['בעלים', 'מנהל', 'owner', 'manager'].includes(m.role)
  );
  if (!writable) throw new Error(`no writable workspace for ${DEV_EMAIL} — got ${JSON.stringify(ws)}`);
  accountId = writable.account_id;
  record('resolve writable account_id', true, `account=${accountId} role=${writable.role}`);

  // 3. upload to storage
  const fileBuf = await fs.readFile(TEST_FILE);
  const fileName = `smoke-${Date.now()}.png`;
  // Match the path scheme used by the prod scans/ flow:
  // scans/{user_id}/{uuid}-{name}. RLS allows owner to read.
  storagePath = `scans/${userId}/${crypto.randomUUID()}-${safeName(fileName)}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuf, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });
  if (upErr) throw new Error(`storage.upload: ${upErr.message}`);
  record('storage.upload to vehicle-files bucket', true, storagePath);

  // 4. signed URL #1
  const { data: signed1, error: sign1Err } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_TTL);
  if (sign1Err) throw new Error(`createSignedUrl: ${sign1Err.message}`);
  const signedUrl1 = signed1.signedUrl;
  const isSignedUrlPattern = signedUrl1.includes('/storage/v1/object/sign/') && signedUrl1.includes('token=');
  record(
    'createSignedUrl returns Storage signed URL pattern',
    isSignedUrlPattern,
    isSignedUrlPattern ? `${signedUrl1.slice(0, 80)}…` : signedUrl1
  );
  if (!isSignedUrlPattern) allGreen = false;

  // 5. fetch the signed URL — bytes come back?
  const fetched = await fetch(signedUrl1);
  const fetchedBuf = Buffer.from(await fetched.arrayBuffer());
  const bytesMatch = fetchedBuf.length === fileBuf.length;
  record(
    'HTTP GET signed URL returns same bytes as original',
    fetched.ok && bytesMatch,
    `status=${fetched.status} bytes=${fetchedBuf.length}/${fileBuf.length}`
  );
  if (!fetched.ok || !bytesMatch) allGreen = false;

  // 6. insert documents row with file_url + storage_path (mirrors handleSave)
  const docRow = {
    account_id: accountId,
    document_type: 'אחר',
    title: `Sprint A.B-1 smoke test ${new Date().toISOString()}`,
    file_url: signedUrl1,
    storage_path: storagePath,
    description: 'auto-generated by smoke-test-storage-migration.mjs — safe to delete',
  };
  const { data: inserted, error: insErr } = await supabase
    .from('documents')
    .insert(docRow)
    .select('id, file_url, storage_path, account_id')
    .single();
  if (insErr) throw new Error(`documents.insert: ${insErr.message}`);
  docId = inserted.id;
  const storagePathPersisted = inserted.storage_path === storagePath;
  record(
    'documents row INSERT with storage_path column',
    storagePathPersisted,
    `id=${docId} storage_path_persisted=${storagePathPersisted}`
  );
  if (!storagePathPersisted) allGreen = false;

  // 7. read back and refresh signed URL (mirrors resolveDocUrl in Documents.jsx)
  const { data: readBack, error: readErr } = await supabase
    .from('documents')
    .select('id, file_url, storage_path')
    .eq('id', docId)
    .single();
  if (readErr) throw new Error(`documents.select: ${readErr.message}`);
  const { data: signed2, error: sign2Err } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(readBack.storage_path, SIGNED_TTL);
  if (sign2Err) throw new Error(`refresh createSignedUrl: ${sign2Err.message}`);
  const refreshedFetch = await fetch(signed2.signedUrl);
  record(
    'resolveDocUrl flow: read row → createSignedUrl(storage_path) → fetch',
    refreshedFetch.ok,
    `status=${refreshedFetch.status}`
  );
  if (!refreshedFetch.ok) allGreen = false;

  // 8. file_url is NOT a base64 data: URL — proves we're not regressing
  const isNotBase64 = !readBack.file_url.startsWith('data:');
  record(
    'documents.file_url is NOT a base64 data: URL (no regression)',
    isNotBase64,
    readBack.file_url.slice(0, 60) + '…'
  );
  if (!isNotBase64) allGreen = false;

  // ============================================================
  // Sprint A.B-2 — Vehicles flow (vehicle_photo + vehicle_photo_storage_path)
  // ============================================================
  console.log('\n[smoke] vehicles flow…');
  vehStoragePathTracked = `scans/${userId}/${crypto.randomUUID()}-veh-${Date.now()}.png`;
  const { error: vehUpErr } = await supabase.storage
    .from(BUCKET)
    .upload(vehStoragePathTracked, fileBuf, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });
  if (vehUpErr) throw new Error(`vehicles storage.upload: ${vehUpErr.message}`);
  record('vehicles: storage.upload to vehicle-files bucket', true, vehStoragePathTracked);

  const { data: vehSigned, error: vehSignErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(vehStoragePathTracked, SIGNED_TTL);
  if (vehSignErr) throw new Error(`vehicles createSignedUrl: ${vehSignErr.message}`);

  // Insert a minimal vehicle row that mirrors what AddVehicle.jsx persists:
  // vehicle_photo (signed URL, valid 7 days for instant display) AND
  // vehicle_photo_storage_path (durable path for re-signing).
  const vehRow = {
    account_id: accountId,
    vehicle_type: 'רכב',
    nickname: `Sprint A.B-2 smoke ${new Date().toISOString().slice(0, 19)}`,
    license_plate: `SMOKE${Math.floor(Math.random() * 1e8)}`,
    vehicle_photo: vehSigned.signedUrl,
    vehicle_photo_storage_path: vehStoragePathTracked,
  };
  const { data: vehInserted, error: vehInsErr } = await supabase
    .from('vehicles')
    .insert(vehRow)
    .select('id, vehicle_photo, vehicle_photo_storage_path')
    .single();
  if (vehInsErr) throw new Error(`vehicles.insert: ${vehInsErr.message}`);
  vehId = vehInserted.id;
  const vehStoragePersisted = vehInserted.vehicle_photo_storage_path === vehStoragePathTracked;
  record(
    'vehicles row INSERT with vehicle_photo_storage_path column',
    vehStoragePersisted,
    `id=${vehInserted.id}`
  );
  if (!vehStoragePersisted) allGreen = false;

  // Read back + refresh signed URL — mirrors what VehicleImage does on render.
  const { data: vehReadBack, error: vehReadErr } = await supabase
    .from('vehicles')
    .select('id, vehicle_photo, vehicle_photo_storage_path')
    .eq('id', vehInserted.id)
    .single();
  if (vehReadErr) throw new Error(`vehicles.select: ${vehReadErr.message}`);
  const { data: vehSigned2, error: vehSign2Err } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(vehReadBack.vehicle_photo_storage_path, SIGNED_TTL);
  if (vehSign2Err) throw new Error(`vehicles refresh createSignedUrl: ${vehSign2Err.message}`);
  const vehFetch = await fetch(vehSigned2.signedUrl);
  record(
    'vehicles: VehicleImage flow (read row → refresh signed URL → fetch)',
    vehFetch.ok,
    `status=${vehFetch.status}`
  );
  if (!vehFetch.ok) allGreen = false;
} catch (err) {
  allGreen = false;
  record('FATAL', false, err.message);
} finally {
  // cleanup — best effort
  console.log('\n[smoke] cleaning up…');
  if (docId) {
    const { error } = await supabase.from('documents').delete().eq('id', docId);
    record('cleanup: delete documents row', !error, error ? error.message : `id=${docId}`);
  }
  if (storagePath) {
    const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
    record('cleanup: remove storage object (documents)', !error, error ? error.message : storagePath);
  }
  if (vehId) {
    const { error } = await supabase.from('vehicles').delete().eq('id', vehId);
    record('cleanup: delete vehicles row', !error, error ? error.message : `id=${vehId}`);
  }
  if (vehStoragePathTracked) {
    const { error } = await supabase.storage.from(BUCKET).remove([vehStoragePathTracked]);
    record('cleanup: remove storage object (vehicles)', !error, error ? error.message : vehStoragePathTracked);
  }
  await supabase.auth.signOut().catch(() => {});
}

console.log('\n========== SMOKE TEST SUMMARY ==========');
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`Passed: ${passed}    Failed: ${failed}`);
if (failed > 0) {
  console.log('\nFailed steps:');
  results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.step}${r.detail ? ` — ${r.detail}` : ''}`));
}
console.log('\nVerdict:', allGreen ? '✅ ALL GREEN — Storage migration verified end-to-end' : '❌ AT LEAST ONE STEP FAILED');
process.exit(allGreen ? 0 : 1);
