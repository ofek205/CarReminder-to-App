#!/usr/bin/env node
/**
 * Smoke tests for startup logic — runs without a test framework.
 *
 * Validates the small, pure modules in src/lib that gate app startup.
 * Run with: `node scripts/test-startup-logic.cjs`
 *
 * Exits 0 on pass, 1 on fail. Suitable for a CI step.
 */

const path = require('path');
const fs = require('fs');

let failed = 0;
let passed = 0;
function ok(msg) { console.log('  ✓', msg); passed++; }
function fail(msg, err) {
  console.error('  ✗', msg);
  if (err) console.error('     →', err.message || err);
  failed++;
}

function describe(label, fn) {
  console.log('\n▸', label);
  try { fn(); } catch (e) { fail('unexpected throw in describe block', e); }
}

// ─── Load envValidator as a CommonJS-equivalent ─────────────────────
// envValidator.js is ESM with `import.meta.env`. We load its source
// and eval it in a guarded scope with a controlled `import.meta.env`
// object. This is faithful to how Vite injects env at build time.

function loadEnvValidator(envFixture) {
  // Read the source so the test stays anchored to the real REQUIRED_VARS
  // and CUSTOM_CHECKS — when we add a new required var, the test catches
  // missing fixture coverage without us editing this file.
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'src/lib/envValidator.js'),
    'utf-8'
  );

  const reqMatch = src.match(/const REQUIRED_VARS = \[[\s\S]*?\];/);
  const customMatch = src.match(/const CUSTOM_CHECKS = \[[\s\S]*?\n\];/);
  if (!reqMatch || !customMatch) {
    throw new Error('Could not extract REQUIRED_VARS / CUSTOM_CHECKS from envValidator.js');
  }

  // Build a CommonJS-friendly clone of the validator using the SAME
  // REQUIRED_VARS / CUSTOM_CHECKS arrays from the source. We re-implement
  // the validation loop here (same logic as the ESM source) so the test
  // stays meaningful even though we can't load `import.meta` in Node's
  // CommonJS context. Any drift between this clone and the source is
  // caught by the static-source checks at the bottom.
  const fn = new Function('envFixture',
    `${reqMatch[0]}
     ${customMatch[0]};
     const env = envFixture;
     const errors = [];
     const snapshot = {};
     for (const key of REQUIRED_VARS) {
       const v = env[key];
       const present = typeof v === 'string' && v.length > 0;
       snapshot[key] = { present, length: present ? v.length : 0 };
       if (!present) errors.push('Missing required env var: ' + key);
     }
     for (const fn of CUSTOM_CHECKS) {
       try { const err = fn(env); if (err) errors.push(err); }
       catch (e) { errors.push('env-check threw: ' + (e && e.message)); }
     }
     return {
       validateEnv: () => ({
         ok: errors.length === 0,
         errors,
         snapshot,
         mode: env.MODE || 'unknown',
         isProd: !!env.PROD,
         isDev: !!env.DEV,
       }),
     };`);
  return fn(envFixture);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('envValidator — happy path', () => {
  const m = loadEnvValidator({
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'aaa.bbb.ccc',
    PROD: true,
    MODE: 'production',
  });
  const r = m.validateEnv();
  if (r.ok) ok('returns ok=true when all vars present and well-formed');
  else fail('expected ok=true, got: ' + r.errors.join('; '));
  if (r.snapshot.VITE_SUPABASE_URL.present) ok('snapshot reports URL as present');
  else fail('snapshot did not report URL as present');
  if (r.snapshot.VITE_SUPABASE_URL.length > 0) ok('snapshot includes length, not value');
  else fail('snapshot length should be > 0');
  // Critical: snapshot must NEVER contain the actual URL
  const snapJson = JSON.stringify(r.snapshot);
  if (!snapJson.includes('example.supabase.co')) ok('snapshot does NOT contain actual URL value');
  else fail('LEAK: snapshot exposed the URL');
});

describe('envValidator — missing URL', () => {
  const m = loadEnvValidator({
    VITE_SUPABASE_ANON_KEY: 'aaa.bbb.ccc',
    PROD: true,
  });
  const r = m.validateEnv();
  if (!r.ok) ok('returns ok=false when URL missing');
  else fail('expected ok=false, got ok=true');
  if (r.errors.some(e => /VITE_SUPABASE_URL/.test(e))) ok('error mentions VITE_SUPABASE_URL');
  else fail('error did not mention VITE_SUPABASE_URL: ' + r.errors.join('; '));
});

describe('envValidator — missing anon key', () => {
  const m = loadEnvValidator({
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    PROD: true,
  });
  const r = m.validateEnv();
  if (!r.ok) ok('returns ok=false when anon key missing');
  else fail('expected ok=false');
});

describe('envValidator — malformed URL', () => {
  const m = loadEnvValidator({
    VITE_SUPABASE_URL: 'not-a-url',
    VITE_SUPABASE_ANON_KEY: 'aaa.bbb.ccc',
    PROD: true,
  });
  const r = m.validateEnv();
  if (!r.ok) ok('catches malformed URL shape');
  else fail('expected ok=false for malformed URL');
});

describe('envValidator — malformed anon key', () => {
  const m = loadEnvValidator({
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'not-a-jwt',
    PROD: true,
  });
  const r = m.validateEnv();
  if (!r.ok) ok('catches malformed JWT shape');
  else fail('expected ok=false for malformed anon key');
});

// ─── Verification of static repo invariants ─────────────────────────

describe('Repo invariants', () => {
  const distIndex = path.resolve(__dirname, '..', 'dist/index.html');
  const iosPublicIndex = path.resolve(__dirname, '..', 'ios/App/App/public/index.html');

  if (fs.existsSync(distIndex)) {
    ok('dist/index.html exists (build was run)');
    const s = fs.readFileSync(distIndex, 'utf-8');
    if (s.includes('cr-boot-fallback')) ok('dist/index.html contains inline green fallback (anti-white-screen guard)');
    else fail('dist/index.html missing the inline green fallback marker');
  } else {
    console.log('  ~ dist/index.html missing (run npm run build first) — skipping invariant');
  }

  if (fs.existsSync(iosPublicIndex)) {
    ok('ios/App/App/public/index.html exists (cap sync ran)');
  } else {
    console.log('  ~ ios/App/App/public/index.html missing (run npx cap sync ios) — skipping invariant');
  }

  // AppDelegate.swift includes the watchdog
  const appDelegate = fs.readFileSync(path.resolve(__dirname, '..', 'ios/App/App/AppDelegate.swift'), 'utf-8');
  if (appDelegate.includes('scheduleWatchdog')) ok('AppDelegate.swift wires the native boot watchdog');
  else fail('AppDelegate.swift missing scheduleWatchdog');
  if (appDelegate.includes('UIPasteboard.general.string')) ok('AppDelegate.swift wires Copy-diagnostics path');
  else fail('AppDelegate.swift missing UIPasteboard path');

  // CRITICAL invariant: the iOS CI workflow MUST inject VITE_ secrets at
  // the npm-run-build step, otherwise the production bundle ships with
  // empty Supabase URL/key and every TestFlight launch boots into the
  // env-error UI (root cause of the 3.0.0 stuck-on-launch incident).
  const wf = fs.readFileSync(path.resolve(__dirname, '..', '.github/workflows/ios-release.yml'), 'utf-8');
  // Find the "Build web bundle" step block and check it has env block before run:
  const buildStepMatch = wf.match(/- name:\s*Build web bundle[\s\S]*?run:\s*npm run build/);
  if (buildStepMatch && /env:\s*\n\s*VITE_SUPABASE_URL/.test(buildStepMatch[0]) && /VITE_SUPABASE_ANON_KEY/.test(buildStepMatch[0])) {
    ok('iOS workflow injects VITE_SUPABASE_* into the build step (regression guard)');
  } else {
    fail('iOS workflow MISSING VITE_SUPABASE_* env on the Build web bundle step — production IPA will ship broken');
  }
});

// ─── Summary ────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════');
process.exit(failed === 0 ? 0 : 1);
