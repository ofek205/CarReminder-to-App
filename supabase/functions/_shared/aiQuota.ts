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
 * into a no-op. It also covers, for free, the two advisor paths that send no
 * tagging at all: PostCreateDialog's first expert reply, and getVesselAdvice.
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
