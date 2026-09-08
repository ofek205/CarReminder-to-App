// ═══════════════════════════════════════════════════════════════════════════
// aiQuota — which AI requests count against the advisor quota.
//
// docs/plan-monetization-implementation.md §3.1
//
// ⚠️ THIS FILE IS THE ONLY COPY, AND THAT IS THE POINT.
//   The list below is security-critical: it decides what is free. An
//   earlier attempt put it in src/lib/ as well, which would have meant two
//   copies in two languages that no test could keep in step. It lives here
//   because ai-proxy is where the decision is enforced, and it is plain TS
//   with no Deno globals so the project's vitest can import and test it
//   directly (aiQuota.test.ts sits beside it).
//
//   If you add a scan surface, add it HERE and nowhere else.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Surfaces EXEMPT from the advisor quota: the eight document scans plus the
 * plate OCR.
 *
 * ⚠️ AN EXEMPTION LIST, NOT AN INCLUSION LIST, AND THE INVERSION IS THE
 * WHOLE SECURITY PROPERTY.
 *
 * ai-proxy sanitises silently: a `surface` outside ALLOWED_SURFACES is
 * mapped to NULL and the request is answered anyway rather than refused
 * (index.ts:822-824). So a quota asking "is this one of the chat surfaces?"
 * is defeated by sending `surface: 'x'` from DevTools, and the call becomes
 * free.
 *
 * Asking "is it exempt?" makes an unknown value COUNT, which turns the hole
 * into a no-op. It also covers, for free, the advisor path that sends no
 * tagging at all: getVesselAdvice in src/lib/aiAdvice.js. (An earlier version
 * of this note also listed PostCreateDialog. That is no longer true — it
 * passes surface: 'community_reply' today — and the correction matters,
 * because the two are now routed to DIFFERENT quota buckets below.)
 *
 * plate_scan is exempt because it is the OCR feeding the plate check, which
 * has its own quota. Charging it to the advisor as well would bill one user
 * action twice.
 */
export const EXEMPT_SCAN_SURFACES: readonly string[] = Object.freeze([
  'vehicle_scan',
  'vessel_scan',
  'vehicle_inline_scan',
  'driver_license_scan',
  'expense_personal_scan',
  'expense_business_scan',
  'document_scan',
  'maintenance_log_scan',
  'plate_scan',
]);

const EXEMPT = new Set(EXEMPT_SCAN_SURFACES);

/**
 * Does this request count against the AI advisor quota?
 *
 * Deny-by-default. NULL, undefined, an empty string, a forged value and a
 * type that is not a string all count.
 *
 * @param surface the sanitised surface (ai-proxy's `requestSurface`), which
 *   is already NULL for anything outside ALLOWED_SURFACES
 */
export function countsTowardAiQuota(surface: unknown): boolean {
  if (typeof surface !== 'string') return true;
  return !EXEMPT.has(surface);
}

/**
 * Surfaces whose usage is counted, but NOT against the free lifetime teaser.
 *
 * Today this is the community forum's expert reply, and the reason is that
 * the user never asked for it. Posting a question triggers the reply on its
 * own, so on the free plan (one advisor question, ever) the very first forum
 * post would silently spend the whole allowance. The user would then open the
 * advisor for the first time and meet a paywall, having never knowingly used
 * the free question, and both community call sites swallow their errors to
 * console, so nothing would tell them what happened.
 *
 * That defeats what the teaser is for: it exists to demonstrate the ADVISOR.
 * Spending it on an unrequested forum reply sells nothing and reads as a bug.
 *
 * These calls still cost provider tokens, so they are counted, and paid
 * plans' daily fair-use ceiling sums both buckets (see ai_quota_check in
 * supabase-monetization-phase5b-ai-quota-2026-09-08.sql). The split only
 * protects the teaser.
 */
export const NON_TEASER_SURFACES: readonly string[] = Object.freeze([
  'community_reply',
]);

const NON_TEASER = new Set(NON_TEASER_SURFACES);

/** The feature key a counted request is recorded under. */
export const FEATURE_ADVISOR = 'ai_advisor';
export const FEATURE_FORUM = 'ai_forum';

/**
 * Which counter bucket does this request belong to?
 *
 * Deny-by-default in the same direction as countsTowardAiQuota: anything
 * unrecognised lands in FEATURE_ADVISOR, the bucket the teaser is measured
 * against. An unknown surface is therefore treated as a real advisor
 * question, never as the exempt-from-teaser kind, so a forged value cannot
 * buy unlimited free questions by claiming to be a forum reply.
 *
 * Only call this when countsTowardAiQuota(surface) is true; an exempt scan
 * has no bucket at all.
 */
export function aiQuotaFeature(surface: unknown): string {
  if (typeof surface !== 'string') return FEATURE_ADVISOR;
  return NON_TEASER.has(surface) ? FEATURE_FORUM : FEATURE_ADVISOR;
}
