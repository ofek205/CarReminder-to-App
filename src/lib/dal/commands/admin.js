/**
 * Admin-console write commands.
 *
 * ALL offlineCapable: false — by definition. Every one of these is a privileged
 * action on OTHER people's data or on global app config, gated server-side by
 * is_admin(). An admin action must never sit in a device outbox and replay later
 * against a changed world: "delete this account" or "make this user an admin"
 * has to be decided against live state, every time.
 *
 * All resolve to the raw { data, error } envelope: every admin call site
 * branches on `error` (most interpolate `e.message` into a Hebrew toast), and
 * broadcast_app_update also needs `data`.
 *
 * Reads are NOT here (admin_account_details / admin_user_accounts /
 * admin_list_accounts / admin_analytics_drilldown / admin_list_*): the seam
 * governs writes, reads stay with React Query.
 *
 * ⚠️ EVERY call here goes through `adminSupabase`, never `supabase`.
 *
 * During an admin view session, `supabase` is a Proxy that redirects rpc/from
 * to a client holding a token whose `sub` is the TARGET user — which is the
 * whole point of impersonation, but it means an admin call reached through it
 * arrives as the target and fails its own is_admin() gate, silently.
 *
 * The original call sites lived in src/components/admin/** and src/pages/Admin*,
 * which the identity gate exempts for a structural reason: ViewAsRouteGuard
 * closes admin routes for the entire duration of a view session, so their code
 * cannot run while a token is active. Moving those calls HERE removed that
 * guarantee — this module is imported by the whole app, so a command is now
 * reachable from any code path. `adminSupabase` (an un-proxied client) restores
 * the guarantee structurally instead of relying on where the caller happens to
 * live. Enforced by scripts/check-view-as-identity.cjs on every push.
 *
 * Deliberately NOT routed through the seam — see docs/offline-architecture-spec.md:
 *   - `admin_start_view` / `admin_end_view` (WorkspaceContext): the view-as
 *     impersonation path that shipped to production in v6.4.0. Security-critical
 *     and in the most-churned file in the repo; left alone on purpose.
 *   - `crashReporter`'s app_errors insert: telemetry must keep working when the
 *     app is broken, so it stays independent of the seam it would report on.
 */
import { defineCommand } from '../registry';
import { adminSupabase } from '@/lib/supabase';

const adminOnly = { offlineCapable: false, returnsEnvelope: true };
const adminRpc = { ...adminOnly, kind: 'rpc' };

// ── Vehicles (acting on any account) ───────────────────────────────────────
defineCommand('admin.deleteVehicle', {
  ...adminRpc, table: 'vehicles',
  run: ({ vehicleId }) => adminSupabase.rpc('admin_delete_vehicle', { p_vehicle_id: vehicleId }),
});

defineCommand('admin.updateVehicle', {
  ...adminRpc, table: 'vehicles',
  run: ({ vehicleId, patch }) =>
    adminSupabase.rpc('admin_update_vehicle', { p_vehicle_id: vehicleId, p_patch: patch }),
});

defineCommand('admin.deleteVehicles', {
  ...adminRpc, table: 'vehicles',
  run: ({ vehicleIds }) => adminSupabase.rpc('admin_delete_vehicles', { p_vehicle_ids: vehicleIds }),
});

// ── Accounts / users ───────────────────────────────────────────────────────
defineCommand('admin.setAccountOwner', {
  ...adminRpc, table: 'accounts',
  run: ({ accountId, newOwnerUserId, removePrevious }) =>
    adminSupabase.rpc('admin_set_account_owner', {
      p_account_id:        accountId,
      p_new_owner_user_id: newOwnerUserId, // null ⇒ leave ownerless
      p_remove_previous:   !!removePrevious,
    }),
});

defineCommand('admin.deleteAccount', {
  ...adminRpc, table: 'accounts',
  run: ({ accountId }) => adminSupabase.rpc('admin_delete_account', { p_account_id: accountId }),
});

defineCommand('admin.deleteUserFull', {
  ...adminRpc, table: 'accounts',
  run: ({ userId }) => adminSupabase.rpc('admin_delete_user_full', { p_user_id: userId }),
});

defineCommand('admin.setRole', {
  ...adminRpc, table: 'user_roles',
  run: ({ userId, role }) => adminSupabase.rpc('admin_set_role', { p_user_id: userId, p_role: role }),
});

defineCommand('admin.setUserNote', {
  ...adminRpc, table: 'admin_user_notes',
  run: ({ userId, note }) => adminSupabase.rpc('admin_set_user_note', { p_user_id: userId, p_note: note }),
});

// ── Business-workspace requests ────────────────────────────────────────────
defineCommand('admin.approveBusinessRequest', {
  ...adminRpc, table: 'business_workspace_requests',
  run: ({ requestId, reviewNote }) =>
    adminSupabase.rpc('approve_business_workspace_request', {
      p_request_id: requestId, p_review_note: reviewNote,
    }),
});

defineCommand('admin.denyBusinessRequest', {
  ...adminRpc, table: 'business_workspace_requests',
  run: ({ requestId, reviewNote }) =>
    adminSupabase.rpc('deny_business_workspace_request', {
      p_request_id: requestId, p_review_note: reviewNote,
    }),
});

// ── Global app config / broadcasts ─────────────────────────────────────────
defineCommand('admin.broadcastAppUpdate', {
  ...adminRpc, table: 'app_config',
  run: ({ platform, version, clear }) =>
    adminSupabase.rpc('broadcast_app_update', {
      p_platform: platform, p_version: version, p_clear: !!clear,
    }),
});

defineCommand('admin.publishReleaseAnnouncement', {
  ...adminRpc, table: 'app_config',
  run: ({ title, body, clear, keepId }) =>
    adminSupabase.rpc('publish_release_announcement', {
      p_title: title, p_body: body, p_clear: !!clear, p_keep_id: keepId,
    }),
});

defineCommand('admin.setAiProvider', {
  ...adminRpc, table: 'ai_settings',
  run: ({ feature, provider }) =>
    adminSupabase.rpc('set_ai_provider', { p_feature: feature, p_provider: provider }),
});

// ── Bug inbox ──────────────────────────────────────────────────────────────
defineCommand('admin.resolveBug', {
  ...adminOnly, table: 'app_errors',
  run: ({ id }) => adminSupabase.from('app_errors').update({ resolved: true }).eq('id', id),
});

// ── Popups ─────────────────────────────────────────────────────────────────
defineCommand('admin.popupCreate', {
  ...adminOnly, table: 'admin_popups',
  run: (payload) => adminSupabase.from('admin_popups').insert(payload),
});

defineCommand('admin.popupUpdate', {
  ...adminOnly, table: 'admin_popups',
  run: ({ id, ...changes }) => adminSupabase.from('admin_popups').update(changes).eq('id', id),
});

defineCommand('admin.popupDelete', {
  ...adminOnly, table: 'admin_popups',
  run: ({ id }) => adminSupabase.from('admin_popups').delete().eq('id', id),
});
