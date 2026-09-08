/**
 * Personal vehicle-cap + cap-driven business-workspace creation.
 *
 * These three RPCs arrived with the vehicle-cap/monetization feature from a
 * parallel session and were merged in as raw `supabase.rpc` calls, which eroded
 * the seam's one invariant: no screen writes to supabase directly. Routing them
 * here restores it.
 *
 * ALL offlineCapable: false. The cap is an entitlement — the server is the only
 * authority on it, every one of these is arbitrated there, and none is
 * meaningful without a live connection. `create_business_workspace_from_cap`
 * additionally re-verifies the cap server-side, so it must never be replayed
 * from a queue against a cap that has since changed.
 *
 * All three declare `returnsEnvelope: true` because `supabase.rpc` resolves to
 * `{ data, error }` rather than throwing. The flag has to describe what run()
 * actually returns, or the offline guard in run.js would throw for a command
 * whose call sites are reading an envelope.
 */
import { defineCommand } from '../registry';
import { supabase } from '@/lib/supabase';

// Raises the cap enough to fit a batch about to be inserted. Best-effort at
// every call site: a failure means the insert may hit cap enforcement, which
// is a visible, recoverable error rather than a silent corruption.
defineCommand('cap.bumpPersonal', {
  offlineCapable: false,
  table: 'accounts',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ accountId, headroom }) =>
    supabase.rpc('bump_personal_cap', {
      p_account_id: accountId,
      p_headroom: headroom,
    }),
});

// Freezes the cap to the real vehicle count via greatest(count, 10), so it only
// ever moves up. Runs after a batch insert to settle the cap.
defineCommand('cap.syncToCount', {
  offlineCapable: false,
  table: 'accounts',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ accountId }) =>
    supabase.rpc('sync_personal_cap_to_count', { p_account_id: accountId }),
});

// Creates the business workspace directly when the user is at their personal
// cap (auto-approved path). The server re-verifies the cap.
defineCommand('cap.createBusinessWorkspace', {
  offlineCapable: false,
  table: 'accounts',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ name, businessMeta }) =>
    supabase.rpc('create_business_workspace_from_cap', {
      p_name: name,
      p_business_meta: businessMeta,
    }),
});
