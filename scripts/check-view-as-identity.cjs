#!/usr/bin/env node
/**
 * Gate: admin-only calls must never travel on the impersonated data plane.
 *
 * Why: during an admin view session, src/lib/supabase.js exports `supabase` as
 * a Proxy that redirects `from` / `rpc` / `storage` / `functions` to a client
 * holding a token whose `sub` is the TARGET user. That is what makes every RLS
 * policy behave as it does for the real user, and it is the point of the whole
 * feature. But it also means an admin RPC reached through `supabase` arrives as
 * the target — who fails its `is_admin()` gate by construction, since minting
 * refuses admin targets.
 *
 * The failures are silent. `admin_end_view` rejected leaves ended_at NULL: an
 * exit that does not exit. `admin_user_accounts` rejected returns [] through an
 * `if (error) return []`: a workspace list that quietly empties. `admin_start_
 * view` rejected aborts a workspace switch with nothing on screen.
 *
 * On 2026-07-24 this was fixed three separate times as "remember to clear the
 * token first", and forgotten again each time, in a single sitting. The fix
 * that held was structural — a named `adminSupabase` export that is never
 * redirected — and this gate is what keeps it that way. A rule that has to be
 * re-remembered at every new call site is not a rule; it is a countdown.
 *
 * The rule: reach admin RPCs through `adminSupabase`, not `supabase`.
 *
 * EXEMPT DIRECTORIES
 *   src/pages/Admin*  and  src/components/admin/**
 *   These render only inside admin routes, which ViewAsRouteGuard closes for
 *   the entire duration of a view session, so no impersonation token can be
 *   active while their code runs. AdminUserDrawer is the boundary case: it is
 *   what STARTS a session, and by then it has already unmounted.
 *
 * NOT COVERED (deliberate): `supabase.rpc('is_admin')` in useIsAdmin. It does
 * return false mid-session, but every consumer was traced and none of them can
 * strand the admin — ViewAsBanner and ViewAsRouteGuard both read the local
 * view-as flag, so the exit button always renders.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one admin call on the proxied client
 *
 * Wired in via:
 *   - .githooks/pre-push (runs before every push)
 *   - .github/workflows/production-gates.yml (runs on every PR to main)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// The negative lookbehind is what keeps `adminSupabase.rpc(...)` — the correct
// form — from matching. Without it the gate would flag exactly the code it
// exists to encourage.
const PATTERNS = [
  {
    re: /(?<![A-Za-z0-9_$.])supabase\s*\.\s*rpc\s*\(\s*['"`]admin_/g,
    what: "supabase.rpc('admin_…')",
  },
  {
    re: /(?<![A-Za-z0-9_$.])supabase\s*\.\s*functions\s*\.\s*invoke\s*\(\s*['"`]admin-/g,
    what: "supabase.functions.invoke('admin-…')",
  },
];

const EXEMPT = [
  // path prefixes, POSIX-style, relative to src/
  'components/admin/',
  'pages/Admin',
];

function isExempt(relPosix) {
  return EXEMPT.some((p) => relPosix.startsWith(p));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

let violations = 0;

for (const file of walk(SRC)) {
  const relPosix = path.relative(SRC, file).split(path.sep).join('/');
  if (isExempt(relPosix)) continue;

  const source = fs.readFileSync(file, 'utf8');
  for (const { re, what } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      violations++;
      console.error(
        `  src/${relPosix}:${lineOf(source, m.index)}  ${what}  ->  use adminSupabase`
      );
    }
  }
}

if (violations > 0) {
  console.error('');
  console.error(`view-as identity gate: ${violations} admin call(s) on the impersonated plane.`);
  console.error('');
  console.error('During a view session these arrive as the TARGET user and fail their');
  console.error("own is_admin() gate — usually silently. Import { adminSupabase } from");
  console.error("'@/lib/supabase' and call through that instead.");
  process.exit(1);
}

console.log('view-as identity gate: OK (no admin calls on the impersonated plane)');
process.exit(0);
