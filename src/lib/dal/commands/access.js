/**
 * Access-control write commands — vehicle sharing, account membership,
 * ownership transfer, business-workspace requests.
 *
 * EVERY command here is offlineCapable: false. This is the §3 boundary in its
 * purest form: each one touches ANOTHER party (sends an invite email, grants or
 * revokes someone's access, moves ownership) or is a security decision the
 * server must arbitrate. Queueing any of them offline would mean replaying a
 * permission change against a world that has since moved on.
 *
 * All are SECURITY DEFINER RPCs that re-check the caller's role, and all resolve
 * to the raw { data, error } envelope their call sites already branch on — many
 * of them map specific error codes to Hebrew copy (share_expired,
 * share_email_mismatch, invite_not_found, forbidden_not_owner …), so the
 * envelope must pass through untouched.
 *
 * withTimeout stays at the CALL SITE: the same RPC is wrapped in some places and
 * not others, with per-site labels (e.g. 'invite_driver'), so keeping the
 * commands bare preserves each site's exact timeout behavior.
 */
import { defineCommand } from '../registry';
import { supabase } from '@/lib/supabase';

const online = { offlineCapable: false, kind: 'rpc', returnsEnvelope: true };

// ── Vehicle sharing ────────────────────────────────────────────────────────
defineCommand('share.byEmail', {
  ...online, table: 'vehicle_shares',
  run: ({ vehicleId, email, role }) =>
    supabase.rpc('share_vehicle_with_email', {
      p_vehicle_id: vehicleId, p_email: email, p_role: role,
    }),
});

defineCommand('share.revoke', {
  ...online, table: 'vehicle_shares',
  run: ({ shareId }) => supabase.rpc('revoke_vehicle_share', { p_share_id: shareId }),
});

defineCommand('share.updateRole', {
  ...online, table: 'vehicle_shares',
  run: ({ shareId, role }) =>
    supabase.rpc('update_vehicle_share_role', { p_share_id: shareId, p_role: role }),
});

defineCommand('share.leave', {
  ...online, table: 'vehicle_shares',
  run: ({ vehicleId }) => supabase.rpc('leave_vehicle_share', { p_vehicle_id: vehicleId }),
});

defineCommand('share.accept', {
  ...online, table: 'vehicle_shares',
  run: ({ token }) => supabase.rpc('accept_vehicle_share', { p_token: token }),
});

// ── Account membership ─────────────────────────────────────────────────────
defineCommand('member.inviteByEmail', {
  ...online, table: 'account_members',
  run: ({ email, role, vehicleIds, accountId, name }) =>
    supabase.rpc('invite_account_member_by_email', {
      p_email: email, p_role: role, p_vehicle_ids: vehicleIds,
      p_account_id: accountId, p_name: name,
    }),
});

defineCommand('member.redeemInvite', {
  ...online, table: 'account_members',
  run: ({ token }) => supabase.rpc('redeem_invite_token', { tok: token }),
});

defineCommand('member.remove', {
  ...online, table: 'account_members',
  run: ({ accountId, memberUserId }) =>
    supabase.rpc('remove_member', { p_account_id: accountId, p_member_user_id: memberUserId }),
});

defineCommand('member.changeRole', {
  ...online, table: 'account_members',
  run: ({ accountId, memberUserId, newRole }) =>
    supabase.rpc('change_member_role', {
      p_account_id: accountId, p_member_user_id: memberUserId, p_new_role: newRole,
    }),
});

defineCommand('member.cancelInvite', {
  ...online, table: 'account_members',
  run: ({ accountId, memberUserId }) =>
    supabase.rpc('cancel_pending_invite', {
      p_account_id: accountId, p_member_user_id: memberUserId,
    }),
});

// ── Ownership / workspace ──────────────────────────────────────────────────
defineCommand('ownership.transfer', {
  ...online, table: 'accounts',
  run: ({ accountId, newOwnerUserId }) =>
    supabase.rpc('transfer_ownership', {
      p_account_id: accountId, p_new_owner_user_id: newOwnerUserId,
    }),
});

defineCommand('businessWorkspace.request', {
  ...online, table: 'accounts',
  run: ({ name, businessMeta, reason }) =>
    supabase.rpc('request_business_workspace', {
      p_name: name, p_business_meta: businessMeta, p_reason: reason,
    }),
});
