/**
 * Runtime env validator — fail-fast on missing build-time config.
 *
 * Why this exists:
 *   The codebase already has a *defensive* path for missing Supabase env
 *   (supabase.js sets `window.__crBootEnvError` and main.jsx renders a
 *   startup-error screen). That covers the Supabase-specific case.
 *
 *   This module makes the check **explicit and pluggable** so we can add
 *   more required vars in the future without scattering checks across
 *   modules. It runs *synchronously* at the top of main.jsx, BEFORE any
 *   provider tree boots — if anything is missing the user sees a clear
 *   error rather than a hung splash.
 *
 * Design constraints:
 *   - Zero external imports — must be safe to call before bootDiagnostics.
 *   - NEVER print actual secret values. We log presence/absence only.
 *   - Multiple validators can register. Result is the union of failures.
 *
 * To add a new check:
 *   1. Append to REQUIRED_VARS or add a custom check in CUSTOM_CHECKS.
 *   2. Update docs/IOS_DEBUGGING.md if it's a new build-time requirement.
 */

// Add new required vars here. They MUST be exposed via `import.meta.env`
// (i.e. prefixed with VITE_ at build time) — Vite strips everything else
// from the production bundle.
const REQUIRED_VARS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
];

// Helper: trim whitespace before validating. GitHub Actions secrets that
// were pasted with a trailing newline have bitten us in production — the
// raw value gets inlined by Vite as e.g. `"eyJ...\n"`, which then fails the
// JWT-shape regex (since `$` without the `m` flag rejects a trailing `\n`)
// AND breaks `new URL(...)` inside `createClient()`. We accept a trimmed
// value as "looks reasonable" — the runtime path in supabase.js trims
// before createClient too, so the trimmed value is what actually ships.
function trimmedValue(env, key) {
  const v = env[key];
  if (typeof v !== 'string') return '';
  return v.trim();
}

// Custom checks. Each function returns null on pass, or a string error.
// Custom checks are useful for "the value exists AND looks reasonable"
// (e.g. URL parses, key looks like a JWT segment) without ever logging
// the actual value.
const CUSTOM_CHECKS = [
  function checkSupabaseUrlShape(env) {
    const raw = env.VITE_SUPABASE_URL;
    if (!raw) return null; // covered by presence check
    const v = trimmedValue(env, 'VITE_SUPABASE_URL');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(v)) {
      return 'VITE_SUPABASE_URL does not look like a Supabase URL (expected https://*.supabase.co)';
    }
    return null;
  },
  function checkAnonKeyShape(env) {
    const raw = env.VITE_SUPABASE_ANON_KEY;
    if (!raw) return null;
    const v = trimmedValue(env, 'VITE_SUPABASE_ANON_KEY');
    // anon keys are JWTs — three base64 segments separated by dots.
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(v)) {
      return 'VITE_SUPABASE_ANON_KEY does not look like a JWT';
    }
    return null;
  },
  // Defence-in-depth: flag stale VITE_DEV_* env vars that would leak
  // into the production bundle. The dev shortcut in AuthPage now uses
  // hardcoded dev-only values (no env vars at all). If someone still
  // has the old VITE_ prefixed vars set, Vite will inline them into
  // the bundle as dead env entries — warn loudly.
  // Audit finding 2026-05-27: renamed to non-VITE_ prefix to prevent
  // credentials from appearing in dist JS.
  function checkNoDevCredsInProd(env) {
    if (!env.PROD) return null;
    if (env.VITE_DEV_EMAIL || env.VITE_DEV_PASSWORD) {
      console.warn('[envValidator] SECURITY: VITE_DEV_EMAIL / VITE_DEV_PASSWORD are still set. These WILL leak into the production bundle. Remove the VITE_ prefix or delete them entirely — AuthPage no longer reads them.');
    }
    // Also warn about AI keys with VITE_ prefix.
    if (env.VITE_GEMINI_API_KEY || env.VITE_GROQ_API_KEY) {
      console.warn('[envValidator] SECURITY: VITE_GEMINI_API_KEY / VITE_GROQ_API_KEY are set with VITE_ prefix. These WILL leak into the production bundle. Remove the VITE_ prefix — production uses ai-proxy Edge Function secrets.');
    }
    return null;
  },
];

/**
 * Run all checks against the build-time env.
 *
 * @returns {{ ok: boolean, errors: string[], snapshot: object }}
 *   `snapshot` lists each REQUIRED_VAR with `{ present: boolean, length: number }`
 *   — never the actual value. Safe to attach to bug reports.
 */
export function validateEnv() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const errors = [];
  const snapshot = {};

  for (const key of REQUIRED_VARS) {
    const v = env[key];
    const present = typeof v === 'string' && v.length > 0;
    // We record BOTH raw length and trimmed length so a TestFlight
    // diagnostic dump immediately surfaces "secret pasted with trailing
    // whitespace" — a real production failure mode on this app. If
    // trimmedLength !== length, the secret has stray whitespace and a
    // strict-end-of-string regex (e.g. JWT shape) will fail unless we
    // trim before validating. The runtime path in supabase.js also
    // trims, so this is consistent end-to-end.
    const trimmedLength = present ? v.trim().length : 0;
    snapshot[key] = {
      present,
      length: present ? v.length : 0,
      trimmedLength,
      hasWhitespace: present && trimmedLength !== v.length,
    };
    if (!present) errors.push(`Missing required env var: ${key}`);
  }

  for (const fn of CUSTOM_CHECKS) {
    try {
      const err = fn(env);
      if (err) errors.push(err);
    } catch (e) {
      errors.push(`env-check threw: ${e?.message || String(e)}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    snapshot,
    mode: env.MODE || 'unknown',
    isProd: !!env.PROD,
    isDev: !!env.DEV,
  };
}

/**
 * Convenience — returns a single multi-line message safe for logs.
 */
export function describeEnvFailure(result) {
  if (result.ok) return 'env: ok';
  return ['env: FAIL', ...result.errors].join('\n');
}
