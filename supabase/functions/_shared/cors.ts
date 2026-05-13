// ═══════════════════════════════════════════════════════════════════════════
// Shared CORS allow-list logic for browser-callable Edge Functions.
//
// Why this module exists:
//   ai-proxy, dispatch-broadcast, dispatch-reminder-emails, and send-email
//   each maintained their own near-identical copy of:
//     • LOCAL_WEB_ORIGINS  (dev/preview ports)
//     • isTrustedVercelPreview()  (branch-preview hostname matcher)
//     • The allow-list assembly + 'null' fallback logic
//   Comments in each file warned "keep in sync with sister functions" —
//   meaning the duplication was acknowledged but not addressed.
//
//   Centralising the logic here removes the drift risk: a change to the
//   Vercel hostname pattern or the local-dev port list now happens in
//   ONE place. Each function still owns its own `Access-Control-Allow-
//   Headers` value because the set of allowed headers genuinely varies
//   per function (dispatch-* needs x-dispatch-secret; others don't).
//
// Threat model:
//   The allow-list is fail-closed. Origins not in the list get
//   `Access-Control-Allow-Origin: null`, which the browser CORS layer
//   treats as a rejection. The old fallback of "echo the first allowed
//   origin for unauthenticated callers" was tightened in the earlier
//   security pass; this module preserves the fail-closed semantic.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Local dev + preview ports we accept browser requests from. Keep tight:
 * 4 fixed loopback URLs. Anything else has to be in the env var allow-
 * list or come through the Vercel-preview check below.
 */
export const LOCAL_WEB_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

/**
 * Capacitor's WKWebView serves the app from a custom scheme. Only the
 * mobile-callable functions (e.g. ai-proxy) should opt into this — it
 * doesn't belong in functions that are admin-only or pure server-to-
 * server.
 */
export const CAPACITOR_ORIGINS = [
  'capacitor://localhost',
  'https://localhost',
  'ionic://localhost',
];

/**
 * Returns true if the origin looks like a Vercel branch-preview URL of
 * THIS project. Branch previews carry dynamic hostnames of the form
 * `{project}-git-{branch}-{teamslug}.vercel.app` which can't be
 * enumerated in ALLOWED_ORIGIN. The `-git-` segment after the project
 * prefix ensures an attacker can't register a Vercel project with a
 * name that starts with our prefix and inherit our allow-list.
 *
 * Match examples:
 *   ✓ car-reminder-to-app-git-staging-abc123-myteam.vercel.app
 *   ✓ car-manage-hub-git-staging-xyz.vercel.app
 *   ✗ car-reminder-to-app-attacker.vercel.app          (no `-git-`)
 *   ✗ car-reminder-to-app-git-staging.example.com     (not vercel.app)
 *   ✗ http://car-reminder-to-app-git-x.vercel.app     (not https)
 */
export function isTrustedVercelPreview(origin: string): boolean {
  if (!origin) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'https:') return false;
    if (!hostname.endsWith('.vercel.app')) return false;
    return (
      hostname.startsWith('car-reminder-to-app-git-') ||
      hostname.startsWith('car-manage-hub-git-')
    );
  } catch {
    return false;
  }
}

/**
 * Decide which value to put in the `Access-Control-Allow-Origin` header.
 *
 *   • If the caller's Origin is in the assembled allow-list → echo it.
 *   • Otherwise → return the string 'null', which the browser CORS layer
 *     treats as a rejection (fail-closed).
 *
 * @param req           The incoming request.
 * @param extraOrigins  Optional per-function additions (e.g. CAPACITOR_ORIGINS
 *                      for mobile-callable functions). The ALLOWED_ORIGIN env
 *                      var (comma-separated) and LOCAL_WEB_ORIGINS are
 *                      always merged in.
 */
export function pickAllowedOrigin(req: Request, extraOrigins: string[] = []): string {
  const origin = req.headers.get('origin') || '';
  // Pre-consolidation drift: dispatch-broadcast + dispatch-reminder-emails
  // historically used APP_ORIGIN, while ai-proxy + send-email used
  // ALLOWED_ORIGIN. We merge both so the shared module works regardless
  // of which secret name was set on the project. A future cleanup can
  // pick one canonical name once both secrets are confirmed identical.
  const fromAllowed = (Deno.env.get('ALLOWED_ORIGIN') || '').split(',');
  const fromApp     = (Deno.env.get('APP_ORIGIN')     || '').split(',');
  const envAllowed  = [...fromAllowed, ...fromApp]
    .map(s => s.trim())
    .filter(Boolean);
  // Fallback to the canonical production origin if neither env var is set.
  if (envAllowed.length === 0) envAllowed.push('https://car-reminder.app');

  const allowList = [...envAllowed, ...LOCAL_WEB_ORIGINS, ...extraOrigins];
  return (allowList.includes(origin) || isTrustedVercelPreview(origin)) ? origin : 'null';
}

/**
 * Convenience: build a full CORS response-header bag with safe defaults.
 * Callers that need a non-default `Allow-Headers` value should bypass
 * this and call pickAllowedOrigin() directly.
 */
export function buildCorsHeaders(
  req: Request,
  options: {
    allowedHeaders?: string;
    allowedMethods?: string;
    extraOrigins?: string[];
  } = {},
): HeadersInit {
  return {
    'Access-Control-Allow-Origin':  pickAllowedOrigin(req, options.extraOrigins),
    'Access-Control-Allow-Headers': options.allowedHeaders || 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': options.allowedMethods || 'POST, OPTIONS',
    'Vary':                         'Origin',
  };
}
