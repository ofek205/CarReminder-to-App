/**
 * Account-provisioning + user-preference write commands.
 *
 * account.ensure is the most load-bearing write in the app: it creates the
 * user's personal account on first boot, and several call sites fire it
 * defensively whenever memberships look empty (WorkspaceContext, GuestContext,
 * Dashboard, vehicleQuickCheck). Routing it through the seam matters beyond
 * tidiness: the offline spec's Finding 1 is that this RPC MUST be blocked while
 * an admin is impersonating (it resolves via auth.uid() and would silently
 * provision/kick to the ADMIN's own account). A single command is the natural
 * place to enforce that in a later phase, instead of four separate guards.
 *
 * ALL offlineCapable: false except the preference hint:
 *   - ensure / claimMigrated: provisioning, must be server-arbitrated and is
 *     meaningless without a live connection (there is nothing to read back).
 *   - deleteMine: irreversible cascade delete. Never queue that.
 *   - userPreferences.setLastActive: a per-user UI hint, safe offline, and
 *     already fire-and-forget at the call site.
 */
import { defineCommand } from '../registry';
import { supabase } from '@/lib/supabase';

defineCommand('account.ensure', {
  offlineCapable: false,
  table: 'accounts',
  kind: 'rpc',
  returnsEnvelope: true,
  run: () => supabase.rpc('ensure_user_account'),
});

defineCommand('account.claimMigrated', {
  offlineCapable: false,
  table: 'accounts',
  kind: 'rpc',
  returnsEnvelope: true,
  run: () => supabase.rpc('claim_migrated_account'),
});

// Irreversible. mode 'account' deletes the account itself; 'data' keeps the
// login and wipes the rows.
defineCommand('account.deleteMine', {
  offlineCapable: false,
  table: 'accounts',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ mode }) => supabase.rpc('delete_my_account', { mode }),
});

defineCommand('userPreferences.setLastActive', {
  offlineCapable: true,
  table: 'user_preferences',
  returnsEnvelope: true,
  run: ({ userId, accountId, updatedAt }) =>
    supabase.from('user_preferences').upsert({
      user_id: userId,
      last_active_account_id: accountId,
      updated_at: updatedAt,
    }, { onConflict: 'user_id' }),
});
