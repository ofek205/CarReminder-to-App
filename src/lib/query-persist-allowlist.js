/**
 * Which React Query results are allowed to be written to disk (IndexedDB).
 *
 * ALLOWLIST, not a denylist. With ~300 query sites, a denylist would silently
 * start persisting every new query someone adds — including the next admin or
 * realtime one. Opting in is the safe default: a query nobody listed simply
 * stays memory-only, which is exactly today's behavior.
 *
 * What earns a place here: account-scoped data the user would genuinely want to
 * READ with no signal (their vehicles, documents, service history, checklists,
 * reminders).
 *
 * What must NEVER be here, and why — these are not oversights:
 *   - 'is-admin'          an authorization decision. Never cache a permission verdict to disk.
 *   - 'admin-*'           other people's data + must be live to be useful.
 *   - 'view-as-accounts'  impersonation state.
 *   - 'community_*', 'blocked_users'
 *                         a stale block-list would resurface a blocked user's
 *                         posts — a safety regression, not just staleness.
 *   - 'app-notifs', 'admin-alerts-unack-count'
 *                         realtime; a stale zero reads as "all clear".
 *   - 'routes-*', 'fleet-map-*', 'driving-log-*', 'biz-dash-*'
 *                         live dispatch. A day-old route map actively misleads a manager.
 *   - 'vehicle-shares', 'vehicle-share-info', 'transfer-candidates', membership/team keys
 *                         these GATE DESTRUCTIVE ACTIONS. share-info's shareCount decides
 *                         whether deleting a vehicle cascades to every sharee; a stale
 *                         value runs the wrong cascade. Also role checks.
 *   - 'user-profile'      holds PII (phone, birth date, licence number). Useful offline,
 *                         but deliberately kept off disk — the licence-expiry banner can
 *                         re-fetch. Revisit only with a real reason.
 */
export const PERSIST_ALLOWLIST = new Set([
  // Vehicles
  'vehicles', 'vehicle', 'my-vehicles', 'my-vehicles-detail', 'vehicles-list',
  // Documents + service history
  'documents',
  'maintenance-logs-v2', 'repair-logs',
  // Vehicle-scoped notes / issues / tasks
  'tasks-v2', 'cork-notes', 'vessel_issues',
  // Checklists (template + runs) — a strong offline case: ticking items while
  // walking around a vessel, frequently out of signal.
  'vessel_checklists', 'vessel_checklist_runs', 'vessel_checklist_runs_all',
  // Accidents
  'accidents',
  // Workspace + settings the app needs to render at all
  'user-workspaces', 'reminder-settings',
  // User-defined catalogs — rarely change, cheap to keep
  'repair-types', 'maint-prefs',
  // Immutable-ish government lookup
  'disability-permit',
  // Expenses: view-only offline. Financial figures, so the UI must make the
  // "last updated" state obvious rather than implying live totals.
  'vehicle-expenses', 'expenses', 'my-expenses-vehicles',
]);

/** True when this query's results may be written to disk. */
export function isPersistableQueryKey(queryKey) {
  const head = Array.isArray(queryKey) ? queryKey[0] : queryKey;
  return typeof head === 'string' && PERSIST_ALLOWLIST.has(head);
}
